import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from '../lib/config.js';
import { csvNum, csvRows } from '../lib/csv.js';
import { simulateTopOfDraft, type TopPickRecord } from '../lib/engine-bridge.js';

/**
 * The Goatinator — the TOP-OF-DRAFT realism authority (2026-06-11,
 * Daniel-directed). Named for the GOAT hunt: teams trade up to, or sit on,
 * premier draft slots looking for their franchise QB / EDGE / WR — the
 * top of round 1 is a different market from the rest of the draft, and a
 * league that fills #1 overall with guards doesn't feel like the NFL.
 *
 * Real bar (open nflverse data, both already cached for sibling agents):
 *   - draft_picks.csv (1980→present): WHO went in the top 10 and at
 *     #1/#2/#3 overall, by position, with era splits (the 2011 rookie
 *     wage scale changed top-pick economics — QB share at the top
 *     roughly doubled and RBs vanished).
 *   - nfldata trades.csv (2002→present): which top-10 slots the drafting
 *     team TRADED INTO (pick_season+round+number+receiving team joined to
 *     the draft record), split draft-window vs earlier acquisition, and
 *     what positions traded-into slots were spent on (QB/WR-heavy).
 *
 * GMSim side (engine bridge `simulateTopOfDraft`): forward-sim N seeds ×
 * Y seasons and harvest every top-10 draft record — position, whether the
 * slot was traded into (`originalTeamId !== teamId`), and whether an
 * in-draft trade-up fired for it (`tradeUpHistory`). Seed-parallel via
 * worker processes; per-seed results cached in data/goat/ (resumable).
 *
 *   pnpm --filter @gmsim/truth-arbiter run goatinator                # real bar only
 *   pnpm --filter @gmsim/truth-arbiter run goatinator sim 20 50     # + GMSim compare
 *   (internal)                        … goatinator worker <seed> <years>
 */

const DRAFT_PICKS_PATH = resolve(DATA_DIR, 'draft_picks.csv');
const TRADES_PATH = resolve(DATA_DIR, 'nfldata-trades.csv');
const GOAT_DIR = resolve(DATA_DIR, 'goat');

/** PFR team codes (draft_picks.csv) → nfldata trade-ledger codes. */
const PFR_TO_NFLDATA: Record<string, string> = {
  GNB: 'GB', KAN: 'KC', NWE: 'NE', NOR: 'NO', SFO: 'SF', TAM: 'TB',
  LVR: 'LV', SDG: 'SD', LAR: 'LA', RAM: 'LA', RAI: 'OAK', PHO: 'ARI',
};

/** Real (PFR) position labels → comparison groups. */
const REAL_GROUP: Record<string, string> = {
  QB: 'QB', RB: 'RB', FB: 'RB', WR: 'WR', TE: 'TE',
  T: 'OL', OT: 'OL', G: 'OL', OL: 'OL', C: 'OL',
  DE: 'EDGE', OLB: 'EDGE',
  DT: 'DL', NT: 'DL', DL: 'DL',
  LB: 'LB', ILB: 'LB', MLB: 'LB',
  CB: 'DB', S: 'DB', DB: 'DB', FS: 'DB', SS: 'DB',
  K: 'ST', P: 'ST',
};

/** GMSim engine positions → the same comparison groups. GMSim's OLB is the
 *  off-ball 3-4 backer (EDGE is its own position), so OLB maps to LB here
 *  while the real-side OLB (sack artist era) maps to EDGE. */
const SIM_GROUP: Record<string, string> = {
  QB: 'QB', RB: 'RB', FB: 'RB', WR: 'WR', TE: 'TE',
  LT: 'OL', RT: 'OL', LG: 'OL', RG: 'OL', C: 'OL',
  EDGE: 'EDGE', DT: 'DL', NT: 'DL',
  OLB: 'LB', ILB: 'LB',
  CB: 'DB', S: 'DB', NICKEL: 'DB',
  K: 'ST', P: 'ST', LS: 'ST',
};

const GROUP_ORDER = ['QB', 'EDGE', 'WR', 'OL', 'DB', 'DL', 'LB', 'RB', 'TE', 'ST'];

// ── Real side ────────────────────────────────────────────────────────────────

interface RealTopPick {
  season: number;
  pick: number;
  team: string;
  group: string;
  /** kept | draft-window | same-offseason | prior-year */
  acquisition: string;
}

interface PickTradeRow {
  tradeSeason: number;
  date: string;
  pickSeason: number;
  number: number;
  received: string;
}

