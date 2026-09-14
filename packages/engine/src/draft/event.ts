import type { Prng } from '../prng/index.js';
import type { LeagueState } from '../types/league.js';
import type {
  CollegePlayer,
  DraftPickRecord,
  DraftPickAsset,
  DraftBoardEntry,
} from '../types/college.js';
import type { TeamId, PlayerId, ContractId, DraftPickId } from '../types/ids.js';
import type { TeamState } from '../types/team.js';
import type { Player } from '../types/player.js';
import type { Contract } from '../types/contract.js';
import type { Position } from '../types/enums.js';
import { promoteProspectToPlayer } from './promote.js';
import { computeTeamNeeds, qbUpgradeDesire } from './team-needs.js';
import {
  evaluateTradeUpForPick,
  applyTradeUpToWorkingAssets,
  type TradeUpRecord,
  type TeamChartContext,
  type TradeUpProposal,
} from './trade-up.js';
import {
  computeChartModifiers,
  qbPremiumForGm,
  QB_CURRENT_PICK_PREMIUM,
} from './chart-modifiers.js';
import {
  slotAwarePickBoost,
  qbSettledPickFactor,
  qbRevealedSlotBoost,
  QB_SETTLED_DAMPEN_END_PICK,
} from './position-value.js';
import { mintContractId, contractIdCollisionEntry } from '../contracts/mint.js';
import type { Transaction } from '../types/transaction.js';

/**
 * How credible the best available QB must be for a QB-desperate team to REACH
 * for him over a higher-ranked non-QB. BOTH gates must clear, so the reach is a
 * modest "take the QB a bit early," not a blind grab:
 *   - his board priority ≥ this fraction of the would-be pick's, AND
 *   - he sits within the team's top `QB_REACH_MAX_BOARD_RANK` (i.e. he's a
 *     genuinely good prospect, just not #1).
 * The rank cap is what keeps QB supply realistic — only a handful of QBs per
 * class are top-12 talents, so only a handful of teams can reach in round 1
 * (instead of every QB-needy team grabbing a camp arm). Tuning knobs.
 */
const QB_REACH_PRIORITY_RATIO = 0.85;
const QB_REACH_MAX_BOARD_RANK = 12;

/**
 * Minimum QB-upgrade desire (v0.150, `qbUpgradeDesire`) for a team to hunt
 * a QB at premier slots — below this it neither gets a QB slot premium nor
 * trades up into the GOAT window for one, and inside the premier window its
 * QB reads are dampened (the Baltimore gate).
 */
const QB_HUNT_DESIRE_MIN = 0.3;

/**
 * The Rosen rule's reach (v0.154; narrowed to #1 in v0.166): a bust-grading
 * franchise-dev QB stops settling his team only at the VERY top. The v0.166
 * dev-age-tiered loosening (team-needs.ts) lifted the #1-overall QB share onto
 * the real ~75% bar, but applied across picks 1-3 it over-drafted QBs at #2/#3
 * The premier window is the top-3 picks; WITHIN it the abandon floor now decays
 * by slot (see `qbUpgradeDesire`'s `premierPick`), so #1 re-drafts aggressively
 * and #3 almost always keeps the kid — a flat window over- or under-drafted the
 * lower slots (top-3 → #3 QB 49% vs real 25%; top-1 → #2 QB 27% vs 44%).
 */
const QB_ROSEN_MAX_PICK = 3;

/**
 * How many still-available board entries the on-clock team weighs with the
 * slot-aware positional premium (v0.143). Real war rooms debate a handful of
 * names at a premier slot; ten keeps the re-rank among genuine candidates
 * without letting a mid-board QB leapfrog half the class.
 */
const SLOT_RERANK_DEPTH = 10;

// Calibration note (v0.143): a 0.75 credibility floor on the re-rank was
// tested and NEVER binds — prospects winning premier slots on the premium
// are already within ~25% of the board top (scout-perceived priorities
// cluster tightly up there). The #2/#3 QB overshoot vs real (59%/44% vs
// 44%/25%) is therefore not a board-reach artifact; it's the missing
// class-relative QB quality bar (real teams pass on non-elite QB2s
// entirely) — a named future mechanism, not a re-rank knob.

export interface RunDraftOptions {
  /** Order in which teams pick. Length sets how many picks fire. */
  draftOrder: readonly TeamId[];
  /** Sim tick the draft executes on (rookie contracts sign on this tick). */
  pickedOnTick: number;
  /** Season number being drafted INTO (rookies join this season's rosters). */
  seasonNumber: number;
  /** Round number for the records produced. Slice 5a only fires round 1. */
  round?: number;
  /** Starting overall pick number (1 for round 1). */
  startingOverallPick?: number;
  /**
   * Optional pick assets in slot order, one per draft-order entry.
   * When supplied, each generated `DraftPickRecord` records the
   * `pickAssetId` + `originalTeamId` for asset-system bookkeeping
   * (v0.44.0+). When omitted, records carry no asset reference —
   * back-compat for tests that pass `draftOrder` directly.
   */
  pickAssets?: readonly DraftPickAsset[];
}

