/**
 * Media reliability quality metric (v0.89).
 *
 * "Is the media board sensible?" — answered per position group, per outlet.
 * For each group an outlet covers, we measure how well its read ORDERS the
 * prospects against the real board (rank correlation) and how it TILTS them
 * (mean signed bias). This is the legible payoff of per-group reliability:
 *
 *   - high rank correlation in a group  → the outlet sorts QBs correctly;
 *     trust its QB board even if it's optimistic.
 *   - low / negative correlation         → its OL takes are noise (or hype);
 *     don't trust where it puts OL.
 *   - mean bias                          → the optimism tilt: +bias = it
 *     reads the group high, -bias = low.
 *
 * Rank correlation (Spearman) is robust to the near-flat real-grade
 * distribution that made the old "N of top-32 outside real top-50"
 * diagnostic an artifact — it asks whether the ORDER is right, not whether
 * absolute grades land in an arbitrary band.
 *
 * Pure + display-only. No ground truth leaks into the game UI; this is a
 * dev/inspector + diagnostic instrument (and the substrate a future
 * GM-consumes-media slice can learn from).
 */

import type { CollegePlayer, CollegePlayerObservation } from '../types/college.js';
import type { PositionGroup } from '../types/enums.js';
import { positionGroupFor } from '../players/position-group.js';

export interface OutletGroupQuality {
  group: PositionGroup;
  /**
   * Spearman rank correlation of the outlet's read vs the real grade among
   * the prospects in this group it covered. -1..1, or null when too few
   * prospects (< MIN_SAMPLE) to be meaningful.
   */
  rankCorrelation: number | null;
  /** Mean signed bias (perceived - real) across the group — the tilt. */
  meanBias: number;
  /** How many prospects in this group the outlet graded. */
  sampleSize: number;
}

/** Below this many prospects, a correlation is noise — report null. */
const MIN_SAMPLE = 4;

function meanCurrent(cp: CollegePlayer): number {
  const vals = Object.values(cp.current) as number[];
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function obsOverall(o: CollegePlayerObservation): { overall: number; conf: number } {
  const sv = Object.values(o.skills).filter((v): v is number => typeof v === 'number');
  const cv = Object.values(o.confidence).filter((v): v is number => typeof v === 'number');
  return {
    overall: sv.length ? sv.reduce((a, b) => a + b, 0) / sv.length : 0,
    conf: cv.length ? cv.reduce((a, b) => a + b, 0) / cv.length : 0,
  };
}

function outletIdOf(scoutId: string): string {
  return scoutId.split('::')[0] ?? scoutId;
}

/** Average-rank vector for ties-aware Spearman. */
function ranks(values: readonly number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const r = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.v === order[i]!.v) j += 1;
    const avgRank = (i + j) / 2 + 1; // 1-indexed average rank over the tie group
    for (let k = i; k <= j; k++) r[order[k]!.i] = avgRank;
    i = j + 1;
  }
  return r;
}

/** Pearson correlation; returns null when either side has zero variance. */
function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  const n = xs.length;
  if (n === 0) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i]!;
    my += ys[i]!;
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

function spearman(perceived: readonly number[], real: readonly number[]): number | null {
  if (perceived.length < MIN_SAMPLE) return null;
  return pearson(ranks(perceived), ranks(real));
}

/**
 * Per-group reliability for a single outlet. Pass the full media
 * observation stream + the college pool; returns one row per position
 * group the outlet graded (groups it never covered are omitted).
 */
export function computeOutletQualityByGroup(
  observations: readonly CollegePlayerObservation[],
  pool: readonly CollegePlayer[],
  outletId: string,
): OutletGroupQuality[] {
  const cpById = new Map(pool.map((cp) => [cp.id as string, cp] as const));

  // Confidence-weighted perceived grade per prospect for THIS outlet.
  const perProspect = new Map<string, { wsum: number; csum: number }>();
  for (const o of observations) {
    if (outletIdOf(o.scoutId) !== outletId) continue;
    const { overall, conf } = obsOverall(o);
    if (conf <= 0) continue;
    const cur = perProspect.get(o.collegePlayerId) ?? { wsum: 0, csum: 0 };
    cur.wsum += overall * conf;
    cur.csum += conf;
    perProspect.set(o.collegePlayerId, cur);
  }

  const byGroup = new Map<PositionGroup, { perceived: number[]; real: number[]; biasSum: number }>();
  for (const [pid, { wsum, csum }] of perProspect) {
    const cp = cpById.get(pid);
    if (!cp || csum <= 0) continue;
    const perceived = wsum / csum;
    const real = meanCurrent(cp);
    const group = positionGroupFor(cp.nflProjectedPosition);
    const bucket = byGroup.get(group) ?? { perceived: [], real: [], biasSum: 0 };
    bucket.perceived.push(perceived);
    bucket.real.push(real);
    bucket.biasSum += perceived - real;
    byGroup.set(group, bucket);
  }

  const rows: OutletGroupQuality[] = [];
  for (const [group, { perceived, real, biasSum }] of byGroup) {
    rows.push({
      group,
      rankCorrelation: spearman(perceived, real),
      meanBias: biasSum / perceived.length,
      sampleSize: perceived.length,
    });
  }
  return rows;
}
