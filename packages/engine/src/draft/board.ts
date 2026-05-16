import type { TeamId, ScoutId, PlayerId } from '../types/ids.js';
import type { PositionGroup } from '../types/enums.js';
import type {
  CollegePlayer,
  CollegePlayerObservation,
  CollegeScout,
  DraftBoardEntry,
  DraftBoardReason,
} from '../types/college.js';
import type { TeamState } from '../types/team.js';
import type { Player, PlayerSkills } from '../types/player.js';
import type { HeadCoach } from '../types/personnel.js';
import { getArchetypeById } from '../archetypes/index.js';
import { schemeFitForPlayer } from '../scheme/index.js';
import { positionGroupFor } from '../players/position-group.js';

const DRAFT_BOARD_SIZE = 50;

/**
 * Position-group depth targets used by the draft-board need score.
 * A team well below target at a position group elevates prospects
 * who project there. Slightly thinner than the FA watch-list
 * targets because draft-board need is a long-term planning lens
 * (1-3 year payoff), not an immediate-roster-shortfall one.
 */
const POSITION_GROUP_TARGETS: Record<PositionGroup, number> = {
  QB: 3,
  SKILL: 12,
  OL: 9,
  DL: 8,
  LB: 7,
  DB: 10,
  ST: 3,
};

/**
 * Build all 32 teams' internal draft boards from the league's
 * college observations. Pure function — no PRNG. Mirrors the
 * NFL `regenerateWatchLists` approach so the same confidence-
 * weighted aggregation pattern carries over.
 *
 *   1. Index observations by the team-of-scout that filed them.
 *   2. For each team:
 *        a. Group its observations by collegePlayerId.
 *        b. Confidence-weight observed key skills into one aggregate.
 *        c. priority = observedSkillScore × schemeFit × meanConfidence × need
 *        d. Sort desc, take top N.
 *        e. Derive a `DraftBoardReason` from which component drove it.
 */
export function regenerateDraftBoards(
  teams: Readonly<Record<TeamId, TeamState>>,
  _collegeScouts: Readonly<Record<ScoutId, CollegeScout>>,
  coaches: Readonly<Record<string, HeadCoach>>,
  collegePool: readonly CollegePlayer[],
  observations: readonly CollegePlayerObservation[],
  addedOnTick: number,
): Record<TeamId, DraftBoardEntry[]> {
  // Index prospects by id for O(1) lookup.
  const prospectById = new Map<PlayerId, CollegePlayer>();
  for (const cp of collegePool) prospectById.set(cp.id, cp);

  // Map collegeScoutId -> teamId for observation routing.
  const scoutToTeam = new Map<ScoutId, TeamId>();
  for (const team of Object.values(teams)) {
    for (const sid of team.collegeScoutIds) scoutToTeam.set(sid, team.identity.id);
  }

  // Bucket observations by owning team.
  const obsByTeam = new Map<TeamId, CollegePlayerObservation[]>();
  for (const obs of observations) {
    const teamId = scoutToTeam.get(obs.scoutId);
    if (!teamId) continue;
    let bucket = obsByTeam.get(teamId);
    if (!bucket) {
      bucket = [];
      obsByTeam.set(teamId, bucket);
    }
    bucket.push(obs);
  }

  // Compute each team's NFL position-group depth (drives the need
  // score). Counted off `team.rosterIds` against `league.players` —
  // but we don't have that map in this signature. Pass it in via
  // the team-shaped need below; for the slice-3 caller we accept
  // a `players` map argument so the count is exact.
  const out: Record<TeamId, DraftBoardEntry[]> = {} as Record<TeamId, DraftBoardEntry[]>;

  for (const teamId of Object.keys(teams) as TeamId[]) {
    const team = teams[teamId]!;
    const hc = coaches[team.headCoachId];
    if (!hc) {
      out[teamId] = [];
      continue;
    }
    const teamObs = obsByTeam.get(teamId) ?? [];
    out[teamId] = buildBoardForTeam(
      teamObs,
      prospectById,
      hc,
      team,
      addedOnTick,
    );
  }
  return out;
}

/**
 * Higher-level entry point that takes the full league and computes
 * each team's positional-need scores from their current NFL roster.
 * `regenerateDraftBoards` could compute these internally too, but
 * keeping the per-roster scan separate keeps the signature small.
 */
export function regenerateDraftBoardsForLeague(args: {
  teams: Readonly<Record<TeamId, TeamState>>;
  collegeScouts: Readonly<Record<ScoutId, CollegeScout>>;
  coaches: Readonly<Record<string, HeadCoach>>;
  players: Readonly<Record<string, Player>>;
  collegePool: readonly CollegePlayer[];
  observations: readonly CollegePlayerObservation[];
  addedOnTick: number;
}): Record<TeamId, DraftBoardEntry[]> {
  const needScoresByTeam = new Map<TeamId, Record<PositionGroup, number>>();
  for (const team of Object.values(args.teams)) {
    needScoresByTeam.set(team.identity.id, computeDraftNeedScores(team, args.players));
  }
  return regenerateDraftBoardsInternal({ ...args, needScoresByTeam });
}

