import type { Prng } from '../prng/index.js';
import type { LeagueState } from '../types/league.js';
import type { TeamState } from '../types/team.js';
import type { Player } from '../types/player.js';
import type { Contract } from '../types/contract.js';
import type { PlayerId, ContractId } from '../types/ids.js';
import { generatePlayer } from '../players/generate.js';
import { generateContract } from '../contracts/generate.js';
import { ageOfPlayer } from './development.js';
import { positionGroupFor } from '../players/position-group.js';
import { PositionGroup } from '../types/enums.js';
import type { PlayerArchetype } from '../archetypes/types.js';

/**
 * Phase 2 retirement placeholder. Real retirement (per the Player
 * Lifecycle / Roster Management docs) considers contract status, role,
 * cap implications, and player intent. For now we use a simple age-based
 * curve and unconditionally backfill vacated slots with rookies so
 * rosters stay at 53 across multi-season runs.
 *
 * The replacement step is intentionally crude: every retiree's slot is
 * filled with a freshly-generated rookie at the same position. The
 * draft module (Phase 3, Doc 3) replaces this with real draft picks +
 * undrafted rookie pool dynamics.
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

interface ReplacementResult {
  player: Player;
  contract: Contract;
}

/**
 * Generate a single rookie + fresh rookie-scale contract to fill a
 * vacated roster slot. Position matches the retiree; archetype is
 * weighted by the team's HC scheme so replacements stay scheme-coherent.
 */
function generateReplacement(
  prng: Prng,
  team: TeamState,
  league: LeagueState,
  retiree: Player,
  idSuffix: string,
  currentTick: number,
): ReplacementResult {
  const hc = league.coaches[team.headCoachId]!;
  const positionGroup = positionGroupFor(retiree.position);
  const side = sideForGroup(positionGroup);

  const nextSeasonNumber = league.seasonNumber + 1;
  const player = generatePlayer(prng.fork('gen'), {
    position: retiree.position,
    idSuffix,
    forceAgeStage: 'ROOKIE',
    simYear: 2026 + (nextSeasonNumber - 1),
    schemeContext: {
      side,
      offensiveScheme: hc.offensiveScheme,
      defensiveScheme: hc.defensiveScheme,
    },
  });
  const playerOnTeam: Player = { ...player, teamId: team.identity.id };
  const contract = generateContract(prng.fork('contract'), {
    player: playerOnTeam,
    idSuffix,
    currentTick,
    fresh: true,
  });
  return {
    player: { ...playerOnTeam, contractId: contract.id },
    contract,
  };
}

function sideForGroup(group: PositionGroup): PlayerArchetype['side'] {
  switch (group) {
    case PositionGroup.QB:
    case PositionGroup.SKILL:
    case PositionGroup.OL:
      return 'OFFENSE';
    case PositionGroup.DL:
    case PositionGroup.LB:
    case PositionGroup.DB:
      return 'DEFENSE';
    case PositionGroup.ST:
      return 'SPECIAL_TEAMS';
    default: {
      const _exhaustive: never = group;
      throw new Error(`Unknown position group: ${String(_exhaustive)}`);
    }
  }
}

export interface RetirementOutcome {
  /** New rosterIds per team (retirees replaced by rookies in place). */
  rosterIdsByTeam: Map<string, readonly PlayerId[]>;
  /** Player IDs removed from the league. */
  retiredPlayerIds: readonly PlayerId[];
  /** Contract IDs to drop (the retirees' contracts). */
  dropContractIds: readonly ContractId[];
  /** Newly generated rookies, keyed by player ID. */
  newPlayers: Record<string, Player>;
  /** Newly generated rookie contracts, keyed by contract ID. */
  newContracts: Record<string, Contract>;
}

/**
 * Process retirement + rookie replacement across all 32 teams.
 *
 * Caller is responsible for merging the outcome into the next
 * LeagueState (drop retired entries from `players`/`contracts`, swap
 * teams' rosterIds, splice in `newPlayers`/`newContracts`). The new
 * tick the rookies' contracts sign on should be the post-advance tick
 * — i.e., the start of the upcoming league year.
 */
export function processRetirements(
  prng: Prng,
  league: LeagueState,
  nextSeasonNumber: number,
  nextTick: number,
): RetirementOutcome {
  const rosterIdsByTeam = new Map<string, readonly PlayerId[]>();
  const retiredPlayerIds: PlayerId[] = [];
  const dropContractIds: ContractId[] = [];
  const newPlayers: Record<string, Player> = {};
  const newContracts: Record<string, Contract> = {};
  const retiredSet = new Set<string>();

  // ─── Active roster: retire + replace with rookie at same position ────
  for (const team of Object.values(league.teams)) {
    const teamPrng = prng.fork(`team:${team.identity.id}`);
    const newRoster: PlayerId[] = [];
    let replacementCounter = 0;

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

        const idSuffix = `${team.identity.abbreviation}_${player.position}_R${nextSeasonNumber}_${replacementCounter}`;
        replacementCounter++;
        const replacement = generateReplacement(
          teamPrng.fork(`replace:${idSuffix}`),
          team,
          league,
          player,
          idSuffix,
          nextTick,
        );
        newPlayers[replacement.player.id] = replacement.player;
        newContracts[replacement.contract.id] = replacement.contract;
        newRoster.push(replacement.player.id);
      } else {
        newRoster.push(playerId);
      }
    }

    rosterIdsByTeam.set(team.identity.id, newRoster);
  }

  // ─── Non-rostered retirees: PS + free agents retire too, but get no
  //     rookie replacement (FA market and PS refill regenerate the pool).
  //     Without this pass, aged-out PS players and unsigned FAs would
  //     accumulate in `league.players` past age 40.
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
    newPlayers,
    newContracts,
  };
}
