import { PlayerId } from '../types/ids.js';
import type { Player } from '../types/player.js';
import type { Position, PositionGroup } from '../types/enums.js';
import type { Prng } from '../prng/index.js';
import { generateName } from '../personnel/name-generator.js';
import {
  getArchetypesForPosition,
  type PlayerArchetype,
} from '../archetypes/index.js';
import { positionGroupFor } from './position-group.js';
import { rollAgeProfile, ageToBirthDate, type AgeStage, type AgeProfile } from './age.js';
import { rollSkills, rollDevelopmentArchetype } from './skills.js';

export interface GeneratePlayerOptions {
  position: Position;
  /**
   * If supplied, archetype selection is biased toward archetypes with
   * higher fit multipliers in the team's offensive/defensive scheme.
   * Otherwise archetypes are sampled uniformly across the position's
   * compatible archetypes.
   */
  schemeContext?: {
    side: 'OFFENSE' | 'DEFENSE' | 'SPECIAL_TEAMS';
    offensiveScheme?: string; // OffensiveSchemeArchetype
    defensiveScheme?: string; // DefensiveSchemeArchetype
  };
  /** Stable suffix appended to the player ID (typically a counter). */
  idSuffix: string;
  /**
   * If set, skip the weighted age-stage roll and force the player into
   * this stage (with a uniformly-random age inside the stage's range).
   * Used by retirement replacement to inject true rookies mid-sim.
   */
  forceAgeStage?: AgeStage;
  /**
   * Sim year to anchor the rolled birthdate against. Defaults to 2026
   * (league epoch). Mid-sim generators must pass the current sim year
   * (e.g., `2026 + (seasonNumber - 1)`) so birthdates are correct for
   * the season the player enters.
   */
  simYear?: number;
}

/**
 * Generate a single player. Deterministic for a given (prng, options).
 *
 * Pipeline:
 *   1. Pick archetype valid for the position (uniform OR scheme-weighted).
 *   2. Roll age stage + age + birthdate.
 *   3. Roll skills (current + ceiling) biased by archetype skill weights.
 *   4. Roll development archetype uniformly.
 *   5. Generate name.
 *   6. Default to healthy + 100% conditioning.
 */
export function generatePlayer(prng: Prng, options: GeneratePlayerOptions): Player {
  const archetype = pickArchetype(prng, options);
  const age = options.forceAgeStage
    ? rollForcedAge(prng.fork('age'), options.forceAgeStage)
    : rollAgeProfile(prng.fork('age'));
  const skills = rollSkills(prng.fork('skills'), archetype, age.stage);
  const development = rollDevelopmentArchetype(prng.fork('dev'));
  const name = generateName(prng.fork('name'));
  const birthDate = ageToBirthDate(prng.fork('birth'), age.ageYears, options.simYear);

  const positionGroup: PositionGroup = positionGroupFor(options.position);

  return {
    id: PlayerId(`P_${options.idSuffix}`),
    firstName: name.firstName,
    lastName: name.lastName,
    position: options.position,
    positionGroup,
    experienceYears: age.experienceYears,
    birthDate,
    teamId: null, // assigned by caller (roster generator)
    contractId: null, // contracts ship in a later slice
    current: skills.current,
    ceiling: skills.ceiling,
    developmentArchetype: development,
    tier: skills.tier,
    archetype: archetype.id,
    injury: null,
    conditioning: 100,
    mood: 75,
    tradeRequestedOnTick: null,
    careerStats: [],
    careerAwards: [],
  };
}

function rollForcedAge(prng: Prng, stage: AgeStage): AgeProfile {
  const ranges: Record<AgeStage, [number, number]> = {
    ROOKIE: [21, 22],
    DEVELOPING: [23, 24],
    PRIME: [25, 29],
    VETERAN: [30, 33],
    AGING: [34, 39],
  };
  const [min, max] = ranges[stage];
  const ageYears = prng.nextRange(min, max + 1);
  return { stage, ageYears, experienceYears: Math.max(0, ageYears - 22) };
}

function pickArchetype(prng: Prng, options: GeneratePlayerOptions): PlayerArchetype {
  const candidates = getArchetypesForPosition(options.position);
  if (candidates.length === 0) {
    throw new Error(`No archetypes registered for position: ${options.position}`);
  }
  if (!options.schemeContext) {
    return prng.pick(candidates);
  }
  const ctx = options.schemeContext;

  // Bias by scheme fit if scheme info supplied. We compute weights as
  // the scheme fit multiplier (1.0 baseline for unspecified). This means
  // an archetype with +50% fit is 50% more likely to be picked than a
  // neutral archetype, which creates plausible roster-scheme alignment
  // without forcing every player to be a perfect fit.
  const weighted = candidates.map((archetype) => {
    let weight = 1.0;
    if (archetype.side === 'OFFENSE' && ctx.offensiveScheme) {
      weight =
        archetype.offensiveSchemeFit?.[ctx.offensiveScheme as keyof typeof archetype.offensiveSchemeFit] ??
        1.0;
    } else if (archetype.side === 'DEFENSE' && ctx.defensiveScheme) {
      weight =
        archetype.defensiveSchemeFit?.[ctx.defensiveScheme as keyof typeof archetype.defensiveSchemeFit] ??
        1.0;
    }
    return { value: archetype, weight };
  });
  return prng.weighted(weighted);
}
