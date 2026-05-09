import type { PlayerId } from './ids.js';

/**
 * Per-player stat line for a single game. All values are integer
 * counts; 0 means "didn't record this stat" (no nullable fields, to
 * keep summation trivial).
 *
 * Phase 2 surface is intentionally narrow — enough to feed a leaders
 * board and to give scouting/dev signal, not a full play-by-play stat
 * sheet. New stats can be added when systems start needing them.
 *
 * Per `types/game.ts`, stats are NOT stored on the GameResult. They
 * are *derived* at attribute time from team-level GameResult numbers
 * + the rosters that played, via `deriveGamePlayerStats`. Season
 * aggregation walks every played game and sums.
 */
export interface PlayerGameStats {
  playerId: PlayerId;

  // ── Passing ────────────────────────────────────────────────────
  passAttempts: number;
  passCompletions: number;
  passingYards: number;
  passingTds: number;
  interceptionsThrown: number;

  // ── Rushing ────────────────────────────────────────────────────
  rushingAttempts: number;
  rushingYards: number;
  rushingTds: number;

  // ── Receiving ──────────────────────────────────────────────────
  targets: number;
  receptions: number;
  receivingYards: number;
  receivingTds: number;

  // ── Defense ────────────────────────────────────────────────────
  tackles: number;
  sacks: number;
  interceptions: number;
}

export interface PlayerSeasonStats extends PlayerGameStats {
  /** Number of games this player appeared in (with non-zero stat output). */
  gamesPlayed: number;
}

/**
 * One season's stat line attached to `Player.careerStats`. Same shape
 * as `PlayerSeasonStats` plus the `seasonNumber` it was recorded in,
 * so consumers can display year-by-year tables and compute career
 * totals by walking the array.
 *
 * Snapshotted at end of season by `advanceSeason` for any player who
 * recorded non-zero output.
 */
export interface CareerSeasonStats extends PlayerSeasonStats {
  /** League season number this stat line is from (1-indexed). */
  seasonNumber: number;
}

/**
 * Convenience: a zeroed stat line. Used as the addition identity.
 */
export function emptyPlayerGameStats(playerId: PlayerId): PlayerGameStats {
  return {
    playerId,
    passAttempts: 0,
    passCompletions: 0,
    passingYards: 0,
    passingTds: 0,
    interceptionsThrown: 0,
    rushingAttempts: 0,
    rushingYards: 0,
    rushingTds: 0,
    targets: 0,
    receptions: 0,
    receivingYards: 0,
    receivingTds: 0,
    tackles: 0,
    sacks: 0,
    interceptions: 0,
  };
}
