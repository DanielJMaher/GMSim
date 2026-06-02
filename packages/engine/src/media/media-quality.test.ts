import { describe, it, expect } from 'vitest';
import { computeOutletQualityByGroup } from './media-quality.js';
import { generateMediaCollegeObservations } from './prospect-evaluators.js';
import { createLeague } from '../league/generate.js';
import { Prng } from '../prng/index.js';
import { ScoutId } from '../types/ids.js';
import { positionGroupFor } from '../players/position-group.js';
import type { CollegePlayer, CollegePlayerObservation } from '../types/college.js';

const OUTLET = 'MO_test_outlet';

function realGrade(cp: CollegePlayer): number {
  const vals = Object.values(cp.current) as number[];
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** One fabricated observation pinning a prospect's perceived grade. */
function obs(cp: CollegePlayer, perceived: number): CollegePlayerObservation {
  return {
    scoutId: ScoutId(`${OUTLET}::e0`),
    collegePlayerId: cp.id,
    observedOnTick: 0,
    skills: { speed: Math.round(perceived) },
    confidence: { speed: 1 },
  };
}

describe('computeOutletQualityByGroup', () => {
  it('perfect read → rank correlation ~1, ~zero bias', () => {
    const league = createLeague({ seed: 'mq-perfect' });
    const qbs = league.collegePool
      .filter((cp) => positionGroupFor(cp.nflProjectedPosition) === 'QB')
      .slice(0, 8);
    expect(qbs.length).toBeGreaterThanOrEqual(4);

    // Perceived == real → identical ordering.
    const observations = qbs.map((cp) => obs(cp, realGrade(cp)));
    const rows = computeOutletQualityByGroup(observations, league.collegePool, OUTLET);
    const qb = rows.find((r) => r.group === 'QB')!;
    expect(qb.sampleSize).toBe(qbs.length);
    expect(qb.rankCorrelation).not.toBeNull();
    expect(qb.rankCorrelation!).toBeGreaterThan(0.95); // ~1, modulo integer-rounding ties
    expect(Math.abs(qb.meanBias)).toBeLessThan(1); // only rounding
  });

  it('reversed read → rank correlation ~-1', () => {
    const league = createLeague({ seed: 'mq-reversed' });
    const qbs = league.collegePool
      .filter((cp) => positionGroupFor(cp.nflProjectedPosition) === 'QB')
      .slice(0, 8);
    const observations = qbs.map((cp) => obs(cp, 100 - realGrade(cp)));
    const rows = computeOutletQualityByGroup(observations, league.collegePool, OUTLET);
    const qb = rows.find((r) => r.group === 'QB')!;
    expect(qb.rankCorrelation!).toBeLessThan(-0.95); // ~-1, modulo integer-rounding ties
  });

  it('uniformly optimistic read → positive bias, correlation preserved', () => {
    const league = createLeague({ seed: 'mq-bias' });
    const qbs = league.collegePool
      .filter((cp) => positionGroupFor(cp.nflProjectedPosition) === 'QB')
      .slice(0, 6);
    const observations = qbs.map((cp) => obs(cp, Math.min(100, realGrade(cp) + 8)));
    const rows = computeOutletQualityByGroup(observations, league.collegePool, OUTLET);
    const qb = rows.find((r) => r.group === 'QB')!;
    expect(qb.meanBias).toBeGreaterThan(5);
    // A constant offset doesn't change the ordering (modulo the 100 cap).
    expect(qb.rankCorrelation!).toBeGreaterThan(0.8);
  });

  it('too few prospects in a group → null correlation', () => {
    const league = createLeague({ seed: 'mq-small' });
    const qbs = league.collegePool
      .filter((cp) => positionGroupFor(cp.nflProjectedPosition) === 'QB')
      .slice(0, 2);
    const observations = qbs.map((cp) => obs(cp, realGrade(cp)));
    const rows = computeOutletQualityByGroup(observations, league.collegePool, OUTLET);
    const qb = rows.find((r) => r.group === 'QB');
    expect(qb?.rankCorrelation ?? null).toBeNull();
  });

  it('a sharp outlet out-correlates a noisy one across seeds', () => {
    // Per-group correlations are small-sample (the media covers only the
    // top ~50 names, split across 7 groups) and, since v0.91, every outlet
    // carries the same shared misread — so a single seed / single group is
    // noisy and can flip. Aggregate a sample-size-weighted mean correlation
    // across several seeds: the sharp outlet should win in aggregate.
    let sharpTotal = 0;
    let noisyTotal = 0;
    // More seeds = more statistical power. The 2026-06 linked-rating
    // generation tightened within-group skill spread, shrinking the sharp-vs-
    // noisy gap per seed, so 5 seeds became under-powered (the true effect —
    // sharp out-correlates noisy — held on average but flipped on a thin
    // 5-seed sum). Averaging over 12 seeds restores a reliable margin.
    for (const seed of [
      'mq-a', 'mq-b', 'mq-c', 'mq-d', 'mq-e', 'mq-f',
      'mq-g', 'mq-h', 'mq-i', 'mq-j', 'mq-k', 'mq-l',
    ]) {
      const league = createLeague({ seed });
      const observations = generateMediaCollegeObservations(
        new Prng('mq'),
        league.mediaOutlets,
        league.collegePool,
        0,
        { readsPerEvaluator: 60 },
      );
      const college = Object.values(league.mediaOutlets).filter((o) => o.focus === 'COLLEGE');
      const sharp = college.reduce((a, b) => (b.accuracySpectrum > a.accuracySpectrum ? b : a));
      const noisy = college.reduce((a, b) => (b.accuracySpectrum < a.accuracySpectrum ? b : a));
      if (sharp.accuracySpectrum <= noisy.accuracySpectrum) continue;

      const weightedCorr = (outletId: string) => {
        const rows = computeOutletQualityByGroup(observations, league.collegePool, outletId).filter(
          (r) => r.rankCorrelation !== null,
        );
        let ws = 0;
        let w = 0;
        for (const r of rows) {
          ws += (r.rankCorrelation ?? 0) * r.sampleSize;
          w += r.sampleSize;
        }
        return w > 0 ? ws / w : 0;
      };
      sharpTotal += weightedCorr(sharp.id);
      noisyTotal += weightedCorr(noisy.id);
    }
    expect(sharpTotal).toBeGreaterThan(noisyTotal);
  });
});
