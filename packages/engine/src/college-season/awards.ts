/**
 * College awards (v0.67) — the Heisman race.
 *
 * Replaces the v0.63 placeholder ceremony with a real selection derived
 * from aggregated season production. The score is deliberately
 * passing-weighted (like the real award's QB bias) but lets elite
 * rushers, receivers, and disruptive defenders contend. Pure +
 * deterministic: same stat lines → same winner + finalists.
 */

import type {
  CollegeSeasonStatLine,
  HeismanResult,
} from '../types/college-season.js';

/**
 * Heisman score for one prospect's season line. Weights favor high-
 * volume passing (the award's real-world QB skew), reward rushing /
 * receiving production, penalize interceptions, and give defenders a
 * path via sacks + takeaways.
 */
export function heismanScore(line: CollegeSeasonStatLine): number {
  return (
    line.passingYards * 0.04 +
    line.passingTds * 4 -
    line.interceptionsThrown * 2 +
    line.rushingYards * 0.08 +
    line.rushingTds * 5 +
    line.receivingYards * 0.08 +
    line.receivingTds * 5 +
    line.tackles * 0.3 +
    line.sacks * 6 +
    line.interceptions * 8
  );
}

/**
 * Pick the Heisman winner + finalists from a season's stat lines.
 * Returns `null` if there's no production to judge. Finalists are in
 * descending score order with index 0 = winner.
 */
export function selectHeisman(
  lines: readonly CollegeSeasonStatLine[],
  seasonNumber: number,
  options: { finalistCount?: number } = {},
): HeismanResult | null {
  if (lines.length === 0) return null;
  const finalistCount = options.finalistCount ?? 5;

  const scored = lines
    .map((line) => ({
      playerId: line.playerId,
      schoolId: line.schoolId,
      score: heismanScore(line),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0),
    );

  const winner = scored[0]!;
  if (winner.score <= 0) return null;

  return {
    seasonNumber,
    winnerId: winner.playerId,
    winnerSchoolId: winner.schoolId,
    finalists: scored.slice(0, finalistCount),
  };
}
