import type { LeagueState } from '../types/league.js';
import type { Player } from '../types/player.js';
import type { Contract } from '../types/contract.js';
import type { TeamState } from '../types/team.js';
import type {
  PlayerId,
  TeamId,
  ContractId as ContractIdType,
} from '../types/ids.js';
import { ContractId } from '../types/ids.js';
import type { Transaction } from '../types/transaction.js';
import { currentCapHit, teamCapUsage } from '../contracts/cap.js';
import { leagueMinimumSalary } from '../contracts/constants.js';
import { restructureContract, MIN_CONVERTIBLE } from './restructures.js';
import { pickMinimalCasualty, sortedFreeAgentPool } from './offseason.js';

/**
 * The mandatory-53 ROSTER FLOOR (Roster Floor design doc, v0.186).
 *
 * A compliant-but-cap-strapped team can open a season below 53: every existing
 * mechanism that frees cap room is triggered by being OVER the cap
 * (`applyMinimalCapCasualties`' `over <= 0` guard) or skips a team with
 * `capRoom < leagueMinimumSalary` (`applyVetMinFillUp` / `pickFillUpTeam`), so a
 * team pinned *just under* the cap with a roster hole has no way to free room
 * for minimum bodies. Real NFL teams never field 48: fielding 53 is mandatory,
 * marginal cap space yields to it.
 *
 * `enforceRosterFloor` is the backstop. For every team pinned below 53 (roster
 * short AND less than one minimum salary of room), it walks a restructure-first
 * escalation ladder to free exactly the room the fill requires, then signs
 * vet-minimum bodies back to 53:
 *
 *   Rung 1 — restructure (minimal footprint). The pinned team is by
 *     construction carrying large veteran deals; convert only what the fill
 *     needs (`selectFloorRestructure` + `restructureContract`'s `maxConvert`),
 *     adding the least future dead money. No competitive-window gate — floor
 *     enforcement is league-rule survival, not appetite (design §2.1, sign-off
 *     call #2). Not counted against `MAX_RESTRUCTURES_PER_SEASON` (that bounds
 *     the discretionary war-chest pass).
 *   Rung 2 — fringe cut. If nothing is restructurable, shed the cheapest
 *     sufficient vet (`pickMinimalCasualty`, target `need + one min salary`
 *     because the cut opens one more slot to refill).
 *   Rung 3 — escalate: the loop re-enters rungs 1-2 until affordable. The
 *     ladder provably terminates — a cap-pinned sub-53 team carries large
 *     contracts, each either multi-year (→ rung-1 convertible) or expiring
 *     (→ small dead money → positive-saving cut); an all-minimum roster has
 *     usage far under the cap, contradicting "pinned" (design §2.3, verified
 *     empirically by D0-P2: 0 unclearable pins in 7,680 team-seasons).
 *   Rung 4 — the loud failure. If the ladder somehow exhausts, record a
 *     `roster-floor-violation` and let the exact-53 invariant tests fail
 *     loudly. The guarantee is "53 or a red test", never "48 and shrug"
 *     (design §2.4). No cap tolerance / minimum-salary-benefit discount — that
 *     would reintroduce the born-non-compliant class v0.174.1 killed (fence §7).
 *
 * Runs at two points, one ladder, two enforcement postures (design §3):
 *   - The Week-1 boundary (end of `applyPostDraftRoster`) — where INV-FLOOR is
 *     asserted and the exact-53 tests + pin-rate gate live.
 *   - Mid-season, as the affordability fallback of the weekly FA pass — an
 *     IR-driven sub-53 team that can't afford its vet-min replacement gets the
 *     same ladder the same week (Injury Stage I depends on this).
 *
 * League-shaped (same path for all 32 teams; a pinned human GM gets the same
 * forced compliance) and PURE + DETERMINISTIC — world-state only, no PRNG, so
 * it adds no fork and cannot perturb the lifecycle's determinism. A team
 * already at 53 (or short but affordable — the weekly FA's job, not the
 * floor's) is skipped, so the pass is a no-op on 100% of team-seasons except
 * the rare pinned trajectory and returns the league unchanged. NPC decision
 * behavior — the selection surface is re-exported through `npc-ai`.
 */

const ROSTER_FLOOR_SIZE = 53;

