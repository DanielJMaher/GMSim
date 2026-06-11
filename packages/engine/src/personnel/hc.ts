import { CoachId } from '../types/ids.js';
import type {
  HeadCoach,
  HcSpectrums,
  Owner,
  OwnerSpectrums,
  Gm,
  GmSpectrums,
  OffensiveSchemeArchetype,
  DefensiveSchemeArchetype,
} from '../types/personnel.js';
import type { Prng } from '../prng/index.js';
import { HC_ARCHETYPES } from './archetypes/index.js';
import { rollSpectrumsForArchetype } from './spectrums.js';
import { HC_QUIRK_POOL, pickQuirks } from './quirks.js';
import { rollPersonalityTraits } from './traits.js';
import { generateName } from './name-generator.js';

const HC_SPECTRUM_KEYS: readonly (keyof HcSpectrums)[] = [
  'offensiveDefensiveIdentity',
  'playCallingAggression',
  'playerRelationships',
  'schemeFlexibility',
  'qbDevelopment',
  'gameManagement',
  'pressureResponse',
  'staffDevelopment',
  'adaptability',
  'experience',
];

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

/**
 * Generate a Head Coach. If owner and/or GM are supplied, the archetype
 * is sampled with hiring-tendency weights:
 *   - Owners contribute the "what kind of coach do we want" pressure.
 *   - GMs (the typical primary hirer of HCs) contribute scheme-philosophy
 *     and analytics-orientation alignment preferences.
 *
 * Per the Personnel Gen doc, "HC hiring follows similar logic filtered
 * through GM preferences where the GM has autonomy."
 */
export function generateHeadCoach(
  prng: Prng,
  idSeed: string,
  owner: Owner | null = null,
  gm: Gm | null = null,
): HeadCoach {
  const archetype =
    owner || gm ? sampleHcArchetypeForOwnership(prng, owner, gm) : prng.pick(HC_ARCHETYPES);

  const spectrums = rollSpectrumsForArchetype(prng, archetype, HC_SPECTRUM_KEYS) as HcSpectrums;
  const quirks = pickQuirks(prng, HC_QUIRK_POOL);
  const personality = rollPersonalityTraits(prng);
  const name = generateName(prng);

  // Scheme assignment is influenced by the offensiveDefensiveIdentity
  // spectrum — offensive-leaning HCs favor modern/innovative offenses,
  // defensive-leaning HCs favor more aggressive defensive shells.
  const offensiveScheme = sampleOffensiveScheme(prng, spectrums, archetype.id);
  const defensiveScheme = sampleDefensiveScheme(prng, spectrums, archetype.id);

  return {
    id: CoachId(`HC_${idSeed}`),
    name: name.fullName,
    spectrums,
    offensiveScheme,
    defensiveScheme,
    quirks,
    personality,
    careerAwards: [],
    status: 'EMPLOYED',
    careerStints: [],
  };
}

function sampleHcArchetypeForOwnership(
  prng: Prng,
  owner: Owner | null,
  gm: Gm | null,
): (typeof HC_ARCHETYPES)[number] {
  const weights = HC_ARCHETYPES.map((arch) => ({
    value: arch,
    weight: hcArchetypeWeight(arch.id, owner?.spectrums ?? null, gm?.spectrums ?? null),
  }));
  return prng.weighted(weights);
}

