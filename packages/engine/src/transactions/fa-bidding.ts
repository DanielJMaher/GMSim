import type { LeagueState } from '../types/league.js';
import type { Player } from '../types/player.js';
import type { TeamState } from '../types/team.js';
import type { TeamId, PlayerId } from '../types/ids.js';
import type { Position } from '../types/enums.js';
import { MarketSize } from '../types/enums.js';
import type { WatchListReason } from '../types/scout.js';
import { ROSTER_BLUEPRINT_53, QUALITY_DEPTH_TARGET } from '../players/roster-blueprint.js';
import { teamCapUsage } from '../contracts/cap.js';
import { teamCashFloorStatus } from '../contracts/cash.js';
import { schemeFitForPlayer } from '../scheme/fit.js';
import { ANCHOR_CAP, leagueMinimumSalary } from '../contracts/constants.js';
import { positionSalaryFactor, FA_PREMIUM_DAMPEN } from '../contracts/tiers.js';
import { estimatedRookieYear1CapHit } from '../contracts/rookie-scale.js';
import { RESIGN_QB_BAD_TEAM_WINS, lastSeasonWins } from './re-sign.js';
/**
 * Free-agent bidding auction — v0.20.0 Doc 7 follow-up.
 *
 * Replaces the v0.13.0 "first-fit signing team" model with a real
 * second-price auction. For each FA, every eligible team computes a
 * *cash* valuation (scheme fit × need × cap headroom) and a
 * *player-preference* multiplier (personality + market size + owner /
 * HC quirks). The winner is whoever maximises perceived value
 * (cash × preference). Price = `secondHighestCash × 1.02` (capped at
 * the winner's cash valuation) when there's competition, or 85% of
 * the winner's valuation when they bid alone — the single-bidder
 * discount.
 *
 * The auction is pure compute over `league` state. It does not mutate
 * — the caller (`refillRosters`) applies the result by building the
 * scaled contract via `makeFreeAgentContract(..., multiplier)` and
 * appending the standard `fa-sign` transaction (with `runnersUp`
 * populated from this result).
 */

/** Outcome of a single FA's auction. */
export interface FaAuctionResult {
  /** Winning team, or null if no eligible bidder exists. */
  winnerTeamId: TeamId | null;
  /** Final Year-1 cap hit the winner agreed to. */
  finalPrice: number;
  /**
   * Scale factor vs. the tier's standard deal shape. Fed into
   * `makeFreeAgentContract` to size base salary + signing bonus.
   */
  valuationMultiplier: number;
  /** Up to 3 best runners-up, in order of strongest perceived bid. */
  runnersUp: readonly TeamId[];
  /**
   * Full list of eligible bidders with their cash valuations,
   * preference multipliers, and the perceived bid that drove the
   * auction sort. Empty when `winnerTeamId === null` (no team
   * qualified). Sorted descending by `perceivedBid` to match the
   * auction ordering. Persisted on `fa-sign` transactions so the
   * inspector can show the full market context behind each signing.
   */
  bidders: readonly FaBidderDetail[];
}

/**
 * One team's full bid context for a single FA. Captures both the
 * dollar valuation (`cashValuation`) and the player's preference
 * multiplier (`preferenceMultiplier`), plus the structured breakdown
 * that explains *why* preference came out the way it did — feeds the
 * inspector's "why this team won" callout.
 */
export interface FaBidderDetail {
  teamId: TeamId;
  /** What the team was willing to pay in Y1 cap dollars. */
  cashValuation: number;
  /** Player preference for this team, clamped [0.85, 1.15]. */
  preferenceMultiplier: number;
  /**
   * `cashValuation × preferenceMultiplier` — the auction sort key.
   * Watch-list conviction is folded into `cashValuation` directly
   * (coveted players cost more), so it does NOT appear as a separate
   * factor here.
   */
  perceivedBid: number;
  /** Cap room available to this team at the moment of the auction. */
  capRoomAtTime: number;
  /** Labeled component breakdown of how `preferenceMultiplier` was built. */
  preferenceFactors: PreferenceFactors;
  /**
   * Decisiveness multiplier from this team's watch list, applied to
   * `cashValuation`. 1.0 if the player isn't on the team's list; up to
   * 1.25 when they're top priority. Per Doc 4 "first-mover advantage" —
   * teams that scout effectively bid more aggressively on their targets,
   * so the boost shows up as a higher dollar bid (and a higher final
   * price when there's competition), not just as a sort-order tiebreaker.
   */
  watchListMultiplier: number;
  /**
   * Cash bid before the watch-list boost was applied (post-clamp,
   * pre-capRoom cap). Lets the inspector show how many dollars the
   * boost added without needing to invert the math. Equal to
   * `cashValuation / watchListMultiplier` when cap room wasn't the
   * binding constraint.
   */
  cashValuationBaseline: number;
  /** Watch-list priority for this player on this team, or null. */
  watchListPriority: number | null;
  /** Why this player is on the team's watch list, or null. */
  watchListReason: WatchListReason | null;
}

