import type { Prng } from '../prng/index.js';
import type { CollegePlayer } from '../types/college.js';
import type { Player } from '../types/player.js';
import type { Position } from '../types/enums.js';
import type { Contract } from '../types/contract.js';
import type { TeamId, ContractId } from '../types/ids.js';
import { generateRookieContract } from '../contracts/rookie-scale.js';
import { rollMoodProfile } from '../players/mood-profile.js';
import { positionGroupFor } from '../players/position-group.js';
import { provenanceFromOverallPick, type DraftProvenance } from '../players/draft-provenance.js';
import { backstoryFromProspect } from '../players/backstory.js';
import { assignAbilities } from '../players/abilities.js';
import { gradeFromOverall, seedTalentScoreFromGrade } from '../players/skills.js';
import type { PlayerSkills } from '../types/player.js';

function meanOfSkills(skills: PlayerSkills): number {
  const v = Object.values(skills);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
}

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
  /**
   * The NFL position to play this rookie at — overrides the prospect's
   * `nflProjectedPosition` when a team drafts him to CONVERT to a needed spot
   * (a projected RT a left-tackle-needy team plays at LT). Must be his natural
   * position or a realistic conversion of it (the board guarantees this). When
   * omitted, he lands at his natural projected position.
   */
  assignedPosition?: Position;
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
  const player = buildBaseRookiePlayer(
    prng,
    prospect,
    teamId,
    provenanceFromOverallPick(overallPick),
    options.assignedPosition,
  );
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
  provenance: DraftProvenance = { round: null, overallPick: null },
  assignedPosition?: Position,
): Player {
  // A team that drafts him to convert plays him at the assigned spot; otherwise
  // his natural projected position. Skills/ceiling/archetype carry through
  // unchanged — only where he lines up moves.
  const position = assignedPosition ?? prospect.nflProjectedPosition;
  const positionGroup = positionGroupFor(position);
  const moodProfile = rollMoodProfile(prng.fork('mood'));
  // College prospects carry only the coarse tier; derive the fine grade from
  // their ceiling (the Skill Adjudicator resolution) at promotion, and seed the
  // sustained-talent score from it (the offseason re-grade pass takes over).
  const talentGrade = gradeFromOverall(meanOfSkills(prospect.ceiling));
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
    talentGrade,
    talentScore: seedTalentScoreFromGrade(talentGrade),
    archetype: prospect.archetype,
    injury: null,
    conditioning: 100,
    tradeRequestedOnTick: null,
    moodProfile,
    mood: moodProfile.setPoint,
    careerStats: [],
    careerAwards: [],
    draftRound: provenance.round,
    draftOverallPick: provenance.overallPick,
    // Carry the prospect's real college backstory into the NFL record (v0.119).
    collegeBackstory: backstoryFromProspect(prospect),
    // Carry the prospect's real combine size through to the NFL record.
    heightInches: prospect.measurables.heightInches,
    weightLbs: prospect.measurables.weightLbs,
    armLengthInches: prospect.measurables.armLengthInches,
    handSizeInches: prospect.measurables.handSizeInches,
    abilities: assignAbilities(prng.fork('abilities'), positionGroup, prospect.current),
  };
}
