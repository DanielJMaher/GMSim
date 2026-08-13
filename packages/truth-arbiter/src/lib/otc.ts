import { access, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'node-html-parser';
import { DATA_DIR } from './config.js';

/**
 * Shared OverTheCap contract-corpus plumbing. The Liquidator (cap structure)
 * and the Barterer (trade-value tiering) both read the same nflverse mirror
 * of OTC's historical contracts; the download + position-bucket mapping live
 * here so the agents can't drift apart.
 *
 * The nflverse `historical_contracts.csv.gz` asset was abandoned mid-2022 —
 * only the parquet is still rebuilt (daily). We read the parquet with
 * hyparquet and materialize it as a CSV in the legacy column layout (money
 * fields in raw dollars), so the CSV-reading agents stay format-stable while
 * getting current data. Delete data/historical_contracts.csv to refresh.
 */

const CONTRACTS_PARQUET_URL =
  'https://github.com/nflverse/nflverse-data/releases/download/contracts/historical_contracts.parquet';

/** Materialized CSV — download + conversion happen at most once. */
export const CONTRACTS_CSV_PATH = resolve(DATA_DIR, 'historical_contracts.csv');

/** Columns written to the materialized CSV (legacy layout + gsis_id). */
const CSV_COLUMNS = [
  'player', 'position', 'team', 'is_active', 'year_signed', 'years',
  'value', 'apy', 'guaranteed', 'apy_cap_pct',
  'inflated_value', 'inflated_apy', 'inflated_guaranteed',
  'player_page', 'otc_id', 'gsis_id', 'date_of_birth',
  'height', 'weight', 'college',
  'draft_year', 'draft_round', 'draft_overall', 'draft_team',
] as const;

/** Parquet money columns are in $M; the legacy CSV carried raw dollars. */
const DOLLAR_COLUMNS = new Set([
  'value', 'apy', 'guaranteed', 'inflated_value', 'inflated_apy', 'inflated_guaranteed',
]);

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Ensure the materialized OTC contracts CSV exists locally. */
export async function ensureContractsCsv(): Promise<void> {
  if (await exists(CONTRACTS_CSV_PATH)) return;
  const parquetPath = resolve(DATA_DIR, 'historical_contracts.parquet');
  if (!(await exists(parquetPath))) {
    process.stdout.write('  fetching OTC contracts (nflverse mirror, parquet)…');
    const res = await fetch(CONTRACTS_PARQUET_URL);
    if (!res.ok) throw new Error(`contracts parquet → HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(parquetPath, buf);
    process.stdout.write(` ${(buf.length / 1e6).toFixed(1)}MB\n`);
  }
  const { parquetReadObjects } = await import('hyparquet');
  const { compressors } = await import('hyparquet-compressors');
  const file = (await readFile(parquetPath)).buffer as ArrayBuffer;
  const rows = (await parquetReadObjects({
    file,
    compressors,
    columns: [...CSV_COLUMNS],
  })) as Record<string, unknown>[];
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(
      CSV_COLUMNS.map((c) => {
        const v = row[c];
        if (v === null || v === undefined) return '';
        if (DOLLAR_COLUMNS.has(c) && typeof v === 'number') return String(Math.round(v * 1e6));
        return csvEscape(String(v));
      }).join(','),
    );
  }
  await writeFile(CONTRACTS_CSV_PATH, lines.join('\n') + '\n', 'utf8');
  process.stdout.write(`  materialized historical_contracts.csv (${rows.length} contracts)\n`);
}

/** GMSim position → OTC position bucket. */
export const OTC_BUCKET: Record<string, string> = {
  QB: 'QB', RB: 'RB', FB: 'FB', WR: 'WR', TE: 'TE',
  LT: 'LT', RT: 'RT', LG: 'LG', RG: 'RG', C: 'C',
  EDGE: 'ED', DT: 'IDL', NT: 'IDL',
  OLB: 'LB', ILB: 'LB',
  CB: 'CB', NICKEL: 'CB', S: 'S',
  K: 'K', P: 'P', LS: 'LS',
};

/**
 * OverTheCap dead-money plumbing (LIQUIDATOR_DEAD_MONEY.md §16 — the bar).
 *
 * §15 (the sourcing ruling) established: `overthecap.com/salary-cap-space`
 * exposes only 2026/2027/2028 (no completed seasons), and — proven by direct
 * measurement — the page is EPHEMERAL (its 2025 figures rolled off between
 * 2026-08-08 and 2026-08-12). Unlike `ensureContractsCsv`'s versioned-parquet
 * source, a cached miss here can never be re-fetched to the same values, so
 * the cache is the dataset of record (§15.7), not merely courtesy.
 */

const DEAD_MONEY_URL = 'https://overthecap.com/salary-cap-space';

/** Materialized CSV — fetched once, all 3 exposed seasons captured even
 *  though the bar only uses 2026 (§15.7 R6 — 2027 becomes next year's
 *  settled baseline for free). Delete the file to refresh. */
export const DEAD_MONEY_CSV_PATH = resolve(DATA_DIR, 'otc_dead_money.csv');

export interface DeadMoneyRow {
  season: number;
  team: string;
  /** OTC's own team code (from the row's `team-link <ABBR>` class), e.g. "SF". */
  abbr: string;
  deadMoney: number;
  capSpace: number;
  activeCapSpending: number;
  /** The season's published "Base Salary Cap:" figure — same value for every
   *  row in a season. Read directly off the page rather than estimated
   *  (§15.3 forbids reconstructing it as capSpace+spending+deadMoney, which
   *  yields the carryover-inclusive ADJUSTED cap, not the league base). */
  baseCap: number;
  /** ISO capture date — load-bearing per §15.7: which season was "current"
   *  at fetch time matters for interpreting a live, revising figure. */
  retrieved: string;
}

function parseMoney(s: string): number {
  const n = Number(s.replace(/[$,]/g, '').trim());
  return Number.isFinite(n) ? n : NaN;
}

function parseDeadMoneyHtml(html: string, retrieved: string): DeadMoneyRow[] {
  const root = parse(html);
  const rows: DeadMoneyRow[] = [];
  for (const container of root.querySelectorAll('.salary-cap-space-container')) {
    const idAttr = container.getAttribute('id') ?? '';
    const seasonMatch = /season-(\d{4})/.exec(idAttr);
    if (!seasonMatch) continue;
    const season = Number(seasonMatch[1]);
    const h4Text = container.querySelector('h4')?.text ?? '';
    const capMatch = /Base Salary Cap:\s*\$?([\d,]+)/.exec(h4Text);
    const baseCap = capMatch ? parseMoney(capMatch[1]!) : NaN;

    for (const tr of container.querySelectorAll('table tbody tr')) {
      const tds = tr.querySelectorAll('td');
      if (tds.length < 6) continue;
      const teamLink = tds[0]?.querySelector('a.team-link');
      const team = teamLink?.text.trim() ?? '';
      const abbr = (teamLink?.getAttribute('class') ?? '').replace('team-link', '').trim();
      rows.push({
        season,
        team,
        abbr,
        capSpace: parseMoney(tds[1]?.text ?? ''),
        activeCapSpending: parseMoney(tds[4]?.text ?? ''),
        deadMoney: parseMoney(tds[5]?.text ?? ''),
        baseCap,
        retrieved,
      });
    }
  }
  return rows;
}

/**
 * §16.2.5 shape-not-exact-equality validation. 2026 is a LIVE league year —
 * OTC revises these figures as teams transact (confirmed: the 49ers' 2026
 * dead money moved $36,515,240 → $36,520,240 between 2026-08-12 and
 * 2026-08-13, a one-day tick) — so an exact-match assertion against the
 * §15.6 reference values would false-alarm on legitimate drift. This checks
 * SHAPE: row counts, cap-relative magnitude, and that the five reference
 * teams sit within ~25% of their recorded figures AND preserve rank order.
 * A wild miss (order-of-magnitude, zeros, NaN, missing teams, broken rank
 * order) throws — the caller must STOP AND REPORT (§5.3), never substitute
 * hand-typed data.
 */
const REFERENCE_2026: readonly { abbr: string; deadMoney: number }[] = [
  { abbr: 'SF', deadMoney: 36_515_240 },
  { abbr: 'TEN', deadMoney: 28_449_565 },
  { abbr: 'WAS', deadMoney: 21_164_792 },
  { abbr: 'LAC', deadMoney: 5_596_511 },
  { abbr: 'DEN', deadMoney: 3_512_701 },
];
const REFERENCE_DRIFT_TOLERANCE = 0.25;

export function validateDeadMoneyShape(rows: readonly DeadMoneyRow[]): void {
  for (const season of [2026, 2027, 2028]) {
    const seasonRows = rows.filter((r) => r.season === season);
    if (seasonRows.length === 0) {
      throw new Error(`OTC dead-money parse: season ${season} missing entirely — STOP AND REPORT (§16.2.5).`);
    }
    if (seasonRows.length !== 32) {
      throw new Error(
        `OTC dead-money parse: season ${season} has ${seasonRows.length} team rows, expected 32 — STOP AND REPORT (§16.2.5).`,
      );
    }
  }
  for (const r of rows) {
    if (!Number.isFinite(r.baseCap) || r.baseCap <= 0) {
      throw new Error(
        `OTC dead-money parse: season ${r.season} base cap "${r.baseCap}" unparseable — STOP AND REPORT (§16.2.5).`,
      );
    }
    // Bound is CAP-RELATIVE, not a fixed dollar figure: a fixed ~$120M
    // ceiling (the first version of this check) rejected the Dolphins'
    // real, independently-verified 2026 figure — $179.2M, an NFL-record
    // 58% of their cap from a full veteran-purge rebuild — as a parse bug.
    // It wasn't one. 90% of the season's base cap is comfortably above that
    // record while still catching genuine garbage (NaN-derived huge numbers,
    // concatenated cells from a broken row).
    if (!Number.isFinite(r.deadMoney) || r.deadMoney < 0 || r.deadMoney > r.baseCap * 0.9) {
      throw new Error(
        `OTC dead-money parse: ${r.team} ${r.season} dead money "${r.deadMoney}" exceeds 90% of the base cap ` +
          `$${r.baseCap.toLocaleString()} — out of sane range, STOP AND REPORT (§16.2.5).`,
      );
    }
  }

  const row2026 = new Map(rows.filter((r) => r.season === 2026).map((r) => [r.abbr, r.deadMoney] as const));
  const observed = REFERENCE_2026.map((ref) => {
    const actual = row2026.get(ref.abbr);
    if (actual === undefined) {
      throw new Error(`OTC dead-money parse: reference team "${ref.abbr}" not found in 2026 rows — STOP AND REPORT (§16.2.5).`);
    }
    const pctOff = Math.abs(actual - ref.deadMoney) / ref.deadMoney;
    if (pctOff > REFERENCE_DRIFT_TOLERANCE) {
      throw new Error(
        `OTC dead-money parse: ${ref.abbr} read $${actual.toLocaleString()}, ${(pctOff * 100).toFixed(0)}% off the ` +
          `§15.6 reference $${ref.deadMoney.toLocaleString()} — beyond the ${(REFERENCE_DRIFT_TOLERANCE * 100).toFixed(0)}% modest-drift allowance. STOP AND REPORT (§16.2.5).`,
      );
    }
    return { ...ref, actual };
  });
  for (let i = 0; i < observed.length - 1; i++) {
    const a = observed[i]!;
    const b = observed[i + 1]!;
    if (a.actual < b.actual) {
      throw new Error(
        `OTC dead-money parse: reference rank order broken — ${a.abbr} ($${a.actual.toLocaleString()}) should exceed ` +
          `${b.abbr} ($${b.actual.toLocaleString()}) per §15.6. STOP AND REPORT (§16.2.5).`,
      );
    }
  }
}

/** Ensure the materialized OTC dead-money CSV exists locally (fetch-once,
 *  §15.7 — the cache IS the dataset of record for this ephemeral source). */
export async function ensureDeadMoneyCsv(): Promise<void> {
  if (await exists(DEAD_MONEY_CSV_PATH)) return;
  process.stdout.write('  fetching OTC salary-cap-space (dead money)…');
  const res = await fetch(DEAD_MONEY_URL);
  if (!res.ok) throw new Error(`salary-cap-space → HTTP ${res.status}`);
  const html = await res.text();
  const retrieved = new Date().toISOString().slice(0, 10);
  const rows = parseDeadMoneyHtml(html, retrieved);
  if (rows.length === 0) {
    throw new Error(
      'OTC salary-cap-space parse returned NO ROWS — the page shape may have changed ' +
        '(possibly JS-rendered now). STOP: do not substitute hand-typed reference data (§5.3).',
    );
  }
  validateDeadMoneyShape(rows);
  process.stdout.write(` ${rows.length} rows across ${new Set(rows.map((r) => r.season)).size} seasons\n`);

  const header = 'season,team,abbr,dead_money,cap_space,active_cap_spending,base_cap,retrieved';
  const lines = [header];
  for (const r of rows) {
    lines.push(
      [r.season, csvEscape(r.team), r.abbr, r.deadMoney, r.capSpace, r.activeCapSpending, r.baseCap, r.retrieved].join(','),
    );
  }
  await writeFile(DEAD_MONEY_CSV_PATH, lines.join('\n') + '\n', 'utf8');
  process.stdout.write(`  materialized otc_dead_money.csv\n`);
}
