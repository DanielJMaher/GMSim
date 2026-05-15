import type { LeagueState } from '../types/league.js';
import type { Player } from '../types/player.js';
import type { Contract } from '../types/contract.js';
import type { TeamState } from '../types/team.js';
import type {
  PlayerId,
  TeamId,
  ContractId as ContractIdType,
} from '../types/ids.js';
import {
  currentCapHit,
  deadMoneyOnPreJune1Release,
  teamCapUsage,
} from '../contracts/cap.js';
import { makeFreeAgentContract } from './free-agency.js';
import { auctionFreeAgent } from './fa-bidding.js';
import type { FaBidderDetail } from './fa-bidding.js';
import { LEAGUE_MINIMUM_SALARY } from '../contracts/constants.js';
import { ContractId } from '../types/ids.js';
import type { Transaction, FaSignBidder } from '../types/transaction.js';

/**
 * Drop every contract whose `yearsRemaining` is 0. The corresponding
 * players become free agents — `teamId` and `contractId` cleared, and
 * they are removed from their old team's roster.
 *
 * Caller must have already decremented `yearsRemaining` for the season
 * just played; this function only consumes the post-decrement state.
 */
export function applyContractExpirations(league: LeagueState): LeagueState {
  const expired: Contract[] = [];
  for (const contract of Object.values(league.contracts)) {
    if (contract.yearsRemaining <= 0) expired.push(contract);
  }
  if (expired.length === 0) return league;

  const playersNext: Record<string, Player> = { ...league.players };
  const contractsNext: Record<string, Contract> = { ...league.contracts };
  const removalsByTeam = new Map<TeamId, Set<PlayerId>>();
  const logEntries: Transaction[] = [];

  for (const contract of expired) {
    const player = playersNext[contract.playerId];
    delete contractsNext[contract.id];
    if (!player) continue; // retired or otherwise gone
    if (player.teamId) {
      const team = league.teams[player.teamId];
      const wasOnActive = team?.rosterIds.includes(player.id) ?? false;
      logEntries.push({
        kind: 'contract-expiration',
        tick: league.tick,
        seasonNumber: league.seasonNumber,
        teamId: player.teamId,
        playerId: player.id,
        contractId: contract.id,
        fromActiveRoster: wasOnActive,
      });
      const set = removalsByTeam.get(player.teamId) ?? new Set<PlayerId>();
      set.add(player.id);
      removalsByTeam.set(player.teamId, set);
    }
    playersNext[contract.playerId] = {
      ...player,
      teamId: null,
      contractId: null,
    };
  }

  const teamsNext: Record<string, TeamState> = { ...league.teams };
  for (const [teamId, removals] of removalsByTeam) {
    const team = teamsNext[teamId];
    if (!team) continue;
    // Filter both rosterIds AND practiceSquadIds — an expired player may
    // have been on either list. Filtering both is cheap and keeps PS
    // contract churn coherent without a separate code path.
    teamsNext[teamId] = {
      ...team,
      rosterIds: team.rosterIds.filter((id) => !removals.has(id)),
      practiceSquadIds: team.practiceSquadIds.filter((id) => !removals.has(id)),
    };
  }

  return {
    ...league,
    teams: teamsNext as Readonly<Record<TeamId, TeamState>>,
    players: playersNext as Readonly<Record<PlayerId, Player>>,
    contracts: contractsNext as Readonly<Record<ContractIdType, Contract>>,
    transactionLog: [...league.transactionLog, ...logEntries],
  };
}

/**
 * For every team currently over the salary cap, repeatedly release the
 * player whose cut yields the largest *positive* cap saving
 * (`currentCapHit - deadMoney`) until the team is back under the cap or
 * no positive-saving cuts remain.
 *
 * Released players join the free-agent pool with their dead money
 * accruing to the team's current-year `deadMoneyByYear[0]`.
 */
export function applyCapCuts(league: LeagueState): LeagueState {
  let working = league;

  for (const teamId of Object.keys(league.teams) as TeamId[]) {
    while (true) {
      const team = working.teams[teamId]!;
      const usage = teamCapUsage(team, working);
      if (usage <= working.salaryCap) break;

      const candidate = pickCapCutCandidate(team, working);
      if (!candidate) break;

      working = applyRelease(
        working,
        teamId,
        candidate.playerId,
        candidate.deadMoney,
        candidate.saving,
      );
    }
  }
  return working;
}

interface CutCandidate {
  playerId: PlayerId;
  deadMoney: number;
  saving: number;
}

function pickCapCutCandidate(team: TeamState, league: LeagueState): CutCandidate | null {
  let best: CutCandidate | null = null;
  for (const playerId of team.rosterIds) {
    const player = league.players[playerId];
    if (!player || !player.contractId) continue;
    const contract = league.contracts[player.contractId];
    if (!contract) continue;
    const dead = deadMoneyOnPreJune1Release(contract);
    const saving = currentCapHit(contract) - dead;
    if (saving <= 0) continue;
    if (!best || saving > best.saving || (saving === best.saving && playerId < best.playerId)) {
      best = { playerId, deadMoney: dead, saving };
    }
  }
  return best;
}

