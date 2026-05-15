import type { LeagueState } from '../types/league.js';
import type { Player } from '../types/player.js';
import type { PlayerId, TeamId } from '../types/ids.js';
import type { Position } from '../types/enums.js';
import type { Prng } from '../prng/index.js';
import { ROSTER_BLUEPRINT_53 } from '../players/roster-blueprint.js';
import { teamCapUsage, currentCapHit } from '../contracts/cap.js';
import { executeTrade } from './trade.js';
import { MOOD_BASELINE } from '../season/mood.js';
import {
  evaluateTradePackage,
  type TradePackageEvaluation,
} from '../trade/value.js';

/**
 * Run one weekly pass of NPC-driven trades for players who have an
 * outstanding trade request (`Player.tradeRequestedOnTick !== null`).
 *
 * Each open request gets at most one matchmaking attempt per call:
 *
 *   1. Skip if the player isn't on their team's active roster (might
 *      have ended up on IR / PS since the request fired).
 *   2. Score the other 31 teams by position need at the player's
 *      position. Teams with a STAR/STARTER deficit at that position
 *      are candidates; teams already at-or-over depth are skipped.
 *   3. The buyer with the deepest need and enough cap room wins.
 *      Tiebreak by TeamId so the pass is deterministic.
 *   4. The return piece is the buyer's lowest-tier player at the same
 *      position (a backup the buyer is happy to part with).
 *   5. Execute via `executeTrade` with `overrideNoTrade: true` — once a
 *      player has formally demanded a trade, NTC pressure is moot.
 *   6. Post-trade: the requesting player's mood resets to baseline and
 *      their `tradeRequestedOnTick` clears. "Wish granted."
 *
 * Caps: at most one trade per seller team per week, and at most one
 * trade per buyer team per week. Multiple open requests at the same
 * club still get processed sequentially against fresh league state,
 * but the same-team cap prevents one team absorbing the whole league's
 * disgruntled players in a single Sunday.
 *
 * Determinism: pure of the supplied PRNG; the PRNG handle is taken for
 * future tiebreak randomization but not used in v0.17.0.
 */
export function runWeeklyNpcTrades(
  prng: Prng,
  league: LeagueState,
  tick: number,
): LeagueState {
  void prng; // reserved
  void tick; // reserved — trade execution stamps with league.tick already

  // Snapshot all open trade requests in deterministic order: oldest
  // request first (festering frustration trumps fresh demands), then
  // by playerId for ties.
  const open: { playerId: PlayerId; teamId: TeamId; requestedOnTick: number }[] = [];
  for (const player of Object.values(league.players)) {
    if (player.tradeRequestedOnTick === null) continue;
    if (player.teamId === null) continue;
    open.push({
      playerId: player.id,
      teamId: player.teamId,
      requestedOnTick: player.tradeRequestedOnTick,
    });
  }
  open.sort((a, b) => {
    if (a.requestedOnTick !== b.requestedOnTick) return a.requestedOnTick - b.requestedOnTick;
    return a.playerId < b.playerId ? -1 : 1;
  });
  if (open.length === 0) return league;

  const blueprintByPos = new Map<Position, number>();
  for (const slot of ROSTER_BLUEPRINT_53) blueprintByPos.set(slot.position, slot.count);

  const sellersUsed = new Set<TeamId>();
  const buyersUsed = new Set<TeamId>();
  let working = league;

  for (const { playerId, teamId: sellerId } of open) {
    if (sellersUsed.has(sellerId)) continue;
    const seller = working.teams[sellerId];
    if (!seller) continue;
    if (!seller.rosterIds.includes(playerId)) continue;
    const player = working.players[playerId];
    if (!player) continue;
    if (player.contractId === null) continue;
    const contract = working.contracts[player.contractId];
    if (!contract) continue;

    const match = findBuyer(working, sellerId, player, buyersUsed, blueprintByPos);
    if (!match) continue;

    try {
      working = executeTrade(working, {
        teamAId: sellerId,
        teamBId: match.buyerId,
        playersAToB: [playerId],
        playersBToA: [match.returnPieceId],
        overrideNoTrade: true,
        metadata: {
          // Initiator is the buyer — they're the one filling a hole;
          // the seller is essentially in fire-sale mode honoring an
          // open trade request.
          initiatorTeamId: match.buyerId,
          source: 'request-driven',
          // teamA = seller in this orientation.
          teamAValue: match.sellerEval,
          teamBValue: match.buyerEval,
        },
      });
    } catch {
      // executeTrade enforces invariants; if our chosen match falls foul
      // of one (e.g. a contract was modified between selection and
      // execution by a prior iteration), skip rather than fail the pass.
      continue;
    }

    // Wish granted: clear the trade flag and reset mood to baseline on
    // the newly traded player. They keep their other state.
    const moved = working.players[playerId]!;
    working = {
      ...working,
      players: {
        ...working.players,
        [playerId]: { ...moved, mood: MOOD_BASELINE, tradeRequestedOnTick: null },
      },
    };
    sellersUsed.add(sellerId);
    buyersUsed.add(match.buyerId);
  }

  return working;
}

