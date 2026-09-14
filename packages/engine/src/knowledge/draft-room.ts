/**
 * `draftRoomView` + the draft-session facade — the theatre (W4 step 5's draft
 * room, and the M2 offer surface on top of it).
 *
 * ## Why a facade exists at all
 *
 * The stepped driver (`draft/event.ts`) is the right engine mechanism: one pick
 * per step, yielding at a supplied-decision team's slot, with NPC behaviour
 * byte-identical to batch mode. But a draft-room screen cannot call it —
 * `apps/game` may import `@gmsim/engine/knowledge` and nothing else, and the
 * boundary test enforces that. Per D1's own growing rule, a surface that needs
 * more EXTENDS the knowledge module rather than importing around it. This is
 * that extension.
 *
 * ## What gets stripped, and why each one matters
 *
 * `DraftPickRecord` is an audit record built for the inspector, and three of
 * its fields are hidden truth:
 *
 *   - `prospectProfile.tier` — a `TalentTier`. This is the prospect's REAL
 *     quality band. Showing it next to a pick would hand the player a perfect
 *     draft grade the instant a name came off the board, and retire the entire
 *     read-to-learn loop the scouting design is built on.
 *   - `boardPriorityAtPick` — the raw numeric board score. A rating by another
 *     name.
 *   - `qbDesperateAtPick` and, for rival clubs, `needsAtPick` — another team's
 *     internal decision model. The North Star's line is that you learn how
 *     rival GMs behave by WATCHING them, not by reading their need list.
 *
 * Board RANK survives, because a rank is what a board is. Your own club's
 * `needsAtPick` survives too: that is your own front office's read, which you
 * are entitled to.
 */

import type { PlayerId, TeamId } from '../types/ids.js';
import type { Position } from '../types/enums.js';
import type { ClassYear } from '../types/college.js';
import type { LeagueState } from '../types/league.js';
import { Prng } from '../prng/index.js';
import {
  beginDraft,
  stepDraft,
  submitPick,
  autoPick,
  finishDraft,
  isDraftComplete,
  applyDraftResult,
  acceptTradeOffer,
  declineTradeOffer,
  type DraftSession,
} from '../draft/index.js';
import type { DraftPickRecord } from '../types/college.js';
import type { TradeUpProposal } from '../draft/trade-up.js';
import { computeDraftOrder } from '../draft/draft-order.js';
import { buildSlotMap, picksForRoundInSlotOrder } from '../draft/picks.js';
import { computeRecords } from '../season/standings.js';
import { prospectSnapshot, type ProspectSnapshot } from './snapshot.js';
import type { TeamIdentityView } from './league-view.js';
import { asGameLeague, unwrapGameLeague, type GameLeague } from './game-session.js';

/** A pick as the room sees it land. No tier, no board score, no need model. */
export interface DraftPickView {
  round: number;
  overallPick: number;
  team: TeamIdentityView;
  prospectId: PlayerId;
  firstName: string;
  lastName: string;
  /** Where the club lined him up — their call, publicly visible once made. */
  draftedAtPosition: Position;
  /** The position he played in college, when the club is converting him. */
  convertedFromPosition: Position | null;
  schoolId: string;
  classYear: ClassYear;
  /**
   * Where he sat on the PICKING club's board. A rank, never a score. Null when
   * the pick came from outside the board entirely — which is itself the
   * interesting signal (a reach, or a supplied pick).
   */
  boardRankAtPick: number | null;
}

/** One name on the player's board, with the club's own read attached. */
export interface DraftBoardRowView {
  rank: number;
  prospectId: PlayerId;
  firstName: string;
  lastName: string;
  projectedPosition: Position;
  schoolId: string;
  /** Still available, or already gone. */
  available: boolean;
  /** The club's scouting read — attributed, qualitative, never numeric. */
  snapshot: ProspectSnapshot | null;
}

export interface DraftRoomView {
  /** Picks that have landed, in order. */
  picks: readonly DraftPickView[];
  /** The viewer's board, best first. */
  board: readonly DraftBoardRowView[];
  /** Set when the viewer is on the clock and the room is waiting on them. */
  onTheClock: { overallPick: number; round: number } | null;
  /** True once the round has run out of picks. */
  complete: boolean;
}