async function loadRealTopPicks(maxPick: number): Promise<RealTopPick[]> {
  const picksCsv = await readFile(DRAFT_PICKS_PATH, 'utf8');
  const tradesCsv = await readFile(TRADES_PATH, 'utf8');

  const r1Trades: PickTradeRow[] = [];
  for (const row of csvRows(tradesCsv)) {
    const pickSeason = csvNum(row.get('pick_season'));
    const number = csvNum(row.get('pick_number'));
    if (pickSeason === null || number === null || csvNum(row.get('pick_round')) !== 1) continue;
    if (number > maxPick) continue;
    r1Trades.push({
      tradeSeason: csvNum(row.get('season')) ?? 0,
      date: row.get('trade_date') ?? '',
      pickSeason,
      number,
      received: row.get('received') ?? '',
    });
  }

  const out: RealTopPick[] = [];
  for (const row of csvRows(picksCsv)) {
    const season = csvNum(row.get('season'));
    const pick = csvNum(row.get('pick'));
    if (season === null || pick === null || pick < 1 || pick > maxPick) continue;
    const rawTeam = row.get('team') ?? '';
    const team = PFR_TO_NFLDATA[rawTeam] ?? rawTeam;
    const pos = (row.get('position') ?? '').toUpperCase();
    const hits = r1Trades
      .filter((t) => t.pickSeason === season && t.number === pick && t.received === team)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    let acquisition = 'kept';
    const last = hits[hits.length - 1];
    if (last) {
      const month = Number(last.date.slice(5, 7)) || 0;
      if (last.tradeSeason < season) acquisition = 'prior-year';
      else if (month === 4 || month === 5) acquisition = 'draft-window';
      else acquisition = 'same-offseason';
    }
    out.push({ season, pick, team, group: REAL_GROUP[pos] ?? 'OTHER', acquisition });
  }
  return out;
}

// ── Shared report helpers ────────────────────────────────────────────────────

function shares(groups: string[]): Map<string, number> {
  const c = new Map<string, number>();
  for (const g of groups) c.set(g, (c.get(g) ?? 0) + 1);
  return c;
}

function shareStr(groups: string[], order: readonly string[] = GROUP_ORDER): string {
  const c = shares(groups);
  const n = groups.length || 1;
  const known = order.filter((g) => c.has(g));
  const extra = [...c.keys()].filter((g) => !order.includes(g));
  return [...known, ...extra]
    .map((g) => `${g} ${((100 * c.get(g)!) / n).toFixed(0)}%(${c.get(g)})`)
    .join(' · ');
}

const pctOf = (n: number, d: number): string => (d ? `${((100 * n) / d).toFixed(0)}%` : '—');

function reportReal(picks: RealTopPick[]): void {
  console.log('\n=== THE GOATINATOR — real top-of-draft (nflverse, drafts 1980-2026) ===');
  console.log(`top-10 records: ${picks.length} · trade joins live 2002+ (nfldata)`);

  console.log('\n— top-10 position mix by era —');
  for (const [lo, hi] of [
    [1980, 2001],
    [2002, 2010],
    [2011, 2026],
  ] as const) {
    const set = picks.filter((p) => p.season >= lo && p.season <= hi);
    console.log(`  ${lo}-${hi} (n=${set.length}): ${shareStr(set.map((p) => p.group))}`);
  }

  console.log('\n— the GOAT slots: #1 / #2 / #3 overall —');
  for (const era of [
    [2002, 2026],
    [2011, 2026],
  ] as const) {
    for (const n of [1, 2, 3]) {
      const set = picks.filter((p) => p.pick === n && p.season >= era[0] && p.season <= era[1]);
      console.log(
        `  #${n} ${era[0]}-${era[1]}: ${shareStr(set.map((p) => p.group))}`,
      );
    }
  }

  const modern = picks.filter((p) => p.season >= 2002);
  const traded = modern.filter((p) => p.acquisition !== 'kept');
  console.log('\n— trade-ups into the top 10 (2002-2026) —');
  console.log(
    `  traded-into: ${traded.length}/${modern.length} (${pctOf(traded.length, modern.length)}) · timing: ${shareStr(
      traded.map((p) => p.acquisition),
      ['draft-window', 'same-offseason', 'prior-year'],
    )}`,
  );
  console.log(`  positions with traded-into slots: ${shareStr(traded.map((p) => p.group))}`);
  console.log(
    `  positions with kept slots:        ${shareStr(modern.filter((p) => p.acquisition === 'kept').map((p) => p.group))}`,
  );
  for (const [lo, hi] of [
    [2002, 2010],
    [2011, 2018],
    [2019, 2026],
  ] as const) {
    const s = modern.filter((p) => p.season >= lo && p.season <= hi);
    const t = s.filter((p) => p.acquisition !== 'kept');
    const dw = s.filter((p) => p.acquisition === 'draft-window');
    console.log(
      `  rate ${lo}-${hi}: traded-into ${pctOf(t.length, s.length)} · draft-window ${pctOf(dw.length, s.length)}`,
    );
  }
  for (const n of [1, 2, 3]) {
    const set = modern.filter((p) => p.pick === n);
    const t = set.filter((p) => p.acquisition !== 'kept');
    console.log(
      `  #${n}: traded-into ${t.length}/${set.length} — ${t.map((p) => `${p.season} ${p.group} (${p.acquisition})`).join(', ') || '—'}`,
    );
  }
}

