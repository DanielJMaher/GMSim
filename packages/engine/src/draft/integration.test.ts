import { describe, expect, it } from 'vitest';
import { createLeague } from '../league/generate.js';
import { advanceSeason } from '../season/advance.js';
import { simulateSeason } from '../season/runner.js';

/**
 * Integration: createLeague populates the college pool, and advanceSeason
 * rolls it forward. Slice 1's wiring contract.
 */

describe('Draft slice 1 — league integration', () => {
  it('createLeague populates a college pool of ~1000 prospects', () => {
    const league = createLeague({ seed: 'integration-1' });
    expect(league.collegePool.length).toBeGreaterThanOrEqual(950);
    expect(league.collegePool.length).toBeLessThanOrEqual(1100);
    // Spot-check determinism — same seed yields the same pool size.
    const league2 = createLeague({ seed: 'integration-1' });
    expect(league2.collegePool.length).toBe(league.collegePool.length);
    for (let i = 0; i < 10; i++) {
      expect(league2.collegePool[i]!.id).toBe(league.collegePool[i]!.id);
    }
  });

  it('different seeds produce different college pools', () => {
    const a = createLeague({ seed: 'seed-A' });
    const b = createLeague({ seed: 'seed-B' });
    expect(a.collegePool[0]!.firstName + a.collegePool[0]!.lastName).not.toBe(
      b.collegePool[0]!.firstName + b.collegePool[0]!.lastName,
    );
  });

  it('advanceSeason advances the college pool — seniors expire, freshmen arrive', () => {
    const league = createLeague({ seed: 'advance-int' });
    const seniorIdsBefore = new Set(
      league.collegePool
        .filter((cp) => cp.classYear === 'SR' || cp.classYear === 'RS_SR')
        .map((cp) => cp.id),
    );
    expect(seniorIdsBefore.size).toBeGreaterThan(0);

    // simulateSeason internally generates the schedule + plays it.
    const played = simulateSeason(league);
    const after = advanceSeason(played);

    // Seniors gone.
    const survivedSenior = after.collegePool.find((cp) => seniorIdsBefore.has(cp.id));
    expect(survivedSenior).toBeUndefined();

    // Freshmen present.
    const newFreshmen = after.collegePool.filter((cp) => cp.classYear === 'TRUE_FR');
    expect(newFreshmen.length).toBeGreaterThanOrEqual(190);

    // Pool size still in the ~1000 band.
    expect(after.collegePool.length).toBeGreaterThanOrEqual(950);
    expect(after.collegePool.length).toBeLessThanOrEqual(1100);
  });

  it('migration backfills collegePool when missing on an older save', () => {
    const league = createLeague({ seed: 'mig-int' });
    const played = simulateSeason(league);
    // Cast away the readonly to drop the field — simulates an old save shape.
    const oldShape = { ...played } as typeof played & { collegePool?: typeof played.collegePool };
    delete oldShape.collegePool;
    const after = advanceSeason(oldShape as typeof played);
    expect(after.collegePool.length).toBeGreaterThanOrEqual(950);
  });
});
