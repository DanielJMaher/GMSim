import type { PlayerId, TeamId, ContractId, CoachId, GmId, OwnerId, DraftPickId } from './ids.js';
import type { TalentTier } from './player.js';
import type { LeaguePhase } from './league.js';
import type { WatchListReason } from './scout.js';

/**
 * Per-bidder detail persisted on `fa-sign` transactions so the
 * inspector can show the full market context behind a signing.
 * Mirrors `FaBidderDetail` from the auction module but is duplicated
 * in the transaction types so the type layer doesn't depend on a
 * transactions module.
 */
export interface FaSignBidder {
  teamId: TeamId;
  cashValuation: number;
  /** Cash bid before the watch-list boost was applied. */
  cashValuationBaseline: number;
  preferenceMultiplier: number;
  perceivedBid: number;
  capRoomAtTime: number;
  preferenceFactors: FaSignPreferenceFactors;
  /**
   * Watch-list bid multiplier applied to cash (1.0 = not on team's
   * list). The boost shows up in `cashValuation` directly — coveted
   * players cost more — not as a separate sort-order kick.
   */
  watchListMultiplier: number;
  /** Watch-list priority on this team's list, or null. */
  watchListPriority: number | null;
  /** Reason on this team's watch list, or null. */
  watchListReason: WatchListReason | null;
}

/** Labeled breakdown of how `preferenceMultiplier` was constructed. */
export interface FaSignPreferenceFactors {
  total: number;
  archetypeMarket: number;
  ownerQuirks: number;
  hcQuirks: number;
  hcPlayerRelationships: number;
  archetypeLabel: string | null;
  ownerQuirkLabels: readonly string[];
  hcQuirkLabels: readonly string[];
}

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
  | TransactionLockerRoomIncident
  | TransactionHcFired
  | TransactionGmFired
  | TransactionHcHired
  | TransactionGmHired
  | TransactionHcInterim;

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
  /**
   * Full list of bidders with cash valuations, preference multipliers,
   * and preference breakdowns — feeds the inspector's FA-sign detail
   * panel. Optional for back-compat: pre-v0.22 saves and mid-season
   * vet-min signings (no auction) omit it. Sorted descending by
   * `perceivedBid` to match the auction ordering.
   */
  bidders?: readonly FaSignBidder[];
  /**
   * League phase at the moment of signing. Lets the inspector show
   * "Offseason FA market" vs "Week 7 vet-min" without re-deriving
   * from tick. Optional for back-compat with pre-v0.22 saves.
   */
  phaseAtSigning?: LeaguePhase;
}

export interface TransactionTrade extends TransactionBase {
  kind: 'trade';
  teamAId: TeamId;
  teamBId: TeamId;
  playersAToB: readonly PlayerId[];
  playersBToA: readonly PlayerId[];
  /**
   * Draft picks moving from team A to team B (v0.47.0+). Optional —
   * pre-v0.47 saves omit it; the inspector treats absent as empty.
   */
  picksAToB?: readonly DraftPickId[];
  /** Draft picks moving from team B to team A (v0.47.0+). */
  picksBToA?: readonly DraftPickId[];
  /** Dead money accrued to team A from accelerated proration on traded-away players. */
  deadMoneyTeamA: number;
  /** Dead money accrued to team B from accelerated proration on traded-away players. */
  deadMoneyTeamB: number;
  /**
   * Team that initiated the trade conversation. Optional — manual /
   * pre-v0.24 trades omit it. For proactive trades the initiator is
   * the buyer (team identifying the need); for request-driven trades
   * it's the team that found a buyer for an open trade request.
   */
  initiatorTeamId?: TeamId;
  /**
   * Which trade pipeline produced this transaction. Optional —
   * pre-v0.24 saves omit it. `manual` covers direct calls to
   * `executeTrade` from outside the automated pipelines (e.g. test
   * scenarios, inspector trade builder).
   */
  source?:
    | 'proactive-need'
    | 'proactive-fit-swap'
    | 'proactive-rebuild-firesale'
    | 'request-driven'
    | 'manual';
  /** Doc 14 5-factor evaluation from team A's perspective. */
  teamAValue?: TradeValueEvaluation;
  /** Doc 14 5-factor evaluation from team B's perspective. */
  teamBValue?: TradeValueEvaluation;
  /**
   * Other trades that the matchmaking pass considered involving the
   * same primary players but didn't fire — typically because a higher-
   * priority trade consumed the buyer/seller slot, the candidate
   * failed the 5-factor gate, or league state shifted between
   * scoring and execution. Top 5 by combined net value, omitted when
   * empty. Lets the inspector surface "market context" alongside the
   * trade that actually fired.
   */
  alternativeCandidates?: readonly AlternativeTradeCandidate[];
}

/**
 * Compact summary of a trade that was considered but didn't fire.
 * Mirrors the executed trade's shape but without the full 5-factor
 * breakdowns — just per-team net values and the reason the
 * candidate dropped out. Inspector renders these as a "X teams also
 * considered this" list.
 */
