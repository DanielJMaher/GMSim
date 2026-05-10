import type { LeagueState } from '../types/league.js';
import type { TeamState } from '../types/team.js';
import type { Player } from '../types/player.js';
import type { Contract } from '../types/contract.js';
import type { Transaction } from '../types/transaction.js';
import type {
  PlayerId,
  TeamId,
  ContractId as ContractIdType,
} from '../types/ids.js';
import { deadMoneyOnPreJune1Release } from '../contracts/cap.js';

/**
 * Release a player from their team. Returns a new LeagueState with:
 *
 *   - Player removed from the team's roster.
 *   - Player.teamId / contractId cleared (player becomes a free agent).
 *   - The player's contract removed from league.contracts.
 *   - Resulting dead money accrued to the team's current-year
 *     deadMoneyByYear[0] charge.
 *
 * Dead money uses the pre-June-1 model — the entire remaining proration
 * accelerates onto the current year, plus any guaranteed remaining base.
 * The post-June-1 split (current year + next year) is a follow-up.
 *
 * Throws if the player is not on the given player's team or has no
 * contract — releasing a free agent is a no-op the caller should catch.
 */
export function releasePlayer(league: LeagueState, playerId: PlayerId): LeagueState {
  const player = league.players[playerId];
  if (!player) {
    throw new Error(`releasePlayer: player ${playerId} not found`);
  }
  if (!player.teamId) {
    throw new Error(`releasePlayer: player ${playerId} is already a free agent`);
  }
  if (!player.contractId) {
    throw new Error(`releasePlayer: player ${playerId} has no contract`);
  }
  const contract = league.contracts[player.contractId];
  if (!contract) {
    throw new Error(`releasePlayer: contract ${player.contractId} missing for ${playerId}`);
  }
  const team = league.teams[player.teamId];
  if (!team) {
    throw new Error(`releasePlayer: team ${player.teamId} not found`);
  }
  if (!team.rosterIds.includes(playerId)) {
    throw new Error(
      `releasePlayer: player ${playerId} not on roster of team ${player.teamId}`,
    );
  }

  const dead = deadMoneyOnPreJune1Release(contract);

  const updatedTeam: TeamState = {
    ...team,
    rosterIds: team.rosterIds.filter((id) => id !== playerId),
    deadMoneyByYear: addToYear(team.deadMoneyByYear, 0, dead),
  };

  const updatedPlayer: Player = {
    ...player,
    teamId: null,
    contractId: null,
  };

  const teamsNext = { ...league.teams, [team.identity.id]: updatedTeam } as Readonly<
    Record<TeamId, TeamState>
  >;
  const playersNext = { ...league.players, [playerId]: updatedPlayer } as Readonly<
    Record<PlayerId, Player>
  >;
  const contractsNext: Record<string, Contract> = { ...league.contracts };
  delete contractsNext[contract.id];

  const entry: Transaction = {
    kind: 'release',
    tick: league.tick,
    seasonNumber: league.seasonNumber,
    teamId: team.identity.id,
    playerId,
    contractId: contract.id,
    deadMoney: dead,
  };

  return {
    ...league,
    teams: teamsNext,
    players: playersNext,
    contracts: contractsNext as Readonly<Record<ContractIdType, Contract>>,
    transactionLog: [...league.transactionLog, entry],
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
