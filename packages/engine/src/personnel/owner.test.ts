import { describe, it, expect } from 'vitest';
import { Prng } from '../prng/index.js';
import { generateOwner } from './owner.js';
import { OWNER_ARCHETYPES, getOwnerArchetypeById } from './archetypes/owner.js';
import { OWNER_QUIRK_POOL } from './quirks.js';

describe('generateOwner', () => {
  it('is deterministic for the same seed', () => {
    const a = generateOwner(new Prng('owner-seed'), 'KC');
    const b = generateOwner(new Prng('owner-seed'), 'KC');
    expect(a).toEqual(b);
  });

  it('produces different owners for different seeds', () => {
    const a = generateOwner(new Prng('seed-a'), 'KC');
    const b = generateOwner(new Prng('seed-b'), 'KC');
    // Different seeds → at least name and quirks should differ. (Spectrum
    // overlap is possible at boundary cases but vanishingly rare across all
    // 8 spectrums + 6 personality traits + name + quirks combined.)
    expect(a).not.toEqual(b);
  });

  it('rolls each spectrum within [1, 10]', () => {
    const o = generateOwner(new Prng('spec-bounds'), 'KC');
    for (const v of Object.values(o.spectrums)) {
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(10);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('respects archetype range constraints when archetype is provided', () => {
    // The Meddler: involvement [7,10], ego [7,10], footballKnowledge [1,4]
    const meddler = getOwnerArchetypeById('OWNER_MEDDLER')!;
    // Run many trials so we exercise the spread of the range.
    for (let i = 0; i < 50; i++) {
      const o = generateOwner(new Prng(`meddler-${i}`), 'KC', meddler);
      expect(o.spectrums.involvement).toBeGreaterThanOrEqual(7);
      expect(o.spectrums.involvement).toBeLessThanOrEqual(10);
      expect(o.spectrums.ego).toBeGreaterThanOrEqual(7);
      expect(o.spectrums.ego).toBeLessThanOrEqual(10);
      expect(o.spectrums.footballKnowledge).toBeGreaterThanOrEqual(1);
      expect(o.spectrums.footballKnowledge).toBeLessThanOrEqual(4);
    }
  });

  it('assigns 2-4 quirks from the owner pool', () => {
    for (let i = 0; i < 50; i++) {
      const o = generateOwner(new Prng(`quirks-${i}`), 'KC');
      expect(o.quirks.length).toBeGreaterThanOrEqual(2);
      expect(o.quirks.length).toBeLessThanOrEqual(4);
      // All quirks come from the canonical pool
      for (const q of o.quirks) {
        expect(OWNER_QUIRK_POOL).toContain(q);
      }
      // Quirks are unique within an individual
      expect(new Set(o.quirks).size).toBe(o.quirks.length);
    }
  });

  it('quirk distribution roughly favors 3 over 2/4 across many rolls', () => {
    const counts = { 2: 0, 3: 0, 4: 0 };
    for (let i = 0; i < 500; i++) {
      const o = generateOwner(new Prng(`qdist-${i}`), 'KC');
      counts[o.quirks.length as 2 | 3 | 4]++;
    }
    // Designed weights: 30/40/30 → expect 3 to be most common but not
    // dominant. Tolerance is loose because n=500 is small.
    expect(counts[3]).toBeGreaterThan(counts[2] * 0.85);
    expect(counts[3]).toBeGreaterThan(counts[4] * 0.85);
  });

  it('owner ID is stable and includes the team idSeed', () => {
    const o = generateOwner(new Prng('id-seed'), 'KC');
    expect(o.id).toBe('OWNER_KC');
  });

  it('every archetype produces a valid owner', () => {
    // Smoke test that every archetype's range constraints are valid
    // (no min > max, no out-of-bounds values).
    for (const archetype of OWNER_ARCHETYPES) {
      const o = generateOwner(new Prng(`a-${archetype.id}`), 'KC', archetype);
      for (const v of Object.values(o.spectrums)) {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(10);
      }
    }
  });
});
