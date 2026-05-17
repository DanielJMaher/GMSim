import { WEEKS_PER_LEAGUE_YEAR } from '../contracts/constants.js';

/**
 * Recency-weighted aggregation — shared between NFL watch lists
 * (`engine/src/scouting/watch-list.ts`) and college draft boards
 * (`engine/src/draft/board.ts`).
 *
 * Before this module landed (v0.41.0), both aggregation paths weighted
 * observations by confidence only. Across a multi-year league this
 * meant year-1 reports kept dominating boards even after fresh
 * post-development reads were filed in later cycles. The fix: decay
 * the weight of older observations on an exponential curve so the
 * most recent intelligence drives decisions.
 *
 * Curve shape (rough NFL realism):
 *   age 0 (fresh, same tick):   1.00
 *   age 1 year  (52 ticks):     0.50
 *   age 2 years (104 ticks):    0.25
 *   age 3 years (156 ticks):    0.13 (≈ floor)
 *   age 4+ years:               floor (0.125) — old reports stay
 *                               minimally weighted; they're rarely
 *                               wrong about identity-level facts.
 *
 * The floor matters: even ancient reports carry *some* signal (player
 * existed, position group, character flags). Zeroing them out would
 * drop the observation count for prospects who haven't been re-scouted
 * recently and leave them invisible. 12.5% feels right — present but
 * dominated by anything more recent.
 */

/** Number of ticks at which weight halves. One league year. */
const HALF_LIFE_TICKS = WEEKS_PER_LEAGUE_YEAR;

/** Minimum weight any observation carries, no matter how old. */
const RECENCY_FLOOR = 0.125;

/**
 * Exponential decay weight for an observation. Returns 1.0 for a
 * same-tick report, halves every league year, floors at 0.125.
 *
 * `ageInTicks` is the difference between the current tick and the
 * observation's `observedOnTick`. Negative ages (observation from
 * the future — shouldn't happen, but defensive) clamp to 0.
 */
export function recencyWeight(ageInTicks: number): number {
  if (!Number.isFinite(ageInTicks)) return RECENCY_FLOOR;
  const age = Math.max(0, ageInTicks);
  const years = age / HALF_LIFE_TICKS;
  const decayed = Math.pow(0.5, years);
  return Math.max(RECENCY_FLOOR, decayed);
}

/** Constants exposed for tests + future tuning. */
export const RECENCY_HALF_LIFE_TICKS = HALF_LIFE_TICKS;
export const RECENCY_WEIGHT_FLOOR = RECENCY_FLOOR;
