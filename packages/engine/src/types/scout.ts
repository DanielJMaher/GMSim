import type { ScoutId, PlayerId } from './ids.js';
import type { PositionGroup } from './enums.js';
import type { PlayerSkills } from './player.js';

/**
 * Why a player is on a team's watch list. Derived heuristically from
 * the scoring breakdown at generation time. Per Doc 4, miscast
 * elevation candidates and role-player IDs are the highest-value
 * targets. See `engine/src/scouting/watch-list.ts` for derivation.
 *
 *   SCHEME_FIT          — strong archetype match for our scheme.
 *   POSITIONAL_NEED     — we're thin at this group; talent matters more
 *                          than fit at this position group.
 *   MISCAST_ELEVATION   — talented player on a team whose scheme
 *                          poorly suits them; would elevate in ours.
 *   ROLE_PLAYER         — observed skill is high relative to tier;
 *                          they'd fill a targeted role.
 */
export type WatchListReason =
  | 'SCHEME_FIT'
  | 'POSITIONAL_NEED'
  | 'MISCAST_ELEVATION'
  | 'ROLE_PLAYER';

/**
 * One target on a team's internal watch list. Built from the team's
 * own scouts' observations + scheme + positional needs. The same
 * player can appear on many teams' lists — Doc 4 calls out the
 * "competitive intelligence" that emerges from overlapping interest.
 *
 * Per North Star, watch lists are organizational state — not displayed
 * to other teams in the eventual game UI. The dev inspector shows
 * every team's list for tuning.
 */
export interface WatchListEntry {
  playerId: PlayerId;
  /** Composite priority, 0..100 — higher = stronger interest. */
  priority: number;
  reason: WatchListReason;
  /**
   * Confidence-weighted aggregate of this player's key skills from the
   * team's own observations. The team's *belief* about how good the
   * player is — not the truth.
   */
  observedSkillScore: number;
  /** Scheme-fit multiplier in the team's scheme (uses true archetype). */
  schemeFit: number;
  /** Mean per-skill confidence across the team's observations. */
  meanConfidence: number;
  /** How many independent scouts on this team have observed this player. */
  observationCount: number;
  /** Sim tick when this entry was added to the list. */
  addedOnTick: number;
}

/**
 * Personality quirk affecting a scout's evaluation pattern. Each scout
 * carries 1–2 from this pool. Quirks bias observation noise and confidence
 * in specific contexts. Hidden — surfaces only through observed patterns.
 *
 * Source: Doc 4 (Roster & Free Agent Scouting), "Individual Pros, Cons,
 * and Quirks" section.
 *
 *   OVERVALUES_NAME_RECOGNITION — pushes estimates upward for players
 *                                  with career awards or established
 *                                  reputations.
 *   SHARP_ON_ROLE_PLAYERS       — lower noise on BACKUP / FRINGE tier
 *                                  players. Misses on starters more often.
 *   MISSES_SCHEME_FIT           — higher noise on technique skills
 *                                  (blocking, pass-rush, coverage,
 *                                  tackling, technical).
 *   PRACTICE_SQUAD_GEM_HUNTER   — sharp on FRINGE tier in particular;
 *                                  bonus to confidence.
 *   YOUNG_PLAYER_BIAS           — lower noise on <3 yrs experience.
 *   VETERAN_LOYALIST            — lower noise on 8+ yrs experience.
 */
export type ScoutQuirk =
  | 'OVERVALUES_NAME_RECOGNITION'
  | 'SHARP_ON_ROLE_PLAYERS'
  | 'MISSES_SCHEME_FIT'
  | 'PRACTICE_SQUAD_GEM_HUNTER'
  | 'YOUNG_PLAYER_BIAS'
  | 'VETERAN_LOYALIST';

/**
 * NFL player scout. Separate from college scouts (which arrive with the
 * Draft Module). Each team employs 3–5; staff size + mean accuracy
 * track Owner `financialCommitment` and GM `talentEvaluationAccuracy`.
 *
 * Per North Star, ground-truth fields (`trueAccuracy`, `quirks`) are
 * **never displayed numerically to the player**. The dev inspector
 * exposes them for tuning; the eventual game UI surfaces only
 * `knownSpecialty` + identity and discovers true accuracy through
 * track-record observation.
 */
export interface Scout {
  id: ScoutId;
  name: string;
  /** Age in years. */
  age: number;
  /** Years of NFL scouting experience. Independent of `age`. */
  yearsExperience: number;

  /** PositionGroup the GM officially understands this scout to focus on. */
  knownSpecialty: PositionGroup;

  /**
   * Hidden true accuracy per position group, 0..1. Often (but not
   * always) higher in `knownSpecialty`. Per the doc, scouts may carry
   * "hidden depths" — a non-specialty group where they're unknowingly
   * elite. Discovered through track-record only.
   */
  trueAccuracy: Readonly<Record<PositionGroup, number>>;

  /** 1–2 quirks from `ScoutQuirk`. Hidden. */
  quirks: readonly ScoutQuirk[];
}

/**
 * One attributed observation made by a scout about a player. The set
 * of all observations is the engine's raw scouting-intelligence store;
 * the eventual game UI will read through a knowledge-layer filter that
 * limits to "what the viewer's scouts have observed" and reconciles
 * conflicting reports by confidence.
 *
 * One record can cover many skills — `skills` is a partial map; future
 * slices may let scouts skip skills they didn't assess.
 */
export interface PlayerObservation {
  scoutId: ScoutId;
  playerId: PlayerId;
  /** Sim tick when this observation was recorded. */
  observedOnTick: number;
  /** Observed values for the skills this scout assessed, 0..100. */
  skills: Readonly<Partial<Record<keyof PlayerSkills, number>>>;
  /**
   * Per-skill confidence, 0..1. Mirrors the keys of `skills`. Lower
   * confidence = noisier estimate; the knowledge layer should weight
   * accordingly when reconciling reports from multiple sources.
   */
  confidence: Readonly<Partial<Record<keyof PlayerSkills, number>>>;
}
