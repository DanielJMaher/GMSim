import type { LeagueState } from '../types/league.js';
import type { Player } from '../types/player.js';
import type { TeamState } from '../types/team.js';
import type { PlayerId, TeamId } from '../types/ids.js';
import type { Position } from '../types/enums.js';
import type {
  OffensiveSchemeArchetype,
  DefensiveSchemeArchetype,
} from '../types/personnel.js';
import type { Prng } from '../prng/index.js';
import { CompetitiveWindow } from '../types/enums.js';
import { ROSTER_BLUEPRINT_53 } from '../players/roster-blueprint.js';
import { teamCapUsage, currentCapHit } from '../contracts/cap.js';
import { schemeFitForPlayer } from '../scheme/fit.js';
import { executeTrade } from './trade.js';
import {
  evaluateTradePackage,
  type TradePackageEvaluation,
} from '../trade/value.js';
import type { AlternativeTradeCandidate } from '../types/transaction.js';

/** Max alternatives persisted on each fired trade transaction. */
const MAX_ALTERNATIVES_PER_TRADE = 5;

/**
 * Both sides of a proactive trade must retain at least this much cap
 * room *before* the trade fires. The seller absorbs the outgoing
 * player's remaining proration as dead money, which can push them
 * over the LEAGUE_MIN fill-up threshold and leave them short of 53
 * post-offseason. The same threshold protects buyers from over-
 * committing cap to a trade when they also need to FA-shop. Picked
 * to be comfortably above LEAGUE_MIN ($900k) plus a typical mid-tier
 * remaining-proration band ($1–4M).
 */
const PROACTIVE_TRADE_CAP_SAFETY = 5_000_000;

interface SchemePair {
  offensiveScheme: OffensiveSchemeArchetype;
  defensiveScheme: DefensiveSchemeArchetype;
}

/**
 * Proactive NPC dealmaking — team-initiated trades that fire alongside
 * the v0.17.0 trade-request matcher (`runWeeklyNpcTrades`). Unlike the
 * request-driven path, no specific player has demanded a move; teams
 * scan the league for trades that improve their own roster.
 *
 * Two parallel candidate generators feed a single prioritized execution
 * queue:
 *
 *   Pass 1 — buyer-driven positional need. Teams in
 *   CHAMPIONSHIP/CONTENDER/EMERGING windows scan for positional holes
 *   (below blueprint count of STAR+STARTER). For each hole they look
 *   for sellers who are willing to part with a STAR/STARTER at that
 *   position. A seller is willing if they have *surplus* depth above
 *   blueprint OR they are in a rebuild window
 *   (REBUILDING/STAGNANT/RETOOLING). STAR trades additionally require
 *   the seller to be a rebuilder — contending teams don't ship their
 *   best player without an explicit player request.
 *
 *   Pass 2 — mutual scheme-fit swap (the "Sweat-for-Johnson"
 *   archetype). For each pair of same-tier players at the same
 *   position where each player is a poor fit on their current team
 *   AND a good fit on the other, propose a swap. Both teams improve
 *   their fit profile — no draft picks needed, both rosters get
 *   better. Fires regardless of competitive window.
 *
 * Trades execute with buyer-once and seller-once caps per call (same
 * pattern as `runWeeklyNpcTrades`). No-trade clauses are *respected*
 * here — a proactive trade is league-initiated, not player-requested,
 * so the player's NTC stands unless they've explicitly demanded a move.
 *
 * Determinism: the PRNG handle is taken for future tiebreak
 * randomization but is not consumed in v0.21.0. All ordering decisions
 * are made via deterministic priorities + TeamId/PlayerId tiebreaks.
 */
