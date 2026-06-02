import type { LeagueState } from '../types/league.js';
import type { Player, TalentTier } from '../types/player.js';
import type { Contract } from '../types/contract.js';
import type { TeamState } from '../types/team.js';
import type { Transaction } from '../types/transaction.js';
import { currentCapHit } from '../contracts/cap.js';
import type {
  PlayerId,
  TeamId,
  ContractId as ContractIdType,
} from '../types/ids.js';
import { ContractId } from '../types/ids.js';
import type { Position } from '../types/enums.js';
import { LEAGUE_MINIMUM_SALARY } from '../contracts/constants.js';
import { buildGuaranteedSplit } from '../contracts/tiers.js';

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

  const entry: Transaction = {
    kind: 'fa-sign',
    tick: options.signedOnTick,
    seasonNumber: league.seasonNumber,
    teamId,
    playerId,
    contractId: contract.id,
    yearOneCapHit: currentCapHit(contract),
    marketContract: true,
    phaseAtSigning: league.phase,
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
    transactionLog: [...league.transactionLog, entry],
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
}

// NOTE: `baseSalary` + `signingBonus` here only set the deal's TOTAL value (and
// thus its APY / Y1 cap hit, which the auction is gated on). The actual
// bonus/base split + guarantee depth are derived position-by-position from the
// total via `buildGuaranteedSplit` (Liquidator Slice 3b) — so these per-tier
// numbers no longer fix the guaranteed structure, only the headline value.
const FA_DEAL_BY_TIER: Record<TalentTier, FreeAgentDealShape> = {
  STAR: {
    realYears: 4,
    baseSalary: 9_000_000,
    signingBonus: 24_000_000,
  },
  STARTER: {
    realYears: 3,
    baseSalary: 2_400_000,
    signingBonus: 2_400_000,
  },
  BACKUP: {
    realYears: 2,
    baseSalary: 900_000,
    signingBonus: 200_000,
  },
  FRINGE: {
    realYears: 1,
    baseSalary: LEAGUE_MINIMUM_SALARY,
    signingBonus: 0,
  },
};

/**
 * Build a tier-appropriate free-agent contract — multi-year for
 * STAR/STARTER/BACKUP, 1-year league-minimum for FRINGE.
 *
 * `valuationMultiplier` scales both the per-year base salary and the
 * signing bonus around the tier's standard shape. Default 1.0 reproduces
 * the v0.13.0–v0.19.0 flat tier deals (used by mid-season vet-min
 * signings and explicit caller-driven signings). The offseason auction
 * in `fa-bidding.ts` supplies a multiplier in roughly [0.55, 1.80] based
 * on competitive bidding outcomes.
 *
 * Deterministic given the inputs — no PRNG.
 */
export function makeFreeAgentContract(
  player: Player,
  teamId: TeamId,
  idSuffix: string,
  signedOnTick: number,
  valuationMultiplier: number = 1.0,
): Contract {
  const shape = FA_DEAL_BY_TIER[player.tier];
  const scaledBase = Math.round(shape.baseSalary * valuationMultiplier);
  const scaledBonus = Math.round(shape.signingBonus * valuationMultiplier);
  // Total deal value the auction priced — its APY / Y1 cap hit. We hold this
  // fixed and let `buildGuaranteedSplit` re-divide it into a position-aware
  // bonus/base split + guarantee depth (Liquidator Slice 3b). Because the base
  // is split evenly, Y1 cap hit stays = totalValue / realYears regardless of the
  // bonus share, so the auction's cap gate (which assumes Y1 == the priced
  // valuation) is unaffected — only guaranteed money / dead-money moves.
  const totalValue = scaledBase * shape.realYears + scaledBonus;
  const { signingBonus, baseSalaries, guarantees } = buildGuaranteedSplit({
    totalValue,
    realYears: shape.realYears,
    baseShape: new Array<number>(shape.realYears).fill(1),
    position: player.position,
    tier: player.tier,
  });
  return {
    id: ContractId(`C_${idSuffix}`),
    playerId: player.id,
    teamId,
    signedOnTick,
    realYears: shape.realYears,
    voidYears: 0,
    yearsRemaining: shape.realYears,
    baseSalaries,
    signingBonus,
    rosterBonuses: new Array(shape.realYears).fill(0),
    workoutBonuses: new Array(shape.realYears).fill(0),
    guarantees,
    incentives: [],
    noTradeClause: false,
  };
}
