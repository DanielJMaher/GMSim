import type { LeagueState } from '../types/league.js';
import type { Player } from '../types/player.js';
import type { Contract } from '../types/contract.js';
import type { TeamState } from '../types/team.js';
import type { Transaction } from '../types/transaction.js';
import type {
  PlayerId,
  TeamId,
  ContractId as ContractIdType,
} from '../types/ids.js';
import { ContractId } from '../types/ids.js';
import { signingBonusProrationPerYear } from '../contracts/cap.js';

/**
 * A two-team trade: each side sends some players to the other. Phase 2
 * MVP — no draft picks, no cash considerations, no third-team brokers.
 * Those land alongside the draft module.
 */
export interface TradePayload {
  teamAId: TeamId;
  teamBId: TeamId;
  /** Players moving from team A to team B. */
  playersAToB: readonly PlayerId[];
  /** Players moving from team B to team A. */
  playersBToA: readonly PlayerId[];
  /**
   * If true, traded players with `noTradeClause` go through anyway.
   * Defaults to false — the clause blocks the trade.
   */
  overrideNoTrade?: boolean;
  /**
   * Optional metadata propagated to the `trade` transaction. Pure
   * pass-through — `executeTrade` doesn't read these for any decision,
   * they exist so the transaction log can carry the *why* alongside
   * the *what*. Inspector reads these to render the trade-detail panel.
   */
  metadata?: TradeMetadata;
}

/**
 * Provenance + valuation metadata that an automated trade pipeline
 * (proactive trades, NPC trade-request matcher) attaches to the
 * resulting transaction. Manual / hand-constructed trades omit this.
 */
export interface TradeMetadata {
  /** Team that initiated the conversation. */
  initiatorTeamId?: TeamId;
  /** What pipeline produced the trade. */
  source?:
    | 'proactive-need'
    | 'proactive-fit-swap'
    | 'request-driven'
    | 'manual';
  /** Doc 14 5-factor breakdown from team A's perspective. */
  teamAValue?: import('../trade/value.js').TradePackageEvaluation;
  /** Doc 14 5-factor breakdown from team B's perspective. */
  teamBValue?: import('../trade/value.js').TradePackageEvaluation;
  /** Other trades considered but not fired — see TransactionTrade docs. */
  alternativeCandidates?: readonly import('../types/transaction.js').AlternativeTradeCandidate[];
}

/**
 * Execute a trade between two teams. Returns a new LeagueState with:
 *
 *   - Each traded player's old contract dropped from `league.contracts`.
 *   - Each traded player gets a fresh contract on their new team with
 *     the same remaining base salaries / guarantees but `signingBonus = 0`
 *     (the original team paid the bonus; receiving teams take only the
 *     base going forward, mirroring real NFL trade-cap mechanics).
 *   - Each traded player's `Player.teamId` and `contractId` updated.
 *   - Both rosters spliced — players removed from origin, added to
 *     destination. (PS / IR lists are not eligible to trade in this
 *     MVP — only active rosterIds.)
 *   - Each trading team accrues remaining-proration dead money for
 *     the players they traded away into `team.deadMoneyByYear[0]`.
 *
 * Throws if a listed player is not on the listed team's active roster
 * or has a no-trade clause without override.
 */
export function executeTrade(league: LeagueState, payload: TradePayload): LeagueState {
  const teamA = league.teams[payload.teamAId];
  const teamB = league.teams[payload.teamBId];
  if (!teamA) throw new Error(`executeTrade: team ${payload.teamAId} not found`);
  if (!teamB) throw new Error(`executeTrade: team ${payload.teamBId} not found`);
  if (payload.teamAId === payload.teamBId) {
    throw new Error('executeTrade: cannot trade within a single team');
  }

  validateTradeSide(league, teamA, payload.playersAToB, payload.overrideNoTrade);
  validateTradeSide(league, teamB, payload.playersBToA, payload.overrideNoTrade);

  // Collect per-side dead money from trade-away proration acceleration.
  const deadA = sumRemainingProration(league, payload.playersAToB);
  const deadB = sumRemainingProration(league, payload.playersBToA);

  // Build new contracts on receiving teams.
  const replacements: { player: Player; contract: Contract; oldContractId: ContractIdType }[] = [];
  for (const playerId of payload.playersAToB) {
    replacements.push(
      buildTradeContract(league, playerId, payload.teamBId, league.tick),
    );
  }
  for (const playerId of payload.playersBToA) {
    replacements.push(
      buildTradeContract(league, playerId, payload.teamAId, league.tick),
    );
  }

  // Apply: drop old contracts, add new ones, update players.
  const contractsNext: Record<string, Contract> = { ...league.contracts };
  const playersNext: Record<string, Player> = { ...league.players };
  for (const r of replacements) {
    delete contractsNext[r.oldContractId];
    contractsNext[r.contract.id] = r.contract;
    playersNext[r.player.id] = r.player;
  }

  // Splice rosters.
  const aMovingOut = new Set<PlayerId>(payload.playersAToB);
  const bMovingOut = new Set<PlayerId>(payload.playersBToA);
  const teamANext: TeamState = {
    ...teamA,
    rosterIds: [
      ...teamA.rosterIds.filter((id) => !aMovingOut.has(id)),
      ...payload.playersBToA,
    ],
    deadMoneyByYear: addToYear(teamA.deadMoneyByYear, 0, deadA),
  };
  const teamBNext: TeamState = {
    ...teamB,
    rosterIds: [
      ...teamB.rosterIds.filter((id) => !bMovingOut.has(id)),
      ...payload.playersAToB,
    ],
    deadMoneyByYear: addToYear(teamB.deadMoneyByYear, 0, deadB),
  };

  const meta = payload.metadata;
  const entry: Transaction = {
    kind: 'trade',
    tick: league.tick,
    seasonNumber: league.seasonNumber,
    teamAId: payload.teamAId,
    teamBId: payload.teamBId,
    playersAToB: [...payload.playersAToB],
    playersBToA: [...payload.playersBToA],
    deadMoneyTeamA: deadA,
    deadMoneyTeamB: deadB,
    ...(meta?.initiatorTeamId ? { initiatorTeamId: meta.initiatorTeamId } : {}),
    ...(meta?.source ? { source: meta.source } : {}),
    ...(meta?.teamAValue ? { teamAValue: meta.teamAValue } : {}),
    ...(meta?.teamBValue ? { teamBValue: meta.teamBValue } : {}),
    ...(meta?.alternativeCandidates && meta.alternativeCandidates.length > 0
      ? { alternativeCandidates: meta.alternativeCandidates }
      : {}),
  };

  return {
    ...league,
    teams: {
      ...league.teams,
      [payload.teamAId]: teamANext,
      [payload.teamBId]: teamBNext,
    } as Readonly<Record<TeamId, TeamState>>,
    players: playersNext as Readonly<Record<PlayerId, Player>>,
    contracts: contractsNext as Readonly<Record<ContractIdType, Contract>>,
    transactionLog: [...league.transactionLog, entry],
  };
}