export function runProactiveTrades(
  prng: Prng,
  league: LeagueState,
  tick: number,
): LeagueState {
  void prng; // reserved
  void tick; // executeTrade stamps with league.tick

  const blueprintByPos = new Map<Position, number>();
  for (const slot of ROSTER_BLUEPRINT_53) blueprintByPos.set(slot.position, slot.count);

  const candidates: TradeCandidate[] = [
    ...collectPositionalNeedCandidates(league, blueprintByPos),
    ...collectSchemeFitSwapCandidates(league),
  ];

  // Highest priority first; deterministic tiebreak.
  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    if (a.buyerId !== b.buyerId) return a.buyerId < b.buyerId ? -1 : 1;
    if (a.sellerId !== b.sellerId) return a.sellerId < b.sellerId ? -1 : 1;
    return a.acquireId < b.acquireId ? -1 : 1;
  });

  const usedTeams = new Set<TeamId>();
  let working = league;

  // Track each candidate's outcome as we walk the priority-sorted
  // list. Used to populate `alternativeCandidates` on each fired
  // trade with the trades that shared a player but didn't fire.
  const outcomes: CandidateOutcome[] = [];

  for (const c of candidates) {
    if (usedTeams.has(c.buyerId)) {
      outcomes.push({ candidate: c, outcome: 'buyer-used' });
      continue;
    }
    if (usedTeams.has(c.sellerId)) {
      outcomes.push({ candidate: c, outcome: 'seller-used' });
      continue;
    }

    // Re-validate against the latest state — a prior trade may have
    // moved one of the players or shifted cap room. Skip silently on
    // any inconsistency rather than throwing.
    if (!tradeStillValid(working, c)) {
      outcomes.push({ candidate: c, outcome: 'failed-gate' });
      continue;
    }

    const alternativeCandidates = buildAlternatives(c, outcomes, candidates);

    try {
      working = executeTrade(working, {
        teamAId: c.buyerId,
        teamBId: c.sellerId,
        playersAToB: [c.returnId],
        playersBToA: [c.acquireId],
        metadata: {
          initiatorTeamId: c.buyerId,
          source:
            c.kind === 'scheme-fit-swap'
              ? 'proactive-fit-swap'
              : 'proactive-need',
          // teamA = buyer in our orientation.
          teamAValue: c.buyerEval,
          teamBValue: c.sellerEval,
          alternativeCandidates,
        },
      });
    } catch {
      outcomes.push({ candidate: c, outcome: 'failed-gate' });
      continue;
    }
    outcomes.push({ candidate: c, outcome: 'fires' });
    usedTeams.add(c.buyerId);
    usedTeams.add(c.sellerId);
  }

  return working;
}

interface CandidateOutcome {
  candidate: TradeCandidate;
  outcome: 'fires' | 'buyer-used' | 'seller-used' | 'failed-gate';
}

/**
 * Surface the top {@link MAX_ALTERNATIVES_PER_TRADE} candidates that
 * share at least one player with the firing trade and didn't fire.
 * Drawn from both already-processed outcomes (visible reasons) and
 * yet-to-be-processed candidates (they will become buyer-used or
 * seller-used once `fired` executes).
 */
function buildAlternatives(
  fired: TradeCandidate,
  processedOutcomes: readonly CandidateOutcome[],
  allCandidates: readonly TradeCandidate[],
): AlternativeTradeCandidate[] {
  const sharedPlayerIds = new Set<PlayerId>([fired.acquireId, fired.returnId]);
  const results: AlternativeTradeCandidate[] = [];
  const seen = new Set<TradeCandidate>();

  for (const o of processedOutcomes) {
    if (o.outcome === 'fires') continue;
    if (!sharesPlayer(o.candidate, sharedPlayerIds)) continue;
    results.push(toAlternative(o.candidate, o.outcome));
    seen.add(o.candidate);
  }

  for (const u of allCandidates) {
    if (u === fired) continue;
    if (seen.has(u)) continue;
    if (processedOutcomes.some((o) => o.candidate === u)) continue;
    if (!sharesPlayer(u, sharedPlayerIds)) continue;
    let reason: AlternativeTradeCandidate['reason'];
    if (u.buyerId === fired.buyerId || u.buyerId === fired.sellerId) {
      reason = 'buyer-used';
    } else if (u.sellerId === fired.buyerId || u.sellerId === fired.sellerId) {
      reason = 'seller-used';
    } else {
      reason = 'lower-priority';
    }
    results.push(toAlternative(u, reason));
  }

  results.sort(
    (a, b) =>
      b.buyerNetValue + b.sellerNetValue - (a.buyerNetValue + a.sellerNetValue),
  );
  return results.slice(0, MAX_ALTERNATIVES_PER_TRADE);
}

