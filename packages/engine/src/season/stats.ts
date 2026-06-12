import type { LeagueState } from '../types/league.js';
import type { PlayerGameStats, PlayerSeasonStats } from '../types/stats.js';
import { emptyPlayerGameStats } from '../types/stats.js';
import { deriveGamePlayerStats } from '../games/stats.js';
import type { PlayerId, TeamId } from '../types/ids.js';

/**
 * Aggregate per-player stats across every played game in the league's
 * current season schedule (regular season + playoffs).
 *
 * Pure & deterministic — same league state → same season stats. The
 * inspector should `useMemo` this on `[league]` since walking 272
 * games per render is cheap but not free.
 */
export function seasonStatsForLeague(league: LeagueState): Map<PlayerId, PlayerSeasonStats> {
  return aggregateSeasonStats(league);
}

/**
 * Season stats a team's games ACCRUED for it — joined through the stat
 * line's sim-time `teamId`, NOT the team's current roster. Includes players
 * who have since left (trade, cut, FA, retirement); this is the only join
 * under which a team's box score adds up (QB passing == receiver receiving).
 * Lines from pre-`teamId` saves fall back to current-roster membership.
 */
export function seasonStatsForTeam(
  league: LeagueState,
  teamId: TeamId,
): Map<PlayerId, PlayerSeasonStats> {
  const roster = new Set(league.teams[teamId]?.rosterIds ?? []);
  return aggregateSeasonStats(league, (line) =>
    line.teamId !== undefined ? line.teamId === teamId : roster.has(line.playerId),
  );
}

function aggregateSeasonStats(
  league: LeagueState,
  include?: (line: PlayerGameStats) => boolean,
): Map<PlayerId, PlayerSeasonStats> {
  const totals = new Map<PlayerId, PlayerSeasonStats>();
  if (!league.schedule) return totals;

  const allGames = [
    ...league.schedule.regularSeason.flat(),
    ...(league.schedule.playoffs?.wildCard ?? []),
    ...(league.schedule.playoffs?.divisional ?? []),
    ...(league.schedule.playoffs?.conference ?? []),
    ...(league.schedule.playoffs?.superBowl ?? []),
  ];

  for (const game of allGames) {
    const lines = deriveGamePlayerStats(game, league);
    for (const line of lines) {
      if (include && !include(line)) continue;
      let cur = totals.get(line.playerId);
      if (!cur) {
        cur = { ...emptyPlayerGameStats(line.playerId, line.teamId), gamesPlayed: 0 };
        totals.set(line.playerId, cur);
      } else if (cur.teamId !== undefined && cur.teamId !== line.teamId) {
        // Player accrued stats with more than one team this season (midseason
        // trade) — no single team owns the aggregate line.
        delete cur.teamId;
      }
      cur.passAttempts += line.passAttempts;
      cur.passCompletions += line.passCompletions;
      cur.passingYards += line.passingYards;
      cur.passingTds += line.passingTds;
      cur.interceptionsThrown += line.interceptionsThrown;
      cur.rushingAttempts += line.rushingAttempts;
      cur.rushingYards += line.rushingYards;
      cur.rushingTds += line.rushingTds;
      cur.targets += line.targets;
      cur.receptions += line.receptions;
      cur.receivingYards += line.receivingYards;
      cur.receivingTds += line.receivingTds;
      cur.tackles += line.tackles;
      cur.sacks += line.sacks;
      cur.interceptions += line.interceptions;
      cur.gamesPlayed += 1;
    }
  }

  return totals;
}

/**
 * Convenience: lookup a single player's season stats. Returns null if
 * the player has no recorded output (e.g., 3rd-string QB on a
 * pass-light scheme).
 */
export function playerSeasonStats(
  league: LeagueState,
  playerId: PlayerId,
): PlayerSeasonStats | null {
  return seasonStatsForLeague(league).get(playerId) ?? null;
}
