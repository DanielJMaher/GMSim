import { describe, expect, it } from 'vitest';

import { createLeague } from '../league/generate.js';
import { simulateSeason } from '../season/runner.js';
import { advanceSeason } from '../season/advance.js';
import type { LeagueState } from '../types/league.js';

/**
 * QB room-SIZE distribution gate — TALENT_EROSION.md §8, S2-Q0.
 *
 * Why this file exists: Talent Allocation Track 2 cut the QB blueprint target
 * 3→2, passed every gate it faced because those gates checked the MEAN
 * QBs-per-roster, and silently collapsed the share of rooms carrying
 * three-deep. That collapse then invalidated the ladder-ratio metric the whole
 * Talent Erosion investigation rests on — the 3+-QB population the metric
 * samples fell 73.3% → 29.1%, so its headline 1.23 → 0.46 "quality collapse"
 * was largely its own denominator breaking. Two sessions passed before anyone
 * noticed. A mean check cannot see a distribution move. This one can.
 *
 * ## Two measurement traps, both of which have already cost this project time
 *
 * **1. The room definition.** Every sim-side probe in this investigation
 * counted the active 53, while the real corpus counts active + practice squad.
 * On the corpus-matched definition the sim is close to real; on the
 * active-only definition it looks broken. Comparing sim active-53 against the
 * real active+PS bar generated false alarms for three sessions running, so the
 * bar here is asserted on active+PS and the active-only figure is checked
 * alongside it purely so the two can never be confused again.
 *
 * **2. The season window.** Measured 2026-09-11 by re-running the design doc's
 * own probe (`_erosion2_sim_ps.mjs`) unmodified on current `dist`, the share is
 * NOT flat across a walk — it climbs out of a genesis transient:
 *
 *     seasons 0-2   40-50%   (league starts blueprint-exact + PS-bootstrapped)
 *     seasons 3-12   ~69%    (steady state)
 *     pooled 0-12    63.5%
 *
 * §8.7.2 read the pooled figure (it measured 61.2%) as matching the real 61.1%
 * "almost exactly". That agreement is partly an artifact of averaging the
 * transient in. At STEADY STATE the sim runs ~8pp hot against the real bar —
 * close, but biased in a direction the pooled number concealed. This gate
 * therefore samples the steady state only, and that ~8pp overshoot is recorded
 * as an open item rather than silently blessed by a band drawn around wherever
 * the sim happens to sit.
 *
 * ## What this gate is, and is not
 *
 * It is an ANTI-COLLAPSE guard, one-sided by intent: the failure it exists to
 * catch moved this share by ~44pp. It is deliberately NOT a precision realism
 * bar, because the sim does not currently sit on one (see the ~8pp above), and
 * a two-sided band tight enough to be a realism bar would fail today. Closing
 * that 8pp is its own slice with its own evidence; drawing a tight band around
 * today's value and calling it a realism bar would be exactly the tuning-to-
 * pass that law 3 forbids.
 */

/** Real share of team-years carrying 3+ QBs, active + practice squad (Madden corpus). */
const REAL_THREE_DEEP_SHARE = 0.611;

/**
 * Sim steady-state share measured 2026-09-11 on current dist (seasons 3-12,
 * 3 seeds): ~0.69. Recorded so a future re-measure can distinguish "we moved"
 * from "we were always here".
 */
const MEASURED_STEADY_STATE_SHARE = 0.69;

/**
 * Anti-collapse floor. Far below both the real bar and the sim's steady state,
 * far above a Track-2-shaped collapse (which halved this share).
 *
 * Set from measured margin, not taste. This file's own seeds read 0.625
 * (per-sample 0.50 0.53 0.59 0.66 0.66 0.81) while the design doc's probe seeds
 * read 0.705 over the same window — i.e. ~8pp of seed-set variance on top of a
 * ~0.045 standard error at n=6 samples. A 0.50 floor left only ~2.8 SE and
 * would flake eventually in CI; 0.45 buys ~3.9 SE while still catching a drop
 * of ~28% relative from steady state. It sits deliberately BELOW the real bar
 * so nobody mistakes it for one.
 */
const COLLAPSE_FLOOR = 0.45;

/** Sanity ceiling — catches runaway QB hoarding, not a calibration claim. */
const HOARDING_CEILING = 0.85;

/**
 * Sampling window. Seasons 0-2 are the genesis transient (see header) and are
 * not comparable to a steady-state real-league bar.
 */