/**
 * Structured breakdown of a `computePlayerPreference` evaluation, so
 * the inspector can render "MIA preference was 1.08 because:
 * distraction × LARGE +0.06, RING_CHASER owner +0.05, HC
 * PRESS_CONFERENCE_DISASTER −0.06" rather than just a single number.
 */
export interface PreferenceFactors {
  /** Final clamped preference value — equals `computePlayerPreference`. */
  total: number;
  /** Contribution from the archetype × team market-size pairing. */
  archetypeMarket: number;
  /** Sum of owner-quirk contributions. */
  ownerQuirks: number;
  /** Sum of HC-quirk contributions. */
  hcQuirks: number;
  /** Contribution from HC playerRelationships (centered at 5.5). */
  hcPlayerRelationships: number;
  /** Contribution from starting-opportunity fit (Talent Allocation D-3). */
  startingOpportunity: number;
  /** Human-readable label for the archetype × market pairing, if it moved preference. */
  archetypeLabel: string | null;
  /** Human-readable labels for each owner quirk that fired (signed). */
  ownerQuirkLabels: readonly string[];
  /** Human-readable labels for each HC quirk that fired (signed). */
  hcQuirkLabels: readonly string[];
  /** Human-readable label for the starting-opportunity contribution, if it fired. */
  startingOpportunityLabel: string | null;
}

/**
 * Standard Year-1 cap hit for each tier — the anchor the auction
 * scales around. Tier separation is deliberately steep (a STAR anchor
 * ~15× a FRINGE one) so the position-scaled top-of-market (a STAR QB)
 * reaches real OTC territory while the common STARTER/BACKUP churn stays
 * cheap — the two tells The Liquidator's `run liquidator fa` flagged.
 * Per-FA prices vary inside a bounded window (see `BID_MULTIPLIER_FLOOR`
 * / `BID_MULTIPLIER_CEIL`) rather than letting fit × need × cap
 * composition push individual bids unbounded above the anchor.
 */
// v0.176: lifted +10% in lockstep with `FA_DEAL_BY_TIER` (see the anchor-lift
// note there) — the divisor and the deal shape must share an anchor.
const TIER_STANDARD_Y1: Record<Player['tier'], number> = {
  STAR: 16_500_000,
  STARTER: 3_520_000,
  BACKUP: 1_100_000,
  FRINGE: 900_000,
};

/**
 * Cap the combined scheme/need/cap multiplier so individual cash bids
 * stay within a bounded window around the tier standard. Without these
 * bounds the auction's second-price outcome systematically inflates
 * (high-fit cap-rich teams pay deep premiums) and the league cap band
 * drifts upward across seasons — breaking the fill-up backstop and
 * leaving rosters below 53. With bounds at [0.7, 1.2] competitive
 * auctions pay roughly the tier-standard on average and the league
 * cap band tracks the v0.18.x baseline.
 */
const BID_MULTIPLIER_FLOOR = 0.7;
const BID_MULTIPLIER_CEIL = 1.2;
/**
 * Minimum cap factor for a team behind the cash-floor pace (cap-realism
 * Slice 3) — floor-squeezed teams bid near tier-standard instead of
 * throttling with their (large) idle room.
 */
export const CASH_LAG_BID_FLOOR = 0.9;
/** Max bid multiple over tier-standard for a badly floor-lagging team. */
export const CASH_LAG_OVERPAY_MAX = 1.6;
/**
 * How fast overpay ramps with lag fraction (lag ÷ floor target). Steep on
 * purpose: a team even ~8pp behind pace (the measured pre-tune equilibrium)
 * already bids ~1.25× standard — the floor has to bite near the floor, not
 * only in catastrophic-lag states, or the league equilibrates below it.
 */
