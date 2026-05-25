import type { TeamState } from './team.js';
import type { Player } from './player.js';
import type { Owner, Gm, HeadCoach, TeamPersonality } from './personnel.js';
import type { Scout, PlayerObservation, WatchListEntry } from './scout.js';
import type {
  CollegePlayer,
  CollegeScout,
  CollegePlayerObservation,
  DraftBoardEntry,
  CombineMeasurables,
  ProDayAttendanceRecord,
  DraftPickRecord,
  CoachVisitObservation,
  DraftPickAsset,
  TradeUpRecord,
} from './college.js';
import type { Contract } from './contract.js';
import type { SeasonSchedule } from './game.js';
import type { Transaction } from './transaction.js';
import type { TeamId, PlayerId, OwnerId, GmId, CoachId, ScoutId, ContractId, MediaOutletId } from './ids.js';
import type { MediaOutlet, MediaReport } from './media.js';
import type {
  CollegeSeasonSchedule,
  CollegePlayerGameStats,
  AllStarGame,
  HeismanResult,
} from './college-season.js';

/**
 * Top-level engine state. The entire simulation lives behind this single
 * object. Save/load serializes (a deterministic subset of) this.
 *
 * Storage shape: normalized id-keyed maps. Do NOT denormalize into nested
 * trees — at 32-team scale that ruins lookup performance and update locality.
 */
export interface LeagueState {
  /** Stable seed used to construct the engine PRNG. Saves persist this. */
  seed: string;

  /** Sim clock in weeks since league epoch. Single source of truth for time. */
  tick: number;

  /** Current season number (1-indexed from league start). */
  seasonNumber: number;
  /** Current phase of the league year. */
  phase: LeaguePhase;

  /** Salary cap ceiling for the current league year. */
  salaryCap: number;

  // Normalized entity stores.
  teams: Readonly<Record<TeamId, TeamState>>;
  players: Readonly<Record<PlayerId, Player>>;
  owners: Readonly<Record<OwnerId, Owner>>;
  gms: Readonly<Record<GmId, Gm>>;
  coaches: Readonly<Record<CoachId, HeadCoach>>;
  scouts: Readonly<Record<ScoutId, Scout>>;
  contracts: Readonly<Record<ContractId, Contract>>;

  /** Per-team computed Team Personality. Re-derived when components change. */
  teamPersonalities: Readonly<Record<TeamId, TeamPersonality>>;

  /** Current season's schedule + playoff state. Null before generation. */
  schedule: SeasonSchedule | null;

  /**
   * Append-only history of every roster / contract transaction (release,
   * trade, FA signing, IR move, PS promotion, contract expiration, cap
   * cut). Inspector reads the tail of this for at-a-glance visibility.
   * Capped behavior is the caller's concern — engine never trims.
   */
  transactionLog: readonly Transaction[];

  /**
   * Attributed scouting observations. Each entry is one scout's
   * assessment of one player, with per-skill observed values and
   * confidence. Flat array — filter by `scoutId` or `playerId` in
   * lookups. The eventual knowledge layer will read through this with
   * a per-viewer filter; the dev inspector reads it unfiltered.
   */
  observations: readonly PlayerObservation[];

  /**
   * Per-team watch lists — each team's internal target list of players
   * they're tracking for potential acquisition. Built from a team's own
   * observations + scheme + needs. Overlapping interest across teams
   * is expected (Doc 4: "competitive intelligence"); slice 3 will use
   * these lists to drive availability-signal competition.
   */
  watchLists: Readonly<Record<TeamId, readonly WatchListEntry[]>>;

  /**
   * The league-wide pool of college prospects all 32 teams scout. Per
   * Doc 3: a single shared talent universe that scouts evaluate
   * through their organization-specific lens; the eventual draft event
   * promotes drafted prospects to NFL `Player` records.
   *
   * Slice 1 (v0.32.0) ships the prospect data + advance-cycle. College
   * scouts (slice 2) and per-team draft boards (slice 3) layer on top.
   */
  collegePool: readonly CollegePlayer[];

  /**
   * College scouts — the league's full college-scouting staff across
   * all 32 teams. Each team carries 10–15 (per Doc 3, ownership-
   * financial-commitment driven). Resolved from `TeamState.collegeScoutIds`.
   *
   * NFL pro-personnel scouts live separately on `scouts` — different
   * staffs, different cadences, different specialties (regional
   * coverage matters for college).
   */
  collegeScouts: Readonly<Record<ScoutId, CollegeScout>>;

