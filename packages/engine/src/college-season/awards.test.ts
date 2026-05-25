import { describe, it, expect } from 'vitest';
import { heismanScore, selectHeisman } from './awards.js';
import type { CollegeSeasonStatLine } from '../types/college-season.js';
import { PlayerId } from '../types/ids.js';

function line(player: string, school: string, f: Partial<CollegeSeasonStatLine>): CollegeSeasonStatLine {
  return {
    playerId: PlayerId(player),
    schoolId: school,
    games: 12,
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

describe('heismanScore', () => {
  it('rewards passing volume and penalizes interceptions', () => {
    const clean = line('a', 'X', { passingYards: 4000, passingTds: 40 });
    const turnoverProne = line('b', 'Y', { passingYards: 4000, passingTds: 40, interceptionsThrown: 15 });
    expect(heismanScore(clean)).toBeGreaterThan(heismanScore(turnoverProne));
  });

  it('lets an elite rusher out-score a middling passer', () => {
    const eliteRb = line('rb', 'X', { rushingYards: 2000, rushingTds: 28 });
    const okQb = line('qb', 'Y', { passingYards: 2200, passingTds: 12 });
    expect(heismanScore(eliteRb)).toBeGreaterThan(heismanScore(okQb));
  });
});

describe('selectHeisman', () => {
  it('crowns the top score and returns finalists in descending order', () => {
    const lines = [
      line('qb1', 'BAMA', { passingYards: 4200, passingTds: 45 }),
      line('qb2', 'UGA', { passingYards: 3600, passingTds: 32 }),
      line('rb1', 'OSU', { rushingYards: 1700, rushingTds: 22 }),
      line('wr1', 'LSU', { receivingYards: 1500, receivingTds: 18 }),
    ];
    const result = selectHeisman(lines, 7, { finalistCount: 3 });
    expect(result).not.toBeNull();
    expect(result!.seasonNumber).toBe(7);
    expect(result!.winnerId).toBe('qb1');
    expect(result!.winnerSchoolId).toBe('BAMA');
    expect(result!.finalists).toHaveLength(3);
    expect(result!.finalists[0]!.playerId).toBe('qb1');
    // Finalists strictly descending by score.
    for (let i = 1; i < result!.finalists.length; i++) {
      expect(result!.finalists[i - 1]!.score).toBeGreaterThanOrEqual(result!.finalists[i]!.score);
    }
  });

  it('returns null when there is no production', () => {
    expect(selectHeisman([], 1)).toBeNull();
    expect(selectHeisman([line('z', 'X', {})], 1)).toBeNull(); // all-zero → score 0
  });
});
