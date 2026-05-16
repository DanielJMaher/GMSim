import { describe, expect, it } from 'vitest';
import { Prng } from '../prng/index.js';
import { runCombine, rollCombineResults } from './combine.js';
import { generateCollegePlayer } from './generate-college-player.js';
import { generateInitialCollegePool } from './pool.js';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from '../season/runner.js';
import { advanceSeason } from '../season/advance.js';
import { getSchoolById } from '../data/colleges/index.js';
import type { CollegePlayer } from '../types/college.js';

const ALABAMA = getSchoolById('ALABAMA')!;

describe('rollCombineResults', () => {
  it('is deterministic for the same seed', () => {
    const cp = generateCollegePlayer(new Prng('p'), {
      idSuffix: 'P', classYear: 'SR', school: ALABAMA, simYear: 2026,
    });
    const a = rollCombineResults({ prng: new Prng('c'), prospect: cp, measuredOnTick: 100 });
    const b = rollCombineResults({ prng: new Prng('c'), prospect: cp, measuredOnTick: 100 });
    expect(a).toEqual(b);
  });

  it('reported measurables sit within tight noise band of truth', () => {
    const cp = generateCollegePlayer(new Prng('m'), {
      idSuffix: 'M', classYear: 'SR', school: ALABAMA, simYear: 2026,
    });
    // Drive enough samples that we cover the noise distribution but
    // verify every sample stays within a generous ±3-sigma band per
    // drill. If a number lands outside, generation is broken.
    for (let i = 0; i < 50; i++) {
      const c = rollCombineResults({ prng: new Prng(`c${i}`), prospect: cp, measuredOnTick: 0 });
      expect(c.attended).toBe(true);
      if (c.heightInches !== undefined) {
        expect(Math.abs(c.heightInches - cp.measurables.heightInches)).toBeLessThan(1);
      }
      if (c.fortyYardSeconds !== undefined) {
        expect(Math.abs(c.fortyYardSeconds - cp.measurables.fortyYardSeconds)).toBeLessThan(0.15);
      }
      if (c.benchPress225Reps !== undefined) {
        expect(Math.abs(c.benchPress225Reps - cp.measurables.benchPress225Reps)).toBeLessThanOrEqual(4);
      }
    }
  });

  it('WORKOUT_WARRIOR never skips drills', () => {
    // Generate prospects until one has WORKOUT_WARRIOR, then verify
    // no drill is skipped across many combine rolls.
    let warrior: CollegePlayer | null = null;
    for (let i = 0; i < 800 && !warrior; i++) {
      const cp = generateCollegePlayer(new Prng(`ww-${i}`), {
        idSuffix: `W${i}`, classYear: 'SR', school: ALABAMA, simYear: 2026,
      });
      if (cp.characterFlags.includes('WORKOUT_WARRIOR')) warrior = cp;
    }
    if (!warrior) return;
    for (let i = 0; i < 30; i++) {
      const c = rollCombineResults({ prng: new Prng(`c-${i}`), prospect: warrior, measuredOnTick: 0 });
      expect(c.fortyYardSeconds).toBeDefined();
      expect(c.benchPress225Reps).toBeDefined();
      expect(c.verticalInches).toBeDefined();
      expect(c.broadJumpInches).toBeDefined();
      expect(c.threeConeSeconds).toBeDefined();
      expect(c.shuttleSeconds).toBeDefined();
    }
  });

  it('drill-skip rate sits in the right ballpark for ordinary prospects', () => {
    // Across many seeds + ordinary prospects (no WORKOUT_WARRIOR /
    // TAPE_STAR_POOR_TESTER), the per-drill skip rate should land
    // near 20% (the design rate). Allow [10%, 35%] to absorb
    // variance from the small per-sample noise.
    let trials = 0;
    let skipped = 0;
    for (let i = 0; i < 200; i++) {
      const cp = generateCollegePlayer(new Prng(`s${i}`), {
        idSuffix: `S${i}`, classYear: 'SR', school: ALABAMA, simYear: 2026,
      });
      if (cp.characterFlags.includes('WORKOUT_WARRIOR') || cp.characterFlags.includes('TAPE_STAR_POOR_TESTER')) continue;
      if (cp.characterFlags.includes('INJURY_PRONE')) continue;
      const c = rollCombineResults({ prng: new Prng(`c${i}`), prospect: cp, measuredOnTick: 0 });
      // 6 risky drills
      const drills = [c.fortyYardSeconds, c.benchPress225Reps, c.verticalInches, c.broadJumpInches, c.threeConeSeconds, c.shuttleSeconds];
      for (const v of drills) {
        trials++;
        if (v === undefined) skipped++;
      }
    }
    if (trials === 0) return;
    const rate = skipped / trials;
    expect(rate).toBeGreaterThan(0.10);
    expect(rate).toBeLessThan(0.35);
  });
});

describe('runCombine', () => {
  it('produces results for every draft-eligible prospect, none for ineligible', () => {
    const pool = generateInitialCollegePool(new Prng('pool'));
    const out = runCombine(new Prng('c'), pool, 50);
    for (const cp of pool) {
      if (cp.isDraftEligible) {
        expect(out[cp.id]).toBeDefined();
        expect(out[cp.id]!.measuredOnTick).toBe(50);
      } else {
        expect(out[cp.id]).toBeUndefined();
      }
    }
  });

  it('is deterministic for the same prng + pool', () => {
    const pool = generateInitialCollegePool(new Prng('pool'));
    const a = runCombine(new Prng('c'), pool, 0);
    const b = runCombine(new Prng('c'), pool, 0);
    expect(Object.keys(a).length).toBe(Object.keys(b).length);
    for (const id of Object.keys(a)) {
      expect(a[id]).toEqual(b[id]);
    }
  });
});

describe('combine integration with createLeague + advanceSeason', () => {
  it('createLeague populates combineResults for every draft-eligible prospect', () => {
    const league = createLeague({ seed: 'cInt' });
    const eligibleCount = league.collegePool.filter((cp) => cp.isDraftEligible).length;
    expect(Object.keys(league.combineResults).length).toBe(eligibleCount);
  });

  it('advanceSeason refreshes combineResults for the new draft-eligible cohort', () => {
    const league = createLeague({ seed: 'cAdv' });
    const initialKeys = new Set(Object.keys(league.combineResults));
    const played = simulateSeason(league);
    const after = advanceSeason(played);
    const newKeys = new Set(Object.keys(after.combineResults));
    // Some prospects from year 1 (now graduated SR) won't be in the
    // new combine; some new juniors will be — keys differ.
    expect(newKeys).not.toEqual(initialKeys);
  });

  it('migration backfills combineResults on a save without them', () => {
    const league = createLeague({ seed: 'cMig' });
    const stripped = { ...league } as typeof league & {
      combineResults?: typeof league.combineResults;
    };
    delete stripped.combineResults;
    const played = simulateSeason(stripped as typeof league);
    expect(Object.keys(played.combineResults).length).toBeGreaterThan(0);
  });
});
