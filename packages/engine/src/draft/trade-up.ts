/**
 * Draft trade-up firing — Doc 3 war-room trade activity, slice 1.
 *
 * Per-pick check inside `runDraft`: identifies the team further down
 * the round most desperate to leapfrog the on-clock team for the same
 * top-of-board prospect, builds a chart-fair offer (current-round
 * pick + minimum future-year sweetener picks via the Doc 5 chart),
 * and accepts if the on-clock team comes out at ratio >= 1.0.
 *
 * Slice 1 scope deliberately narrow:
 *   - Top-10 slots only — Doc 5 explicitly calls out early R1 as the
 *     trade-up zone.
 *   - At most 3 trade-ups per draft — real NFL R1 typically sees
 *     2-4; cap prevents pathological chains.
 *   - Compensation is future-year picks only, not cross-round picks
 *     within the same draft. Keeps the asset-state mutation tight:
 *     same-round swaps stay inside `runDraft`'s working list, future
 *     swaps propagate to `LeagueState.draftPicks` via the result.
 *   - At most 2 future picks per offer.
 *   - Static base chart only. Doc 5's dynamic situational modifiers
 *     (coaching hot-seat, GM desperation, owner pressure, QB premium)
 *     are a separate follow-on slice that will tune both desire AND
 *     acceptance bands.
 */

import type {
  CollegePlayer,
  DraftBoardEntry,
  DraftPickAsset,
} from '../types/college.js';
import type { TeamId, DraftPickId, PlayerId } from '../types/ids.js';
import { pickValue as basePickValue } from './pick-value.js';

/**
 * Max trade-ups allowed in a single draft. Real NFL R1 trade-up
 * counts typically range 2-4. 3 is the median; future slices can
 * stretch this for chaotic markets (post-coaching-change leagues,
 * high-aggression GMs) once dynamic modifiers land.
 */
export const MAX_TRADE_UPS_PER_DRAFT = 3;

/**
 * Only consider trade-ups into a target slot at or above this overall
 * pick number. Doc 5: "Trade-ups in Round 1, especially top 10,
 * consistently show teams overpaying by 20-58%." Outside the top 10
 * the chart premium isn't worth the future capital in NFL practice;
 * mid-to-late R1 sees swaps but not many move-ups.
 */
export const TRADE_UP_TARGET_SLOT_CEILING = 10;

/** Max future-year picks a trading-up team will include as sweetener. */
export const MAX_FUTURE_PICKS_PER_OFFER = 2;

/**
 * Trade-up acceptance band from the on-clock team's perspective.
 * 1.0 means receiving total chart value equals giving — anything
 * below and the on-clock team refuses. Higher than 1.0 is an
 * over-pay the trading-up team voluntarily makes to close the gap
 * (Doc 5's "16-20% premium to move up in the early first round" is
 * baked into HOW MUCH gets offered, not into the acceptance threshold
 * — the trading-up team pays as much as it takes to get past 1.0).
 */
const ACCEPTANCE_RATIO_FLOOR = 1.0;

/**
 * Future-pick value heuristic: when a trading-up team offers a R2
 * future pick to a team that doesn't know that team's future
 * standing, both sides converge on the round midpoint. Real NFL trade
 * negotiations use the trading-up team's projected slot, but for a
 * static-chart slice midpoint-by-round is honest enough; future
 * dynamic-modifier slices can refine using competitive-window
 * projections.
 */
const ROUND_MIDPOINT_OVERALL_PICK: Readonly<Record<number, number>> = {
  1: 16,
  2: 48,
  3: 80,
  4: 112,
  5: 144,
  6: 176,
  7: 224,
};

/**
 * A trade-up proposal under consideration — not yet applied. Pure
 * data. Caller resolves asset ids against the working asset list +
 * the league-wide draft-pick array.
 */
export interface TradeUpProposal {
  onClockTeamId: TeamId;
  onClockAssetId: DraftPickId;
  tradingUpTeamId: TeamId;
  /** Trading-up team's pick that moves to the on-clock team (same round, this draft). */
  swapAssetId: DraftPickId;
  /** Future-year picks (different `seasonNumber`) that flip ownership to on-clock team. */
  futurePickIds: readonly DraftPickId[];
  /** Prospect that triggered the trade-up — top of both boards. */
  targetCollegePlayerId: PlayerId;
  /** receivingValue / givingValue from on-clock team's perspective (>= 1.0 to accept). */
  ratio: number;
}