  /**
   * Attributed observations of college prospects produced by college
   * scouts. Append-only history; the eventual draft-board UI reads
   * through a knowledge-layer filter that limits to "what THIS team's
   * scouts have observed" and reconciles conflicting reports by
   * confidence. The dev inspector reads it unfiltered.
   *
   * Mirrors `LeagueState.observations` shape; Doc 3 explicitly calls
   * for the same per-skill confidence structure to enable reuse of
   * the watch-list-style aggregation in slice 3 (draft boards).
   */
  collegeObservations: readonly CollegePlayerObservation[];

  /**
   * Per-team internal draft boards. Built from each team's own
   * college-scout reports + their scheme + their positional needs.
   * Per Doc 3 every team maintains a unique board — overlap is
   * expected (BLUE_CHIP prospects sit near the top of most boards),
   * but scheme-fit and conversion-projection differences create
   * the variance that drives draft-day reaches and steals.
   *
   * Top N per team (default 50). Regenerated each season after the
   * college scouting cycle; idempotent — pure scoring + sort, no
   * PRNG involved.
   */
  draftBoards: Readonly<Record<TeamId, readonly DraftBoardEntry[]>>;

  /**
   * Combine drill results — one record per declared draft-eligible
   * prospect who attended the combine. Keyed by `CollegePlayer.id`.
   * Generated each offseason when the combine event runs. Per Doc 3:
   * "All 32 teams attend and participate in the combine simultaneously"
   * — these are universal numbers visible to every team.
   */
  combineResults: Readonly<Record<PlayerId, CombineMeasurables>>;

  /**
   * Pro-day attendance per team. Indexed by team id; value is the
   * full schedule of (school, attended) records for the most recent
   * pro-day cycle. Schools rotate based on which have ≥1 draft-eligible
   * prospect. Per Doc 3: "All 32 teams must make deployment decisions
   * across the same schedule." Slice 4 records the decisions;
   * coverage-competition effects on observation quality land in a
   * later refactor of the scouting pipeline.
   */
  proDayAttendance: Readonly<Record<TeamId, readonly ProDayAttendanceRecord[]>>;

  /**
   * Append-only history of every draft pick ever made in this league.
   * Inspector reads the tail by `seasonNumber` to show "this year's
   * draft." The eventual draft-board UI will replay these to surface
   * each rookie's pick details on their player card.
   *
   * Slice 5a only fires round 1 — rounds 2–7 land in slice 5b.
   */
  draftHistory: readonly DraftPickRecord[];

  /**
   * Append-only stream of head-coach visit observations on college
   * prospects. Parallel to `collegeObservations` (scouts) but
   * narrower: coaches grade mental + scheme-fit dimensions only and
   * with significantly higher accuracy. Slice 6 (v0.39.0) ships the
   * primitive; recency-weighting + cross-attendance signal land in
   * future polish slices.
   */
  coachVisitObservations: readonly CoachVisitObservation[];

  /**
   * Tradeable draft pick assets. Each team starts owning their own
   * picks for the next 3 league years; trades change `currentTeamId`
   * while `originalTeamId` stays fixed. `runDraft` consumes assets
   * for the upcoming season and they're rolled forward each
   * `advanceSeason` so the horizon stays at +3 years out from the
   * current draft.
   *
   * Slot ordering at draft time is computed from each pick's
   * `originalTeamId` and the just-finished season's standings — a
   * pick traded from a bad team to a good team still picks at the
   * bad team's slot.
   */
  draftPicks: readonly DraftPickAsset[];

  /**
   * Snapshot of every team's `draftBoards` at the moment each draft
   * fired, keyed by the draft's `seasonNumber`. v0.50.0+. Populated
   * by `advanceSeason` before the draft event; supports the
   * inspector's draft-replay view (boards regenerate post-draft, so
   * the live ones can't be replayed otherwise).
   *
   * Sparse — only contains seasons that actually drafted. Empty
   * `{}` for fresh leagues and migrated pre-v0.50 saves.
   */
  draftBoardSnapshots: Readonly<Record<number, Readonly<Record<TeamId, readonly DraftBoardEntry[]>>>>;

  /**
   * Append-only history of every trade-up that fired during a draft.
   * Populated by `applyDraftResult` when v0.45+ trade-up firing
   * produces records. The inspector's draft-trades view reads this
   * to render trade-up activity without replaying the draft.
   *
   * Empty `[]` for fresh leagues and migrated pre-v0.52 saves.
   */
  tradeUpHistory: readonly TradeUpRecord[];