/** The chosen floor restructure: which contract, and how much base to convert. */
export interface FloorRestructurePlan {
  playerId: PlayerId;
  /**
   * Base to convert. `undefined` = convert the whole above-minimum base (the
   * largest-relief fallback when no single deal covers the need alone); a
   * number = the minimal-footprint amount sized to the fill.
   */
  maxConvert: number | undefined;
}

/**
 * Pick the floor restructure for a pinned team needing `need` dollars of
 * current-year room. Prefers the smallest-sufficient convertible base (least
 * future dead money) sized to a partial conversion; falls back to the largest
 * convertible base (full conversion, maximum progress) when no single deal
 * covers the need alone, letting the pass loop. Mirrors `pickMinimalCasualty`'s
 * smallest-sufficient-else-largest shape. Pure — no PRNG.
 */
export function selectFloorRestructure(
  team: TeamState,
  league: LeagueState,
  need: number,
): FloorRestructurePlan | null {
  const cap = league.salaryCap;
  const minSalary = leagueMinimumSalary(cap);
  let smallestSufficient: { playerId: PlayerId; convertible: number; yearsLeft: number } | null =
    null;
  let largest: { playerId: PlayerId; convertible: number } | null = null;

  for (const pid of team.rosterIds) {
    const player = league.players[pid];
    if (!player || !player.contractId) continue;
    const contract = league.contracts[player.contractId];
    if (!contract || contract.yearsRemaining < 2) continue;
    const yearOfDeal = contract.realYears - contract.yearsRemaining;
    const convertible = (contract.baseSalaries[yearOfDeal] ?? 0) - minSalary;
    if (convertible < MIN_CONVERTIBLE) continue;
    // Exact max relief from a FULL conversion of this deal (the throwaway
    // rebased contract is used only for its current-year cap hit).
    const full = restructureContract(contract, 'FLOOR_PROBE', league.tick, cap);
    if (!full) continue;
    const maxRelief = currentCapHit(contract) - currentCapHit(full.contract);
    const yearsLeft = contract.yearsRemaining;

    if (
      maxRelief >= need &&
      (!smallestSufficient ||
        convertible < smallestSufficient.convertible ||
        (convertible === smallestSufficient.convertible &&
          player.id < smallestSufficient.playerId))
    ) {
      smallestSufficient = { playerId: player.id, convertible, yearsLeft };
    }
    if (
      !largest ||
      convertible > largest.convertible ||
      (convertible === largest.convertible && player.id < largest.playerId)
    ) {
      largest = { playerId: player.id, convertible };
    }
  }

  if (smallestSufficient) {
    const { playerId, yearsLeft } = smallestSufficient;
    // Relief ≈ converted × (yearsLeft − 1) / yearsLeft, so target the converted
    // base at need × yearsLeft / (yearsLeft − 1), plus a small cushion for the
    // $1k-per-year proration rounding. `restructureContract` clamps this into
    // [MIN_CONVERTIBLE, fullConvertible].
    const maxConvert =
      Math.ceil((need * yearsLeft) / (yearsLeft - 1)) + (yearsLeft + 1) * 1_000;
    return { playerId, maxConvert };
  }
  if (largest) return { playerId: largest.playerId, maxConvert: undefined };
  return null;
}

/**
 * Enforce the 53-man floor on `league`. See the module doc for the ladder.
 * `signedOnTick` dates the vet-min fills (the offseason tick at the Week-1
 * boundary; `currentTick + 1` mid-season).
 */
