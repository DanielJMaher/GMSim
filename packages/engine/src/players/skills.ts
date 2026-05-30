import type { Prng } from '../prng/index.js';
import type {
  PlayerSkills,
  PlayerDevelopmentArchetype,
  TalentTier,
  TalentGrade,
} from '../types/player.js';
import type { PlayerArchetype } from '../archetypes/types.js';
import type { AgeStage } from './age.js';
import { ALL_SKILL_KEYS, categoryFor, effectiveSkillWeight } from './skill-keys.js';

export type { TalentTier, TalentGrade } from '../types/player.js';

/**
 * Fine 8-grade distribution (Skill Adjudicator). Weights are chosen so they
 * roll up — via `GRADE_TO_TIER` — to the legacy coarse 5/35/40/20
 * STAR/STARTER/BACKUP/FRINGE split, so the ~130 `tier` consumers see an
 * unchanged distribution while generation gains real resolution.
 */
const GRADE_WEIGHTS = [
  { value: 'ELITE' as TalentGrade, weight: 1 },
  { value: 'STAR' as TalentGrade, weight: 4 }, // → STAR 5
  { value: 'HIGH_STARTER' as TalentGrade, weight: 13 },
  { value: 'STARTER' as TalentGrade, weight: 22 }, // → STARTER 35
  { value: 'WEAK_STARTER' as TalentGrade, weight: 18 },
  { value: 'ROTATIONAL' as TalentGrade, weight: 22 }, // → BACKUP 40
  { value: 'BACKUP' as TalentGrade, weight: 12 },
  { value: 'FRINGE' as TalentGrade, weight: 8 }, // → FRINGE 20
];

/** Mean ceiling (max-potential) baseline per fine grade. Each coarse group's
 *  weighted average matches the legacy tier mean (STAR≈90/STARTER78/BACKUP66/
 *  FRINGE54), so coarse-derived skills don't shift. */
const GRADE_CEILING_MEAN: Record<TalentGrade, number> = {
  ELITE: 94,
  STAR: 88,
  HIGH_STARTER: 82,
  STARTER: 76,
  WEAK_STARTER: 70,
  ROTATIONAL: 64,
  BACKUP: 58,
  FRINGE: 52,
};

/** Fine grade → legacy coarse tier (preserves the 5/35/40/20 split). */
const GRADE_TO_TIER: Record<TalentGrade, TalentTier> = {
  ELITE: 'STAR',
  STAR: 'STAR',
  HIGH_STARTER: 'STARTER',
  STARTER: 'STARTER',
  WEAK_STARTER: 'BACKUP',
  ROTATIONAL: 'BACKUP',
  BACKUP: 'FRINGE',
  FRINGE: 'FRINGE',
};

export function gradeToTier(grade: TalentGrade): TalentTier {
  return GRADE_TO_TIER[grade];
}

export function rollTalentGrade(prng: Prng): TalentGrade {
  return prng.weighted(GRADE_WEIGHTS);
}

/** Order of grades from best to worst (for thresholds + the Adjudicator). */
export const GRADE_ORDER: readonly TalentGrade[] = [
  'ELITE', 'STAR', 'HIGH_STARTER', 'STARTER', 'WEAK_STARTER', 'ROTATIONAL', 'BACKUP', 'FRINGE',
];

/** Derive a grade from an overall ceiling value (for promotion / migration,
 *  where a player has skills but no rolled grade). Thresholds are the
 *  midpoints between adjacent `GRADE_CEILING_MEAN` anchors. */
export function gradeFromOverall(overall: number): TalentGrade {
  if (overall >= 91) return 'ELITE';
  if (overall >= 85) return 'STAR';
  if (overall >= 79) return 'HIGH_STARTER';
  if (overall >= 73) return 'STARTER';
  if (overall >= 67) return 'WEAK_STARTER';
  if (overall >= 61) return 'ROTATIONAL';
  if (overall >= 55) return 'BACKUP';
  return 'FRINGE';
}

/**
 * How fully a player has reached their ceiling, by life-stage and skill
 * category. Per the Player Development design doc:
 *   - Physical attributes barely grow after entering NFL.
 *   - Technical and mental skills grow substantially through prime.
 *   - Stable traits (work ethic, etc.) barely move.
 *
 * `current = ceiling * ratio + small noise`, clamped to ceiling.
 */
