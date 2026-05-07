// Public API for the scheme module.
//
// Scheme metadata (descriptive attributes) lives here. Scheme-fit
// calculation (`fitMultiplier`) lives here too, but the underlying
// data — per-archetype scheme-fit multipliers — is in
// `packages/engine/src/archetypes/`.

export {
  OFFENSIVE_SCHEMES,
  DEFENSIVE_SCHEMES,
  type OffensiveSchemeDefinition,
  type DefensiveSchemeDefinition,
} from './definitions.js';

export { offensiveSchemeFit, defensiveSchemeFit, schemeFitForPlayer } from './fit.js';
