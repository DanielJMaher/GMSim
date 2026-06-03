import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DATA_DIR } from './config.js';
import { generatedClass, type ClassProspect } from './engine-bridge.js';
import type { NmddBoard } from './nmdd.js';

/**
 * Truth Arbiter — class-talent facet (2026-06-02).
 *
 * Verifies that GMSim's generated prospect classes have a realistic talent
 * distribution, the foundation everything downstream (scouting, big boards,
 * media) is built on. Two checks against the real NMDD consensus boards
 * (`run nmdd`, 2016-2025):
 *
 *   1. POSITION MIX by consensus tier (top 10 / 32 / 100) — does GMSim put the
 *      right balance of positions at the top? (Catches the EDGE/QB flood.)
 *   2. TALENT STEEPNESS — real classes are a steep pyramid (~3-4 blue-chips,
 *      ~12-15 first-round grades, long tail). GMSim's ground-truth overall
 *      should DROP sharply with consensus rank. A flat curve = no blue-chips =
 *      the root cause of the board flood + draft-reach blow-up.
 *
 * NMDD gives consensus RANK, not grades, so the position-mix check is anchored
 * directly to real data; the steepness check is anchored to the documented
 * benchmark (talent must separate at the top).
 *
 *   pnpm --filter @gmsim/truth-arbiter run class-talent [seed,seed,...]
 */

const GROUPS = ['QB', 'SKILL', 'OL', 'DL', 'LB', 'DB', 'ST'] as const;
type Group = (typeof GROUPS)[number];
const TIERS = [10, 32, 100] as const;

/** NMDD position label → engine position group. */
const NMDD_GROUP: Record<string, Group> = {
  QB: 'QB',
  RB: 'SKILL', WR: 'SKILL', TE: 'SKILL', FB: 'SKILL',
  OT: 'OL', IOL: 'OL', OG: 'OL', C: 'OL', OL: 'OL', G: 'OL', T: 'OL',
  EDGE: 'DL', DL: 'DL', DT: 'DL', DE: 'DL', IDL: 'DL',
  LB: 'LB', ILB: 'LB', OLB: 'LB',
  CB: 'DB', S: 'DB', FS: 'DB', SS: 'DB', DB: 'DB',
  K: 'ST', P: 'ST', LS: 'ST',
};

function emptyMix(): Record<Group, number> {
  return { QB: 0, SKILL: 0, OL: 0, DL: 0, LB: 0, DB: 0, ST: 0 };
}

