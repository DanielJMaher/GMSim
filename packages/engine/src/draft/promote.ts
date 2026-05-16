import type { Prng } from '../prng/index.js';
import type { CollegePlayer } from '../types/college.js';
import type { Player } from '../types/player.js';
import type { Contract } from '../types/contract.js';
import type { TeamId, ContractId } from '../types/ids.js';
import { generateContract } from '../contracts/generate.js';
import { rollMoodProfile } from '../players/mood-profile.js';
import { positionGroupFor } from '../players/position-group.js';

export interface PromoteOptions {
  prospect: CollegePlayer;
  teamId: TeamId;
  /** Tick at which the rookie contract signs. */
  signedOnTick: number;
}

export interface PromoteResult {
  player: Player;
  contract: Contract;
}

/**
 * Convert a drafted `CollegePlayer` into an NFL `Player` + rookie
 * contract. Shared `PlayerId` namespace means the promoted player
 * keeps the same id as the prospect — references upstream stay valid.
 *
 * Mapping:
 *   - position: prospect's `nflProjectedPosition` (conversion candidates
 *     land at their projected NFL spot, not their college position)
 *   - skills (current + ceiling): carry through verbatim — the engine's
 *     truth doesn't change because the player crossed into the NFL
 *   - archetype: true archetype (the assumedArchetype reflects college
 *     coaching's read; once drafted, the NFL team's evaluation no longer
 *     needs the misread layer for game-sim purposes)
 *   - tier + developmentArchetype: carry through
 *   - moodProfile: rolled fresh — college prospects don't have one
 *     (intangibles cover a different facet)
 *   - mood: starts at moodProfile.setPoint
 *   - experienceYears: 0 (rookie)
 *   - injury, conditioning, careerStats, careerAwards, tradeRequestedOnTick:
 *     defaults
 */
export function promoteProspectToPlayer(
  prng: Prng,
  options: PromoteOptions,
): PromoteResult {
  const { prospect, teamId, signedOnTick } = options;
  const position = prospect.nflProjectedPosition;
  const positionGroup = positionGroupFor(position);
  const moodProfile = rollMoodProfile(prng.fork('mood'));

  const player: Player = {
    id: prospect.id,
    firstName: prospect.firstName,
    lastName: prospect.lastName,
    position,
    positionGroup,
    experienceYears: 0,
    birthDate: prospect.birthDate,
    teamId,
    contractId: null,
    current: prospect.current,
    ceiling: prospect.ceiling,
    developmentArchetype: prospect.developmentArchetype,
    tier: prospect.tier,
    archetype: prospect.archetype,
    injury: null,
    conditioning: 100,
    tradeRequestedOnTick: null,
    moodProfile,
    mood: moodProfile.setPoint,
    careerStats: [],
    careerAwards: [],
  };
  const contract = generateContract(prng.fork('contract'), {
    player,
    idSuffix: String(player.id),
    currentTick: signedOnTick,
    fresh: true,
  });
  const contractId: ContractId = contract.id;
  return {
    player: { ...player, contractId },
    contract,
  };
}
