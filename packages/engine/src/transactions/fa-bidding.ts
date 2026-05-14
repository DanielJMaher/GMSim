import type { LeagueState } from '../types/league.js';
import type { Player } from '../types/player.js';
import type { TeamState } from '../types/team.js';
import type { TeamId } from '../types/ids.js';
import type { Position } from '../types/enums.js';
import { MarketSize } from '../types/enums.js';
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
    return { winnerTeamId: null, finalPrice: 0, valuationMultiplier: 0, runnersUp: [] };
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

  return {
    winnerTeamId: winner.teamId,
    finalPrice,
    valuationMultiplier,
    runnersUp,
  };
}

interface Bid {
  teamId: TeamId;
  cash: number;
  preference: number;
  perceived: number;
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
    // Y1 hit. Filtering on the team's full computed cash bid was too
    // strict — it rejected scheme-perfect teams whose elevated cash bid
    // exceeded their cap room, even when they could still afford the
    // standard deal. Pre-v0.20 used this same floor, so existing
    // roster + cap-band tests rely on it.
    const capRoom = league.salaryCap - teamCapUsage(team, league);
    if (capRoom < standardY1) continue;

    // Effective cash is the team's desired valuation capped at their
    // cap room — they can't bid more than they can pay, but they can
    // bid less than their full enthusiasm.
    const desiredCash = computeTeamCashBid(team, player, league, blueprintByPos);
    const cash = Math.min(desiredCash, capRoom);

    const preference = computePlayerPreference(team, player, league);
    bids.push({
      teamId: team.identity.id,
      cash,
      preference,
      perceived: cash * preference,
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
 */
export function computePlayerPreference(
  team: TeamState,
  player: Player,
  league: LeagueState,
): number {
  let pref = 1.0;

  const owner = league.owners[team.ownerId];
  const hc = league.coaches[team.headCoachId];
  if (!owner || !hc) return pref;

  switch (player.moodProfile.archetype) {
    case 'distraction':
      if (team.identity.marketSize === MarketSize.LARGE) pref += 0.06;
      else if (team.identity.marketSize === MarketSize.SMALL) pref -= 0.05;
      break;
    case 'stabilizer':
    case 'anchor':
      if (team.identity.marketSize === MarketSize.SMALL) pref += 0.02;
      else if (team.identity.marketSize === MarketSize.LARGE) pref -= 0.01;
      break;
    case 'moody':
    case 'normal':
      break;
  }

  // STAR-tier players are the face of the franchise — they care more
  // about ownership stability and the head coach's media presence.
  if (player.tier === 'STAR') {
    if (owner.quirks.includes('RING_CHASER')) pref += 0.05;
    if (hc.quirks.includes('PRESS_CONFERENCE_DISASTER')) pref -= 0.06;
    if (hc.quirks.includes('CULTURE_CARRIER')) pref += 0.03;
  }

  // Universal owner-culture cues.
  if (owner.quirks.includes('PANIC_SELLER')) pref -= 0.04;
  if (owner.quirks.includes('LOYALTY_BLIND')) pref += 0.03;
  if (owner.quirks.includes('MICRO_MANAGER')) pref -= 0.03;
  if (owner.quirks.includes('COMMUNITY_CHAMPION')) pref += 0.02;

  // HC playerRelationships — centered at 5.5, ±0.045 max.
  pref += (hc.spectrums.playerRelationships - 5.5) * 0.01;

  return clamp(pref, 0.85, 1.15);
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
