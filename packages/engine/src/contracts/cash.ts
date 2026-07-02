import type { Contract } from '../types/contract.js';
import type { TeamState } from '../types/team.js';
import type { LeagueState } from '../types/league.js';

/**
 * Cash-vs-cap accounting (cap-realism deep model, Slice 3 — Salary Cap doc
 * "Salary Cap Hits vs Cash Flow" + "Minimum Spending Requirements").
 *
 * Cap hits and cash diverge: a signing bonus is CASH the day the deal is
 * signed but prorates across up to five cap years, and a restructure moves
 * cap charges into the future while the cash schedule barely changes. The
 * real CBA polices actual spending with a cash floor — each club must spend
 * at least ~89% of the caps over rolling 4-year periods — which is why real
 * teams can't simply sit on cap room the way GMSim's underspent equilibrium
 * did.
 *
 * `TeamState.cashSpentBySeason` is the ledger (booked once per season at
 * POST_SEASON_FINALIZE); this module owns the per-contract cash math and the
 * floor test that the NPC spending passes read (`applyCapFloorExtensions`
 * raises its target for lagging teams; `computeTeamCashBid` lifts the bid
 * throttle).
 */

/** CBA-style minimum cash spend as a fraction of the caps in the window. */
export const CASH_FLOOR_PCT = 0.89;
/** Rolling window (seasons) the cash floor is measured over. */
export const CASH_FLOOR_WINDOW = 4;

/**
 * Cash a contract pays its player for the CURRENT league year: the year's
 * base + roster/workout bonus, plus — in the deal's first league year — the
 * signing-bonus cash (`signingBonusCashPaid` when the contract is a
 * restructure rebase, else the whole bonus). First-year detection is
 * `yearsRemaining === realYears`, which holds until POST_SEASON_FINALIZE
 * decrements the year — so book cash BEFORE the decrement.
 */
export function contractSeasonCash(contract: Contract): number {
  const yearOfDeal = contract.realYears - contract.yearsRemaining;
  if (yearOfDeal < 0 || yearOfDeal >= contract.realYears) return 0;
  const firstYear = contract.yearsRemaining === contract.realYears;
  return (
    (contract.baseSalaries[yearOfDeal] ?? 0) +
    (contract.rosterBonuses[yearOfDeal] ?? 0) +
    (contract.workoutBonuses[yearOfDeal] ?? 0) +
    (firstYear ? contract.signingBonusCashPaid ?? contract.signingBonus : 0)
  );
}

/** Season cash across a team's active roster + IR (contracts stay live on IR). */
export function teamSeasonCash(team: TeamState, league: LeagueState): number {
  let total = 0;
  for (const pid of [...team.rosterIds, ...team.injuredReserveIds]) {
    const player = league.players[pid];
    if (!player || !player.contractId) continue;
    const contract = league.contracts[player.contractId];
    if (!contract) continue;
    total += contractSeasonCash(contract);
  }
  return total;
}

export interface CashFloorStatus {
  /** Seasons of booked history the check used (≤ CASH_FLOOR_WINDOW). */
  seasons: number;
  /** Booked cash over the window. */
  cashSpent: number;
  /** CASH_FLOOR_PCT × salaryCap × seasons. */
  floorTarget: number;
  /** Dollars short of the floor (0 when compliant). */
  lag: number;
  /** True when the team is behind floor pace and must spend. */
  lagging: boolean;
}

/**
 * Where a team stands against the cash floor over its trailing window.
 * Uses the last `CASH_FLOOR_WINDOW` booked seasons (fewer early in a
 * league's life; a team with no booked history yet is trivially compliant —
 * enforcement starts once real seasons are on the ledger).
 */
export function teamCashFloorStatus(team: TeamState, league: LeagueState): CashFloorStatus {
  // Runtime-defensive `?? {}`: pre-migration saves and hand-built test
  // fixtures may lack the ledger (tests are excluded from tsc).
  const ledger = team.cashSpentBySeason ?? {};
  const booked = Object.keys(ledger)
    .map(Number)
    .sort((a, b) => a - b)
    .slice(-CASH_FLOOR_WINDOW);
  if (booked.length === 0) {
    return { seasons: 0, cashSpent: 0, floorTarget: 0, lag: 0, lagging: false };
  }
  let cashSpent = 0;
  for (const season of booked) cashSpent += ledger[season] ?? 0;
  const floorTarget = CASH_FLOOR_PCT * league.salaryCap * booked.length;
  const lag = Math.max(0, floorTarget - cashSpent);
  return { seasons: booked.length, cashSpent, floorTarget, lag, lagging: lag > 0 };
}