export interface DraftRunResult {
  /** New picks produced by this run, in pick order. */
  picks: readonly DraftPickRecord[];
  /** Player records to add to `LeagueState.players`. */
  newPlayers: readonly Player[];
  /** Contracts to add to `LeagueState.contracts`. */
  newContracts: readonly Contract[];
  /** Per-team roster additions (promoted players appended). */
  rosterAdditionsByTeam: Map<TeamId, readonly PlayerId[]>;
  /** Prospect ids removed from `LeagueState.collegePool`. */
  removedFromCollegePool: ReadonlySet<PlayerId>;
  /** Pick asset ids consumed (v0.44.0+; empty when no pickAssets supplied). */
  consumedPickIds: ReadonlySet<DraftPickId>;
  /**
   * Trade-ups that fired during this draft run (v0.45.0+). Empty
   * when `pickAssets` wasn't supplied (the trade-up evaluator
   * requires asset state to mutate). `applyDraftResult` reads this
   * to propagate future-pick ownership flips into
   * `LeagueState.draftPicks` and `LeagueState.draftHistory` retains
   * one record per trade-up via inspection of the picks themselves.
   */
  tradeUps: readonly TradeUpRecord[];
}
/**
 * Options for a stepped draft session. Extends the batch options with the D7
 * seam (GAME_UI_FOUNDATION.md §8.2).
 */
export interface DraftSessionOptions extends RunDraftOptions {
  /**
   * Teams whose picks are SUPPLIED from outside rather than COMPUTED by the
   * NPC AI. Per D7 the engine gains no concept of a *player* — only of a
   * decision that arrives from elsewhere. These teams get no advantage, no
   * extra information, and no different rules; the session simply stops at
   * their slot and waits. That generalises invariant #4 rather than excepting
   * it, and extends for free to multiple human GMs.
   */
  externallyControlledTeamIds?: readonly TeamId[];
}

/** What one `stepDraft` call produced. */
export type DraftStep =
  | {
      /** An NPC team made its selection. */
      kind: 'pick';
      pick: DraftPickRecord;
      player: Player;
    }
  | {
      /** A trade-up fired before the slot resolved. The step yields so a UI
       *  can show it landing; call `stepDraft` again to resolve the pick. */
      kind: 'trade-up';
      tradeUp: TradeUpRecord;
    }
  | {
      /** An externally-controlled team is on the clock. The session will not
       *  advance until `submitPick` or `autoPick` resolves this slot. */
      kind: 'on-the-clock';
      teamId: TeamId;
      overallPick: number;
      /** Prospect ids still available, in this team's board order first. */
      availableProspectIds: readonly PlayerId[];
    }
  | {
      /**
       * An NPC wants to trade up into a supplied-decision team's slot. The
       * session will not advance until `acceptTradeOffer` or `declineTradeOffer`
       * answers it -- a trade-up needs the on-clock team to agree.
       */
      kind: 'trade-offer';
      offer: TradeUpProposal;
      overallPick: number;
    }
  | { kind: 'complete' };

/**
 * A draft in progress. Mutable by design — the batch and stepped paths share
 * one instance and one loop body, which is what makes their results identical
 * by CONSTRUCTION rather than by coincidence that a test has to police.
 *
 * Treat as opaque: `beginDraft`/`stepDraft`/`submitPick`/`finishDraft` are the
 * API. The fields mirror exactly the loop-carried state the original single
 * `for` loop held in local variables.
 */
export interface DraftSession {
  readonly prng: Prng;
  readonly league: LeagueState;
  readonly options: DraftSessionOptions;
  readonly round: number;
  readonly startingOverallPick: number;
  readonly externallyControlled: ReadonlySet<TeamId>;

  /** Index into `draftOrder` of the slot currently resolving. */
  index: number;
  /**
   * Highest slot index whose trade-up check has already fired. The batch loop
   * evaluated trade-ups exactly once per slot; because `stepDraft` YIELDS when
   * a trade-up lands, re-entering would otherwise re-evaluate the same slot and
   * let a second deal fire where the original allowed one. Caught by the
   * batch-equivalence hash, not by reasoning — worth the field and this comment.
   */
  tradeUpCheckedIndex: number;
  /**
   * A trade-up aimed at a supplied-decision team, waiting on their answer.
   * While set, the slot does not resolve: an NPC cannot take a human GM's pick
   * without them accepting. Always null in batch mode.
   */
  pendingOffer: TradeUpProposal | null;
  /** Set once the pool is exhausted or every slot has fired. */
  complete: boolean;
  /**
   * Slot waiting on an externally-supplied decision. While set, `stepDraft`
   * refuses to advance — the trade-up check for this slot has already fired
   * and must not fire twice.
   */
  pending: { index: number; teamId: TeamId; overallPick: number } | null;

  readonly availableById: Map<PlayerId, CollegePlayer>;
  readonly picks: DraftPickRecord[];
  readonly newPlayers: Player[];
  readonly newContracts: Contract[];
  readonly rosterAdditions: Map<TeamId, PlayerId[]>;
  readonly removed: Set<PlayerId>;
  readonly consumedPickIds: Set<DraftPickId>;
  readonly tradeUps: TradeUpRecord[];
  readonly workingRoundAssets: DraftPickAsset[] | null;
  readonly teamContexts: Record<string, TeamChartContext>;
  readonly qbDesire: Map<TeamId, number>;
  qbSettledTeams: Set<TeamId>;
  readonly qbTakenTeams: Set<TeamId>;
  readonly needsMemo: Map<TeamId, readonly Position[]>;
  readonly tradeUpsByTeam: Map<TeamId, number>;
  readonly committedSweetenerIds: Set<DraftPickId>;
}

/**
 * Open a draft session. This is everything the original `runDraft` did BEFORE
 * its pick loop — pool indexing, chart contexts, QB-desire priors, trade-up
 * counters seeded from prior rounds.
 */