export interface AlternativeTradeCandidate {
  buyerId: TeamId;
  sellerId: TeamId;
  /** Player the buyer would have acquired (moves seller → buyer). */
  acquireId: PlayerId;
  /**
   * Player the buyer would have sent back (moves buyer → seller).
   * Optional — pick-only patterns (v0.48+ rebuild-firesale) omit it.
   */
  returnId?: PlayerId;
  /** Buyer's perceived net value in $M. Always > 0 for candidates that passed the gate. */
  buyerNetValue: number;
  /** Seller's perceived net value in $M. May be ≤ 0 for failed-gate alternatives. */
  sellerNetValue: number;
  /** Why this candidate didn't fire. */
  reason:
    | 'lower-priority'
    | 'buyer-used'
    | 'seller-used'
    | 'failed-gate';
}

/**
 * One team's perceived value of a trade. Mirrors
 * `TradePackageEvaluation` from `trade/value.ts`, redeclared here to
 * keep the types layer free of an inbound dependency on a transaction-
 * adjacent module.
 */
export interface TradeValueEvaluation {
  received: readonly { playerId: string; breakdown: TradeValueBreakdown }[];
  given: readonly { playerId: string; breakdown: TradeValueBreakdown }[];
  /** Per-pick valuations for picks coming to this team. v0.47.0+. */
  receivedPicks?: readonly { pickId: string; breakdown: PickTradeValueBreakdown }[];
  /** Per-pick valuations for picks going from this team. v0.47.0+. */
  givenPicks?: readonly { pickId: string; breakdown: PickTradeValueBreakdown }[];
  netValue: number;
}

/**
 * Pick valuation breakdown — mirrors `PickValueBreakdown` from
 * `trade/value.ts`, redeclared here to keep the types layer free of
 * an inbound dependency on a transaction-adjacent module.
 */
export interface PickTradeValueBreakdown {
  total: number;
  totalDollars: number;
  factors: {
    chart: TradeValueFactor;
    modifiers: TradeValueFactor;
  };
}

/** Doc 14 5-factor breakdown — all values in $M. */
export interface TradeValueBreakdown {
  total: number;
  totalDollars: number;
  factors: {
    ability: TradeValueFactor;
    schemeFit: TradeValueFactor;
    ageContract: TradeValueFactor;
    positional: TradeValueFactor;
    timing: TradeValueFactor;
  };
}

export interface TradeValueFactor {
  multiplier: number;
  rationale: string;
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

/**
 * Front-office lifecycle transactions (v0.138). One entry per firing /
 * hiring so the news feed and the inspector carousel view read the
 * whole regime history off the append-only log.
 */
export interface TransactionHcFired extends TransactionBase {
  kind: 'hc-fired';
  teamId: TeamId;
  coachId: CoachId;
  /** True when the GM went down in the same cycle (clean house). */
  jointWithGm: boolean;
  /** S2 will set this for mid-season firings; S1 is always false. */
  inSeason: boolean;
  /** Seasons coached for this team, inclusive. */
  seasonsServed: number;
  /**
   * Record for the news line: the full stint for offseason firings,
   * the season-to-date start ("fired at 2-8") for in-season ones.
   */
  wins: number;
  losses: number;
  ties: number;
  /** HC seat pressure at the moment of firing (inspector context). */
  seatPressure: number;
  /**
   * Which of the sitting GM's coaches this was: 0 = inherited (not his
   * hire), 1 = his first own hire, 2+ = second-plus own hire (the
   * firing that takes the GM down). Headhunter/inspector surface.
   */
  ownHireIndex: number;
  /** The sitting GM's tenure (seasons) at the moment of this firing. */
  gmTenureSeasons: number;
}

export interface TransactionGmFired extends TransactionBase {
  kind: 'gm-fired';
  teamId: TeamId;
  gmId: GmId;
  /** True when fired in the same cycle as the HC (clean house). */
  jointWithHc: boolean;
  inSeason: boolean;
  seasonsServed: number;
  wins: number;
  losses: number;
  ties: number;
  seatPressure: number;
}

export interface TransactionHcHired extends TransactionBase {
  kind: 'hc-hired';
  teamId: TeamId;
  coachId: CoachId;
  /** True when the hire came from the unemployed-retread pool. */
  retread: boolean;
  /** GM who made the hire (the "his guy" coupling). */
  hiredByGmId: GmId;
  /**
   * S2 (v0.139): true when the hire is the interim coach earning the
   * permanent job (the Antonio Pierce path). Absent on v0.138 logs.
   */
  promotedInterim?: boolean;
}

/**
 * S2 (v0.139): an in-season firing installs an interim head coach.
 * Logged separately from `hc-hired` so "hires" always means the
 * permanent seat being filled.
 */
export interface TransactionHcInterim extends TransactionBase {
  kind: 'hc-interim';
  teamId: TeamId;
  coachId: CoachId;
  /** Week index (0-based) the interim took over. */
  weekIndex: number;
}

export interface TransactionGmHired extends TransactionBase {
  kind: 'gm-hired';
  teamId: TeamId;
  gmId: GmId;
  retread: boolean;
}

export type LockerRoomIncidentFlavor =
  | 'media_blowup'        // Went off in a presser, hot mic, sideline rant.
  | 'practice_conflict'   // Dust-up / fight at practice.
  | 'social_media_post'   // Tweeted something dumb.
  | 'coach_dispute'       // Open disagreement with coaching staff.
  | 'off_field_issue'     // Skipped OTAs, legal trouble, conditioning concerns.
  | 'positive_moment';    // Team bonding / leadership moment — rare uplift.
