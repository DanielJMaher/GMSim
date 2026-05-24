import type { LeagueState } from '../types/league.js';
import { migrateLeagueForward } from './migrations.js';
import { tickPhase } from './lifecycle.js';

export interface SimulateSeasonOptions {
  // Reserved for future options. v0.55 had a `seed` override that was
  // unused outside of legacy testing; v0.56+ derives every per-week
  // and per-game PRNG from `${league.seed}::season-${seasonNumber}`
  // unconditionally so step-through (`tickPhase`) and bulk
  // (`simulateSeason`) produce identical state.
}

/**
 * Run an entire season top to bottom: schedule → 17 weeks of regular
 * season → playoffs. Returns a new LeagueState with `schedule` populated
 * and every game's `result` set.
 *
 * v0.56+ this is a thin loop over `tickPhase`. Each per-week tick
 * fires one regular-season week (including poach + mid-season FA +
 * mood + NPC trades + proactive trades for that week); each playoff
 * round is one further tick. v0.63.1: because the unified calendar
 * interleaves the NFL season with the college season, this loop also
 * advances the college season + postseason as it walks the timeline
 * to the Super Bowl. The loop terminates after the Super Bowl fires
 * (or when the league has already reached `SUPER_BOWL`).
 *
 * Determinism: same input league → identical output. Every PRNG fork
 * derives from the league seed + season number, so step-through via
 * the inspector and bulk `simulateSeason` produce identical state.
 */
export function simulateSeason(
  leagueIn: LeagueState,
  _options: SimulateSeasonOptions = {},
): LeagueState {
  let league = migrateLeagueForward(leagueIn);
  // Loop until we've played the Super Bowl. tickPhase walks the unified
  // season timeline (NFL + college weeks interleaved by date, then the
  // postseason rounds). Defensive iteration cap: 17 NFL weeks + 12
  // college weeks + 7 college postseason + 4 NFL playoff rounds = 40
  // ticks to SUPER_BOWL; 100 is a comfortable safety margin.
  for (let i = 0; i < 100; i++) {
    if (league.lifecyclePhase === 'SUPER_BOWL') break;
    const beforePhase = league.lifecyclePhase;
    const beforeWeek = league.currentWeek;
    const beforeCollegeWeek = league.collegeCurrentWeek;
    league = tickPhase(league);
    // Progress check: a tick must advance the phase OR one of the
    // week counters (REGULAR_SEASON_WEEK / COLLEGE_WEEK each repeat
    // their phase while their counter climbs). If nothing moved at
    // all, bail rather than spin forever.
    if (
      league.lifecyclePhase === beforePhase &&
      league.currentWeek === beforeWeek &&
      league.collegeCurrentWeek === beforeCollegeWeek
    ) {
      break;
    }
  }
  return league;
}
