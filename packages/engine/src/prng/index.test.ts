import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Prng } from './index.js';

describe('Prng', () => {
  it('is deterministic across two instances with same seed', () => {
    const a = new Prng('test-seed');
    const b = new Prng('test-seed');
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('produces different streams for different seeds', () => {
    const a = new Prng('seed-a');
    const b = new Prng('seed-b');
    let differences = 0;
    for (let i = 0; i < 100; i++) {
      if (a.next() !== b.next()) differences++;
    }
    expect(differences).toBeGreaterThan(95); // Effectively always differ
  });

  it('next() always in [0, 1)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (seed) => {
        const p = new Prng(seed);
        for (let i = 0; i < 50; i++) {
          const v = p.next();
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(1);
        }
      }),
    );
  });

  it('nextInt(n) always in [0, n)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.integer({ min: 1, max: 1000 }), (seed, n) => {
        const p = new Prng(seed);
        for (let i = 0; i < 30; i++) {
          const v = p.nextInt(n);
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(n);
        }
      }),
    );
  });

  it('serialize/deserialize round-trip preserves stream', () => {
    const a = new Prng('round-trip');
    for (let i = 0; i < 17; i++) a.next(); // advance state arbitrarily
    const state = a.serialize();
    const b = Prng.deserialize(state);
    for (let i = 0; i < 50; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('fork(label) is deterministic and independent', () => {
    const root1 = new Prng('parent');
    const root2 = new Prng('parent');
    const childA1 = root1.fork('a');
    const childA2 = root2.fork('a');
    const childB1 = root1.fork('b');

    // Same fork label from same parent state → same stream.
    for (let i = 0; i < 20; i++) {
      expect(childA1.next()).toBe(childA2.next());
    }

    // Different label → different stream.
    let differences = 0;
    const childA3 = new Prng('parent').fork('a');
    const childB2 = new Prng('parent').fork('b');
    for (let i = 0; i < 50; i++) {
      if (childA3.next() !== childB2.next()) differences++;
    }
    expect(differences).toBeGreaterThan(45);
    void childB1;
  });

  it('shuffle is a permutation', () => {
    const p = new Prng('shuffle');
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const original = [...arr];
    p.shuffle(arr);
    expect(arr.sort()).toEqual(original.sort());
  });

  it('weighted respects weight ratios approximately', () => {
    const p = new Prng('weighted');
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 10_000; i++) {
      const v = p.weighted([
        { value: 'a' as const, weight: 1 },
        { value: 'b' as const, weight: 3 },
      ]);
      counts[v]++;
    }
    const ratio = counts.b / counts.a;
    expect(ratio).toBeGreaterThan(2.7);
    expect(ratio).toBeLessThan(3.3);
  });

  it('rejects invalid nextInt input', () => {
    const p = new Prng('x');
    expect(() => p.nextInt(0)).toThrow();
    expect(() => p.nextInt(-1)).toThrow();
    expect(() => p.nextInt(1.5)).toThrow();
  });

  it('rejects empty pick / weighted', () => {
    const p = new Prng('x');
    expect(() => p.pick([])).toThrow();
    expect(() => p.weighted([])).toThrow();
  });
});
