import type { HcSpectrums } from '../../types/personnel.js';
import type { Archetype } from './common.js';

/**
 * Head Coach archetype categories. Each defines spectrum ranges; offensive
 * and defensive scheme assignment is rolled separately (see scheme.ts in
 * the same module) using archetype-influenced weights.
 */

type HcArchetype = Archetype<keyof HcSpectrums>;

export const HC_ARCHETYPES: readonly HcArchetype[] = [
  {
    id: 'HC_OFFENSIVE_INNOVATOR',
    label: 'The Offensive Innovator',
    ranges: {
      offensiveDefensiveIdentity: [8, 10],
      adaptability: [6, 9],
      playCallingAggression: [6, 9],
      qbDevelopment: [6, 9],
    },
  },
  {
    id: 'HC_DEFENSIVE_ARCHITECT',
    label: 'The Defensive Architect',
    ranges: {
      offensiveDefensiveIdentity: [1, 3],
      schemeFlexibility: [4, 7],
      gameManagement: [5, 8],
    },
  },
  {
    id: 'HC_PLAYERS_COACH',
    label: "The Players' Coach",
    ranges: {
      playerRelationships: [8, 10],
      staffDevelopment: [3, 7],
      pressureResponse: [4, 7],
    },
  },
  {
    id: 'HC_DISCIPLINARIAN',
    label: 'The Disciplinarian',
    ranges: {
      playerRelationships: [1, 4],
      gameManagement: [6, 9],
      schemeFlexibility: [2, 5],
    },
  },
  {
    id: 'HC_QB_WHISPERER',
    label: 'The QB Whisperer',
    ranges: {
      qbDevelopment: [8, 10],
      adaptability: [7, 10],
      playerRelationships: [6, 9],
      offensiveDefensiveIdentity: [6, 9],
    },
  },
  {
    id: 'HC_CEO_COACH',
    label: 'The CEO Coach',
    ranges: {
      gameManagement: [7, 10],
      staffDevelopment: [8, 10],
      experience: [7, 10],
      pressureResponse: [6, 9],
    },
  },
  {
    id: 'HC_TACTICIAN',
    label: 'The Tactician',
    ranges: {
      adaptability: [8, 10],
      gameManagement: [8, 10],
      schemeFlexibility: [7, 10],
    },
  },
  {
    id: 'HC_CLIMBER',
    label: 'The First-Time Climber',
    // Boom-or-bust hire. Pressure response combined with low experience
    // is the rare/exciting find pattern called out in the Personnel Gen doc.
    ranges: {
      experience: [1, 3],
      pressureResponse: [6, 10],
      adaptability: [5, 9],
    },
  },
  {
    id: 'HC_JOURNEYMAN',
    label: 'The Journeyman',
    ranges: {
      experience: [7, 10],
      gameManagement: [4, 7],
      schemeFlexibility: [4, 7],
      adaptability: [4, 7],
    },
  },
  {
    id: 'HC_SCHEME_RIGID',
    label: 'The Scheme Purist',
    ranges: {
      schemeFlexibility: [1, 3],
      adaptability: [2, 5],
      qbDevelopment: [4, 7],
    },
  },
] as const;

export function getHcArchetypeById(id: string): HcArchetype | undefined {
  return HC_ARCHETYPES.find((a) => a.id === id);
}
