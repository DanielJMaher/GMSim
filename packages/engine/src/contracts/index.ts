// Public API for the contracts module.

export { generateContract } from './generate.js';
export type { GenerateContractOptions } from './generate.js';
export { TIER_TEMPLATES, deriveTier } from './tiers.js';
export type { TierTemplate } from './tiers.js';
export {
  signingBonusProrationPerYear,
  unamortizedSigningBonus,
  capHitForYear,
  currentCapHit,
  teamCapUsage,
  summarizeTeamCap,
  deadMoneyOnPreJune1Release,
} from './cap.js';
export type { TeamCapSummary } from './cap.js';
export {
  LEAGUE_MINIMUM_SALARY,
  ANCHOR_CAP,
  SALARY_CAP_ANNUAL_GROWTH,
  leagueMinimumSalary,
  MAX_PRORATION_YEARS,
  WEEKS_PER_LEAGUE_YEAR,
} from './constants.js';
