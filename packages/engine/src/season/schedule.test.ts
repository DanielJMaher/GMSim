import { describe, it, expect } from 'vitest';
import { Prng } from '../prng/index.js';
import { generateSchedule } from './schedule.js';
import { createLeague } from '../league/generate.js';

describe('generateSchedule', () => {
  const league = createLeague({ seed: 'sched-base' });
  const teams = Object.values(league.teams);

  it('produces 17 weeks of regular season', () => {
    const schedule = generateSchedule(new Prng('s1'), teams, 1);
    expect(schedule.regularSeason.length).toBe(17);
  });

  it('every team plays exactly 17 games', () => {
    const schedule = generateSchedule(new Prng('s2'), teams, 1);
    const teamGameCounts = new Map<string, number>();
    for (const t of teams) teamGameCounts.set(t.identity.id, 0);
    for (const week of schedule.regularSeason) {
      for (const game of week) {
        teamGameCounts.set(
          game.homeTeamId,
          (teamGameCounts.get(game.homeTeamId) ?? 0) + 1,
        );
        teamGameCounts.set(
          game.awayTeamId,
          (teamGameCounts.get(game.awayTeamId) ?? 0) + 1,
        );
      }
    }
    for (const [, count] of teamGameCounts) {
      expect(count).toBe(17);
    }
  });

  it('no team plays more than once in a single week', () => {
    const schedule = generateSchedule(new Prng('s3'), teams, 1);
    for (const week of schedule.regularSeason) {
      const seen = new Set<string>();
      for (const game of week) {
        expect(seen.has(game.homeTeamId)).toBe(false);
        expect(seen.has(game.awayTeamId)).toBe(false);
        seen.add(game.homeTeamId);
        seen.add(game.awayTeamId);
      }
    }
  });

  it('no pair of teams plays more than 2 times across the season', () => {
    // Phase 2 schedule doesn't strictly enforce NFL pairing rules, but
    // it does prevent obvious abuses (3+ meetings between the same pair).
    const schedule = generateSchedule(new Prng('s4'), teams, 1);
    const matchups = new Map<string, number>();
    for (const week of schedule.regularSeason) {
      for (const game of week) {
        const key =
          game.homeTeamId < game.awayTeamId
            ? `${game.homeTeamId}|${game.awayTeamId}`
            : `${game.awayTeamId}|${game.homeTeamId}`;
        matchups.set(key, (matchups.get(key) ?? 0) + 1);
      }
    }
    for (const [, count] of matchups) {
      expect(count).toBeLessThanOrEqual(2);
    }
  });

  it('is deterministic for the same prng', () => {
    const a = generateSchedule(new Prng('det'), teams, 1);
    const b = generateSchedule(new Prng('det'), teams, 1);
    expect(a).toEqual(b);
  });

  it('throws if not given exactly 32 teams', () => {
    expect(() => generateSchedule(new Prng('x'), teams.slice(0, 16), 1)).toThrow();
  });
});
