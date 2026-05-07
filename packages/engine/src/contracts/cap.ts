import type { Contract } from '../types/contract.js';
import type { TeamState } from '../types/team.js';
import type { LeagueState } from '../types/league.js';
import { MAX_PRORATION_YEARS } from './constants.js';

/**
 * Compute the per-year proration of a signing bonus.
 *
 * NFL rule: signing bonuses prorate evenly across the contract length,
 * capped at 5 years. Void years (if any) extend the proration period
 * up to the same 5-year cap.
 */
export function signingBonusProrationPerYear(contract: Contract): number {
  const totalYears = Math.min(contract.realYears + contract.voidYears, MAX_PRORATION_YEARS);
  if (totalYears === 0) return 0;
  return Math.round(contract.signingBonus / totalYears);
}

/**
 * Cap hit for a contract in a specific year-of-deal (0-indexed).
 *
 *   capHit(year) = baseSalary[year]
 *                + rosterBonus[year]
 *                + workoutBonus[year]
 *                + (signingBonus / prorationYears)
 *                + LTBE incentives (deferred — Phase 1 contracts have none)
 *
 * Returns 0 if the requested year is beyond the contract's length.
 */
export function capHitForYear(contract: Contract, yearOfDeal: number): number {
  if (yearOfDeal < 0 || yearOfDeal >= contract.realYears) return 0;
  return (
    (contract.baseSalaries[yearOfDeal] ?? 0) +
    (contract.rosterBonuses[yearOfDeal] ?? 0) +
    (contract.workoutBonuses[yearOfDeal] ?? 0) +
    signingBonusProrationPerYear(contract)
  );
}

/**
 * Current-year cap hit for a contract. Derives the year-of-deal from
 * `yearsRemaining`: a 4-year deal with 2 years remaining is in year 2
 * (0-indexed) right now.
 */
export function currentCapHit(contract: Contract): number {
  const yearOfDeal = contract.realYears - contract.yearsRemaining;
  return capHitForYear(contract, yearOfDeal);
}

/**
 * Sum the current-year cap hits for every contract on a team's roster.
 *
 * Phase 1 simplification: counts all 53 active-roster contracts. NFL
 * actually uses "Top 51" rule during the offseason, but we'll add that
 * nuance once the season-phase scheduler lands.
 */
export function teamCapUsage(team: TeamState, league: LeagueState): number {
  let total = 0;
  for (const playerId of team.rosterIds) {
    const player = league.players[playerId];
    if (!player || !player.contractId) continue;
    const contract = league.contracts[player.contractId];
    if (!contract) continue;
    total += currentCapHit(contract);
  }
  return total;
}

/**
 * Aggregate cap state for a team — useful for inspector + UI surfaces.
 */
export interface TeamCapSummary {
  capCeiling: number;
  capUsed: number;
  capSpace: number;
}

export function summarizeTeamCap(team: TeamState, league: LeagueState): TeamCapSummary {
  const capUsed = teamCapUsage(team, league);
  return {
    capCeiling: league.salaryCap,
    capUsed,
    capSpace: league.salaryCap - capUsed,
  };
}

/**
 * Pre-June 1 release: all remaining proration accelerates to current
 * year cap. Returns the dead-money cap hit that would result.
 *
 * Stub for Phase 2 transactions — not exercised by generation, but
 * the API is present so transaction code can lean on it.
 */
export function deadMoneyOnPreJune1Release(contract: Contract): number {
  const yearOfDeal = contract.realYears - contract.yearsRemaining;
  const remainingProration = signingBonusProrationPerYear(contract) * (contract.yearsRemaining);
  // Plus any guaranteed remaining base salary.
  let guaranteedRemaining = 0;
  for (let y = yearOfDeal; y < contract.realYears; y++) {
    const guarantee = contract.guarantees[y];
    const base = contract.baseSalaries[y] ?? 0;
    if (guarantee && guarantee.type === 'FULLY_GUARANTEED') {
      guaranteedRemaining += base * (guarantee.baseGuaranteedPct / 100);
    }
  }
  return Math.round(remainingProration + guaranteedRemaining);
}
