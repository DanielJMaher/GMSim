import type { LeagueState } from '../types/league.js';
import type { Player, TalentTier } from '../types/player.js';
import type { Contract, ContractGuarantee } from '../types/contract.js';
import type { TeamState } from '../types/team.js';
import type {
  PlayerId,
  TeamId,
  ContractId as ContractIdType,
} from '../types/ids.js';
import { ContractId } from '../types/ids.js';
import type { Position } from '../types/enums.js';
import { LEAGUE_MINIMUM_SALARY } from '../contracts/constants.js';

/**
 * All players currently without a team. A player is a free agent when
 * `teamId === null`. Retired players are removed from `league.players`
 * entirely (see retirement.ts), so they never show up here.
 */
export function freeAgents(league: LeagueState): readonly Player[] {
  const out: Player[] = [];
  for (const player of Object.values(league.players)) {
    if (player.teamId === null) out.push(player);
  }
  return out;
}

export function freeAgentsByPosition(
  league: LeagueState,
  position: Position,
): readonly Player[] {
  const out: Player[] = [];
  for (const player of Object.values(league.players)) {
    if (player.teamId === null && player.position === position) out.push(player);
  }
  return out;
}

export interface SignFreeAgentOptions {
  /** Stable suffix used to build the new ContractId. */
  idSuffix: string;
  /** Tick on which the new deal is signed (typically the post-advance tick). */
  signedOnTick: number;
}

/**
 * Sign a free agent to a 1-year, tier-appropriate prove-it deal on the
 * given team. Returns a new LeagueState with the player on the roster,
 * a new Contract added, and Player.teamId / contractId set.
 *
 * Phase-2 minimum-viable resign — covers roster refills after offseason
 * cuts and any explicit FA signings. Real bid-driven free agency (term
 * length, scheme-fit premium, market competition) lands in the next slice.
 */
export function signFreeAgent(
  league: LeagueState,
  teamId: TeamId,
  playerId: PlayerId,
  options: SignFreeAgentOptions,
): LeagueState {
  const player = league.players[playerId];
  if (!player) throw new Error(`signFreeAgent: player ${playerId} not found`);
  if (player.teamId !== null) {
    throw new Error(`signFreeAgent: player ${playerId} is already on team ${player.teamId}`);
  }
  const team = league.teams[teamId];
  if (!team) throw new Error(`signFreeAgent: team ${teamId} not found`);

  const contract = makeFreeAgentContract(player, teamId, options.idSuffix, options.signedOnTick);

  const updatedPlayer: Player = {
    ...player,
    teamId,
    contractId: contract.id,
  };
  const updatedTeam: TeamState = {
    ...team,
    rosterIds: [...team.rosterIds, playerId],
  };

  return {
    ...league,
    teams: { ...league.teams, [teamId]: updatedTeam } as Readonly<
      Record<TeamId, TeamState>
    >,
    players: { ...league.players, [playerId]: updatedPlayer } as Readonly<
      Record<PlayerId, Player>
    >,
    contracts: {
      ...league.contracts,
      [contract.id]: contract,
    } as Readonly<Record<ContractIdType, Contract>>,
  };
}

/**
 * Per-tier shape for a free-agent market deal — duration, base salary,
 * signing bonus, and guarantee depth. Numbers are tuned so a roster of
 * mixed-tier FA contracts (after a few seasons of churn) lands the
 * league-wide cap usage in a realistic mid-offseason band (~$170–250M
 * per team), with STARs taking a modest discount vs. their multi-year
 * extension value.
 */
interface FreeAgentDealShape {
  realYears: number;
  baseSalary: number;
  signingBonus: number;
  /** Number of leading years where the base salary is fully guaranteed. */
  guaranteedYears: number;
}

const FA_DEAL_BY_TIER: Record<TalentTier, FreeAgentDealShape> = {
  STAR: {
    realYears: 4,
    baseSalary: 7_000_000,
    signingBonus: 14_000_000,
    guaranteedYears: 2,
  },
  STARTER: {
    realYears: 3,
    baseSalary: 3_000_000,
    signingBonus: 3_000_000,
    guaranteedYears: 1,
  },
  BACKUP: {
    realYears: 2,
    baseSalary: 1_100_000,
    signingBonus: 200_000,
    guaranteedYears: 1,
  },
  FRINGE: {
    realYears: 1,
    baseSalary: LEAGUE_MINIMUM_SALARY,
    signingBonus: 0,
    guaranteedYears: 0,
  },
};

/**
 * Build a tier-appropriate free-agent contract — multi-year for
 * STAR/STARTER/BACKUP, 1-year league-minimum for FRINGE.
 *
 * Deterministic given (player, teamId, idSuffix, signedOnTick): each
 * tier collapses to a fixed deal shape, so no PRNG is needed.
 */
export function makeFreeAgentContract(
  player: Player,
  teamId: TeamId,
  idSuffix: string,
  signedOnTick: number,
): Contract {
  const shape = FA_DEAL_BY_TIER[player.tier];
  const baseSalaries = new Array(shape.realYears).fill(shape.baseSalary);
  const guarantees: ContractGuarantee[] = [];
  for (let y = 0; y < shape.realYears; y++) {
    if (y < shape.guaranteedYears) {
      guarantees.push({ baseGuaranteedPct: 100, type: 'FULLY_GUARANTEED' });
    } else {
      guarantees.push({ baseGuaranteedPct: 0, type: 'NONE' });
    }
  }
  return {
    id: ContractId(`C_${idSuffix}`),
    playerId: player.id,
    teamId,
    signedOnTick,
    realYears: shape.realYears,
    voidYears: 0,
    yearsRemaining: shape.realYears,
    baseSalaries,
    signingBonus: shape.signingBonus,
    rosterBonuses: new Array(shape.realYears).fill(0),
    workoutBonuses: new Array(shape.realYears).fill(0),
    guarantees,
    incentives: [],
    noTradeClause: false,
  };
}
