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
 *   - Compensation = the trading-up team's same-round swap pick plus
 *     sweetener picks. CURRENT-draft later-round picks are preferred
 *     (real draft-day trade-ups are current-year heavy); future-year
 *     picks fill in only when this year's capital can't close the gap
 *     (v0.160 — was future-only, which made every top-of-draft package
 *     read as a future-pick dump). Same-round swaps mutate `runDraft`'s
 *     working list in place; both current-draft-later-round and
 *     future-year sweeteners flip ownership in `LeagueState.draftPicks`
 *     via the result (`applyDraftResult`) — the next round / next year's
 *     draft sees the new owner.
 *   - At most 3 current + 2 future sweetener picks per offer.
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
import { POSITION_DRAFT_VALUE } from './position-value.js';
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
 * The GOAT gate (v0.143 — the Goatinator finding). Real trade-ups into the
 * premier slots are franchise-cornerstone hunts: since 2002 the traded-into
 * top of round 1 is QBs and WRs (plus the odd EDGE), and nobody has burned
 * a top-slot trade-up on a safety or an off-ball linebacker. GMSim was
 * trading up into the top 10 for DBs as often as QBs (19% vs 12%). When the
 * slot being acquired is at or above `GOAT_SLOT_CEILING`, the candidate's
 * target must play a position whose draft value clears
 * `GOAT_MIN_POSITION_VALUE` — QB (1.6), EDGE (1.4), LT (1.3), WR (1.12)
 * qualify; CB (1.1) and below don't. Slots 9+ trade exactly as before.
 */
export const GOAT_SLOT_CEILING = 8;
export const GOAT_MIN_POSITION_VALUE = 1.12;

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
 *
 * NOTE (v0.160): the in-draft trade-up rate INTO the top 10 is low (~4% vs
 * real 16%) because R1's K=1 only fires when two teams covet the exact same
 * #1. Widening K lifts the rate but, on the current EDGE-heavy board,
 * disproportionately adds EDGE trade-ups (frequency amplifies whatever the
 * board over-values) — so the rate is effectively gated by the class-mix
 * residual. The frequency tune belongs WITH that upstream slice (fix EDGE
 * board value first, then widen K with no EDGE cost); not a standalone knob.
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
 * Max CURRENT-draft later-round picks a trading-up team will bundle as
 * sweetener (v0.160). Real draft-day trade-ups lean on this-year picks
 * (e.g. "my R1 + my R3"); 3 covers the typical multi-pick package while
 * keeping the swap + sweetener count plausible.
 */
export const MAX_CURRENT_SWEETENERS = 3;

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
  /** THIS-draft later-round sweetener picks that flip ownership to on-clock team. */
  currentDraftPickIds: readonly DraftPickId[];
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
  /**
   * Teams that already have their quarterback (established starter,
   * franchise-dev rookie-window QB, or a QB taken earlier in this same
   * draft) — v0.145. Inside the GOAT window a settled team will not
   * trade UP for a QB: real premier-slot QB trade-ups are made by
   * QB-needy teams. Optional for back-compat; when omitted the GOAT
   * gate stays purely positional (v0.143 behavior).
   */
  qbSettledTeams?: ReadonlySet<TeamId>;
  /**
   * Pick asset ids already committed as swap/sweetener in EARLIER
   * trade-ups this same round (v0.160). `fullDraftPicks` is a snapshot
   * that isn't updated mid-round, so without this an aggressive team
   * trading up twice could offer the same pick as a sweetener in both
   * deals (a double-spend). The offer builder excludes these ids.
   * Optional for back-compat; defaults to none.
   */
  committedSweetenerIds?: ReadonlySet<DraftPickId>;
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
    // A team can't trade up to its OWN pick. This happens when a team already
    // owns the on-clock slot (via an earlier flip) AND holds a later slot —
    // the "self-trade" swaps a pick from itself to itself (a no-op flip), so
    // the swapped/sweetener picks never actually move and can be re-offered
    // (a phantom double-spend). Skip self as a candidate.
    if (candidateTeamId === onClockTeamId) continue;
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
    // The GOAT gate: premier slots only change hands for premium positions.
    // Fails open when the target's position can't be resolved — the gate
    // shapes behavior, it doesn't veto degenerate inputs.
    if (args.overallPick <= GOAT_SLOT_CEILING) {
      const targetProspect = args.availableById.get(candidateTop.entry.collegePlayerId);
      const targetPosition =
        candidateTop.entry.assignedPosition ?? targetProspect?.nflProjectedPosition;
      if (
        targetPosition &&
        (POSITION_DRAFT_VALUE[targetPosition] ?? 1.0) < GOAT_MIN_POSITION_VALUE
      ) {
        continue;
      }
      // Need-aware extension (v0.145): premier-slot QB trade-ups are
      // franchise-QB hunts — a team that already has its quarterback
      // doesn't burn top-8 capital on another one.
      if (targetPosition === 'QB' && args.qbSettledTeams?.has(candidateTeamId)) {
        continue;
      }
    }
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
    committedSweetenerIds: args.committedSweetenerIds,
  });
  if (!offer) return null;

  return {
    onClockTeamId,
    onClockAssetId: onClockAsset.id,
    tradingUpTeamId: bestCandidate.teamId,
    swapAssetId: bestCandidate.asset.id,
    currentDraftPickIds: offer.currentDraftPickIds,
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
  /** Pick ids already committed in earlier same-round trade-ups (excluded).
   *  Required-but-nullable: the sole caller always forwards its (optional) arg. */
  committedSweetenerIds: ReadonlySet<DraftPickId> | undefined;
}

