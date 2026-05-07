import type { Prng } from '../prng/index.js';
import type { PersonalityTraits } from '../types/personnel.js';
import { rollSpectrum } from './spectrums.js';

/**
 * Roll the six personality traits per the Personnel Gen doc. These are
 * highly stable across the simulation lifetime — they only shift under
 * extreme and sustained circumstances (handled in season simulation).
 *
 * Distribution: full [1, 10] range, gaussian-biased toward the middle so
 * extreme personalities are uncommon (matching the doc's framing of
 * extreme scores as "produces" specific archetypal patterns rather than
 * being the default).
 */
export function rollPersonalityTraits(prng: Prng): PersonalityTraits {
  return {
    egoLevel: gaussianSpectrum(prng),
    confidence: gaussianSpectrum(prng),
    openness: gaussianSpectrum(prng),
    loyalty: gaussianSpectrum(prng),
    integrity: gaussianSpectrum(prng),
    composure: gaussianSpectrum(prng),
  };
}

/**
 * Spectrum value (1-10) drawn from a gaussian centered at 5.5 with
 * stdev 1.8, clamped to [1, 10] and rounded. Most rolls land in [4, 7];
 * extreme values [1-2] or [9-10] are uncommon (~12% combined).
 */
function gaussianSpectrum(prng: Prng): number {
  const v = prng.normal(5.5, 1.8, { min: 1, max: 10 });
  return Math.round(v);
}

// Re-export for tests
export { rollSpectrum };
