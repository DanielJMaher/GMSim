import type { Prng } from '../prng/index.js';
import type { MoodArchetype, MoodProfile } from '../types/player.js';

/**
 * Roll a mood archetype + its parameter band. The weighted distribution
 * matches NFL locker-room reality more than a single shared baseline:
 * most players sit in the "normal" middle, a small fraction anchor the
 * room from the top end (Manning/Lewis), and an even smaller fraction
 * bring real drama (Hill/Ruggs/AJ Brown).
 *
 * The function is pure of its supplied PRNG so callers can either roll
 * fresh at generation (`generatePlayer`) or backfill deterministically
 * from an existing playerId on v0.17.0 saves.
 */
const ARCHETYPE_WEIGHTS: readonly { archetype: MoodArchetype; weight: number }[] = [
  { archetype: 'stabilizer', weight: 5 },
  { archetype: 'anchor', weight: 20 },
  { archetype: 'normal', weight: 50 },
  { archetype: 'moody', weight: 20 },
  { archetype: 'distraction', weight: 5 },
];

interface ArchetypeBand {
  setPoint: [number, number];
  volatility: [number, number];
  resilience: [number, number];
}

const ARCHETYPE_BANDS: Record<MoodArchetype, ArchetypeBand> = {
  stabilizer: { setPoint: [80, 90], volatility: [1, 3], resilience: [0.8, 1.0] },
  anchor: { setPoint: [70, 80], volatility: [2, 4], resilience: [0.6, 0.8] },
  normal: { setPoint: [60, 75], volatility: [3, 6], resilience: [0.4, 0.6] },
  moody: { setPoint: [50, 65], volatility: [5, 8], resilience: [0.2, 0.4] },
  distraction: { setPoint: [35, 55], volatility: [7, 10], resilience: [0.1, 0.3] },
};

export function rollMoodProfile(prng: Prng): MoodProfile {
  const archetype = prng.weighted(
    ARCHETYPE_WEIGHTS.map((a) => ({ value: a.archetype, weight: a.weight })),
  );
  const band = ARCHETYPE_BANDS[archetype];
  return {
    archetype,
    setPoint: rollInBand(prng, band.setPoint),
    volatility: rollInBand(prng, band.volatility),
    resilience: rollInBand(prng, band.resilience),
  };
}

/**
 * Roll a deterministic mood profile from a stable seed string — used
 * for backfilling v0.17.0 saves where players already exist but
 * predate the `moodProfile` field. The same playerId always produces
 * the same profile across runs.
 */
export function rollMoodProfileFromSeed(seed: string): MoodProfile {
  // Tiny local PRNG — we don't import the engine PRNG class here to
  // avoid pulling its full surface into a leaf module. Hash + linear
  // congruential generator is sufficient for deterministic backfill.
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const next = () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 0xffffffff;
  };

  const r = next();
  let cumulative = 0;
  const totalWeight = ARCHETYPE_WEIGHTS.reduce((s, a) => s + a.weight, 0);
  const pick = r * totalWeight;
  let archetype: MoodArchetype = 'normal';
  for (const entry of ARCHETYPE_WEIGHTS) {
    cumulative += entry.weight;
    if (pick < cumulative) {
      archetype = entry.archetype;
      break;
    }
  }
  const band = ARCHETYPE_BANDS[archetype];
  return {
    archetype,
    setPoint: lerp(band.setPoint, next()),
    volatility: lerp(band.volatility, next()),
    resilience: lerp(band.resilience, next()),
  };
}

function rollInBand(prng: Prng, range: [number, number]): number {
  const [lo, hi] = range;
  // Round to 1 decimal so values stay readable in the inspector.
  const t = prng.next();
  return Math.round((lo + (hi - lo) * t) * 10) / 10;
}

function lerp(range: [number, number], t: number): number {
  const [lo, hi] = range;
  return Math.round((lo + (hi - lo) * t) * 10) / 10;
}