// ── GMSim side (seed-parallel workers) ───────────────────────────────────────

interface SeedResult {
  seed: string;
  years: number;
  records: TopPickRecord[];
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function runWorkers(years: number, numSeeds: number): Promise<SeedResult[]> {
  await mkdir(GOAT_DIR, { recursive: true });
  const seeds = Array.from({ length: numSeeds }, (_, i) => `goat-${i + 1}`);
  const entry = fileURLToPath(import.meta.url);
  const pending = [];
  for (const seed of seeds) {
    const file = resolve(GOAT_DIR, `${seed}-${years}.json`);
    if (!(await exists(file))) pending.push({ seed, file });
  }
  const concurrency = Math.min(8, Math.max(1, cpus().length - 2));
  console.log(
    `\nGMSim: ${numSeeds} seeds × ${years} seasons (${pending.length} to simulate, ${concurrency} workers, cached in data/goat/)…`,
  );
  let started = 0;
  let done = 0;
  const startedAt = Date.now();
  const runOne = (seed: string): Promise<void> =>
    new Promise((res, rej) => {
      const child = spawn(process.execPath, [entry, 'worker', seed, String(years)], {
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      child.on('exit', (code) => {
        done++;
        const mins = (Date.now() - startedAt) / 60000;
        console.log(
          `  [${done}/${pending.length}] ${seed} done (${mins.toFixed(1)}m elapsed)`,
        );
        code === 0 ? res() : rej(new Error(`${seed} → exit ${code}`));
      });
    });
  const queue = [...pending];
  const lanes = Array.from({ length: concurrency }, async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      started++;
      await runOne(next.seed);
    }
  });
  await Promise.all(lanes);
  if (started === 0) console.log('  all seeds already cached');

  const results: SeedResult[] = [];
  for (const seed of seeds) {
    const file = resolve(GOAT_DIR, `${seed}-${years}.json`);
    results.push(JSON.parse(await readFile(file, 'utf8')) as SeedResult);
  }
  return results;
}

async function workerMain(seed: string, years: number): Promise<void> {
  const records = await simulateTopOfDraft(seed, years, 10);
  await mkdir(GOAT_DIR, { recursive: true });
  const file = resolve(GOAT_DIR, `${seed}-${years}.json`);
  await writeFile(file, JSON.stringify({ seed, years, records } satisfies SeedResult));
}

// ── Compare ──────────────────────────────────────────────────────────────────

function drift(simPct: number, lo: number, hi: number): string {
  return simPct < lo || simPct > hi ? '  <-- DRIFT' : '';
}

function reportCompare(real: RealTopPick[], results: SeedResult[]): void {
  const sim = results.flatMap((r) =>
    r.records.map((rec) => ({ ...rec, seed: r.seed, group: SIM_GROUP[rec.position] ?? rec.position })),
  );
  const seeds = results.length;
  const realModern = real.filter((p) => p.season >= 2011);
  const realTrade = real.filter((p) => p.season >= 2002);

  console.log(
    `\n=== GMSim vs real — ${seeds} seeds × ${results[0]?.years ?? 0} drafts (${sim.length} top-10 picks) ===`,
  );

  // Position mix vs the rookie-wage-scale era. Envelope: ±8pp around real.
  console.log('\n— top-10 position mix (real 2011-2026 vs GMSim) —');
  console.log(`  ${'pos'.padEnd(6)} ${'real'.padStart(6)} ${'gmsim'.padStart(7)} ${'Δpp'.padStart(7)}`);
  const realShares = shares(realModern.map((p) => p.group));
  const simShares = shares(sim.map((p) => p.group));
  for (const g of GROUP_ORDER) {
    const r = (100 * (realShares.get(g) ?? 0)) / (realModern.length || 1);
    const s = (100 * (simShares.get(g) ?? 0)) / (sim.length || 1);
    console.log(
      `  ${g.padEnd(6)} ${r.toFixed(0).padStart(5)}% ${s.toFixed(0).padStart(6)}% ${(s - r).toFixed(1).padStart(7)}${drift(s, r - 8, r + 8)}`,
    );
  }

  // The GOAT slots.
  console.log('\n— the GOAT slots —');
  for (const n of [1, 2, 3]) {
    const realSet = realModern.filter((p) => p.pick === n);
    const simSet = sim.filter((p) => p.overallPick === n);
    const realQb = pctShare(realSet.map((p) => p.group), 'QB');
    const simQb = pctShare(simSet.map((p) => p.group), 'QB');
    console.log(
      `  #${n} QB share: real ${realQb.toFixed(0)}% · gmsim ${simQb.toFixed(0)}%${drift(simQb, realQb - 20, realQb + 20)}`,
    );
    console.log(`     gmsim mix: ${shareStr(simSet.map((p) => p.group))}`);
  }
  const realTop3 = realModern.filter((p) => p.pick <= 3);
  const simTop3 = sim.filter((p) => p.overallPick <= 3);
  const realPrem = pctShare(realTop3.map((p) => p.group), 'QB', 'EDGE', 'WR');
  const simPrem = pctShare(simTop3.map((p) => p.group), 'QB', 'EDGE', 'WR');
  console.log(
    `  top-3 QB+EDGE+WR share: real ${realPrem.toFixed(0)}% · gmsim ${simPrem.toFixed(0)}%${drift(simPrem, realPrem - 15, realPrem + 15)}`,
  );

  // Trade-ups. Real "any acquisition" 2002+ ≈ 22% (era range 14-33%);
  // draft-window ≈ 16% — GMSim's in-draft trade-up is the analog.
  const realTraded = realTrade.filter((p) => p.acquisition !== 'kept');
  const realDw = realTrade.filter((p) => p.acquisition === 'draft-window');
  const simTraded = sim.filter((p) => p.tradedInto);
  const simInDraft = sim.filter((p) => p.inDraftTradeUp);
  const rTr = (100 * realTraded.length) / (realTrade.length || 1);
  const sTr = (100 * simTraded.length) / (sim.length || 1);
  const rDw = (100 * realDw.length) / (realTrade.length || 1);
  const sDw = (100 * simInDraft.length) / (sim.length || 1);
  console.log('\n— trade-ups into the top 10 —');
  console.log(
    `  any acquisition: real ${rTr.toFixed(0)}% · gmsim ${sTr.toFixed(0)}%${drift(sTr, 10, 40)}`,
  );
  console.log(
    `  draft-window/in-draft: real ${rDw.toFixed(0)}% · gmsim ${sDw.toFixed(0)}%${drift(sDw, 5, 27)}`,
  );
  if (simTraded.length > 0) {
    const realQbT = pctShare(realTraded.map((p) => p.group), 'QB');
    const simQbT = pctShare(simTraded.map((p) => p.group), 'QB');
    console.log(
      `  QB share of traded-into slots: real ${realQbT.toFixed(0)}% · gmsim ${simQbT.toFixed(0)}%${drift(simQbT, realQbT - 15, realQbT + 15)}`,
    );
    console.log(`  gmsim traded-into positions: ${shareStr(simTraded.map((p) => p.group))}`);
  }

  // Seed variance on the headline (top-10 QB share) — is the bar stable?
  const perSeedQb = results
    .map((r) => {
      const groups = r.records.map((rec) => SIM_GROUP[rec.position] ?? rec.position);
      return pctShare(groups, 'QB');
    })
    .sort((a, b) => a - b);
  if (perSeedQb.length >= 10) {
    const q = (p: number): number => perSeedQb[Math.min(perSeedQb.length - 1, Math.floor(p * perSeedQb.length))]!;
    console.log(
      `\n  per-seed top-10 QB share: p10 ${q(0.1).toFixed(0)}% · p50 ${q(0.5).toFixed(0)}% · p90 ${q(0.9).toFixed(0)}%`,
    );
  }
}

function pctShare(groups: string[], ...want: string[]): number {
  if (groups.length === 0) return 0;
  return (100 * groups.filter((g) => want.includes(g)).length) / groups.length;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === 'worker') {
    await workerMain(process.argv[3] ?? 'goat-1', Number(process.argv[4]) || 20);
    return;
  }
  const real = await loadRealTopPicks(10);
  reportReal(real);
  if (mode === 'sim') {
    const years = Number(process.argv[3]) || 20;
    const numSeeds = Number(process.argv[4]) || 50;
    const results = await runWorkers(years, numSeeds);
    reportCompare(real, results);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
