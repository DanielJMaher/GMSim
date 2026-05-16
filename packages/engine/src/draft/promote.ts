import type { Prng } from '../prng/index.js';
import type { CollegePlayer } from '../types/college.js';
import type { Player } from '../types/player.js';
import type { Contract } from '../types/contract.js';
import type { TeamId, ContractId } from '../types/ids.js';
import { generateRookieContract } from '../contracts/rookie-scale.js';
import { rollMoodProfile } from '../players/mood-profile.js';
import { positionGroupFor } from '../players/position-group.js';

export interface PromoteOptions {
  prospect: CollegePlayer;
  teamId: TeamId;
  /** Tick at which the rookie contract signs. */
  signedOnTick: number;
  /**
   * Overall draft pick (1..224 across 7 rounds). Drives rookie-scale
   * contract value — top picks get bigger deals, late picks land near
   * league minimum. Defaults to 32 (end-of-round-1) for callers that
   * don't have a real pick number (e.g. tests).
   */
  overallPick?: number;
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
  const { prospect, teamId, signedOnTick, overallPick = 32 } = options;
  const player = buildBaseRookiePlayer(prng, prospect, teamId);
  const contract = generateRookieContract({
    player,
    idSuffix: String(player.id),
    currentTick: signedOnTick,
    overallPick,
  });
  const contractId: ContractId = contract.id;
  return {
    player: { ...player, contractId },
    contract,
  };
}

/**
 * Promote a `CollegePlayer` directly to the free-agent pool. Same
 * conversion as `promoteProspectToPlayer` but with:
 *   - teamId: null (FA)
 *   - contractId: null (no current deal)
 *
 * Used for UDFAs — declared prospects who went undrafted across all
 * 7 rounds. They sit in the FA pool until a team signs them via
 * `refillRosters` next offseason (or via midseason FA signings if
 * those run on them). Same shape as any other unsigned NFL player.
 */
export function promoteProspectToFreeAgent(
  prng: Prng,
  prospect: CollegePlayer,
): Player {
  return buildBaseRookiePlayer(prng, prospect, null);
}

/**
 * Shared player-record construction for both drafted-prospect and
 * UDFA promotion. Mapping (identical for both paths):
 *   - position: prospect's `nflProjectedPosition` (conversion candidates
 *     land at their projected NFL spot, not their college position)
 *   - skills (current + ceiling): carry through verbatim — the engine's
 *     truth doesn't change because the player crossed into the NFL
 *   - archetype: true archetype (the assumedArchetype reflects college
 *     coaching's read; once an NFL player, the misread layer is moot for
 *     game-sim purposes)
 *   - tier + developmentArchetype: carry through
 *   - moodProfile: rolled fresh — college prospects don't have one
 *     (intangibles cover a different facet)
 *   - mood: starts at moodProfile.setPoint
 *   - experienceYears: 0 (rookie)
 *   - injury, conditioning, careerStats, careerAwards, tradeRequestedOnTick:
 *     defaults
 */
function buildBaseRookiePlayer(
  prng: Prng,
  prospect: CollegePlayer,
  teamId: TeamId | null,
): Player {
  const position = prospect.nflProjectedPosition;
  const positionGroup = positionGroupFor(position);
  const moodProfile = rollMoodProfile(prng.fork('mood'));
  return {
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
}
