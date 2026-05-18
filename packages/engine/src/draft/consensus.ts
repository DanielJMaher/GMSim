/**
 * Consensus board derivation — diagnostic-only.
 *
 * Per Doc 3: "No global consensus anything. Per-team boards, per-team
 * observations." This module computes a consensus view by aggregating
 * the 32 per-team boards, but the engine itself never consumes the
 * consensus — no team behavior depends on it. It exists purely so the
 * inspector can render per-pick "reach delta" diagnostics:
 *
 *   pickReach = teamBoardRank − consensusRank
 *
 * High reaches (a player picked at consensus rank #80 but #3 on the
 * picking team's board) flag a board that diverges sharply from the
 * league. Doc 3 explicitly says the variance IS the system — but a
 * sanity check that the variance distribution is plausible (rather
 * than pathological) is the kind of thing that wants live visibility.
 *
 * Pure function. No PRNG. Cheap enough to recompute per-render in
 * the inspector; no caching needed at the engine layer.
 */

import type { TeamId, PlayerId } from '../types/ids.js';
import type { DraftBoardEntry } from '../types/college.js';

export interface ConsensusBoardEntry {
  collegePlayerId: PlayerId;
  /**
   * Average priority across the teams that have this prospect on
   * their board. Teams that don't carry the prospect contribute
   * nothing — Doc 3 treats absence as "this team's evaluators
   * didn't see/value the prospect," not as a 0.
   */
  averagePriority: number;
  /**
   * Number of teams (out of the league-wide 32) that have this
   * prospect anywhere on their top-N board. Convergence signal —
   * `appearances === 32` is true consensus blue-chip; low counts
   * mean a niche fit somewhere.
   */
  appearances: number;
  /**
   * Average board rank across the teams that have the prospect (1
   * = top of board, lower numbers = higher on board). Aligns with
   * Doc 3's "draft day reach/steal" framing — if a player's
   * average rank across the league is 80 and they're picked #1
   * overall, that's the marquee reach.
   */
  averageRank: number;
}

/**
 * Compute the consensus board from per-team draft boards. Returns
 * entries sorted descending by `averagePriority` — the consensus
 * top of the board comes first.
 *
 * Empty input → empty output. Teams without a board (missing from
 * the input record) are silently skipped.
 */
export function computeConsensusBoard(
  perTeamBoards: Readonly<Record<TeamId, readonly DraftBoardEntry[]>>,
): ConsensusBoardEntry[] {
  // Aggregate per prospect: sum of priorities, sum of ranks, count.
  interface Acc {
    prioritySum: number;
    rankSum: number;
    count: number;
  }
  const byId = new Map<PlayerId, Acc>();

  for (const board of Object.values(perTeamBoards)) {
    for (let r = 0; r < board.length; r++) {
      const entry = board[r]!;
      const rank = r + 1;
      const acc = byId.get(entry.collegePlayerId);
      if (acc) {
        acc.prioritySum += entry.priority;
        acc.rankSum += rank;
        acc.count += 1;
      } else {
        byId.set(entry.collegePlayerId, {
          prioritySum: entry.priority,
          rankSum: rank,
          count: 1,
        });
      }
    }
  }

  const out: ConsensusBoardEntry[] = [];
  for (const [collegePlayerId, acc] of byId) {
    out.push({
      collegePlayerId,
      averagePriority: acc.prioritySum / acc.count,
      appearances: acc.count,
      averageRank: acc.rankSum / acc.count,
    });
  }

  out.sort((a, b) => b.averagePriority - a.averagePriority);
  return out;
}

/**
 * Index a consensus board by prospect id → its consensus rank
 * (1-based). Convenience for the inspector — looking up "what's
 * the consensus rank of the player picked at slot N" is the
 * primary read pattern for the reach-delta diagnostic.
 *
 * Prospects not on the consensus (zero appearances) are absent
 * from the result; callers should treat that as "off everyone's
 * board" (no consensus rank).
 */
export function consensusRankIndex(
  consensus: readonly ConsensusBoardEntry[],
): Map<PlayerId, number> {
  const out = new Map<PlayerId, number>();
  for (let i = 0; i < consensus.length; i++) {
    out.set(consensus[i]!.collegePlayerId, i + 1);
  }
  return out;
}