function sharesPlayer(
  candidate: TradeCandidate,
  ids: ReadonlySet<PlayerId>,
): boolean {
  return ids.has(candidate.acquireId) || ids.has(candidate.returnId);
}

function toAlternative(
  c: TradeCandidate,
  reason: AlternativeTradeCandidate['reason'],
): AlternativeTradeCandidate {
  return {
    buyerId: c.buyerId,
    sellerId: c.sellerId,
    acquireId: c.acquireId,
    returnId: c.returnId,
    buyerNetValue: c.buyerEval.netValue,
    sellerNetValue: c.sellerEval.netValue,
    reason,
  };
}

interface TradeCandidate {
  buyerId: TeamId;
  sellerId: TeamId;
  /** Player the buyer is acquiring (moves seller -> buyer). */
  acquireId: PlayerId;
  /** Player the buyer is sending back (moves buyer -> seller). */
  returnId: PlayerId;
  /** Higher = preferred. Used to order the execution queue. */
  priority: number;
  kind: 'positional-need' | 'scheme-fit-swap';
  /** Doc 14 5-factor evaluation from the buyer's perspective. */
  buyerEval: TradePackageEvaluation;
  /** Doc 14 5-factor evaluation from the seller's perspective. */
  sellerEval: TradePackageEvaluation;
}

const BUYER_WINDOWS: ReadonlySet<CompetitiveWindow> = new Set([
  CompetitiveWindow.CHAMPIONSHIP,
  CompetitiveWindow.CONTENDER,
  CompetitiveWindow.EMERGING,
]);
const REBUILD_WINDOWS: ReadonlySet<CompetitiveWindow> = new Set([
  CompetitiveWindow.REBUILDING,
  CompetitiveWindow.STAGNANT,
  CompetitiveWindow.RETOOLING,
]);

/** Scheme-fit thresholds — see schemeFitForPlayer's [0.5, 1.7] range. */
const FIT_POOR = 0.85;
const FIT_GOOD = 1.1;

const TIER_RANK: Record<Player['tier'], number> = {
  STAR: 0,
  STARTER: 1,
  BACKUP: 2,
  FRINGE: 3,
};

/**
 * Pass 1: contender teams in buyer windows scan for positional holes
 * and look for willing sellers (surplus depth or rebuilders).
 */
function collectPositionalNeedCandidates(
  league: LeagueState,
  blueprintByPos: Map<Position, number>,
): TradeCandidate[] {
  const out: TradeCandidate[] = [];
  const teamIds = (Object.keys(league.teams) as TeamId[]).sort();

  for (const buyerId of teamIds) {
    const buyer = league.teams[buyerId]!;
    if (!BUYER_WINDOWS.has(buyer.competitiveWindow)) continue;

    const buyerNeeds = positionDeficits(buyer, league, blueprintByPos);
    if (buyerNeeds.size === 0) continue;

    for (const [needPos] of buyerNeeds) {
      for (const sellerId of teamIds) {
        if (sellerId === buyerId) continue;
        const seller = league.teams[sellerId]!;

        const sellerStarsAndStarters = playersAtPosition(seller, league, needPos).filter(
          (p) => p.tier === 'STAR' || p.tier === 'STARTER',
        );
        if (sellerStarsAndStarters.length === 0) continue;

        const sellerCount = sellerStarsAndStarters.length;
        const blueprintCount = blueprintByPos.get(needPos) ?? 0;
        const hasSurplus = sellerCount > blueprintCount;
        const isRebuilder = REBUILD_WINDOWS.has(seller.competitiveWindow);
        if (!hasSurplus && !isRebuilder) continue;

        // Pick the player the seller would part with — prefer the
        // lowest-tier of the surplus (STARTER over STAR for surplus
        // case) and the worst-scheme-fit player for the rebuilder
        // case. STARs only move from rebuilders, not from teams
        // dumping surplus.
        const acquire = pickSellerOffering(
          sellerStarsAndStarters,
          seller,
          league,
          hasSurplus,
          isRebuilder,
        );
        if (!acquire) continue;
        if (!acquire.contractId) continue;
        const acquireContract = league.contracts[acquire.contractId];
        if (!acquireContract) continue;
        if (acquireContract.noTradeClause) continue;

        // Buyer + seller cap-safety filter. Both sides must have
        // comfortable cap room before the trade fires — see
        // PROACTIVE_TRADE_CAP_SAFETY for the rationale.
        const buyerCapRoom = league.salaryCap - teamCapUsage(buyer, league);
        const acquireHit = currentCapHit(acquireContract);
        if (buyerCapRoom < acquireHit + PROACTIVE_TRADE_CAP_SAFETY) continue;
        const sellerCapRoom = league.salaryCap - teamCapUsage(seller, league);
        if (sellerCapRoom < PROACTIVE_TRADE_CAP_SAFETY) continue;

        // Return piece — buyer's lowest-tier player at one of the
        // seller's hole positions, falling back to a body at any
        // position if the seller has no holes.
        const returnPiece = pickReturnPiece(buyer, seller, league, blueprintByPos);
        if (!returnPiece) continue;

        // 5-factor gate: both teams must perceive a positive net.
        const buyerEval = evaluateTradePackage(buyer, [acquire], [returnPiece], league);
        if (buyerEval.netValue <= 0) continue;
        const sellerEval = evaluateTradePackage(seller, [returnPiece], [acquire], league);
        if (sellerEval.netValue <= 0) continue;

        // Priority: sum of mutual gain in $M. Bigger total win for
        // both sides ranks higher.
        const priority = (buyerEval.netValue + sellerEval.netValue) * 10;

        out.push({
          buyerId,
          sellerId,
          acquireId: acquire.id,
          returnId: returnPiece.id,
          priority,
          kind: 'positional-need',
          buyerEval,
          sellerEval,
        });
      }
    }
  }
  return out;
}

