/**
 * Media mock draft boards (v0.72) — the "32 mocks, no global consensus"
 * output, built on slice 1's media observation stream.
 *
 * Each outlet's board is its evaluators' confidence-weighted read of the
 * class, ranked into projected overall picks. Because slice 1 baked the
 * outlet's hype bias into those observations, a high-hype outlet's mock
 * over-rates the flashy names — so the boards genuinely diverge, both
 * from each other and from the scouting room. The media-consensus board
 * pools every outlet's evaluators.
 *
 * Pure + derived: computed on demand from `mediaCollegeObservations`
 * (no stored board state). Same grade math as the Draft Shift view, so
 * the numbers line up.
 */

import type { CollegePlayerObservation } from '../types/college.js';
import type { PlayerSkills } from '../types/player.js';
import type { PlayerId } from '../types/ids.js';

export interface MockBoardEntry {
  prospectId: PlayerId;
  /** 1-based projected overall pick (= board rank). */
  projectedOverallPick: number;
  /** Confidence-weighted observed grade that produced the ranking. */
  grade: number;
}

function observationOverall(obs: CollegePlayerObservation): { overall: number; conf: number } {
  const skills = obs.skills as Readonly<Record<keyof PlayerSkills, number | undefined>>;
  const confidence = obs.confidence as Readonly<Record<keyof PlayerSkills, number | undefined>>;
  let sSum = 0;
  let sN = 0;
  let cSum = 0;
  let cN = 0;
  for (const v of Object.values(skills)) {
    if (typeof v === 'number') {
      sSum += v;
      sN += 1;
    }
  }
  for (const v of Object.values(confidence)) {
    if (typeof v === 'number') {
      cSum += v;
      cN += 1;
    }
  }
  return { overall: sN > 0 ? sSum / sN : 0, conf: cN > 0 ? cSum / cN : 0 };
}

/**
 * Rank prospects by confidence-weighted grade over the observations that
 * pass `accept`, into a depth-capped board of projected picks.
 */
function buildBoard(
  observations: readonly CollegePlayerObservation[],
  accept: (scoutId: string) => boolean,
  depth: number,
): MockBoardEntry[] {
  const agg = new Map<PlayerId, { wsum: number; csum: number }>();
  for (const obs of observations) {
    if (!accept(obs.scoutId)) continue;
    const { overall, conf } = observationOverall(obs);
    if (conf <= 0) continue;
    const cur = agg.get(obs.collegePlayerId) ?? { wsum: 0, csum: 0 };
    cur.wsum += overall * conf;
    cur.csum += conf;
    agg.set(obs.collegePlayerId, cur);
  }

  const graded: Array<{ prospectId: PlayerId; grade: number }> = [];
  for (const [prospectId, { wsum, csum }] of agg) {
    if (csum > 0) graded.push({ prospectId, grade: wsum / csum });
  }
  graded.sort(
    (a, b) =>
      b.grade - a.grade ||
      (a.prospectId < b.prospectId ? -1 : a.prospectId > b.prospectId ? 1 : 0),
  );

  return graded.slice(0, depth).map((g, i) => ({
    prospectId: g.prospectId,
    projectedOverallPick: i + 1,
    grade: g.grade,
  }));
}

/** One outlet's mock board (only its own evaluators' observations). */
export function computeOutletMockBoard(
  mediaObservations: readonly CollegePlayerObservation[],
  outletId: string,
  depth = 50,
): MockBoardEntry[] {
  const prefix = `${outletId}::`;
  return buildBoard(mediaObservations, (scoutId) => scoutId.startsWith(prefix), depth);
}

/** The media-consensus board — every outlet's evaluators pooled. */
export function computeMediaConsensusBoard(
  mediaObservations: readonly CollegePlayerObservation[],
  depth = 50,
): MockBoardEntry[] {
  return buildBoard(mediaObservations, () => true, depth);
}
