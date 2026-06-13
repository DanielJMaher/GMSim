import { describe, expect, it } from 'vitest';
import { Prng } from '../prng/index.js';
import { rollTalentGrade, CLASS_TOP_GRADE_MULT, gradeToTier } from './skills.js';
import { COLLEGE_POSITION_WEIGHTS } from '../draft/generate-college-player.js';
import { Position } from '../types/enums.js';

/**
 * Class top-of-pyramid position mix (v0.151 — the Arbiter class-mix fix).
 * Position and talent were independent, so the top of every class mirrored
 * the pool mix (QB 5.8% → a top-10-talent QB in only ~45% of classes; real
 * boards: ~80%). The tilt reshapes each position's TOP-end grade odds to
 * the real NMDD top-32 share while conserving total grade mass.
 */

describe('CLASS_TOP_GRADE_MULT', () => {
  it('conserves league-wide top-grade mass (Σ poolShare × mult ≈ 1)', () => {
    const total = COLLEGE_POSITION_WEIGHTS.reduce((s, w) => s + w.weight, 0);
    let weighted = 0;
    for (const { value, weight } of COLLEGE_POSITION_WEIGHTS) {
      weighted += (weight / total) * (CLASS_TOP_GRADE_MULT[value] ?? 1);
    }
    // The Adjudicator's tier-distribution guards hold by construction only
    // if the tilt is mass-neutral across the pool.
    expect(weighted).toBeGreaterThan(0.94);
    expect(weighted).toBeLessThan(1.06);
  });

  it('concentrates QBs at the top and thins LBs, without touching untilted rolls', () => {
    const topRate = (position?: Position): number => {
      const prng = new Prng(`tilt:${position ?? 'none'}`);
      let top = 0;
      const N = 20000;
      for (let i = 0; i < N; i++) {
        const g = rollTalentGrade(prng, position);
        if (g === 'ELITE' || g === 'STAR') top++;
      }
      return top / N;
    };

    const base = topRate(undefined);
    expect(base).toBeGreaterThan(0.04);
    expect(base).toBeLessThan(0.06);

    // QB ×2.15 → ~10.8% ELITE+STAR.
    const qb = topRate(Position.QB);
    expect(qb).toBeGreaterThan(0.085);
    expect(qb).toBeLessThan(0.13);

    // Off-ball LB thinned (×0.7 / ×0.6).
    expect(topRate(Position.ILB)).toBeLessThan(0.045);

    // Neutral positions unchanged (×0.95).
    const wr = topRate(Position.WR);
    expect(wr).toBeGreaterThan(0.038);
    expect(wr).toBeLessThan(0.058);
  });

  it('keeps the grade→tier rollup intact for tilted rolls', () => {
    const prng = new Prng('tilt-tiers');
    for (let i = 0; i < 1000; i++) {
      const g = rollTalentGrade(prng, Position.QB);
      expect(['STAR', 'STARTER', 'BACKUP', 'FRINGE']).toContain(gradeToTier(g));
    }
  });
});
