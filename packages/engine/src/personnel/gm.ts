import { GmId } from '../types/ids.js';
import { Position } from '../types/enums.js';
import type {
  Gm,
  GmSpectrums,
  Owner,
  OwnerSpectrums,
  PositionalBias,
} from '../types/personnel.js';
import type { Prng } from '../prng/index.js';
import { GM_ARCHETYPES } from './archetypes/index.js';
import { rollSpectrumsForArchetype } from './spectrums.js';
import { GM_QUIRK_POOL, pickQuirks } from './quirks.js';
import { rollPersonalityTraits } from './traits.js';
import { generateName } from './name-generator.js';

const GM_SPECTRUM_KEYS: readonly (keyof GmSpectrums)[] = [
  'analyticsReliance',
  'tradeAggressiveness',
  'draftConviction',
  'freeAgencyDiscipline',
  'capManagement',
  'patienceUnderPressure',
  'talentEvaluationAccuracy',
  'intangiblesWeighting',
  'evolutionRate',
  'relationshipQuality',
  'mediaTrust',
];

/**
 * Generate a GM. If an owner is supplied, the GM archetype is sampled
 * with hiring-tendency weighting — owner profile influences which kind
 * of GM the team is most likely to hire.
 *
 * Per the Personnel Gen doc:
 *   - High analytics knowledge + low ego owner → favors Analytics Architect
 *   - Patience-oriented owner → favors patient rebuilder
 *   - Win-now owner → favors aggressive trader / win-now operator
 *   - Spendthrift owner with low knowledge → may produce Cap Disaster
 */
export function generateGm(prng: Prng, idSeed: string, owner: Owner | null = null): Gm {
  const archetype = owner ? sampleGmArchetypeForOwner(prng, owner) : prng.pick(GM_ARCHETYPES);

  const spectrums = rollSpectrumsForArchetype(prng, archetype, GM_SPECTRUM_KEYS) as GmSpectrums;
  const quirks = pickQuirks(prng, GM_QUIRK_POOL);
  const personality = rollPersonalityTraits(prng);
  const positionalBias = rollPositionalBias(prng);
  const name = generateName(prng);

  return {
    id: GmId(`GM_${idSeed}`),
    name: name.fullName,
    spectrums,
    positionalBias,
    quirks,
    personality,
    status: 'EMPLOYED',
    careerStints: [],
  };
}

/**
 * Sample an archetype from `GM_ARCHETYPES` with weights derived from
 * the owner's spectrum profile. Floors at 0.3 so even unlikely matches
 * remain occasionally possible (the simulation should produce
 * surprising hires once in a while).
 */
function sampleGmArchetypeForOwner(prng: Prng, owner: Owner): (typeof GM_ARCHETYPES)[number] {
  const weights = GM_ARCHETYPES.map((arch) => ({
    value: arch,
    weight: gmArchetypeWeight(arch.id, owner.spectrums),
  }));
  return prng.weighted(weights);
}

function gmArchetypeWeight(archetypeId: string, o: OwnerSpectrums): number {
  const FLOOR = 0.3;
  const lerp = (favorability: number, scale = 0.4): number =>
    Math.max(FLOOR, 1 + ((favorability - 5) / 5) * scale * 5);

  switch (archetypeId) {
    case 'GM_ANALYTICS_ARCHITECT':
      return lerp(o.footballKnowledge) * (1 + (10 - o.ego - 5) * 0.05);
    case 'GM_OLD_SCHOOL':
      return lerp(11 - o.footballKnowledge);
    case 'GM_ASSET_ACCUMULATOR':
      return lerp(o.patience);
    case 'GM_WIN_NOW_AGGRESSOR':
      return lerp(11 - o.patience) * (1 + (o.legacyMotivation - 5) * 0.05);
    case 'GM_CAP_MAGICIAN':
      return lerp(o.footballKnowledge, 0.25);
    case 'GM_CAP_DISASTER':
      // Big spenders without football literacy hire cap disasters.
      return Math.max(
        FLOOR,
        0.6 + (o.financialCommitment - 5) * 0.15 + (5 - o.footballKnowledge) * 0.1,
      );
    case 'GM_SCHEME_OPTIMIZER':
      return lerp(o.footballKnowledge, 0.2);
    case 'GM_CONSERVATIVE_BUILDER':
      return lerp(11 - o.riskTolerance);
    case 'GM_PRESSURE_PRONE':
      // Rarely the *intended* hire; emerges from low-patience pressure cookers.
      return Math.max(FLOOR, 0.4 + (5 - o.patience) * 0.1);
    case 'GM_BALANCED':
      return 1.5;
    default:
      return 1;
  }
}

/**
 * Every GM has a hidden positional bias — a single position they
 * systematically over- or undervalue. Direction (-2..2 excluding 0)
 * and target position are rolled independently.
 *
 * Per the Personnel Gen doc this is permanent — it doesn't shift
 * during the sim, only manifests in observed draft/trade behavior.
 */
function rollPositionalBias(prng: Prng): PositionalBias {
  const positions = Object.values(Position);
  const position = prng.pick(positions);
  const bias = prng.pick([-2, -1, 1, 2] as const);
  return { position, bias };
}
