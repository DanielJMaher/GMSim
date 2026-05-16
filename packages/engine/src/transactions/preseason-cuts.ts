import type { LeagueState } from '../types/league.js';
import type { Player, PlayerSkills } from '../types/player.js';
import type { Contract } from '../types/contract.js';
import type { TeamState } from '../types/team.js';
import type { PlayerId, TeamId } from '../types/ids.js';

const ACTIVE_ROSTER_LIMIT = 53;

export interface PreseasonCutsOptions {
  /**
   * Player IDs that must NOT be cut even if they're the lowest-skill
   * players on a roster. In real NFL, draft picks get a "rookie pass"
   * — they almost never get released during their first preseason
   * because the team just spent a pick on them. advanceSeason passes
   * the just-drafted prospect ids in here so they're shielded from
   * the cut pool.
   *
   * Note: if a team's entire roster is protected (e.g. 53 protected
   * players + 1 unprotected), only the unprotected players are
   * eligible for cuts. If the team is still over the limit after
   * cutting everything unprotected, the protected players are
   * cut bottom-up as a last resort to enforce the roster limit.
   */
  protectedPlayerIds?: ReadonlySet<PlayerId>;
}

/**
 * NFL preseason roster trim. Real NFL is a multi-step 90 → 85 → 53
 * lifecycle through training camp; this is the simpler "post-draft,
 * post-FA, post-trades — anyone over 53 gets released to the FA
 * pool" model that captures the spirit (rosters can briefly expand
 * during the offseason and then trim back).
 *
 * Mechanics:
 *   1. For each team over `ACTIVE_ROSTER_LIMIT`, rank UNPROTECTED
 *      rostered players by current-skill mean (lowest first) and
 *      release the surplus.
 *   2. If protected players still push the team over the limit
 *      (rare), bottom-up cuts continue into protected players as a
 *      fallback so the invariant holds.
 *   3. Released players become free agents (`teamId: null`,
 *      `contractId: null`); their contracts are dropped.
 *   4. NO dead money charged — preseason cuts in real NFL are
 *      mostly cost-free except for guaranteed money in rookie deals;
 *      that nuance lands in a later slice.
 *
 * Idempotent — running again on a roster already at 53 is a no-op.
 * Pure function — no PRNG.
 */
export function preseasonCuts(
  league: LeagueState,
  options: PreseasonCutsOptions = {},
): LeagueState {
  const protectedIds = options.protectedPlayerIds ?? new Set<PlayerId>();
  const players: Record<string, Player> = { ...league.players };
  const contracts: Record<string, Contract> = { ...league.contracts };
  const teams: Record<string, TeamState> = { ...league.teams };
  let anyChange = false;

  for (const team of Object.values(league.teams)) {
    if (team.rosterIds.length <= ACTIVE_ROSTER_LIMIT) continue;

    const rostered = team.rosterIds
      .map((id) => league.players[id])
      .filter((p): p is Player => p !== undefined);
    // Cut unprotected players first, lowest skill mean first.
    const unprotected = rostered.filter((p) => !protectedIds.has(p.id));
    unprotected.sort((a, b) => skillMean(a.current) - skillMean(b.current));
    const surplus = team.rosterIds.length - ACTIVE_ROSTER_LIMIT;
    const cutSet = new Set<PlayerId>();
    for (let i = 0; i < surplus && i < unprotected.length; i++) {
      cutSet.add(unprotected[i]!.id);
    }
    // Fallback: if we still haven't cut enough (entire surplus is
    // protected, somehow), cut bottom-up across protected too so the
    // roster invariant holds.
    if (cutSet.size < surplus) {
      const protectedSorted = rostered
        .filter((p) => protectedIds.has(p.id))
        .sort((a, b) => skillMean(a.current) - skillMean(b.current));
      for (let i = 0; cutSet.size < surplus && i < protectedSorted.length; i++) {
        cutSet.add(protectedSorted[i]!.id);
      }
    }
    if (cutSet.size === 0) continue;
    anyChange = true;

    for (const pid of cutSet) {
      const player = players[pid];
      if (!player) continue;
      if (player.contractId) {
        delete contracts[player.contractId];
      }
      players[pid] = { ...player, teamId: null, contractId: null };
    }

    teams[team.identity.id] = {
      ...team,
      rosterIds: team.rosterIds.filter((id) => !cutSet.has(id)),
    };
  }

  if (!anyChange) return league;
  return {
    ...league,
    teams: teams as Readonly<Record<TeamId, TeamState>>,
    players: players as typeof league.players,
    contracts: contracts as typeof league.contracts,
  };
}

function skillMean(s: PlayerSkills): number {
  return (
    s.speed + s.acceleration + s.agility + s.strength +
    s.technicalSkill + s.footballIq + s.decisionMaking +
    s.handsBallSkills + s.passRushTechnique + s.coverageTechnique +
    s.tacklingTechnique + s.blockingTechnique
  ) / 12;
}
