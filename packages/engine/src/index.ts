/**
 * Public API for the GMSim engine.
 *
 * Phase 0 exports types and PRNG only — no game logic yet. Each module
 * (personnel, scheme, draft, etc.) will land its public functions here
 * as it ships.
 */

export * from './types/index.js';
export { Prng } from './prng/index.js';
export type { PrngState } from './prng/index.js';