const REALIZATION_BY_STAGE: Record<AgeStage, { physical: number; technical: number; mental: number; stable: number }> = {
  ROOKIE:     { physical: 0.95, technical: 0.62, mental: 0.60, stable: 0.90 },
  DEVELOPING: { physical: 1.00, technical: 0.78, mental: 0.78, stable: 0.95 },
  PRIME:      { physical: 1.00, technical: 0.97, mental: 0.97, stable: 1.00 },
  VETERAN:    { physical: 0.90, technical: 1.00, mental: 1.00, stable: 1.00 },
  AGING:      { physical: 0.78, technical: 1.00, mental: 1.00, stable: 1.00 },
};

/** Legacy 4-tier roll — now derived from the fine grade so the distribution
 *  is identical and the two stay consistent. */
export function rollTalentTier(prng: Prng): TalentTier {
  return gradeToTier(rollTalentGrade(prng));
}

export interface RolledSkills {
  current: PlayerSkills;
  ceiling: PlayerSkills;
  tier: TalentTier;
  talentGrade: TalentGrade;
}

/**
 * Roll current and ceiling skill ratings for a player.
 *
 * Algorithm:
 *   1. Pick talent tier (5/35/40/20 STAR/STARTER/BACKUP/FRINGE).
 *   2. For each skill: roll ceiling = gaussian(tier_mean × archetype_weight, σ=7).
 *   3. For each skill: current = ceiling × stage_realization + noise.
 *   4. Clamp current ≤ ceiling, both within [1, 99].
 *
 * Output is deterministic for a given prng + archetype + ageStage.
 */
export function rollSkills(
  prng: Prng,
  archetype: PlayerArchetype,
  ageStage: AgeStage,
): RolledSkills {
  const talentGrade = rollTalentGrade(prng);
  const tier = gradeToTier(talentGrade);
  const ceilingBaseline = GRADE_CEILING_MEAN[talentGrade];
  const realization = REALIZATION_BY_STAGE[ageStage];

  const ceiling = {} as PlayerSkills;
  const current = {} as PlayerSkills;

  for (const key of ALL_SKILL_KEYS) {
    // Granular skills inherit their parent umbrella's weight unless the
    // archetype overrides them specifically (see skill-keys.ts).
    const weight = effectiveSkillWeight(archetype.skillWeights, key);
    // Linear weight bias: each unit of weight above/below 1.0 shifts the
    // mean by ~7 points. This preserves *tier* separation across all
    // skills (stars have higher means than starters even on weighted
    // skills) while still letting archetype priorities show through.
    //
    // Earlier formulation (multiplicative + 95-cap) was buggy: stars
    // and starters both pinned at 95 on weighted skills, which in turn
    // made deriveTier read everyone as a star and inflated cap usage.
    const weightedMean = clamp(ceilingBaseline + (weight - 1) * 7, 25, 99);
    const ceilVal = Math.round(prng.normal(weightedMean, 7, { min: 1, max: 99 }));
    ceiling[key] = ceilVal;

    const cat = categoryFor(key);
    const ratio = realization[cat];
    // Small noise so two players with identical archetype+tier+age aren't
    // numerically identical on every skill.
    const noisyCurrent = Math.round(ceilVal * ratio + prng.normal(0, 2));
    current[key] = Math.min(ceilVal, Math.max(1, noisyCurrent));
  }

  return { current, ceiling, tier, talentGrade };
}

/**
 * Roll a development archetype uniformly. The Player Development doc
 * doesn't specify a distribution; uniform is a reasonable starting
 * point, tunable later if we observe imbalance in long-running sims.
 */
const DEVELOPMENT_ARCHETYPES: readonly PlayerDevelopmentArchetype[] = [
  'FAST_LEARNER',
  'SLOW_STEADY',
  'ADVERSITY_DRIVEN',
  'EARLY_BLOOMER',
  'LATE_DEVELOPER',
  'CONFIDENCE_DEPENDENT',
];

export function rollDevelopmentArchetype(prng: Prng): PlayerDevelopmentArchetype {
  return prng.pick(DEVELOPMENT_ARCHETYPES);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