/**
 * Pass 2: mutual scheme-fit swap. For each pair (X on A, Y on B) at
 * same position + same tier, where X is poor on A & good on B AND Y
 * is poor on B & good on A, propose the swap. Both rosters improve.
 */
function collectSchemeFitSwapCandidates(league: LeagueState): TradeCandidate[] {
  const out: TradeCandidate[] = [];

  // Build a list of all STAR/STARTER players with their team + fit on
  // current team. O(n) over the league's rostered talent.
  interface FitEntry {
    player: Player;
    teamId: TeamId;
    schemes: SchemePair;
    fitOnSelf: number;
  }
  const entries: FitEntry[] = [];
  for (const team of Object.values(league.teams)) {
    const hc = league.coaches[team.headCoachId];
    if (!hc) continue;
    const schemes: SchemePair = {
      offensiveScheme: hc.offensiveScheme,
      defensiveScheme: hc.defensiveScheme,
    };
    for (const playerId of team.rosterIds) {
      const player = league.players[playerId];
      if (!player) continue;
      if (player.tier !== 'STAR' && player.tier !== 'STARTER') continue;
      if (!player.contractId) continue;
      const contract = league.contracts[player.contractId];
      if (!contract || contract.noTradeClause) continue;
      const fit = schemeFitForPlayer(player, schemes);
      if (fit >= FIT_POOR) continue; // only interested in poor fits as candidates
      entries.push({
        player,
        teamId: team.identity.id,
        schemes,
        fitOnSelf: fit,
      });
    }
  }

  // Pair up poor-fit players who could swap. Symmetric — emit each
  // pair once, ordered by (teamA < teamB) so the buyer/seller roles
  // are stable; we'll always call team-A the "buyer" of player B and
  // vice versa. The pair is added once with buyerId = whichever team's
  // alphabetic id is smaller, just to keep sorting stable.
  for (let i = 0; i < entries.length; i++) {
    const a = entries[i]!;
    for (let j = i + 1; j < entries.length; j++) {
      const b = entries[j]!;
      if (a.teamId === b.teamId) continue;
      if (a.player.position !== b.player.position) continue;
      if (a.player.tier !== b.player.tier) continue;

      // Compute cross-team fits.
      const aOnB = schemeFitForPlayer(a.player, b.schemes);
      const bOnA = schemeFitForPlayer(b.player, a.schemes);
      if (aOnB < FIT_GOOD || bOnA < FIT_GOOD) continue;

      // Pick the canonical buyer/seller orientation by TeamId so
      // priority sort is stable. The trade is symmetric; the labels
      // are arbitrary.
      const [buyerId, sellerId, acquire, returnPlayer] =
        a.teamId < b.teamId
          ? [a.teamId, b.teamId, b.player, a.player]
          : [b.teamId, a.teamId, a.player, b.player];

      // Cap-safety: both sides need comfortable cap room before the
      // swap. Even a same-tier swap accrues dead money from both
      // outgoing players' remaining proration, which can pin a team.
      const buyerTeam = league.teams[buyerId]!;
      const sellerTeam = league.teams[sellerId]!;
      const buyerRoom = league.salaryCap - teamCapUsage(buyerTeam, league);
      const sellerRoom = league.salaryCap - teamCapUsage(sellerTeam, league);
      if (buyerRoom < PROACTIVE_TRADE_CAP_SAFETY) continue;
      if (sellerRoom < PROACTIVE_TRADE_CAP_SAFETY) continue;

      // 5-factor gate: both teams must perceive a positive net even
      // for the scheme-fit swap. Usually they will (each gets a player
      // they value highly + ships out one they value less). Reuse the
      // buyerTeam/sellerTeam locals declared above for cap-safety.
      const buyerEval = evaluateTradePackage(buyerTeam, [acquire], [returnPlayer], league);
      if (buyerEval.netValue <= 0) continue;
      const sellerEval = evaluateTradePackage(sellerTeam, [returnPlayer], [acquire], league);
      if (sellerEval.netValue <= 0) continue;

      // Priority: sum of mutual gain. Add a fixed bonus so scheme-fit
      // swaps slightly outrank positional-need trades at equivalent
      // gain — they're the more interesting narrative beat.
      const priority = 200 + (buyerEval.netValue + sellerEval.netValue) * 10;

      out.push({
        buyerId,
        sellerId,
        acquireId: acquire.id,
        returnId: returnPlayer.id,
        priority,
        kind: 'scheme-fit-swap',
        buyerEval,
        sellerEval,
      });
    }
  }
  return out;
}

