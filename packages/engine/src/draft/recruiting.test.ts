import { describe, expect, it } from 'vitest';
import { Prng } from '../prng/index.js';
import { rollStarRatingByGrade } from './recruiting.js';
import type { TalentGrade } from '../types/player.js';

/** Blue-chip (4-5★) share for a grade across a large sample. */
function blueChipShare(grade: TalentGrade, n = 4000): number {
  let blue = 0;
  for (let i = 0; i < n; i++) {
    if (rollStarRatingByGrade(new Prng(`${grade}-${i}`), grade) >= 4) blue++;
  }
  return blue / n;
}

describe('rollStarRatingByGrade (pedigree curve)', () => {
  it('blue-chip share is monotonic in talent grade', () => {
    const order: TalentGrade[] = [
      'ELITE', 'STAR', 'HIGH_STARTER', 'STARTER', 'WEAK_STARTER', 'ROTATIONAL', 'BACKUP', 'FRINGE',
    ];
    const shares = order.map((g) => blueChipShare(g));
    for (let i = 1; i < shares.length; i++) {
      expect(shares[i]!).toBeLessThanOrEqual(shares[i - 1]!);
    }
  });

  it('elites are overwhelmingly blue-chip; the floor stays loose (busts + late risers)', () => {
    // True elites were nearly all highly recruited…
    expect(blueChipShare('ELITE')).toBeGreaterThan(0.8);
    // …but even the bottom grade keeps a non-trivial blue-chip tail (real
    // Day-3 picks are still ~33% former 4-5★ recruits who never panned out).
    const fringe = blueChipShare('FRINGE');
    expect(fringe).toBeGreaterThan(0.08);
    expect(fringe).toBeLessThan(0.22);
  });

  it('every grade can still produce any star (loose correlation — 5★ busts exist)', () => {
    // A FRINGE-grade prospect can be a former 5-star bust, an ELITE a 2-star gem.
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(rollStarRatingByGrade(new Prng(`f-${i}`), 'FRINGE'));
    expect(seen.has(5)).toBe(true);
    expect(seen.has(1)).toBe(true);
  });
});
