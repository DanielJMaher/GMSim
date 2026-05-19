import type { LeagueState } from '../types/league.js';
import { migrateLeagueForward } from './migrations.js';
import { tickPhase } from './lifecycle.js';

/**
 * Advance a played-through league one full offseason cycle into the
 * start of the next regular season.
 *
 * v0.54+ delegates to the per-phase `tickPhase` driver — every chunk
 * of work between drafts (post-season finalize, FA + cap, pre-draft,
 * draft, post-draft cuts + UDFA, college cycle) lives in
 * `engine/src/season/lifecycle.ts`. `advanceSeason` is now a thin
 * loop over those phases.
 *
 * UI can call `tickPhase` directly to step one phase at a time. The
 * eventual week-by-week refactor of `simulateSeason` will follow the
 * same pattern.
 *
 * Caller is expected to have run `simulateSeason` on the input league
 * first — `league.schedule` should be fully played.
 */
export function advanceSeason(leagueIn: LeagueState): LeagueState {
  if (!leagueIn.schedule) {
    throw new Error('advanceSeason requires a played schedule on the league');
  }
  let league = migrateLeagueForward(leagueIn);
  // Walk the lifecycle from current phase to the terminal
  // `READY_FOR_NEXT_SEASON`. `tickPhase` no-ops at the terminal phase,
  // so a defensive iteration cap is unnecessary in practice.
  while (league.lifecyclePhase !== 'READY_FOR_NEXT_SEASON') {
    const before = league.lifecyclePhase;
    league = tickPhase(league);
    if (league.lifecyclePhase === before) break;
  }
  return league;
}
