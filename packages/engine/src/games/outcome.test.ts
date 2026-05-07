import { describe, it, expect } from 'vitest';
import { Prng } from '../prng/index.js';
import { simulateGame } from './outcome.js';
import { createLeague } from '../league/generate.js';

describe('simulateGame', () => {
  const league = createLeague({ seed: 'sim-base' });
  const teams = Object.values(league.teams);
  const team1 = teams[0]!;
  const team2 = teams[1]!;

  it('produces a winner (no ties allowed in this model)', () => {
    for (let i = 0; i < 30; i++) {
      const game = simulateGame(new Prng(`g-${i}`), {
        homeTeam: team1,
        awayTeam: team2,
        league,
        weekNumber: 1,
        kind: 'REGULAR',
      });
      expect(game.result).not.toBeNull();
      expect(game.result!.homeScore).not.toBe(game.result!.awayScore);
    }
  });

  it('is deterministic for the same prng', () => {
    const a = simulateGame(new Prng('det'), {
      homeTeam: team1,
      awayTeam: team2,
      league,
      weekNumber: 1,
      kind: 'REGULAR',
    });
    const b = simulateGame(new Prng('det'), {
      homeTeam: team1,
      awayTeam: team2,
      league,
      weekNumber: 1,
      kind: 'REGULAR',
    });
    expect(a).toEqual(b);
  });

  it('produces scores in a plausible NFL range', () => {
    for (let i = 0; i < 50; i++) {
      const game = simulateGame(new Prng(`r-${i}`), {
        homeTeam: team1,
        awayTeam: team2,
        league,
        weekNumber: 1,
        kind: 'REGULAR',
      });
      const r = game.result!;
      expect(r.homeScore).toBeGreaterThanOrEqual(0);
      expect(r.awayScore).toBeGreaterThanOrEqual(0);
      expect(r.homeScore).toBeLessThanOrEqual(60);
      expect(r.awayScore).toBeLessThanOrEqual(60);
    }
  });

  it('home team wins more than half of identical-strength games due to home field advantage', () => {
    let homeWins = 0;
    const trials = 400;
    for (let i = 0; i < trials; i++) {
      const game = simulateGame(new Prng(`hfa-${i}`), {
        homeTeam: team1,
        awayTeam: team1, // identical team — same strength
        league,
        weekNumber: 1,
        kind: 'REGULAR',
      });
      if (game.result!.homeScore > game.result!.awayScore) homeWins++;
    }
    // HFA of 3 should put home win rate around 55-58%.
    expect(homeWins / trials).toBeGreaterThan(0.5);
    expect(homeWins / trials).toBeLessThan(0.7);
  });

  it('neutralSite removes home field advantage', () => {
    let homeWins = 0;
    const trials = 400;
    for (let i = 0; i < trials; i++) {
      const game = simulateGame(new Prng(`ns-${i}`), {
        homeTeam: team1,
        awayTeam: team1,
        league,
        weekNumber: 1,
        kind: 'SUPER_BOWL',
        neutralSite: true,
      });
      if (game.result!.homeScore > game.result!.awayScore) homeWins++;
    }
    // With no HFA between identical teams, home win rate should be ~50%.
    expect(homeWins / trials).toBeGreaterThan(0.4);
    expect(homeWins / trials).toBeLessThan(0.6);
  });

  it('stats are populated and self-consistent', () => {
    const game = simulateGame(new Prng('stats'), {
      homeTeam: team1,
      awayTeam: team2,
      league,
      weekNumber: 1,
      kind: 'REGULAR',
    });
    const r = game.result!;
    expect(r.homeStats.totalYards).toBe(r.homeStats.passingYards + r.homeStats.rushingYards);
    expect(r.awayStats.totalYards).toBe(r.awayStats.passingYards + r.awayStats.rushingYards);
    expect(r.homeStats.thirdDownConversionPct).toBeGreaterThanOrEqual(0);
    expect(r.homeStats.thirdDownConversionPct).toBeLessThanOrEqual(100);
  });
});
