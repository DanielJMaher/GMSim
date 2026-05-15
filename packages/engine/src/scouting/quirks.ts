import type { ScoutQuirk } from '../types/scout.js';
import type { Player, PlayerSkills } from '../types/player.js';

export const SCOUT_QUIRK_POOL: readonly ScoutQuirk[] = [
  'OVERVALUES_NAME_RECOGNITION',
  'SHARP_ON_ROLE_PLAYERS',
  'MISSES_SCHEME_FIT',
  'PRACTICE_SQUAD_GEM_HUNTER',
  'YOUNG_PLAYER_BIAS',
  'VETERAN_LOYALIST',
];

/** Skills counted as "technique" — used by MISSES_SCHEME_FIT. */
const TECHNIQUE_SKILLS: ReadonlySet<keyof PlayerSkills> = new Set([
  'technicalSkill',
  'blockingTechnique',
  'passRushTechnique',
  'coverageTechnique',
  'tacklingTechnique',
]);

/**
 * Per-quirk modulation applied to one observation of one skill on one
 * player. Returns:
 *   - `noiseMultiplier` — multiplies the base noise stdev (lower = sharper)
 *   - `bias`            — additive offset to observed value (centered at 0)
 *   - `confidenceDelta` — additive offset to confidence (clamped at caller)
 *
 * Quirks compose: the caller multiplies all noise multipliers and sums
 * biases / confidence deltas across the scout's quirk list.
 */
export interface QuirkEffect {
  noiseMultiplier: number;
  bias: number;
  confidenceDelta: number;
}

const NEUTRAL: QuirkEffect = { noiseMultiplier: 1, bias: 0, confidenceDelta: 0 };

export function quirkEffect(
  quirk: ScoutQuirk,
  player: Player,
  skill: keyof PlayerSkills,
): QuirkEffect {
  switch (quirk) {
    case 'OVERVALUES_NAME_RECOGNITION':
      if (player.careerAwards.length > 0) {
        return { noiseMultiplier: 1, bias: 4 + player.careerAwards.length, confidenceDelta: 0 };
      }
      if (player.tier === 'STAR') {
        return { noiseMultiplier: 1, bias: 2, confidenceDelta: 0 };
      }
      return NEUTRAL;

    case 'SHARP_ON_ROLE_PLAYERS':
      if (player.tier === 'BACKUP' || player.tier === 'FRINGE') {
        return { noiseMultiplier: 0.6, bias: 0, confidenceDelta: 0.15 };
      }
      if (player.tier === 'STAR') {
        return { noiseMultiplier: 1.2, bias: 0, confidenceDelta: -0.05 };
      }
      return NEUTRAL;

    case 'MISSES_SCHEME_FIT':
      if (TECHNIQUE_SKILLS.has(skill)) {
        return { noiseMultiplier: 1.5, bias: 0, confidenceDelta: -0.1 };
      }
      return NEUTRAL;

    case 'PRACTICE_SQUAD_GEM_HUNTER':
      if (player.tier === 'FRINGE') {
        return { noiseMultiplier: 0.5, bias: 0, confidenceDelta: 0.2 };
      }
      return NEUTRAL;

    case 'YOUNG_PLAYER_BIAS':
      if (player.experienceYears < 3) {
        return { noiseMultiplier: 0.7, bias: 0, confidenceDelta: 0.1 };
      }
      if (player.experienceYears >= 8) {
        return { noiseMultiplier: 1.15, bias: -1, confidenceDelta: -0.05 };
      }
      return NEUTRAL;

    case 'VETERAN_LOYALIST':
      if (player.experienceYears >= 8) {
        return { noiseMultiplier: 0.75, bias: 2, confidenceDelta: 0.1 };
      }
      if (player.experienceYears < 3) {
        return { noiseMultiplier: 1.2, bias: -1, confidenceDelta: -0.05 };
      }
      return NEUTRAL;
  }
}

/**
 * Compose a scout's full quirk list into a single effect for the given
 * (player, skill) pair. Noise multipliers multiply; biases and
 * confidence deltas add.
 */
export function composedQuirkEffect(
  quirks: readonly ScoutQuirk[],
  player: Player,
  skill: keyof PlayerSkills,
): QuirkEffect {
  let noiseMultiplier = 1;
  let bias = 0;
  let confidenceDelta = 0;
  for (const q of quirks) {
    const e = quirkEffect(q, player, skill);
    noiseMultiplier *= e.noiseMultiplier;
    bias += e.bias;
    confidenceDelta += e.confidenceDelta;
  }
  return { noiseMultiplier, bias, confidenceDelta };
}