export function beginDraft(
  prng: Prng,
  league: LeagueState,
  options: DraftSessionOptions,
): DraftSession {
  const round = options.round ?? 1;
  const startingOverallPick = options.startingOverallPick ?? 1;

  // Pool of available prospects — declared + draft-eligible. Indexed
  // by id for O(1) lookup; we'll remove ids as picks fire.
  const availableById = new Map<PlayerId, CollegePlayer>();
  for (const cp of league.collegePool) {
    if (cp.isDraftEligible && cp.hasDeclared) {
      availableById.set(cp.id, cp);
    }
  }

  // Working copy of this round's pick assets — trade-ups mutate
  // currentTeamId on the slots that get swapped. The picking team at
  // each slot is derived from this list (NOT options.draftOrder),
  // which is the original ordering and stale once a trade-up fires.
  const workingRoundAssets: DraftPickAsset[] | null = options.pickAssets
    ? [...options.pickAssets]
    : null;

  // v0.49+ — pre-compute every team's chart context once per draft
  // call (cheap; each team's modifiers/QB-premium are stable for
  // the duration of the round). Passed through to the trade-up
  // evaluator so it can apply both on-clock AND trading-up
  // perspectives without re-deriving per pick.
  const teamContexts: Record<string, TeamChartContext> = {};
  if (workingRoundAssets) {
    for (const team of Object.values(league.teams)) {
      const modifiers = computeChartModifiers(team, league.owners, league.gms, league.coaches);
      const gm = league.gms[team.gmId];
      const qbPremium = gm ? qbPremiumForGm(gm) : QB_CURRENT_PICK_PREMIUM;
      teamContexts[team.identity.id] = { modifiers, qbPremium };
    }
  }

  // QB-upgrade desire per team (v0.150 — graded, replacing the v0.145
  // binary): 1.0 = no answer at QB (full slot premium + reach rights),
  // 0 = franchise-dev kid or top-quartile QB room (the Baltimore dampen),
  // in between = bottom-feeders with mediocre starters still hunt the
  // franchise QB at premier slots (Carolina/Young, Chicago/Williams).
  // Updated in-draft: once a team takes a QB this round its desire is 0
  // (a team holding two top picks must not double-draft passers).
  const qbDesire = new Map<TeamId, number>();
  for (const team of Object.values(league.teams)) {
    qbDesire.set(team.identity.id, qbUpgradeDesire(team, league));
  }

  // Per-team trade-up counter (v0.52). Tracks how many times each
  // team has initiated as the trading-up side so the evaluator can
  // enforce `MAX_TRADE_UPS_PER_TEAM` and prevent one aggressive team
  // from monopolizing draft trade activity. SEEDED from prior
  // rounds of this same draft (advanceSeason calls runDraft once
  // per round; the cap must apply ACROSS rounds, not reset).
  const tradeUpsByTeam = new Map<TeamId, number>();
  for (const prior of league.tradeUpHistory) {
    if (prior.seasonNumber === options.seasonNumber) {
      tradeUpsByTeam.set(
        prior.tradingUpTeamId,
        (tradeUpsByTeam.get(prior.tradingUpTeamId) ?? 0) + 1,
      );
    }
  }

  const session: DraftSession = {
    prng,
    league,
    options,
    round,
    startingOverallPick,
    externallyControlled: new Set(options.externallyControlledTeamIds ?? []),
    index: 0,
    tradeUpCheckedIndex: -1,
    pendingOffer: null,
    complete: false,
    pending: null,
    availableById,
    picks: [],
    newPlayers: [],
    newContracts: [],
    rosterAdditions: new Map<TeamId, PlayerId[]>(),
    removed: new Set<PlayerId>(),
    consumedPickIds: new Set<DraftPickId>(),
    tradeUps: [],
    workingRoundAssets,
    teamContexts,
    qbDesire,
    qbSettledTeams: new Set<TeamId>(),
    qbTakenTeams: new Set<TeamId>(),
    needsMemo: new Map<TeamId, readonly Position[]>(),
    tradeUpsByTeam,
    committedSweetenerIds: new Set<DraftPickId>(),
  };
  session.qbSettledTeams = buildQbSettledSet(session);
  return session;
}

/** Teams settled enough that they won't trade UP into the GOAT window for a QB. */
function buildQbSettledSet(session: DraftSession): Set<TeamId> {
  const s = new Set<TeamId>();
  for (const [tid, d] of session.qbDesire) {
    if (d < QB_HUNT_DESIRE_MIN) s.add(tid);
  }
  return s;
}

/** True once every slot has fired or the prospect pool ran dry. */
export function isDraftComplete(session: DraftSession): boolean {
  return session.complete || session.index >= session.options.draftOrder.length;
}

/**
 * The trade-up check that fires BEFORE a pick so the picking team reflects any
 * same-round ownership flip. Returns the record if one landed.
 */
/**
 * Find a trade-up for this slot WITHOUT applying it.
 *
 * Split from the application step so an offer aimed at a supplied-decision team
 * can be surfaced for a decision instead of executed. A trade-up requires the
 * on-clock team to AGREE — an NPC cannot take a human GM's pick without asking,
 * and before this split it could: the D7 seam excluded controlled teams as
 * trading-UP candidates but left them exposed as on-clock targets, and the deal
 * auto-applied.
 */