export function enforceRosterFloor(league: LeagueState, signedOnTick: number): LeagueState {
  let working = league;
  let counter = 0;

  for (const teamId of (Object.keys(league.teams) as TeamId[]).sort()) {
    const startTeam = working.teams[teamId]!;
    if (startTeam.rosterIds.length >= ROSTER_FLOOR_SIZE) continue;
    const minSalaryStart = leagueMinimumSalary(working.salaryCap);
    const roomStart = working.salaryCap - teamCapUsage(startTeam, working);
    // Only cap-PINNED short teams are the floor's job. A short-but-affordable
    // team is the (position-matched) weekly-FA pass's to fill — engaging it
    // here would sign an off-position body and perturb the league. At the
    // Week-1 boundary `applyVetMinFillUp` has already filled every affordable
    // team, so "short" there always means "pinned" and this changes nothing.
    if (roomStart >= minSalaryStart) continue;

    // Engaged: walk the ladder, freeing room when unaffordable and signing a
    // body when affordable, until the team is at 53 or the ladder exhausts.
    while (true) {
      const team = working.teams[teamId]!;
      const deficit = ROSTER_FLOOR_SIZE - team.rosterIds.length;
      if (deficit <= 0) break;
      const cap = working.salaryCap;
      const minSalary = leagueMinimumSalary(cap);
      const room = cap - teamCapUsage(team, working);

      if (room >= minSalary) {
        const idSuffix = `${team.identity.abbreviation}_FLR${league.seasonNumber}_${counter++}`;
        const filled = signFloorMinimum(working, teamId, idSuffix, signedOnTick);
        if (!filled) break; // FA pool exhausted — not a cap failure; rung 4
        working = filled;
        continue;
      }

      // `need` frees room for the whole remaining deficit. It over-counts
      // slightly under the offseason top-51 rule (bodies past #51 don't count
      // toward usage) — freeing a touch extra is harmless.
      const need = deficit * minSalary - room;

      // Rung 1 — restructure (minimal footprint).
      const plan = selectFloorRestructure(team, working, need);
      if (plan) {
        const idSuffix = `${team.identity.abbreviation}_RFLR${league.seasonNumber}_${counter++}`;
        working = applyFloorRestructure(working, teamId, plan, idSuffix, signedOnTick);
        continue;
      }
      // Rung 2 — fringe cut (target need + one min salary; the cut opens a slot).
      const cut = pickMinimalCasualty(team, working, need + minSalary);
      if (cut) {
        working = applyFloorCut(working, teamId, cut);
        continue;
      }
      // Rung 4 — the ladder is exhausted (no restructure, no positive-saving
      // cut). Never carry a silent sub-53.
      break;
    }

    const finalTeam = working.teams[teamId]!;
    if (finalTeam.rosterIds.length < ROSTER_FLOOR_SIZE) {
      working = logFloorViolation(working, teamId, signedOnTick);
    }
  }

  return working;
}

/** Apply a floor restructure: rebase the deal, log a `forFloor` restructure. */
function applyFloorRestructure(
  league: LeagueState,
  teamId: TeamId,
  plan: FloorRestructurePlan,
  idSuffix: string,
  signedOnTick: number,
): LeagueState {
  const player = league.players[plan.playerId]!;
  const oldContractId = player.contractId!;
  const oldContract = league.contracts[oldContractId]!;
  const result = restructureContract(
    oldContract,
    idSuffix,
    signedOnTick,
    league.salaryCap,
    plan.maxConvert,
  );
  if (!result) return league; // defensive — the selector guarantees eligibility

  const relief = currentCapHit(oldContract) - currentCapHit(result.contract);
  const contracts: Record<string, Contract> = { ...league.contracts };
  delete contracts[oldContractId];
  contracts[result.contract.id] = result.contract;
  const players = {
    ...league.players,
    [player.id]: { ...player, contractId: result.contract.id },
  };

  const entry: Transaction = {
    kind: 'restructure',
    tick: league.tick,
    seasonNumber: league.seasonNumber,
    teamId,
    playerId: player.id,
    contractId: result.contract.id,
    convertedAmount: result.converted,
    capRelief: relief,
    years: result.contract.realYears,
    forFloor: true,
  };

  return {
    ...league,
    players: players as Readonly<Record<PlayerId, Player>>,
    contracts: contracts as Readonly<Record<ContractIdType, Contract>>,
    transactionLog: [...league.transactionLog, entry],
  };
}

