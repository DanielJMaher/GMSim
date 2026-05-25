import { describe, it, expect } from 'vitest';
import {
  aggregateCollegeSeasonStats,
  collegeStatLeaders,
  latestCollegeSeasonTick,
} from './season-stats.js';
import { emptyCollegePlayerGameStats } from '../types/college-season.js';
import { PlayerId, GameId } from '../types/ids.js';
import type { CollegePlayerGameStats } from '../types/college-season.js';

function stat(
  player: string,
  school: string,
  game: string,
  tick: number,
  fields: Partial<CollegePlayerGameStats>,
): CollegePlayerGameStats {
  return {
    ...emptyCollegePlayerGameStats(PlayerId(player), school, GameId(game), tick, 1, 'REGULAR'),
    ...fields,
  };
}

describe('aggregateCollegeSeasonStats', () => {
  it('sums a prospect across games and counts distinct games', () => {
    const stats = [
      stat('P1', 'BAMA', 'g1', 100, { passingYards: 300, passingTds: 3 }),
      stat('P1', 'BAMA', 'g2', 100, { passingYards: 250, passingTds: 2, interceptionsThrown: 1 }),
    ];
    const lines = aggregateCollegeSeasonStats(stats);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.passingYards).toBe(550);
    expect(lines[0]!.passingTds).toBe(5);
    expect(lines[0]!.interceptionsThrown).toBe(1);
    expect(lines[0]!.games).toBe(2);
  });

  it('aggregates only the latest season (max playedOnTick) by default', () => {
    const stats = [
      stat('P1', 'BAMA', 'g1', 100, { passingYards: 999 }), // old season
      stat('P1', 'BAMA', 'g2', 200, { passingYards: 100 }), // latest season
      stat('P2', 'UGA', 'g3', 200, { rushingYards: 150 }),
    ];
    expect(latestCollegeSeasonTick(stats)).toBe(200);
    const lines = aggregateCollegeSeasonStats(stats);
    const p1 = lines.find((l) => l.playerId === 'P1')!;
    expect(p1.passingYards).toBe(100); // not 999 — old season excluded
    expect(lines).toHaveLength(2);
  });

  it('can aggregate a specific season tick', () => {
    const stats = [
      stat('P1', 'BAMA', 'g1', 100, { passingYards: 999 }),
      stat('P1', 'BAMA', 'g2', 200, { passingYards: 100 }),
    ];
    const lines = aggregateCollegeSeasonStats(stats, { playedOnTick: 100 });
    expect(lines[0]!.passingYards).toBe(999);
  });

  it('returns empty for an empty stream', () => {
    expect(aggregateCollegeSeasonStats([])).toEqual([]);
    expect(latestCollegeSeasonTick([])).toBeNull();
  });
});

describe('collegeStatLeaders', () => {
  const lines = aggregateCollegeSeasonStats([
    stat('QB1', 'BAMA', 'g1', 1, { passingYards: 4000, passingTds: 40 }),
    stat('QB2', 'UGA', 'g2', 1, { passingYards: 3500, passingTds: 30 }),
    stat('RB1', 'OSU', 'g3', 1, { rushingYards: 1800, rushingTds: 20 }),
  ]);

  it('ranks by the requested category, descending', () => {
    const leaders = collegeStatLeaders(lines, 'passingYards', 5);
    expect(leaders.map((l) => l.playerId)).toEqual(['QB1', 'QB2']);
  });

  it('omits prospects with zero in the category', () => {
    const leaders = collegeStatLeaders(lines, 'rushingYards', 5);
    expect(leaders.map((l) => l.playerId)).toEqual(['RB1']);
  });

  it('respects the limit', () => {
    expect(collegeStatLeaders(lines, 'passingYards', 1)).toHaveLength(1);
  });
});
