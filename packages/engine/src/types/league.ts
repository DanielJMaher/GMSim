import type { TeamState } from './team.js';
import type { Player } from './player.js';
import type { Owner, Gm, HeadCoach, TeamPersonality } from './personnel.js';
import type { Scout, PlayerObservation, WatchListEntry } from './scout.js';
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
