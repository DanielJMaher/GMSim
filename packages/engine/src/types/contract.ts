import type { ContractId, PlayerId, TeamId } from './ids.js';

/**
 * Contract structure mirrors NFL accounting per the Salary Cap Module doc.
 * Every cash component lives here; cap-hit calculation derives from it.
 *
 * Money values are stored in **whole dollars** (integer) to avoid float
 * drift. Cap math happens in cents internally for the same reason.
 */
export interface Contract {
  id: ContractId;
  playerId: PlayerId;
  teamId: TeamId;

  signedOnTick: number;
  /** Number of league-years the contract covers, **excluding** void years. */
  realYears: number;
  /** Void years appended for proration purposes. Counted in proration math, not in roster years. */
  voidYears: number;

  /** Per-year base salary (length = realYears). */
  baseSalaries: readonly number[];
  /** Signing bonus paid up-front; prorated across (realYears + voidYears), capped at 5. */
  signingBonus: number;
  /** Per-year roster bonuses (length = realYears). */
  rosterBonuses: readonly number[];
  /** Per-year workout bonuses (length = realYears). */
  workoutBonuses: readonly number[];

  /** Guarantee structure for each year. Length = realYears. */
  guarantees: readonly ContractGuarantee[];

  /** Performance incentives. Likely-to-be-earned counts against current cap; unlikely doesn't. */
  incentives: readonly ContractIncentive[];

  /** No-trade or trade-restricting clauses. */
  noTradeClause: boolean;
}

export interface ContractGuarantee {
  /** % of base salary in this year guaranteed. */
  baseGuaranteedPct: number;
  /** Guarantee tier — affects what triggers payout. */
  type: 'FULLY_GUARANTEED' | 'INJURY_ONLY' | 'SKILL_ONLY' | 'NONE' | 'ROLLING';
  /** Tick (sim-week) on which a rolling guarantee converts to fully guaranteed. */
  rollingTriggerTick?: number;
}

export interface ContractIncentive {
  description: string;
  amount: number;
  /** LTBE = likely to be earned; counts against current cap. NLTBE = doesn't. */
  classification: 'LTBE' | 'NLTBE';
  achieved: boolean;
}