/**
 * Compute positional deficits for a team — positions where they have
 * fewer STAR+STARTER bodies than the blueprint asks for. Returns the
 * map of position -> deficit, only populated for positions with > 0
 * deficit.
 */
function positionDeficits(
  team: TeamState,
  league: LeagueState,
  blueprintByPos: Map<Position, number>,
): Map<Position, number> {
  const counts = new Map<Position, number>();
  for (const playerId of team.rosterIds) {
    const player = league.players[playerId];
    if (!player) continue;
    if (player.tier !== 'STAR' && player.tier !== 'STARTER') continue;
    counts.set(player.position, (counts.get(player.position) ?? 0) + 1);
  }
  const deficits = new Map<Position, number>();
  for (const [pos, blueprint] of blueprintByPos) {
    const have = counts.get(pos) ?? 0;
    const deficit = blueprint - have;
    if (deficit > 0) deficits.set(pos, deficit);
  }
  return deficits;
}

function playersAtPosition(
  team: TeamState,
  league: LeagueState,
  position: Position,
): Player[] {
  const out: Player[] = [];
  for (const playerId of team.rosterIds) {
    const player = league.players[playerId];
    if (player && player.position === position) out.push(player);
  }
  return out;
}

/**
 * Pick which player the seller will offer up. For surplus sellers,
 * give up a STARTER (not a STAR) — they're shedding depth, not their
 * best player. For rebuilders, give up the player with the worst
 * scheme fit on their roster — they're shedding pieces that don't
 * fit the new coaching direction.
 */