/**
 * A draft in progress, from the room's side. Opaque: the game holds it and
 * hands it back, exactly like `GameLeague`.
 */
export interface DraftRoom {
  /** @internal */
  session: DraftSession;
  /** @internal */
  league: LeagueState;
  /** @internal */
  viewerTeamId: TeamId;
  /** @internal */
  pending: { overallPick: number; round: number } | null;
  /** @internal */
  picks: DraftPickView[];
  /** @internal An offer awaiting your answer. */
  pendingOffer: TradeOfferView | null;
}

export interface OpenDraftRoomOptions {
  /** The club the player is running. Its picks wait for them. */
  viewerTeamId: TeamId;
  /** Round to run. Defaults to 1. */
  round?: number;
  /**
   * Which draft class to run. Defaults to `league.seasonNumber`, which is
   * correct in the normal lifecycle — by the time the offseason reaches the
   * draft, the season number has already advanced to the year being drafted
   * into.
   *
   * Worth overriding only outside that flow. A freshly generated league sits at
   * season 1 and carries picks for seasons 2-4, because season 1's draft
   * happened during genesis; opening a room there needs `seasonNumber: 2`.
   */
  seasonNumber?: number;
}

function identityOf(league: LeagueState, teamId: TeamId): TeamIdentityView {
  const t = league.teams[teamId];
  return t
    ? {
        teamId: t.identity.id,
        abbreviation: t.identity.abbreviation,
        location: t.identity.location,
        nickname: t.identity.nickname,
        fullName: t.identity.fullName,
        conference: t.identity.conference,
        division: t.identity.division,
      }
    : {
        teamId,
        abbreviation: '???',
        location: 'Unknown',
        nickname: 'Club',
        fullName: 'Unknown Club',
        conference: 'AFC' as TeamIdentityView['conference'],
        division: 'AFC_EAST' as TeamIdentityView['division'],
      };
}

/**
 * Project a landed pick. The prospect's public profile is snapshotted on the
 * record (v0.162) precisely because he leaves `collegePool` once drafted — so
 * the room can still name him afterwards without the engine retaining the pool.
 */
function pickView(league: LeagueState, record: DraftPickRecord): DraftPickView {
  // `prospectProfile` is destructured field-by-field on purpose: it also
  // carries `tier` (the prospect's REAL quality band) and `archetype`. A
  // spread here would ship both straight to the room.
  const profile = record.prospectProfile;
  const promoted = league.players[record.promotedPlayerId];
  const prospect = league.collegePool.find((cp) => cp.id === record.collegePlayerId);

  return {
    round: record.round,
    overallPick: record.overallPick,
    team: identityOf(league, record.teamId),
    prospectId: record.collegePlayerId,
    firstName: promoted?.firstName ?? prospect?.firstName ?? 'Unknown',
    lastName: promoted?.lastName ?? prospect?.lastName ?? 'Prospect',
    // Where the club actually lines him up: the promoted player's position is
    // the club's decision, including a conversion.
    draftedAtPosition:
      promoted?.position ?? profile?.nflProjectedPosition ?? prospect?.nflProjectedPosition ?? 'WR',
    convertedFromPosition: record.convertedFromPosition ?? null,
    schoolId: profile?.schoolId ?? prospect?.schoolId ?? '',
    classYear: profile?.classYear ?? prospect?.classYear ?? 'SR',
    boardRankAtPick: record.boardRankAtPick,
  };
}

/**
 * Open the draft room. The viewer's club is registered as externally
 * controlled, so the session stops at their slot instead of picking for them —
 * and, since the D7 seam fix, no trade-up is computed on their behalf either.
 */
