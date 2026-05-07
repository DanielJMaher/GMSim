import type { Prng } from '../prng/index.js';
import type { Archetype, SpectrumRange } from './archetypes/index.js';
import { FULL_RANGE } from './archetypes/index.js';

/**
 * Roll a spectrum score (1-10 inclusive) uniformly from the given range.
 *
 * Uses uniform distribution rather than gaussian: per the design doc,
 * archetype ranges already encode the central tendency for each
 * archetype, so within-range we want flat probability — not a bell
 * curve that under-represents the range edges.
 */
export function rollSpectrum(prng: Prng, range: SpectrumRange): number {
  const [min, max] = range;
  validateRange(range);
  return prng.nextRange(min, max + 1); // nextRange max is exclusive
}

/**
 * For each spectrum key, look up the archetype's specified range (or
 * FULL_RANGE if unspecified) and roll a value. Returns an object keyed
 * by spectrum name.
 *
 * @param keys  All spectrum keys for the target spectrum interface.
 *              Caller must enumerate them (TypeScript can't iterate
 *              interface keys at runtime).
 */
export function rollSpectrumsForArchetype<TKey extends string>(
  prng: Prng,
  archetype: Archetype<TKey>,
  keys: readonly TKey[],
): Record<TKey, number> {
  const result = {} as Record<TKey, number>;
  for (const key of keys) {
    const range = archetype.ranges[key] ?? FULL_RANGE;
    result[key] = rollSpectrum(prng, range);
  }
  return result;
}

function validateRange(range: SpectrumRange): void {
  const [min, max] = range;
  if (!Number.isInteger(min) || !Number.isInteger(max)) {
    throw new RangeError(`Spectrum range must be integers; got [${min}, ${max}]`);
  }
  if (min < 1 || max > 10 || min > max) {
    throw new RangeError(`Spectrum range out of bounds; got [${min}, ${max}]`);
  }
}