const STEADY_STATE_FIRST_SEASON = 3;
const STEADY_STATE_LAST_SEASON = 5;

/** Share of teams carrying at least `n` QBs, on the chosen room definition. */
function threeDeepShare(league: LeagueState, includePracticeSquad: boolean, n = 3): number {
  const teams = Object.values(league.teams);
  let deep = 0;
  for (const team of teams) {
    const ids = includePracticeSquad
      ? [...team.rosterIds, ...team.practiceSquadIds]
      : [...team.rosterIds];
    let qbs = 0;
    for (const id of ids) {
      if (league.players[id]?.position === 'QB') qbs++;
    }
    if (qbs >= n) deep++;
  }
  return deep / teams.length;
}

/** Walk a seed, sampling the share at each season in the steady-state window. */
function walkSteadyState(seed: string): { withPs: number[]; activeOnly: number[] } {
  const withPs: number[] = [];
  const activeOnly: number[] = [];
  let league = createLeague({ seed });
  for (let season = 0; season <= STEADY_STATE_LAST_SEASON; season++) {
    if (season >= STEADY_STATE_FIRST_SEASON) {
      withPs.push(threeDeepShare(league, true));
      activeOnly.push(threeDeepShare(league, false));
    }
    if (season < STEADY_STATE_LAST_SEASON) {
      league = advanceSeason(simulateSeason(league));
    }
  }
  return { withPs, activeOnly };
}

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('QB room-size distribution (TALENT_EROSION S2-Q0)', () => {
  const seeds = ['erosion-s2q0-gate-a', 'erosion-s2q0-gate-b'];
  const samples = seeds.map(walkSteadyState);
  const withPs = samples.flatMap((s) => s.withPs);
  const activeOnly = samples.flatMap((s) => s.activeOnly);

  it('does not let the 3+-QB room supply collapse (active + practice squad)', () => {
    const observed = mean(withPs);
    // eslint-disable-next-line no-console
    console.log(
      `[S2-Q0] observed active+PS ${observed.toFixed(3)} · active-53 ${mean(activeOnly).toFixed(3)} · per-sample ${withPs.map((v) => v.toFixed(2)).join(' ')}`,
    );
    expect(
      observed,
      `3+-QB share (active+PS, steady state) was ${observed.toFixed(3)}. Floor is ` +
        `${COLLAPSE_FLOOR}; real bar ${REAL_THREE_DEEP_SHARE}, sim steady state as ` +
        `measured 2026-09-11 ${MEASURED_STEADY_STATE_SHARE}. A break here means the QB ` +
        'room-size DISTRIBUTION moved even if mean QBs-per-roster did not — the exact ' +
        'blind spot Talent Allocation Track 2 shipped through (TALENT_EROSION.md §8).',
    ).toBeGreaterThan(COLLAPSE_FLOOR);
  });

  it('does not let QB rooms run away upward either', () => {
    expect(mean(withPs)).toBeLessThan(HOARDING_CEILING);
  });

  it('keeps the two room definitions clearly distinct', () => {
    // Not a realism bar — a guard against the definition confusion itself. If
    // these ever converge, a probe comparing sim active-53 against the real
    // active+PS bar stops being obviously wrong, and this investigation's most
    // expensive measurement error becomes invisible again.
    expect(mean(withPs)).toBeGreaterThan(mean(activeOnly) + 0.15);
  });

  /**
   * Log-only instrument, skipped per the house convention. Un-skip to print the
   * full per-season series on both definitions when re-basing the bar — that
   * series is what revealed the genesis transient in the first place.
   */
  it.skip('INSTRUMENT: prints the ≥3-QB share per season, both definitions', () => {
    for (const seed of ['erosion-s2q0-a', 'erosion-s2q0-b', 'erosion-s2q0-c']) {
      const ps: number[] = [];
      const a53: number[] = [];
      let league = createLeague({ seed });
      for (let s = 0; s < 13; s++) {
        ps.push(threeDeepShare(league, true));
        a53.push(threeDeepShare(league, false));
        league = advanceSeason(simulateSeason(league));
      }
      // eslint-disable-next-line no-console
      console.log(
        `${seed}\n  active+PS  ${ps.map((v) => v.toFixed(3)).join(' ')}  mean ${mean(ps).toFixed(3)}` +
          `\n  active-53  ${a53.map((v) => v.toFixed(3)).join(' ')}  mean ${mean(a53).toFixed(3)}`,
      );
    }
  });
});
