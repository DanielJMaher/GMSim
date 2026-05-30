import { readFile } from 'node:fs/promises';
import { CORPUS_PATH } from './config.js';
import { mean } from './class-build.js';
import { simulateDraftedCareers } from './engine-bridge.js';
import type { Corpus, DraftPickRecord } from './types.js';

/**
 * Phase A — REAL career-outcome curves by draft round (Truth Arbiter outcome
 * layer). Reports "did the pick pan out" by round from the joined nflverse
 * career data: Career AV, Pro Bowl rate, starter tenure, games, bust rate.
 * These are the reference curves the generated-outcome check (Phase B) will
 * be compared against.
 *
 *   pnpm --filter @gmsim/truth-arbiter run outcomes
 */

// Careers need ~5+ seasons to mature; only judge classes old enough.
const MATURE_THROUGH = 2020;

function rate(picks: DraftPickRecord[], pred: (c: NonNullable<DraftPickRecord['career']>) => boolean): number {
  const withCareer = picks.filter((p) => p.career);
  if (withCareer.length === 0) return 0;
  return (withCareer.filter((p) => pred(p.career!)).length / withCareer.length) * 100;
}
function avg(picks: DraftPickRecord[], get: (c: NonNullable<DraftPickRecord['career']>) => number | null): number {
  const vals = picks.map((p) => p.career && get(p.career)).filter((x): x is number => typeof x === 'number');
  return vals.length ? mean(vals) : 0;
}

/**
 * Phase B — GENERATED career outcomes via forward-sim, compared to the real
 * curves. The engine has no Pro Bowl/All-Pro, so success is read from what it
 * does model: tier developed to (STAR / STARTER), career length, washout. We
 * compare the DECLINE-by-round shape — does the engine make early picks succeed
 * and late picks bust at realistic rates — not absolute scales.
 */
async function reportGenerated(years: number): Promise<void> {
  const corpus = JSON.parse(await readFile(CORPUS_PATH, 'utf8')) as Corpus;
  const realMature = corpus.picks.filter((p) => p.year <= MATURE_THROUGH);

  console.log(`\nForward-simulating ${years} seasons (this is the slow check)…`);
  const careers = await simulateDraftedCareers('outcome-sim', years);
  // Mature generated cohorts = drafted early enough to have played out a career.
  const MATURE_WINDOW = 6;
  const genMature = careers.filter((c) => c.draftedYear <= years - MATURE_WINDOW);

  const realPB = (r: number): number =>
    pct(realMature.filter((p) => p.round === r && p.career), (p) => (p.career!.probowls ?? 0) >= 1);
  const realBust = (r: number): number =>
    pct(realMature.filter((p) => p.round === r && p.career), (p) => (p.career!.seasonsStarted ?? 0) === 0 && (p.career!.wAv ?? p.career!.carAv ?? 0) < 8);
  // The engine now selects Pro Bowls (2b), so the comparison is DIRECT.
  const genPB = (r: number): number => pct(genMature.filter((c) => c.round === r), (c) => c.proBowls >= 1);
  const genBust = (r: number): number => pct(genMature.filter((c) => c.round === r), (c) => c.peakTier === 'FRINGE' || c.peakTier === 'BACKUP');

  console.log(`\n=== Phase B: generated vs real career outcomes by round ===`);
  console.log(`(ProBowl% now a DIRECT comparison — engine selects Pro Bowls; bust% = never a starter)\n`);
  console.log(
    `  ${'rnd'.padEnd(4)} ${'realPB%'.padStart(8)} ${'genPB%'.padStart(8)} ` +
      `${'realBust%'.padStart(10)} ${'genBust%'.padStart(9)}`,
  );
  for (let r = 1; r <= 7; r++) {
    console.log(
      `  R${String(r).padEnd(3)} ${realPB(r).toFixed(1).padStart(8)} ${genPB(r).toFixed(1).padStart(8)} ` +
        `${realBust(r).toFixed(1).padStart(10)} ${genBust(r).toFixed(1).padStart(9)}`,
    );
  }
  console.log(`\n  generated cohorts: ${genMature.length} drafted players (${years}-season sim).`);
}

function pct<T>(items: T[], pred: (t: T) => boolean): number {
  return items.length ? (items.filter(pred).length / items.length) * 100 : 0;
}

async function main(): Promise<void> {
  if (process.argv[2] === 'sim') {
    await reportGenerated(Number(process.argv[3]) || 14);
    return;
  }
  const corpus = JSON.parse(await readFile(CORPUS_PATH, 'utf8')) as Corpus;
  const mature = corpus.picks.filter((p) => p.year <= MATURE_THROUGH);
  const withCareer = mature.filter((p) => p.career).length;

  console.log(`\n=== REAL career outcomes by round (classes 2014-${MATURE_THROUGH}) ===`);
  console.log(`${withCareer}/${mature.length} mature picks have career data.\n`);
  // nflverse populates weighted AV (w_av), not car_av — and w_av is the better
  // "value" metric (weights peak seasons) anyway. Prefer it, fall back to car_av.
  const av0 = (c: NonNullable<DraftPickRecord['career']>): number | null => c.wAv ?? c.carAv;
  console.log(
    `  ${'rnd'.padEnd(4)} ${'n'.padStart(4)} ${'ProBowl%'.padStart(9)} ${'wAV'.padStart(7)} ` +
      `${'games'.padStart(7)} ${'yrsStart'.padStart(9)} ${'bust%'.padStart(7)}`,
  );
  for (let r = 1; r <= 7; r++) {
    const rp = mature.filter((p) => p.round === r);
    if (rp.length === 0) continue;
    const pb = rate(rp, (c) => (c.probowls ?? 0) >= 1);
    const av = avg(rp, av0);
    const games = avg(rp, (c) => c.games);
    const starts = avg(rp, (c) => c.seasonsStarted);
    // Bust = never a regular starter and minimal value — the pick that missed.
    const bust = rate(rp, (c) => (c.seasonsStarted ?? 0) === 0 && (av0(c) ?? 0) < 8);
    console.log(
      `  R${String(r).padEnd(3)} ${String(rp.length).padStart(4)} ${pb.toFixed(1).padStart(9)} ` +
        `${av.toFixed(1).padStart(7)} ${games.toFixed(0).padStart(7)} ${starts.toFixed(1).padStart(9)} ${bust.toFixed(1).padStart(7)}`,
    );
  }

  // Top-10 vs rest-of-R1 — the premium of the very top of the draft.
  const top10 = mature.filter((p) => (p.overallPick ?? 99) <= 10);
  const r1rest = mature.filter((p) => p.round === 1 && (p.overallPick ?? 0) > 10);
  console.log(`\n  top-10 picks:  ProBowl ${rate(top10, (c) => (c.probowls ?? 0) >= 1).toFixed(0)}%  wAV ${avg(top10, av0).toFixed(1)}`);
  console.log(`  R1 (11-32):    ProBowl ${rate(r1rest, (c) => (c.probowls ?? 0) >= 1).toFixed(0)}%  wAV ${avg(r1rest, av0).toFixed(1)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
