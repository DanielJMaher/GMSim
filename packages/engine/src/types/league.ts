import type { TeamState } from './team.js';
import type { Player } from './player.js';
import type { Owner, Gm, HeadCoach, TeamPersonality } from './personnel.js';
import type { Contract } from './contract.js';
import type { SeasonSchedule } from './game.js';
import type { TeamId, PlayerId, OwnerId, GmId, CoachId, ContractId } from './ids.js';

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
  contracts: Readonly<Record<ContractId, Contract>>;

  /** Per-team computed Team Personality. Re-derived when components change. */
  teamPersonalities: Readonly<Record<TeamId, TeamPersonality>>;

  /** Current season's schedule + playoff state. Null before generation. */
  schedule: SeasonSchedule | null;
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
