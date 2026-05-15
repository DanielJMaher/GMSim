import type { TeamId, ScoutId, PlayerId } from '../types/ids.js';
import type { PositionGroup } from '../types/enums.js';
import type { Player, PlayerSkills } from '../types/player.js';
import type { Scout, PlayerObservation, WatchListEntry, WatchListReason } from '../types/scout.js';
import type { TeamState } from '../types/team.js';
import type { HeadCoach } from '../types/personnel.js';
import { getArchetypeById } from '../archetypes/index.js';
import { schemeFitForPlayer } from '../scheme/index.js';

const WATCH_LIST_SIZE = 15;

/** Position group depth where a team feels "at need" if below. Used by needScore. */
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
 * Build each team's initial watch list from the observations their own
 * scouts produced at league creation. One pass per team:
 *
 *   1. Group team's observations by playerId.
 *   2. Confidence-weight observed skill values into a single aggregate.
 *   3. Score: observedSkillScore × schemeFit × meanConfidence × needScore.
 *   4. Take top N by priority.
 *   5. Derive a `WatchListReason` from which component drove the score.
 *
 * Per Doc 4: "All 32 teams maintain internal watch lists." Same player
 * appearing on multiple lists is expected, not deduped.
 */
export function generateInitialWatchLists(
  teams: Readonly<Record<TeamId, TeamState>>,
  scouts: Readonly<Record<ScoutId, Scout>>,
  coaches: Readonly<Record<string, HeadCoach>>,
  players: Readonly<Record<string, Player>>,
  observations: readonly PlayerObservation[],
  addedOnTick: number,
): Record<TeamId, WatchListEntry[]> {
  // Index observations by team-of-scout. Per-team list contains every
  // (player, observation) pair from this team's own scouts.
  const obsByTeam = new Map<TeamId, PlayerObservation[]>();
  for (const obs of observations) {
    const scout = scouts[obs.scoutId];
    if (!scout) continue;
    const teamId = teamOfScout(teams, obs.scoutId);
    if (!teamId) continue;
    let bucket = obsByTeam.get(teamId);
    if (!bucket) {
      bucket = [];
      obsByTeam.set(teamId, bucket);
    }
    bucket.push(obs);
  }

  const out: Record<TeamId, WatchListEntry[]> = {} as Record<TeamId, WatchListEntry[]>;
  for (const teamId of Object.keys(teams) as TeamId[]) {
    const team = teams[teamId]!;
    const hc = coaches[team.headCoachId];
    if (!hc) {
      out[teamId] = [];
      continue;
    }
    const teamObs = obsByTeam.get(teamId) ?? [];
    const needScores = computeNeedScores(team, players);
    out[teamId] = buildWatchListForTeam(
      teamObs,
      players,
      teams,
      coaches,
      hc,
      needScores,
      addedOnTick,
    );
  }
  return out;
}

function buildWatchListForTeam(
  teamObservations: readonly PlayerObservation[],
  players: Readonly<Record<string, Player>>,
  teams: Readonly<Record<TeamId, TeamState>>,
  coaches: Readonly<Record<string, HeadCoach>>,
  hc: HeadCoach,
  needScores: Readonly<Record<PositionGroup, number>>,
  addedOnTick: number,
): WatchListEntry[] {
  const byPlayer = new Map<PlayerId, PlayerObservation[]>();
  for (const obs of teamObservations) {
    let bucket = byPlayer.get(obs.playerId);
    if (!bucket) {
      bucket = [];
      byPlayer.set(obs.playerId, bucket);
    }
    bucket.push(obs);
  }

  const entries: WatchListEntry[] = [];
  for (const [playerId, obsList] of byPlayer) {
    const player = players[playerId];
    if (!player) continue;
    const aggregated = aggregateObservations(obsList, player);
    const schemeFit = schemeFitForPlayer(player, {
      offensiveScheme: hc.offensiveScheme,
      defensiveScheme: hc.defensiveScheme,
    });
    const need = needScores[player.positionGroup] ?? 1.0;
    const priority = clamp(
      aggregated.observedSkillScore * schemeFit * aggregated.meanConfidence * need,
      0,
      100,
    );
    const reason = deriveReason(player, schemeFit, need, teams, coaches);

    entries.push({
      playerId,
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
  return entries.slice(0, WATCH_LIST_SIZE);
}

interface AggregatedObservation {
  observedSkillScore: number;
  meanConfidence: number;
}

/**
 * Confidence-weighted aggregate of one player's observations. The
 * "observed key skill" is averaged over the skills with archetype
 * weight ≥ 1.2 (the skills that actually matter for this player). If
 * the archetype is unknown or has no high-weight skills, fall back to
 * a small default set.
 */
function aggregateObservations(
  observations: readonly PlayerObservation[],
  player: Player,
): AggregatedObservation {
  const archetype = getArchetypeById(player.archetype);
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

  const observedSkillScore = skillWeight > 0 ? skillSum / skillWeight : 0;
  const meanConfidence = confidenceCount > 0 ? confidenceSum / confidenceCount : 0;
  return { observedSkillScore, meanConfidence };
}

function deriveReason(
  player: Player,
  schemeFit: number,
  need: number,
  teams: Readonly<Record<TeamId, TeamState>>,
  coaches: Readonly<Record<string, HeadCoach>>,
): WatchListReason {
  // Miscast check: player's current team has poor fit for them AND
  // our team would significantly elevate them. Strongest signal —
  // exactly what the doc calls out as the highest-value target type.
  if (player.teamId) {
    const currentTeam = teams[player.teamId];
    if (currentTeam) {
      const currentHc = coaches[currentTeam.headCoachId];
      if (currentHc) {
        const currentFit = schemeFitForPlayer(player, {
          offensiveScheme: currentHc.offensiveScheme,
          defensiveScheme: currentHc.defensiveScheme,
        });
        if (currentFit <= 0.95 && schemeFit >= 1.15) {
          return 'MISCAST_ELEVATION';
        }
      }
    }
  }
  if (schemeFit >= 1.3) return 'SCHEME_FIT';
  if (need >= 1.15) return 'POSITIONAL_NEED';
  return 'ROLE_PLAYER';
}

function computeNeedScores(
  team: TeamState,
  players: Readonly<Record<string, Player>>,
): Record<PositionGroup, number> {
  const counts: Record<PositionGroup, number> = {
    QB: 0,
    SKILL: 0,
    OL: 0,
    DL: 0,
    LB: 0,
    DB: 0,
    ST: 0,
  };
  for (const pid of team.rosterIds) {
    const p = players[pid];
    if (!p) continue;
    counts[p.positionGroup]++;
  }
  const scores: Record<PositionGroup, number> = {} as Record<PositionGroup, number>;
  for (const group of Object.keys(counts) as PositionGroup[]) {
    const ratio = POSITION_GROUP_TARGETS[group] / Math.max(1, counts[group]);
    // Sqrt softens the curve so the bonus doesn't dominate priority.
    const score = Math.sqrt(ratio);
    scores[group] = clamp(score, 0.8, 1.3);
  }
  return scores;
}

function teamOfScout(
  teams: Readonly<Record<TeamId, TeamState>>,
  scoutId: ScoutId,
): TeamId | null {
  for (const [tid, team] of Object.entries(teams) as [TeamId, TeamState][]) {
    if (team.scoutIds.includes(scoutId)) return tid;
  }
  return null;
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
