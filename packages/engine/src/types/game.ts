import type { GameId, TeamId, PlayerId } from './ids.js';
import type { PlayerGameStats } from './stats.js';

/**
 * One scheduled game. Lives in the LeagueState schedule until played,
 * then `result` is populated by the game-sim engine.
 */
export interface ScheduledGame {
  id: GameId;
  /** 1-indexed week of the regular season (1..18) or playoff round name. */
  weekNumber: number;
  homeTeamId: TeamId;
  awayTeamId: TeamId;
  result: GameResult | null;
  /** Marks playoff games so playoff and regular-season records are separable. */
  kind: GameKind;
}

export type GameKind = 'PRESEASON' | 'REGULAR' | 'WILD_CARD' | 'DIVISIONAL' | 'CONFERENCE' | 'SUPER_BOWL';

/**
 * How a drive ended.
 *
 * Lives in `types/` rather than `games/drive-sim.ts` because it is now
 * PERSISTED on `GameResult` — a type that goes into the save belongs in the
 * types layer, and `types/` importing from `games/` would invert the layering.
 * `drive-sim.ts` re-exports both names, so every existing import still works.
 */
export type DriveResult =
  | 'TD'
  | 'FG'
  | 'MISSED_FG'
  | 'PUNT'
  | 'TURNOVER'
  | 'DOWNS'
  | 'SAFETY'
  | 'END_HALF';

export interface DriveOutcome {
  offense: 'home' | 'away';
  result: DriveResult;
  plays: number;
  yards: number;
  /** Game-clock seconds this drive consumed (v0.178 — the clock IS the
   *  half budget; see the CLOCK_* constants). 0 on END_HALF markers. */
  clock: number;
  /** Field position the drive started at (own-yards 0-100), P1 v0.179 —
   *  set by the possession-chain from the prior drive's transition. */
  start: number;
}

/**
 * Result of a played game. Stats are intentionally minimal here —
 * they're enough to feed downstream systems (development, media,
 * standings) without committing to play-by-play resolution. Per-player
 * stat distribution is computed at attribute time, not stored on the
 * GameResult, to keep the type small.
 */
export interface GameResult {
  homeScore: number;
  awayScore: number;
  homeStats: TeamGameStats;
  awayStats: TeamGameStats;
  injuries: readonly GameInjury[];
  /** Categorical reason for variance — useful for media narrative later. */
  variance: 'controlled' | 'moderate' | 'pure';
  /**
   * Emergent per-player stat lines (v0.106+, bottom-up stat engine only).
   * Present when the game was simulated with `statEngine: 'bottomup'` —
   * `deriveGamePlayerStats` returns these verbatim instead of distributing
   * the team box score top-down. Absent for legacy top-down games.
   */
  playerStats?: readonly PlayerGameStats[];
  /**
   * Roster Viability §4.1 (2026-08-05): teams that had NO available QB and
   * started an emergency skill-position passer instead. Absent when both
   * teams had a real QB (the overwhelming common case). Feeds the
   * `emergency-qb-game` transaction log entry — see `season/lifecycle.ts`.
   */
  emergencyQb?: { home?: PlayerId; away?: PlayerId };

  /**
   * Drive-by-drive log, present for bottom-up games (the default engine).
   *
   * Persisted deliberately, because it CANNOT be recovered later. The drive
   * sim's PRNG seed is derivable, but the league STATE at kickoff is not —
   * injuries propagate, players move to IR, rosters change — so replaying a
   * past game runs the right dice against the wrong personnel. Measured
   * 2026-09-11: a self-verifying replay (return a chart only when the replayed
   * score matches the recorded one) reproduced **2 of 272 games**, and score
   * equality is weak evidence besides.
   *
   * This also corrects `GAME_UI_FOUNDATION.md` §5, which assumed results are
   * re-simmable from (matchup id × seed) and built the alpha triage flow on it.
   *
   * Optional so that saves written before it existed stay valid — a box score
   * from an older save simply shows no chart, rather than the save failing to
   * load.
   */
  driveLog?: readonly DriveOutcome[];
}

export interface TeamGameStats {
  totalYards: number;
  passingYards: number;
  rushingYards: number;
  turnovers: number;
  sacks: number;
  thirdDownConversionPct: number;
  redZoneTdPct: number;
}

export interface GameInjury {
  playerId: PlayerId;
  weeksOut: number;
  severity: 'MINOR' | 'MODERATE' | 'MAJOR';
  type: string;
}

/**
 * Top-level container for one season's schedule + completed/pending
 * games. One per season; lives at `LeagueState.schedule`.
 */
export interface SeasonSchedule {
  seasonNumber: number;
  /** Length is 18 weeks for the regular season. Each entry has 14-16 games (some bye weeks). */
  regularSeason: ReadonlyArray<readonly ScheduledGame[]>;
  /** Empty until the regular season completes. Then populated round by round. */
  playoffs: PlayoffsState | null;
}

export interface PlayoffsState {
  wildCard: readonly ScheduledGame[];
  divisional: readonly ScheduledGame[];
  conference: readonly ScheduledGame[];
  superBowl: readonly ScheduledGame[]; // length 1
  championId: TeamId | null;
}
