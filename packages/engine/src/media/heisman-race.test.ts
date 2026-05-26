import { describe, it, expect } from 'vitest';
import { generateHeismanRaceReports, HEISMAN_WATCH_START_WEEK } from './heisman-race.js';
import { createLeague } from '../league/generate.js';
import { Prng } from '../prng/index.js';
import type { CollegeSeasonStatLine } from '../types/college-season.js';
import type { PlayerId } from '../types/ids.js';

const league = createLeague({ seed: 'heis-base' });
const eligibles = league.collegePool
  .filter((cp) => cp.isDraftEligible && cp.hasDeclared)
  .slice(0, 3);

function line(
  playerId: PlayerId,
  schoolId: string,
  f: Partial<CollegeSeasonStatLine>,
): CollegeSeasonStatLine {
  return {
    playerId,
    schoolId,
    games: 6,
    passAttempts: 0,
    passCompletions: 0,
    passingYards: 0,
    passingTds: 0,
    interceptionsThrown: 0,
    rushingAttempts: 0,
    rushingYards: 0,
    rushingTds: 0,
    targets: 0,
    receptions: 0,
    receivingYards: 0,
    receivingTds: 0,
    tackles: 0,
    sacks: 0,
    interceptions: 0,
    ...f,
  };
}

// A clear QB frontrunner + a chasing RB.
const stats = [
  line(eligibles[0]!.id, eligibles[0]!.schoolId, { passingYards: 2400, passingTds: 26, interceptionsThrown: 3 }),
  line(eligibles[1]!.id, eligibles[1]!.schoolId, { rushingYards: 900, rushingTds: 10 }),
];

const args = (weekNumber: number) => ({
  outlets: league.mediaOutlets,
  statsLines: stats,
  pool: league.collegePool,
  weekNumber,
  filedOnTick: 10,
  seasonNumber: 1,
});

describe('generateHeismanRaceReports', () => {
  it('stays silent before the watch start week', () => {
    expect(generateHeismanRaceReports(new Prng('a'), args(HEISMAN_WATCH_START_WEEK - 1))).toEqual([]);
  });

  it('files narrative Heisman-watch reports about the frontrunner', () => {
    const reports = generateHeismanRaceReports(new Prng('b'), args(6));
    expect(reports.length).toBeGreaterThan(0);
    for (const r of reports) {
      expect(r.kind).toBe('narrative');
      if (r.kind === 'narrative') expect(r.threadId).toBe('heisman-S1');
      expect(r.weekNumber).toBe(6);
      expect(r.lifecyclePhase).toBe('COLLEGE_WEEK');
    }
    const qb = eligibles[0]!;
    expect(
      reports.some((r) => r.headline.includes(qb.firstName) && r.headline.includes(qb.lastName)),
    ).toBe(true);
  });

  it('is deterministic', () => {
    expect(generateHeismanRaceReports(new Prng('z'), args(7))).toEqual(
      generateHeismanRaceReports(new Prng('z'), args(7)),
    );
  });

  it('returns nothing with no production to judge', () => {
    expect(
      generateHeismanRaceReports(new Prng('c'), { ...args(6), statsLines: [] }),
    ).toEqual([]);
  });
});
