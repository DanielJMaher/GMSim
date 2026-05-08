import type { Prng } from '../prng/index.js';

/**
 * NFL career-arc age distribution. These are heuristic approximations
 * of an active 53-man roster's realistic age makeup.
 *
 *   ROOKIE      ~10%   (age 21-22)
 *   DEVELOPING  ~20%   (age 23-24)
 *   PRIME       ~50%   (age 25-29)
 *   VETERAN     ~15%   (age 30-33)
 *   AGING       ~5%    (age 34-39)
 *
 * These are tunable. The Game Simulation module will eventually drive
 * aging dynamically, so this is only the *starting* distribution at
 * league creation.
 */

export type AgeStage = 'ROOKIE' | 'DEVELOPING' | 'PRIME' | 'VETERAN' | 'AGING';

const AGE_STAGE_WEIGHTS = [
  { value: 'ROOKIE' as AgeStage, weight: 10 },
  { value: 'DEVELOPING' as AgeStage, weight: 20 },
  { value: 'PRIME' as AgeStage, weight: 50 },
  { value: 'VETERAN' as AgeStage, weight: 15 },
  { value: 'AGING' as AgeStage, weight: 5 },
];

const AGE_RANGES: Record<AgeStage, [number, number]> = {
  ROOKIE: [21, 22],
  DEVELOPING: [23, 24],
  PRIME: [25, 29],
  VETERAN: [30, 33],
  AGING: [34, 39],
};

export interface AgeProfile {
  stage: AgeStage;
  ageYears: number;
  /** Years since draft entry. ~age - 22 with floor 0. */
  experienceYears: number;
}

export function rollAgeProfile(prng: Prng): AgeProfile {
  const stage = prng.weighted(AGE_STAGE_WEIGHTS);
  const [min, max] = AGE_RANGES[stage];
  const ageYears = prng.nextRange(min, max + 1);
  return {
    stage,
    ageYears,
    experienceYears: Math.max(0, ageYears - 22),
  };
}

/**
 * Convert an age in years to an ISO YYYY-MM-DD birthdate, anchored to
 * the supplied sim year (defaults to the league epoch, 2026).
 *
 * Mid-sim generators (retirement replacement, draft) must pass the
 * current sim year so newly-minted rookies are correctly aged for
 * the season they enter, not for league epoch.
 *
 * The exact month/day is rolled within the year for variety. Result
 * is stable for a given seed/age combination.
 */
export function ageToBirthDate(prng: Prng, ageYears: number, simYear = 2026): string {
  const birthYear = simYear - ageYears;
  const month = prng.nextRange(1, 13);
  // Clamp days at 28 to avoid invalid Feb dates without doing month math.
  const day = prng.nextRange(1, 29);
  const m = month.toString().padStart(2, '0');
  const d = day.toString().padStart(2, '0');
  return `${birthYear}-${m}-${d}`;
}