export const CASH_LAG_OVERPAY_SLOPE = 3.0;

/**
 * Position-scaled tier anchor — the dollar reference for THIS player's
 * auction. The real FA market is steeply position-dependent (a top QB
 * signs for ~5× a top RB), but `TIER_STANDARD_Y1` is position-agnostic.
 * Multiplying by the shared `positionSalaryFactor` (the same damped
 * top-of-market premium The Liquidator derived for seed contracts) makes
 * a premium-position FA cost more and a commodity-position FA cost less,
 * so cash valuations and the cap-room reservation both reflect the
 * positional market. The Liquidator's `run liquidator fa` report verifies
 * the resulting QB/RB top-of-market spread against real OTC data.
 *
 * NOTE: the *valuationMultiplier divisor* in `auctionFreeAgent` stays the
 * UNSCALED `TIER_STANDARD_Y1` on purpose — that lets the position premium
 * flow through into the contract that `makeFreeAgentContract` scales from
 * the tier shape, rather than cancelling out.
 */
function positionScaledStandardY1(player: Player, league: LeagueState): number {
  // Anchored dollars × current-cap ratio (v0.176): the auction's dollar
  // reference tracks the growing ceiling, so the veteran market re-prices
  // endogenously instead of decaying as a share of cap.
  return (
    TIER_STANDARD_Y1[player.tier] *
    (league.salaryCap / ANCHOR_CAP) *
    positionSalaryFactor(player.position, player.tier, FA_PREMIUM_DAMPEN)
  );
}

/**
 * Fraction of a team's gross incoming rookie-pool Year-1 cap that the
 * FA auction holds back. The draft fires AFTER free agency in the same
 * offseason, so a team that spends right up to the cap in FA tips over
 * once its rookies sign — the v0.107 cap-overage The Liquidator's fix #3
 * exposed. Reserving the rookie pool keeps the post-draft roster
 * cap-compliant without cutting a veteran after the draft.
 *
 * The factor is below 1.0 because offseason cap accounting is Top-51:
 * each incoming rookie displaces the cheapest counted contract, so the
 * NET cap added by the draft is smaller than the gross rookie Year-1
 * sum. 0.7 tracks the observed net (~$8.5M added vs ~$12M gross for a
 * full 7-pick class) — enough to stay compliant without making FA
 * needlessly timid.
 */
const ROOKIE_RESERVE_FACTOR = 0.7;

/**
 * Estimated cap room a team should hold back in free agency for its
 * incoming draft class — the sum of per-round Year-1 rookie cap hits
 * for the picks it currently owns in the upcoming draft (the draft that
 * fires later this same offseason, i.e. `seasonNumber === league.seasonNumber`),
 * scaled by `ROOKIE_RESERVE_FACTOR`. Picks traded away lower the reserve;
 * picks traded in raise it, so the reserve self-sizes to actual capital.
 */
function rookiePoolReserve(league: LeagueState, teamId: TeamId): number {
  let gross = 0;
  for (const pick of league.draftPicks) {
    if (pick.currentTeamId !== teamId) continue;
    if (pick.seasonNumber !== league.seasonNumber) continue;
    gross += estimatedRookieYear1CapHit(pick.round, league.salaryCap);
  }
  return gross * ROOKIE_RESERVE_FACTOR;
}

/**
 * Run a single free agent's auction. Returns `{ winnerTeamId: null }`
 * if no team has roster space, positional need, and cap room for any
 * bid above the league minimum — callers fall back to a vet-min
 * fill-up signing.
 */
