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
import { Position, PositionGroup } from '../types/enums.js';

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

      // QB-room-spread fix (`_inj_tm_report.md` T1, 2026-07-20): the roster
      // blueprint's first QB slot (i===0) is the presumptive starter and rolls
      // from the unbiased grade distribution unchanged; the remaining QB slots
      // are backup-track and get the depth-aware downshift (see
      // `BACKUP_QB_CEILING_DISCOUNT` in `players/skills.ts`). Every other
      // position is untouched — the measured real bar and validating gates
      // (P3 fingerprint, Goatinator QB share) are QB-specific.
      const player = generatePlayer(prng.fork(`p:${counter}`), {
        position: slot.position,
        idSuffix,
        schemeContext: {
          side,
          offensiveScheme: options.offensiveScheme,
          defensiveScheme: options.defensiveScheme,
        },
        backupTilt: slot.position === Position.QB && i > 0,
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
