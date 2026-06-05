import { describe, expect, it } from 'vitest';
import { Prng } from '../prng/index.js';
import { scoutTraitFor } from './scout-vocabulary.js';
import { Position } from '../types/enums.js';

describe('scoutTraitFor', () => {
  it('returns a non-empty trait phrase for every position', () => {
    for (const pos of Object.values(Position)) {
      const trait = scoutTraitFor(new Prng(`t-${pos}`), pos);
      expect(trait.length).toBeGreaterThan(3);
    }
  });

  it('gives position-appropriate vocabulary (QB ≠ EDGE ≠ CB pools)', () => {
    const qb = new Set<string>();
    const edge = new Set<string>();
    const cb = new Set<string>();
    for (let i = 0; i < 200; i++) {
      qb.add(scoutTraitFor(new Prng(`q-${i}`), Position.QB));
      edge.add(scoutTraitFor(new Prng(`e-${i}`), Position.EDGE));
      cb.add(scoutTraitFor(new Prng(`c-${i}`), Position.CB));
    }
    // No overlap between the QB, EDGE, and CB trait pools.
    for (const t of qb) expect(edge.has(t)).toBe(false);
    for (const t of edge) expect(cb.has(t)).toBe(false);
    // QB pool surfaces arm/pocket vocabulary; EDGE surfaces rush vocabulary.
    expect([...qb].some((t) => /pocket|arm|processing|velocity/.test(t))).toBe(true);
    expect([...edge].some((t) => /bend|first step|motor|rush|edge/.test(t))).toBe(true);
  });

  it('is deterministic for a given seed', () => {
    expect(scoutTraitFor(new Prng('seed'), Position.WR)).toBe(
      scoutTraitFor(new Prng('seed'), Position.WR),
    );
  });
});
