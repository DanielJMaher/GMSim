import type { LeagueState } from '../types/league.js';
import type { Player } from '../types/player.js';
import type { TeamState } from '../types/team.js';
import type { TeamId, PlayerId } from '../types/ids.js';
import type { Position } from '../types/enums.js';
import { MarketSize } from '../types/enums.js';
import type { WatchListReason } from '../types/scout.js';
import { ROSTER_BLUEPRINT_53 } from '../players/roster-blueprint.js';
import { teamCapUsage } from '../contracts/cap.js';
import { schemeFitForPlayer } from '../scheme/fit.js';
import { LEAGUE_MINIMUM_SALARY } from '../contracts/constants.js';
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
  /** Human-readable label for the archetype × market pairing, if it moved preference. */
  archetypeLabel: string | null;
  /** Human-readable labels for each owner quirk that fired (signed). */
  ownerQuirkLabels: readonly string[];
  /** Human-readable labels for each HC quirk that fired (signed). */
  hcQuirkLabels: readonly string[];
}

/**
 * Standard Year-1 cap hit for each tier — the anchor the auction
 * scales around. Matches the pre-v0.20 flat-tier Y1 cap hit so the
 * league-wide cap band stays stable; per-FA prices vary inside a
 * bounded window (see `BID_MULTIPLIER_FLOOR` / `BID_MULTIPLIER_CEIL`)
 * rather than letting fit × need × cap composition push individual
 * bids unbounded above the anchor.
 */
const TIER_STANDARD_Y1: Record<Player['tier'], number> = {
  STAR: 10_500_000,
  STARTER: 4_000_000,
  BACKUP: 1_200_000,
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
  const standardY1 = TIER_STANDARD_Y1[player.tier];

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
  const standardY1 = TIER_STANDARD_Y1[player.tier];
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
    // offseason with $0.4M cap room — below `LEAGUE_MINIMUM_SALARY`
    // so the fill-up backstop can't reach them, leaving the team at
    // 45-50/53 instead of 53/53. The reservation forces teams to
    // stop bidding earlier and lets fill-up complete the roster.
    // Resolves the v0.20.0 long-horizon roster-shortfall residual.
    const capRoom = league.salaryCap - teamCapUsage(team, league);
    const remainingSlotsAfterSigning = Math.max(0, 53 - team.rosterIds.length - 1);
    const fillUpReserve = remainingSlotsAfterSigning * LEAGUE_MINIMUM_SALARY;
    if (capRoom < standardY1 + fillUpReserve) continue;

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
    const cash = Math.min(boostedCash, capRoom);

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
  const standard = TIER_STANDARD_Y1[player.tier];

  const hc = league.coaches[team.headCoachId];
  if (!hc) return 0;
  const fit = schemeFitForPlayer(player, {
    offensiveScheme: hc.offensiveScheme,
    defensiveScheme: hc.defensiveScheme,
  });

  const have = countAtPosition(team, league, player.position);
  const blueprintCount = blueprintByPos.get(player.position) ?? 0;
  const deficit = Math.max(0, blueprintCount - have);
  // Need factor: 1.0 (no need) → 1.25 (dire need). Caps prevent a
  // QB-needy team from bidding 2× for any QB — even a desperate team
  // is bounded by what they think the player is actually worth.
  const needFactor =
    blueprintCount > 0
      ? 1.0 + Math.min(0.25, (deficit / blueprintCount) * 0.5)
      : 1.0;

  // Cap-room factor: a near-cap-pinned team's bid collapses toward 0,
  // so they naturally fall out of bidding wars. This is what spreads
  // signings across the league instead of letting a few cap-rich
  // "preferred" teams hog the auction until they're cap-pinned. (Pre-
  // v0.20 used the same linear `capRoom / salaryCap` factor.) The
  // earlier `0.55 +` floor kept cap-pinned teams competitive on
  // preference alone and produced post-auction rosters in the low 40s.
  const capRoom = league.salaryCap - teamCapUsage(team, league);
  const capRoomFrac = clamp(capRoom / league.salaryCap, 0, 1);
  const capFactor = clamp(capRoomFrac * 1.2, 0, 1.2);

  // Bound the combined multiplier so individual bids can't run away
  // above the tier anchor. See the BID_MULTIPLIER_* docs above.
  const combined = clamp(
    fit * needFactor * capFactor,
    BID_MULTIPLIER_FLOOR,
    BID_MULTIPLIER_CEIL,
  );
  return standard * combined;
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
      archetypeLabel: null,
      ownerQuirkLabels: [],
      hcQuirkLabels: [],
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

  const raw = 1.0 + archetypeMarket + ownerQuirks + hcQuirks + hcPlayerRelationships;
  const total = clamp(raw, 0.85, 1.15);

  return {
    total,
    archetypeMarket,
    ownerQuirks,
    hcQuirks,
    hcPlayerRelationships,
    archetypeLabel,
    ownerQuirkLabels,
    hcQuirkLabels,
  };
}

function countAtPosition(team: TeamState, league: LeagueState, position: Position): number {
  let n = 0;
  for (const playerId of team.rosterIds) {
    const p = league.players[playerId];
    if (p && p.position === position) n++;
  }
  return n;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
