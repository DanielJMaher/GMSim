import type { PlayerId, TeamId, ContractId, CoachId, OwnerId } from './ids.js';
import type { TalentTier } from './player.js';

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
  | TransactionCapCut
  | TransactionMoodShift
  | TransactionTradeRequest
  | TransactionLockerRoomIncident;

/**
 * Coarse mood label produced by `moodBucket(n)`. The engine stores
 * `Player.mood` as a 0..100 number; this enum surfaces in the
 * transaction log only when a player crosses a bucket boundary, so the
 * log captures meaningful narrative shifts rather than every micro-tick.
 */
export type MoodBucket =
  | 'wants_out'
  | 'frustrated'
  | 'unsettled'
  | 'content'
  | 'happy';

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
  /**
   * Teams that bid on the FA but lost the auction, ordered from
   * strongest to weakest runner-up. Optional — only the offseason
   * auction populates this; mid-season vet-min signings and pre-v0.20
   * saves omit it.
   *
   * Populated by `auctionFreeAgent`; surfaced in the news feed as
   * "TEAM A signed STAR X despite heavy TEAM B interest" so the
   * runner-up market context isn't lost to the inspector.
   */
  runnersUp?: readonly TeamId[];
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

/**
 * Logged when a player's hidden mood crosses a bucket boundary. The
 * micro-drift between buckets is not logged (would be noisy); only the
 * coarse narrative shift "this player became frustrated" is appended.
 *
 * `mood` records the post-shift numeric value so downstream consumers
 * (inspector, eventual news feed) can render an attributed quote
 * proportional to severity without re-reading player state at log time.
 */
export interface TransactionMoodShift extends TransactionBase {
  kind: 'mood-shift';
  teamId: TeamId;
  playerId: PlayerId;
  fromBucket: MoodBucket;
  toBucket: MoodBucket;
  mood: number;
}

/**
 * Demands a trade out (state: 'requested') or withdraws the demand
 * (state: 'resolved'). Triggered by mood collapse / recovery for
 * STAR / STARTER tier players — backups and fringe players don't
 * generate trade requests by design (their agents have less leverage).
 *
 * Recording `tier` makes the log readable on its own: a STAR demanding
 * a trade is a much louder narrative beat than a STARTER doing so.
 */
export interface TransactionTradeRequest extends TransactionBase {
  kind: 'trade-request';
  teamId: TeamId;
  playerId: PlayerId;
  state: 'requested' | 'resolved';
  mood: number;
  tier: TalentTier;
}

/**
 * A locker-room incident — emergent narrative beat triggered when a
 * player's volatility produces a large enough mood swing in a week.
 * The flavor field labels the *kind* of thing that happened so
 * downstream media / news systems (Doc 12) can pick a tone. Most
 * fields are intentionally optional so the same kind can stretch to
 * include coach feuds, owner blow-ups, or teammate disputes without
 * the schema changing.
 *
 * `mediaLeak: true` marks the incident as having reached the press —
 * leak probability scales with market size, owner involvement, and
 * coach PR-stability. Leaked incidents will feed the media surface
 * once Doc 12 is built; internally they're identical in mechanism.
 */
export interface TransactionLockerRoomIncident extends TransactionBase {
  kind: 'locker-room-incident';
  teamId: TeamId;
  playerId: PlayerId;
  flavor: LockerRoomIncidentFlavor;
  mediaLeak: boolean;
  /** Mood change applied to the primary player (signed; usually negative). */
  moodDelta: number;
  /** Optional secondary subject for incidents involving another teammate. */
  involvedPlayerId?: PlayerId;
  /** Optional coach when the dispute is between player + coaching staff. */
  involvedCoachId?: CoachId;
  /** Optional owner when an ownership decision triggered the incident. */
  involvedOwnerId?: OwnerId;
}

export type LockerRoomIncidentFlavor =
  | 'media_blowup'        // Went off in a presser, hot mic, sideline rant.
  | 'practice_conflict'   // Dust-up / fight at practice.
  | 'social_media_post'   // Tweeted something dumb.
  | 'coach_dispute'       // Open disagreement with coaching staff.
  | 'off_field_issue'     // Skipped OTAs, legal trouble, conditioning concerns.
  | 'positive_moment';    // Team bonding / leadership moment — rare uplift.
