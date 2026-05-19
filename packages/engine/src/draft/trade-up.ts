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
  TradeUpRecord,
} from '../types/college.js';
import type { TeamId, DraftPickId, PlayerId } from '../types/ids.js';
import { pickValue as basePickValue } from './pick-value.js';
import {
  pickValueForTeam,
  NEUTRAL_MODIFIERS,
  QB_CURRENT_PICK_PREMIUM,
  type ChartModifiers,
} from './chart-modifiers.js';

/**
 * One team's per-team chart context — modifiers + per-GM QB premium.
 * Bundled together because they're both per-team values consumed by
 * the same pickValueForTeam call. Callers pre-compute these once
 * per draft and pass them in via `teamContexts`.
 */
export interface TeamChartContext {
  modifiers: ChartModifiers;
  qbPremium: number;
}

/**
 * Trading-up team's acceptance floor — they refuse to construct an
 * offer where, from their own chart's perspective, they're giving
 * up more than 1/floor in chart value vs what they're receiving.
 *
 * Round-dependent (v0.52): R1 floor is 0.65 (max ~54% over-pay,
 * within Doc 5's "20-58% premium for early R1" observation), late
 * rounds at 0.5 (cheaper picks, smaller absolute cost — over-pay
 * tolerance can be looser). R1's higher floor naturally throttles
 * R1 fire rate into Daniel's observed 6-18 per draft band without
 * starving the mid- and late-round trade activity.
 */
const TRADING_UP_ACCEPTANCE_FLOOR_BY_ROUND: Record<number, number> = {
  1: 0.80,
  2: 0.65,
  3: 0.55,
  4: 0.5,
  5: 0.45,
  6: 0.4,
  7: 0.4,
};
const TRADING_UP_ACCEPTANCE_FLOOR_DEFAULT = 0.5;

/**
 * Max trade-ups allowed across the entire draft. v0.52 raises this
 * from 3 → 250 (effectively uncapped) after Daniel's observation:
 * real NFL drafts produce ~140 trade-ups per cycle (R1: 6-18, late
 * rounds heavier due to wider board divergence + abundant pick
 * inventory). The 3-cap was a placeholder; the natural rate-limiter
 * is per-team pick inventory + the trading-up team's own
 * acceptance floor.
 */
export const MAX_TRADE_UPS_PER_DRAFT = 250;

/**
 * Slot ceiling: v0.45 capped trade-ups to the top-10 slot range
 * citing Doc 5 ("trade-ups in early R1 overpay 20-58%"). Removing
 * for v0.52 — Daniel's observed-NFL-frequency target (~140/draft)
 * requires firing through all 7 rounds. Late rounds in particular
 * see denser trade activity (per-team boards diverge most there).
 * Keep the constant exported for back-compat with anyone reading
 * the v0.45 cap explicitly; set to 999 so the guard is effectively
 * inert.
 */
export const TRADE_UP_TARGET_SLOT_CEILING = 999;

/**
 * Maximum board depth at which the on-clock team's top-K still-
 * available entries count as "at-risk" for trade-up purposes. A
 * candidate team's top entry must be in this band to qualify as
 * a trade-up partner. Round-dependent (v0.52): R1 is narrowest
 * (only the most-coveted prospects trigger fires — R1 picks are
 * precious), late rounds widest (board variance is high; many
 * prospects sit in many teams' top-N).
 *
 * Targets Daniel's observed NFL shape: R1 ~12 fires, late rounds
 * cluster. v0.45 used K=1 globally; the widened late-round bands
 * unlock the dense late-round trade activity.
 */
const TRADE_UP_AT_RISK_DEPTH_BY_ROUND: Record<number, number> = {
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 5,
  7: 5,
};
const TRADE_UP_AT_RISK_DEPTH_DEFAULT = 3;

/**
 * Per-team cap: how many times can the same team be the
 * trading-up side in one draft? Real NFL teams rarely trade up
 * more than 2-3 times per draft (limited by pick inventory). 5 is
 * loose enough to let aggressive GMs cluster without producing a
 * single team monopolizing the trade volume.
 */
export const MAX_TRADE_UPS_PER_TEAM = 4;

/**
 * Max future-year picks a trading-up team will include as sweetener.
 * v0.45 cap of 2 made R1 trade-ups nearly impossible. v0.52 raised
 * to 4 to unlock R1 deals, but a side effect was too many late-round
 * trade-ups bundling 3-4 future picks (rare in real NFL). v0.55
 * drops to 2 — Stage 1 (single pick clears gap) handles most cases
 * including R1 (1 future R1 mid-pick = ~3950 pts, plenty for typical
 * R1 gaps). Stage 2 bundles only when one pick can't span the gap;
 * a 2-pick cap keeps that scenario rare and authentic.
 */
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

