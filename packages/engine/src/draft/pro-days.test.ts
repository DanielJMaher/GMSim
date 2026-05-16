import { describe, expect, it } from 'vitest';
import { Prng } from '../prng/index.js';
import { runProDays } from './pro-days.js';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from '../season/runner.js';
import { advanceSeason } from '../season/advance.js';
import type { TeamId } from '../types/ids.js';

describe('runProDays', () => {
  it('createLeague populates proDayAttendance for all 32 teams', () => {
    const league = createLeague({ seed: 'pd-init' });
    expect(Object.keys(league.proDayAttendance).length).toBe(32);
    for (const records of Object.values(league.proDayAttendance)) {
      expect(records.length).toBeGreaterThan(0);
    }
  });

  it('every record has reason matching attended state', () => {
    const league = createLeague({ seed: 'pd-state' });
    for (const records of Object.values(league.proDayAttendance)) {
      for (const r of records) {
        if (r.attended) {
          expect(['AUTO', 'INTERESTED', 'FLYER']).toContain(r.reason);
        } else {
          expect(r.reason).toBe('SKIP');
        }
      }
    }
  });

  it('attendance correlates with boardCount across the league', () => {
    const league = createLeague({ seed: 'pd-corr' });
    let highScoreAttended = 0, highScoreTotal = 0;
    let zeroScoreAttended = 0, zeroScoreTotal = 0;
    for (const records of Object.values(league.proDayAttendance)) {
      for (const r of records) {
        if (r.boardCount >= 3) {
          highScoreTotal++;
          if (r.attended) highScoreAttended++;
        } else if (r.boardCount === 0) {
          zeroScoreTotal++;
          if (r.attended) zeroScoreAttended++;
        }
      }
    }
    if (highScoreTotal === 0 || zeroScoreTotal === 0) return;
    const highRate = highScoreAttended / highScoreTotal;
    const zeroRate = zeroScoreAttended / zeroScoreTotal;
    expect(highRate).toBeGreaterThan(zeroRate);
    // score≥3 is AUTO so should be 100%; score=0 has 5% flyer rate
    expect(highRate).toBe(1);
    expect(zeroRate).toBeLessThan(0.20);
  });

  it('is deterministic for the same prng + teams + boards', () => {
    const league = createLeague({ seed: 'pd-det' });
    const a = runProDays(new Prng('p'), league.teams, league.collegePool, league.draftBoards);
    const b = runProDays(new Prng('p'), league.teams, league.collegePool, league.draftBoards);
    for (const teamId of Object.keys(a) as TeamId[]) {
      expect(a[teamId]).toEqual(b[teamId]);
    }
  });

  it('schedule covers only schools with ≥1 draft-eligible prospect', () => {
    const league = createLeague({ seed: 'pd-sched' });
    const eligibleSchools = new Set(
      league.collegePool.filter((cp) => cp.isDraftEligible).map((cp) => cp.schoolId),
    );
    const sampleTeam = Object.values(league.proDayAttendance)[0]!;
    for (const r of sampleTeam) {
      expect(eligibleSchools.has(r.schoolId)).toBe(true);
    }
    // And every eligible school appears on the schedule.
    const scheduledSchools = new Set(sampleTeam.map((r) => r.schoolId));
    for (const id of eligibleSchools) {
      expect(scheduledSchools.has(id)).toBe(true);
    }
  });

  it('advanceSeason refreshes proDayAttendance', () => {
    const league = createLeague({ seed: 'pd-adv' });
    const played = simulateSeason(league);
    const after = advanceSeason(played);
    expect(Object.keys(after.proDayAttendance).length).toBe(32);
  });

  it('migration backfills proDayAttendance on a save without it', () => {
    const league = createLeague({ seed: 'pd-mig' });
    const stripped = { ...league } as typeof league & {
      proDayAttendance?: typeof league.proDayAttendance;
    };
    delete stripped.proDayAttendance;
    const played = simulateSeason(stripped as typeof league);
    expect(Object.keys(played.proDayAttendance).length).toBe(32);
  });
});
