import type { PlayerSkills } from '../types/player.js';
import type { ArchetypeId } from './types.js';
import { getArchetypeById } from './index.js';

/**
 * Position-aware "how good is this player" composite: the mean of the
 * archetype's KEY skills — those the archetype weights ≥ 1.2, i.e. the
 * skills that actually define the position (a route tree for a separator WR,
 * a pass-rush repertoire for a speed edge, man coverage for a press CB).
 *
 * This is the same signal the NFL game sim uses (games/strength keySkillAvg);
 * sharing it lets the college sim read a granular, position-specific profile
 * instead of a flat (technicalSkill + footballIq + speed)/3 stub. Falls back
 * to that triplet when an archetype has no ≥1.2 keys.
 */
const FALLBACK_KEYS: readonly (keyof PlayerSkills)[] = ['technicalSkill', 'footballIq', 'speed'];

export function keySkillAverage(skills: PlayerSkills, archetypeId: ArchetypeId): number {
  const archetype = getArchetypeById(archetypeId);
  const keys = archetype
    ? (Object.entries(archetype.skillWeights)
        .filter(([, w]) => (w ?? 1) >= 1.2)
        .map(([k]) => k as keyof PlayerSkills))
    : [];
  const useKeys = keys.length > 0 ? keys : FALLBACK_KEYS;
  let sum = 0;
  for (const k of useKeys) sum += skills[k];
  return sum / useKeys.length;
}