// TradeUpRecord moved to types/college.ts (v0.52) so LeagueState can
// reference it. Re-exported from draft/index.ts as part of the
// public draft surface; imported above.
export type { TradeUpRecord };

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
  /**
   * How many trade-ups each team has already initiated as the
   * trading-up side. Used to enforce `MAX_TRADE_UPS_PER_TEAM` so
   * one aggressive team doesn't monopolize draft trade volume.
   * Optional for back-compat; defaults to no per-team cap.
   */
  tradeUpsByTeamSoFar?: ReadonlyMap<TeamId, number>;
  /**
   * On-clock team's per-team chart modifiers (Doc 5 dynamic
   * situational adjustments). Drives both the ratio calculation and
   * the sweetener selection — a rebuilder values incoming future
   * picks more, a championship team less. Optional for back-compat
   * with callers that haven't computed modifiers yet; defaults to
   * `NEUTRAL_MODIFIERS` (1.0 / 1.0) which reproduces the v0.45
   * static-chart behavior exactly.
   *
   * Superseded by `teamContexts[onClockTeamId]` when both are
   * provided — the bundled context includes the per-GM QB premium
   * which loose-arg `onClockModifiers` cannot carry.
   */
  onClockModifiers?: ChartModifiers;
  /**
   * Per-team chart context (modifiers + per-GM QB premium) for
   * every team in the league (v0.49+). When provided, the evaluator
   * uses it for BOTH the on-clock team AND the trading-up team —
   * enabling the trading-up acceptance floor (offer-side cap on
   * over-pay) and the per-team QB-premium asymmetry.
   *
   * Optional for back-compat; when omitted the evaluator falls back
   * to `onClockModifiers` for the on-clock side and skips the
   * trading-up perspective check entirely (slice-1 v0.46 behavior).
   */
  teamContexts?: Readonly<Record<TeamId, TeamChartContext>>;
}

