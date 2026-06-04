import { readFile, access } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { resolve } from 'node:path';
import { DATA_DIR } from '../lib/config.js';
import { splitCsvLine, csvNum } from '../lib/csv.js';
import {
  loadLeagueContracts,
  loadFreeAgentSignings,
  type LeagueContractRow,
  type FreeAgentSigningRow,
} from '../lib/engine-bridge.js';

/**
 * The Liquidator — the SALARY-CAP realism authority.
 *
 * Sibling to the Truth Arbiter (draft history), Skill Adjudicator (talent
 * tiers), and Magistrate (drive realism). The Liquidator ingests real NFL
 * contract data from OverTheCap (via the open nflverse mirror) and derives the
 * cap-structure benchmarks the league must respect — APY by position, how much
 * of the cap a top-of-market deal eats, guaranteed %, contract length — then
 * compares GMSim's generated contracts against them.
 *
 * The signal it exists to surface: GMSim's seed contracts are tier-based but
 * POSITION-AGNOSTIC, while the real cap is wildly position-dependent (an elite
 * QB eats ~24% of the cap; an elite RB ~7%). The Liquidator quantifies that gap.
 *
 *   pnpm --filter @gmsim/truth-arbiter run liquidator [seed]
 */

const CONTRACTS_URL =
  'https://github.com/nflverse/nflverse-data/releases/download/contracts/historical_contracts.csv.gz';
const GZ_PATH = resolve(DATA_DIR, 'historical_contracts.csv.gz');
const CSV_PATH = resolve(DATA_DIR, 'historical_contracts.csv');

/** Only contracts signed in this year or later count toward "current market". */
const MARKET_SINCE = 2021;

/** GMSim position → OTC position bucket. */
const OTC_BUCKET: Record<string, string> = {
  QB: 'QB', RB: 'RB', FB: 'FB', WR: 'WR', TE: 'TE',
  LT: 'LT', RT: 'RT', LG: 'LG', RG: 'RG', C: 'C',
  EDGE: 'ED', DT: 'IDL', NT: 'IDL',
  OLB: 'LB', ILB: 'LB',
  CB: 'CB', NICKEL: 'CB', S: 'S',
  K: 'K', P: 'P', LS: 'LS',
};

/** Display order for the report. */
const POS_ORDER = ['QB', 'ED', 'WR', 'CB', 'LT', 'IDL', 'S', 'RT', 'TE', 'LG', 'RG', 'C', 'LB', 'RB', 'K', 'P', 'LS', 'FB'];

interface RealRow {
  position: string;
  apyCapPct: number;
  guaranteedPct: number;
  years: number;
  /** Raw total contract value ($) — kept for value-weighted aggregates. */
  value: number;
  /** Raw guaranteed money ($) — kept for value-weighted aggregates. */
  guaranteed: number;
}

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

