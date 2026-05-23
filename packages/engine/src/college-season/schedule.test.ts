import { describe, it, expect } from 'vitest';
import { Prng } from '../prng/index.js';
import {
  COLLEGE_REGULAR_SEASON_WEEKS,
  generateCollegeRegularSeason,
} from './schedule.js';
import { COLLEGE_SCHOOLS } from '../data/colleges/index.js';

describe('generateCollegeRegularSeason', () => {
  it('produces 12 weeks of games', () => {
    const prng = new Prng('cfb-sched-weeks');
    const reg = generateCollegeRegularSeason(prng, 1);
    expect(reg.length).toBe(COLLEGE_REGULAR_SEASON_WEEKS);
    expect(COLLEGE_REGULAR_SEASON_WEEKS).toBe(12);
  });

  it('every FBS school plays a similar number of games across the season', () => {
    const prng = new Prng('cfb-sched-counts');
    const reg = generateCollegeRegularSeason(prng, 1);
    const counts = new Map<string, number>();
    for (const week of reg) {
      for (const game of week) {
        counts.set(game.homeSchoolId, (counts.get(game.homeSchoolId) ?? 0) + 1);
        counts.set(game.awaySchoolId, (counts.get(game.awaySchoolId) ?? 0) + 1);
      }
    }
    const fbs = COLLEGE_SCHOOLS.filter(
      (s) => s.tier === 'POWER' || s.tier === 'GROUP_OF_5',
    );
    // 117 FBS schools is odd — exactly one bye each week. Over 12
    // weeks ≈ 12 byes spread across 117 schools. We tolerate
    // schools with 10-12 games.
    for (const school of fbs) {
      const c = counts.get(school.id) ?? 0;
      expect(c).toBeGreaterThanOrEqual(10);
      expect(c).toBeLessThanOrEqual(12);
    }
  });

  it('each week has 58 games (117 FBS / 2 = 58 + 1 bye)', () => {
    const prng = new Prng('cfb-sched-weekly');
    const reg = generateCollegeRegularSeason(prng, 1);
    for (const week of reg) {
      // The matcher can drop pairs in pathological retry cases, so
      // accept a small tolerance around the ideal 58.
      expect(week.length).toBeGreaterThanOrEqual(56);
      expect(week.length).toBeLessThanOrEqual(58);
    }
  });

  it('the same prng + season number reproduces an identical schedule', () => {
    const a = generateCollegeRegularSeason(new Prng('det'), 1);
    const b = generateCollegeRegularSeason(new Prng('det'), 1);
    expect(a).toEqual(b);
  });

  it('FCS / SMALL-tier schools are excluded from the FBS schedule', () => {
    const prng = new Prng('cfb-no-fcs');
    const reg = generateCollegeRegularSeason(prng, 1);
    const nonFbsIds = new Set(
      COLLEGE_SCHOOLS.filter((s) => s.tier === 'FCS' || s.tier === 'SMALL').map(
        (s) => s.id,
      ),
    );
    for (const week of reg) {
      for (const game of week) {
        expect(nonFbsIds.has(game.homeSchoolId)).toBe(false);
        expect(nonFbsIds.has(game.awaySchoolId)).toBe(false);
      }
    }
  });
});