/**
 * Find the best trade-up offer for the team on the clock. Returns
 * null when no team further down the round wants to move up enough
 * to construct a chart-fair offer.
 *
 * v0.52 selection model: the on-clock team's top-K still-available
 * board entries (`TRADE_UP_AT_RISK_DEPTH`, default 20) define the
 * "at-risk" set. Any team picking later whose own top-available
 * prospect sits in that set is a potential trade-up partner — they
 * lose access to a prospect they value highly if on-clock takes
 * them. Among those candidates, the highest THEIR-board priority
 * wins (most desperate = most willing to over-pay).
 *
 * v0.45 model used K=1 (strict same-#1 match), which was too narrow
 * — only ~1 trade per draft when Daniel expects ~140. K=20 captures
 * the realistic "we want this guy badly and so do they" overlap
 * without firing trades for low-stakes prospects neither team
 * cares about.
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

  // On-clock's intended target = their #1 still-available. Used
  // only to populate the at-risk set; the trade-up's actual target
  // is the CANDIDATE'S top (which they'll pick after the swap).
  // QB premium evaluation defers until after we've selected the
  // candidate.
  void onClockTopTarget;

  // On-clock chart context: prefer the bundled v0.49 teamContexts
  // form (includes per-GM QB premium) over the legacy onClockModifiers
  // arg (modifiers-only); fall back to NEUTRAL.
  const onClockContext: TeamChartContext = args.teamContexts?.[onClockTeamId] ?? {
    modifiers: args.onClockModifiers ?? NEUTRAL_MODIFIERS,
    qbPremium: QB_CURRENT_PICK_PREMIUM,
  };

  // Build the "at-risk" set: on-clock team's top-K still-available
  // board entries. K is round-dependent so R1 stays narrow (only
  // top-of-class prospects trigger fires) while late rounds widen
  // to capture board-divergence opportunities.
  const atRiskDepth =
    TRADE_UP_AT_RISK_DEPTH_BY_ROUND[args.round] ?? TRADE_UP_AT_RISK_DEPTH_DEFAULT;
  const atRiskIds = new Set<PlayerId>();
  {
    let count = 0;
    for (const entry of onClockBoard) {
      if (count >= atRiskDepth) break;
      if (args.availableById.has(entry.collegePlayerId)) {
        atRiskIds.add(entry.collegePlayerId);
        count++;
      }
    }
  }

  // Sweep teams picking AFTER the on-clock slot. Skip teams that
  // have already maxed their trade-up budget. Pick the candidate
  // with highest THEIR-board priority on the prospect they're
  // chasing.
  let bestCandidate: {
    teamId: TeamId;
    asset: DraftPickAsset;
    swapOverallPick: number;
    candidatePriority: number;
    candidateTargetId: PlayerId;
  } | null = null;

  for (let j = args.onClockIndex + 1; j < args.workingRoundAssets.length; j++) {
    const asset = args.workingRoundAssets[j]!;
    const candidateTeamId = asset.currentTeamId;
    if (
      args.tradeUpsByTeamSoFar &&
      (args.tradeUpsByTeamSoFar.get(candidateTeamId) ?? 0) >= MAX_TRADE_UPS_PER_TEAM
    ) {
      continue;
    }
    const candidateBoard = args.draftBoards[candidateTeamId] ?? [];
    const candidateTop = findTopAvailable(candidateBoard, args.availableById);
    if (!candidateTop) continue;
    if (!atRiskIds.has(candidateTop.entry.collegePlayerId)) continue;
    const swapOverallPick = args.overallPick + (j - args.onClockIndex);
    if (
      !bestCandidate ||
      candidateTop.entry.priority > bestCandidate.candidatePriority
    ) {
      bestCandidate = {
        teamId: candidateTeamId,
        asset,
        swapOverallPick,
        candidatePriority: candidateTop.entry.priority,
        candidateTargetId: candidateTop.entry.collegePlayerId,
      };
    }
  }

  if (!bestCandidate) return null;

  // QB premium evaluates against the CANDIDATE's actual target —
  // after the swap, they pick that prospect at the on-clock slot.
  // If candidate's target is a QB, the slot's perceived value
  // inflates for both sides per Doc 5.
  const candidateTargetProspect = args.availableById.get(bestCandidate.candidateTargetId);
  const isQbTarget = candidateTargetProspect?.nflProjectedPosition === 'QB';

  // Trading-up context: only enables the offer-side acceptance
  // floor when teamContexts is provided (v0.49+ callers). Without
  // it we fall back to slice-1 v0.46 behavior — no trading-up
  // perspective check.
  const tradingUpContext = args.teamContexts?.[bestCandidate.teamId];

  const offer = buildOffer({
    onClockOverallPick: args.overallPick,
    swapAssetOverallPick: bestCandidate.swapOverallPick,
    seasonNumber: args.seasonNumber,
    tradingUpTeamId: bestCandidate.teamId,
    fullDraftPicks: args.fullDraftPicks,
    onClockContext,
    tradingUpContext,
    isQbTarget,
    round: args.round,
  });
  if (!offer) return null;

  return {
    onClockTeamId,
    onClockAssetId: onClockAsset.id,
    tradingUpTeamId: bestCandidate.teamId,
    swapAssetId: bestCandidate.asset.id,
    futurePickIds: offer.futurePickIds,
    targetCollegePlayerId: bestCandidate.candidateTargetId,
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
  onClockContext: TeamChartContext;
  /** v0.49+ — when provided, the trading-up acceptance floor applies. */
  tradingUpContext: TeamChartContext | undefined;
  isQbTarget: boolean;
  /** Round (1..7). Picks the per-round trading-up acceptance floor. */
  round: number;
}

