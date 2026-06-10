import type { Player } from '../types/player.js';
import type { LeagueState } from '../types/league.js';
import { Prng } from '../prng/index.js';
import { positionGroupFor } from './position-group.js';
import { PositionGroup } from '../types/enums.js';

/**
 * Career shapes (Living Careers S3) — the hidden TRAJECTORY ENVELOPE of a
 * career, layered on top of the per-position aging curves (S2) and the
 * learning-rate layer (`PlayerDevelopmentArchetype`). The S2 curves describe
 * the average arc; the shape is why Gurley collapsed at 26, Darnold arrived
 * at 27, Warner peaked twice, and Brady never seemed to age.
 *
 * Shapes and base rates come from THE ACTUARY's career-shape taxonomy
 * (868 real careers with 6+ qualifying seasons, 2003-2024):
 *
 *   QB    40% CLASSIC / 30% EVERGREEN / 13% PHENOM / 10% LATE_BLOOMER / 8% SECOND_PEAK
 *   SKILL 56% CLASSIC / 19% METEOR / 13% SECOND_PEAK / 6% LATE_BLOOMER / 4% EVERGREEN / 2% PHENOM
 *   DEF   37% CLASSIC / 26% SECOND_PEAK / 16% METEOR / 16% LATE_BLOOMER / 4% EVERGREEN / 1% PHENOM
 *
 * The DEF second-peak rate is DISCOUNTED in the engine weights (26% → 14%):
 * defensive production (tackles) is role/scheme-noisy, so a chunk of real
 * "second peaks" are opportunity swings, not ability resurgences. The engine
 * models shapes as ABILITY curves — opportunity noise comes from the depth
 * chart, so keeping the raw rate would double-count.
 *
 * HIDDEN, North-Star style: a shape is never displayed in a game UI and is
 * not stored on the save — like the S2 decline multiplier it derives
 * deterministically from (league seed, player id), so it is stable for the
 * whole career, costs no save-format change, and applies retroactively to
 * every existing player. The inspector may read it as a dev lens.
 */

export type CareerShape =
  | 'CLASSIC_ARC'
  | 'METEOR'
  | 'LATE_BLOOMER'
  | 'SECOND_PEAK'
  | 'EVERGREEN'
  | 'PHENOM_SUSTAINED';

type ShapeWeights = readonly { value: CareerShape; weight: number }[];

const QB_WEIGHTS: ShapeWeights = [
  { value: 'CLASSIC_ARC', weight: 40 },
  { value: 'EVERGREEN', weight: 30 },
  { value: 'PHENOM_SUSTAINED', weight: 13 },
  { value: 'LATE_BLOOMER', weight: 10 },
  { value: 'SECOND_PEAK', weight: 7 },
];

const SKILL_WEIGHTS: ShapeWeights = [
  { value: 'CLASSIC_ARC', weight: 56 },
  { value: 'METEOR', weight: 19 },
  { value: 'SECOND_PEAK', weight: 13 },
  { value: 'LATE_BLOOMER', weight: 6 },
  { value: 'EVERGREEN', weight: 4 },
  { value: 'PHENOM_SUSTAINED', weight: 2 },
];

/** Real DEF second-peak (26%) discounted to 14% (role noise); the surplus
 *  returns to CLASSIC, which is what those careers' ability arcs really were. */
const DEF_WEIGHTS: ShapeWeights = [
  { value: 'CLASSIC_ARC', weight: 49 },
  { value: 'SECOND_PEAK', weight: 14 },
  { value: 'METEOR', weight: 16 },
  { value: 'LATE_BLOOMER', weight: 16 },
  { value: 'EVERGREEN', weight: 4 },
  { value: 'PHENOM_SUSTAINED', weight: 1 },
];

/** OL/ST have no production curves — long-plateau classic-heavy mix. */
const OL_ST_WEIGHTS: ShapeWeights = [
  { value: 'CLASSIC_ARC', weight: 60 },
  { value: 'EVERGREEN', weight: 15 },
  { value: 'LATE_BLOOMER', weight: 12 },
  { value: 'SECOND_PEAK', weight: 8 },
  { value: 'METEOR', weight: 4 },
  { value: 'PHENOM_SUSTAINED', weight: 1 },
];

