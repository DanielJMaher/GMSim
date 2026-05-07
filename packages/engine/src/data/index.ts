// Static reference content (team identities, name pools).
//
// Lives inside the engine because it's structurally part of how the
// engine knows what an NFL league looks like. Splitting these into a
// separate workspace package created a circular dependency without
// adding any modularity benefit.

export * from './team-base/index.js';
export * from './name-pools/index.js';
