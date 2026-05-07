import type { Prng } from '../prng/index.js';
import type { Player } from '../types/player.js';
import type { TeamId } from '../types/ids.js';
import type {
  OffensiveSchemeArchetype,
  DefensiveSchemeArchetype,
} from '../types/personnel.js';
import { generatePlayer } from './generate.js';
import { ROSTER_BLUEPRINT_53 } from './roster-blueprint.js';
import type { PlayerArchetype } from '../archetypes/types.js';
import { positionGroupFor } from './position-group.js';
import { PositionGroup } from '../types/enums.js';

export interface GenerateRosterOptions {
  teamId: TeamId;
  /** ID prefix for generated players. Typically the team abbreviation. */
  idPrefix: string;
  /** Schemes for archetype-weighted generation. */
  offensiveScheme: OffensiveSchemeArchetype;
  defensiveScheme: DefensiveSchemeArchetype;
}

/**
 * Generate a 53-player roster for one team. Each player is assigned to
 * `teamId` and given a unique ID. Archetype selection is weighted by
 * the team's scheme so rosters tend to be scheme-coherent without being
 * uniformly so (a real NFL roster always has scheme-mismatch holdovers).
 */
export function generateRoster(prng: Prng, options: GenerateRosterOptions): readonly Player[] {
  const players: Player[] = [];
  let counter = 0;

  for (const slot of ROSTER_BLUEPRINT_53) {
    for (let i = 0; i < slot.count; i++) {
      const idSuffix = `${options.idPrefix}_${slot.position}_${i}`;
      const positionGroup = positionGroupFor(slot.position);
      const side = sideForGroup(positionGroup);

      const player = generatePlayer(prng.fork(`p:${counter}`), {
        position: slot.position,
        idSuffix,
        schemeContext: {
          side,
          offensiveScheme: options.offensiveScheme,
          defensiveScheme: options.defensiveScheme,
        },
      });
      players.push({ ...player, teamId: options.teamId });
      counter++;
    }
  }

  return players;
}

function sideForGroup(group: PositionGroup): PlayerArchetype['side'] {
  switch (group) {
    case PositionGroup.QB:
    case PositionGroup.SKILL:
    case PositionGroup.OL:
      return 'OFFENSE';
    case PositionGroup.DL:
    case PositionGroup.LB:
    case PositionGroup.DB:
      return 'DEFENSE';
    case PositionGroup.ST:
      return 'SPECIAL_TEAMS';
    default: {
      const _exhaustive: never = group;
      throw new Error(`Unknown position group: ${String(_exhaustive)}`);
    }
  }
}
