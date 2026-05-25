import type { GameId, PlayerId } from './ids.js';

/**
 * Kind of college game — discriminates regular season from each
 * postseason round. Drives both narrative tagging in the inspector
 * and the schedule-builder's branching (different round-builders
 * produce different `kind` values).
 *
 *   REGULAR              — regular-season conference + non-conference game
 *   CONFERENCE_CHAMPIONSHIP — conference championship games
 *   BOWL                 — non-CFP bowl slate
 *   CFP_FIRST_ROUND      — 12-team CFP first-round game (seeds 5–12)
 *   CFP_QUARTERFINAL     — quarterfinal round (top 4 byes enter here)
 *   CFP_SEMIFINAL        — semifinals
 *   CFP_FINAL            — national championship
 */
export type CollegeGameKind =
  | 'REGULAR'
  | 'CONFERENCE_CHAMPIONSHIP'
  | 'BOWL'
  | 'CFP_FIRST_ROUND'
  | 'CFP_QUARTERFINAL'
  | 'CFP_SEMIFINAL'
  | 'CFP_FINAL';

/**
 * Per-team game-level stat line. Lighter shape than NFL
 * `TeamGameStats` — Slice 1's game runner is intentionally simpler
 * (team strength + variance, no per-position unit advantages). We
 * carry just the fields the per-prospect stats derivation needs to
 * distribute across the cohort.
 */
export interface CollegeTeamGameStats {
  totalYards: number;
  passingYards: number;
  rushingYards: number;
  turnovers: number;
  sacks: number;
}

/**
 * Result of a played college game. Mirrors NFL `GameResult` in shape
 * so the same UI patterns transfer, but stats are college-specific
 * (no `thirdDownConversionPct` / `redZoneTdPct` — added when the
 * college stats menu expands).
 *
 * No injury rolls in Slice 1 — college injury modeling lives on
 * `CollegePlayer.injuryHistory` and is updated by the existing
 * `advanceCollegePool` cycle once per year. Per-game injuries can
 * land in a polish slice.
 */
export interface CollegeGameResult {
  homeScore: number;
  awayScore: number;
  homeStats: CollegeTeamGameStats;
  awayStats: CollegeTeamGameStats;
  variance: 'controlled' | 'moderate' | 'pure';
}

/**
 * One scheduled college game. Schools are referenced by their stable
 * `CollegeSchool.id` string (e.g. "ALABAMA") rather than a `TeamId`
 * brand — colleges are not NFL teams.
 *
 * `weekNumber` is the regular-season week (1..12) for `REGULAR`. For
 * postseason rounds, it's the round-relative index (1 for the first
 * game of the round) — display-only.
 */
export interface CollegeGame {
  id: GameId;
  weekNumber: number;
  homeSchoolId: string;
  awaySchoolId: string;
  /** Bowl name for `kind === 'BOWL'`. Null otherwise. */
  bowlName: string | null;
  result: CollegeGameResult | null;
  kind: CollegeGameKind;
}

/**
 * Per-prospect stat line for a single college game. Modeled on NFL
 * `PlayerGameStats` so consumers can reuse the same patterns, but
 * **deliberately a separate type** so the two can diverge — college
 * stats will eventually grow conference-specific fields (e.g.
 * separate FCS/FBS opponent splits, college-specific position
 * designations) while NFL stats will likely add play-by-play
 * dimensions.
 *
 * Carries the school id alongside the prospect id so weekly stat
 * leaders can be sorted/grouped without an extra lookup.
 */
