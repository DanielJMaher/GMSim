import type { Prng } from '../prng/index.js';
import type {
  OwnerQuirk,
  GmQuirk,
  HcQuirk,
} from '../types/personnel.js';

/**
 * All owner quirks per the Personnel Generation doc. Pool is sampled
 * 2-4 at a time per generated owner. The pool size (10) divided into
 * combinations of 2-4 yields enough variety to feel non-repetitive
 * across 32 teams.
 */
export const OWNER_QUIRK_POOL: readonly OwnerQuirk[] = [
  'HEADLINE_HUNGRY',
  'LOYALTY_BLIND',
  'PANIC_SELLER',
  'RING_CHASER',
  'RELIC',
  'RELOCATION_THREAT',
  'PR_OBSESSED',
  'MICRO_MANAGER',
  'TALENT_MAGNET',
  'COMMUNITY_CHAMPION',
];

export const GM_QUIRK_POOL: readonly GmQuirk[] = [
  'COMBINE_OBSESSED',
  'FILM_ROOM_HERMIT',
  'HOMETOWN_HERO_BIAS',
  'SCAR_TISSUE',
  'PHONE_ALWAYS_ON',
  'THE_HOARDER',
  'LOYALTY_KEEPER',
  'RECLAMATION_PROJECT_ADDICT',
  'STAR_CHASER',
  'PROCESS_PURIST',
];

export const HC_QUIRK_POOL: readonly HcQuirk[] = [
  'FOURTH_DOWN_GAMBLER',
  'RUN_FIRST_NO_MATTER_WHAT',
  'QB_WHISPERER',
  'CLOCK_KILLER',
  'BLITZ_HAPPY',
  'CULTURE_CARRIER',
  'LOYAL_TO_A_FAULT',
  'GADGET_PLAY_LOVER',
  'HALFTIME_ADJUSTER',
  'PRESS_CONFERENCE_DISASTER',
];

/**
 * Pick 2-4 unique quirks from a pool. Distribution: 30% chance of 2
 * quirks, 40% chance of 3, 30% chance of 4. This keeps mean ~3 while
 * permitting both lighter and heavier quirk loadouts.
 */
export function pickQuirks<T>(prng: Prng, pool: readonly T[]): readonly T[] {
  const count = prng.weighted([
    { value: 2, weight: 3 },
    { value: 3, weight: 4 },
    { value: 4, weight: 3 },
  ]);
  if (pool.length < count) {
    throw new RangeError(`Quirk pool too small (${pool.length}) for count ${count}`);
  }
  // Fisher-Yates partial shuffle to pick `count` unique elements.
  const indices = Array.from({ length: pool.length }, (_, i) => i);
  for (let i = 0; i < count; i++) {
    const j = i + prng.nextInt(indices.length - i);
    const tmp = indices[i]!;
    indices[i] = indices[j]!;
    indices[j] = tmp;
  }
  return indices.slice(0, count).map((i) => pool[i]!);
}
