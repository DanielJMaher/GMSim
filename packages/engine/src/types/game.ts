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