export function auctionFreeAgent(
  league: LeagueState,
  player: Player,
): FaAuctionResult {
  const blueprintByPos = new Map<Position, number>();
  for (const slot of ROSTER_BLUEPRINT_53) blueprintByPos.set(slot.position, slot.count);

  const bids = collectBids(league, player, blueprintByPos);
  if (bids.length === 0) {
    return {
      winnerTeamId: null,
      finalPrice: 0,
      valuationMultiplier: 0,
      runnersUp: [],
      bidders: [],
    };
  }

  // Sort by perceived bid desc; deterministic tie-break by TeamId.
  bids.sort((a, b) => {
    if (a.perceived !== b.perceived) return b.perceived - a.perceived;
    return a.teamId < b.teamId ? -1 : 1;
  });

  const winner = bids[0]!;
  const runnerUp = bids[1];
  // Position-UNSCALED tier anchor on purpose: `finalPrice` is already
  // position-scaled (cash bids use `positionScaledStandardY1`), so dividing
  // by the position-unscaled standard yields a multiplier that carries the
  // position premium into the contract `makeFreeAgentContract` scales from
  // the tier shape. It IS cap-scaled (v0.176): makeFreeAgentContract applies
  // the cap ratio to the tier shape itself, so the divisor must match or the
  // growth would compound twice.
  const standardY1 = TIER_STANDARD_Y1[player.tier] * (league.salaryCap / ANCHOR_CAP);

  // Second-price with a 2% nudge above the runner-up's cash valuation,
  // capped at the winner's own cash so they never pay more than they
  // were willing to. Lone bidders get the player at an 85% discount —
  // there's no one to bid them up.
  const finalPrice = runnerUp
    ? Math.min(runnerUp.cash * 1.02, winner.cash)
    : winner.cash * 0.85;
  const valuationMultiplier = finalPrice / standardY1;
  const runnersUp = bids.slice(1, 4).map((b) => b.teamId);

  const bidders: FaBidderDetail[] = bids.map((b) => ({
    teamId: b.teamId,
    cashValuation: b.cash,
    cashValuationBaseline: b.cashBaseline,
    preferenceMultiplier: b.preference,
    perceivedBid: b.perceived,
    capRoomAtTime: b.capRoom,
    preferenceFactors: b.preferenceFactors,
    watchListMultiplier: b.watchListMultiplier,
    watchListPriority: b.watchListPriority,
    watchListReason: b.watchListReason,
  }));

  return {
    winnerTeamId: winner.teamId,
    finalPrice,
    valuationMultiplier,
    runnersUp,
    bidders,
  };
}

interface Bid {
  teamId: TeamId;
  cash: number;
  cashBaseline: number;
  preference: number;
  perceived: number;
  capRoom: number;
  preferenceFactors: PreferenceFactors;
  watchListMultiplier: number;
  watchListPriority: number | null;
  watchListReason: WatchListReason | null;
}

/**
 * Look up this team's watch-list entry for `playerId`, if any, and
 * convert priority into a bid multiplier in [1.0, 1.25]. Curve scaled
 * so a top-priority entry (priority ≈ 100) lands near the +25% ceiling
 * and middling entries (priority ≈ 50) sit around +15%.
 */
function watchListBoost(
  league: LeagueState,
  teamId: TeamId,
  playerId: PlayerId,
): { multiplier: number; priority: number | null; reason: WatchListReason | null } {
  const list = league.watchLists[teamId];
  if (!list) return { multiplier: 1, priority: null, reason: null };
  const entry = list.find((e) => e.playerId === playerId);
  if (!entry) return { multiplier: 1, priority: null, reason: null };
  const boost = Math.min(0.25, (entry.priority / 100) * 0.3);
  return {
    multiplier: 1 + boost,
    priority: entry.priority,
    reason: entry.reason,
  };
}

