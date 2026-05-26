/**
 * Combine athleticism (shared primitive, extracted v0.76).
 *
 * A prospect's athleticism as the mean drill percentile within the
 * combine field (lower-is-better drills inverted). Non-attendees and
 * prospects without combine data score 0 — so this is naturally
 * combine-gated: before a class has run the combine, every prospect
 * scores 0 and any athleticism-driven effect is a no-op.
 *
 * Consumed by scout sleepers (the MEASURABLES channel) and the media's
 * combine-reactive read — both rank workout-warriors off the same
 * percentile field so a freak athlete rates the same to a scout and a
 * media evaluator.
 */

import type { CollegePlayer, CombineMeasurables } from '../types/college.js';
import type { PlayerId } from '../types/ids.js';

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Per-prospect athleticism, 0..1, as the mean drill percentile within
 * the supplied field (lower-is-better drills inverted). Non-attendees
 * and prospects without combine data score 0.
 *
 * The field (`eligible`) is the comparison set the percentiles are taken
 * over — pass the declared draft-eligible pool so a 4.3 forty rates as
 * elite regardless of which subset a given consumer covers.
 */
export function computeCombineAthleticism(
  eligible: readonly CollegePlayer[],
  combine: Readonly<Record<string, CombineMeasurables>>,
): Map<PlayerId, number> {
  type Drill = { key: keyof CombineMeasurables; lowerBetter: boolean };
  const drills: Drill[] = [
    { key: 'fortyYardSeconds', lowerBetter: true },
    { key: 'verticalInches', lowerBetter: false },
    { key: 'broadJumpInches', lowerBetter: false },
    { key: 'benchPress225Reps', lowerBetter: false },
    { key: 'threeConeSeconds', lowerBetter: true },
    { key: 'shuttleSeconds', lowerBetter: true },
  ];

  // Sorted value lists per drill (attendees only) for percentile lookup.
  const sortedByDrill = new Map<string, number[]>();
  for (const d of drills) {
    const vals: number[] = [];
    for (const cp of eligible) {
      const m = combine[cp.id];
      const v = m?.attended ? (m[d.key] as number | undefined) : undefined;
      if (typeof v === 'number') vals.push(v);
    }
    vals.sort((a, b) => a - b);
    sortedByDrill.set(d.key, vals);
  }

  const athleticism = new Map<PlayerId, number>();
  for (const cp of eligible) {
    const m = combine[cp.id];
    if (!m?.attended) {
      athleticism.set(cp.id, 0);
      continue;
    }
    let sum = 0;
    let n = 0;
    for (const d of drills) {
      const v = m[d.key] as number | undefined;
      if (typeof v !== 'number') continue;
      const sorted = sortedByDrill.get(d.key)!;
      if (sorted.length < 2) continue;
      // Percentile = fraction of the field this value beats.
      const below = lowerBound(sorted, v);
      let pct = below / (sorted.length - 1);
      if (d.lowerBetter) pct = 1 - pct;
      sum += clamp01(pct);
      n += 1;
    }
    athleticism.set(cp.id, n > 0 ? sum / n : 0);
  }
  return athleticism;
}

function lowerBound(sorted: readonly number[], v: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