/**
 * Inline release primitive used by cap-cuts. Mirrors transactions/release.ts
 * but precomputes the dead money so the candidate-picker isn't recomputing.
 */
function applyRelease(
  league: LeagueState,
  teamId: TeamId,
  playerId: PlayerId,
  deadMoney: number,
  saving: number,
): LeagueState {
  const team = league.teams[teamId]!;
  const player = league.players[playerId]!;
  const contractId = player.contractId!;

  const teamsNext = {
    ...league.teams,
    [teamId]: {
      ...team,
      rosterIds: team.rosterIds.filter((id) => id !== playerId),
      deadMoneyByYear: addToYear(team.deadMoneyByYear, 0, deadMoney),
    },
  } as Readonly<Record<TeamId, TeamState>>;

  const playersNext = {
    ...league.players,
    [playerId]: { ...player, teamId: null, contractId: null },
  } as Readonly<Record<PlayerId, Player>>;

  const contractsNext: Record<string, Contract> = { ...league.contracts };
  delete contractsNext[contractId];

  const entry: Transaction = {
    kind: 'cap-cut',
    tick: league.tick,
    seasonNumber: league.seasonNumber,
    teamId,
    playerId,
    contractId,
    deadMoney,
    capSaving: saving,
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

/**
 * Run the offseason free-agent market. Each available FA — sorted in
 * tier order (STAR → FRINGE), then by skill within tier — goes through
 * `auctionFreeAgent`, a second-price bidding pass where every team
 * computes a cash valuation (scheme fit × positional need × cap room)
 * and a player-preference multiplier (personality + market size +
 * owner/HC quirks). The winner is whoever maximises `cash × preference`;
 * the price is the runner-up's cash valuation plus a 2% nudge, capped
 * at the winner's own valuation. A lone bidder gets the player at 85%
 * of their valuation (the single-bidder discount).
 *
 * If no team has roster space, positional need, AND cap room for any
 * positive bid, the FA falls through to a **fill-up** pass that signs
 * them to a 1-year veteran-minimum deal at the most-depleted team with
 * room — guaranteeing rosters approach 53 even when scheme/need/cap
 * pinches in the auction.
 */
export function refillRosters(league: LeagueState, signedOnTick: number): LeagueState {
  const orderedPool = sortedFreeAgentPool(league);

  let working = league;
  let signCounter = 0;
  const stillUnsigned: PlayerId[] = [];

  for (const playerId of orderedPool) {
    const player = working.players[playerId];
    if (!player || player.teamId !== null) continue;

    const auction = auctionFreeAgent(working, player);
    if (auction.winnerTeamId) {
      const team = working.teams[auction.winnerTeamId]!;
      const idSuffix = `${team.identity.abbreviation}_FA${working.seasonNumber}_${signCounter++}`;
      working = signAuctionWinner(
        working,
        auction.winnerTeamId,
        playerId,
        idSuffix,
        signedOnTick,
        auction.valuationMultiplier,
        auction.runnersUp,
        auction.bidders,
      );
    } else {
      stillUnsigned.push(playerId);
    }
  }

  // Fill-up pass: any FA still unsigned takes a vet-minimum deal at the
  // most-depleted team that has roster space and at least minimum cap room.
  for (const playerId of stillUnsigned) {
    const player = working.players[playerId];
    if (!player || player.teamId !== null) continue;

    const teamId = pickFillUpTeam(working);
    if (!teamId) break; // no team has space + min-cap-room remaining

    const team = working.teams[teamId]!;
    const idSuffix = `${team.identity.abbreviation}_FAmin${working.seasonNumber}_${signCounter++}`;
    working = signMinimumTo(working, teamId, playerId, idSuffix, signedOnTick);
  }

  return working;
}

/**
 * Build the ordered FA pool: tier-major (STAR best), then skill-summary
 * descending, then PlayerId for deterministic tiebreak.
 */
function sortedFreeAgentPool(league: LeagueState): readonly PlayerId[] {
  const pool: PlayerId[] = [];
  for (const player of Object.values(league.players)) {
    if (player.teamId !== null) continue;
    pool.push(player.id);
  }
  pool.sort((a, b) => compareForSigning(league.players[a]!, league.players[b]!));
  return pool;
}

const TIER_RANK: Record<Player['tier'], number> = {
  STAR: 0,
  STARTER: 1,
  BACKUP: 2,
  FRINGE: 3,
};

function compareForSigning(a: Player, b: Player): number {
  const t = TIER_RANK[a.tier] - TIER_RANK[b.tier];
  if (t !== 0) return t;
  const sa = skillSummary(a);
  const sb = skillSummary(b);
  if (sa !== sb) return sb - sa;
  return a.id < b.id ? -1 : 1;
}

function skillSummary(player: Player): number {
  const s = player.current;
  return (
    s.technicalSkill +
    s.footballIq +
    s.speed +
    s.strength +
    s.decisionMaking
  );
}

/**
 * Pick a team for the fill-up pass: most under-53, with at least
 * league-minimum cap room. Ignores scheme and positional fit.
 */
function pickFillUpTeam(league: LeagueState): TeamId | null {
  let bestId: TeamId | null = null;
  let bestDeficit = -Infinity;

  for (const team of Object.values(league.teams)) {
    if (team.rosterIds.length >= 53) continue;
    const capRoom = league.salaryCap - teamCapUsage(team, league);
    if (capRoom < LEAGUE_MINIMUM_SALARY) continue;
    const deficit = 53 - team.rosterIds.length;
    if (
      deficit > bestDeficit ||
      (deficit === bestDeficit && (bestId === null || team.identity.id < bestId))
    ) {
      bestDeficit = deficit;
      bestId = team.identity.id;
    }
  }
  return bestId;
}

/**
 * Sign an auction-winning team to the FA at a deal scaled by the
 * auction outcome. The tier-shape (years, signing-bonus split,
 * guarantee depth) is preserved; only base salary and signing bonus
 * scale with `valuationMultiplier`. Runners-up land on the resulting
 * `fa-sign` transaction so the news feed can surface lost-out interest.
 */
function signAuctionWinner(
  league: LeagueState,
  teamId: TeamId,
  playerId: PlayerId,
  idSuffix: string,
  signedOnTick: number,
  valuationMultiplier: number,
  runnersUp: readonly TeamId[],
  bidders: readonly FaBidderDetail[],
): LeagueState {
  const player = league.players[playerId]!;
  const team = league.teams[teamId]!;
  const contract = makeFreeAgentContract(
    player,
    teamId,
    idSuffix,
    signedOnTick,
    valuationMultiplier,
  );
  // FaBidderDetail (auction module) and FaSignBidder (transaction
  // type) are structurally identical — copy across to keep the
  // transaction type free of an inbound dependency on the auction
  // module.
  const txnBidders: FaSignBidder[] = bidders.map((b) => ({
    teamId: b.teamId,
    cashValuation: b.cashValuation,
    cashValuationBaseline: b.cashValuationBaseline,
    preferenceMultiplier: b.preferenceMultiplier,
    perceivedBid: b.perceivedBid,
    capRoomAtTime: b.capRoomAtTime,
    preferenceFactors: { ...b.preferenceFactors },
    watchListMultiplier: b.watchListMultiplier,
    watchListPriority: b.watchListPriority,
    watchListReason: b.watchListReason,
  }));
  return mergeSigning(league, team, player, contract, runnersUp, txnBidders);
}

/**
 * Sign a free agent to a 1-year league-minimum deal — used only by the
 * fill-up pass when a team has no positional need or insufficient cap
 * room for the FA's tier deal.
 */
function signMinimumTo(
  league: LeagueState,
  teamId: TeamId,
  playerId: PlayerId,
  idSuffix: string,
  signedOnTick: number,
): LeagueState {
  const player = league.players[playerId]!;
  const team = league.teams[teamId]!;
  const contract: Contract = {
    id: ContractId(`C_${idSuffix}`),
    playerId: player.id,
    teamId,
    signedOnTick,
    realYears: 1,
    voidYears: 0,
    yearsRemaining: 1,
    baseSalaries: [LEAGUE_MINIMUM_SALARY],
    signingBonus: 0,
    rosterBonuses: [0],
    workoutBonuses: [0],
    guarantees: [{ baseGuaranteedPct: 0, type: 'NONE' }],
    incentives: [],
    noTradeClause: false,
  };
  return mergeSigning(league, team, player, contract);
}

function mergeSigning(
  league: LeagueState,
  team: TeamState,
  player: Player,
  contract: Contract,
  runnersUp: readonly TeamId[] = [],
  bidders: readonly FaSignBidder[] = [],
): LeagueState {
  const entry: Transaction = {
    kind: 'fa-sign',
    tick: contract.signedOnTick,
    seasonNumber: league.seasonNumber,
    teamId: team.identity.id,
    playerId: player.id,
    contractId: contract.id,
    yearOneCapHit: currentCapHit(contract),
    marketContract: contract.realYears > 1 || contract.signingBonus > 0,
    phaseAtSigning: league.phase,
    ...(runnersUp.length > 0 ? { runnersUp } : {}),
    ...(bidders.length > 0 ? { bidders } : {}),
  };
  return {
    ...league,
    teams: {
      ...league.teams,
      [team.identity.id]: { ...team, rosterIds: [...team.rosterIds, player.id] },
    } as Readonly<Record<TeamId, TeamState>>,
    players: {
      ...league.players,
      [player.id]: { ...player, teamId: team.identity.id, contractId: contract.id },
    } as Readonly<Record<PlayerId, Player>>,
    contracts: {
      ...league.contracts,
      [contract.id]: contract,
    } as Readonly<Record<ContractIdType, Contract>>,
    transactionLog: [...league.transactionLog, entry],
  };
}