function collectBids(
  league: LeagueState,
  player: Player,
  blueprintByPos: Map<Position, number>,
): Bid[] {
  const standardY1 = positionScaledStandardY1(player, league);
  const bids: Bid[] = [];
  for (const team of Object.values(league.teams)) {
    if (team.rosterIds.length >= 53) continue;

    // Positional need — skip teams already at or above blueprint at
    // this position. Mirrors the v0.13.0 primary-pass filter; FAs
    // unsigned by the auction fall to the vet-min fill-up.
    const have = countAtPosition(team, league, player.position);
    const blueprintCount = blueprintByPos.get(player.position) ?? 0;
    if (blueprintCount > 0 && have >= blueprintCount) continue;

    // Cap-room filter: team must be able to clear the tier's *standard*
    // Y1 hit AND retain enough cap room to fill the remaining roster
    // slots at league minimum. Without the fill-up reserve, a favored
    // team (good HC + favorable preference) can win 4-6 auctions in
    // sequence, each individually passing this gate, and end the
    // offseason with $0.4M cap room — below the vet minimum
    // so the fill-up backstop can't reach them, leaving the team at
    // 45-50/53 instead of 53/53. The reservation forces teams to
    // stop bidding earlier and lets fill-up complete the roster.
    // Resolves the v0.20.0 long-horizon roster-shortfall residual.
    const capRoom = league.salaryCap - teamCapUsage(team, league);
    const remainingSlotsAfterSigning = Math.max(0, 53 - team.rosterIds.length - 1);
    const fillUpReserve = remainingSlotsAfterSigning * leagueMinimumSalary(league.salaryCap);
    // Hold back the incoming draft class's first-year cap: the draft
    // fires after FA this same offseason, so spending all the way to the
    // cap here tips the team over once rookies sign. Reserving the rookie
    // pool is what real GMs do — and it keeps the steep position-scaled
    // FA market (fix #3) without forcing a post-draft veteran cut.
    const rookieReserve = rookiePoolReserve(league, team.identity.id);
    const effectiveCapRoom = Math.max(0, capRoom - rookieReserve);
    if (effectiveCapRoom < standardY1 + fillUpReserve) continue;

    // Effective cash is the team's desired valuation capped at their
    // cap room — they can't bid more than they can pay, but they can
    // bid less than their full enthusiasm. The watch-list boost is
    // applied AFTER the standard fit/need/cap clamp: a coveted player
    // legitimately costs more, and that conviction shows up as real
    // dollars (and a higher second-price for the winner) rather than
    // a free sort-order kick. Cap room remains the natural ceiling.
    const baselineCash = computeTeamCashBid(team, player, league, blueprintByPos);
    const watch = watchListBoost(league, team.identity.id, player.id);
    const boostedCash = baselineCash * watch.multiplier;
    // Cap at the rookie-reserved cap room (not the gross) so a qualifying
    // team can't bid into the room it must keep for its draft class.
    const cash = Math.min(boostedCash, effectiveCapRoom);

    const preferenceFactors = computePlayerPreferenceBreakdown(team, player, league);
    bids.push({
      teamId: team.identity.id,
      cash,
      cashBaseline: baselineCash,
      preference: preferenceFactors.total,
      perceived: cash * preferenceFactors.total,
      capRoom,
      preferenceFactors,
      watchListMultiplier: watch.multiplier,
      watchListPriority: watch.priority,
      watchListReason: watch.reason,
    });
  }
  return bids;
}

/**
 * Cash valuation in dollars — what this team is willing to pay in Year-1
 * cap hit. Composed from scheme fit × positional need × cap room.
 * Range roughly [0.55, 1.80] × tier-standard.
 */
