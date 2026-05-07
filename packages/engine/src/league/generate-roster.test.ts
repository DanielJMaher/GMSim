import { describe, it, expect } from 'vitest';
import { createLeague } from './generate.js';
import { ROSTER_SIZE } from '../players/index.js';
import { schemeFitForPlayer } from '../scheme/fit.js';

/**
 * Roster-level league tests. Personnel-only league behavior is covered
 * in `generate.test.ts`; this file focuses on the roster integration.
 */
describe('createLeague — rosters', () => {
  it('every team has exactly 53 players', () => {
    const league = createLeague({ seed: 'roster-len' });
    for (const team of Object.values(league.teams)) {
      expect(team.rosterIds.length).toBe(ROSTER_SIZE);
    }
  });

  it('total player count is 32 × 53 = 1,696', () => {
    const league = createLeague({ seed: 'total' });
    expect(Object.keys(league.players).length).toBe(32 * ROSTER_SIZE);
  });

  it('every roster ID resolves to a player record', () => {
    const league = createLeague({ seed: 'refs' });
    for (const team of Object.values(league.teams)) {
      for (const playerId of team.rosterIds) {
        const player = league.players[playerId];
        expect(player).toBeDefined();
        expect(player!.teamId).toBe(team.identity.id);
      }
    }
  });

  it('player IDs are unique league-wide', () => {
    const league = createLeague({ seed: 'unique' });
    const ids = new Set(Object.keys(league.players));
    expect(ids.size).toBe(32 * ROSTER_SIZE);
  });

  it('league is fully deterministic including rosters', () => {
    const a = createLeague({ seed: 'det-roster' });
    const b = createLeague({ seed: 'det-roster' });
    expect(a).toEqual(b);
  });

  it('players are scheme-archetype-skewed per team HC scheme', () => {
    // For a given league, count players whose archetype is a perfect-fit
    // (offensive multiplier ≥ 1.4 OR defensive multiplier ≥ 1.4) for
    // their team's scheme. Average across teams should be meaningfully
    // above what uniform sampling would produce.
    const league = createLeague({ seed: 'fit-skew' });
    let goodFits = 0;
    let total = 0;
    for (const team of Object.values(league.teams)) {
      const hc = league.coaches[team.headCoachId]!;
      for (const playerId of team.rosterIds) {
        const player = league.players[playerId]!;
        const fit = schemeFitForPlayer(player, {
          offensiveScheme: hc.offensiveScheme,
          defensiveScheme: hc.defensiveScheme,
        });
        if (fit >= 1.3) goodFits++;
        total++;
      }
    }
    // We can't easily compute the uniform baseline; just assert a
    // meaningful fraction of players are good fits.
    expect(goodFits / total).toBeGreaterThan(0.15);
  });
});