function pickSellerOffering(
  candidates: Player[],
  seller: TeamState,
  league: LeagueState,
  hasSurplus: boolean,
  isRebuilder: boolean,
): Player | null {
  if (candidates.length === 0) return null;

  if (hasSurplus && !isRebuilder) {
    // Surplus only — give up the lowest-tier STAR/STARTER (i.e. a
    // STARTER if any exist). Tiebreak by PlayerId.
    const starters = candidates.filter((p) => p.tier === 'STARTER');
    if (starters.length > 0) {
      starters.sort((a, b) => (a.id < b.id ? -1 : 1));
      return starters[0]!;
    }
    return null;
  }

  // Rebuilder branch — even STARs are in play. Prefer the worst
  // scheme fit on the seller's current scheme (this is the
  // Sweat-for-Johnson logic dropped into the positional-need pass
  // — a rebuilder will gladly ship a player who doesn't fit their
  // new direction).
  const hc = league.coaches[seller.headCoachId];
  if (!hc) return null;
  const schemes: SchemePair = {
    offensiveScheme: hc.offensiveScheme,
    defensiveScheme: hc.defensiveScheme,
  };
  candidates.sort((a, b) => {
    const fitA = schemeFitForPlayer(a, schemes);
    const fitB = schemeFitForPlayer(b, schemes);
    if (fitA !== fitB) return fitA - fitB; // worst fit first
    if (a.tier !== b.tier) return TIER_RANK[b.tier] - TIER_RANK[a.tier]; // lower-tier first
    return a.id < b.id ? -1 : 1;
  });
  return candidates[0]!;
}

/**
 * Return piece from the buyer — a lower-tier player at one of the
 * seller's hole positions if possible, falling back to the buyer's
 * lowest-tier player at any position.
 */
function pickReturnPiece(
  buyer: TeamState,
  seller: TeamState,
  league: LeagueState,
  blueprintByPos: Map<Position, number>,
): Player | null {
  const sellerHoles = positionDeficits(seller, league, blueprintByPos);

  // Build the buyer's candidate return pool — BACKUP/FRINGE only,
  // contracted, no NTC. STARs/STARTERs aren't sent back in the MVP;
  // the Sweat-for-Johnson swap goes through Pass 2 instead.
  const pool: Player[] = [];
  for (const playerId of buyer.rosterIds) {
    const player = league.players[playerId];
    if (!player) continue;
    if (player.tier !== 'BACKUP' && player.tier !== 'FRINGE') continue;
    if (!player.contractId) continue;
    const contract = league.contracts[player.contractId];
    if (!contract || contract.noTradeClause) continue;
    pool.push(player);
  }
  if (pool.length === 0) return null;

  // Prefer a player at one of the seller's hole positions.
  const fillsHole = pool.filter((p) => sellerHoles.has(p.position));
  const pick = fillsHole.length > 0 ? fillsHole : pool;
  pick.sort((a, b) => {
    if (a.tier !== b.tier) return TIER_RANK[b.tier] - TIER_RANK[a.tier]; // FRINGE before BACKUP
    return a.id < b.id ? -1 : 1;
  });
  return pick[0]!;
}

/**
 * Re-check a candidate against current state. A prior trade in the
 * same call may have moved one of the players or pushed a team's cap.
 */
function tradeStillValid(league: LeagueState, c: TradeCandidate): boolean {
  const buyer = league.teams[c.buyerId];
  const seller = league.teams[c.sellerId];
  if (!buyer || !seller) return false;
  if (!seller.rosterIds.includes(c.acquireId)) return false;
  if (!buyer.rosterIds.includes(c.returnId)) return false;
  const acquire = league.players[c.acquireId];
  const returnPlayer = league.players[c.returnId];
  if (!acquire?.contractId || !returnPlayer?.contractId) return false;
  const acquireContract = league.contracts[acquire.contractId];
  const returnContract = league.contracts[returnPlayer.contractId];
  if (!acquireContract || !returnContract) return false;
  if (acquireContract.noTradeClause || returnContract.noTradeClause) return false;
  // Cap-safety guard. See PROACTIVE_TRADE_CAP_SAFETY rationale.
  const buyerCapRoom = league.salaryCap - teamCapUsage(buyer, league);
  const acquireHit = currentCapHit(acquireContract);
  const returnHit = currentCapHit(returnContract);
  if (buyerCapRoom < acquireHit - returnHit + PROACTIVE_TRADE_CAP_SAFETY) return false;
  const sellerCapRoom = league.salaryCap - teamCapUsage(seller, league);
  if (sellerCapRoom < PROACTIVE_TRADE_CAP_SAFETY) return false;
  return true;
}
