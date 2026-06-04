import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DATA_DIR } from '../lib/config.js';
import { splitCsvLine, csvNum } from '../lib/csv.js';

/**
 * RAS / athletic-baseline analysis (Slice 3a, 2026-06-02).
 *
 * Source: the open nflverse combine dataset already cached for the draft
 * corpus (data/combine.csv, 2000-2026, ~9k players). This is the same raw
 * measurable data Relative Athletic Score (ras.football) is computed from —
 * height, weight, 40, bench, vertical, broad jump, 3-cone, 20-yd shuttle.
 *
 * Produces two things:
 *   1. Per-position measurable DISTRIBUTIONS (mean/SD) — the absolute baselines
 *      that drive position-differentiated physical generation in the engine
 *      (Slice 3b). A CB's 40 ≈ 4.50, a DT's ≈ 5.11 → the strength↔speed
 *      tradeoff falls out of position size/speed differences.
 *   2. A reproduced RAS-style score (position percentile composite, 0-10) — a
 *      cross-check that our position-normalization behaves like RAS (each
 *      position should center ~5.0 by construction). NOT identical to
 *      ras.football (different sample window, no splits/arm/hand, combine-only)
 *      — a faithful reproduction for shaping + auditing generation.
 *
 *   pnpm --filter @gmsim/truth-arbiter run ras
 */

const COMBINE_CSV_PATH = resolve(DATA_DIR, 'combine.csv');

// Measurables we have. `lowerIsBetter` flags timed drills (faster = better).
const METRICS = [
  { key: 'heightIn', label: 'ht(in)', lowerIsBetter: false },
  { key: 'weightLbs', label: 'wt', lowerIsBetter: false },
  { key: 'forty', label: '40', lowerIsBetter: true },
  { key: 'bench', label: 'bench', lowerIsBetter: false },
  { key: 'vertical', label: 'vert', lowerIsBetter: false },
  { key: 'broad', label: 'broad', lowerIsBetter: false },
  { key: 'cone', label: '3cone', lowerIsBetter: true },
  { key: 'shuttle', label: 'shuttle', lowerIsBetter: true },
] as const;
type MetricKey = (typeof METRICS)[number]['key'];

interface CombinePlayer {
  pos: string;
  vals: Partial<Record<MetricKey, number>>;
}

/**
 * Collapse the many nflverse position labels into the buckets the engine
 * generates against (Slice 3b maps LT/RT←OT, LG/RG←OG, NT←DT(heavier),
 * NICKEL←CB(smaller) downstream).
 */
const POS_MAP: Record<string, string> = {
  QB: 'QB', RB: 'RB', FB: 'FB', WR: 'WR', TE: 'TE',
  OT: 'OT', T: 'OT',
  OG: 'OG', G: 'OG', OL: 'OG',
  C: 'C',
  DE: 'EDGE', EDGE: 'EDGE',
  DT: 'DT', NT: 'DT', DL: 'DT',
  OLB: 'OLB', LB: 'OLB',
  ILB: 'ILB', MLB: 'ILB',
  CB: 'CB',
  S: 'S', SAF: 'S', FS: 'S', SS: 'S', DB: 'S',
  K: 'K', P: 'P', LS: 'LS',
};
const POS_ORDER = ['QB', 'RB', 'FB', 'WR', 'TE', 'OT', 'OG', 'C', 'EDGE', 'DT', 'OLB', 'ILB', 'CB', 'S', 'K', 'P', 'LS'];

/** Parse `6-4` → 76 inches. */
function heightToInches(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d+)-(\d+)$/);
  if (!m) return csvNum(s);
  return Number(m[1]) * 12 + Number(m[2]);
}

function parse(csv: string): CombinePlayer[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
  const header = splitCsvLine(lines[0]!);
  const col = (name: string): number => header.indexOf(name);
  const ci = {
    pos: col('pos'), ht: col('ht'), wt: col('wt'), forty: col('forty'),
    bench: col('bench'), vertical: col('vertical'), broad: col('broad_jump'),
    cone: col('cone'), shuttle: col('shuttle'),
  };
  const out: CombinePlayer[] = [];
  for (let r = 1; r < lines.length; r++) {
    const f = splitCsvLine(lines[r]!);
    const rawPos = (f[ci.pos] ?? '').trim().toUpperCase();
    const pos = POS_MAP[rawPos];
    if (!pos) continue;
    const vals: Partial<Record<MetricKey, number>> = {};
    const set = (k: MetricKey, v: number | null) => {
      if (v !== null && !Number.isNaN(v)) vals[k] = v;
    };
    set('heightIn', heightToInches(f[ci.ht]));
    set('weightLbs', csvNum(f[ci.wt]));
    set('forty', csvNum(f[ci.forty]));
    set('bench', csvNum(f[ci.bench]));
    set('vertical', csvNum(f[ci.vertical]));
    set('broad', csvNum(f[ci.broad]));
    set('cone', csvNum(f[ci.cone]));
    set('shuttle', csvNum(f[ci.shuttle]));
    out.push({ pos, vals });
  }
  return out;
}

