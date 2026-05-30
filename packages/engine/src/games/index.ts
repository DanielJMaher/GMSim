export { teamStrength, matchupFacets } from './strength.js';
export type { MatchupFacets } from './strength.js';
export { simulateGame } from './outcome.js';
export type { SimulateGameOptions } from './outcome.js';
// Matchup-driven (bottom-up) drive sim — side-by-side with the legacy path.
export { simulateGameDrives, simulateGameWithDrives, buildTeamPersonnel } from './drive-sim.js';
export type { DriveOutcome, DriveResult, DriveGameResult, PlayerStatLine, TeamPersonnel } from './drive-sim.js';
