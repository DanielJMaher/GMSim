// Public API for the players module.

export { generatePlayer } from './generate.js';
export type { GeneratePlayerOptions } from './generate.js';
export { generateRoster, type GenerateRosterOptions } from './roster.js';
export {
  ROSTER_BLUEPRINT_53,
  ROSTER_SIZE,
  type RosterPositionSlot,
} from './roster-blueprint.js';
export { positionGroupFor } from './position-group.js';
export {
  ABILITIES,
  ABILITY_HINTS,
  getAbility,
  describeAbilityHint,
  assignAbilities,
  latentAbilities,
  eligibleAbilityIds,
  type Ability,
  type AbilityTier,
  type AbilityFacet,
} from './abilities.js';
export {
  rollAgeProfile,
  ageToBirthDate,
  type AgeStage,
  type AgeProfile,
} from './age.js';
export {
  rollSkills,
  rollTalentTier,
  rollTalentGrade,
  gradeToTier,
  gradeFromOverall,
  GRADE_ORDER,
  rollDevelopmentArchetype,
  type TalentTier,
  type TalentGrade,
  type RolledSkills,
} from './skills.js';
