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
 * round is one further tick. The loop terminates after the Super Bowl
 * fires (or when the league has already reached `SUPER_BOWL`).
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
  // Loop until we've played the Super Bowl. tickPhase self-loops on
  // REGULAR_SEASON_WEEK while regular-season weeks remain; otherwise
  // advances through WILD_CARD → DIVISIONAL → CONFERENCE → SUPER_BOWL.
  // Defensive iteration cap: ~17 regular weeks + 4 playoff rounds = 21
  // ticks per season; 100 is a comfortable safety margin.
  for (let i = 0; i < 100; i++) {
    if (league.lifecyclePhase === 'SUPER_BOWL') break;
    const before = league.lifecyclePhase;
    const beforeWeek = league.currentWeek;
    league = tickPhase(league);
    // Progress check: REGULAR_SEASON_WEEK is allowed to self-loop, but
    // currentWeek must advance each tick. Any non-self-loop phase that
    // doesn't transition is a bug — bail rather than spin forever.
    if (league.lifecyclePhase === before) {
      if (before !== 'REGULAR_SEASON_WEEK') break;
      if (league.currentWeek === beforeWeek) break;
    }
  }
  return league;
}
