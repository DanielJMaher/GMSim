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

// Static reference content (32 NFL teams + name pools)
export { NFL_TEAMS, getTeamByAbbreviation, getTeamsByDivision, getTeamsByConference } from './data/team-base/index.js';
export { FIRST_NAMES, LAST_NAMES } from './data/name-pools/index.js';
