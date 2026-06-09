import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import { generateCollegeWeeklyTakes } from './college-takes.js';
import { Position } from '../types/enums.js';
import type { CollegePlayer } from '../types/college.js';
import type { CollegeGame, CollegePlayerGameStats } from '../types/college-season.js';
import { GameId } from '../types/ids.js';

const league = createLeague({ seed: 'cfb-takes' });

const ZERO = {
  passAttempts: 0, passCompletions: 0, passingYards: 0, passingTds: 0, interceptionsThrown: 0,
  rushingAttempts: 0, rushingYards: 0, rushingTds: 0,
  targets: 0, receptions: 0, receivingYards: 0, receivingTds: 0,
  tackles: 0, sacks: 0, interceptions: 0,
};

function line(p: CollegePlayer, over: Partial<CollegePlayerGameStats>): CollegePlayerGameStats {
  return {
    playerId: p.id,
    schoolId: p.schoolId,
    gameId: GameId(`G_${p.id}`),
    playedOnTick: 0,
    weekNumber: 6,
    kind: 'REGULAR',
    ...ZERO,
    ...over,
  };
}

/** A win/loss game for a prospect's school vs a fixed opponent. */
function game(p: CollegePlayer, won: boolean): CollegeGame {
  const opp = league.collegePool.find((x) => x.schoolId !== p.schoolId)!.schoolId;
  return {
    id: GameId(`G_${p.id}`),
    weekNumber: 6,
    homeSchoolId: p.schoolId,
    awaySchoolId: opp,
    bowlName: null,
    kind: 'REGULAR',
    result: { homeScore: won ? 31 : 13, awayScore: won ? 13 : 31 } as CollegeGame['result'],
  };
}

const pool = league.collegePool;
const lowStarQb = pool.find((p) => p.nflProjectedPosition === Position.QB && p.recruiting.starRating <= 3)!;
const highStar = pool.find((p) => p.recruiting.starRating >= 4)!;
const anyQb = pool.find((p) => p.nflProjectedPosition === Position.QB)!;

describe('generateCollegeWeeklyTakes', () => {
  it('files a sensational BREAKOUT take for a lightly-recruited monster game', () => {
    const stats = [line(lowStarQb, { passAttempts: 30, passCompletions: 22, passingYards: 430, passingTds: 5 })];
    const takes = generateCollegeWeeklyTakes(league, [game(lowStarQb, true)], stats, 6, 0);
    expect(takes.length).toBe(1);
    const t = takes[0]!;
    expect(t.kind).toBe('player-take');
    if (t.kind === 'player-take') expect(t.subjectIsCollegeProspect).toBe(true);
    expect(t.tone).toBe('POSITIVE');
    expect(t.headline).toContain('430 yards');
    expect(t.headline).toContain(lowStarQb.lastName);
  });

  it('frames a touted prospect’s interception-fest as a critical STRUGGLING take', () => {
    const stats = [line(anyQb, { passAttempts: 28, passCompletions: 12, passingYards: 150, interceptionsThrown: 4 })];
    const takes = generateCollegeWeeklyTakes(league, [game(anyQb, false)], stats, 6, 0);
    expect(takes.length).toBe(1);
    expect(takes[0]!.tone).toBe('CRITICAL');
    expect(takes[0]!.headline).toContain('4 interceptions');
  });

  it('keeps the scouting body qualitative — no numbers in the prose (North Star)', () => {
    const stats = [line(highStar, monsterFor(highStar))];
    const t = generateCollegeWeeklyTakes(league, [game(highStar, true)], stats, 6, 0)[0]!;
    if (t.kind === 'player-take' && t.scoutReport) {
      const body = [t.scoutReport.summary, ...t.scoutReport.strengths, t.scoutReport.concern, t.scoutReport.bottomLine].join(' ');
      expect(body).not.toMatch(/\d/);
    }
  });

  it('caps the week and de-dups per prospect', () => {
    const stats = pool.slice(0, 40).map((p) => line(p, monsterFor(p)));
    const games = pool.slice(0, 40).map((p) => game(p, true));
    const takes = generateCollegeWeeklyTakes(league, games, stats, 6, 0, 5);
    expect(takes.length).toBeLessThanOrEqual(5);
    const subjects = new Set(takes.map((t) => (t.kind === 'player-take' ? t.subjectPlayerId : '')));
    expect(subjects.size).toBe(takes.length);
  });

  it('same world + different voiceSeed → same selection, different words', () => {
    const a = createLeague({ seed: 'cfb-takes', voiceSeed: 'voice-A' });
    const b = createLeague({ seed: 'cfb-takes', voiceSeed: 'voice-B' });
    const stats = [line(lowStarQb, { passAttempts: 30, passingYards: 430, passingTds: 5 })];
    const ta = generateCollegeWeeklyTakes(a, [game(lowStarQb, true)], stats, 6, 0);
    const tb = generateCollegeWeeklyTakes(b, [game(lowStarQb, true)], stats, 6, 0);
    expect(tb.map((t) => t.subjectPlayerId)).toEqual(ta.map((t) => t.subjectPlayerId));
    // The voice (headline template + qualitative body) differs across seeds.
    const words = (t: (typeof ta)[number]) =>
      t.headline + (t.kind === 'player-take' ? JSON.stringify(t.scoutReport) : '');
    expect(words(tb[0]!)).not.toBe(words(ta[0]!));
  });
});

function monsterFor(p: CollegePlayer): Partial<CollegePlayerGameStats> {
  switch (p.nflProjectedPosition) {
    case Position.QB:
      return { passAttempts: 30, passingYards: 420, passingTds: 5 };
    case Position.RB:
    case Position.FB:
      return { rushingAttempts: 24, rushingYards: 210, rushingTds: 3 };
    case Position.WR:
    case Position.TE:
      return { targets: 12, receptions: 9, receivingYards: 175, receivingTds: 2 };
    case Position.CB:
    case Position.S:
    case Position.NICKEL:
      return { tackles: 6, interceptions: 2 };
    default:
      return { tackles: 7, sacks: 3 };
  }
}
