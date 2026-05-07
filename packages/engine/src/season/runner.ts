import type { LeagueState } from '../types/league.js';
import type { ScheduledGame, SeasonSchedule } from '../types/game.js';
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

  // Play each week's games, building a new schedule with results.
  const playedWeeks: ScheduledGame[][] = [];
  for (let weekIdx = 0; weekIdx < schedule.regularSeason.length; weekIdx++) {
    const week = schedule.regularSeason[weekIdx]!;
    const weekPrng = seasonPrng.fork(`week-${weekIdx + 1}`);
    const playedWeek: ScheduledGame[] = [];
    for (const pendingGame of week) {
      const home = league.teams[pendingGame.homeTeamId]!;
      const away = league.teams[pendingGame.awayTeamId]!;
      const played = simulateGame(weekPrng.fork(pendingGame.id), {
        homeTeam: home,
        awayTeam: away,
        league,
        weekNumber: pendingGame.weekNumber,
        kind: 'REGULAR',
      });
      playedWeek.push(played);
    }
    playedWeeks.push(playedWeek);
  }

  const regularSeasonComplete: SeasonSchedule = {
    seasonNumber: league.seasonNumber,
    regularSeason: playedWeeks,
    playoffs: null,
  };

  const leagueAfterRegSeason: LeagueState = { ...league, schedule: regularSeasonComplete };

  // Run playoffs.
  const playoffs = runPlayoffs(seasonPrng.fork('playoffs'), leagueAfterRegSeason);

  return {
    ...leagueAfterRegSeason,
    schedule: { ...regularSeasonComplete, playoffs },
  };
}

