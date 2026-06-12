import { describe, expect, it } from 'vitest';
import {
  POSITION_DRAFT_VALUE,
  boardPositionalFactor,
  BOARD_PREMIUM_STRENGTH,
  slotPremiumStrength,
  slotAwarePickBoost,
  SLOT_PREMIUM_DECAY_END_PICK,
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

  it('slot premium runs full strength at #1 and decays to the board baseline', () => {
    expect(slotPremiumStrength(1)).toBeCloseTo(1.0, 5);
    expect(slotPremiumStrength(SLOT_PREMIUM_DECAY_END_PICK)).toBeCloseTo(
      BOARD_PREMIUM_STRENGTH,
      5,
    );
    expect(slotPremiumStrength(200)).toBeCloseTo(BOARD_PREMIUM_STRENGTH, 5);
    // Monotone decay through round 1.
    expect(slotPremiumStrength(5)).toBeGreaterThan(slotPremiumStrength(15));
    expect(slotPremiumStrength(15)).toBeGreaterThan(slotPremiumStrength(32));
  });

  it('slot-aware pick boost composes to ~full positional value at #1 and to 1.0 past the window', () => {
    // At #1 the composed weight (board factor × boost) ≈ the full draft value.
    const composedQb = boardPositionalFactor('QB') * slotAwarePickBoost('QB', 1);
    expect(composedQb).toBeGreaterThan(1.5);
    expect(composedQb).toBeLessThan(POSITION_DRAFT_VALUE.QB + 0.1);
    // A guard gets no premier-slot boost; a safety is actively discounted.
    expect(slotAwarePickBoost('LG', 1)).toBeCloseTo(1, 5);
    expect(slotAwarePickBoost('S', 1)).toBeLessThan(1);
    // Beyond the decay window every position is 1.0 — pick order untouched.
    for (const pos of ['QB', 'S', 'RB', 'LG'] as const) {
      expect(slotAwarePickBoost(pos, SLOT_PREMIUM_DECAY_END_PICK)).toBeCloseTo(1, 5);
      expect(slotAwarePickBoost(pos, 120)).toBeCloseTo(1, 5);
    }
    // The decisive check: a near-equal QB out-weighs a slightly-better guard
    // at #1 (priority 100 guard vs 95 QB), but NOT at pick 45.
    expect(95 * slotAwarePickBoost('QB', 1)).toBeGreaterThan(100 * slotAwarePickBoost('LG', 1));
    expect(95 * slotAwarePickBoost('QB', 45)).toBeLessThan(100 * slotAwarePickBoost('LG', 45));
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
