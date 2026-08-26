import { readFile } from 'node:fs/promises';
import { splitCsvLine, csvNum, csvRows } from '../lib/csv.js';
import {
  ensureContractsCsv,
  CONTRACTS_CSV_PATH,
  OTC_BUCKET,
  ensureDeadMoneyCsv,
  DEAD_MONEY_CSV_PATH,
} from '../lib/otc.js';
import {
  loadLeagueContracts,
  loadFreeAgentSignings,
  loadDeadMoneySample,
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

/** Only contracts signed in this year or later count toward "current market". */
const MARKET_SINCE = 2021;

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

/**
 * Veteran-FA proxy: a contract signed ≥4 seasons after the player was drafted
 * is a post-rookie-scale open-market deal — the closest real-data analog to
 * GMSim's free-agency signings (which only ever sign veterans off the street).
 * Rookie-scale contracts (signed in/near the draft year) are excluded so we
 * compare market deals to market deals.
 */
const VETERAN_FA_MIN_YEARS_SINCE_DRAFT = 4;

async function loadReal(veteranFaOnly = false): Promise<RealRow[]> {
  await ensureContractsCsv();
  const csv = await readFile(CONTRACTS_CSV_PATH, 'utf8');
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

/**
 * Slice 4 — the dead-money bar (P1.3, `LIQUIDATOR_DEAD_MONEY.md` §16).
 *
 * "Is our cap too forgiving?" GMSim's dead money as % of the league cap,
 * measured against real OTC 2026 figures. Unlike Slices 1-3, this compares
 * an AGGREGATE league statistic, not a per-position benchmark — so it reads
 * a materialized CSV (§15/§16 sourcing ruling) rather than the OTC contract
 * corpus, and it forward-sims fresh every run rather than reading a cached
 * seed (§16.3 — the sim side must never go stale silently after an engine
 * change the way a cached real-world figure correctly can).
 */

/** Population stdev — the 32 real 2026 teams are treated as a full
 *  cross-section, not a sample of a larger population. */
function sd(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
}

interface Real2026DeadMoney {
  shares: number[]; // dead money as % of the league base cap, one per team
  named: { team: string; sharePct: number }[]; // same shares, with team labels for outlier reporting
  baseCap: number;
  retrieved: string;
}

/** Read the cached OTC dead-money CSV, filter to the 2026 rows (§15.2 — use
 *  2026 only, never pool 2027/2028), and express each team's dead money as
 *  a % of the season's published base cap (§15.3 — same denominator on both
 *  sides, never each team's own adjusted cap). */
async function loadReal2026DeadMoney(): Promise<Real2026DeadMoney> {
  await ensureDeadMoneyCsv();
  const csv = await readFile(DEAD_MONEY_CSV_PATH, 'utf8');
  const deadMoneys: number[] = [];
  const named: { team: string; deadMoney: number }[] = [];
  const baseCaps = new Set<number>();
  let retrieved = '';
  for (const rec of csvRows(csv)) {
    if (csvNum(rec.get('season')) !== 2026) continue;
    const dm = csvNum(rec.get('dead_money')) ?? 0;
    deadMoneys.push(dm);
    named.push({ team: rec.get('team') ?? '?', deadMoney: dm });
    baseCaps.add(csvNum(rec.get('base_cap')) ?? 0);
    retrieved = rec.get('retrieved') ?? retrieved;
  }
  if (deadMoneys.length === 0) {
    throw new Error('No 2026 rows in otc_dead_money.csv — delete the file to re-fetch, or investigate the parse.');
  }
  if (baseCaps.size !== 1) {
    throw new Error(
      `otc_dead_money.csv: 2026 rows carry ${baseCaps.size} different base_cap values (expected 1, same season) — ` +
        'the season/container association in the parser is likely broken.',
    );
  }
  const baseCap = [...baseCaps][0]!;
  return {
    shares: deadMoneys.map((d) => (d / baseCap) * 100),
    named: named.map((n) => ({ team: n.team, sharePct: (n.deadMoney / baseCap) * 100 })),
    baseCap,
    retrieved,
  };
}

/** Default sim sample: 6 seeds × 10 seasons — DERIVED, not chosen, from the
 *  measured per-seed sd of 0.266pp (P3.1 crash census, 2026-08-13): n=1
 *  gives ±0.52pp, too coarse for §15.5's 5.5%/6.5% decision thresholds
 *  (only 0.6pp apart); n=6 gives ±0.21pp. Deliberately breaks from the
 *  other modes' single-seed idiom for this stated reason (§16.3). */
const DEAD_MONEY_DEFAULT_SEEDS = 6;
const DEAD_MONEY_DEFAULT_YEARS = 10;

/** P3.1 crash-census reference: 60 seeds × 10 seasons, 19,200 team-seasons,
 *  `_crash_census_census_60x10.json`. The L7 self-check target — if this
 *  run's walk doesn't reproduce it, the walk (or the engine) moved. */
const CENSUS_REFERENCE_MEAN_PCT = 4.9;
const L7_TOLERANCE_PP = 0.25;

async function reportDeadMoney(seedCount: number, years: number): Promise<void> {
  console.log(`\nThe Liquidator — DEAD-MONEY BAR ("is our cap too forgiving?", real vs GMSim)`);
  console.log(`  real side = OTC 2026 season only (current league year), n=32 teams, single season;`);
  console.log(`  completed seasons are not exposed by the source; this is a current-year`);
  console.log(`  settled-ish figure, not a multi-year average. (LIQUIDATOR_DEAD_MONEY.md §15)`);

  const real = await loadReal2026DeadMoney();
  const realMean = real.shares.reduce((a, b) => a + b, 0) / real.shares.length;
  const realSd = sd(real.shares);
  const realMedian = pct(real.shares, 0.5);
  const realP75 = pct(real.shares, 0.75);
  const realP90 = pct(real.shares, 0.9);
  const realMax = pct(real.shares, 1);
  console.log(`  real: OTC retrieved ${real.retrieved}, base cap $${real.baseCap.toLocaleString()}, n=${real.shares.length} teams\n`);

  // Outlier-robustness check on the real side. 2026 is a single-season
  // sample (§15.4 R3) — if one team's charge is doing most of the work on
  // L1″'s verdict, that has to be visible, not buried in a mean.
  const namedSorted = [...real.named].sort((a, b) => b.sharePct - a.sharePct);
  console.log('  real-side top-3 outliers (context for L1″ — a single season, n=32):');
  for (const t of namedSorted.slice(0, 3)) {
    console.log(`    ${t.team.padEnd(14)} ${t.sharePct.toFixed(1)}% of cap`);
  }
  const withoutTop1 = real.shares.filter((_, i) => real.named[i]!.team !== namedSorted[0]!.team);
  const meanWithoutTop1 = withoutTop1.reduce((a, b) => a + b, 0) / withoutTop1.length;
  console.log(
    `  real mean EXCLUDING the single largest outlier (${namedSorted[0]!.team}): ` +
      `${meanWithoutTop1.toFixed(2)}% (vs ${realMean.toFixed(2)}% with it — ` +
      `median is outlier-resistant by construction and needs no such check)\n`,
  );

  console.log(`  simulating ${seedCount} seeds x ${years} seasons (RECOMPUTED, never cached — §16.3)…`);
  const sample = await loadDeadMoneySample(seedCount, years);
  const simShares = sample.teamSeasons.map((t) => (t.salaryCap > 0 ? (t.deadMoney / t.salaryCap) * 100 : 0));
  const simMean = simShares.reduce((a, b) => a + b, 0) / simShares.length;
  const simMedian = pct(simShares, 0.5);
  const simP75 = pct(simShares, 0.75);
  const simP90 = pct(simShares, 0.9);
  const simMax = pct(simShares, 1);
  console.log(`  sim: ${sample.teamSeasons.length.toLocaleString()} team-seasons\n`);

  // L7 self-check FIRST — everything downstream is meaningless if this fails.
  const l7Gap = Math.abs(simMean - CENSUS_REFERENCE_MEAN_PCT);
  const l7Pass = l7Gap <= L7_TOLERANCE_PP;
  console.log('=== L7 SELF-CHECK (run before trusting anything below) ===');
  console.log(`  this walk's GMSim mean : ${simMean.toFixed(2)}%`);
  console.log(`  P3.1 census reference  : ${CENSUS_REFERENCE_MEAN_PCT.toFixed(2)}%  (n=60 seeds x 10 seasons)`);
  console.log(`  gap                    : ${l7Gap.toFixed(3)}pp  (tolerance ±${L7_TOLERANCE_PP}pp)`);
  console.log(
    l7Pass
      ? '  L7: PASS\n'
      : '  L7: *** FAIL *** — this walk may be wrong, or the engine moved since 2026-08-13.\n' +
          '       Diagnose before trusting anything below; the numbers still print for that purpose.\n',
  );

  // (a) Aggregate
  const ciHalfWidth = (realSd / Math.sqrt(real.shares.length)) * 1.96;
  const gap = simMean - realMean;
  const drift = Math.abs(gap) > ciHalfWidth;
  console.log('=== (a) Aggregate: league dead money as % of cap ===');
  console.log(`  real mean  : ${realMean.toFixed(2)}%   (cross-team sd ${realSd.toFixed(2)}pp, 95% CI half-width ${ciHalfWidth.toFixed(2)}pp — the derived band)`);
  console.log(`  GMSim mean : ${simMean.toFixed(2)}%`);
  console.log(
    `  raw gap    : ${gap >= 0 ? '+' : ''}${gap.toFixed(2)}pp` +
      (drift ? '  <-- DRIFT (exceeds real mean’s 95% CI)' : '  (within real mean’s 95% CI, not flagged)') +
      '\n',
  );

  // (b) Distribution
  console.log('=== (b) Distribution: per-team dead money as % of cap ===');
  console.log(`  ${'stat'.padEnd(6)} ${'real'.padStart(8)} ${'GMSim'.padStart(8)}`);
  const distRow = (label: string, r: number, g: number): void =>
    console.log(`  ${label.padEnd(6)} ${(r.toFixed(2) + '%').padStart(8)} ${(g.toFixed(2) + '%').padStart(8)}`);
  distRow('p50', realMedian, simMedian);
  distRow('p75', realP75, simP75);
  distRow('p90', realP90, simP90);
  distRow('max', realMax, simMax);
  const medianGap = Math.abs(realMedian - simMedian);
  const meanGap = Math.abs(gap);
  console.log(
    `\n  median gap: ${medianGap.toFixed(2)}pp   mean gap: ${meanGap.toFixed(2)}pp   ` +
      `L2‴: median gap ${medianGap > meanGap ? 'IS' : 'is NOT'} larger than the mean gap\n`,
  );

  // (c) Channel decomposition — GMSim only, no real-side comparison possible.
  const ch = sample.channels;
  const channelList: [string, number][] = [
    ['release', ch.release],
    ['cap-cut', ch.capCut],
    ['roster-floor', ch.rosterFloor],
    ['void-years', ch.voidYears],
    ['trade', ch.trade],
    ['retirement', ch.retirement],
    ['preseason-cut', ch.preseasonCut],
    ['cap-casualty', ch.capCasualty],
  ];
  const total = channelList.reduce((s, [, v]) => s + v, 0);
  const sortedChannels = [...channelList].sort((a, b) => b[1] - a[1]);
  console.log('=== (c) GMSim channel decomposition (diagnostic — no real-side comparison) ===');
  console.log(`  ${'channel'.padEnd(14)} ${'$M'.padStart(10)}  ${'share'.padStart(7)}`);
  for (const [name, v] of sortedChannels) {
    const share = total > 0 ? (v / total) * 100 : 0;
    console.log(`  ${name.padEnd(14)} ${(v / 1e6).toFixed(1).padStart(10)}  ${(share.toFixed(1) + '%').padStart(7)}`);
  }
  console.log(
    `\n  (trade measured via deadMoneyTeamA+deadMoneyTeamB, not a $0-defaulting ` +
      `'deadMoney' field — §14.4's binding item: never print trade as unmeasured $0.)\n`,
  );

  const newBooked = ch.retirement + ch.preseasonCut;

  // Predictions
  console.log('=== Predictions (LIQUIDATOR_DEAD_MONEY.md §16.5) ===');
  if (realMean >= 6.5) {
    console.log(`  L1″ CONFIRMED: real mean ${realMean.toFixed(2)}% >= 6.5%. GMSim's ${simMean.toFixed(2)}% is DRIFT.`);
  } else if (realMean < 5.5) {
    console.log(
      `  L1″ FALSIFIED: real mean ${realMean.toFixed(2)}% < 5.5%. THE CAP-REALISM TRACK IS FINISHED — ` +
        'report this as loudly as a drift finding; do not invent further fixes. Per §15.5, ' +
        'Stage 2 (Wayback-sourced completed seasons) is REQUIRED before this ruling stands.',
    );
  } else {
    console.log(
      `  L1″ AMBIGUOUS: real mean ${realMean.toFixed(2)}% sits in the 5.5-6.5% band. ` +
        'Per §15.5, Stage 2 (Wayback-sourced completed seasons) is REQUIRED before any ruling.',
    );
  }
  console.log(
    `  L2‴ ${medianGap > meanGap ? 'CONFIRMED' : 'FALSIFIED'}: median gap ${medianGap.toFixed(2)}pp ` +
      `${medianGap > meanGap ? '>' : '<='} mean gap ${meanGap.toFixed(2)}pp.`,
  );
  console.log(
    `  L3″ ${ch.retirement > 0 && ch.preseasonCut > 0 ? 'CONFIRMED' : 'FALSIFIED'}: retirement $${(ch.retirement / 1e6).toFixed(1)}M, ` +
      `preseason-cut $${(ch.preseasonCut / 1e6).toFixed(1)}M — both ${ch.retirement > 0 && ch.preseasonCut > 0 ? 'material and non-zero' : 'NOT both non-zero'}.`,
  );
  const [largestName, largestValue] = sortedChannels[0]!;
  const releaseIsLargest = largestName === 'release';
  console.log(
    `  L4″ ${releaseIsLargest && newBooked > ch.voidYears ? 'CONFIRMED' : 'FALSIFIED'}: ` +
      `largest channel is ${largestName} $${(largestValue / 1e6).toFixed(1)}M (${total > 0 ? ((largestValue / total) * 100).toFixed(1) : '0.0'}%)` +
      (releaseIsLargest
        ? ''
        : ` — NOT release (release is $${(ch.release / 1e6).toFixed(1)}M, ${total > 0 ? ((ch.release / total) * 100).toFixed(1) : '0.0'}%)`) +
      `; retirement+preseason-cut $${(newBooked / 1e6).toFixed(1)}M ` +
      `${newBooked > ch.voidYears ? '>' : '<='} void-years $${(ch.voidYears / 1e6).toFixed(1)}M.`,
  );
  console.log(`  L7  ${l7Pass ? 'CONFIRMED' : 'FALSIFIED'}: walk reproduced the n=60 reference within tolerance = ${l7Pass}.`);
  console.log('');
}

async function main(): Promise<void> {
  // `run liquidator [seed]`             → seed cap-structure report (Slice 1)
  // `run liquidator fa [seed]`          → free-agency cap-structure report (Slice 2)
  // `run liquidator gtd [seed]`         → seed guaranteed-money realism (Slice 3)
  // `run liquidator gtd fa [seed]`      → FA-signing guaranteed-money realism (Slice 3b)
  // `run liquidator dead [seeds] [years]` → dead-money bar, P1.3 (Slice 4)
  const mode = process.argv[2];
  if (mode === 'fa') {
    await reportFreeAgency(process.argv[3] ?? 'liquidator');
  } else if (mode === 'gtd') {
    if (process.argv[3] === 'fa') {
      await reportFaGuarantees(process.argv[4] ?? 'liquidator');
    } else {
      await reportGuarantees(process.argv[3] ?? 'liquidator');
    }
  } else if (mode === 'dead') {
    const seedCount = Number(process.argv[3]) || DEAD_MONEY_DEFAULT_SEEDS;
    const years = Number(process.argv[4]) || DEAD_MONEY_DEFAULT_YEARS;
    await reportDeadMoney(seedCount, years);
  } else {
    await reportSeeds(mode ?? 'liquidator');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