function proposeTradeUpAtSlot(session: DraftSession): TradeUpProposal | null {
  const { workingRoundAssets, league, options } = session;
  if (!workingRoundAssets) return null;
  if (session.tradeUpCheckedIndex === session.index) return null;
  session.tradeUpCheckedIndex = session.index;

  const overallPickAtSlot = session.startingOverallPick + session.index;
  return evaluateTradeUpForPick({
    onClockIndex: session.index,
    overallPick: overallPickAtSlot,
    round: session.round,
    seasonNumber: options.seasonNumber,
    workingRoundAssets,
    draftBoards: league.draftBoards,
    availableById: session.availableById,
    fullDraftPicks: league.draftPicks,
    tradeUpsFiredSoFar: session.tradeUps.length,
    tradeUpsByTeamSoFar: session.tradeUpsByTeam,
    teamContexts: session.teamContexts as Readonly<Record<TeamId, TeamChartContext>>,
    qbSettledTeams: session.qbSettledTeams,
    committedSweetenerIds: session.committedSweetenerIds,
    // The D7 seam: never compute a trade-up FOR a supplied-decision team.
    // Empty in batch mode, so NPC-only drafts are unaffected.
    externallyControlledTeams: session.externallyControlled,
  });
}

/**
 * Execute a proposal: flip the assets, count it against the trading-up team's
 * cap, lock the committed picks, and record it.
 *
 * Unchanged from the pre-split behaviour — only its call site moved, so an
 * NPC-only draft applies every proposal exactly where it used to.
 */
function applyTradeUpProposal(
  session: DraftSession,
  proposal: TradeUpProposal,
): TradeUpRecord | null {
  const { workingRoundAssets, options } = session;
  if (!workingRoundAssets) return null;
  const overallPickAtSlot = session.startingOverallPick + session.index;

  applyTradeUpToWorkingAssets(workingRoundAssets, proposal);
  session.tradeUpsByTeam.set(
    proposal.tradingUpTeamId,
    (session.tradeUpsByTeam.get(proposal.tradingUpTeamId) ?? 0) + 1,
  );
  // Lock this deal's assets so a later same-round trade-up can't
  // re-offer them off the stale snapshot.
  session.committedSweetenerIds.add(proposal.swapAssetId);
  for (const id of proposal.currentDraftPickIds) session.committedSweetenerIds.add(id);
  for (const id of proposal.futurePickIds) session.committedSweetenerIds.add(id);

  const record: TradeUpRecord = {
    seasonNumber: options.seasonNumber,
    round: session.round,
    overallPick: overallPickAtSlot,
    onClockTeamId: proposal.onClockTeamId,
    onClockAssetId: proposal.onClockAssetId,
    tradingUpTeamId: proposal.tradingUpTeamId,
    swapAssetId: proposal.swapAssetId,
    currentDraftPickIds: proposal.currentDraftPickIds,
    futurePickIds: proposal.futurePickIds,
    targetCollegePlayerId: proposal.targetCollegePlayerId,
    ratio: proposal.ratio,
  };
  session.tradeUps.push(record);
  return record;
}

/**
 * The NPC war room's selection for the slot: board walk with the slot-aware
 * positional premium, the QB-need reach, then BPA fallback. Pure reads — it
 * consumes no PRNG, so calling it to preview a pick cannot shift the stream.
 */