interface BuyerMatch {
  buyerId: TeamId;
  returnPieceId: PlayerId;
  need: number;
  /** Buyer's perceived value of the swap (acquire requester, ship return piece). */
  buyerEval: TradePackageEvaluation;
  /** Seller's perceived value of the swap (acquire return piece, ship requester). */
  sellerEval: TradePackageEvaluation;
}

/**
 * Pick the team with the deepest STAR/STARTER deficit at the requesting
 * player's position. Buyer must have cap room for the incoming
 * contract's current cap hit and own at least one tradeable player at
 * that position to send back. Returns null if no qualifying buyer
 * exists this tick.
 */
function findBuyer(
  league: LeagueState,
  sellerId: TeamId,
  requester: Player,
  buyersUsed: Set<TeamId>,
  blueprintByPos: Map<Position, number>,
): BuyerMatch | null {
  const target = blueprintByPos.get(requester.position) ?? 1;
  const requesterCapHit = currentCapHit(
    league.contracts[requester.contractId!]!,
  );

  let best: BuyerMatch | null = null;
  const teamIds = (Object.keys(league.teams) as TeamId[]).sort();
  for (const buyerId of teamIds) {
    if (buyerId === sellerId) continue;
    if (buyersUsed.has(buyerId)) continue;
    const buyer = league.teams[buyerId]!;

    const buyerRoster = buyer.rosterIds
      .map((id) => league.players[id])
      .filter((p): p is Player => Boolean(p));
    const atPos = buyerRoster.filter((p) => p.position === requester.position);
    const upperTier = atPos.filter(
      (p) => p.tier === 'STAR' || p.tier === 'STARTER',
    ).length;
    const need = target - upperTier;
    if (need <= 0) continue;

    // Cap fit: the buyer takes on a fresh contract mirroring requester's
    // remaining base (no signing bonus on trade-receive). Approximate
    // by the current-year cap hit — close enough for the buyer-side
    // accept/reject heuristic; the actual cap math is enforced by
    // executeTrade downstream.
    const buyerCapRoom = league.salaryCap - teamCapUsage(buyer, league);
    if (buyerCapRoom < requesterCapHit) continue;

    // Return piece: lowest-tier at the same position, no NTC issue
    // (we override anyway). Prefer BACKUP/FRINGE so the deal is the
    // "we're getting a star, you're losing depth" trope.
    const tierRank: Record<Player['tier'], number> = {
      STAR: 0,
      STARTER: 1,
      BACKUP: 2,
      FRINGE: 3,
    };
    const returnCandidates = atPos
      .filter((p) => p.contractId !== null)
      .sort((a, b) => tierRank[b.tier] - tierRank[a.tier]);
    const returnPiece = returnCandidates[0];
    if (!returnPiece) continue;

    // 5-factor evaluation from both sides. The seller has an open
    // trade request (player is wants_out) so they're motivated to
    // move regardless of pure value math — `runWeeklyNpcTrades` is
    // wish-granting, not value-optimizing. We still record the
    // seller's evaluation so the inspector can show the asymmetry.
    const seller = league.teams[sellerId]!;
    const buyerEval = evaluateTradePackage(buyer, [requester], [returnPiece], league);
    const sellerEval = evaluateTradePackage(seller, [returnPiece], [requester], league);
    // Buyer must perceive a positive net — otherwise no one accepts.
    if (buyerEval.netValue <= 0) continue;

    if (!best || need > best.need || (need === best.need && buyerId < best.buyerId)) {
      best = {
        buyerId,
        returnPieceId: returnPiece.id,
        need,
        buyerEval,
        sellerEval,
      };
    }
  }
  return best;
}
