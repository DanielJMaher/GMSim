/**
 * Public API for the GMSim engine.
 *
 * Adding a module's exports here is what "ships" it. Modules with no
 * public surface yet (game-sim, draft, trade, etc.) will land their
 * exports as they're built.
 */

export * from './types/index.js';
export { Prng } from './prng/index.js';
export type { PrngState } from './prng/index.js';

// Phase 1 — Foundation systems
export {
  generateOwner,
  generateGm,
  generateHeadCoach,
  generateFanBase,
  computeTeamPersonality,
  generateTeamPersonnel,
  OWNER_ARCHETYPES,
  GM_ARCHETYPES,
  HC_ARCHETYPES,
  OWNER_QUIRK_POOL,
  GM_QUIRK_POOL,
  HC_QUIRK_POOL,
} from './personnel/index.js';
export type { TeamPersonnelBundle, Archetype, SpectrumRange } from './personnel/index.js';

export { createLeague } from './league/index.js';
export type { CreateLeagueOptions } from './league/index.js';

// Scheme module
export {
  OFFENSIVE_SCHEMES,
  DEFENSIVE_SCHEMES,
  offensiveSchemeFit,
  defensiveSchemeFit,
  schemeFitForPlayer,
} from './scheme/index.js';
export type { OffensiveSchemeDefinition, DefensiveSchemeDefinition } from './scheme/index.js';

// Player Archetype catalog
export {
  PLAYER_ARCHETYPES,
  getArchetypeById,
  getArchetypesForPosition,
} from './archetypes/index.js';
export type { PlayerArchetype, ArchetypeId } from './archetypes/index.js';

// Player generation
export {
  generatePlayer,
  generateRoster,
  ROSTER_BLUEPRINT_53,
  ROSTER_SIZE,
  positionGroupFor,
  rollAgeProfile,
  rollSkills,
  rollDevelopmentArchetype,
} from './players/index.js';
export type {
  GeneratePlayerOptions,
  GenerateRosterOptions,
  RosterPositionSlot,
  AgeStage,
  AgeProfile,
  TalentTier,
  RolledSkills,
} from './players/index.js';

// Contracts + cap accounting
export {
  generateContract,
  TIER_TEMPLATES,
  deriveTier,
  signingBonusProrationPerYear,
  capHitForYear,
  currentCapHit,
  teamCapUsage,
  summarizeTeamCap,
  deadMoneyOnPreJune1Release,
  LEAGUE_MINIMUM_SALARY,
  MAX_PRORATION_YEARS,
  WEEKS_PER_LEAGUE_YEAR,
} from './contracts/index.js';
export type {
  GenerateContractOptions,
  TierTemplate,
  TeamCapSummary,
} from './contracts/index.js';

// Phase 2 — Game simulation + season runner
export { teamStrength, simulateGame } from './games/index.js';
export type { SimulateGameOptions } from './games/index.js';
export {
  generateSchedule,
  simulateSeason,
  runPlayoffs,
  computeRecords,
  sortByRecord,
  divisionStandings,
  playoffSeeds,
  winPct,
  type TeamRecord,
} from './season/index.js';
export type { SimulateSeasonOptions } from './season/index.js';

// Static reference content (32 NFL teams + name pools)
export { NFL_TEAMS, getTeamByAbbreviation, getTeamsByDivision, getTeamsByConference } from './data/team-base/index.js';
export { FIRST_NAMES, LAST_NAMES } from './data/name-pools/index.js';