/**
 * A trade-up that fired during a draft. Returned in `DraftRunResult`
 * so `applyDraftResult` can propagate future-pick ownership changes
 * to `LeagueState.draftPicks` and so the inspector can replay each
 * draft's trade history.
 */
export interface TradeUpRecord {
  seasonNumber: number;
  round: number;
  /** Slot the on-clock pick occupied (the slot the trading-up team acquired). */
  overallPick: number;
  onClockTeamId: TeamId;
  onClockAssetId: DraftPickId;
  tradingUpTeamId: TeamId;
  swapAssetId: DraftPickId;
  /** Future-year pick assets that flipped from trading-up team to on-clock team. */
  futurePickIds: readonly DraftPickId[];
  targetCollegePlayerId: PlayerId;
  ratio: number;
}

export interface EvaluateTradeUpArgs {
  /** Index of the on-clock pick in the round's working asset list. */
  onClockIndex: number;
  /** Overall pick number for the on-clock slot. */
  overallPick: number;
  /** Round currently firing (1..7). */
  round: number;
  /** Current draft's season number. */
  seasonNumber: number;
  /** Working copy of this round's pick assets — currentTeamId may already differ from original. */
  workingRoundAssets: readonly DraftPickAsset[];
  /** Per-team draft boards (50-deep, scheme-aware). */
  draftBoards: Readonly<Record<TeamId, readonly DraftBoardEntry[]>>;
  /** Prospects still available in this draft (declared + eligible + unpicked). */
  availableById: ReadonlyMap<PlayerId, CollegePlayer>;
  /** Full league-wide draft-pick array — used to look up trading-up team's future picks. */
  fullDraftPicks: readonly DraftPickAsset[];
  /** How many trade-ups have already fired in this draft. */
  tradeUpsFiredSoFar: number;
}

/**
 * Find the best trade-up offer for the team on the clock. Returns
 * null when no team further down the round wants to move up enough
 * to construct a chart-fair offer.
 *
 * Selection: among teams whose own top-board still-available prospect
 * matches the on-clock team's top-board still-available prospect, the
 * team with the HIGHEST priority on that prospect wins. Highest
 * priority = most desperate to land him = most willing to over-pay.
 */
export function evaluateTradeUpForPick(args: EvaluateTradeUpArgs): TradeUpProposal | null {
  if (args.overallPick > TRADE_UP_TARGET_SLOT_CEILING) return null;
  if (args.tradeUpsFiredSoFar >= MAX_TRADE_UPS_PER_DRAFT) return null;

  const onClockAsset = args.workingRoundAssets[args.onClockIndex];
  if (!onClockAsset) return null;
  const onClockTeamId = onClockAsset.currentTeamId;
  const onClockBoard = args.draftBoards[onClockTeamId] ?? [];
  const onClockTopTarget = findTopAvailable(onClockBoard, args.availableById);
  if (!onClockTopTarget) return null;

  const targetPlayerId = onClockTopTarget.entry.collegePlayerId;

  // Sweep teams picking AFTER the on-clock slot. Highest priority on
  // the same target wins (most desperate).
  let bestCandidate: {
    teamId: TeamId;
    asset: DraftPickAsset;
    swapOverallPick: number;
    candidatePriority: number;
  } | null = null;

  for (let j = args.onClockIndex + 1; j < args.workingRoundAssets.length; j++) {
    const asset = args.workingRoundAssets[j]!;
    const candidateBoard = args.draftBoards[asset.currentTeamId] ?? [];
    const candidateTop = findTopAvailable(candidateBoard, args.availableById);
    if (!candidateTop) continue;
    if (candidateTop.entry.collegePlayerId !== targetPlayerId) continue;
    const swapOverallPick = args.overallPick + (j - args.onClockIndex);
    if (
      !bestCandidate ||
      candidateTop.entry.priority > bestCandidate.candidatePriority
    ) {
      bestCandidate = {
        teamId: asset.currentTeamId,
        asset,
        swapOverallPick,
        candidatePriority: candidateTop.entry.priority,
      };
    }
  }

  if (!bestCandidate) return null;

  const offer = buildOffer({
    onClockOverallPick: args.overallPick,
    swapAssetOverallPick: bestCandidate.swapOverallPick,
    seasonNumber: args.seasonNumber,
    tradingUpTeamId: bestCandidate.teamId,
    fullDraftPicks: args.fullDraftPicks,
  });
  if (!offer) return null;

  return {
    onClockTeamId,
    onClockAssetId: onClockAsset.id,
    tradingUpTeamId: bestCandidate.teamId,
    swapAssetId: bestCandidate.asset.id,
    futurePickIds: offer.futurePickIds,
    targetCollegePlayerId: targetPlayerId,
    ratio: offer.ratio,
  };
}

