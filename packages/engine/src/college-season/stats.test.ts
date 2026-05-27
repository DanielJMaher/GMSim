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

  it('the QB of record gets the bulk of team passing (v0.83: depth-chart shares, not 100%)', () => {
    // v0.83 distributes across an assumed full roster and drops the slice
    // belonging to untracked teammates, so pool passing no longer sums
    // exactly to the team total — but the lone pool QB still owns the bulk.
    const { bucketed } = makePool();
    const game = makeGameWithResult('ALABAMA', 'AUBURN', 240, 150, 200, 130);
    const stats = deriveCollegeGamePlayerStats(game, bucketed, 0);
    const homePassing = stats
      .filter((s) => s.schoolId === 'ALABAMA')
      .reduce((sum, s) => sum + s.passingYards, 0);
    // One pool QB → he owns ~92% of the team's passing, not all of it.
    expect(homePassing).toBeGreaterThanOrEqual(240 * 0.85);
    expect(homePassing).toBeLessThanOrEqual(240);
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

/**
 * v0.83 regression guard. Before the depth-chart fix, a school with a
 * single pool prospect at a position handed him the entire team's line
 * (25+ catches, 34 tackles). Now a lone prospect gets only his slot.
 */
function makeThinPool(): { bucketed: Map<string, CollegePlayer[]>; byPos: Map<Position, CollegePlayer> } {
  const prng = new Prng('thin-pool');
  const alabama = COLLEGE_SCHOOLS.find((s) => s.id === 'ALABAMA')!;
  const byPos = new Map<Position, CollegePlayer>();
  let c = 0;
  for (const position of [Position.QB, Position.RB, Position.WR, Position.ILB, Position.EDGE]) {
    byPos.set(
      position,
      generateCollegePlayer(prng.fork(`t-${c++}`), {
        idSuffix: `THIN_${c}`,
        classYear: 'JR',
        school: alabama,
        forcePosition: position,
        simYear: 2026,
      }),
    );
  }
  const bucketed = new Map<string, CollegePlayer[]>([
    ['ALABAMA', [...byPos.values()]],
    ['AUBURN', []],
  ]);
  return { bucketed, byPos };
}

describe('deriveCollegeGamePlayerStats — a lone pool prospect is bounded (v0.83)', () => {
  const { bucketed, byPos } = makeThinPool();
  // Strong HOME offense + high-output AWAY offense (drives HOME's tackles).
  const game = makeGameWithResult('ALABAMA', 'AUBURN', 440, 260, 420, 300);
  const stats = deriveCollegeGamePlayerStats(game, bucketed, 0);
  const find = (pos: Position) => stats.find((s) => s.playerId === byPos.get(pos)!.id)!;

  it('lone WR gets a realistic slice, not the whole passing game', () => {
    const wr = find(Position.WR);
    expect(wr.receptions).toBeLessThanOrEqual(14);
    expect(wr.receivingYards).toBeLessThanOrEqual(180);
    expect(wr.receivingYards).toBeLessThan(440 * 0.45);
  });

  it('lone RB cannot take an impossible carry load', () => {
    const rb = find(Position.RB);
    expect(rb.rushingAttempts).toBeLessThanOrEqual(34);
    expect(rb.rushingYards).toBeLessThanOrEqual(260);
  });

  it('lone QB stays within a real single-game ceiling', () => {
    const qb = find(Position.QB);
    expect(qb.passingYards).toBeLessThanOrEqual(550);
    expect(qb.passAttempts).toBeLessThanOrEqual(65);
  });

  it('lone linebacker tackles like a lead defender, not the whole front seven', () => {
    const lb = find(Position.ILB);
    expect(lb.tackles).toBeGreaterThan(0);
    expect(lb.tackles).toBeLessThanOrEqual(18); // pre-fix this was ~34
  });

  it('tackles track opponent output (more plays faced → more tackles)', () => {
    const low = deriveCollegeGamePlayerStats(
      makeGameWithResult('ALABAMA', 'AUBURN', 440, 260, 160, 110),
      bucketed,
      0,
    );
    const high = deriveCollegeGamePlayerStats(
      makeGameWithResult('ALABAMA', 'AUBURN', 440, 260, 480, 320),
      bucketed,
      0,
    );
    const lbLow = low.find((s) => s.playerId === byPos.get(Position.ILB)!.id)!;
    const lbHigh = high.find((s) => s.playerId === byPos.get(Position.ILB)!.id)!;
    expect(lbHigh.tackles).toBeGreaterThan(lbLow.tackles);
  });
});
