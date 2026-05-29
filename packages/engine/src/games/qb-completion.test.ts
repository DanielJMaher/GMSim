import { describe, it, expect } from 'vitest';
import { qbCompletionRate } from './stats.js';
import type { Player, PlayerSkills } from '../types/player.js';

function qb(accuracyShort: number, accuracyMedium: number, decisionMaking: number, footballIq: number): Player {
  return {
    current: { accuracyShort, accuracyMedium, decisionMaking, footballIq } as PlayerSkills,
  } as unknown as Player;
}

describe('qbCompletionRate (Stage 5 / sub-slice C)', () => {
  it('a league-typical QB completes ~64%', () => {
    const rate = qbCompletionRate(qb(74, 74, 74, 74));
    expect(rate).toBeCloseTo(0.64, 2);
  });

  it('an accurate, decisive QB completes more than an erratic one', () => {
    const sharp = qbCompletionRate(qb(92, 90, 90, 88));
    const erratic = qbCompletionRate(qb(58, 56, 55, 60));
    expect(sharp).toBeGreaterThan(erratic);
    expect(sharp).toBeGreaterThan(0.66);
    expect(erratic).toBeLessThan(0.62);
  });

  it('stays within a realistic band (clamped)', () => {
    expect(qbCompletionRate(qb(99, 99, 99, 99))).toBeLessThanOrEqual(0.72);
    expect(qbCompletionRate(qb(20, 20, 20, 20))).toBeGreaterThanOrEqual(0.54);
  });
});
