import { readFile, access } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { resolve } from 'node:path';
import { DATA_DIR } from './config.js';
import { splitCsvLine, csvNum } from './csv.js';
import { loadLeagueContracts, type LeagueContractRow } from './engine-bridge.js';

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

async function loadReal(): Promise<RealRow[]> {
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
    const gtd = csvNum(f[iGtd]) ?? 0;
    rows.push({
      position: f[iPos] ?? '',
      apyCapPct: apyPct,
      guaranteedPct: value > 0 ? gtd / value : 0,
      years: csvNum(f[iYears]) ?? 0,
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

async function main(): Promise<void> {
  const seed = process.argv[2] ?? 'liquidator';
  console.log(`\nThe Liquidator — cap-structure realism (real market: contracts signed ${MARKET_SINCE}+)`);

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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