/**
 * Apply a trade-up's same-round ownership flips to a mutable
 * working-asset list. Future-pick flips live on the resulting
 * `TradeUpRecord` and are applied by `applyDraftResult` against
 * `LeagueState.draftPicks` (because future picks aren't in the
 * current round's asset list).
 */
export function applyTradeUpToWorkingAssets(
  workingAssets: DraftPickAsset[],
  proposal: TradeUpProposal,
): void {
  for (let i = 0; i < workingAssets.length; i++) {
    const a = workingAssets[i]!;
    if (a.id === proposal.onClockAssetId) {
      workingAssets[i] = { ...a, currentTeamId: proposal.tradingUpTeamId };
    } else if (a.id === proposal.swapAssetId) {
      workingAssets[i] = { ...a, currentTeamId: proposal.onClockTeamId };
    }
  }
}

// ─── internals ─────────────────────────────────────────────────────────

function findTopAvailable(
  board: readonly DraftBoardEntry[],
  availableById: ReadonlyMap<PlayerId, CollegePlayer>,
): { entry: DraftBoardEntry; rank: number } | null {
  for (let r = 0; r < board.length; r++) {
    const entry = board[r]!;
    if (availableById.has(entry.collegePlayerId)) {
      return { entry, rank: r + 1 };
    }
  }
  return null;
}

interface BuildOfferArgs {
  onClockOverallPick: number;
  swapAssetOverallPick: number;
  seasonNumber: number;
  tradingUpTeamId: TeamId;
  fullDraftPicks: readonly DraftPickAsset[];
}

function buildOffer(
  args: BuildOfferArgs,
): { futurePickIds: DraftPickId[]; ratio: number } | null {
  const onClockValue = basePickValue(args.onClockOverallPick, 0);
  const swapValue = basePickValue(args.swapAssetOverallPick, 0);
  if (onClockValue <= 0) return null;
  const gap = onClockValue - swapValue;
  if (gap <= 0) {
    // Swap pick is already worth more than the on-clock pick — would
    // be a trade DOWN, not a trade up. Should not happen given the
    // caller filters by slot order, but guard anyway.
    return null;
  }

  // Trading-up team's owned future picks, sorted ascending by chart
  // value so the greedy sweep adds the smallest sweetener first
  // (minimizes over-pay).
  const futurePool = args.fullDraftPicks
    .filter(
      (p) =>
        p.currentTeamId === args.tradingUpTeamId &&
        p.seasonNumber > args.seasonNumber,
    )
    .map((p) => ({
      pick: p,
      value: futurePickHeuristicValue(p, args.seasonNumber),
    }))
    .filter((x) => x.value > 0)
    .sort((a, b) => a.value - b.value);

  const chosenIds: DraftPickId[] = [];
  let totalSweetener = 0;
  for (const f of futurePool) {
    if (chosenIds.length >= MAX_FUTURE_PICKS_PER_OFFER) break;
    chosenIds.push(f.pick.id);
    totalSweetener += f.value;
    if (totalSweetener >= gap) break;
  }

  const totalReceived = swapValue + totalSweetener;
  const ratio = totalReceived / onClockValue;
  if (ratio < ACCEPTANCE_RATIO_FLOOR) return null;

  return { futurePickIds: chosenIds, ratio };
}

/**
 * Chart value of a future pick using the round-midpoint slot
 * heuristic (we don't know what slot a future pick will land in
 * because next-year standings haven't been computed). Picks beyond
 * round 7 fall through to 0; only rounds 1-7 are tradeable.
 */
function futurePickHeuristicValue(
  pick: DraftPickAsset,
  currentDraftSeason: number,
): number {
  const midpoint = ROUND_MIDPOINT_OVERALL_PICK[pick.round];
  if (midpoint === undefined) return 0;
  const yearsOut = pick.seasonNumber - currentDraftSeason;
  return basePickValue(midpoint, yearsOut);
}
