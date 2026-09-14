/**
 * `departmentBoard` + `mediaBoard` — the war-room wall (SCOUTING_PROCESS.md §3
 * and §7; the Board screen reads these).
 *
 * Daniel's ruling for this surface is "hands-on evaluator": you read the
 * reports and you move names on YOUR board. The board the player edits is
 * save-side state, not engine state — the engine keeps no player-team privilege
 * (invariant #4). What the engine owes the screen is the two boards the player
 * is judging *against*: their own department's composite, and the media
 * consensus. The divergence between those two and the player's own ordering is
 * the read-to-learn payoff — §3's "your board #12 · scouts #19 · media #31".
 *
 * ## What gets stripped
 *
 * `DraftBoardEntry` is an engine record, and three of its fields cannot cross:
 *
 *   - `priority` — the composite numeric score that produced the ordering. The
 *     ordering itself is the point; the score is a rating.
 *   - `observedSkillScore` — the team's confidence-weighted belief about the
 *     prospect's skill level, as a number. Perceived rather than true, but
 *     "a React prop typed `{ speed: 88 }` is broken by definition" does not
 *     care whether the 88 was perceived.
 *   - `schemeFit` — a multiplier whose own docstring says it "uses true
 *     archetype". It is computed FROM ground truth, so it is a channel out of
 *     it regardless of how it looks.
 *
 * `meanConfidence` becomes a qualitative label through `confidenceLabel`,
 * sharing `snapshot.ts`'s vocabulary. `reason` survives verbatim — it is the
 * attributed rationale §7 explicitly asks for ("BLUE_CHIP", "POSITIONAL_NEED"),
 * a word rather than a number. Rank survives, because a rank is what a board IS.
 *
 * `MockBoardEntry.grade` is stripped for the same reason as `priority`; its
 * `projectedOverallPick` is kept, since a mock board's whole published content
 * is where it slots people.
 */

import type { PlayerId, TeamId } from '../types/ids.js';
import type { Position } from '../types/enums.js';
import type { DraftBoardReason } from '../types/college.js';
import { computeMediaConsensusBoard } from '../media/mock-boards.js';
import { confidenceLabel, type ConfidenceLabel } from './snapshot.js';
import { asGameLeague, unwrapGameLeague, type GameLeague } from './game-session.js';

/** One name on a board, as the room may see it. */
export interface BoardRowView {
  /** 1-based position on this board. */
  rank: number;
  prospectId: PlayerId;
  firstName: string;
  lastName: string;
  /** Where this board would play him — which may not be his college position. */
  projectedPosition: Position;
  /** His college position, when the board is projecting a conversion. */
  collegePosition: Position;
  schoolId: string;
  /** Why he is on the board at all. A word, never a score. */
  reason: DraftBoardReason;
  /** How firmly the department holds its read. */
  confidence: ConfidenceLabel;
  /** How many independent reports this club has filed on him. */
  observationCount: number;
  /**
   * Flagged for a top-30 visit. The flag is not decoration: visits auto-spend
   * against it, so this is the player's one lever on the scarce deep look.
   */
  visitRequested: boolean;
  /**
   * Where the media consensus slots him, for §3's divergence gutter. Null when
   * the outlets have not ranked him — itself a signal, since a name your
   * department likes and the media has never heard of is the sleeper case.
   */
  mediaRank: number | null;
}

/** One name on the published media consensus. */
export interface MediaBoardRowView {
  rank: number;
  prospectId: PlayerId;
  firstName: string;
  lastName: string;
  projectedPosition: Position;
  schoolId: string;
}

/** Default board depth — matches the engine's own per-team board depth. */
const DEFAULT_DEPTH = 50;

/**
 * The media consensus board: every outlet's evaluators pooled.
 *
 * Deliberately UNWEIGHTED. `computeMediaConsensusBoard` accepts per-outlet
 * weights, and weighting by `accuracySpectrum` would produce a sharper
 * consensus than the press collectively deserves — and would quietly encode
 * the reliability ranking the player is supposed to learn by watching. A flat
 * pool is both the honest media consensus and the boundary-safe one.
 */