function buildOffer(
  args: BuildOfferArgs,
): { futurePickIds: DraftPickId[]; ratio: number } | null {
  // All offer-construction values computed on the ON-CLOCK team's
  // chart. A rebuilder values incoming future picks at a premium
  // (futureMultiplier > 1) and a tiny sweetener can close the gap;
  // a championship team values them at a discount and needs more
  // to be persuaded.
  const onClockValue = pickValueForTeam(
    basePickValue(args.onClockOverallPick, 0),
    args.onClockContext.modifiers,
    0,
    args.isQbTarget,
    args.onClockContext.qbPremium,
  );
  // Swap pick is at a later slot — the prospect available there is
  // a different player, so the QB premium does not transfer.
  const swapValue = pickValueForTeam(
    basePickValue(args.swapAssetOverallPick, 0),
    args.onClockContext.modifiers,
    0,
    false,
  );
  if (onClockValue <= 0) return null;
  const gap = onClockValue - swapValue;
  if (gap <= 0) {
    // Swap pick is already worth more than the on-clock pick — would
    // be a trade DOWN, not a trade up. Should not happen given the
    // caller filters by slot order, but guard anyway.
    return null;
  }

  // Trading-up team's owned future picks valued from the on-clock
  // chart. v0.52 offer construction is a two-stage heuristic:
  //
  //   Stage 1: find the SMALLEST single pick that alone clears the
  //   gap. If found, use it. This is the "least over-pay" outcome
  //   in late rounds (small gaps) — a single R3 future covers a
  //   R5 swap without burning a R1 future.
  //
  //   Stage 2: if no single pick covers the gap, accumulate in
  //   ASCENDING order until cap or gap-closure. This is the only
  //   case where multiple picks bundle.
  //
  // v0.45 ascending-only failed R1 (4 small picks couldn't reach
  // the 4000-pt gap); pure descending starved late rounds (burned
  // big sweeteners on small gaps). The hybrid finds the right
  // single pick for each round.
  const futurePool = args.fullDraftPicks
    .filter(
      (p) =>
        p.currentTeamId === args.tradingUpTeamId &&
        p.seasonNumber > args.seasonNumber,
    )
    .map((p) => ({
      pick: p,
      value: futurePickHeuristicValue(p, args.seasonNumber, args.onClockContext.modifiers),
    }))
    .filter((x) => x.value > 0)
    .sort((a, b) => a.value - b.value); // ascending

  const chosenIds: DraftPickId[] = [];
  const chosenPicks: DraftPickAsset[] = [];
  let totalSweetener = 0;

  // Stage 1 — smallest single pick that alone clears the gap.
  // (futurePool is ascending; the first one ≥ gap is the answer.)
  const singleCover = futurePool.find((f) => f.value >= gap);
  if (singleCover) {
    chosenIds.push(singleCover.pick.id);
    chosenPicks.push(singleCover.pick);
    totalSweetener = singleCover.value;
  } else {
    // Stage 2 — no single pick suffices; bundle ascending until
    // cap or gap-closure.
    for (const f of futurePool) {
      if (chosenIds.length >= MAX_FUTURE_PICKS_PER_OFFER) break;
      chosenIds.push(f.pick.id);
      chosenPicks.push(f.pick);
      totalSweetener += f.value;
      if (totalSweetener >= gap) break;
    }
  }

  const totalReceived = swapValue + totalSweetener;
  const ratio = totalReceived / onClockValue;
  if (ratio < ACCEPTANCE_RATIO_FLOOR) return null;

  // v0.49+ trading-up perspective check — even if the on-clock team
  // would accept, the trading-up team caps their own over-pay. Skip
  // when no tradingUpContext was provided (slice-1 back-compat).
  if (args.tradingUpContext) {
    const tuReceived = pickValueForTeam(
      basePickValue(args.onClockOverallPick, 0),
      args.tradingUpContext.modifiers,
      0,
      args.isQbTarget,
      args.tradingUpContext.qbPremium,
    );
    const tuSwap = pickValueForTeam(
      basePickValue(args.swapAssetOverallPick, 0),
      args.tradingUpContext.modifiers,
      0,
      false,
    );
    let tuSweetener = 0;
    for (const pick of chosenPicks) {
      tuSweetener += futurePickHeuristicValue(
        pick,
        args.seasonNumber,
        args.tradingUpContext.modifiers,
      );
    }
    const tuGiven = tuSwap + tuSweetener;
    const tuRatio = tuGiven > 0 ? tuReceived / tuGiven : 0;
    const floor =
      TRADING_UP_ACCEPTANCE_FLOOR_BY_ROUND[args.round] ??
      TRADING_UP_ACCEPTANCE_FLOOR_DEFAULT;
    if (tuRatio < floor) return null;
  }

  return { futurePickIds: chosenIds, ratio };
}

/**
 * Chart value of a future pick from a specified team's perspective.
 * Uses the round-midpoint slot heuristic (next-year standings aren't
 * known, so both sides converge on midpoint) and then applies the
 * supplied modifiers — rebuilders inflate, championship teams
 * deflate. Picks beyond round 7 fall through to 0; only rounds 1-7
 * are tradeable.
 */
function futurePickHeuristicValue(
  pick: DraftPickAsset,
  currentDraftSeason: number,
  modifiers: ChartModifiers,
): number {
  const midpoint = ROUND_MIDPOINT_OVERALL_PICK[pick.round];
  if (midpoint === undefined) return 0;
  const yearsOut = pick.seasonNumber - currentDraftSeason;
  return pickValueForTeam(basePickValue(midpoint, yearsOut), modifiers, yearsOut, false);
}