function buildOffer(
  args: BuildOfferArgs,
): { currentDraftPickIds: DraftPickId[]; futurePickIds: DraftPickId[]; ratio: number } | null {
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

  // Sweetener selection (v0.160). The trading-up team's tradeable picks,
  // valued from the ON-CLOCK chart, split into THIS-draft later-round picks
  // (current-year) and FUTURE-year picks. Real draft-day trade-ups lean on
  // current-year capital — so current picks are PREFERRED, and future picks
  // only fill in when this year's picks can't close the gap. Picks already
  // committed in an earlier trade-up this round are excluded (no
  // double-spend; `fullDraftPicks` is a snapshot not updated mid-round).
  const committed = args.committedSweetenerIds;
  const currentPool: { pick: DraftPickAsset; value: number }[] = [];
  const futurePool: { pick: DraftPickAsset; value: number }[] = [];
  for (const p of args.fullDraftPicks) {
    if (p.currentTeamId !== args.tradingUpTeamId) continue;
    if (committed?.has(p.id)) continue;
    const value = sweetenerPickValue(p, args.seasonNumber, args.onClockContext.modifiers);
    if (value <= 0) continue;
    if (p.seasonNumber === args.seasonNumber) {
      // This draft: only LATER rounds are still tradeable (this round's
      // pick is the swap; earlier rounds already fired).
      if (p.round > args.round) currentPool.push({ pick: p, value });
    } else if (p.seasonNumber > args.seasonNumber) {
      futurePool.push({ pick: p, value });
    }
  }
  currentPool.sort((a, b) => a.value - b.value); // ascending
  futurePool.sort((a, b) => a.value - b.value);

  const chosenCurrent: DraftPickAsset[] = [];
  const chosenFuture: DraftPickAsset[] = [];
  let totalSweetener = 0;

  // Prefer current-year. The smallest single current pick that alone clears
  // the gap is the common "my R1 + my R3" package; else bundle current
  // ascending up to the cap.
  const singleCurrent = currentPool.find((f) => f.value >= gap);
  if (singleCurrent) {
    chosenCurrent.push(singleCurrent.pick);
    totalSweetener = singleCurrent.value;
  } else {
    for (const f of currentPool) {
      if (chosenCurrent.length >= MAX_CURRENT_SWEETENERS) break;
      chosenCurrent.push(f.pick);
      totalSweetener += f.value;
      if (totalSweetener >= gap) break;
    }
    // Still short — reach for future years to top it off.
    if (totalSweetener < gap) {
      // Pure-future fast path (no current capital at all): smallest single
      // future pick that clears the gap — the pre-v0.160 behavior.
      const singleFuture =
        chosenCurrent.length === 0 ? futurePool.find((f) => f.value >= gap) : undefined;
      if (singleFuture) {
        chosenFuture.push(singleFuture.pick);
        totalSweetener += singleFuture.value;
      } else {
        for (const f of futurePool) {
          if (chosenFuture.length >= MAX_FUTURE_PICKS_PER_OFFER) break;
          chosenFuture.push(f.pick);
          totalSweetener += f.value;
          if (totalSweetener >= gap) break;
        }
      }
    }
  }

  const chosenPicks = [...chosenCurrent, ...chosenFuture];

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
      tuSweetener += sweetenerPickValue(
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

  return {
    currentDraftPickIds: chosenCurrent.map((p) => p.id),
    futurePickIds: chosenFuture.map((p) => p.id),
    ratio,
  };
}

/**
 * Chart value of a sweetener pick (current-draft later-round OR future-year)
 * from a specified team's perspective. Uses the round-midpoint slot heuristic
 * (exact slots aren't carried here, so both sides converge on the round
 * midpoint) and applies the supplied modifiers — rebuilders inflate, champ
 * teams deflate. `yearsOut` is 0 for a current-draft pick (no future discount)
 * and >0 for future years. Picks beyond round 7 fall through to 0; only rounds
 * 1-7 are tradeable.
 */
function sweetenerPickValue(
  pick: DraftPickAsset,
  currentDraftSeason: number,
  modifiers: ChartModifiers,
): number {
  const midpoint = ROUND_MIDPOINT_OVERALL_PICK[pick.round];
  if (midpoint === undefined) return 0;
  const yearsOut = pick.seasonNumber - currentDraftSeason;
  return pickValueForTeam(basePickValue(midpoint, yearsOut), modifiers, yearsOut, false);
}
