import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import { runAllStarShowcase, prospectTalentScore } from './all-star.js';
import { Prng } from '../prng/index.js';
import type { AllStarShowcaseOptions } from './all-star.js';

const SENIOR: AllStarShowcaseOptions = {
  name: 'Senior Bowl',
  squadAName: 'American',
  squadBName: 'National',
  count: 100,
  skipTop: 0,
  accuracyBonus: 0.12,
  observedOnTick: 0,
};

describe('runAllStarShowcase', () => {
  it('invites the requested number of prospects, split across two squads', () => {
    const league = createLeague({ seed: 'as-1' });
    const { game } = runAllStarShowcase(new Prng('as-1::t'), league, SENIOR);
    expect(game.squadA.length + game.squadB.length).toBe(100);
    expect(Math.abs(game.squadA.length - game.squadB.length)).toBeLessThanOrEqual(1);
    expect(game.name).toBe('Senior Bowl');
  });

  it('squads are disjoint', () => {
    const league = createLeague({ seed: 'as-2' });
    const { game } = runAllStarShowcase(new Prng('as-2::t'), league, SENIOR);
    const a = new Set(game.squadA);
    for (const id of game.squadB) expect(a.has(id)).toBe(false);
  });

  it('invites only declared, draft-eligible prospects', () => {
    const league = createLeague({ seed: 'as-3' });
    const { game } = runAllStarShowcase(new Prng('as-3::t'), league, SENIOR);
    const byId = new Map(league.collegePool.map((cp) => [cp.id, cp]));
    for (const id of [...game.squadA, ...game.squadB]) {
      const cp = byId.get(id)!;
      expect(cp.isDraftEligible).toBe(true);
      expect(cp.hasDeclared).toBe(true);
    }
  });

  it('Senior Bowl draws a higher talent tier than the Shrine Bowl (skipTop)', () => {
    const league = createLeague({ seed: 'as-4' });
    const senior = runAllStarShowcase(new Prng('as-4::t'), league, SENIOR);
    const shrine = runAllStarShowcase(new Prng('as-4::t'), league, {
      ...SENIOR,
      name: 'Shrine Bowl',
      skipTop: 100,
      accuracyBonus: 0.1,
    });
    const byId = new Map(league.collegePool.map((cp) => [cp.id, cp]));
    const avg = (ids: readonly string[]) => {
      const xs = ids.map((id) => prospectTalentScore(byId.get(id as never)!));
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    };
    const seniorAvg = avg([...senior.game.squadA, ...senior.game.squadB]);
    const shrineAvg = avg([...shrine.game.squadA, ...shrine.game.squadB]);
    expect(seniorAvg).toBeGreaterThan(shrineAvg);
  });

  it('generates scouting observations only on participants, at the given tick', () => {
    const league = createLeague({ seed: 'as-5' });
    const { game, observations } = runAllStarShowcase(new Prng('as-5::t'), league, {
      ...SENIOR,
      observedOnTick: 42,
    });
    expect(observations.length).toBeGreaterThan(0);
    const participants = new Set<string>([...game.squadA, ...game.squadB]);
    for (const obs of observations) {
      expect(participants.has(obs.collegePlayerId)).toBe(true);
      expect(obs.observedOnTick).toBe(42);
    }
  });

  it('is deterministic for the same prng + league', () => {
    const league = createLeague({ seed: 'as-6' });
    const a = runAllStarShowcase(new Prng('x'), league, SENIOR);
    const b = runAllStarShowcase(new Prng('x'), league, SENIOR);
    expect(a.game).toEqual(b.game);
    expect(a.observations.length).toBe(b.observations.length);
  });
});
