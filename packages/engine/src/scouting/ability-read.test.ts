import { describe, it, expect } from 'vitest';
import { Prng } from '../prng/index.js';
import { PositionGroup } from '../types/enums.js';
import { scoutAbilityRead } from './ability-read.js';
import {
  latentAbilities,
  eligibleAbilityIds,
  describeAbilityHint,
  getAbility,
} from '../players/abilities.js';
import type { PlayerSkills } from '../types/player.js';

function flatSkills(v: number): PlayerSkills {
  return new Proxy({}, { get: () => v }) as unknown as PlayerSkills;
}

describe('latentAbilities', () => {
  it('a replacement-level profile has no latent trait', () => {
    expect(latentAbilities(PositionGroup.QB, flatSkills(55))).toHaveLength(0);
  });

  it('an elite profile has a latent trait (no grant roll involved)', () => {
    const got = latentAbilities(PositionGroup.DB, flatSkills(95));
    expect(got).toHaveLength(1);
    expect(getAbility(got[0]!)!.positionGroups).toContain(PositionGroup.DB);
  });

  it('prefers an X-Factor when both bars clear', () => {
    const got = latentAbilities(PositionGroup.DB, flatSkills(95));
    expect(getAbility(got[0]!)!.tier).toBe('X_FACTOR');
  });
});

describe('describeAbilityHint', () => {
  it('every ability has a hedged descriptive hint', () => {
    for (const id of eligibleAbilityIds(PositionGroup.QB)) {
      expect(describeAbilityHint(id)).toBeTruthy();
    }
  });
});

describe('scoutAbilityRead', () => {
  const eligible = eligibleAbilityIds(PositionGroup.DB);
  const latent = ['LOCKDOWN'];

  it('a sharp evaluator spots a real latent trait far more often than a poor one', () => {
    const rate = (reliability: number): number => {
      let spotted = 0;
      const n = 300;
      for (let i = 0; i < n; i++) {
        const reads = scoutAbilityRead(new Prng(`sharp::${reliability}::${i}`), latent, eligible, reliability);
        if (reads.some((r) => r.abilityId === 'LOCKDOWN' && r.hit)) spotted++;
      }
      return spotted / n;
    };
    expect(rate(0.95)).toBeGreaterThan(rate(0.2) + 0.25);
  });

  it('a poor evaluator occasionally false-flags a player with no latent trait', () => {
    let falseFlags = 0;
    const n = 500;
    for (let i = 0; i < n; i++) {
      const reads = scoutAbilityRead(new Prng(`false::${i}`), [], eligible, 0.05);
      if (reads.some((r) => !r.hit)) falseFlags++;
    }
    expect(falseFlags).toBeGreaterThan(0);
  });

  it('a sharp evaluator essentially never false-flags an empty profile', () => {
    let falseFlags = 0;
    const n = 500;
    for (let i = 0; i < n; i++) {
      const reads = scoutAbilityRead(new Prng(`clean::${i}`), [], eligible, 0.98);
      if (reads.length > 0) falseFlags++;
    }
    expect(falseFlags).toBeLessThan(n * 0.02);
  });

  it('is deterministic for a given seed', () => {
    const a = scoutAbilityRead(new Prng('det'), latent, eligible, 0.7);
    const b = scoutAbilityRead(new Prng('det'), latent, eligible, 0.7);
    expect(a).toEqual(b);
  });
});
