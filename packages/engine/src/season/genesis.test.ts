import { describe, it, expect } from 'vitest';
import { createLivingLeague, type GenesisProgressEvent } from './genesis.js';

describe('createLivingLeague', () => {
  it('reports GENERATING_ROSTERS, one SIMULATING_YEAR per genesis year, then FINALIZING', () => {
    const events: GenesisProgressEvent[] = [];
    createLivingLeague({
      seed: 'genesis-progress',
      genesisYears: 2,
      onProgress: (e) => events.push(e),
    });

    expect(events).toEqual([
      { step: 'GENERATING_ROSTERS' },
      { step: 'SIMULATING_YEAR', year: -2, yearsTotal: 2 },
      { step: 'SIMULATING_YEAR', year: -1, yearsTotal: 2 },
      { step: 'FINALIZING' },
    ]);
  });

  it('is deterministic: same seed produces the same post-genesis league', () => {
    const a = createLivingLeague({ seed: 'genesis-determinism', genesisYears: 2 });
    const b = createLivingLeague({ seed: 'genesis-determinism', genesisYears: 2 });

    expect(a.seasonNumber).toBe(b.seasonNumber);
    expect(a.tick).toBe(b.tick);
    expect(Object.values(a.teams).map((t) => t.rosterIds.length)).toEqual(
      Object.values(b.teams).map((t) => t.rosterIds.length),
    );
    expect(Object.keys(a.players).sort()).toEqual(Object.keys(b.players).sort());
  });

  it('respects genesisYears and advances seasonNumber/tick accordingly', () => {
    const zero = createLivingLeague({ seed: 'genesis-zero-years', genesisYears: 0 });
    const one = createLivingLeague({ seed: 'genesis-zero-years', genesisYears: 1 });

    expect(one.seasonNumber).toBe(zero.seasonNumber + 1);
    expect(one.tick).toBeGreaterThan(zero.tick);
  });

  it('runs the default 5-year genesis with no roster-floor-violation and produces a valid 53-man league', () => {
    const league = createLivingLeague({ seed: 'genesis-default-5y' });

    expect(league.seasonNumber).toBe(6); // year -5 genesis + 5 forward-simulated seasons
    const violations = (league.transactionLog ?? []).filter(
      (t) => t.kind === 'roster-floor-violation',
    );
    expect(violations).toHaveLength(0);

    for (const team of Object.values(league.teams)) {
      expect(team.rosterIds.length).toBeLessThanOrEqual(53);
    }
  });
});
