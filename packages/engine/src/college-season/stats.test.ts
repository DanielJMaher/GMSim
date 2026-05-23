import { describe, it, expect } from 'vitest';
import { Prng } from '../prng/index.js';
import { GameId, PlayerId } from '../types/ids.js';
import type { CollegeGame } from '../types/college-season.js';
import type { CollegePlayer } from '../types/college.js';
import { deriveCollegeGamePlayerStats } from './stats.js';
import { Position } from '../types/enums.js';
import { generateCollegePlayer } from '../draft/generate-college-player.js';
import { COLLEGE_SCHOOLS } from '../data/colleges/index.js';

function makeGameWithResult(
  homeSchool: string,
  awaySchool: string,
  homePassingYards = 260,
  homeRushingYards = 150,
  awayPassingYards = 180,
  awayRushingYards = 110,
): CollegeGame {
  return {
    id: GameId(`G_${homeSchool}_${awaySchool}`),
    weekNumber: 1,
    homeSchoolId: homeSchool,
    awaySchoolId: awaySchool,
    bowlName: null,
    kind: 'REGULAR',
    result: {
      homeScore: 31,
      awayScore: 21,
      homeStats: {
        totalYards: homePassingYards + homeRushingYards,
        passingYards: homePassingYards,
        rushingYards: homeRushingYards,
        turnovers: 1,
        sacks: 3,
      },
      awayStats: {
        totalYards: awayPassingYards + awayRushingYards,
        passingYards: awayPassingYards,
        rushingYards: awayRushingYards,
        turnovers: 2,
        sacks: 2,
      },
      variance: 'controlled',
    },
  };
}

function makePool(): {
  pool: CollegePlayer[];
  bucketed: Map<string, CollegePlayer[]>;
} {
  const prng = new Prng('test-pool');
  const alabama = COLLEGE_SCHOOLS.find((s) => s.id === 'ALABAMA')!;
  const auburn = COLLEGE_SCHOOLS.find((s) => s.id === 'AUBURN')!;
  const pool: CollegePlayer[] = [];
  // Generate a few prospects at each position for both schools.
  let counter = 0;
  for (const school of [alabama, auburn]) {
    for (const position of [
      Position.QB,
      Position.RB,
      Position.WR,
      Position.WR,
      Position.WR,
      Position.TE,
      Position.EDGE,
      Position.EDGE,
      Position.DT,
      Position.ILB,
      Position.OLB,
      Position.CB,
      Position.CB,
      Position.S,
    ]) {
      pool.push(
        generateCollegePlayer(prng.fork(`p-${counter++}`), {
          idSuffix: `TST_${counter}`,
          classYear: 'JR',
          school,
          forcePosition: position,
          simYear: 2026,
        }),
      );
    }
  }
  const bucketed = new Map<string, CollegePlayer[]>();
  for (const p of pool) {
    const arr = bucketed.get(p.schoolId) ?? [];
    arr.push(p);
    bucketed.set(p.schoolId, arr);
  }
  return { pool, bucketed };
}

describe('deriveCollegeGamePlayerStats', () => {
  it('assigns passing yards to a school\'s QB', () => {
    const { bucketed } = makePool();
    const game = makeGameWithResult('ALABAMA', 'AUBURN', 280, 160, 200, 120);
    const stats = deriveCollegeGamePlayerStats(game, bucketed, 0);
    const passers = stats.filter((s) => s.passingYards > 0);
    expect(passers.length).toBeGreaterThan(0);
    // The QB on each school's roster should have most of the team's
    // passing volume.
    const homeQbStat = passers.find(
      (s) => s.schoolId === 'ALABAMA' && s.passingYards > 200,
    );
    expect(homeQbStat).toBeDefined();
  });

  it('total team passing yards equal the sum of attributed prospect passing yards', () => {
    const { bucketed } = makePool();
    const game = makeGameWithResult('ALABAMA', 'AUBURN', 240, 150, 200, 130);
    const stats = deriveCollegeGamePlayerStats(game, bucketed, 0);
    const homePassing = stats
      .filter((s) => s.schoolId === 'ALABAMA')
      .reduce((sum, s) => sum + s.passingYards, 0);
    expect(homePassing).toBe(240);
    const awayPassing = stats
      .filter((s) => s.schoolId === 'AUBURN')
      .reduce((sum, s) => sum + s.passingYards, 0);
    expect(awayPassing).toBe(200);
  });

  it('rushing yards are attributed to RBs', () => {
    const { bucketed } = makePool();
    const game = makeGameWithResult('ALABAMA', 'AUBURN', 220, 180, 160, 140);
    const stats = deriveCollegeGamePlayerStats(game, bucketed, 0);
    const rushers = stats.filter(
      (s) => s.schoolId === 'ALABAMA' && s.rushingYards > 0,
    );
    expect(rushers.length).toBeGreaterThan(0);
  });

  it('attribution is deterministic — same inputs produce identical output', () => {
    const a = makePool();
    const b = makePool();
    const game = makeGameWithResult('ALABAMA', 'AUBURN');
    const sa = deriveCollegeGamePlayerStats(game, a.bucketed, 5);
    const sb = deriveCollegeGamePlayerStats(game, b.bucketed, 5);
    expect(sa).toEqual(sb);
  });

  it('stamps the game id, week, and kind on every attributed line', () => {
    const { bucketed } = makePool();
    const game = makeGameWithResult('ALABAMA', 'AUBURN');
    const stats = deriveCollegeGamePlayerStats(game, bucketed, 17);
    expect(stats.length).toBeGreaterThan(0);
    for (const s of stats) {
      expect(s.gameId).toBe(game.id);
      expect(s.weekNumber).toBe(game.weekNumber);
      expect(s.kind).toBe('REGULAR');
      expect(s.playedOnTick).toBe(17);
    }
  });
});
