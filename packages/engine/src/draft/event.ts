import type { Prng } from '../prng/index.js';
import type { LeagueState } from '../types/league.js';
import type { CollegePlayer, DraftPickRecord, DraftPickAsset } from '../types/college.js';
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
 * The Rosen rule's reach (v0.154): a bust-grading franchise-dev QB only
 * stops settling his team for picks 1-3 — the real re-draft-over-the-kid
 * slots (Murray #1, Wilson #2, Williams #1). At 4-8 teams give the kid
 * the extra year.
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
 */
export function runDraft(
  prng: Prng,
  league: LeagueState,
  options: RunDraftOptions,
): DraftRunResult {
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

  const picks: DraftPickRecord[] = [];
  const newPlayers: Player[] = [];
  const newContracts: Contract[] = [];
  const rosterAdditions = new Map<TeamId, PlayerId[]>();
  const removed = new Set<PlayerId>();
  const consumedPickIds = new Set<DraftPickId>();
  const tradeUps: TradeUpRecord[] = [];

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
  // Rosen-aware desire for premier slots (v0.154): the 4-year franchise-dev
  // commitment doesn't survive a top-8 pick + a bust-grading kid.
  const qbPremierDesire = new Map<TeamId, number>();
  for (const team of Object.values(league.teams)) {
    qbDesire.set(team.identity.id, qbUpgradeDesire(team, league));
    qbPremierDesire.set(
      team.identity.id,
      qbUpgradeDesire(team, league, { premierSlot: true }),
    );
  }
  // Teams settled enough that they won't trade UP into the GOAT window for
  // a QB. Rebuilt when a QB pick zeroes a team's desire (32 entries; cheap).
  const buildQbSettledSet = (): Set<TeamId> => {
    const s = new Set<TeamId>();
    for (const [tid, d] of qbDesire) {
      if (d < QB_HUNT_DESIRE_MIN) s.add(tid);
    }
    return s;
  };
  let qbSettledTeams = buildQbSettledSet();

  // Pick-time needs snapshot (v0.147): each record stores the top of the
  // picking team's need list over the SAME league state the pick logic
  // consulted — live-computed needs are wrong the moment the rookie lands.
  // Memoized per team; rosters are frozen for the duration of the round.
  const needsMemo = new Map<TeamId, readonly Position[]>();

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

  // Pick ids already committed (swap + sweeteners) in trade-ups THIS round.
  // `fullDraftPicks` (league.draftPicks) is a snapshot that isn't updated
  // until applyDraftResult after the round, so without this a team trading
  // up twice in one round could re-offer the same sweetener (double-spend).
  const committedSweetenerIds = new Set<DraftPickId>();

  for (let i = 0; i < options.draftOrder.length; i++) {
    // Trade-up check fires BEFORE the pick so the picking team
    // reflects any same-round ownership flip. Only runs when the
    // caller provided `pickAssets` (the evaluator mutates the
    // working list).
    if (workingRoundAssets) {
      const overallPickAtSlot = startingOverallPick + i;
      const proposal = evaluateTradeUpForPick({
        onClockIndex: i,
        overallPick: overallPickAtSlot,
        round,
        seasonNumber: options.seasonNumber,
        workingRoundAssets,
        draftBoards: league.draftBoards,
        availableById,
        fullDraftPicks: league.draftPicks,
        tradeUpsFiredSoFar: tradeUps.length,
        tradeUpsByTeamSoFar: tradeUpsByTeam,
        teamContexts: teamContexts as Readonly<Record<TeamId, TeamChartContext>>,
        qbSettledTeams,
        committedSweetenerIds,
      });
      if (proposal) {
        applyTradeUpToWorkingAssets(workingRoundAssets, proposal);
        tradeUpsByTeam.set(
          proposal.tradingUpTeamId,
          (tradeUpsByTeam.get(proposal.tradingUpTeamId) ?? 0) + 1,
        );
        // Lock this deal's assets so a later same-round trade-up can't
        // re-offer them off the stale snapshot.
        committedSweetenerIds.add(proposal.swapAssetId);
        for (const id of proposal.currentDraftPickIds) committedSweetenerIds.add(id);
        for (const id of proposal.futurePickIds) committedSweetenerIds.add(id);
        tradeUps.push({
          seasonNumber: options.seasonNumber,
          round,
          overallPick: overallPickAtSlot,
          onClockTeamId: proposal.onClockTeamId,
          onClockAssetId: proposal.onClockAssetId,
          tradingUpTeamId: proposal.tradingUpTeamId,
          swapAssetId: proposal.swapAssetId,
          currentDraftPickIds: proposal.currentDraftPickIds,
          futurePickIds: proposal.futurePickIds,
          targetCollegePlayerId: proposal.targetCollegePlayerId,
          ratio: proposal.ratio,
        });
      }
    }

    const pickAsset = workingRoundAssets ? workingRoundAssets[i] : undefined;
    const teamId = pickAsset?.currentTeamId ?? options.draftOrder[i]!;
    const team = league.teams[teamId];
    if (!team) continue;

    const overallPick = startingOverallPick + i;
    const board = league.draftBoards[teamId] ?? [];

    // Captured BEFORE this pick mutates the desire maps — what the war room
    // acted on when it went on the clock (v0.147 snapshot). Inside the
    // premier window the Rosen-aware desire applies (a bust-grading dev QB
    // no longer settles the room).
    const rawQbDesire = qbDesire.get(teamId) ?? 0;
    const teamQbDesire =
      overallPick <= QB_ROSEN_MAX_PICK
        ? Math.max(rawQbDesire, qbPremierDesire.get(teamId) ?? 0)
        : rawQbDesire;
    const qbDesperateAtPick = rawQbDesire >= 1;
    let needsAtPick = needsMemo.get(teamId);
    if (!needsAtPick) {
      needsAtPick = computeTeamNeeds(team, league).slice(0, 5).map((n) => n.position);
      needsMemo.set(teamId, needsAtPick);
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
    let boardEntry: (typeof board)[number] | null = null;
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
    if (chosen && chosen.nflProjectedPosition !== 'QB' && team && teamQbDesire >= 1) {
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
    if (!chosen) break; // pool exhausted — abort the draft

    // Convert-to-need: if this team's board planned to play the prospect at a
    // different (convertible) spot, draft him there. The promoted player lines
    // up at the assigned position; the pick records what he converted FROM.
    const assignedPosition = boardEntry?.assignedPosition;
    const convertedFromPosition =
      assignedPosition && assignedPosition !== chosen.nflProjectedPosition
        ? chosen.nflProjectedPosition
        : undefined;
    const promoted = promoteProspectToPlayer(prng.fork(`pick:${overallPick}`), {
      prospect: chosen,
      teamId,
      signedOnTick: options.pickedOnTick,
      overallPick,
      ...(assignedPosition ? { assignedPosition } : {}),
    });
    newPlayers.push(promoted.player);
    newContracts.push(promoted.contract);
    appendRosterAddition(rosterAdditions, teamId, promoted.player.id);
    // A team that just took its QB is settled for the rest of this round.
    if (promoted.player.position === 'QB') {
      qbDesire.set(teamId, 0);
      qbPremierDesire.set(teamId, 0);
      qbSettledTeams = buildQbSettledSet();
    }
    availableById.delete(chosen.id);
    removed.add(chosen.id);

    picks.push({
      seasonNumber: options.seasonNumber,
      round,
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
      ...(convertedFromPosition ? { convertedFromPosition } : {}),
      ...(pickAsset
        ? { pickAssetId: pickAsset.id, originalTeamId: pickAsset.originalTeamId }
        : {}),
    });

    if (pickAsset) consumedPickIds.add(pickAsset.id);

    void team;
  }

  return {
    picks,
    newPlayers,
    newContracts,
    rosterAdditionsByTeam: rosterAdditions,
    removedFromCollegePool: removed,
    consumedPickIds,
    tradeUps,
  };
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
  for (const c of result.newContracts) contracts[c.id] = c;

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