function weightsFor(player: Player): ShapeWeights {
  const group = positionGroupFor(player.position);
  switch (group) {
    case PositionGroup.QB:
      return QB_WEIGHTS;
    case PositionGroup.SKILL:
      return SKILL_WEIGHTS;
    case PositionGroup.DL:
    case PositionGroup.LB:
    case PositionGroup.DB:
      return DEF_WEIGHTS;
    case PositionGroup.OL:
    case PositionGroup.ST:
      return OL_ST_WEIGHTS;
  }
}

/**
 * The player's hidden career shape — deterministic for (league seed, player
 * id), stable across the whole career. Selection is trait-free on purpose:
 * stable traits still drift a little year to year, and a shape that changed
 * mid-career would be a different kind of lie.
 */
export function careerShapeFor(league: LeagueState, player: Player): CareerShape {
  const prng = new Prng(`${league.seed}:shape:${player.id}`);
  return prng.weighted(weightsFor(player));
}

/**
 * How a shape bends the position aging curve. All values multiply/shift the
 * S2 machinery in `season/development.ts`:
 *  - `growthMult` scales gap-closing growth before the position growth end.
 *  - `growthEndShift` extends/contracts the growth window (years).
 *  - `declineOnsetShift` moves every decline onset (physical/technique) by
 *     whole years; `declineRateMult` scales the per-year decline amounts.
 *  - `cliffHazardMult` scales the annual cliff probability.
 *  - `resurgence`: SECOND_PEAK only — during a seed-rolled 2-year window in
 *     the early-decline range, decline is suppressed and growth reopens
 *     (the Warner/Ricky arc). Window derived in development.ts.
 */
export interface ShapeModifiers {
  growthMult: number;
  growthEndShift: number;
  declineOnsetShift: number;
  declineRateMult: number;
  cliffHazardMult: number;
  resurgence: boolean;
}

export const SHAPE_MODIFIERS: Record<CareerShape, ShapeModifiers> = {
  CLASSIC_ARC: {
    growthMult: 1.0,
    growthEndShift: 0,
    declineOnsetShift: 0,
    declineRateMult: 1.0,
    cliffHazardMult: 1.0,
    resurgence: false,
  },
  // Explosive arrival, early hard fade (Gurley): hot growth, decline starts
  // ~2 years early and runs steep, cliffs come easy.
  METEOR: {
    growthMult: 1.35,
    growthEndShift: -1,
    declineOnsetShift: -2,
    declineRateMult: 1.35,
    cliffHazardMult: 1.6,
    resurgence: false,
  },
  // Slow arrival, late ramp (Darnold/Gannon): sluggish early growth but the
  // window stays open years longer and decline starts late. (Shifts kept
  // modest — the A2 aggregate showed +3/+2 here diluted league-wide
  // mid-career decline beyond what the real curves allow.)
  LATE_BLOOMER: {
    growthMult: 0.65,
    growthEndShift: 2,
    declineOnsetShift: 1,
    declineRateMult: 0.95,
    cliffHazardMult: 0.9,
    resurgence: false,
  },
  // Normal arc with a dormant resurgence window (Warner/Ricky).
  SECOND_PEAK: {
    growthMult: 1.0,
    growthEndShift: 0,
    declineOnsetShift: 0,
    declineRateMult: 1.05,
    cliffHazardMult: 1.0,
    resurgence: true,
  },
  // The long plateau (Brady/Gonzalez): decline late, gentle, cliff-resistant.
  EVERGREEN: {
    growthMult: 1.0,
    growthEndShift: 1,
    declineOnsetShift: 3,
    declineRateMult: 0.6,
    cliffHazardMult: 0.55,
    resurgence: false,
  },
  // Arrives near-ceiling early and holds (Mahomes-tier rarity).
  PHENOM_SUSTAINED: {
    growthMult: 1.45,
    growthEndShift: 0,
    declineOnsetShift: 2,
    declineRateMult: 0.75,
    cliffHazardMult: 0.7,
    resurgence: false,
  },
};

/**
 * SECOND_PEAK resurgence window: a seed-derived 2-year span starting 1-4
 * years past the position's first decline onset. During the window the
 * shape's decline is suppressed and growth reopens; production visibly
 * rebounds — the second hump.
 */
export function resurgenceWindowFor(
  league: LeagueState,
  player: Player,
  firstDeclineOnset: number,
): { start: number; end: number } {
  const prng = new Prng(`${league.seed}:resurgence:${player.id}`);
  const start = firstDeclineOnset + 1 + prng.nextRange(0, 4);
  return { start, end: start + 1 };
}
