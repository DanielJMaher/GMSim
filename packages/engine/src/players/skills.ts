import type { Prng } from '../prng/index.js';
import type {
  PlayerSkills,
  PlayerDevelopmentArchetype,
  TalentTier,
} from '../types/player.js';
import type { PlayerArchetype } from '../archetypes/types.js';
import type { AgeStage } from './age.js';

export type { TalentTier } from '../types/player.js';

const TIER_WEIGHTS = [
  { value: 'STAR' as TalentTier, weight: 5 },
  { value: 'STARTER' as TalentTier, weight: 35 },
  { value: 'BACKUP' as TalentTier, weight: 40 },
  { value: 'FRINGE' as TalentTier, weight: 20 },
];

/** Mean ceiling (max-potential) baseline for each tier. */
const TIER_CEILING_MEAN: Record<TalentTier, number> = {
  STAR: 90,
  STARTER: 78,
  BACKUP: 66,
  FRINGE: 54,
};

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

const PHYSICAL_KEYS: readonly (keyof PlayerSkills)[] = [
  'speed', 'acceleration', 'agility', 'strength', 'durability',
];

const TECHNICAL_KEYS: readonly (keyof PlayerSkills)[] = [
  'technicalSkill', 'handsBallSkills', 'blockingTechnique',
  'passRushTechnique', 'coverageTechnique', 'tacklingTechnique',
];

const MENTAL_KEYS: readonly (keyof PlayerSkills)[] = [
  'footballIq', 'decisionMaking', 'leadership', 'composure',
];

const STABLE_KEYS: readonly (keyof PlayerSkills)[] = [
  'competitiveness', 'workEthic', 'coachability',
];

const ALL_SKILL_KEYS: readonly (keyof PlayerSkills)[] = [
  ...PHYSICAL_KEYS, ...TECHNICAL_KEYS, ...MENTAL_KEYS, ...STABLE_KEYS,
];

function categoryFor(key: keyof PlayerSkills): 'physical' | 'technical' | 'mental' | 'stable' {
  if (PHYSICAL_KEYS.includes(key)) return 'physical';
  if (TECHNICAL_KEYS.includes(key)) return 'technical';
  if (MENTAL_KEYS.includes(key)) return 'mental';
  return 'stable';
}

export function rollTalentTier(prng: Prng): TalentTier {
  return prng.weighted(TIER_WEIGHTS);
}

export interface RolledSkills {
  current: PlayerSkills;
  ceiling: PlayerSkills;
  tier: TalentTier;
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
  const tier = rollTalentTier(prng);
  const ceilingBaseline = TIER_CEILING_MEAN[tier];
  const realization = REALIZATION_BY_STAGE[ageStage];

  const ceiling = {} as PlayerSkills;
  const current = {} as PlayerSkills;

  for (const key of ALL_SKILL_KEYS) {
    const weight = archetype.skillWeights[key] ?? 1.0;
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

  return { current, ceiling, tier };
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
