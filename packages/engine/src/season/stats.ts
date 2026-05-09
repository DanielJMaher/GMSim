import type { LeagueState } from '../types/league.js';
import type { PlayerSeasonStats } from '../types/stats.js';
import { emptyPlayerGameStats } from '../types/stats.js';
import { deriveGamePlayerStats } from '../games/stats.js';
import type { PlayerId } from '../types/ids.js';

/**
 * Aggregate per-player stats across every played game in the league's
 * current season schedule (regular season + playoffs).
 *
 * Pure & deterministic — same league state → same season stats. The
 * inspector should `useMemo` this on `[league]` since walking 272
 * games per render is cheap but not free.
 */
export function seasonStatsForLeague(league: LeagueState): Map<PlayerId, PlayerSeasonStats> {
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
      let cur = totals.get(line.playerId);
      if (!cur) {
        cur = { ...emptyPlayerGameStats(line.playerId), gamesPlayed: 0 };
        totals.set(line.playerId, cur);
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
