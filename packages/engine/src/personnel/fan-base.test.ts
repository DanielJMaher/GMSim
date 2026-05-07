import { describe, it, expect } from 'vitest';
import { Prng } from '../prng/index.js';
import { generateFanBase } from './fan-base.js';
import { MarketSize, FranchiseHistory } from '../types/enums.js';

describe('generateFanBase', () => {
  it('clamps every dimension to [1, 10] regardless of modifiers', () => {
    for (const market of Object.values(MarketSize)) {
      for (const history of Object.values(FranchiseHistory)) {
        for (let i = 0; i < 10; i++) {
          const fb = generateFanBase(new Prng(`${market}-${history}-${i}`), market, history);
          for (const v of Object.values(fb)) {
            expect(v).toBeGreaterThanOrEqual(1);
            expect(v).toBeLessThanOrEqual(10);
          }
        }
      }
    }
  });

  it('Lovable Loser franchises bump patience up (+3 modifier)', () => {
    // Sample many; mean patience for Lovable Loser markets should exceed
    // the unmodified mean for that market size.
    const ll = avgPatience(MarketSize.MEDIUM, FranchiseHistory.LOVABLE_LOSER);
    const baseline = avgPatience(MarketSize.MEDIUM, FranchiseHistory.PERENNIAL_CONTENDER);
    expect(ll).toBeGreaterThan(baseline + 1);
  });

  it('Recent Dynasty franchises drop patience and bump urgency', () => {
    const rd = sampleMany(MarketSize.LARGE, FranchiseHistory.RECENT_DYNASTY);
    expect(avg(rd.map((f) => f.championshipUrgency))).toBeGreaterThan(8);
    expect(avg(rd.map((f) => f.patienceLevel))).toBeLessThan(5);
  });

  it('Small markets are more patient than Large markets on average', () => {
    const small = avgPatience(MarketSize.SMALL, FranchiseHistory.PERENNIAL_CONTENDER);
    const large = avgPatience(MarketSize.LARGE, FranchiseHistory.PERENNIAL_CONTENDER);
    expect(small).toBeGreaterThan(large);
  });

  it('Large markets have higher analytics orientation than Small markets', () => {
    const large = avg(sampleMany(MarketSize.LARGE, FranchiseHistory.PERENNIAL_CONTENDER).map((f) => f.analyticsOrientation));
    const small = avg(sampleMany(MarketSize.SMALL, FranchiseHistory.PERENNIAL_CONTENDER).map((f) => f.analyticsOrientation));
    expect(large).toBeGreaterThan(small);
  });
});

function sampleMany(market: MarketSize, history: FranchiseHistory) {
  return Array.from({ length: 100 }, (_, i) =>
    generateFanBase(new Prng(`${market}-${history}-sample-${i}`), market, history),
  );
}

function avgPatience(market: MarketSize, history: FranchiseHistory): number {
  return avg(sampleMany(market, history).map((f) => f.patienceLevel));
}

function avg(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}
