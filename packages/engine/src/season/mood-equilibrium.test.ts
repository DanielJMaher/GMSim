import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from './runner.js';
import { advanceSeason } from './advance.js';

/**
 * The strict long-horizon saturation gate, in its own file so its 4-seed
 * × 8-season walk (32 season-sims) parallelizes against the rest of the
 * suite instead of serializing behind the other long-horizon gates
 * (gate-optimization pass, 2026-07-04).
 */
describe('long-horizon mood equilibrium (v0.18.0 saturation regression)', () => {
  it('league-mean mood tracks the league-mean setPoint over many seasons', () => {
    // The v0.17.0/early-v0.18.0 bug was systemic upward drift: every
    // driver leaned a little positive, the offseason drift only pulled
    // back partially, and after a few seasons the whole league sat
    // pegged near 100. The fix balances every driver to be zero-mean
    // across the league, so the long-horizon mean must stay close to
    // the league-mean setPoint (~67 from the archetype weighting).
    // Run several seeds + many seasons to make sure the equilibrium
    // doesn't drift across runs.
    const seeds = ['v018-eq-a', 'v018-eq-b', 'v018-eq-c', 'v018-eq-d'];
    let totalSetPoint = 0;
    let totalMood = 0;
    let totalPlayers = 0;
    for (const seed of seeds) {
      let league = createLeague({ seed });
      const rostered = Object.values(league.players).filter((p) => p.teamId !== null);
      totalSetPoint += rostered.reduce((s, p) => s + p.moodProfile.setPoint, 0);
      for (let i = 0; i < 8; i++) {
        league = simulateSeason(league);
        league = advanceSeason(league);
      }
      const moods = Object.values(league.players)
        .filter((p) => p.teamId !== null)
        .map((p) => p.mood);
      totalMood += moods.reduce((s, m) => s + m, 0);
      totalPlayers += moods.length;
      // No team-level saturation either.
      const at100 = moods.filter((m) => m >= 99).length;
      const at0 = moods.filter((m) => m <= 1).length;
      expect(at100 / moods.length).toBeLessThan(0.02);
      expect(at0 / moods.length).toBeLessThan(0.02);
    }
    const setPointMean = totalSetPoint / totalPlayers;
    const moodMean = totalMood / totalPlayers;
    // Across 4 seeds × 8 seasons the average mood should land within
    // ±5 points of the average setPoint. Wider than this was the bug.
    expect(Math.abs(moodMean - setPointMean)).toBeLessThan(5);
  });
});
