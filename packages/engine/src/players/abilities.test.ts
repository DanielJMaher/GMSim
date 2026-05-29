import { describe, it, expect } from 'vitest';
import { Prng } from '../prng/index.js';
import { PositionGroup } from '../types/enums.js';
import { ABILITIES, getAbility, assignAbilities } from './abilities.js';
import type { PlayerSkills } from '../types/player.js';

// A skill set where every key is `v`. Cast through unknown — we only need
// the keys the ability demands to be present + numeric.
function flatSkills(v: number): PlayerSkills {
  return new Proxy(
    {},
    {
      get: () => v,
    },
  ) as unknown as PlayerSkills;
}

describe('abilities catalog', () => {
  it('every ability has a unique id and resolvable lookup', () => {
    const ids = new Set(ABILITIES.map((a) => a.id));
    expect(ids.size).toBe(ABILITIES.length);
    for (const a of ABILITIES) {
      expect(getAbility(a.id)).toBe(a);
    }
  });

  it('every ability declares at least one demanded skill', () => {
    for (const a of ABILITIES) {
      expect(a.demandedSkills.length).toBeGreaterThan(0);
    }
  });
});

describe('assignAbilities', () => {
  it('grants nothing to a replacement-level player', () => {
    const prng = new Prng('test::low');
    const got = assignAbilities(prng, PositionGroup.QB, flatSkills(55));
    expect(got).toHaveLength(0);
  });

  it('grants at most one ability even to an elite profile', () => {
    // Sweep many seeds; an elite QB sometimes lands an ability, never 2+.
    let everGranted = false;
    for (let i = 0; i < 50; i++) {
      const got = assignAbilities(new Prng(`elite::${i}`), PositionGroup.QB, flatSkills(95));
      expect(got.length).toBeLessThanOrEqual(1);
      if (got.length === 1) everGranted = true;
    }
    expect(everGranted).toBe(true);
  });

  it('only grants abilities valid for the position group', () => {
    for (let i = 0; i < 50; i++) {
      const got = assignAbilities(new Prng(`db::${i}`), PositionGroup.DB, flatSkills(95));
      for (const id of got) {
        expect(getAbility(id)!.positionGroups).toContain(PositionGroup.DB);
      }
    }
  });

  it('is deterministic for a given seed', () => {
    const a = assignAbilities(new Prng('seed::x'), PositionGroup.DL, flatSkills(92));
    const b = assignAbilities(new Prng('seed::x'), PositionGroup.DL, flatSkills(92));
    expect(a).toEqual(b);
  });

  it('an elite profile prefers an X-Factor over a Superstar when both qualify', () => {
    // At skill 95 both X (>=90) and SS (>=84) bars clear; whenever an
    // ability is granted to a DB, sweep should produce at least one X_FACTOR.
    let sawXFactor = false;
    for (let i = 0; i < 100; i++) {
      const got = assignAbilities(new Prng(`pref::${i}`), PositionGroup.DB, flatSkills(95));
      if (got.length === 1 && getAbility(got[0]!)!.tier === 'X_FACTOR') sawXFactor = true;
    }
    expect(sawXFactor).toBe(true);
  });
});
