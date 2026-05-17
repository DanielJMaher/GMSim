import { describe, expect, it } from 'vitest';
import {
  recencyWeight,
  RECENCY_HALF_LIFE_TICKS,
  RECENCY_WEIGHT_FLOOR,
} from './recency.js';

describe('recencyWeight', () => {
  it('a fresh observation (age 0) is weighted 1.0', () => {
    expect(recencyWeight(0)).toBe(1);
  });

  it('halves every league year', () => {
    expect(recencyWeight(RECENCY_HALF_LIFE_TICKS)).toBeCloseTo(0.5, 6);
    expect(recencyWeight(RECENCY_HALF_LIFE_TICKS * 2)).toBeCloseTo(0.25, 6);
    expect(recencyWeight(RECENCY_HALF_LIFE_TICKS * 3)).toBeCloseTo(0.125, 6);
  });

  it('floors at RECENCY_WEIGHT_FLOOR for very old observations', () => {
    expect(recencyWeight(RECENCY_HALF_LIFE_TICKS * 4)).toBe(RECENCY_WEIGHT_FLOOR);
    expect(recencyWeight(RECENCY_HALF_LIFE_TICKS * 100)).toBe(RECENCY_WEIGHT_FLOOR);
  });

  it('negative ages clamp to 0 (treated as fresh, defensive)', () => {
    expect(recencyWeight(-1)).toBe(1);
    expect(recencyWeight(-10_000)).toBe(1);
  });

  it('non-finite ages return the floor', () => {
    expect(recencyWeight(NaN)).toBe(RECENCY_WEIGHT_FLOOR);
    expect(recencyWeight(Infinity)).toBe(RECENCY_WEIGHT_FLOOR);
  });

  it('decay is monotonic (older = less weight) until floor', () => {
    const samples = [0, 10, 26, 52, 78, 104, 130, 156, 200];
    for (let i = 1; i < samples.length; i++) {
      const prev = recencyWeight(samples[i - 1]!);
      const cur = recencyWeight(samples[i]!);
      expect(cur).toBeLessThanOrEqual(prev);
    }
  });

  it('half-life constant is 52 ticks (one league year)', () => {
    expect(RECENCY_HALF_LIFE_TICKS).toBe(52);
  });

  it('floor is 0.125 — old reports stay visible but dominated', () => {
    expect(RECENCY_WEIGHT_FLOOR).toBe(0.125);
  });
});