export function openDraftRoom(handle: GameLeague, options: OpenDraftRoomOptions): DraftRoom {
  const league = unwrapGameLeague(handle);
  const round = options.round ?? 1;

  // Pick ASSETS, built the way the lifecycle builds them — not a bare
  // `draftOrder`. This is load-bearing, not bookkeeping: the trade-up evaluator
  // mutates the working asset list, so `proposeTradeUpAtSlot` returns null
  // immediately when assets are absent. Opening the room without them produced
  // a draft with NO trade-ups at all, measured at 0 offers across all 32
  // viewer clubs — which would have made the offers-to-you screen permanently
  // silent in the real game.
  const seasonNumber = options.seasonNumber ?? league.seasonNumber;
  const slotMap = buildSlotMap(computeDraftOrder(computeRecords(league)));
  const roundAssets = picksForRoundInSlotOrder(
    league.draftPicks,
    seasonNumber,
    round,
    slotMap,
  );

  // Fail LOUDLY rather than running a draft with nothing in it. An empty asset
  // list silently produces a zero-pick round with no trade-ups and no offers,
  // which is indistinguishable from "the feature is broken" -- and did in fact
  // read that way until this was measured (0 offers across all 32 clubs).
  if (roundAssets.length === 0) {
    const available = [...new Set(league.draftPicks.map((p) => p.seasonNumber))].sort();
    throw new Error(
      `openDraftRoom: no round-${round} picks exist for season ${seasonNumber}. ` +
        `Seasons with picks: ${available.join(", ") || "none"}. ` +
        'A freshly generated league sits at season 1 but carries picks from season 2 ' +
        'onward, because season 1 drafted during genesis -- pass seasonNumber explicitly.',
    );
  }

  const draftOrder = roundAssets.map((a) => a.currentTeamId);

  const session = beginDraft(new Prng(`${league.seed}::draft-${league.seasonNumber}`), league, {
    draftOrder,
    pickedOnTick: league.tick,
    seasonNumber,
    round,
    pickAssets: roundAssets,
    externallyControlledTeamIds: [options.viewerTeamId],
  });
  return {
    session,
    league,
    viewerTeamId: options.viewerTeamId,
    pending: null,
    picks: [],
    pendingOffer: null,
  };
}

/** What one step of the room produced. */
export type DraftRoomStep =
  | { kind: 'pick'; pick: DraftPickView }
  | { kind: 'trade-up'; overallPick: number; tradingUpTeam: TeamIdentityView }
  | { kind: 'on-the-clock'; overallPick: number; round: number }
  | { kind: 'trade-offer'; offer: TradeOfferView }
  | { kind: 'complete' };

/** Advance the room by one event. */
export function stepDraftRoom(room: DraftRoom): DraftRoomStep {
  if (room.pending) {
    return { kind: 'on-the-clock', overallPick: room.pending.overallPick, round: room.pending.round };
  }
  if (isDraftComplete(room.session)) return { kind: 'complete' };

  const step = stepDraft(room.session);
  switch (step.kind) {
    case 'pick': {
      const view = pickView(room.league, step.pick);
      room.picks.push(view);
      return { kind: 'pick', pick: view };
    }
    case 'trade-up':
      return {
        kind: 'trade-up',
        overallPick: step.tradeUp.overallPick,
        tradingUpTeam: identityOf(room.league, step.tradeUp.tradingUpTeamId),
      };
    case 'on-the-clock': {
      room.pending = { overallPick: step.overallPick, round: room.session.round };
      return { kind: 'on-the-clock', overallPick: step.overallPick, round: room.session.round };
    }

    case 'trade-offer': {
      // The phone rings. Nothing resolves until you answer.
      const offer = tradeOfferView(room, step.offer, step.overallPick);
      room.pendingOffer = offer;
      return { kind: 'trade-offer', offer };
    }
    default:
      return { kind: 'complete' };
  }
}

/** Make the viewer's pick. */
export function makeDraftPick(room: DraftRoom, prospectId: PlayerId): DraftPickView {
  const { pick } = submitPick(room.session, prospectId);
  room.pending = null;
  const view = pickView(room.league, pick);
  room.picks.push(view);
  return view;
}

/** Hand the viewer's pick back to the war room — "sim my pick". */
export function autoDraftPick(room: DraftRoom): DraftPickView | null {
  const result = autoPick(room.session);
  room.pending = null;
  if (!result) return null;
  const view = pickView(room.league, result.pick);
  room.picks.push(view);
  return view;
}