export interface CollegePlayerGameStats {
  playerId: PlayerId;
  schoolId: string;
  /** Game this stat line came from. */
  gameId: GameId;
  /** Sim tick when the game was played. */
  playedOnTick: number;
  /** Regular-season week or postseason round-tag. */
  weekNumber: number;
  /** Kind of game — lets consumers separate reg-season from bowls. */
  kind: CollegeGameKind;

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

/**
 * Zeroed college-game stat line. Used as the addition identity by
 * the per-prospect attribute pass.
 */
export function emptyCollegePlayerGameStats(
  playerId: PlayerId,
  schoolId: string,
  gameId: GameId,
  playedOnTick: number,
  weekNumber: number,
  kind: CollegeGameKind,
): CollegePlayerGameStats {
  return {
    playerId,
    schoolId,
    gameId,
    playedOnTick,
    weekNumber,
    kind,
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

/**
 * 12-team College Football Playoff bracket. Stored as separate
 * round-arrays so each lifecycle phase can populate exactly its
 * slice; matches the existing NFL `PlayoffsState` layout.
 *
 * Seeding (real 2024+ format):
 *   - Seeds 1–4: top 4 conference champions, first-round bye
 *   - Seeds 5–12: 4 first-round games (5v12, 6v11, 7v10, 8v9)
 *   - Quarterfinals: 4 byes + 4 first-round winners → 4 games
 *   - Semifinals: 2 games
 *   - Final: 1 game
 */
export interface CfpBracket {
  /** Seeds 1–12 in seed order. School ids. */
  seeds: readonly string[];
  firstRound: readonly CollegeGame[];
  quarterfinals: readonly CollegeGame[];
  semifinals: readonly CollegeGame[];
  final: readonly CollegeGame[];
  /** Champion school id once the final has been played. */
  championSchoolId: string | null;
}

/**
 * Top-level container for one college season's schedule + postseason.
 * Mirrors NFL `SeasonSchedule` shape but with the broader college
 * postseason structure (conference championships → bowl slate → CFP).
 *
 * Each week-grouped sub-array of `regularSeason` is the set of games
 * played that week; populated by `COLLEGE_WEEK` ticks one week at a
 * time. Conference championships, bowls, and CFP rounds populate
 * during their own lifecycle phases.
 */
export interface CollegeSeasonSchedule {
  seasonNumber: number;
  /** Length 12. Each entry is the games played that college week. */
  regularSeason: ReadonlyArray<readonly CollegeGame[]>;
  /** Conference championship games (one per Power/G5 conference that supports one). */
  conferenceChampionships: readonly CollegeGame[];
  /** Non-CFP bowl slate (10+ games). */
  bowls: readonly CollegeGame[];
  /** 12-team CFP bracket. Null until conference championships finalize seeding. */
  cfp: CfpBracket | null;
}

/**
 * A draft all-star showcase (Senior Bowl, Shrine Bowl). Models the
 * pre-draft all-star weeks: a set of the top draft-eligible prospects
 * split into two squads. The substance is the scouting exposure — every
 * NFL team's scouts get a concentrated look — recorded as a boosted
 * observation sweep on the participants (see `runAllStarShowcase`); the
 * squads are flavor for the inspector. Stored per-season on
 * `LeagueState.allStarGames`, cleared each year alongside the college
 * schedule.
 */
export interface AllStarGame {
  id: string;
  /** Display name, e.g. "Senior Bowl". */
  name: string;
  squadAName: string;
  squadBName: string;
  /** Participant `CollegePlayer` ids on each squad. */
  squadA: readonly PlayerId[];
  squadB: readonly PlayerId[];
}

/**
 * Per-prospect aggregated season stat line, summed from the
 * `CollegePlayerGameStats` stream for one college season. Produced by
 * `aggregateCollegeSeasonStats`; consumed by the Heisman race, the
 * inspector's stat leaders, and (later) media production takes.
 */
export interface CollegeSeasonStatLine {
  playerId: PlayerId;
  schoolId: string;
  /** Distinct games this prospect recorded production in. */
  games: number;

  passAttempts: number;
  passCompletions: number;
  passingYards: number;
  passingTds: number;
  interceptionsThrown: number;

  rushingAttempts: number;
  rushingYards: number;
  rushingTds: number;

  targets: number;
  receptions: number;
  receivingYards: number;
  receivingTds: number;

  tackles: number;
  sacks: number;
  interceptions: number;
}

/** Stat categories the leaderboard helper can rank by. */
export type CollegeStatCategory =
  | 'passingYards'
  | 'passingTds'
  | 'rushingYards'
  | 'rushingTds'
  | 'receivingYards'
  | 'receivingTds'
  | 'tackles'
  | 'sacks'
  | 'interceptions';

/**
 * Result of one season's Heisman race. Stored append-only on
 * `LeagueState.heismanHistory` so the award persists as league history
 * (media + draft narratives reference past winners). `finalists` is the
 * top handful by Heisman score, in descending order (index 0 = winner).
 */
export interface HeismanResult {
  seasonNumber: number;
  winnerId: PlayerId;
  winnerSchoolId: string;
  finalists: ReadonlyArray<{
    playerId: PlayerId;
    schoolId: string;
    score: number;
  }>;
}

/**
 * One school's regular-season record. Derived on demand from the
 * played weeks; not stored on `LeagueState`. The conference
 * championship selector + CFP seeder consume this.
 */
export interface CollegeTeamRecord {
  schoolId: string;
  wins: number;
  losses: number;
  conferenceWins: number;
  conferenceLosses: number;
}