function meanSd(xs: number[]): { mean: number; sd: number; n: number } {
  const n = xs.length;
  if (n === 0) return { mean: NaN, sd: NaN, n: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  return { mean, sd, n };
}

/** Percentile of v within sorted xs (0..1), direction-aware. */
function percentile(sorted: number[], v: number, lowerIsBetter: boolean): number {
  // fraction of the cohort this value beats
  let below = 0;
  for (const x of sorted) {
    if (lowerIsBetter ? x > v : x < v) below++;
  }
  return below / sorted.length;
}

async function main(): Promise<void> {
  const csv = await readFile(COMBINE_CSV_PATH, 'utf8');
  const players = parse(csv);
  const byPos = new Map<string, CombinePlayer[]>();
  for (const p of players) (byPos.get(p.pos) ?? byPos.set(p.pos, []).get(p.pos)!).push(p);

  /* eslint-disable no-console */
  console.log(`\n=== nflverse combine — per-position measurable distributions (2000-2026, ${players.length} players) ===`);
  console.log(`  mean (sd) [n]  — the absolute baselines for position-differentiated generation\n`);
  const headerCols = METRICS.map((m) => m.label.padStart(13)).join('');
  console.log(`  ${'pos'.padEnd(5)} ${'N'.padStart(5)}${headerCols}`);
  for (const pos of POS_ORDER) {
    const ps = byPos.get(pos);
    if (!ps) continue;
    let line = `  ${pos.padEnd(5)} ${String(ps.length).padStart(5)}`;
    for (const m of METRICS) {
      const xs = ps.map((p) => p.vals[m.key]).filter((v): v is number => v !== undefined);
      const { mean, sd } = meanSd(xs);
      const cell = Number.isNaN(mean) ? '—' : `${mean.toFixed(1)}(${sd.toFixed(1)})`;
      line += cell.padStart(13);
    }
    console.log(line);
  }

  // Reproduced RAS: per player, percentile (0-10) of each available metric
  // within his position cohort, averaged. Validates that our normalization
  // behaves like RAS — each position should center ~5.0.
  const cohorts = new Map<string, Map<MetricKey, number[]>>();
  for (const [pos, ps] of byPos) {
    const m = new Map<MetricKey, number[]>();
    for (const metric of METRICS) {
      m.set(metric.key, ps.map((p) => p.vals[metric.key]).filter((v): v is number => v !== undefined).sort((a, b) => a - b));
    }
    cohorts.set(pos, m);
  }
  console.log(`\n=== reproduced RAS-style score (position percentile composite, 0-10) ===`);
  console.log(`  should center ~5.0 per position (construction check) — NOT identical to ras.football\n`);
  console.log(`  ${'pos'.padEnd(5)} ${'meanRAS'.padStart(8)} ${'p10'.padStart(6)} ${'p90'.padStart(6)} ${'%≥9'.padStart(6)}`);
  for (const pos of POS_ORDER) {
    const ps = byPos.get(pos);
    if (!ps) continue;
    const cohort = cohorts.get(pos)!;
    const scores: number[] = [];
    for (const p of ps) {
      let sum = 0;
      let cnt = 0;
      for (const metric of METRICS) {
        const v = p.vals[metric.key];
        const sorted = cohort.get(metric.key)!;
        if (v === undefined || sorted.length < 10) continue;
        sum += percentile(sorted, v, metric.lowerIsBetter) * 10;
        cnt++;
      }
      if (cnt >= 4) scores.push(sum / cnt); // RAS needs a minimum set of metrics
    }
    scores.sort((a, b) => a - b);
    if (scores.length === 0) continue;
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const p10 = scores[Math.floor(scores.length * 0.1)]!;
    const p90 = scores[Math.floor(scores.length * 0.9)]!;
    const elite = scores.filter((s) => s >= 9).length / scores.length;
    console.log(
      `  ${pos.padEnd(5)} ${mean.toFixed(2).padStart(8)} ${p10.toFixed(1).padStart(6)} ${p90.toFixed(1).padStart(6)} ${(elite * 100).toFixed(1).padStart(6)}`,
    );
  }
  console.log('');
  /* eslint-enable no-console */
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