function chooseForTeam(
  session: DraftSession,
  teamId: TeamId,
  team: TeamState,
  overallPick: number,
): {
  chosen: CollegePlayer | null;
  boardRank: number | null;
  boardEntry: DraftBoardEntry | null;
  needsAtPick: readonly Position[];
  qbDesperateAtPick: boolean;
} {
  const { league, availableById } = session;
  const board = league.draftBoards[teamId] ?? [];

  // Captured BEFORE this pick mutates the desire maps — what the war room
  // acted on when it went on the clock (v0.147 snapshot). Inside the
  // premier window the Rosen-aware desire applies (a bust-grading dev QB
  // no longer settles the room).
  const rawQbDesire = session.qbDesire.get(teamId) ?? 0;
  const teamQbDesire =
    overallPick <= QB_ROSEN_MAX_PICK && !session.qbTakenTeams.has(teamId)
      ? Math.max(rawQbDesire, qbUpgradeDesire(team, league, { premierPick: overallPick }))
      : rawQbDesire;
  const qbDesperateAtPick = rawQbDesire >= 1;

  let needsAtPick = session.needsMemo.get(teamId);
  if (!needsAtPick) {
    needsAtPick = computeTeamNeeds(team, league)
      .slice(0, 5)
      .map((n) => n.position);
    session.needsMemo.set(teamId, needsAtPick);
  }

  // Walk the team's own board for the strongest available pick. At premier
  // slots the pick is a SURPLUS decision, not raw board order (v0.143 — the
  // Goatinator finding): the top remaining entries are re-weighted by the
  // slot-aware positional premium — full strength at #1 overall, decayed
  // back to plain board order by pick ~40 — so a board-topping guard no
  // longer goes #1 over a near-equal QB/EDGE. Ties (and every pick past the
  // decay window, where the boost is 1.0 everywhere) resolve to board order.
  let chosen: CollegePlayer | null = null;
  let boardRank: number | null = null;
  let boardEntry: DraftBoardEntry | null = null;
  {
    let bestWeighted = -Infinity;
    let considered = 0;
    for (let r = 0; r < board.length && considered < SLOT_RERANK_DEPTH; r++) {
      const entry = board[r]!;
      const cp = availableById.get(entry.collegePlayerId);
      if (!cp) continue;
      considered++;
      const position = entry.assignedPosition ?? cp.nflProjectedPosition;
      // Need-aware QB surplus (v0.145, graded v0.150, revealed v0.152,
      // premier-slot binary v0.154): INSIDE the premier window a team is
      // either out of the QB market (settled room → dampen) or fully in
      // it at the revealed value — holding a top-8 pick is itself the
      // evidence your QB isn't the answer (Tennessee/Ward over a median
      // Levis; nobody half-drafts a QB at #3). Beyond the window, the
      // graded desire scales the surplus premium as before.
      const boost =
        position === 'QB'
          ? teamQbDesire < QB_HUNT_DESIRE_MIN
            ? qbSettledPickFactor(overallPick)
            : teamQbDesire >= 1 || overallPick <= QB_SETTLED_DAMPEN_END_PICK
              ? qbRevealedSlotBoost(overallPick)
              : 1 + (slotAwarePickBoost(position, overallPick) - 1) * teamQbDesire
          : slotAwarePickBoost(position, overallPick);
      const weighted = entry.priority * boost;
      if (weighted > bestWeighted) {
        bestWeighted = weighted;
        chosen = cp;
        boardRank = r + 1;
        boardEntry = entry;
      }
    }
  }

  // QB-need REACH (2026-06-03): a team with NO answer at quarterback takes its
  // best available QB even when a non-QB outranks him on the board — the
  // classic "team reaches for a passer." Gated so it isn't a blind grab: the
  // QB must be a CREDIBLE pick (his board priority ≥ QB_REACH_PRIORITY_RATIO ×
  // the would-be pick's), so a desperate team reaches ~a round for a real QB
  // but won't burn a premium slot on a camp arm. Only the top available QB on
  // the board is considered (the others are worse). Fires whether the team's
  // top pick was a board entry or it's about to fall to BPA.
  // (Reaching a round early is DESPERATE behavior — desire 1.0 only, not
  // the graded upgrade hunt. In-draft QB picks zero desire, so a team
  // that already took a QB this round can't reach for a second one.)
  if (chosen && chosen.nflProjectedPosition !== 'QB' && teamQbDesire >= 1) {
    const topPriority = boardEntry?.priority ?? 0;
    for (let r = 0; r < board.length && r < QB_REACH_MAX_BOARD_RANK; r++) {
      const entry = board[r]!;
      const cp = availableById.get(entry.collegePlayerId);
      if (!cp) continue;
      if (cp.nflProjectedPosition !== 'QB') continue;
      if (entry.priority >= QB_REACH_PRIORITY_RATIO * topPriority) {
        chosen = cp;
        boardRank = r + 1;
        boardEntry = entry;
      }
      break; // first QB found is the highest-priority available QB
    }
  }

  // Fallback: BPA across the full available pool — pick the best
  // available by tier then composite skill proxy.
  if (!chosen) {
    chosen = pickBestAvailable(availableById);
  }

  return { chosen, boardRank, boardEntry, needsAtPick, qbDesperateAtPick };
}

/**
 * Commit one selection: promote the prospect, mint the rookie deal, update the
 * loop-carried state, and record the pick. Shared verbatim by the NPC path and
 * the externally-supplied path — the only difference between an NPC pick and a
 * human one is who chose the name.
 */
function commitPick(
  session: DraftSession,
  teamId: TeamId,
  overallPick: number,
  chosen: CollegePlayer,
  boardRank: number | null,
  boardEntry: DraftBoardEntry | null,
  needsAtPick: readonly Position[],
  qbDesperateAtPick: boolean,
): { pick: DraftPickRecord; player: Player } {
  const { league, options } = session;
  const pickAsset = session.workingRoundAssets ? session.workingRoundAssets[session.index] : undefined;

  // Convert-to-need: if this team's board planned to play the prospect at a
  // different (convertible) spot, draft him there. The promoted player lines
  // up at the assigned position; the pick records what he converted FROM.
  const assignedPosition = boardEntry?.assignedPosition;
  const convertedFromPosition =
    assignedPosition && assignedPosition !== chosen.nflProjectedPosition
      ? chosen.nflProjectedPosition
      : undefined;
  const promoted = promoteProspectToPlayer(session.prng.fork(`pick:${overallPick}`), {
    prospect: chosen,
    teamId,
    signedOnTick: options.pickedOnTick,
    overallPick,
    salaryCap: league.salaryCap,
    ...(assignedPosition ? { assignedPosition } : {}),
  });
  session.newPlayers.push(promoted.player);
  session.newContracts.push(promoted.contract);
  appendRosterAddition(session.rosterAdditions, teamId, promoted.player.id);
  // A team that just took its QB is settled for the rest of this round (a
  // team holding two top picks must not double-draft passers). The drafted QB
  // isn't on the frozen-for-the-round roster yet, so the per-pick premier
  // desire can't see him — track it explicitly.
  if (promoted.player.position === 'QB') {
    session.qbDesire.set(teamId, 0);
    session.qbTakenTeams.add(teamId);
    session.qbSettledTeams = buildQbSettledSet(session);
  }
  session.availableById.delete(chosen.id);
  session.removed.add(chosen.id);

  const pick: DraftPickRecord = {
    seasonNumber: options.seasonNumber,
    round: session.round,
    overallPick,
    teamId,
    collegePlayerId: chosen.id,
    promotedPlayerId: promoted.player.id,
    contractId: promoted.contract.id satisfies ContractId,
    pickedOnTick: options.pickedOnTick,
    boardRankAtPick: boardRank,
    boardPriorityAtPick: boardEntry?.priority ?? null,
    boardReasonAtPick: boardEntry?.reason ?? null,
    needsAtPick,
    qbDesperateAtPick,
    // Snapshot the prospect's public profile (v0.162) — `chosen` is filtered
    // out of `collegePool` once the draft completes, so the replay card reads
    // this. Pure reads of already-computed fields; consumes no PRNG.
    prospectProfile: {
      nflProjectedPosition: chosen.nflProjectedPosition,
      collegePosition: chosen.collegePosition,
      schoolId: chosen.schoolId,
      classYear: chosen.classYear,
      tier: chosen.tier,
      archetype: chosen.archetype,
      assumedArchetype: chosen.assumedArchetype,
      isConversionCandidate: chosen.isConversionCandidate,
      measurables: chosen.measurables,
      collegeStats: chosen.collegeStats,
    },
    ...(convertedFromPosition ? { convertedFromPosition } : {}),
    ...(pickAsset ? { pickAssetId: pickAsset.id, originalTeamId: pickAsset.originalTeamId } : {}),
  };
  session.picks.push(pick);

  if (pickAsset) session.consumedPickIds.add(pickAsset.id);

  session.index++;
  session.pending = null;
  return { pick, player: promoted.player };
}