/** Apply a floor fringe cut: release the vet, log a `forFloor` cap-cut. */
function applyFloorCut(
  league: LeagueState,
  teamId: TeamId,
  cut: { playerId: PlayerId; deadMoney: number; saving: number },
): LeagueState {
  const team = league.teams[teamId]!;
  const player = league.players[cut.playerId]!;
  const contractId = player.contractId!;

  const teamsNext = {
    ...league.teams,
    [teamId]: {
      ...team,
      rosterIds: team.rosterIds.filter((id) => id !== cut.playerId),
      deadMoneyByYear: addToYear(team.deadMoneyByYear, 0, cut.deadMoney),
    },
  } as Readonly<Record<TeamId, TeamState>>;

  const playersNext = {
    ...league.players,
    [cut.playerId]: { ...player, teamId: null, contractId: null },
  } as Readonly<Record<PlayerId, Player>>;

  const contractsNext: Record<string, Contract> = { ...league.contracts };
  delete contractsNext[contractId];

  const entry: Transaction = {
    kind: 'cap-cut',
    tick: league.tick,
    seasonNumber: league.seasonNumber,
    teamId,
    playerId: cut.playerId,
    contractId,
    deadMoney: cut.deadMoney,
    capSaving: cut.saving,
    forFloor: true,
  };

  return {
    ...league,
    teams: teamsNext,
    players: playersNext,
    contracts: contractsNext as Readonly<Record<ContractIdType, Contract>>,
    transactionLog: [...league.transactionLog, entry],
  };
}

/**
 * Sign the best available free agent to a 1-year league-minimum deal at
 * `teamId`, logged as a `forFloor` fa-sign. Returns null if the FA pool is
 * empty (rung-4 territory). Same tier/skill pool ordering as the offseason
 * vet-min fill (`applyVetMinFillUp`).
 */
function signFloorMinimum(
  league: LeagueState,
  teamId: TeamId,
  idSuffix: string,
  signedOnTick: number,
): LeagueState | null {
  let chosen: PlayerId | null = null;
  for (const pid of sortedFreeAgentPool(league)) {
    const player = league.players[pid];
    if (player && player.teamId === null) {
      chosen = pid;
      break;
    }
  }
  if (!chosen) return null;

  const player = league.players[chosen]!;
  const team = league.teams[teamId]!;
  const contract: Contract = {
    id: ContractId(`C_${idSuffix}`),
    playerId: player.id,
    teamId,
    signedOnTick,
    realYears: 1,
    voidYears: 0,
    yearsRemaining: 1,
    baseSalaries: [leagueMinimumSalary(league.salaryCap)],
    signingBonus: 0,
    rosterBonuses: [0],
    workoutBonuses: [0],
    guarantees: [{ baseGuaranteedPct: 0, type: 'NONE' }],
    incentives: [],
    noTradeClause: false,
  };

  const entry: Transaction = {
    kind: 'fa-sign',
    tick: signedOnTick,
    seasonNumber: league.seasonNumber,
    teamId,
    playerId: chosen,
    contractId: contract.id,
    yearOneCapHit: currentCapHit(contract),
    marketContract: false,
    phaseAtSigning: league.phase,
    forFloor: true,
  };

  return {
    ...league,
    teams: {
      ...league.teams,
      [teamId]: { ...team, rosterIds: [...team.rosterIds, chosen] },
    } as Readonly<Record<TeamId, TeamState>>,
    players: {
      ...league.players,
      [chosen]: { ...player, teamId, contractId: contract.id },
    } as Readonly<Record<PlayerId, Player>>,
    contracts: {
      ...league.contracts,
      [contract.id]: contract,
    } as Readonly<Record<ContractIdType, Contract>>,
    transactionLog: [...league.transactionLog, entry],
  };
}

/** Record the loud rung-4 failure (design §2.4). */
function logFloorViolation(
  league: LeagueState,
  teamId: TeamId,
  signedOnTick: number,
): LeagueState {
  const team = league.teams[teamId]!;
  const deficit = ROSTER_FLOOR_SIZE - team.rosterIds.length;
  const minSalary = leagueMinimumSalary(league.salaryCap);
  const room = league.salaryCap - teamCapUsage(team, league);
  const entry: Transaction = {
    kind: 'roster-floor-violation',
    tick: signedOnTick,
    seasonNumber: league.seasonNumber,
    teamId,
    rosterSize: team.rosterIds.length,
    unmetNeed: Math.max(0, deficit * minSalary - room),
  };
  return { ...league, transactionLog: [...league.transactionLog, entry] };
}

function addToYear(arr: readonly number[], index: number, amount: number): readonly number[] {
  const next = arr.slice();
  while (next.length <= index) next.push(0);
  next[index] = (next[index] ?? 0) + amount;
  return next;
}
