import type { Player } from '../types/player.js';
import type {
  OffensiveSchemeArchetype,
  DefensiveSchemeArchetype,
} from '../types/personnel.js';
import { getArchetypeById, type ArchetypeId } from '../archetypes/index.js';

/**
 * Look up the offensive scheme fit multiplier for an archetype + scheme.
 * Returns 1.0 (neutral) if the archetype isn't registered for the scheme
 * or if it's a defensive archetype.
 */
export function offensiveSchemeFit(
  archetypeId: ArchetypeId,
  scheme: OffensiveSchemeArchetype,
): number {
  const archetype = getArchetypeById(archetypeId);
  if (!archetype) return 1.0;
  if (archetype.side !== 'OFFENSE') return 1.0;
  return archetype.offensiveSchemeFit?.[scheme] ?? 1.0;
}

/**
 * Look up the defensive scheme fit multiplier for an archetype + scheme.
 * Returns 1.0 (neutral) if the archetype isn't registered for the scheme
 * or if it's an offensive archetype.
 */
export function defensiveSchemeFit(
  archetypeId: ArchetypeId,
  scheme: DefensiveSchemeArchetype,
): number {
  const archetype = getArchetypeById(archetypeId);
  if (!archetype) return 1.0;
  if (archetype.side !== 'DEFENSE') return 1.0;
  return archetype.defensiveSchemeFit?.[scheme] ?? 1.0;
}

/**
 * Compute the scheme fit for a player given a team's offensive and
 * defensive scheme. Each player's archetype is read from `player.archetype`,
 * and the appropriate side (offensive vs defensive) determines which
 * scheme to consult.
 *
 * Special-teams archetypes are scheme-neutral (always 1.0).
 *
 * Returns the multiplier in the [0.5, 1.7] range typical of the catalog.
 */
export function schemeFitForPlayer(
  player: Pick<Player, 'archetype'>,
  context: {
    offensiveScheme: OffensiveSchemeArchetype;
    defensiveScheme: DefensiveSchemeArchetype;
  },
): number {
  const archetype = getArchetypeById(player.archetype as ArchetypeId);
  if (!archetype) return 1.0;
  switch (archetype.side) {
    case 'OFFENSE':
      return archetype.offensiveSchemeFit?.[context.offensiveScheme] ?? 1.0;
    case 'DEFENSE':
      return archetype.defensiveSchemeFit?.[context.defensiveScheme] ?? 1.0;
    case 'SPECIAL_TEAMS':
      return 1.0;
    default:
      return 1.0;
  }
}
