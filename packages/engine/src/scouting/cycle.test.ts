import { describe, expect, it } from 'vitest';
import { Prng } from '../prng/index.js';
import { advanceScoutingCycle } from './cycle.js';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from '../season/runner.js';
import { advanceSeason } from '../season/advance.js';

describe('advanceScoutingCycle', () => {
  it('appends new observations stamped with the current tick', () => {
    const league = createLeague({ seed: 'cycle-append' });
    const initialCount = league.observations.length;
    expect(initialCount).toBeGreaterThan(0);

    const observedOnTick = 17;
    const next = advanceScoutingCycle(new Prng('cycle-1'), league, observedOnTick);
    expect(next.observations.length).toBeGreaterThan(initialCount);

    // Every newly-appended observation has the new tick.
    const fresh = next.observations.slice(initialCount);
    for (const obs of fresh) {
      expect(obs.observedOnTick).toBe(observedOnTick);
    }
  });

  it('preserves prior observations untouched', () => {
    const league = createLeague({ seed: 'cycle-preserve' });
    const next = advanceScoutingCycle(new Prng('cycle-2'), league, 17);
    expect(next.observations.slice(0, league.observations.length)).toEqual(
      league.observations,
    );
  });

  it('regenerates watch lists from the full observation history', () => {
    const league = createLeague({ seed: 'cycle-watch' });
    const next = advanceScoutingCycle(new Prng('cycle-3'), league, 17);
    // Every team still has a watch list (length unchanged structurally).
    for (const teamId of Object.keys(league.teams)) {
      const before = league.watchLists[teamId as keyof typeof league.watchLists];
      const after = next.watchLists[teamId as keyof typeof next.watchLists];
      expect(before).toBeDefined();
      expect(after).toBeDefined();
      expect(after!.length).toBeLessThanOrEqual(15);
    }
  });

  it('is deterministic for the same seed', () => {
    const league = createLeague({ seed: 'cycle-determinism' });
    const a = advanceScoutingCycle(new Prng('cycle-d'), league, 17);
    const b = advanceScoutingCycle(new Prng('cycle-d'), league, 17);
    expect(a.observations).toEqual(b.observations);
    expect(a.watchLists).toEqual(b.watchLists);
  });
});

describe('advanceSeason — scouting cycle integration', () => {
  it('runs a scouting cycle each season, accumulating observations', () => {
    let league = createLeague({ seed: 'cycle-season' });
    const beforeCount = league.observations.length;

    // One full season: simulate → advance.
    league = simulateSeason(league);
    league = advanceSeason(league);

    expect(league.observations.length).toBeGreaterThan(beforeCount);

    // Newest observations should be stamped with the new league year's tick.
    const newest = league.observations[league.observations.length - 1]!;
    expect(newest.observedOnTick).toBeGreaterThan(0);
  });

  it('observation accumulation continues across multiple seasons', () => {
    let league = createLeague({ seed: 'cycle-multi' });
    const counts: number[] = [league.observations.length];
    for (let i = 0; i < 3; i++) {
      league = simulateSeason(league);
      league = advanceSeason(league);
      counts.push(league.observations.length);
    }
    // Strictly increasing across seasons.
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThan(counts[i - 1]!);
    }
  });

  it('no watch list entry references a player on the watching team — post-cycle invariant', () => {
    // After a season's worth of trades + FA signings, players move
    // between teams. A previously-observed player might be on the
    // watching team's roster now; they should be filtered out.
    let league = createLeague({ seed: 'cycle-self-exclude' });
    for (let i = 0; i < 2; i++) {
      league = simulateSeason(league);
      league = advanceSeason(league);
    }
    for (const [teamId, list] of Object.entries(league.watchLists)) {
      for (const entry of list) {
        const player = league.players[entry.playerId];
        expect(player).toBeDefined();
        expect(player!.teamId).not.toBe(teamId);
      }
    }
  });
});