async function ensureCorpus(): Promise<void> {
  if (await exists(CSV_PATH)) return;
  if (!(await exists(GZ_PATH))) {
    process.stdout.write('  fetching OTC contracts (nflverse mirror)…');
    const res = await fetch(CONTRACTS_URL);
    if (!res.ok) throw new Error(`contracts → HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await (await import('node:fs/promises')).writeFile(GZ_PATH, buf);
    process.stdout.write(` ${(buf.length / 1e6).toFixed(1)}MB\n`);
  }
  await pipeline(createReadStream(GZ_PATH), createGunzip(), createWriteStream(CSV_PATH));
}

/**
 * Veteran-FA proxy: a contract signed ≥4 seasons after the player was drafted
 * is a post-rookie-scale open-market deal — the closest real-data analog to
 * GMSim's free-agency signings (which only ever sign veterans off the street).
 * Rookie-scale contracts (signed in/near the draft year) are excluded so we
 * compare market deals to market deals.
 */
const VETERAN_FA_MIN_YEARS_SINCE_DRAFT = 4;

async function loadReal(veteranFaOnly = false): Promise<RealRow[]> {
  await ensureCorpus();
  const csv = await readFile(CSV_PATH, 'utf8');
  const nl = csv.indexOf('\n');
  const header = splitCsvLine(csv.slice(0, nl));
  const col = (n: string): number => header.indexOf(n);
  const iPos = col('position');
  const iYears = col('years');
  const iValue = col('value');
  const iApyPct = col('apy_cap_pct');
  const iGtd = col('guaranteed');
  const iSigned = col('year_signed');
  const iDraftYear = col('draft_year');

  const rows: RealRow[] = [];
  let from = nl + 1;
  while (from < csv.length) {
    let to = csv.indexOf('\n', from);
    if (to === -1) to = csv.length;
    const line = csv.slice(from, to);
    from = to + 1;
    if (!line) continue;
    const f = splitCsvLine(line);
    const signed = csvNum(f[iSigned]);
    const apyPct = csvNum(f[iApyPct]);
    const value = csvNum(f[iValue]) ?? 0;
    if (signed === null || signed < MARKET_SINCE || apyPct === null || apyPct <= 0) continue;
    if (veteranFaOnly) {
      const draftYear = csvNum(f[iDraftYear]);
      if (draftYear === null || signed - draftYear < VETERAN_FA_MIN_YEARS_SINCE_DRAFT) continue;
    }
    const gtd = csvNum(f[iGtd]) ?? 0;
    rows.push({
      position: f[iPos] ?? '',
      apyCapPct: apyPct,
      guaranteedPct: value > 0 ? gtd / value : 0,
      years: csvNum(f[iYears]) ?? 0,
      value,
      guaranteed: gtd,
    });
  }
  return rows;
}

function pct(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.floor(q * s.length));
  return s[i]!;
}

/** Mean of the top `n` values — the elite top-of-market. Robust to pool size
 *  (p95 understates positions like QB where ~10 franchise deals sit far above a
 *  cliff of backup/bridge deals). */
function topMean(values: number[], n: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => b - a).slice(0, Math.min(n, values.length));
  return s.reduce((a, b) => a + b, 0) / s.length;
}

interface Bench {
  n: number;
  top: number; // mean of top-3 APY cap % — elite top-of-market
  median: number; // p50
  gtdMedian: number;
  yearsMedian: number;
}

function bench(rows: { apyCapPct: number; guaranteedPct: number; years: number }[]): Bench {
  return {
    n: rows.length,
    top: topMean(rows.map((r) => r.apyCapPct), 3),
    median: pct(rows.map((r) => r.apyCapPct), 0.5),
    gtdMedian: pct(rows.map((r) => r.guaranteedPct), 0.5),
    yearsMedian: pct(rows.map((r) => r.years), 0.5),
  };
}

async function reportSeeds(seed: string): Promise<void> {
  console.log(`\nThe Liquidator — SEED cap-structure realism (real market: contracts signed ${MARKET_SINCE}+)`);

  const real = await loadReal();
  const realByPos = new Map<string, RealRow[]>();
  for (const r of real) {
    const arr = realByPos.get(r.position) ?? realByPos.set(r.position, []).get(r.position)!;
    arr.push(r);
  }
  console.log(`  real contracts: ${real.length.toLocaleString()} across ${realByPos.size} positions\n`);

  // GMSim seeds, bucketed into OTC position groups.
  const sim = await loadLeagueContracts(seed);
  const simByPos = new Map<string, LeagueContractRow[]>();
  for (const r of sim) {
    const bucket = OTC_BUCKET[r.position];
    if (!bucket) continue;
    const arr = simByPos.get(bucket) ?? simByPos.set(bucket, []).get(bucket)!;
    arr.push(r);
  }

  console.log('=== Elite top-of-market APY as % of cap (mean of top 3) — real vs GMSim seeds ===');
  console.log(`  ${'pos'.padEnd(5)} ${'real top'.padStart(9)} ${'sim top'.padStart(9)} ${'Δpp'.padStart(7)}   ${'real med'.padStart(9)} ${'sim med'.padStart(9)}`);
  for (const pos of POS_ORDER) {
    const r = realByPos.get(pos);
    const s = simByPos.get(pos);
    if (!r) continue;
    const rb = bench(r);
    const sb = s ? bench(s) : null;
    const realTop = (rb.top * 100).toFixed(1);
    const simTop = sb ? (sb.top * 100).toFixed(1) : '—';
    const d = sb ? ((sb.top - rb.top) * 100).toFixed(1) : '—';
    const flag = sb && Math.abs(sb.top - rb.top) > 0.03 ? '  <-- DRIFT' : '';
    const realMed = (rb.median * 100).toFixed(1);
    const simMed = sb ? (sb.median * 100).toFixed(1) : '—';
    console.log(`  ${pos.padEnd(5)} ${(realTop + '%').padStart(9)} ${(simTop + '%').padStart(9)} ${d.padStart(7)}   ${(realMed + '%').padStart(9)} ${(simMed + '%').padStart(9)}${flag}`);
  }

  // Headline: positional spread. Real QB top should DWARF RB top; if GMSim's
  // QB and RB tops are similar, the position-agnostic templates are the cause.
  const realQb = bench(realByPos.get('QB') ?? []);
  const realRb = bench(realByPos.get('RB') ?? []);
  const simQb = simByPos.get('QB') ? bench(simByPos.get('QB')!) : null;
  const simRb = simByPos.get('RB') ? bench(simByPos.get('RB')!) : null;
  console.log('\n=== Positional spread (the position-agnostic tell) ===');
  console.log(`  real  QB top ${(realQb.top * 100).toFixed(1)}%  vs RB top ${(realRb.top * 100).toFixed(1)}%  → QB/RB ratio ${(realQb.top / realRb.top).toFixed(2)}x`);
  if (simQb && simRb) {
    console.log(`  GMSim QB top ${(simQb.top * 100).toFixed(1)}%  vs RB top ${(simRb.top * 100).toFixed(1)}%  → QB/RB ratio ${(simQb.top / simRb.top).toFixed(2)}x`);
  }
  console.log('');
}

/** Seasons to forward-sim when sampling GMSim's FA market. */
const FA_SAMPLE_SEASONS = 6;

/**
 * Slice 2 — FA-signing realism. Forward-sims a GMSim league, pools every
 * offseason-auction free-agent signing, and compares the resulting cap
 * structure (APY % of cap by position) to the real veteran-FA market. The
 * signal: GMSim's FA deals are tier-anchored but POSITION-AGNOSTIC
 * (`FA_DEAL_BY_TIER` / `TIER_STANDARD_Y1`), so — like the seed contracts —
 * a premium-position FA and a commodity-position FA at the same tier sign
 * for the same money, while the real market pays a QB ~5× an RB.
 */
async function reportFreeAgency(seed: string): Promise<void> {
  console.log(
    `\nThe Liquidator — FREE-AGENCY cap-structure realism (real veteran-FA: signed ${MARKET_SINCE}+, ≥${VETERAN_FA_MIN_YEARS_SINCE_DRAFT}yr post-draft)`,
  );

  const real = await loadReal(true);
  const realByPos = new Map<string, RealRow[]>();
  for (const r of real) {
    const arr = realByPos.get(r.position) ?? realByPos.set(r.position, []).get(r.position)!;
    arr.push(r);
  }
  console.log(`  real veteran-FA deals: ${real.length.toLocaleString()} across ${realByPos.size} positions`);

  const signings = await loadFreeAgentSignings(seed, FA_SAMPLE_SEASONS);
  // Offseason-auction (market) deals only — the comparable signal. Mid-season
  // vet-min street signings are roster-fill noise, not a market valuation.
  const market = signings.filter((s) => s.marketContract);
  const simByPos = new Map<string, FreeAgentSigningRow[]>();
  for (const s of market) {
    const bucket = OTC_BUCKET[s.position];
    if (!bucket) continue;
    const arr = simByPos.get(bucket) ?? simByPos.set(bucket, []).get(bucket)!;
    arr.push(s);
  }
  console.log(
    `  GMSim FA signings over ${FA_SAMPLE_SEASONS} seasons (seed "${seed}"): ${signings.length} total, ${market.length} offseason-market\n`,
  );

  console.log('=== FA top-of-market APY as % of cap (mean of top 3) — real vs GMSim signings ===');
  console.log(`  ${'pos'.padEnd(5)} ${'real top'.padStart(9)} ${'sim top'.padStart(9)} ${'Δpp'.padStart(7)}   ${'real med'.padStart(9)} ${'sim med'.padStart(9)} ${'n'.padStart(5)}`);
  for (const pos of POS_ORDER) {
    const r = realByPos.get(pos);
    const s = simByPos.get(pos);
    if (!r) continue;
    const rb = bench(r);
    const sb = s ? bench(s) : null;
    const realTop = (rb.top * 100).toFixed(1);
    const simTop = sb ? (sb.top * 100).toFixed(1) : '—';
    const d = sb ? ((sb.top - rb.top) * 100).toFixed(1) : '—';
    const flag = sb && Math.abs(sb.top - rb.top) > 0.03 ? '  <-- DRIFT' : '';
    const realMed = (rb.median * 100).toFixed(1);
    const simMed = sb ? (sb.median * 100).toFixed(1) : '—';
    const simN = sb ? String(sb.n) : '—';
    console.log(`  ${pos.padEnd(5)} ${(realTop + '%').padStart(9)} ${(simTop + '%').padStart(9)} ${d.padStart(7)}   ${(realMed + '%').padStart(9)} ${(simMed + '%').padStart(9)} ${simN.padStart(5)}${flag}`);
  }

  const realQb = bench(realByPos.get('QB') ?? []);
  const realRb = bench(realByPos.get('RB') ?? []);
  const simQb = simByPos.get('QB') ? bench(simByPos.get('QB')!) : null;
  const simRb = simByPos.get('RB') ? bench(simByPos.get('RB')!) : null;
  console.log('\n=== FA positional spread (the position-agnostic tell) ===');
  console.log(`  real  QB top ${(realQb.top * 100).toFixed(1)}%  vs RB top ${(realRb.top * 100).toFixed(1)}%  → QB/RB ratio ${(realQb.top / realRb.top).toFixed(2)}x`);
  if (simQb && simRb) {
    console.log(`  GMSim QB top ${(simQb.top * 100).toFixed(1)}%  vs RB top ${(simRb.top * 100).toFixed(1)}%  → QB/RB ratio ${(simQb.top / simRb.top).toFixed(2)}x`);
  } else {
    console.log('  GMSim QB/RB: insufficient market-FA samples at one of the positions');
  }
  console.log('');
}

/**
 * Slice 3 — guaranteed-money realism (the dead-money / cap-out driver).
 *
 * Why guaranteed money is the trade slice: the real OTC corpus has no trade
 * events, so trade OUTCOMES can't be benchmarked directly. But the thing that
 * makes a trade or release expensive — dead money — is driven by GUARANTEED
 * money (guaranteed base becomes dead money the moment a player is moved, on
 * top of accelerated signing-bonus proration). Real guaranteed % is steeply
 * position- AND tier-dependent (an elite QB locks in ~70-100% guaranteed; a
 * RB far less). If GMSim's guarantees are flat, every position is equally
 * (un)tradeable and cap-out behaves nothing like the NFL. This report
 * quantifies that gap from the OTC `guaranteed` / `value` columns.
 */
async function reportGuarantees(seed: string): Promise<void> {
  console.log(
    `\nThe Liquidator — GUARANTEED-MONEY realism (dead-money / cap-out driver; real market: signed ${MARKET_SINCE}+)`,
  );

  const real = await loadReal();
  const realByPos = new Map<string, RealRow[]>();
  for (const r of real) {
    const arr = realByPos.get(r.position) ?? realByPos.set(r.position, []).get(r.position)!;
    arr.push(r);
  }
  console.log(`  real contracts: ${real.length.toLocaleString()} across ${realByPos.size} positions\n`);

  const sim = await loadLeagueContracts(seed);
  const simByPos = new Map<string, LeagueContractRow[]>();
  for (const r of sim) {
    const bucket = OTC_BUCKET[r.position];
    if (!bucket) continue;
    const arr = simByPos.get(bucket) ?? simByPos.set(bucket, []).get(bucket)!;
    arr.push(r);
  }

  // Value-weighted guaranteed % = Σ guaranteed ÷ Σ value across a position.
  // This is the right lens for dead-money exposure: it weights toward the big
  // multi-year deals (where cap-out actually happens) and de-emphasizes the
  // mass of $0-guaranteed minimum/tender deals that swamp the raw median.
  const realVwGtd = (rows: RealRow[]): number => {
    let g = 0, v = 0;
    for (const r of rows) { g += r.guaranteed; v += r.value; }
    return v > 0 ? g / v : 0;
  };
  const simVwGtd = (rows: LeagueContractRow[]): number => {
    let g = 0, v = 0;
    for (const r of rows) {
      const value = r.apy * r.years;
      g += r.guaranteedPct * value;
      v += value;
    }
    return v > 0 ? g / v : 0;
  };

  console.log('=== Value-weighted guaranteed money as % of contract value — real vs GMSim seeds ===');
  console.log(`  (median in parens — real median ~0% across the board: most of a real roster is on $0-gtd minimums)`);
  console.log(`  ${'pos'.padEnd(5)} ${'real gtd'.padStart(9)} ${'sim gtd'.padStart(9)} ${'Δpp'.padStart(7)}   ${'real med'.padStart(9)} ${'sim med'.padStart(9)} ${'n'.padStart(5)}`);
  for (const pos of POS_ORDER) {
    const r = realByPos.get(pos);
    const s = simByPos.get(pos);
    if (!r) continue;
    const realGtd = realVwGtd(r);
    const simGtd = s ? simVwGtd(s) : null;
    const realMed = bench(r).gtdMedian;
    const simMed = s ? bench(s).gtdMedian : null;
    const d = simGtd !== null ? ((simGtd - realGtd) * 100).toFixed(0) : '—';
    const flag = simGtd !== null && Math.abs(simGtd - realGtd) > 0.15 ? '  <-- DRIFT' : '';
    const simN = s ? String(s.length) : '—';
    console.log(
      `  ${pos.padEnd(5)} ${((realGtd * 100).toFixed(0) + '%').padStart(9)} ${(simGtd !== null ? (simGtd * 100).toFixed(0) + '%' : '—').padStart(9)} ${d.padStart(7)}   ${((realMed * 100).toFixed(0) + '%').padStart(9)} ${(simMed !== null ? (simMed * 100).toFixed(0) + '%' : '—').padStart(9)} ${simN.padStart(5)}${flag}`,
    );
  }

  // Headline: the QB-vs-RB guaranteed spread. Real QBs lock in far more
  // guaranteed money than RBs; if GMSim's are equal, guarantees are flat.
  const realQbR = realByPos.get('QB') ?? [];
  const realRbR = realByPos.get('RB') ?? [];
  const simQbR = simByPos.get('QB');
  const simRbR = simByPos.get('RB');
  console.log('\n=== Guaranteed-money spread (the flat-guarantee tell) ===');
  console.log(`  real  QB gtd ${(realVwGtd(realQbR) * 100).toFixed(0)}%  vs RB gtd ${(realVwGtd(realRbR) * 100).toFixed(0)}%  → QB-RB gap ${((realVwGtd(realQbR) - realVwGtd(realRbR)) * 100).toFixed(0)}pp`);
  if (simQbR && simRbR) {
    console.log(`  GMSim QB gtd ${(simVwGtd(simQbR) * 100).toFixed(0)}%  vs RB gtd ${(simVwGtd(simRbR) * 100).toFixed(0)}%  → QB-RB gap ${((simVwGtd(simQbR) - simVwGtd(simRbR)) * 100).toFixed(0)}pp`);
  }
  console.log('');
}

/**
 * Slice 3b — guaranteed-money realism on the FREE-AGENT market. Same lens as
 * `reportGuarantees`, but over offseason-auction FA signings vs the real
 * veteran-FA market. Validates that the position-aware guarantee split now
 * applies to FA deals (`makeFreeAgentContract`), not just seed contracts.
 */
async function reportFaGuarantees(seed: string): Promise<void> {
  console.log(
    `\nThe Liquidator — FA GUARANTEED-MONEY realism (real veteran-FA: signed ${MARKET_SINCE}+, ≥${VETERAN_FA_MIN_YEARS_SINCE_DRAFT}yr post-draft)`,
  );

  const real = await loadReal(true);
  const realByPos = new Map<string, RealRow[]>();
  for (const r of real) {
    const arr = realByPos.get(r.position) ?? realByPos.set(r.position, []).get(r.position)!;
    arr.push(r);
  }
  console.log(`  real veteran-FA deals: ${real.length.toLocaleString()} across ${realByPos.size} positions`);

  const signings = await loadFreeAgentSignings(seed, FA_SAMPLE_SEASONS);
  const market = signings.filter((s) => s.marketContract);
  const simByPos = new Map<string, FreeAgentSigningRow[]>();
  for (const s of market) {
    const bucket = OTC_BUCKET[s.position];
    if (!bucket) continue;
    const arr = simByPos.get(bucket) ?? simByPos.set(bucket, []).get(bucket)!;
    arr.push(s);
  }
  console.log(
    `  GMSim FA signings over ${FA_SAMPLE_SEASONS} seasons (seed "${seed}"): ${market.length} offseason-market\n`,
  );

  const realVwGtd = (rows: RealRow[]): number => {
    let g = 0, v = 0;
    for (const r of rows) { g += r.guaranteed; v += r.value; }
    return v > 0 ? g / v : 0;
  };
  const simVwGtd = (rows: FreeAgentSigningRow[]): number => {
    let g = 0, v = 0;
    for (const r of rows) {
      const value = r.apy * r.years;
      g += r.guaranteedPct * value;
      v += value;
    }
    return v > 0 ? g / v : 0;
  };

  console.log('=== Value-weighted guaranteed money as % of value — real vs GMSim FA signings ===');
  console.log(`  ${'pos'.padEnd(5)} ${'real gtd'.padStart(9)} ${'sim gtd'.padStart(9)} ${'Δpp'.padStart(7)}   ${'n'.padStart(5)}`);
  for (const pos of POS_ORDER) {
    const r = realByPos.get(pos);
    const s = simByPos.get(pos);
    if (!r) continue;
    const realGtd = realVwGtd(r);
    const simGtd = s ? simVwGtd(s) : null;
    const d = simGtd !== null ? ((simGtd - realGtd) * 100).toFixed(0) : '—';
    const flag = simGtd !== null && Math.abs(simGtd - realGtd) > 0.15 ? '  <-- DRIFT' : '';
    const simN = s ? String(s.length) : '—';
    console.log(
      `  ${pos.padEnd(5)} ${((realGtd * 100).toFixed(0) + '%').padStart(9)} ${(simGtd !== null ? (simGtd * 100).toFixed(0) + '%' : '—').padStart(9)} ${d.padStart(7)}   ${simN.padStart(5)}${flag}`,
    );
  }

  const realQbR = realByPos.get('QB') ?? [];
  const realRbR = realByPos.get('RB') ?? [];
  const simQbR = simByPos.get('QB');
  const simRbR = simByPos.get('RB');
  console.log('\n=== FA guaranteed-money spread (the flat-guarantee tell) ===');
  console.log(`  real  QB gtd ${(realVwGtd(realQbR) * 100).toFixed(0)}%  vs RB gtd ${(realVwGtd(realRbR) * 100).toFixed(0)}%  → QB-RB gap ${((realVwGtd(realQbR) - realVwGtd(realRbR)) * 100).toFixed(0)}pp`);
  if (simQbR && simRbR) {
    console.log(`  GMSim QB gtd ${(simVwGtd(simQbR) * 100).toFixed(0)}%  vs RB gtd ${(simVwGtd(simRbR) * 100).toFixed(0)}%  → QB-RB gap ${((simVwGtd(simQbR) - simVwGtd(simRbR)) * 100).toFixed(0)}pp`);
  } else {
    console.log('  GMSim QB/RB: insufficient market-FA samples at one of the positions');
  }
  console.log('');
}

async function main(): Promise<void> {
  // `run liquidator [seed]`        → seed cap-structure report (Slice 1)
  // `run liquidator fa [seed]`     → free-agency cap-structure report (Slice 2)
  // `run liquidator gtd [seed]`    → seed guaranteed-money realism (Slice 3)
  // `run liquidator gtd fa [seed]` → FA-signing guaranteed-money realism (Slice 3b)
  const mode = process.argv[2];
  if (mode === 'fa') {
    await reportFreeAgency(process.argv[3] ?? 'liquidator');
  } else if (mode === 'gtd') {
    if (process.argv[3] === 'fa') {
      await reportFaGuarantees(process.argv[4] ?? 'liquidator');
    } else {
      await reportGuarantees(process.argv[3] ?? 'liquidator');
    }
  } else {
    await reportSeeds(mode ?? 'liquidator');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