/**
 * Advance the draft by one event. Returns the pick that fired, a trade-up that
 * landed, or a pause because an externally-controlled team is on the clock.
 *
 * Throws if a slot is already waiting on `submitPick`/`autoPick` — advancing
 * past it would fire that slot's trade-up check a second time.
 */
export function stepDraft(session: DraftSession): DraftStep {
  if (session.pendingOffer) {
    throw new Error(
      'stepDraft: a trade-up offer is awaiting an answer. Call acceptTradeOffer() ' +
        'or declineTradeOffer() to resolve it.',
    );
  }
  if (session.pending) {
    throw new Error(
      `stepDraft: slot ${session.pending.overallPick} is waiting on an externally ` +
        'supplied pick. Call submitPick() or autoPick() to resolve it.',
    );
  }

  for (;;) {
    if (isDraftComplete(session)) return { kind: 'complete' };

    const proposal = proposeTradeUpAtSlot(session);
    if (proposal) {
      // A deal aimed at a supplied-decision team is an OFFER, not an event: a
      // trade-up needs the on-clock team to agree, and an NPC must not take a
      // human GM's pick without being accepted. Every other proposal applies
      // immediately, exactly as before — which is why an NPC-only draft is
      // untouched (`externallyControlled` is empty there, so this never fires).
      if (session.externallyControlled.has(proposal.onClockTeamId)) {
        session.pendingOffer = proposal;
        return {
          kind: 'trade-offer',
          offer: proposal,
          overallPick: session.startingOverallPick + session.index,
        };
      }
      const tradeUp = applyTradeUpProposal(session, proposal);
      if (tradeUp) return { kind: 'trade-up', tradeUp };
    }

    const pickAsset = session.workingRoundAssets
      ? session.workingRoundAssets[session.index]
      : undefined;
    const teamId = pickAsset?.currentTeamId ?? session.options.draftOrder[session.index]!;
    const team = session.league.teams[teamId];
    if (!team) {
      // Slot belongs to no known team — skip it exactly as the batch loop's
      // `continue` did.
      session.index++;
      continue;
    }

    const overallPick = session.startingOverallPick + session.index;

    if (session.externallyControlled.has(teamId)) {
      session.pending = { index: session.index, teamId, overallPick };
      return {
        kind: 'on-the-clock',
        teamId,
        overallPick,
        availableProspectIds: availableInBoardOrder(session, teamId),
      };
    }

    const { chosen, boardRank, boardEntry, needsAtPick, qbDesperateAtPick } = chooseForTeam(
      session,
      teamId,
      team,
      overallPick,
    );
    if (!chosen) {
      // Pool exhausted — abort the draft, exactly as the batch loop's `break`.
      session.complete = true;
      return { kind: 'complete' };
    }

    const { pick, player } = commitPick(
      session,
      teamId,
      overallPick,
      chosen,
      boardRank,
      boardEntry,
      needsAtPick,
      qbDesperateAtPick,
    );
    return { kind: 'pick', pick, player };
  }
}

/** Still-available prospects, this team's board order first, then the rest. */
function availableInBoardOrder(session: DraftSession, teamId: TeamId): readonly PlayerId[] {
  const board = session.league.draftBoards[teamId] ?? [];
  const out: PlayerId[] = [];
  const seen = new Set<PlayerId>();
  for (const entry of board) {
    if (session.availableById.has(entry.collegePlayerId) && !seen.has(entry.collegePlayerId)) {
      out.push(entry.collegePlayerId);
      seen.add(entry.collegePlayerId);
    }
  }
  for (const id of session.availableById.keys()) {
    if (!seen.has(id)) out.push(id);
  }
  return out;
}

/**
 * Resolve a pending slot with an externally-chosen prospect. The supplied
 * prospect must still be available; anything else is a caller bug, not a
 * recoverable state.
 */
