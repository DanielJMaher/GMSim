import type { LeagueState } from '../types/league.js';
import type { Player, PlayerSkills } from '../types/player.js';
import type { Contract } from '../types/contract.js';
import type { TeamState } from '../types/team.js';
import type { Transaction } from '../types/transaction.js';
import type { PlayerId, TeamId } from '../types/ids.js';
import {
  unamortizedSigningBonus,
  addToYear,
  splitDeadMoney,
  isOffseasonPhase,
  currentCapHit,
} from '../contracts/cap.js';

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
 *   4. Unamortized signing-bonus proration accelerates onto the cutting
 *      team's dead money (LIQUIDATOR_DEAD_MONEY.md §11.1) — the same rule
 *      every other departure route already applies. Most preseason cuts
 *      are still cost-free in practice (rookie-pool/vet-min bodies with
 *      little-to-no bonus), but a cut veteran on a real deal is not free.
 *
 * ROSTER_FLOOR.md §17 "Fix 4 PROPER" follow-up (2026-09-03): this trim is
 * MANDATORY (a team cannot carry 54+), so it cannot simply decline a
 * cap-negative cut the way `releaseSurplusStarters`' discretionary Fix A
 * does — someone in the bottom `surplus` has to go. Instead, a bounded
 * swap: any selected cut whose dead money would exceed the cap hit it
 * frees is swapped for the next-best-skill unprotected player who IS
 * cap-safe to cut, if one exists (same real-NFL logic as a team carrying
 * a slightly worse player over eating a cap bomb). Same headcount, skill
 * ranking stays primary, zero new tunables.
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
  const logEntries: Transaction[] = [];
  let anyChange = false;

  // Dynamic, not hardcoded (LIQUIDATOR_DEAD_MONEY.md §18.5.1): under
  // today's calendar POST_DRAFT_ROSTER (where this pass runs) is
  // pre-June-1, so this is always false in practice — but deriving it
  // from `league.phase` means a future re-dating of that phase to the
  // real August cutdown window starts splitting automatically. League-wide,
  // not team-specific — computed once.
  const postJune1 = !isOffseasonPhase(league.phase);

  // True if cutting `p` does not book more dead money than it frees this
  // year — mirrors `evaluateCapCasualty`'s C2 guard (`npc-ai/cap-casualty.ts`)
  // and `releaseSurplusStarters`' Fix A, applied here as a swap preference
  // rather than a skip (§17 follow-up: this trim can't decline to cut).
  const cutSaves = (p: Player): boolean => {
    if (!p.contractId) return true;
    const contract = league.contracts[p.contractId];
    if (!contract) return true;
    const split = splitDeadMoney(contract, unamortizedSigningBonus(contract), postJune1);
    return split.currentYear <= currentCapHit(contract);
  };

  for (const team of Object.values(league.teams)) {
    if (team.rosterIds.length <= ACTIVE_ROSTER_LIMIT) continue;

    const rostered = team.rosterIds
      .map((id) => league.players[id])
      .filter((p): p is Player => p !== undefined);
    // Cut unprotected players first, lowest skill mean first.
    const unprotected = rostered.filter((p) => !protectedIds.has(p.id));
    unprotected.sort((a, b) => skillMean(a.current) - skillMean(b.current));
    const surplus = team.rosterIds.length - ACTIVE_ROSTER_LIMIT;
    const selected = unprotected.slice(0, surplus);
    const alternatives = unprotected.slice(surplus);
    // Bounded swap: a selected (worst-skill) cut whose dead money exceeds
    // the cap hit it frees is swapped for the closest-skill unprotected
    // player who IS cap-safe to cut, if one exists. Same headcount, same
    // pool — just which `surplus` bodies within it.
    for (let i = 0; i < selected.length; i++) {
      if (cutSaves(selected[i]!)) continue;
      const swapIdx = alternatives.findIndex((p) => cutSaves(p));
      if (swapIdx === -1) continue;
      const [replacement] = alternatives.splice(swapIdx, 1);
      selected[i] = replacement!;
    }
    const cutSet = new Set<PlayerId>(selected.map((p) => p.id));
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

    let deadMoneyCurrent = 0;
    let deadMoneyNext = 0;
    for (const pid of cutSet) {
      const player = players[pid];
      if (!player) continue;
      if (player.contractId) {
        const contract = contracts[player.contractId];
        if (contract) {
          const split = splitDeadMoney(contract, unamortizedSigningBonus(contract), postJune1);
          deadMoneyCurrent += split.currentYear;
          deadMoneyNext += split.nextYear;
          // Logged per-player like every other dead-money channel
          // (`preseason-cut-dead-money`, LIQUIDATOR_DEAD_MONEY.md §14.1) —
          // even when dead is 0, most cuts are (rookie-pool/vet-min bodies
          // with little-to-no bonus), so the log isn't spammed with
          // zero-dollar noise.
          if (split.currentYear > 0 || split.nextYear > 0) {
            logEntries.push({
              kind: 'preseason-cut-dead-money',
              tick: league.tick,
              seasonNumber: league.seasonNumber,
              teamId: team.identity.id,
              playerId: pid,
              contractId: contract.id,
              deadMoney: split.currentYear,
              ...(split.nextYear > 0 ? { deadMoneyDeferred: split.nextYear } : {}),
            });
          }
        }
        delete contracts[player.contractId];
      }
      players[pid] = { ...player, teamId: null, contractId: null };
    }

    const deadMoneyByYear =
      deadMoneyNext > 0
        ? addToYear(addToYear(team.deadMoneyByYear, 0, deadMoneyCurrent), 1, deadMoneyNext)
        : deadMoneyCurrent > 0
          ? addToYear(team.deadMoneyByYear, 0, deadMoneyCurrent)
          : team.deadMoneyByYear;
    teams[team.identity.id] = {
      ...team,
      rosterIds: team.rosterIds.filter((id) => !cutSet.has(id)),
      deadMoneyByYear,
    };
  }

  if (!anyChange) return league;
  return {
    ...league,
    teams: teams as Readonly<Record<TeamId, TeamState>>,
    players: players as typeof league.players,
    contracts: contracts as typeof league.contracts,
    transactionLog: [...league.transactionLog, ...logEntries],
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
