import type { LeagueState } from '../types/league.js';
import type { ScheduledGame, SeasonSchedule } from '../types/game.js';
import type { Player } from '../types/player.js';
import { Prng as PrngClass } from '../prng/index.js';
import { generateSchedule } from './schedule.js';
import { runPlayoffs } from './playoffs.js';
import { simulateGame } from '../games/outcome.js';

export interface SimulateSeasonOptions {
  /** Override the regular-season PRNG seed. Defaults to league.seed + season number. */
  seed?: string;
}

/**
 * Run an entire season top to bottom: schedule → 18 weeks of regular
 * season → playoffs. Returns a new LeagueState with `schedule` populated
 * and every game's `result` set.
 *
 * Determinism: same input league + same options → identical output.
 */
export function simulateSeason(
  league: LeagueState,
  options: SimulateSeasonOptions = {},
): LeagueState {
  const seed = options.seed ?? `${league.seed}::season-${league.seasonNumber}`;
  const seasonPrng = new PrngClass(seed);

  const teams = Object.values(league.teams);
  const schedule = generateSchedule(seasonPrng.fork('schedule'), teams, league.seasonNumber);

  // Play each week's games, propagating injuries into Player.injury so
  // they affect subsequent weeks (and survive into the offseason for
  // inspection). Injury recovery sweeps run at the start of each week
  // before games are played.
  let playersDuringSeason: Record<string, Player> = league.players as Record<string, Player>;
  const playedWeeks: ScheduledGame[][] = [];
  for (let weekIdx = 0; weekIdx < schedule.regularSeason.length; weekIdx++) {
    const currentTick = league.tick + weekIdx;

    // Recover any injuries whose return tick is now in the past.
    const recovered: Record<string, Player> = {};
    for (const [pid, p] of Object.entries(playersDuringSeason)) {
      if (p.injury && p.injury.estimatedReturnTick <= currentTick) {
        recovered[pid] = { ...p, injury: null };
      }
    }
    if (Object.keys(recovered).length > 0) {
      playersDuringSeason = { ...playersDuringSeason, ...recovered };
    }

    const week = schedule.regularSeason[weekIdx]!;
    const weekPrng = seasonPrng.fork(`week-${weekIdx + 1}`);
    const playedWeek: ScheduledGame[] = [];
    for (const pendingGame of week) {
      const weekLeague: LeagueState = { ...league, players: playersDuringSeason };
      const home = weekLeague.teams[pendingGame.homeTeamId]!;
      const away = weekLeague.teams[pendingGame.awayTeamId]!;
      const played = simulateGame(weekPrng.fork(pendingGame.id), {
        homeTeam: home,
        awayTeam: away,
        league: weekLeague,
        weekNumber: pendingGame.weekNumber,
        kind: 'REGULAR',
      });
      playedWeek.push(played);

      // Propagate this game's injuries into Player.injury so the next
      // week's recovery sweep + game sim see the up-to-date state.
      if (played.result?.injuries.length) {
        const updates: Record<string, Player> = {};
        for (const inj of played.result.injuries) {
          const p = playersDuringSeason[inj.playerId];
          if (!p) continue;
          updates[inj.playerId] = {
            ...p,
            injury: {
              type: inj.type,
              severity: inj.severity,
              occurredOnTick: currentTick,
              estimatedReturnTick: currentTick + inj.weeksOut,
            },
          };
        }
        if (Object.keys(updates).length > 0) {
          playersDuringSeason = { ...playersDuringSeason, ...updates };
        }
      }
    }
    playedWeeks.push(playedWeek);
  }

  const regularSeasonComplete: SeasonSchedule = {
    seasonNumber: league.seasonNumber,
    regularSeason: playedWeeks,
    playoffs: null,
  };

  const leagueAfterRegSeason: LeagueState = {
    ...league,
    players: playersDuringSeason as typeof league.players,
    schedule: regularSeasonComplete,
  };

  // Run playoffs. Playoff injury propagation is deferred — the season
  // ends right after, so injuries there don't alter outcomes elsewhere.
  const playoffs = runPlayoffs(seasonPrng.fork('playoffs'), leagueAfterRegSeason);

  return {
    ...leagueAfterRegSeason,
    schedule: { ...regularSeasonComplete, playoffs },
  };
}

