import { describe, it, expect } from 'vitest';
import { combineAthleticSkills } from './measurables.js';

describe('combineAthleticSkills', () => {
  it('reads an elite workout as high athletic skill, a poor one as low', () => {
    // CB baseline: forty 4.45, vert 36, broad 122, cone 6.85, shuttle 4.15, bench 13.
    const elite = combineAthleticSkills('CB', {
      fortyYardSeconds: 4.28, // blazing
      benchPress225Reps: 22,
      verticalInches: 42,
      broadJumpInches: 134,
      threeConeSeconds: 6.5,
      shuttleSeconds: 3.95,
    });
    const poor = combineAthleticSkills('CB', {
      fortyYardSeconds: 4.62, // slow for a corner
      benchPress225Reps: 6,
      verticalInches: 30,
      broadJumpInches: 110,
      threeConeSeconds: 7.2,
      shuttleSeconds: 4.45,
    });

    expect(elite.speed!).toBeGreaterThan(poor.speed!);
    expect(elite.acceleration!).toBeGreaterThan(poor.acceleration!);
    expect(elite.agility!).toBeGreaterThan(poor.agility!);
    expect(elite.strength!).toBeGreaterThan(poor.strength!);
    // Elite reads clearly above average (70); poor clearly below.
    expect(elite.speed!).toBeGreaterThan(80);
    expect(poor.speed!).toBeLessThan(60);
  });

  it('is position-relative — the same 40 reads differently for a CB vs an OT', () => {
    const time = { fortyYardSeconds: 4.9 };
    // 4.9 is slow for a corner (baseline 4.45) but fast for a tackle (5.20).
    const cb = combineAthleticSkills('CB', time);
    const ot = combineAthleticSkills('LT', time);
    expect(cb.speed!).toBeLessThan(70);
    expect(ot.speed!).toBeGreaterThan(70);
  });

  it('omits skills for drills the prospect skipped', () => {
    const partial = combineAthleticSkills('WR', { fortyYardSeconds: 4.4 });
    expect(partial.speed).toBeTypeOf('number');
    expect(partial.strength).toBeUndefined();
    expect(partial.acceleration).toBeUndefined();
    expect(partial.agility).toBeUndefined();
  });

  it('clamps to the 30..99 band', () => {
    const freak = combineAthleticSkills('WR', { fortyYardSeconds: 4.0 });
    const slug = combineAthleticSkills('WR', { fortyYardSeconds: 5.6 });
    expect(freak.speed!).toBeLessThanOrEqual(99);
    expect(slug.speed!).toBeGreaterThanOrEqual(30);
  });
});
