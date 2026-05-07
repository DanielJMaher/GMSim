// Public API for the personnel module.
//
// Most consumers should use `generateTeamPersonnel` (composes all
// individual generators) or call the league-level entry point at
// `@gmsim/engine` -> `createLeague`.

export { generateOwner } from './owner.js';
export { generateGm } from './gm.js';
export { generateHeadCoach } from './hc.js';
export { generateFanBase } from './fan-base.js';
export { computeTeamPersonality } from './team-personality.js';
export { generateTeamPersonnel } from './generate-team-personnel.js';
export type { TeamPersonnelBundle } from './generate-team-personnel.js';
export {
  OWNER_ARCHETYPES,
  GM_ARCHETYPES,
  HC_ARCHETYPES,
  FULL_RANGE,
  type Archetype,
  type SpectrumRange,
} from './archetypes/index.js';
export { OWNER_QUIRK_POOL, GM_QUIRK_POOL, HC_QUIRK_POOL } from './quirks.js';
