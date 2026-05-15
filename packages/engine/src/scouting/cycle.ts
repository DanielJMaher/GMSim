import type { Prng } from '../prng/index.js';
import type { LeagueState } from '../types/league.js';
import type { Scout } from '../types/scout.js';
import type { TeamId } from '../types/ids.js';
import { generateInitialObservations } from './observation.js';
import { regenerateWatchLists } from './watch-list.js';

/**
 * Run one scouting cycle: every scout produces a fresh round of
 * attributed observations on ~8 players in their known-specialty group
 * across other teams (same logic as the initial league-creation sweep,
 * just stamped with the current tick). Existing observations stay —
 * they're append-only — and watch lists are then re-derived from the
 * complete observation history so the FA market reads current
 * intelligence.
 *
 * Called once per `advanceSeason` (between proactive trades and the
 * roster refill) so scouts have re-evaluated the league with
 * post-development player skills before bidding kicks off. Same
 * primitive will be reused by the Draft Module's college-scouting
 * cycle.
 */
export function advanceScoutingCycle(
  prng: Prng,
  league: LeagueState,
  observedOnTick: number,
): LeagueState {
  const scoutsByTeam: Record<string, Scout[]> = {};
  for (const team of Object.values(league.teams)) {
    const teamScouts: Scout[] = [];
    for (const sid of team.scoutIds) {
      const scout = league.scouts[sid];
      if (scout) teamScouts.push(scout);
    }
    scoutsByTeam[team.identity.id] = teamScouts;
  }

  const newObservations = generateInitialObservations(
    prng.fork('cycle-obs'),
    league.teams,
    scoutsByTeam as Readonly<Record<TeamId, readonly Scout[]>>,
    league.players,
    observedOnTick,
  );

  const observations = [...league.observations, ...newObservations];
  const watchLists = regenerateWatchLists(
    league.teams,
    league.scouts,
    league.coaches,
    league.players,
    observations,
    observedOnTick,
  );

  return {
    ...league,
    observations,
    watchLists,
  };
}