export function computeTeamCashBid(
  team: TeamState,
  player: Player,
  league: LeagueState,
  blueprintByPos: Map<Position, number>,
): number {
  // Kept in the signature for public-API stability (exported via index.ts /
  // npc-ai/index.ts) though no longer consumed here — the shape number no
  // longer drives cash pricing as of D-1b. See the needFactor comment below.
  void blueprintByPos;
  const standard = positionScaledStandardY1(player, league);

  const hc = league.coaches[team.headCoachId];
  if (!hc) return 0;
  const fit = schemeFitForPlayer(player, {
    offensiveScheme: hc.offensiveScheme,
    defensiveScheme: hc.defensiveScheme,
  });

  // Need factor: 1.0 (no need) → 1.25 (dire need). Caps prevent a
  // QB-needy team from bidding 2× for any QB — even a desperate team
  // is bounded by what they think the player is actually worth.
  //
  // Talent Allocation D-1b (2026-07-31, `TALENT_ALLOCATION.md` §6): the
  // premium is now measured against `QUALITY_DEPTH_TARGET` (how many
  // STARTER-CALIBRE players the team wants), not raw headcount against the
  // 53-man blueprint. Against the blueprint a team could show a "deficit"
  // — and pay a premium — while already holding a franchise starter, purely
  // for lacking camp bodies; that's a roster-SHAPE gap, not a reason to
  // overpay in cash. `blueprintByPos`'s eligibility gate above (line ~365,
  // "already at blueprint count, don't even bid") is intentionally left on
  // the shape number — it governs whether there's DEPTH-CHART ROOM for
  // another body at all, a different question from how much a team should
  // pay once it's bidding.
  const qualityTarget = QUALITY_DEPTH_TARGET[player.position] ?? 0;
  const haveQuality = countStarterCaliberAtPosition(team, league, player.position);
  const deficit = Math.max(0, qualityTarget - haveQuality);
  const needFactor =
    qualityTarget > 0 ? 1.0 + Math.min(0.25, (deficit / qualityTarget) * 0.5) : 1.0;

  // Cap-room factor: a near-cap-pinned team's bid collapses toward 0,
  // so they naturally fall out of bidding wars. This is what spreads
  // signings across the league instead of letting a few cap-rich
  // "preferred" teams hog the auction until they're cap-pinned. (Pre-
  // v0.20 used the same linear `capRoom / salaryCap` factor.) The
  // earlier `0.55 +` floor kept cap-pinned teams competitive on
  // preference alone and produced post-auction rosters in the low 40s.
  const capRoom = league.salaryCap - teamCapUsage(team, league);
  const capRoomFrac = clamp(capRoom / league.salaryCap, 0, 1);
  let capFactor = clamp(capRoomFrac * 1.2, 0, 1.2);

  // Cash-floor pressure (cap-realism Slice 3): the linear throttle is what
  // let cap-rich teams sit out the market forever — a team at 62% usage bid
  // at under half standard and the league equilibrated ~$95M/team idle. A
  // team behind the CBA-style ~89%-of-caps cash pace doesn't get to keep
  // hoarding: its bids stay near tier-standard regardless of how much room
  // it's sitting on (the separate cap-room gate still bounds what it can pay).
  const floorStatus = teamCashFloorStatus(team, league);
  // Record-aware QB carve-out (v0.175, the v0.154 philosophy applied to the
  // cash floor): a losing team's floor pressure never targets a non-STAR
  // veteran QB — real bottom teams sign bridge passers at bridge prices and
  // draft the franchise QB; they don't hand a market-topping March deal to a
  // middling vet. Without this, the Slice-3 overpay made the worst (most
  // cash-lagging) teams the strongest bidders on exactly the position they
  // should stay desperate at, suppressing #1-overall QB drafting (76→67%).
  // Normal fit × need × throttle bidding still applies — only the lag boosts
  // are withheld.
  const qbCarveOut =
    player.position === 'QB' &&
    player.tier !== 'STAR' &&
    (lastSeasonWins(team, league) ?? Number.POSITIVE_INFINITY) <= RESIGN_QB_BAD_TEAM_WINS;
  if (capFactor < CASH_LAG_BID_FLOOR && floorStatus.lagging && !qbCarveOut) {
    capFactor = CASH_LAG_BID_FLOOR;
  }

  // Bound the combined multiplier so individual bids can't run away
  // above the tier anchor. See the BID_MULTIPLIER_* docs above.
  const combined = clamp(
    fit * needFactor * capFactor,
    BID_MULTIPLIER_FLOOR,
    BID_MULTIPLIER_CEIL,
  );

  // Floor-squeezed teams pay ABOVE the tier standard, proportional to how
  // far behind pace they are — the real CBA floor is why cash-poor-pace
  // teams hand out the league's worst contracts. Rosters are finite, so
  // simply bidding at standard can't close a big lag: the money has to
  // show up in the PRICE. Self-limiting: as the ledger catches up, the
  // overpay decays to 1.
  let overpay = 1;
  if (floorStatus.lagging && floorStatus.floorTarget > 0 && !qbCarveOut) {
    const lagFrac = floorStatus.lag / floorStatus.floorTarget;
    overpay = 1 + Math.min(CASH_LAG_OVERPAY_MAX - 1, lagFrac * CASH_LAG_OVERPAY_SLOPE);
  }
  return standard * combined * overpay;
}

/**
 * Player-preference multiplier — how the player values this team
 * independent of dollars. Clamped to [0.85, 1.15]. Built from the
 * v0.18.0+ chemistry layer:
 *
 *  - `Player.moodProfile.archetype` × team `marketSize`: distraction-
 *    archetype headliners want big stages; stabilizers/anchors prefer
 *    calm rooms.
 *  - Owner quirks (RING_CHASER, PANIC_SELLER, LOYALTY_BLIND, etc.).
 *  - HC quirks (CULTURE_CARRIER, PRESS_CONFERENCE_DISASTER).
 *  - HC `playerRelationships` spectrum (centered at 5.5).
 *
 * Thin wrapper around `computePlayerPreferenceBreakdown` — the
 * breakdown function is the single source of truth and feeds both
 * the auction (uses `.total`) and the inspector (renders the labels).
 */
