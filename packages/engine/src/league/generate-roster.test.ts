import { describe, it, expect } from 'vitest';
import { createLeague } from './generate.js';
import { ROSTER_SIZE } from '../players/index.js';
import { PRACTICE_SQUAD_SIZE } from '../contracts/constants.js';
import { offensiveSchemeFit, defensiveSchemeFit } from '../scheme/fit.js';

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

  it('total player count is 32 × (53 active + 16 PS)', () => {
    const league = createLeague({ seed: 'total' });
    expect(Object.keys(league.players).length).toBe(32 * (ROSTER_SIZE + PRACTICE_SQUAD_SIZE));
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
    expect(ids.size).toBe(32 * (ROSTER_SIZE + PRACTICE_SQUAD_SIZE));
  });

  it('league is fully deterministic including rosters', () => {
    const a = createLeague({ seed: 'det-roster' });
    const b = createLeague({ seed: 'det-roster' });
    expect(a).toEqual(b);
  });

  it('players are scheme-archetype-skewed per team HC scheme', () => {
    // Generation skews ARCHETYPES toward scheme fit. Measure that via the
    // raw archetype↔scheme multiplier (offensive/defensive catalog value),
    // NOT the v0.96 player-aware `schemeFitForPlayer` (which is dampened by
    // talent and would understate the archetype-level generation skew).
    const league = createLeague({ seed: 'fit-skew' });
    let goodFits = 0;
    let total = 0;
    for (const team of Object.values(league.teams)) {
      const hc = league.coaches[team.headCoachId]!;
      for (const playerId of team.rosterIds) {
        const player = league.players[playerId]!;
        const archetypeFit = Math.max(
          offensiveSchemeFit(player.archetype, hc.offensiveScheme),
          defensiveSchemeFit(player.archetype, hc.defensiveScheme),
        );
        if (archetypeFit >= 1.3) goodFits++;
        total++;
      }
    }
    // We can't easily compute the uniform baseline; just assert a
    // meaningful fraction of players are good archetype fits.
    expect(goodFits / total).toBeGreaterThan(0.15);
  });
});
