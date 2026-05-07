import type { OwnerSpectrums } from '../../types/personnel.js';
import type { Archetype } from './common.js';

/**
 * Owner archetype categories. Each constrains 2-5 spectrums to a probable
 * range; the rest roll free. Categories are designer-defined per the
 * Personnel Generation doc's open thread on archetype range constraints.
 *
 * Coverage rationale: every category in this list should be plausible at
 * NFL ownership level. The generation algorithm samples one of these per
 * team at league creation, then rolls spectrum scores within the chosen
 * archetype's ranges.
 */

type OwnerArchetype = Archetype<keyof OwnerSpectrums>;

export const OWNER_ARCHETYPES: readonly OwnerArchetype[] = [
  {
    id: 'OWNER_BALANCED',
    label: 'The Balanced Steward',
    ranges: {
      involvement: [4, 6],
      patience: [4, 7],
      footballKnowledge: [4, 7],
      ego: [3, 6],
    },
  },
  {
    id: 'OWNER_MEDDLER',
    label: 'The Meddler',
    // High involvement + high ego + low football knowledge = the dangerous
    // Meddler emerges naturally per the Personnel Gen doc.
    ranges: {
      involvement: [7, 10],
      ego: [7, 10],
      footballKnowledge: [1, 4],
    },
  },
  {
    id: 'OWNER_SAGE',
    label: 'The Football Sage',
    // High involvement + high knowledge = a genuine organizational asset.
    ranges: {
      involvement: [6, 9],
      footballKnowledge: [8, 10],
      patience: [5, 8],
      ego: [3, 6],
    },
  },
  {
    id: 'OWNER_HANDS_OFF',
    label: 'The Hands-Off Owner',
    ranges: {
      involvement: [1, 3],
      ego: [1, 5],
    },
  },
  {
    id: 'OWNER_PENNY_PINCHER',
    label: 'The Penny Pincher',
    ranges: {
      financialCommitment: [1, 4],
      legacyMotivation: [2, 5],
    },
  },
  {
    id: 'OWNER_SPENDTHRIFT',
    label: 'The Spendthrift',
    ranges: {
      financialCommitment: [7, 10],
      patience: [2, 5],
      involvement: [5, 8],
    },
  },
  {
    id: 'OWNER_CHAMPIONSHIP_CHASER',
    label: 'The Championship Chaser',
    // High legacy motivation + impatience + financial commitment = Ring Chaser
    // pattern (and the quirk pool tends to reinforce this on top).
    ranges: {
      legacyMotivation: [8, 10],
      patience: [2, 4],
      financialCommitment: [7, 10],
      ego: [6, 9],
    },
  },
  {
    id: 'OWNER_BUSINESSMAN',
    label: 'The Pure Businessman',
    ranges: {
      legacyMotivation: [1, 4],
      fanConnection: [2, 5],
      financialCommitment: [3, 6],
    },
  },
  {
    id: 'OWNER_VISIONARY',
    label: 'The Visionary Eccentric',
    ranges: {
      riskTolerance: [7, 10],
      ego: [6, 9],
      involvement: [5, 9],
    },
  },
  {
    id: 'OWNER_CIVIC_CUSTODIAN',
    label: 'The Civic Custodian',
    ranges: {
      fanConnection: [8, 10],
      patience: [6, 9],
      financialCommitment: [5, 8],
      ego: [2, 5],
    },
  },
] as const;

export function getOwnerArchetypeById(id: string): OwnerArchetype | undefined {
  return OWNER_ARCHETYPES.find((a) => a.id === id);
}
