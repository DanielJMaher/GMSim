import { CoordinatorId, CoachId } from '../types/ids.js';
import type {
  Coordinator,
  HeadCoach,
  Owner,
  Gm,
  OffensiveSchemeArchetype,
  DefensiveSchemeArchetype,
} from '../types/personnel.js';
import type { Prng } from '../prng/index.js';
import { generateName } from './name-generator.js';
import { generateHeadCoach } from './hc.js';

/**
 * The coordinator tier (S4, v0.140 — Coaching Staff doc #8's first
 * rung). Coordinators are deliberately lite entities: a name, a side,
 * a scheme, and a hidden `stock` that tracks their unit's performance.
 * Their job in the engine is to be the realistic HC pipeline — most
 * new head coaches in real life are coordinators poached off good
 * units, not generated strangers.
 */

const OFFENSIVE_SCHEMES: readonly OffensiveSchemeArchetype[] = [
  'WEST_COAST',
  'AIR_RAID',
  'PRO_STYLE',
  'RUN_HEAVY_POWER',
  'SPREAD',
  'RPO_BASED',
  'MULTIPLE_HYBRID',
];

const DEFENSIVE_SCHEMES: readonly DefensiveSchemeArchetype[] = [
  'BASE_4_3',
  'BASE_3_4',
  'NICKEL_HEAVY_3_3_5',
  'COVER_2_SHELL',
  'AGGRESSIVE_BLITZ_PRESS',
  'HYBRID_MULTIPLE',
];

function clampStock(v: number): number {
  return Math.max(1, Math.min(10, v));
}

export function generateCoordinator(
  prng: Prng,
  idSeed: string,
  side: Coordinator['side'],
): Coordinator {
  const name = generateName(prng);
  const scheme =
    side === 'OC' ? prng.pick(OFFENSIVE_SCHEMES) : prng.pick(DEFENSIVE_SCHEMES);
  return {
    id: CoordinatorId(`${side}_${idSeed}`),
    name: name.fullName,
    side,
    scheme,
    stock: clampStock(5.5 + prng.normal(0, 1.6)),
    status: 'EMPLOYED',
    careerStints: [],
  };
}

/**
 * Season-end stock nudge from the unit's league rank (1 = best of 32):
 * a top-5 unit gains ~+0.6-0.8, a bottom-5 unit loses the same. Stock
 * is sticky (coordinator reputations move slower than results).
 */
export function nudgeCoordinatorStock(coordinator: Coordinator, unitRank: number): Coordinator {
  const delta = ((16.5 - unitRank) / 15.5) * 0.8;
  return { ...coordinator, stock: clampStock(coordinator.stock + delta) };
}

/**
 * Convert a poached coordinator into a full `HeadCoach` (he got the
 * big chair). The generated HC base supplies spectrums/quirks; we then
 * carry over his identity: name, his side's scheme, an
 * offensive/defensive identity matching his background, his OC/DC
 * career stints, and a spectrum-quality nudge from his stock (good
 * coordinators tend to become good coaches — tend).
 */
export function coordinatorToHeadCoach(
  prng: Prng,
  coordinator: Coordinator,
  idSeed: string,
  owner: Owner | null,
  gm: Gm | null,
): HeadCoach {
  const base = generateHeadCoach(prng, idSeed, owner, gm);
  const identity =
    coordinator.side === 'OC'
      ? 7 + Math.floor(prng.next() * 4) // 7-10: offense-led
      : 1 + Math.floor(prng.next() * 4); // 1-4: defense-led
  const stockNudge = (coordinator.stock - 5.5) * 0.5;
  const nudged = { ...base.spectrums };
  for (const key of ['gameManagement', 'staffDevelopment', 'adaptability'] as const) {
    nudged[key] = Math.max(1, Math.min(10, nudged[key] + stockNudge));
  }
  nudged.offensiveDefensiveIdentity = identity;
  return {
    ...base,
    id: CoachId(`HC_${idSeed}`),
    name: coordinator.name,
    spectrums: nudged,
    ...(coordinator.side === 'OC'
      ? { offensiveScheme: coordinator.scheme as OffensiveSchemeArchetype }
      : { defensiveScheme: coordinator.scheme as DefensiveSchemeArchetype }),
    careerStints: coordinator.careerStints,
  };
}