/**
 * The room as the player sees it: picks so far, their board with availability,
 * and whether they are on the clock.
 */
export function draftRoomView(room: DraftRoom): DraftRoomView {
  const league = room.league;
  const board = league.draftBoards[room.viewerTeamId] ?? [];
  const taken = new Set(room.picks.map((p) => String(p.prospectId)));
  const viewer = { kind: 'team', teamId: room.viewerTeamId } as const;

  const rows: DraftBoardRowView[] = [];
  board.forEach((entry, i) => {
    const cp = league.collegePool.find((c) => c.id === entry.collegePlayerId);
    if (!cp) return;
    rows.push({
      rank: i + 1,
      prospectId: entry.collegePlayerId,
      firstName: cp.firstName,
      lastName: cp.lastName,
      projectedPosition: entry.assignedPosition ?? cp.nflProjectedPosition,
      schoolId: cp.schoolId,
      available: !taken.has(String(entry.collegePlayerId)),
      snapshot: prospectSnapshot(league, viewer, entry.collegePlayerId),
    });
  });

  return {
    picks: room.picks,
    board: rows,
    onTheClock: room.pending,
    complete: isDraftComplete(room.session),
  };
}

/**
 * Close the room and fold its results into the league. Returns a new handle —
 * the game never mutates a league in place, it swaps the handle.
 */
export function closeDraftRoom(room: DraftRoom): GameLeague {
  return asGameLeague(applyDraftResult(room.league, finishDraft(room.session)));
}

/**
 * A trade-up offer for your slot, as the room presents it.
 *
 * What crosses: who is calling, what they are offering (their pick in this
 * round plus any sweeteners), and what it costs you (this slot). Those are the
 * terms of a deal being proposed TO you — you would hear all of it on the
 * phone.
 *
 * What does not: `ratio`. That is the engine's own valuation of the deal —
 * effectively a "this is a good trade" score — and handing it over would turn
 * a judgement call into a readout. Whether the haul is worth your slot is
 * exactly the decision the screen exists to make you take.
 */
export interface TradeOfferView {
  /** The slot they want. */
  overallPick: number;
  /** The club calling. */
  from: TeamIdentityView;
  /** Their pick in this round that would become yours. */
  swapPick: { round: number; overallPick: number | null };
  /** Later picks in THIS draft they are adding. */
  sweetenerPickCount: number;
  /** Picks in future drafts they are adding. */
  futurePickCount: number;
  /** The prospect they are moving up for, if your scouts know who he is. */
  targetProspect: { firstName: string; lastName: string; projectedPosition: Position } | null;
}

function tradeOfferView(room: DraftRoom, offer: TradeUpProposal, overallPick: number): TradeOfferView {
  const league = room.league;
  const cp = league.collegePool.find((c) => c.id === offer.targetCollegePlayerId);
  // Only name the target if this club has actually scouted him — otherwise the
  // offer itself would leak a prospect the room has never seen.
  const known =
    cp && (league.draftBoards[room.viewerTeamId] ?? []).some(
      (e) => String(e.collegePlayerId) === String(cp.id),
    );

  const swap = league.draftPicks?.find((p) => p.id === offer.swapAssetId);

  return {
    overallPick,
    from: identityOf(league, offer.tradingUpTeamId),
    swapPick: { round: swap?.round ?? 0, overallPick: null },
    sweetenerPickCount: offer.currentDraftPickIds.length,
    futurePickCount: offer.futurePickIds.length,
    targetProspect:
      known && cp
        ? {
            firstName: cp.firstName,
            lastName: cp.lastName,
            projectedPosition: cp.nflProjectedPosition,
          }
        : null,
  };
}

/** Accept the offer on the table. Your slot goes; their picks come back. */
export function acceptDraftTradeOffer(room: DraftRoom): void {
  acceptTradeOffer(room.session);
  room.pendingOffer = null;
}

/** Turn the offer down and keep your pick. */
export function declineDraftTradeOffer(room: DraftRoom): void {
  declineTradeOffer(room.session);
  room.pendingOffer = null;
}
