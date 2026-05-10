import type { PlayerId, TeamId, ContractId } from './ids.js';

/**
 * League-wide transaction log entry. Each engine primitive that mutates
 * roster / contract state appends an entry. The log is append-only —
 * never edited, only read. Surfaces in the inspector for at-a-glance
 * visibility into what changed and when.
 *
 * Recorded `tick` is the league tick at which the transaction took
 * effect. Within a tick, ordering is by append order (insertion stable).
 *
 * Phase 2: in-memory only. A persisted save format will roll the log
 * forward unchanged.
 */
export type Transaction =
  | TransactionRelease
  | TransactionFreeAgentSign
  | TransactionTrade
  | TransactionIrMove
  | TransactionPsPromotion
  | TransactionContractExpiration
  | TransactionCapCut;

interface TransactionBase {
  /** Sim tick the transaction took effect. */
  tick: number;
  /** League season number when this happened (1-indexed). */
  seasonNumber: number;
}

export interface TransactionRelease extends TransactionBase {
  kind: 'release';
  teamId: TeamId;
  playerId: PlayerId;
  /** Contract that was dropped. */
  contractId: ContractId;
  /** Dead money charged to the team's current-year cap from this release. */
  deadMoney: number;
}

export interface TransactionFreeAgentSign extends TransactionBase {
  kind: 'fa-sign';
  teamId: TeamId;
  playerId: PlayerId;
  contractId: ContractId;
  /** Year-1 cap hit on the new contract. */
  yearOneCapHit: number;
  /** True if this signing came from the offseason FA market (vs. mid-season "vet-min" street signing). */
  marketContract: boolean;
}

export interface TransactionTrade extends TransactionBase {
  kind: 'trade';
  teamAId: TeamId;
  teamBId: TeamId;
  playersAToB: readonly PlayerId[];
  playersBToA: readonly PlayerId[];
  /** Dead money accrued to team A from accelerated proration on traded-away players. */
  deadMoneyTeamA: number;
  /** Dead money accrued to team B from accelerated proration on traded-away players. */
  deadMoneyTeamB: number;
}

export interface TransactionIrMove extends TransactionBase {
  kind: 'ir-move';
  teamId: TeamId;
  playerId: PlayerId;
  /** Severity that triggered the IR move (always 'MAJOR' in the current rules). */
  injurySeverity: 'MINOR' | 'MODERATE' | 'MAJOR';
  /** Sim weeks the player is expected to miss. */
  weeksOut: number;
}

export interface TransactionPsPromotion extends TransactionBase {
  kind: 'ps-promotion';
  /** Team the player came from (own promotion vs. another team's PS). */
  originTeamId: TeamId;
  /** Team that signed the player to its active 53. */
  signingTeamId: TeamId;
  playerId: PlayerId;
  /** True if the origin and signing team are the same (own promotion). */
  ownPromotion: boolean;
  /** Newly signed active-roster contract. */
  contractId: ContractId;
}

export interface TransactionContractExpiration extends TransactionBase {
  kind: 'contract-expiration';
  /** Team whose contract just expired (the team this player was playing for). */
  teamId: TeamId;
  playerId: PlayerId;
  contractId: ContractId;
  /** True if the player was on the active roster (vs. practice squad). */
  fromActiveRoster: boolean;
}

export interface TransactionCapCut extends TransactionBase {
  kind: 'cap-cut';
  teamId: TeamId;
  playerId: PlayerId;
  contractId: ContractId;
  deadMoney: number;
  /** Cap saving (cap-hit minus dead money) the cut produced. */
  capSaving: number;
}
