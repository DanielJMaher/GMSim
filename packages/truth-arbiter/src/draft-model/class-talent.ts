import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DATA_DIR } from '../lib/config.js';
import { generatedClass, type ClassProspect } from '../lib/engine-bridge.js';
import type { NmddBoard } from '../media/nmdd.js';

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

// Granular positions (v0.161 — the lumped SKILL/OL/DL/LB/DB groups masked
// per-position over/under-supply, and each has its OWN CLASS_TOP_GRADE_MULT).
// Taxonomy note: real draft "OLB" is overwhelmingly an edge rusher, so (matching
// the Goatinator) real OLB → EDGE; GMSim's OLB is the off-ball backer → LB. So
// EDGE compares gmsim EDGE vs real EDGE+DE+OLB, and off-ball LB compares gmsim
// ILB+OLB vs real ILB+MLB (a gmsim ILB-vs-OLB diagnostic prints separately).
const GROUPS = ['QB', 'WR', 'RB', 'TE', 'OT', 'IOL', 'EDGE', 'IDL', 'LB', 'CB', 'S', 'ST'] as const;
type Group = (typeof GROUPS)[number];
const TIERS = [10, 32, 100] as const;

/** NMDD (real) position label → granular group. */
const NMDD_GROUP: Record<string, Group> = {
  QB: 'QB',
  WR: 'WR', RB: 'RB', FB: 'RB', TE: 'TE',
  OT: 'OT', T: 'OT',
  IOL: 'IOL', OG: 'IOL', G: 'IOL', C: 'IOL', OL: 'IOL',
  EDGE: 'EDGE', DE: 'EDGE', OLB: 'EDGE',
  DT: 'IDL', NT: 'IDL', DL: 'IDL', IDL: 'IDL',
  LB: 'LB', ILB: 'LB', MLB: 'LB',
  CB: 'CB', DB: 'CB',
  S: 'S', FS: 'S', SS: 'S',
  K: 'ST', P: 'ST', LS: 'ST',
};

/** GMSim engine position → granular group (EDGE is its own position; OLB is
 *  off-ball; NICKEL is a slot corner). */
const GMSIM_GROUP: Record<string, Group> = {
  QB: 'QB',
  WR: 'WR', RB: 'RB', FB: 'RB', TE: 'TE',
  LT: 'OT', RT: 'OT',
  LG: 'IOL', RG: 'IOL', C: 'IOL',
  EDGE: 'EDGE',
  DT: 'IDL', NT: 'IDL',
  ILB: 'LB', OLB: 'LB',
  CB: 'CB', NICKEL: 'CB', S: 'S',
  K: 'ST', P: 'ST', LS: 'ST',
};

function emptyMix(): Record<Group, number> {
  return { QB: 0, WR: 0, RB: 0, TE: 0, OT: 0, IOL: 0, EDGE: 0, IDL: 0, LB: 0, CB: 0, S: 0, ST: 0 };
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
      const grouped = cls.map((p) => ({ group: GMSIM_GROUP[p.position] ?? 'ST' }));
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

  // Off-ball LB diagnostic: the LB group is off-ball (gmsim ILB+OLB; real
  // ILB+MLB). Real draft "OLB" is an edge rusher → counted in EDGE, so there's
  // no clean real off-ball-OLB bar; this just shows which GMSim off-ball backer
  // drives the LB count.
  console.log('\n  off-ball LB split (gmsim only — real off-ball OLB folds into the LB bar):');
  for (const n of [32, 100] as const) {
    let ilb = 0;
    let olb = 0;
    for (const cls of gmClasses)
      for (const p of cls.slice(0, n)) {
        if (p.position === 'ILB') ilb += 1;
        else if (p.position === 'OLB') olb += 1;
      }
    console.log(`    top-${n}: ILB ${(ilb / gmClasses.length).toFixed(1)} / OLB ${(olb / gmClasses.length).toFixed(1)} per class`);
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
