import { describe, expect, it } from 'vitest';
import {
  POSITION_DRAFT_VALUE,
  boardPositionalFactor,
  BOARD_PREMIUM_STRENGTH,
} from './position-value.js';
import type { Position } from '../types/enums.js';

const ALL_POSITIONS: Position[] = [
  'QB', 'RB', 'FB', 'WR', 'TE',
  'LT', 'LG', 'C', 'RG', 'RT',
  'EDGE', 'DT', 'NT',
  'ILB', 'OLB',
  'CB', 'S', 'NICKEL',
  'K', 'P', 'LS',
];

describe('positional draft value', () => {
  it('defines a value for every position', () => {
    for (const p of ALL_POSITIONS) {
      expect(POSITION_DRAFT_VALUE[p]).toBeGreaterThan(0);
    }
  });

  it('ranks the premium positions above the replaceable ones', () => {
    const v = POSITION_DRAFT_VALUE;
    // Cornerstones on top.
    expect(v.QB).toBeGreaterThan(v.EDGE);
    expect(v.EDGE).toBeGreaterThan(v.LT);
    expect(v.LT).toBeGreaterThan(v.WR);
    // LT (blindside) carries a premium over the other tackle/guards.
    expect(v.LT).toBeGreaterThan(v.RT);
    expect(v.RT).toBeGreaterThanOrEqual(v.LG);
    // Interior DL (pass rush) tracks the market into the moderate tier,
    // above the light spots and above the cheap run-stuffing nose tackle.
    expect(v.DT).toBeGreaterThan(v.S);
    expect(v.DT).toBeGreaterThan(v.NT);
    expect(v.DT).toBeGreaterThanOrEqual(v.RG);
    // Replaceable spots sit below the moderate tier.
    expect(v.WR).toBeGreaterThan(v.S);
    expect(v.CB).toBeGreaterThan(v.NICKEL);
    expect(v.S).toBeGreaterThan(v.RB);
    // Specialists at the floor.
    expect(v.RB).toBeGreaterThan(v.K);
    expect(v.K).toBeGreaterThanOrEqual(v.LS);
  });

  it('board factor compresses the spread toward 1.0', () => {
    // Compressed QB factor sits between 1 and the full need multiplier.
    expect(boardPositionalFactor('QB')).toBeGreaterThan(1);
    expect(boardPositionalFactor('QB')).toBeLessThan(POSITION_DRAFT_VALUE.QB);
    // Replaceable positions get a sub-1 factor.
    expect(boardPositionalFactor('RB')).toBeLessThan(1);
    // Neutral-value positions are unchanged.
    expect(boardPositionalFactor('LG')).toBeCloseTo(1, 5);
    // Matches the documented formula.
    expect(boardPositionalFactor('QB')).toBeCloseTo(
      1 + (POSITION_DRAFT_VALUE.QB - 1) * BOARD_PREMIUM_STRENGTH,
      5,
    );
  });
});