function regenerateDraftBoardsInternal(args: {
  teams: Readonly<Record<TeamId, TeamState>>;
  collegeScouts: Readonly<Record<ScoutId, CollegeScout>>;
  coaches: Readonly<Record<string, HeadCoach>>;
  collegePool: readonly CollegePlayer[];
  observations: readonly CollegePlayerObservation[];
  needScoresByTeam: Map<TeamId, Record<PositionGroup, number>>;
  addedOnTick: number;
}): Record<TeamId, DraftBoardEntry[]> {
  const prospectById = new Map<PlayerId, CollegePlayer>();
  for (const cp of args.collegePool) prospectById.set(cp.id, cp);

  const scoutToTeam = new Map<ScoutId, TeamId>();
  for (const team of Object.values(args.teams)) {
    for (const sid of team.collegeScoutIds) scoutToTeam.set(sid, team.identity.id);
  }

  const obsByTeam = new Map<TeamId, CollegePlayerObservation[]>();
  for (const obs of args.observations) {
    const teamId = scoutToTeam.get(obs.scoutId);
    if (!teamId) continue;
    let bucket = obsByTeam.get(teamId);
    if (!bucket) {
      bucket = [];
      obsByTeam.set(teamId, bucket);
    }
    bucket.push(obs);
  }

  const out: Record<TeamId, DraftBoardEntry[]> = {} as Record<TeamId, DraftBoardEntry[]>;
  for (const teamId of Object.keys(args.teams) as TeamId[]) {
    const team = args.teams[teamId]!;
    const hc = args.coaches[team.headCoachId];
    const need = args.needScoresByTeam.get(teamId);
    if (!hc || !need) {
      out[teamId] = [];
      continue;
    }
    const teamObs = obsByTeam.get(teamId) ?? [];
    out[teamId] = buildBoardForTeamWithNeed(
      teamObs,
      prospectById,
      hc,
      need,
      args.addedOnTick,
    );
  }
  return out;
}

function buildBoardForTeam(
  teamObservations: readonly CollegePlayerObservation[],
  prospectById: Map<PlayerId, CollegePlayer>,
  hc: HeadCoach,
  _team: TeamState,
  addedOnTick: number,
): DraftBoardEntry[] {
  // Without a roster-need map we use neutral need 1.0 across the board.
  // The richer caller (regenerateDraftBoardsForLeague) supplies real need.
  const need: Record<PositionGroup, number> = {
    QB: 1, SKILL: 1, OL: 1, DL: 1, LB: 1, DB: 1, ST: 1,
  };
  return buildBoardForTeamWithNeed(teamObservations, prospectById, hc, need, addedOnTick);
}

function buildBoardForTeamWithNeed(
  teamObservations: readonly CollegePlayerObservation[],
  prospectById: Map<PlayerId, CollegePlayer>,
  hc: HeadCoach,
  needScores: Readonly<Record<PositionGroup, number>>,
  addedOnTick: number,
): DraftBoardEntry[] {
  const byProspect = new Map<PlayerId, CollegePlayerObservation[]>();
  for (const obs of teamObservations) {
    let bucket = byProspect.get(obs.collegePlayerId);
    if (!bucket) {
      bucket = [];
      byProspect.set(obs.collegePlayerId, bucket);
    }
    bucket.push(obs);
  }

  const entries: DraftBoardEntry[] = [];
  for (const [collegePlayerId, obsList] of byProspect) {
    const prospect = prospectById.get(collegePlayerId);
    if (!prospect) continue;
    const aggregated = aggregateCollegeObservations(obsList, prospect);
    const schemeFit = schemeFitForCollegeProspect(prospect, hc);
    const projGroup = positionGroupFor(prospect.nflProjectedPosition);
    const need = needScores[projGroup] ?? 1.0;
    const priority = Math.max(
      0,
      aggregated.observedSkillScore * schemeFit * aggregated.meanConfidence * need,
    );
    const reason = deriveDraftBoardReason(
      prospect,
      aggregated.observedSkillScore,
      aggregated.meanConfidence,
      schemeFit,
      need,
    );

    entries.push({
      collegePlayerId,
      priority: round1(priority),
      reason,
      observedSkillScore: round1(aggregated.observedSkillScore),
      schemeFit: round2(schemeFit),
      meanConfidence: round2(aggregated.meanConfidence),
      observationCount: obsList.length,
      addedOnTick,
    });
  }

  entries.sort((a, b) => b.priority - a.priority);
  return entries.slice(0, DRAFT_BOARD_SIZE);
}

interface AggregatedCollegeObservation {
  observedSkillScore: number;
  meanConfidence: number;
}

