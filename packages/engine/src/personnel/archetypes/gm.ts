import type { GmSpectrums } from '../../types/personnel.js';
import type { Archetype } from './common.js';

/**
 * GM archetype categories. The Personnel Gen doc explicitly mentions
 * "Analytics Architect" and "Old School Evaluator" as examples; the rest
 * of this catalog is filled in based on the doc's spectrum vocabulary
 * and quirk pool.
 *
 * Note: talentEvaluationAccuracy is rolled independently of archetype —
 * any archetype can produce a sharp or a poor evaluator. That spectrum
 * gates long-term roster quality regardless of philosophy.
 */

type GmArchetype = Archetype<keyof GmSpectrums>;

export const GM_ARCHETYPES: readonly GmArchetype[] = [
  {
    id: 'GM_ANALYTICS_ARCHITECT',
    label: 'The Analytics Architect',
    ranges: {
      analyticsReliance: [8, 10],
      capManagement: [7, 10],
      freeAgencyDiscipline: [6, 9],
      evolutionRate: [6, 9],
    },
  },
  {
    id: 'GM_OLD_SCHOOL',
    label: 'The Old School Evaluator',
    ranges: {
      analyticsReliance: [1, 3],
      evolutionRate: [1, 4],
      intangiblesWeighting: [7, 10],
    },
  },
  {
    id: 'GM_ASSET_ACCUMULATOR',
    label: 'The Asset Accumulator',
    ranges: {
      draftConviction: [7, 10],
      patienceUnderPressure: [7, 10],
      tradeAggressiveness: [4, 7],
      freeAgencyDiscipline: [7, 10],
    },
  },
  {
    id: 'GM_WIN_NOW_AGGRESSOR',
    label: 'The Win-Now Aggressor',
    ranges: {
      tradeAggressiveness: [8, 10],
      patienceUnderPressure: [1, 4],
      freeAgencyDiscipline: [1, 4],
      capManagement: [3, 6],
    },
  },
  {
    id: 'GM_CAP_MAGICIAN',
    label: 'The Cap Magician',
    ranges: {
      capManagement: [8, 10],
      freeAgencyDiscipline: [7, 10],
      relationshipQuality: [6, 9],
    },
  },
  {
    id: 'GM_CAP_DISASTER',
    label: 'The Cap Disaster',
    // Often paired with Spendthrift owners or Win-Now ownership pressure.
    ranges: {
      capManagement: [1, 4],
      freeAgencyDiscipline: [1, 4],
    },
  },
  {
    id: 'GM_SCHEME_OPTIMIZER',
    label: 'The Scheme Optimizer',
    // High evolution + high relationship = collaborates closely with HC.
    ranges: {
      evolutionRate: [7, 10],
      relationshipQuality: [7, 10],
      analyticsReliance: [5, 8],
    },
  },
  {
    id: 'GM_CONSERVATIVE_BUILDER',
    label: 'The Conservative Builder',
    ranges: {
      tradeAggressiveness: [1, 4],
      draftConviction: [3, 6],
      freeAgencyDiscipline: [6, 9],
    },
  },
  {
    id: 'GM_PRESSURE_PRONE',
    label: 'The Hot Seat Operator',
    // GM under sustained heat — panicky, makes desperate moves.
    ranges: {
      patienceUnderPressure: [1, 3],
      relationshipQuality: [2, 5],
      tradeAggressiveness: [6, 9],
    },
  },
  {
    id: 'GM_BALANCED',
    label: 'The Balanced Operator',
    ranges: {
      analyticsReliance: [4, 7],
      tradeAggressiveness: [4, 7],
      capManagement: [4, 7],
      freeAgencyDiscipline: [4, 7],
      patienceUnderPressure: [4, 7],
    },
  },
] as const;

export function getGmArchetypeById(id: string): GmArchetype | undefined {
  return GM_ARCHETYPES.find((a) => a.id === id);
}