export function computePlayerPreference(
  team: TeamState,
  player: Player,
  league: LeagueState,
): number {
  return computePlayerPreferenceBreakdown(team, player, league).total;
}

/**
 * Same as `computePlayerPreference` but returns the structured
 * breakdown of every factor contribution + a human-readable label
 * per fired effect. The inspector renders these labels in the
 * "why this team won" callout on FA-sign detail panels.
 */
export function computePlayerPreferenceBreakdown(
  team: TeamState,
  player: Player,
  league: LeagueState,
): PreferenceFactors {
  const owner = league.owners[team.ownerId];
  const hc = league.coaches[team.headCoachId];

  // Owner or HC missing — defensive guard; mirrors the v0.20 behavior
  // of returning the neutral 1.0 in that case.
  if (!owner || !hc) {
    return {
      total: 1.0,
      archetypeMarket: 0,
      ownerQuirks: 0,
      hcQuirks: 0,
      hcPlayerRelationships: 0,
      startingOpportunity: 0,
      archetypeLabel: null,
      ownerQuirkLabels: [],
      hcQuirkLabels: [],
      startingOpportunityLabel: null,
    };
  }

  // Archetype × market.
  let archetypeMarket = 0;
  let archetypeLabel: string | null = null;
  switch (player.moodProfile.archetype) {
    case 'distraction':
      if (team.identity.marketSize === MarketSize.LARGE) {
        archetypeMarket = 0.06;
        archetypeLabel = 'distraction × LARGE market';
      } else if (team.identity.marketSize === MarketSize.SMALL) {
        archetypeMarket = -0.05;
        archetypeLabel = 'distraction × SMALL market';
      }
      break;
    case 'stabilizer':
    case 'anchor':
      if (team.identity.marketSize === MarketSize.SMALL) {
        archetypeMarket = 0.02;
        archetypeLabel = `${player.moodProfile.archetype} × SMALL market`;
      } else if (team.identity.marketSize === MarketSize.LARGE) {
        archetypeMarket = -0.01;
        archetypeLabel = `${player.moodProfile.archetype} × LARGE market`;
      }
      break;
    case 'moody':
    case 'normal':
      break;
  }

  // Owner + HC quirks. STAR-tier quirks apply only to STARs (they're
  // face-of-franchise — they care more about ownership + HC media).
  let ownerQuirks = 0;
  let hcQuirks = 0;
  const ownerQuirkLabels: string[] = [];
  const hcQuirkLabels: string[] = [];

  if (player.tier === 'STAR') {
    if (owner.quirks.includes('RING_CHASER')) {
      ownerQuirks += 0.05;
      ownerQuirkLabels.push('RING_CHASER owner (STAR)');
    }
    if (hc.quirks.includes('PRESS_CONFERENCE_DISASTER')) {
      hcQuirks -= 0.06;
      hcQuirkLabels.push('PRESS_CONFERENCE_DISASTER HC (STAR)');
    }
    if (hc.quirks.includes('CULTURE_CARRIER')) {
      hcQuirks += 0.03;
      hcQuirkLabels.push('CULTURE_CARRIER HC (STAR)');
    }
  }
  if (owner.quirks.includes('PANIC_SELLER')) {
    ownerQuirks -= 0.04;
    ownerQuirkLabels.push('PANIC_SELLER owner');
  }
  if (owner.quirks.includes('LOYALTY_BLIND')) {
    ownerQuirks += 0.03;
    ownerQuirkLabels.push('LOYALTY_BLIND owner');
  }
  if (owner.quirks.includes('MICRO_MANAGER')) {
    ownerQuirks -= 0.03;
    ownerQuirkLabels.push('MICRO_MANAGER owner');
  }
  if (owner.quirks.includes('COMMUNITY_CHAMPION')) {
    ownerQuirks += 0.02;
    ownerQuirkLabels.push('COMMUNITY_CHAMPION owner');
  }

  // HC playerRelationships — centered at 5.5, ±0.045 max.
  const hcPlayerRelationships = (hc.spectrums.playerRelationships - 5.5) * 0.01;

  // Starting-opportunity fit (Talent Allocation D-3, 2026-07-31,
  // `TALENT_ALLOCATION.md` §5). QB_ROOM_PERSISTENCE.md §9 diagnosed the
  // QB1-QB2 gap deficit as an ALLOCATION problem: real starter-calibre
  // players hold at most one starting job (95.3% of real QB rooms have
  // <=1) because a good player who'd sit behind another good player instead
  // signs where he'd start — the dominant real-world channel (backup QBs
  // on short deals leaving for starting jobs). Nothing in the engine
  // modeled that preference before this; a starter-calibre FA only cared
  // about scheme fit, cap, and personality quirks, identically to a
  // FRINGE roster-filler. Scoped to STAR/STARTER tier only — a
  // BACKUP/FRINGE signing has no real "wants to start" pull at anywhere
  // near this strength, and this whole diagnosis + its downstream gates
  // (Goatinator QB dual-gate, the QB1-QB2 facet bars) are about the
  // starter-calibre population specifically.
  //
  // MAGNITUDE — unlike `QUALITY_DEPTH_TARGET` (a direct Madden real-bar
  // count), there is no equivalent direct real-data number for HOW STRONGLY
  // a player should prefer an open starting job over personality/scheme
  // factors. This is a first-cut magnitude sized to be the single largest
  // preference term in this function (exceeding any one owner/HC quirk,
  // ~0.02-0.06) without alone dominating the [0.85, 1.15] clamp — measured
  // against the downstream real bars this whole slice targets (QB1-QB2
  // gap-ladder ratio 1.88, room clustering 4.7%,
  // `_qbroom_d2_allocation.mjs`), not asserted a priori.
  //
  // MEASURED (2026-07-31): at 0.1 (combined with D-1a/D-1b/D-2), ladder
  // ratio moved 0.98 -> 1.18, clustering 23.3% -> 15.5% — real, monotonic
  // progress, well short of the real bar. TRIPLING to 0.3 moved it only to
  // 1.28 / 15.7% — essentially flat. This is diminishing-returns evidence
  // the residual is STRUCTURAL (scarcity of genuinely open slots at
  // signing time within a single offseason pass), not a magnitude problem —
  // per law #3, that is the signal to stop tuning this constant, not push
  // it further. See `TALENT_ALLOCATION.md` §7 for the full record before
  // trying a different value here.
  let startingOpportunity = 0;
  let startingOpportunityLabel: string | null = null;
  if (player.tier === 'STAR' || player.tier === 'STARTER') {
    const qualityTarget = QUALITY_DEPTH_TARGET[player.position] ?? 0;
    if (qualityTarget > 0) {
      const haveQuality = countStarterCaliberAtPosition(team, league, player.position);
      if (haveQuality < qualityTarget) {
        startingOpportunity = STARTING_OPPORTUNITY_MAGNITUDE;
        startingOpportunityLabel = 'open starting opportunity';
      } else {
        startingOpportunity = -STARTING_OPPORTUNITY_MAGNITUDE;
        startingOpportunityLabel = 'blocked at position';
      }
    }
  }

  const raw =
    1.0 +
    archetypeMarket +
    ownerQuirks +
    hcQuirks +
    hcPlayerRelationships +
    startingOpportunity;
  const total = clamp(raw, 0.85, 1.15);

  return {
    total,
    archetypeMarket,
    ownerQuirks,
    hcQuirks,
    hcPlayerRelationships,
    startingOpportunity,
    archetypeLabel,
    ownerQuirkLabels,
    hcQuirkLabels,
    startingOpportunityLabel,
  };
}

/**
 * See the provenance comment at its use site in
 * `computePlayerPreferenceBreakdown` (Talent Allocation D-3).
 */
const STARTING_OPPORTUNITY_MAGNITUDE = 0.1;

function countAtPosition(team: TeamState, league: LeagueState, position: Position): number {
  let n = 0;
  for (const playerId of team.rosterIds) {
    const p = league.players[playerId];
    if (p && p.position === position) n++;
  }
  return n;
}

function countStarterCaliberAtPosition(
  team: TeamState,
  league: LeagueState,
  position: Position,
): number {
  let n = 0;
  for (const playerId of team.rosterIds) {
    const p = league.players[playerId];
    if (p && p.position === position && (p.tier === 'STAR' || p.tier === 'STARTER')) n++;
  }
  return n;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