export function mediaBoard(handle: GameLeague, depth = DEFAULT_DEPTH): readonly MediaBoardRowView[] {
  const league = unwrapGameLeague(handle);
  const entries = computeMediaConsensusBoard(league.mediaCollegeObservations, depth);
  const rows: MediaBoardRowView[] = [];
  for (const e of entries) {
    const cp = league.collegePool.find((c) => c.id === e.prospectId);
    if (!cp) continue;
    rows.push({
      rank: e.projectedOverallPick,
      prospectId: e.prospectId,
      firstName: cp.firstName,
      lastName: cp.lastName,
      projectedPosition: cp.nflProjectedPosition,
      schoolId: cp.schoolId,
    });
  }
  return rows;
}

/**
 * One club's own department board — the composite its scouts produced, which is
 * what the player's board is seeded from (§3: "seeded, not blank"). A player
 * who never touches their board is playing their scouts' board, and its quality
 * is their scouts' quality. That is the design's intended danger.
 */
export function departmentBoard(
  handle: GameLeague,
  teamId: TeamId,
  depth = DEFAULT_DEPTH,
): readonly BoardRowView[] {
  const league = unwrapGameLeague(handle);
  const entries = league.draftBoards[teamId] ?? [];
  const requested = new Set((league.visitRequests[teamId] ?? []).map(String));

  const mediaRankById = new Map<string, number>();
  for (const row of mediaBoard(handle, depth)) {
    mediaRankById.set(String(row.prospectId), row.rank);
  }

  const rows: BoardRowView[] = [];
  entries.slice(0, depth).forEach((entry, i) => {
    const cp = league.collegePool.find((c) => c.id === entry.collegePlayerId);
    if (!cp) return;
    rows.push({
      rank: i + 1,
      prospectId: entry.collegePlayerId,
      firstName: cp.firstName,
      lastName: cp.lastName,
      projectedPosition: entry.assignedPosition ?? cp.nflProjectedPosition,
      collegePosition: cp.collegePosition,
      schoolId: cp.schoolId,
      reason: entry.reason,
      confidence: confidenceLabel(entry.meanConfidence),
      observationCount: entry.observationCount,
      visitRequested: requested.has(String(entry.collegePlayerId)),
      mediaRank: mediaRankById.get(String(entry.collegePlayerId)) ?? null,
    });
  });
  return rows;
}

/**
 * Flag or unflag a prospect for a top-30 visit.
 *
 * This is the whole visit mechanic in alpha. SCOUTING_PROCESS §5 designed a
 * spending screen around the 30 visits; Daniel cut that screen (2026-09-12) but
 * kept the teeth by having visits AUTO-SPEND against these flags. So the flag is
 * the lever: `runCoachVisits` honours requested prospects first, in the order
 * they were flagged, then fills remaining slots from the board top-down.
 *
 * Without this, cutting the screen would have removed the design's danger
 * entirely — §5 calls visits "the ONLY reliable access to the flags that
 * consensus hides", so a player with no way to direct them cannot outperform
 * consensus on character or medical no matter how well they scout.
 *
 * Returns a new handle; the caller swaps it in.
 */
export function requestVisit(
  handle: GameLeague,
  teamId: TeamId,
  prospectId: PlayerId,
  wanted = true,
): GameLeague {
  const league = unwrapGameLeague(handle);
  const current = league.visitRequests[teamId] ?? [];
  const has = current.some((id) => String(id) === String(prospectId));

  let nextList: readonly PlayerId[];
  if (wanted) {
    if (has) return handle;
    nextList = [...current, prospectId];
  } else {
    if (!has) return handle;
    nextList = current.filter((id) => String(id) !== String(prospectId));
  }

  return asGameLeague({
    ...league,
    visitRequests: { ...league.visitRequests, [teamId]: nextList },
  });
}