function validateTradeSide(
  league: LeagueState,
  team: TeamState,
  playerIds: readonly PlayerId[],
  overrideNoTrade?: boolean,
): void {
  for (const playerId of playerIds) {
    if (!team.rosterIds.includes(playerId)) {
      throw new Error(
        `executeTrade: player ${playerId} not on team ${team.identity.id} active roster`,
      );
    }
    const player = league.players[playerId];
    if (!player) throw new Error(`executeTrade: player ${playerId} not found`);
    if (!player.contractId) {
      throw new Error(`executeTrade: player ${playerId} has no contract`);
    }
    const contract = league.contracts[player.contractId];
    if (!contract) {
      throw new Error(`executeTrade: contract ${player.contractId} missing`);
    }
    if (contract.noTradeClause && !overrideNoTrade) {
      throw new Error(
        `executeTrade: player ${playerId} has a no-trade clause (set overrideNoTrade to bypass)`,
      );
    }
  }
}

function sumRemainingProration(league: LeagueState, playerIds: readonly PlayerId[]): number {
  let total = 0;
  for (const playerId of playerIds) {
    const player = league.players[playerId]!;
    const contract = league.contracts[player.contractId!]!;
    total += signingBonusProrationPerYear(contract) * contract.yearsRemaining;
  }
  return total;
}

/**
 * Build a fresh contract on the receiving team that mirrors the
 * traded player's remaining years + base salaries + guarantees,
 * but with no signing bonus (already paid by the originating team).
 * Returns the new player record + new contract + the old contract id
 * (so the caller can drop the old contract from the league map).
 */
function buildTradeContract(
  league: LeagueState,
  playerId: PlayerId,
  receivingTeamId: TeamId,
  signedOnTick: number,
): { player: Player; contract: Contract; oldContractId: ContractIdType } {
  const player = league.players[playerId]!;
  const oldContract = league.contracts[player.contractId!]!;
  const yearOfDeal = oldContract.realYears - oldContract.yearsRemaining;
  const remainingBaseSalaries = oldContract.baseSalaries.slice(yearOfDeal);
  const remainingRosterBonuses = oldContract.rosterBonuses.slice(yearOfDeal);
  const remainingWorkoutBonuses = oldContract.workoutBonuses.slice(yearOfDeal);
  const remainingGuarantees = oldContract.guarantees.slice(yearOfDeal);

  const newId = ContractId(`${oldContract.id}_TR${signedOnTick}`);
  const newContract: Contract = {
    id: newId,
    playerId: player.id,
    teamId: receivingTeamId,
    signedOnTick,
    realYears: oldContract.yearsRemaining,
    voidYears: 0,
    yearsRemaining: oldContract.yearsRemaining,
    baseSalaries: remainingBaseSalaries,
    signingBonus: 0,
    rosterBonuses: remainingRosterBonuses,
    workoutBonuses: remainingWorkoutBonuses,
    guarantees: remainingGuarantees,
    incentives: [],
    noTradeClause: false,
  };
  return {
    player: { ...player, teamId: receivingTeamId, contractId: newId },
    contract: newContract,
    oldContractId: oldContract.id,
  };
}

function addToYear(
  arr: readonly number[],
  index: number,
  amount: number,
): readonly number[] {
  const next = arr.slice();
  while (next.length <= index) next.push(0);
  next[index] = (next[index] ?? 0) + amount;
  return next;
}