function hcArchetypeWeight(
  archetypeId: string,
  o: OwnerSpectrums | null,
  g: GmSpectrums | null,
): number {
  const FLOOR = 0.3;
  // Default to neutral 5 when context isn't supplied.
  const ownerKnowledge = o?.footballKnowledge ?? 5;
  const ownerPatience = o?.patience ?? 5;
  const ownerLegacy = o?.legacyMotivation ?? 5;
  const ownerRisk = o?.riskTolerance ?? 5;
  const gmAnalytics = g?.analyticsReliance ?? 5;
  const gmEvolution = g?.evolutionRate ?? 5;

  switch (archetypeId) {
    case 'HC_OFFENSIVE_INNOVATOR':
      // Innovators favored when GM is analytics-friendly and owner accepts risk.
      return Math.max(FLOOR, 1 + (gmAnalytics - 5) * 0.15 + (ownerRisk - 5) * 0.1);
    case 'HC_DEFENSIVE_ARCHITECT':
      return Math.max(FLOOR, 1 + (5 - ownerRisk) * 0.1);
    case 'HC_PLAYERS_COACH':
      return 1.0;
    case 'HC_DISCIPLINARIAN':
      return Math.max(FLOOR, 1 + (5 - gmEvolution) * 0.1);
    case 'HC_QB_WHISPERER':
      // Premium hire — knowledgeable owners and adaptive GMs covet them.
      return Math.max(FLOOR, 1 + (ownerKnowledge - 5) * 0.15 + (gmEvolution - 5) * 0.1);
    case 'HC_CEO_COACH':
      // Impatient owners want proven track records.
      return Math.max(FLOOR, 1 + (5 - ownerPatience) * 0.15 + (ownerLegacy - 5) * 0.1);
    case 'HC_TACTICIAN':
      return Math.max(FLOOR, 1 + (gmAnalytics - 5) * 0.1);
    case 'HC_CLIMBER':
      // Boom-or-bust — risk-tolerant ownership and adventurous GMs.
      return Math.max(FLOOR, 0.7 + (ownerRisk - 5) * 0.15 + (gmEvolution - 5) * 0.1);
    case 'HC_JOURNEYMAN':
      return 1.5;
    case 'HC_SCHEME_RIGID':
      return 0.7;
    default:
      return 1;
  }
}

function sampleOffensiveScheme(
  prng: Prng,
  spectrums: HcSpectrums,
  archetypeId: string,
): OffensiveSchemeArchetype {
  const offensiveLean = spectrums.offensiveDefensiveIdentity;

  // Offensive innovators / QB whisperers favor modern offenses.
  // Scheme-rigid coaches over-index on PRO_STYLE / RUN_HEAVY_POWER (older systems).
  const isInnovative =
    archetypeId === 'HC_OFFENSIVE_INNOVATOR' || archetypeId === 'HC_QB_WHISPERER';
  const isRigid = archetypeId === 'HC_SCHEME_RIGID';

  const weights: { value: OffensiveSchemeArchetype; weight: number }[] = OFFENSIVE_SCHEMES.map(
    (s) => ({ value: s, weight: 1 }),
  );

  for (const w of weights) {
    if (isInnovative && (w.value === 'RPO_BASED' || w.value === 'SPREAD' || w.value === 'MULTIPLE_HYBRID')) {
      w.weight *= 2;
    }
    if (isRigid && (w.value === 'PRO_STYLE' || w.value === 'RUN_HEAVY_POWER')) {
      w.weight *= 2.5;
    }
    if (offensiveLean >= 8 && w.value !== 'RUN_HEAVY_POWER') {
      // Strong offensive identity → pass-leaning systems.
      w.weight *= 1.3;
    }
    if (offensiveLean <= 3 && w.value === 'RUN_HEAVY_POWER') {
      // Defensive-leaning HC tends to lean conservative on offense.
      w.weight *= 1.5;
    }
  }
  return prng.weighted(weights);
}

function sampleDefensiveScheme(
  prng: Prng,
  spectrums: HcSpectrums,
  _archetypeId: string,
): DefensiveSchemeArchetype {
  const defensiveLean = 11 - spectrums.offensiveDefensiveIdentity;

  const weights: { value: DefensiveSchemeArchetype; weight: number }[] = DEFENSIVE_SCHEMES.map(
    (s) => ({ value: s, weight: 1 }),
  );

  for (const w of weights) {
    if (defensiveLean >= 8 && w.value === 'AGGRESSIVE_BLITZ_PRESS') {
      // Defensive-minded HC favors pressure schemes.
      w.weight *= 2;
    }
    if (defensiveLean >= 7 && w.value === 'HYBRID_MULTIPLE') {
      w.weight *= 1.5;
    }
    if (defensiveLean <= 3 && w.value === 'COVER_2_SHELL') {
      // Offensive HC tends to want a safe defensive coordinator.
      w.weight *= 1.5;
    }
  }
  return prng.weighted(weights);
}