/**
 * Confidence-weighted aggregate of one prospect's observations from
 * one team's scouts. The "observed key skill" is averaged over the
 * skills with archetype weight ≥ 1.2 (skills that actually matter
 * for this archetype). Falls back to a small default set when the
 * archetype is unknown / has no high-weight skills.
 */
function aggregateCollegeObservations(
  observations: readonly CollegePlayerObservation[],
  prospect: CollegePlayer,
): AggregatedCollegeObservation {
  const archetype = getArchetypeById(prospect.archetype);
  const keys: (keyof PlayerSkills)[] = archetype
    ? (Object.entries(archetype.skillWeights)
        .filter(([, w]) => (w ?? 1) >= 1.2)
        .map(([k]) => k as keyof PlayerSkills))
    : ['technicalSkill', 'footballIq', 'speed'];
  if (keys.length === 0) keys.push('technicalSkill');

  let skillSum = 0;
  let skillWeight = 0;
  let confidenceSum = 0;
  let confidenceCount = 0;

  for (const obs of observations) {
    for (const key of keys) {
      const value = obs.skills[key];
      const conf = obs.confidence[key];
      if (value === undefined || conf === undefined) continue;
      skillSum += value * conf;
      skillWeight += conf;
    }
    for (const conf of Object.values(obs.confidence)) {
      if (typeof conf !== 'number') continue;
      confidenceSum += conf;
      confidenceCount++;
    }
  }

  return {
    observedSkillScore: skillWeight > 0 ? skillSum / skillWeight : 0,
    meanConfidence: confidenceCount > 0 ? confidenceSum / confidenceCount : 0,
  };
}

/**
 * Project a `CollegePlayer` into the minimal `Player`-like shape
 * the scheme-fit calculator reads. The calculator only consults
 * `archetype` and the side it implies — perfectly safe.
 */
function schemeFitForCollegeProspect(prospect: CollegePlayer, hc: HeadCoach): number {
  const playerLike = {
    archetype: prospect.archetype,
    position: prospect.nflProjectedPosition,
  } as unknown as Player;
  return schemeFitForPlayer(playerLike, {
    offensiveScheme: hc.offensiveScheme,
    defensiveScheme: hc.defensiveScheme,
  });
}

function deriveDraftBoardReason(
  prospect: CollegePlayer,
  observedSkillScore: number,
  meanConfidence: number,
  schemeFit: number,
  need: number,
): DraftBoardReason {
  // Conversion projection takes priority when scheme fit is strong AND
  // the prospect is a primary conversion candidate — that's the
  // "creative team identified him" narrative.
  if (prospect.isConversionCandidate && schemeFit >= 1.15) {
    return 'CONVERSION_PROJECTION';
  }
  // Blue chip — high observed skill + strong confidence (lots of
  // reports agreeing).
  if (observedSkillScore >= 80 && meanConfidence >= 0.55) {
    return 'BLUE_CHIP';
  }
  if (schemeFit >= 1.3) return 'SCHEME_FIT';
  if (need >= 1.15) return 'POSITIONAL_NEED';
  // Big ceiling-vs-current gap → developmental project.
  // Use the prospect's true ceiling here (engine-side derivation, not
  // UI-displayable per North Star — the team's UI surfaces only
  // descriptive language about upside).
  const cgap = ceilingMean(prospect.ceiling) - currentMean(prospect.current);
  if (cgap >= 12) return 'DEVELOPMENTAL';
  // Default
  return 'BLUE_CHIP';
}

function ceilingMean(s: PlayerSkills): number {
  return (s.speed + s.acceleration + s.agility + s.strength + s.technicalSkill +
    s.footballIq + s.decisionMaking + s.handsBallSkills) / 8;
}
function currentMean(s: PlayerSkills): number {
  return (s.speed + s.acceleration + s.agility + s.strength + s.technicalSkill +
    s.footballIq + s.decisionMaking + s.handsBallSkills) / 8;
}

/**
 * Compute per-position-group need scores for a team's draft board.
 * Same shape as the FA watch-list need computation but a touch
 * softer (sqrt floor at 0.85, ceiling at 1.25) — draft is long-term
 * planning, not crisis hiring. A team thin at OL still considers
 * top WR talent.
 */
function computeDraftNeedScores(
  team: TeamState,
  players: Readonly<Record<string, Player>>,
): Record<PositionGroup, number> {
  const counts: Record<PositionGroup, number> = {
    QB: 0, SKILL: 0, OL: 0, DL: 0, LB: 0, DB: 0, ST: 0,
  };
  for (const pid of team.rosterIds) {
    const p = players[pid];
    if (!p) continue;
    counts[p.positionGroup]++;
  }
  const scores: Record<PositionGroup, number> = {} as Record<PositionGroup, number>;
  for (const group of Object.keys(counts) as PositionGroup[]) {
    const ratio = POSITION_GROUP_TARGETS[group] / Math.max(1, counts[group]);
    scores[group] = clamp(Math.sqrt(ratio), 0.85, 1.25);
  }
  return scores;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