export function submitPick(
  session: DraftSession,
  prospectId: PlayerId,
): { pick: DraftPickRecord; player: Player } {
  const pending = session.pending;
  if (!pending) throw new Error('submitPick: no slot is on the clock.');

  const chosen = session.availableById.get(prospectId);
  if (!chosen) {
    throw new Error(`submitPick: prospect ${String(prospectId)} is not available.`);
  }

  const team = session.league.teams[pending.teamId];
  if (!team) throw new Error(`submitPick: unknown team ${String(pending.teamId)}.`);

  // The board entry is looked up rather than assumed: a supplied pick may be
  // entirely off this team's board, which is legitimate (and is exactly what
  // `boardRankAtPick: null` means on the record).
  const board = session.league.draftBoards[pending.teamId] ?? [];
  const rank = board.findIndex((e) => e.collegePlayerId === prospectId);
  const boardEntry = rank >= 0 ? board[rank]! : null;

  let needsAtPick = session.needsMemo.get(pending.teamId);
  if (!needsAtPick) {
    needsAtPick = computeTeamNeeds(team, session.league)
      .slice(0, 5)
      .map((n) => n.position);
    session.needsMemo.set(pending.teamId, needsAtPick);
  }

  return commitPick(
    session,
    pending.teamId,
    pending.overallPick,
    chosen,
    rank >= 0 ? rank + 1 : null,
    boardEntry,
    needsAtPick,
    (session.qbDesire.get(pending.teamId) ?? 0) >= 1,
  );
}

/**
 * Resolve a pending slot the way the NPC AI would have. This is "sim my pick" —
 * and it runs the identical `chooseForTeam` the other 31 war rooms use, so an
 * auto-picked slot is indistinguishable from a computed one.
 */
export function autoPick(session: DraftSession): { pick: DraftPickRecord; player: Player } | null {
  const pending = session.pending;
  if (!pending) throw new Error('autoPick: no slot is on the clock.');
  const team = session.league.teams[pending.teamId];
  if (!team) throw new Error(`autoPick: unknown team ${String(pending.teamId)}.`);

  const { chosen, boardRank, boardEntry, needsAtPick, qbDesperateAtPick } = chooseForTeam(
    session,
    pending.teamId,
    team,
    pending.overallPick,
  );
  if (!chosen) {
    session.complete = true;
    session.pending = null;
    return null;
  }
  return commitPick(
    session,
    pending.teamId,
    pending.overallPick,
    chosen,
    boardRank,
    boardEntry,
    needsAtPick,
    qbDesperateAtPick,
  );
}

/**
 * Collect the session's accumulated result in the batch-mode shape.
 *
 * Returns a SNAPSHOT, not the session's live collections. `runDraft` returns
 * immediately so it cannot tell the difference, but a stepped UI may call this
 * mid-draft to render pick history — and handing back the live arrays would
 * give it collections that keep growing underneath it with unchanged identity,
 * which React cannot see as a change and which makes "result" a lie about what
 * the caller is holding.
 */
export function finishDraft(session: DraftSession): DraftRunResult {
  return {
    picks: [...session.picks],
    newPlayers: [...session.newPlayers],
    newContracts: [...session.newContracts],
    rosterAdditionsByTeam: new Map(
      [...session.rosterAdditions].map(([teamId, ids]) => [teamId, [...ids]]),
    ),
    removedFromCollegePool: new Set(session.removed),
    consumedPickIds: new Set(session.consumedPickIds),
    tradeUps: [...session.tradeUps],
  };
}

/**
 * Run a draft over the supplied order. Each team makes ONE pick in the
 * order given; if `draftOrder` has 32 entries, this fires 32 picks
 * (slice 5a's single round). Multi-round drafts will be modeled in
 * slice 5b by calling this repeatedly with re-ordered orders.
 *
 * Selection logic (slice 5a):
 *   - Picking team consults its `draftBoards[teamId]` entries.
 *   - Walks the board top→bottom and picks the highest-priority
 *     entry whose prospect is still available (eligible + declared +
 *     not yet picked).
 *   - If the entire board is exhausted of available prospects, the
 *     team falls back to "BPA across the full pool" — picking the
 *     highest-tier eligible declared prospect not yet selected. This
 *     is a degenerate case for round 1 (boards are 50-deep, only 32
 *     picks fire) but matters when multi-round drafts arrive.
 *
 * Deterministic for a given (prng, league, options) tuple.
 *
 * As of W4 this is a thin driver over the stepped session below. Batch and
 * stepped mode therefore execute THE SAME loop body in the same order, which
 * makes their results identical by construction rather than by a coincidence
 * a test has to police. (The test polices it anyway — dual-gate discipline
 * whenever draft code moves.)
 */
export function runDraft(
  prng: Prng,
  league: LeagueState,
  options: RunDraftOptions,
): DraftRunResult {
  const session = beginDraft(prng, league, options);
  while (!isDraftComplete(session)) {
    const step = stepDraft(session);
    if (step.kind === 'complete') break;
  }
  return finishDraft(session);
}

/**
 * Apply a `DraftRunResult` to a `LeagueState`. Folds new players +
 * contracts into the maps, appends rookies to team rosters, removes
 * drafted prospects from the college pool, and appends pick records
 * to `draftHistory`.
 */
