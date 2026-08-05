import type { LeagueState } from '../types/league.js';
import type { Player } from '../types/player.js';
import type { Contract } from '../types/contract.js';
import type { PlayerId, TeamId, ContractId as ContractIdType } from '../types/ids.js';
import { ContractId } from '../types/ids.js';
import type { Transaction } from '../types/transaction.js';
import { CompetitiveWindow } from '../types/enums.js';
import { currentCapHit, teamCapUsage, unamortizedSigningBonus } from '../contracts/cap.js';
import { ANCHOR_CAP, leagueMinimumSalary } from '../contracts/constants.js';
import { mintContractId, contractIdCollisionEntry } from '../contracts/mint.js';

/**
 * Contract RESTRUCTURES (cap-realism deep model, Slice 2 — Salary Cap doc §
 * "Contract Restructuring Mechanisms").
 *
 * The classic NFL cap move: convert a player's current-year base salary into
 * signing bonus. The player gets the same cash on the same schedule, but the
 * cap charge spreads across the remaining contract years — immediate room,
 * bought with larger future hits and a bigger dead-money bomb if the player is
 * later cut or traded. Real front offices do this constantly: to get compliant
 * in March without shedding talent, and to open room for the free-agency
 * market when the roster says "win now".
 *
 * GMSim models both triggers, gated by the team's competitive window:
 *   - CHAMPIONSHIP/CONTENDER teams pinned near the cap restructure their
 *     biggest veteran deals until they've opened a war chest
 *     (`RESTRUCTURE_ROOM_TARGET` of cap) for the market.
 *   - EMERGING teams restructure only as far as compliance — they protect
 *     future flexibility.
 *   - Rebuild-window teams (REBUILDING/STAGNANT/RETOOLING) never restructure:
 *     kicking cap charges into the years a rebuild is building toward is how
 *     real rebuilds die. They take the cap cuts instead (shedding vets is the
 *     point).
 *
 * Mechanically a restructure REPLACES the contract with a rebased equivalent
 * covering only the remaining years: the old bonus's unaccounted proration and
 * the converted base fold into the new deal's signing bonus. Every future cap
 * dollar of the old deal is preserved (conservation is exact), and all
 * downstream accounting — `currentCapHit`, dead money on release, trade
 * acceleration — works on the rebased deal unchanged.
 *
 * Named simplifications (deliberate, documented for later slices): no void
 * years (converted money prorates over remaining real years only, so relief is
 * slightly conservative vs. real void-year structures); no per-GM personality
 * spread on restructure appetite yet (the Salary Cap doc wants desperate
 * regimes over-restructuring — that wants the seat-pressure signal wired in a
 * follow-up); player consent is assumed (real restructures are near-universally
 * accepted since the player gets cash earlier).
 *
 * Pure + deterministic (no PRNG): candidate selection and the rebased deal are
 * world-state. NPC decision behavior — re-exported through `npc-ai`.
 */

/** Win-now teams open FA room up to this fraction of the cap. */
export const RESTRUCTURE_ROOM_TARGET = 0.08;
/** Most restructures a team executes in one offseason. */
export const MAX_RESTRUCTURES_PER_SEASON = 3;
/** Skip conversions too small to matter — the move must free real money. */
export const MIN_CONVERTIBLE = 2_000_000;

const WIN_NOW: ReadonlySet<CompetitiveWindow> = new Set([
  CompetitiveWindow.CHAMPIONSHIP,
  CompetitiveWindow.CONTENDER,
]);

export interface RestructureResult {
  /** The rebased contract replacing the old one (new id). */
  contract: Contract;
  /** Current-year base salary converted into signing bonus. */
  converted: number;
}

/**
 * Rebase `contract` into an equivalent deal covering only the remaining years,
 * with the current year's base above the league minimum converted into signing
 * bonus. Returns null when the contract can't meaningfully restructure
 * (< 2 years left, or nothing above the minimum to convert).
 *
 * Conservation: the new deal's future cap total equals the old deal's — the
 * old bonus's UNAMORTIZED remainder (real + void years, matching the engine's
 * dead-money accounting) plus the converted base both land in the new signing
 * bonus, prorated evenly over the remaining (+ carried void) years.
 *
 * `maxConvert` (Roster Floor, v0.186) caps how much of the above-minimum base
 * is converted — the floor pass converts only what its 53-man fill requires
 * (minimal footprint, least future dead money), whereas the war-chest pass
 * converts the whole base for maximum relief. Omitting it converts everything
 * above the minimum, bit-identical to the pre-floor behavior; when supplied,
 * the converted base is clamped into `[MIN_CONVERTIBLE, fullConvertible]`.
 */
