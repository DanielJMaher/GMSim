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
export { convertiblePositions, canConvertTo } from './position-conversion.js';
export {
  athleticBaseline,
  POSITION_BASELINED_SKILLS,
  type AthleticBaseline,
} from './athletic-baselines.js';
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
export {
  BASE_STARTER_COUNTS,
  computeTeamDepthChart,
  computeLeagueDepthCharts,
  depthScore,
  depthRank,
  isProjectedStarter,
  roleStickinessBonus,
  type TeamDepthChart,
  type DepthChartSlot,
} from './depth-chart.js';
export {
  AGING_CURVES,
  agingBucketFor,
  curveForPosition,
  declineMultiplierFor,
  type AgingBucket,
  type PositionAgingCurve,
} from './aging-curves.js';
export {
  careerShapeFor,
  SHAPE_MODIFIERS,
  type CareerShape,
  type ShapeModifiers,
} from './career-shapes.js';