export function applyDraftResult(
  league: LeagueState,
  result: DraftRunResult,
): LeagueState {
  // Players + contracts
  const players: Record<string, Player> = { ...league.players };
  for (const p of result.newPlayers) players[p.id] = p;
  const contracts: Record<string, Contract> = { ...league.contracts };
  // Roster Floor §14 Fix 2: safe by construction (idSuffix is each rookie's
  // own globally-unique player id, minted exactly once), but class-wide
  // means every mint site carries the guard (Daniel, §14.9).
  const contractCollisions: Transaction[] = [];
  for (const c of result.newContracts) {
    const minted = mintContractId(contracts, c.id);
    const finalContract: Contract = minted.collision === undefined ? c : { ...c, id: minted.id };
    contracts[finalContract.id] = finalContract;
    if (minted.collision) {
      const existingPlayer = players[c.playerId];
      if (existingPlayer) players[c.playerId] = { ...existingPlayer, contractId: finalContract.id };
      const entry = contractIdCollisionEntry(minted, {
        tick: league.tick,
        seasonNumber: league.seasonNumber,
        teamId: finalContract.teamId,
        playerId: c.playerId,
      });
      if (entry) contractCollisions.push(entry);
    }
  }

  // Teams: append rookies to rosterIds
  const teams: Record<string, TeamState> = { ...league.teams };
  for (const [teamId, rookieIds] of result.rosterAdditionsByTeam) {
    const team = teams[teamId];
    if (!team) continue;
    teams[teamId] = { ...team, rosterIds: [...team.rosterIds, ...rookieIds] };
  }

  // College pool: filter out drafted prospects
  const collegePool = league.collegePool.filter(
    (cp) => !result.removedFromCollegePool.has(cp.id),
  );

  // Draft pick assets: drop the ones consumed by this draft run.
  let draftPicks = result.consumedPickIds.size > 0
    ? league.draftPicks.filter((p) => !result.consumedPickIds.has(p.id))
    : league.draftPicks;

  // Trade-ups: sweetener picks that flipped ownership during the round
  // need their currentTeamId updated in the league asset list. Future-year
  // picks so next year's draft sees the new owner; current-draft later-round
  // picks (v0.160) so a LATER round THIS draft sees it — the per-round draft
  // loop re-sources each round's assets from `draftPicks`, so the flip lands
  // before that round fires. Same-round swaps are already reflected in the
  // consumed picks (the new owner used their swap asset this round), so they
  // don't need handling here.
  if (result.tradeUps.length > 0) {
    const sweetenerFlips = new Map<DraftPickId, TeamId>();
    for (const tu of result.tradeUps) {
      for (const id of tu.currentDraftPickIds) sweetenerFlips.set(id, tu.onClockTeamId);
      for (const id of tu.futurePickIds) sweetenerFlips.set(id, tu.onClockTeamId);
    }
    if (sweetenerFlips.size > 0) {
      draftPicks = draftPicks.map((p) =>
        sweetenerFlips.has(p.id) ? { ...p, currentTeamId: sweetenerFlips.get(p.id)! } : p,
      );
    }
  }

  return {
    ...league,
    players: players as typeof league.players,
    contracts: contracts as typeof league.contracts,
    teams: teams as typeof league.teams,
    collegePool,
    draftHistory: [...league.draftHistory, ...result.picks],
    draftPicks,
    tradeUpHistory:
      result.tradeUps.length > 0
        ? [...league.tradeUpHistory, ...result.tradeUps]
        : league.tradeUpHistory,
    transactionLog:
      contractCollisions.length > 0
        ? [...league.transactionLog, ...contractCollisions]
        : league.transactionLog,
  };
}

function pickBestAvailable(available: Map<PlayerId, CollegePlayer>): CollegePlayer | null {
  let best: CollegePlayer | null = null;
  let bestScore = -Infinity;
  const tierScore = { STAR: 4, STARTER: 3, BACKUP: 2, FRINGE: 1 } as const;
  for (const cp of available.values()) {
    const ceilAvg =
      (cp.ceiling.speed + cp.ceiling.acceleration + cp.ceiling.strength +
        cp.ceiling.technicalSkill + cp.ceiling.footballIq) / 5;
    const score = tierScore[cp.tier] * 100 + ceilAvg;
    if (score > bestScore) {
      bestScore = score;
      best = cp;
    }
  }
  return best;
}

function appendRosterAddition(
  map: Map<TeamId, PlayerId[]>,
  teamId: TeamId,
  playerId: PlayerId,
): void {
  let list = map.get(teamId);
  if (!list) {
    list = [];
    map.set(teamId, list);
  }
  list.push(playerId);
}

/**
 * Accept a trade-up offer aimed at your slot.
 *
 * The deal then executes exactly as an NPC-accepted one would — same asset
 * flip, same per-team trade-up count, same committed-sweetener locking. You
 * gave up the slot, so the session moves on to whoever now owns it.
 */
export function acceptTradeOffer(session: DraftSession): TradeUpRecord | null {
  const offer = session.pendingOffer;
  if (!offer) throw new Error('acceptTradeOffer: no offer is pending.');
  session.pendingOffer = null;
  return applyTradeUpProposal(session, offer);
}

/**
 * Decline a trade-up offer. The slot stays yours and the draft proceeds to your
 * pick.
 *
 * The declined proposal is discarded rather than re-offered: the slot's
 * trade-up check has already fired (`tradeUpCheckedIndex`), so the same deal
 * cannot come back around this slot. That mirrors a real war room — a rejected
 * call does not automatically ring again while you are on the clock.
 */
export function declineTradeOffer(session: DraftSession): void {
  if (!session.pendingOffer) throw new Error('declineTradeOffer: no offer is pending.');
  session.pendingOffer = null;
}

/** The offer awaiting an answer, if any. */
export function pendingTradeOffer(session: DraftSession): TradeUpProposal | null {
  return session.pendingOffer;
}
