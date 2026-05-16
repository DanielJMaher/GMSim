import type { Prng } from '../prng/index.js';
import type { LeagueState } from '../types/league.js';
import type { PlayerId, ContractId } from '../types/ids.js';
import { ageOfPlayer } from './development.js';

/**
 * Age-based retirement. As of v0.37.0 (Doc 3 slice 5b) the in-place
 * rookie-replacement step has been removed — retirements only open
 * roster slots. The draft event fills most of them; `refillRosters`
 * brings any sub-53 teams back from the FA market afterwards.
 */

/**
 * Probability that a player of `age` retires this offseason.
 *
 * Tuned so the league-wide population doesn't crater — across 32 teams ×
 * 53 players, the existing age distribution puts roughly 5% of players
 * in the 34+ band, so per-year retirement counts settle around 30–60
 * leaguewide once the player base stabilizes.
 */
export function retirementProbabilityForAge(age: number): number {
  if (age <= 33) return 0;
  if (age === 34) return 0.05;
  if (age === 35) return 0.15;
  if (age === 36) return 0.3;
  if (age === 37) return 0.5;
  if (age === 38) return 0.7;
  if (age === 39) return 0.9;
  return 1.0; // 40+
}

export function rollRetirement(prng: Prng, age: number): boolean {
  const p = retirementProbabilityForAge(age);
  if (p <= 0) return false;
  if (p >= 1) return true;
  return prng.next() < p;
}

export interface RetirementOutcome {
  /** New rosterIds per team (retirees REMOVED, no replacements). */
  rosterIdsByTeam: Map<string, readonly PlayerId[]>;
  /** Player IDs removed from the league. */
  retiredPlayerIds: readonly PlayerId[];
  /** Contract IDs to drop (the retirees' contracts). */
  dropContractIds: readonly ContractId[];
}

/**
 * Process retirement across all 32 teams. Retirees are filtered out of
 * team rosters; no replacement rookies are generated. As of v0.37.0
 * (Doc 3 slice 5b) the draft event is responsible for filling vacated
 * slots — `processRetirements` only opens them. Anything still under
 * 53 after the draft gets backfilled by `refillRosters` from the FA
 * market.
 *
 * Caller is responsible for merging the outcome into the next
 * LeagueState (drop retired entries from `players`/`contracts`, swap
 * teams' rosterIds).
 */
export function processRetirements(
  prng: Prng,
  league: LeagueState,
  nextSeasonNumber: number,
  _nextTick: number,
): RetirementOutcome {
  const rosterIdsByTeam = new Map<string, readonly PlayerId[]>();
  const retiredPlayerIds: PlayerId[] = [];
  const dropContractIds: ContractId[] = [];
  const retiredSet = new Set<string>();

  // ─── Active roster: retire (no replacement) ──────────────────────────
  for (const team of Object.values(league.teams)) {
    const teamPrng = prng.fork(`team:${team.identity.id}`);
    const newRoster: PlayerId[] = [];

    for (const playerId of team.rosterIds) {
      const player = league.players[playerId]!;
      // Use the upcoming season's age (player will be one year older
      // post-advance), so a 33→34 transition retires correctly.
      const ageNext = ageOfPlayer(player, nextSeasonNumber);
      const retires = rollRetirement(teamPrng.fork(`retire:${playerId}`), ageNext);

      if (retires) {
        retiredPlayerIds.push(playerId);
        retiredSet.add(playerId);
        if (player.contractId) dropContractIds.push(player.contractId);
      } else {
        newRoster.push(playerId);
      }
    }

    rosterIdsByTeam.set(team.identity.id, newRoster);
  }

  // ─── Non-rostered retirees: PS + free agents retire too. Without this
  //     pass, aged-out PS players and unsigned FAs would accumulate in
  //     `league.players` past age 40.
  const offRosterPrng = prng.fork('off-roster');
  for (const player of Object.values(league.players)) {
    if (retiredSet.has(player.id)) continue;
    // Skip players still on an active roster — already covered above.
    if (player.teamId !== null && league.teams[player.teamId]?.rosterIds.includes(player.id)) {
      continue;
    }
    const ageNext = ageOfPlayer(player, nextSeasonNumber);
    if (rollRetirement(offRosterPrng.fork(`retire:${player.id}`), ageNext)) {
      retiredPlayerIds.push(player.id);
      retiredSet.add(player.id);
      if (player.contractId) dropContractIds.push(player.contractId);
    }
  }

  return {
    rosterIdsByTeam,
    retiredPlayerIds,
    dropContractIds,
  };
}