/** Position-group counts within the top-`n` of one ranked list. */
function mixOf(positions: { group: Group }[], n: number): Record<Group, number> {
  const mix = emptyMix();
  for (const p of positions.slice(0, n)) mix[p.group] += 1;
  return mix;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

async function main(): Promise<void> {
  const seeds = (process.argv[2] ?? 'class-a,class-b,class-c').split(',');

  // ── Real targets from NMDD ──────────────────────────────────────────────
  const boards = JSON.parse(
    await readFile(resolve(DATA_DIR, 'nmdd-boards.json'), 'utf8'),
  ) as NmddBoard[];
  if (boards.length === 0) {
    console.error('No NMDD data — run `pnpm --filter @gmsim/truth-arbiter run nmdd` first.');
    process.exit(1);
  }
  const realByTier = new Map<number, Record<Group, number>>();
  for (const n of TIERS) {
    const acc = emptyMix();
    for (const b of boards) {
      const grouped = b.prospects.map((p) => ({ group: NMDD_GROUP[p.position] ?? 'ST' }));
      const m = mixOf(grouped, n);
      for (const g of GROUPS) acc[g] += m[g];
    }
    for (const g of GROUPS) acc[g] /= boards.length; // per-class average
    realByTier.set(n, acc);
  }

  // ── GMSim generated classes (averaged over seeds) ───────────────────────
  const gmClasses: ClassProspect[][] = [];
  for (const seed of seeds) gmClasses.push(await generatedClass(seed));
  const gmByTier = new Map<number, Record<Group, number>>();
  for (const n of TIERS) {
    const acc = emptyMix();
    for (const cls of gmClasses) {
      const grouped = cls.map((p) => ({ group: p.positionGroup as Group }));
      const m = mixOf(grouped, n);
      for (const g of GROUPS) acc[g] += m[g];
    }
    for (const g of GROUPS) acc[g] /= gmClasses.length;
    gmByTier.set(n, acc);
  }

  /* eslint-disable no-console */
  console.log(`\n=== Truth Arbiter: class-talent ===`);
  console.log(`real: NMDD consensus ${boards.length} classes (${boards[0]!.year}-${boards.at(-1)!.year}); gmsim: ${seeds.length} seeds\n`);

  console.log('POSITION-GROUP MIX by consensus tier (count per class) — real vs gmsim:');
  for (const n of TIERS) {
    const real = realByTier.get(n)!;
    const gm = gmByTier.get(n)!;
    console.log(`\n  top-${n}:`);
    console.log(`    ${'grp'.padEnd(6)} ${'real'.padStart(6)} ${'gmsim'.padStart(6)} ${'Δ'.padStart(6)}`);
    for (const g of GROUPS) {
      const d = gm[g] - real[g];
      const flag = Math.abs(d) >= Math.max(2, real[g] * 0.5) ? '  <-- OFF' : '';
      console.log(`    ${g.padEnd(6)} ${real[g].toFixed(1).padStart(6)} ${gm[g].toFixed(1).padStart(6)} ${(d >= 0 ? '+' : '') + d.toFixed(1).padStart(5)}${flag}`);
    }
  }

  // ── Talent steepness (gmsim ground truth) ───────────────────────────────
  console.log(`\nTALENT STEEPNESS — gmsim ground-truth overall by consensus-rank band:`);
  console.log(`  (real classes drop STEEPLY: ~3-4 blue-chips, ~12-15 R1 grades, long tail)`);
  const bands: [string, number, number][] = [
    ['1-5', 0, 5], ['6-10', 5, 10], ['11-32', 10, 32], ['33-100', 32, 100], ['101-250', 100, 250],
  ];
  const bandMeans: Record<string, number> = {};
  for (const [label, lo, hi] of bands) {
    const vals: number[] = [];
    for (const cls of gmClasses) for (const p of cls.slice(lo, hi)) vals.push(p.realOverall);
    bandMeans[label] = mean(vals);
    console.log(`  rank ${label.padEnd(8)} overall ${Number.isNaN(bandMeans[label]) ? '—' : bandMeans[label].toFixed(1)}`);
  }
  const top5 = bandMeans['1-5'] ?? NaN;
  const tail = bandMeans['33-100'] ?? NaN;
  const drop = top5 - tail;
  console.log(`\n  top-5 minus rank-33-100 drop = ${Number.isNaN(drop) ? '—' : drop.toFixed(1)}` +
    `  ${drop < 8 ? '<-- TOO FLAT (no blue-chip separation; pool needs talent spread)' : '(separation present)'}`);

  // ── Pinpoint: generation vs board ────────────────────────────────────────
  // CEILING (true potential) by band tells us if GENERATION makes blue-chips;
  // the tier mix of the consensus top-32 + whether the pool's true-best surface
  // there tells us if the BOARD finds them.
  console.log(`\nPINPOINT — true CEILING (potential) by consensus-rank band:`);
  for (const [label, lo, hi] of bands) {
    const vals: number[] = [];
    for (const cls of gmClasses) for (const p of cls.slice(lo, hi)) vals.push(p.ceilingOverall);
    console.log(`  rank ${label.padEnd(8)} ceiling ${Number.isNaN(mean(vals)) ? '—' : mean(vals).toFixed(1)}`);
  }
  const tierMix = (rows: ClassProspect[]): string => {
    const c: Record<string, number> = {};
    for (const p of rows) c[p.tier] = (c[p.tier] ?? 0) + 1;
    return ['STAR', 'STARTER', 'BACKUP', 'FRINGE'].map((t) => `${t}:${((c[t] ?? 0) / gmClasses.length).toFixed(1)}`).join(' ');
  };
  console.log(`\n  consensus top-32 tier mix (per class): ${tierMix(gmClasses.flatMap((c) => c.slice(0, 32)))}`);
  // Does the board surface the true best? Overlap of consensus top-32 with the
  // ceiling-top-32 of the same class.
  let overlap = 0;
  for (const cls of gmClasses) {
    const consTop = new Set(cls.slice(0, 32).map((p) => p.rank));
    const ceilTop = new Set([...cls].sort((a, b) => b.ceilingOverall - a.ceilingOverall).slice(0, 32).map((p) => p.rank));
    for (const r of consTop) if (ceilTop.has(r)) overlap += 1;
  }
  console.log(`  board surfaces true-best: consensus top-32 ∩ ceiling top-32 = ${(overlap / gmClasses.length).toFixed(1)}/32` +
    `  ${overlap / gmClasses.length < 16 ? '<-- BOARD weak at finding talent' : '(board finds most)'}`);
  /* eslint-enable no-console */
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
