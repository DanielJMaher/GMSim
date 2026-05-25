/**
 * College season-stat aggregation (v0.67) — the read layer over the
 * `CollegePlayerGameStats` stream.
 *
 * The per-game stream is append-only across every season; nothing in
 * the engine consumed it before this module. Here we roll it into
 * per-prospect season totals and national leaderboards — the shared
 * input for the Heisman race, the inspector's stat leaders, and (later)
 * media production takes.
 *
 * "Season" = one `playedOnTick` cohort. All of a season's college games
 * (regular + postseason, which all fire before POST_SEASON_FINALIZE
 * rolls the tick) share the season's base tick, so grouping by
 * `playedOnTick` cleanly separates seasons. `aggregateCollegeSeasonStats`
 * defaults to the latest season present in the stream.
 */

import type { PlayerId } from '../types/ids.js';
import type {
  CollegePlayerGameStats,
  CollegeSeasonStatLine,
  CollegeStatCategory,
} from '../types/college-season.js';

function emptyLine(playerId: PlayerId, schoolId: string): CollegeSeasonStatLine {
  return {
    playerId,
    schoolId,
    games: 0,
    passAttempts: 0,
    passCompletions: 0,
    passingYards: 0,
    passingTds: 0,
    interceptionsThrown: 0,
    rushingAttempts: 0,
    rushingYards: 0,
    rushingTds: 0,
    targets: 0,
    receptions: 0,
    receivingYards: 0,
    receivingTds: 0,
    tackles: 0,
    sacks: 0,
    interceptions: 0,
  };
}

/**
 * The `playedOnTick` of the most recent season represented in the
 * stream, or `null` if it's empty.
 */
export function latestCollegeSeasonTick(
  stats: readonly CollegePlayerGameStats[],
): number | null {
  let max: number | null = null;
  for (const s of stats) {
    if (max === null || s.playedOnTick > max) max = s.playedOnTick;
  }
  return max;
}

/**
 * Sum the stream into per-prospect season stat lines. By default
 * aggregates the latest season (max `playedOnTick`); pass an explicit
 * `playedOnTick` to aggregate a specific one. Lines are returned sorted
 * by passing yards then a stable id tiebreak — but callers that want a
 * specific ordering should use `collegeStatLeaders`.
 */
export function aggregateCollegeSeasonStats(
  stats: readonly CollegePlayerGameStats[],
  options: { playedOnTick?: number } = {},
): CollegeSeasonStatLine[] {
  const tick = options.playedOnTick ?? latestCollegeSeasonTick(stats);
  if (tick === null) return [];

  const byPlayer = new Map<PlayerId, CollegeSeasonStatLine>();
  const gamesByPlayer = new Map<PlayerId, Set<string>>();

  for (const s of stats) {
    if (s.playedOnTick !== tick) continue;
    let line = byPlayer.get(s.playerId);
    if (!line) {
      line = emptyLine(s.playerId, s.schoolId);
      byPlayer.set(s.playerId, line);
      gamesByPlayer.set(s.playerId, new Set());
    }
    line.passAttempts += s.passAttempts;
    line.passCompletions += s.passCompletions;
    line.passingYards += s.passingYards;
    line.passingTds += s.passingTds;
    line.interceptionsThrown += s.interceptionsThrown;
    line.rushingAttempts += s.rushingAttempts;
    line.rushingYards += s.rushingYards;
    line.rushingTds += s.rushingTds;
    line.targets += s.targets;
    line.receptions += s.receptions;
    line.receivingYards += s.receivingYards;
    line.receivingTds += s.receivingTds;
    line.tackles += s.tackles;
    line.sacks += s.sacks;
    line.interceptions += s.interceptions;
    gamesByPlayer.get(s.playerId)!.add(s.gameId);
  }

  for (const [playerId, games] of gamesByPlayer) {
    byPlayer.get(playerId)!.games = games.size;
  }

  const lines = [...byPlayer.values()];
  lines.sort(
    (a, b) =>
      b.passingYards - a.passingYards ||
      (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0),
  );
  return lines;
}

/**
 * Top `limit` prospects in `category`, descending, with a stable id
 * tiebreak. Prospects with zero in the category are omitted.
 */
export function collegeStatLeaders(
  lines: readonly CollegeSeasonStatLine[],
  category: CollegeStatCategory,
  limit: number,
): CollegeSeasonStatLine[] {
  return [...lines]
    .filter((l) => l[category] > 0)
    .sort(
      (a, b) =>
        b[category] - a[category] ||
        (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0),
    )
    .slice(0, limit);
}
