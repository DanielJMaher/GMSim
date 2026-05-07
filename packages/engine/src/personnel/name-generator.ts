import { FIRST_NAMES, LAST_NAMES } from '../data/name-pools/index.js';
import type { Prng } from '../prng/index.js';

/**
 * Generate a procedural name as `${first} ${last}`. The two pools are
 * sampled independently — combinatorial space is ~140 × ~190 = ~26k
 * unique names, which is plenty for 32 starting personnel + the
 * coaching/GM carousel turnover over many sim seasons.
 */
export function generateName(prng: Prng): { firstName: string; lastName: string; fullName: string } {
  const firstName = prng.pick(FIRST_NAMES);
  const lastName = prng.pick(LAST_NAMES);
  return { firstName, lastName, fullName: `${firstName} ${lastName}` };
}
