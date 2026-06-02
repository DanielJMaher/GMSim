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

  it('a sharp outlet reads closer to the truth than a noisy one', () => {
    // We measure the property directly via READ ERROR (mean |perceived −
    // real| overall grade), pooled across seeds. This is far more robust than
    // the within-group rank-correlation used previously: the media covers only
    // ~50 names split across 7 groups, all outlets carry a shared misread
    // (v0.91), and the 2026-06 linked-rating + Slice-3 generation tightened
    // within-group skill spread — so rank-correlation no longer separates a
    // sharp from a noisy outlet (it sat on a knife edge and flipped). Read
    // error does: a high-accuracy outlet's reads are closer to truth by
    // construction, and that holds cleanly in aggregate.
    const cpById = new Map<string, CollegePlayer>();
    const perceivedOverall = (o: CollegePlayerObservation): number => {
      const vals = Object.values(o.skills).filter((v): v is number => typeof v === 'number');
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN;
    };
    const outletIdOf = (scoutId: string): string => scoutId.split('::')[0] ?? scoutId;

    let sharpErr = 0;
    let sharpN = 0;
    let noisyErr = 0;
    let noisyN = 0;
    for (const seed of ['mq-a', 'mq-b', 'mq-c', 'mq-d', 'mq-e', 'mq-f', 'mq-g', 'mq-h']) {
      const league = createLeague({ seed });
      cpById.clear();
      for (const cp of league.collegePool) cpById.set(cp.id, cp);
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

      for (const o of observations) {
        const cp = cpById.get(o.collegePlayerId);
        if (!cp) continue;
        const err = Math.abs(perceivedOverall(o) - realGrade(cp));
        if (Number.isNaN(err)) continue;
        const oid = outletIdOf(o.scoutId);
        if (oid === sharp.id) {
          sharpErr += err;
          sharpN += 1;
        } else if (oid === noisy.id) {
          noisyErr += err;
          noisyN += 1;
        }
      }
    }
    expect(sharpN).toBeGreaterThan(0);
    expect(noisyN).toBeGreaterThan(0);
    // The sharp outlet's reads are closer to the truth (lower mean error).
    expect(sharpErr / sharpN).toBeLessThan(noisyErr / noisyN);
  });
});