export function restructureContract(
  contract: Contract,
  idSuffix: string,
  signedOnTick: number,
  salaryCap: number = ANCHOR_CAP,
  maxConvert?: number,
): RestructureResult | null {
  const yearsLeft = contract.yearsRemaining;
  if (yearsLeft < 2) return null; // converting into a 1-year proration frees nothing
  const yearOfDeal = contract.realYears - yearsLeft;
  const currentBase = contract.baseSalaries[yearOfDeal] ?? 0;
  const minSalary = leagueMinimumSalary(salaryCap);
  const fullConvertible = currentBase - minSalary;
  const converted =
    maxConvert === undefined
      ? fullConvertible
      : Math.min(fullConvertible, Math.max(MIN_CONVERTIBLE, maxConvert));
  if (converted < MIN_CONVERTIBLE) return null;

  const oldBonusRemaining = unamortizedSigningBonus(contract);
  const sliceYear = <T>(arr: readonly T[]): T[] => arr.slice(yearOfDeal);

  const baseSalaries = sliceYear(contract.baseSalaries);
  // Partial conversion leaves the residual base in year 0 (a full conversion
  // reduces it to exactly the minimum — the pre-floor invariant).
  baseSalaries[0] = currentBase - converted;
  const guarantees = sliceYear(contract.guarantees);
  // The remaining minimum base rides along with the (inherently guaranteed)
  // bonus cash the player just received — a March restructure locks the year.
  guarantees[0] = { baseGuaranteedPct: 100, type: 'FULLY_GUARANTEED' };

  return {
    contract: {
      id: ContractId(`C_${idSuffix}`),
      playerId: contract.playerId,
      teamId: contract.teamId,
      signedOnTick,
      realYears: yearsLeft,
      // Carried through the rebase (v0.176): the original deal's void-year
      // proration window survives, so the eventual void hit isn't erased.
      voidYears: contract.voidYears,
      yearsRemaining: yearsLeft,
      baseSalaries,
      signingBonus: oldBonusRemaining + converted,
      // Only the converted base is new CASH — the folded-in old proration
      // was paid out when the original deal was signed (Slice 3 ledger).
      signingBonusCashPaid: converted,
      rosterBonuses: sliceYear(contract.rosterBonuses),
      workoutBonuses: sliceYear(contract.workoutBonuses),
      guarantees,
      incentives: contract.incentives,
      noTradeClause: contract.noTradeClause,
    },
    converted,
  };
}

/**
 * The offseason NPC restructure pass. Runs FIRST in the transaction phase —
 * before the (cap-gated) re-sign window and the cut passes — mirroring the
 * real March order: a pinned win-now team restructures to keep its own
 * expiring starters and to get compliant without dumping talent, and the
 * room survives into free agency as a war chest the bid throttle can
 * actually spend (`computeTeamCashBid` scales with cap room).
 */
export function applyCapRestructures(league: LeagueState, signedOnTick: number): LeagueState {
  let players: Record<string, Player> = league.players;
  let contracts: Record<string, Contract> = league.contracts;
  const logEntries: Transaction[] = [];
  let counter = 0;

  // Working view over the maps we mutate so running usage is exact under
  // whatever accounting the cap module applies (top-51 offseason rule incl.).
  const view = (): LeagueState => ({ ...league, players, contracts } as LeagueState);

  for (const teamId of (Object.keys(league.teams) as TeamId[]).sort()) {
    const team = league.teams[teamId]!;
    const winNow = WIN_NOW.has(team.competitiveWindow);
    const emerging = team.competitiveWindow === CompetitiveWindow.EMERGING;
    if (!winNow && !emerging) continue;

    // Win-now teams restructure down to a working war chest; emerging teams
    // only as far as compliance.
    const targetUsage = winNow
      ? (1 - RESTRUCTURE_ROOM_TARGET) * league.salaryCap
      : league.salaryCap;

    let usage = teamCapUsage(team, view());
    if (usage <= targetUsage) continue;

    // Biggest convertible base first — most relief per move, like real
    // restructures (it's the QB/LT mega-deal that gets converted).
    const candidates: { playerId: PlayerId; convertible: number }[] = [];
    for (const pid of team.rosterIds) {
      const player = players[pid];
      if (!player || !player.contractId) continue;
      const c = contracts[player.contractId];
      if (!c || c.yearsRemaining < 2) continue;
      const yearOfDeal = c.realYears - c.yearsRemaining;
      const convertible = (c.baseSalaries[yearOfDeal] ?? 0) - leagueMinimumSalary(league.salaryCap);
      if (convertible < MIN_CONVERTIBLE) continue;
      candidates.push({ playerId: player.id, convertible });
    }
    candidates.sort(
      (a, b) => b.convertible - a.convertible || (a.playerId < b.playerId ? -1 : 1),
    );

    let done = 0;
    for (const cand of candidates) {
      if (usage <= targetUsage || done >= MAX_RESTRUCTURES_PER_SEASON) break;
      const player = players[cand.playerId]!;
      const oldContractId = player.contractId!;
      const oldContract = contracts[oldContractId]!;
      const idSuffix = `${team.identity.abbreviation}_RST${league.seasonNumber}_${counter++}`;
      const result = restructureContract(oldContract, idSuffix, signedOnTick, league.salaryCap);
      if (!result) continue;

      // Fix 2 (§14): resolve against the CURRENT (already-mutated-this-pass)
      // map before either the map write or the contractId stamp.
      const minted = mintContractId(contracts, result.contract.id);
      const finalContract: Contract =
        minted.collision === undefined ? result.contract : { ...result.contract, id: minted.id };

      const relief = currentCapHit(oldContract) - currentCapHit(finalContract);
      contracts = { ...contracts };
      delete contracts[oldContractId];
      contracts[finalContract.id] = finalContract;
      players = { ...players, [player.id]: { ...player, contractId: finalContract.id } };
      done++;

      logEntries.push({
        kind: 'restructure',
        tick: league.tick,
        seasonNumber: league.seasonNumber,
        teamId,
        playerId: player.id,
        contractId: finalContract.id,
        convertedAmount: result.converted,
        capRelief: relief,
        years: finalContract.realYears,
      });
      const collisionEntry = contractIdCollisionEntry(minted, {
        tick: league.tick,
        seasonNumber: league.seasonNumber,
        teamId,
        playerId: player.id,
      });
      if (collisionEntry) logEntries.push(collisionEntry);

      usage = teamCapUsage(team, view());
    }
  }

  if (logEntries.length === 0) return league;
  return {
    ...league,
    players: players as Readonly<Record<PlayerId, Player>>,
    contracts: contracts as Readonly<Record<ContractIdType, Contract>>,
    transactionLog: [...league.transactionLog, ...logEntries],
  };
}