  /**
   * Fine-grained lifecycle phase (v0.54+). `LeaguePhase` was coarse
   * (REGULAR_SEASON / OFFSEASON_PRE_FA / etc.); `lifecyclePhase`
   * tracks the engine's exact position in the annual cycle so UI
   * can step through one event at a time via `tickPhase`. See
   * `engine/src/season/lifecycle.ts` for the ordered sequence.
   *
   * v0.56 split `REGULAR_SEASON` into `REGULAR_SEASON_WEEK` plus
   * per-playoff-round phases (`WILD_CARD`, `DIVISIONAL`,
   * `CONFERENCE`, `SUPER_BOWL`). `currentWeek` pairs with
   * `REGULAR_SEASON_WEEK` to track in-season position.
   */
  lifecyclePhase: import('../season/lifecycle.js').LifecyclePhase;

  /**
   * Zero-indexed regular-season week most recently played (v0.56+).
   * `null` outside of `REGULAR_SEASON_WEEK` (offseason, playoffs).
   * `0` after the first week is played; advances each
   * `REGULAR_SEASON_WEEK` tick. After the last regular-season week
   * the phase transitions to `WILD_CARD` and `currentWeek` resets
   * to null.
   */
  currentWeek: number | null;

  /**
   * Media outlets that cover this league (v0.62+). ~50 entities
   * generated at league creation: national insiders, beat reporters,
   * team-local columnists, sports radio, blog tier — plus college-
   * focused outlets reserved for the future college-season slice.
   * Stable across league lifespan; no birth/death yet.
   */
  mediaOutlets: Readonly<Record<MediaOutletId, MediaOutlet>>;

  /**
   * Append-only stream of media reports (v0.62+). Each lifecycle tick
   * that has news fires one or more reports per relevant outlet.
   * Reports are filed at the tick when they fire and never mutate.
   * Used by the inspector beat-reporter feed and (future) by college-
   * season aggregators that derive media big boards / Heisman race
   * state from the stream.
   */
  mediaReports: readonly MediaReport[];

  /**
   * College football season schedule (v0.63+). Mirrors NFL `schedule`
   * but with the broader college postseason structure (conference
   * championships → bowls → 12-team CFP). Generated on the first
   * COLLEGE_WEEK tick of each season, cleared at end-of-cycle.
   *
   * Null before the first COLLEGE_WEEK tick of a season and after
   * cleanup at the end of the cycle.
   */
  collegeSchedule: CollegeSeasonSchedule | null;

  /**
   * Zero-indexed college regular-season week most recently played
   * (v0.63+). Parallel to `currentWeek` for NFL, but tracks the
   * interleaved college calendar. `null` before the first college
   * week ticks each year; advances per `COLLEGE_WEEK` tick. After
   * the last college regular-season week, transitions to the
   * postseason chain.
   */
  collegeCurrentWeek: number | null;

  /**
   * Append-only stream of per-prospect college game stats (v0.63+).
   * One entry per (prospect, game) pair where the prospect recorded
   * non-zero output. Future scouting / Heisman / media-big-board
   * slices aggregate this stream to derive season totals and rolling
   * narratives.
   */
  collegeGameStats: readonly CollegePlayerGameStats[];
  /**
   * Draft all-star showcases (Senior Bowl, Shrine Bowl) for the current
   * cycle (v0.65+). Populated by the SENIOR_BOWL / SHRINE_BOWL phases,
   * cleared each year alongside `collegeSchedule`. The scouting boost
   * the showcases produce lives in `collegeObservations`, not here —
   * these entries are the rosters for inspector display.
   */
  allStarGames: readonly AllStarGame[];
  /**
   * Append-only Heisman history (v0.67+), one entry per season the
   * award has been decided. Persists as league history (unlike the
   * per-cycle college schedule) — media + draft narratives reference
   * past winners. Latest entry = most recent winner.
   */
  heismanHistory: readonly HeismanResult[];
}

export type LeaguePhase =
  | 'PRESEASON'
  | 'REGULAR_SEASON'
  | 'PLAYOFFS'
  | 'OFFSEASON_PRE_FA'
  | 'FREE_AGENCY'
  | 'PRE_DRAFT'
  | 'DRAFT'
  | 'POST_DRAFT'
  | 'TRAINING_CAMP';
