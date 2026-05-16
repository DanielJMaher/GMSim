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
} from './college.js';
import type { Contract } from './contract.js';
import type { SeasonSchedule } from './game.js';
import type { Transaction } from './transaction.js';
import type { TeamId, PlayerId, OwnerId, GmId, CoachId, ScoutId, ContractId } from './ids.js';

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
