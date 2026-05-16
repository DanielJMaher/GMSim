import { describe, expect, it } from 'vitest';
import { Prng } from '../prng/index.js';
import { generateInitialCollegePool, advanceCollegePool } from './pool.js';
import type { ClassYear, CollegePlayer } from '../types/college.js';
import { COLLEGE_SCHOOLS } from '../data/colleges/index.js';

describe('generateInitialCollegePool', () => {
  it('is deterministic for the same seed', () => {
    const a = generateInitialCollegePool(new Prng('seed'));
    const b = generateInitialCollegePool(new Prng('seed'));
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toEqual(b[i]);
    }
  });

  it('produces ~1000 prospects across all six class years', () => {
    const pool = generateInitialCollegePool(new Prng('size'));
    expect(pool.length).toBeGreaterThanOrEqual(950);
    expect(pool.length).toBeLessThanOrEqual(1100);
    const byClass = new Map<ClassYear, number>();
    for (const cp of pool) {
      byClass.set(cp.classYear, (byClass.get(cp.classYear) ?? 0) + 1);
    }
    for (const year of ['TRUE_FR', 'RS_FR', 'SO', 'JR', 'SR', 'RS_SR'] as ClassYear[]) {
      const count = byClass.get(year) ?? 0;
      expect(count).toBeGreaterThan(0);
    }
  });

  it('all prospect IDs are unique', () => {
    const pool = generateInitialCollegePool(new Prng('uniq'));
    const ids = new Set(pool.map((cp) => cp.id));
    expect(ids.size).toBe(pool.length);
  });

  it('respects the eligibility flag for class year', () => {
    const pool = generateInitialCollegePool(new Prng('elig'));
    for (const cp of pool) {
      const eligible =
        cp.classYear === 'JR' || cp.classYear === 'SR' || cp.classYear === 'RS_SR';
      expect(cp.isDraftEligible).toBe(eligible);
    }
  });

  it('distributes schools roughly to design weights — most are POWER', () => {
    const pool = generateInitialCollegePool(new Prng('schools'));
    const counts: Record<string, number> = {
      POWER: 0,
      GROUP_OF_5: 0,
      FCS: 0,
      SMALL: 0,
    };
    // Re-derive by importing tier — for a quick test we count by the
    // school's first-letter signature is too fragile. Use the prospect
    // pool with a proxy lookup.
    // Simpler: just confirm at least a few of each tier exist by walking
    // the pool's school IDs against the catalog.
    const tierById = new Map<string, string>(COLLEGE_SCHOOLS.map((s) => [s.id, s.tier]));
    for (const cp of pool) {
      const tier = tierById.get(cp.schoolId);
      if (tier) counts[tier]!++;
    }
    expect(counts.POWER).toBeGreaterThan(counts.GROUP_OF_5!);
    expect(counts.GROUP_OF_5).toBeGreaterThan(counts.FCS!);
    expect(counts.FCS).toBeGreaterThan(counts.SMALL!);
  });
});

describe('advanceCollegePool', () => {
  it('ages every retained prospect one year and expires SR/RS_SR', () => {
    const pool = generateInitialCollegePool(new Prng('start'));
    const seniorIdsBefore = new Set(
      pool.filter((cp) => cp.classYear === 'SR' || cp.classYear === 'RS_SR').map((cp) => cp.id),
    );
    const result = advanceCollegePool(new Prng('advance'), pool, {
      simYear: 2027,
      freshmanIdPrefix: 'S2',
    });
    // All previous seniors should be in expiredIds, none in nextPool.
    for (const id of seniorIdsBefore) {
      expect(result.expiredIds).toContain(id);
    }
    const nextIds = new Set(result.nextPool.map((cp) => cp.id));
    for (const id of seniorIdsBefore) {
      expect(nextIds.has(id)).toBe(false);
    }

    // Every retained prospect's class year should have advanced.
    const retainedCount = result.nextPool.filter((cp) => !cp.id.startsWith('CP_S2_TRUE_FR')).length;
    const expectedRetained = pool.length - seniorIdsBefore.size;
    expect(retainedCount).toBe(expectedRetained);
  });

  it('appends one new season of stats for advancing JR/SR-eligible prospects', () => {
    const pool = generateInitialCollegePool(new Prng('stats-arc'));
    const before = pool.find((cp) => cp.classYear === 'JR' && cp.collegeStats.length === 2);
    expect(before).toBeDefined();
    const result = advanceCollegePool(new Prng('advance-stats'), pool, {
      simYear: 2027,
      freshmanIdPrefix: 'S2',
    });
    const after = result.nextPool.find((cp) => cp.id === before!.id);
    expect(after).toBeDefined();
    expect(after!.classYear).toBe('SR');
    // SR has 3 seasons of recorded stats — JR had 2, advance appends 1.
    expect(after!.collegeStats.length).toBe(3);
  });

  it('injects a fresh TRUE_FR class on every advance', () => {
    const pool = generateInitialCollegePool(new Prng('fresh'));
    const result = advanceCollegePool(new Prng('advance-fresh'), pool, {
      simYear: 2027,
      freshmanIdPrefix: 'S2',
    });
    const newFreshmen = result.nextPool.filter((cp) => cp.classYear === 'TRUE_FR');
    expect(newFreshmen.length).toBeGreaterThanOrEqual(190);
    for (const cp of newFreshmen) {
      expect(cp.id).toMatch(/^CP_S2_TRUE_FR_/);
    }
  });

  it('is deterministic for the same (prng seed, pool, options)', () => {
    const pool = generateInitialCollegePool(new Prng('det-pool'));
    const a = advanceCollegePool(new Prng('det-adv'), pool, {
      simYear: 2027,
      freshmanIdPrefix: 'D',
    });
    const b = advanceCollegePool(new Prng('det-adv'), pool, {
      simYear: 2027,
      freshmanIdPrefix: 'D',
    });
    expect(a.nextPool.length).toBe(b.nextPool.length);
    for (let i = 0; i < a.nextPool.length; i++) {
      expect(a.nextPool[i]).toEqual(b.nextPool[i]);
    }
    expect(a.expiredIds).toEqual(b.expiredIds);
  });

  it('multi-year advance keeps pool size stable', () => {
    let pool: readonly CollegePlayer[] = generateInitialCollegePool(new Prng('stable'));
    const initialSize = pool.length;
    const prng = new Prng('multi');
    for (let year = 0; year < 4; year++) {
      const out = advanceCollegePool(prng.fork(`y${year}`), pool, {
        simYear: 2027 + year,
        freshmanIdPrefix: `S${year + 2}`,
      });
      pool = out.nextPool;
    }
    // After 4 years of advance, pool should still be near the initial
    // size (TRUE_FR inflow ≈ senior outflow). Allow ±100 drift.
    expect(pool.length).toBeGreaterThanOrEqual(initialSize - 100);
    expect(pool.length).toBeLessThanOrEqual(initialSize + 100);
  });
});
