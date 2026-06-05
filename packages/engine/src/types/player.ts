import type { PlayerId, TeamId, ContractId } from './ids.js';
import type { Position, PositionGroup } from './enums.js';
import type { CareerSeasonStats } from './stats.js';
import type { CareerAward } from './awards.js';
import type { PlayerBackstory } from './college.js';

/**
 * Talent tier — a coarse "how good is this player" gradient used for
 * initial contract sizing and as a one-number summary across systems.
 *
 * Generation-time distribution is roughly STAR 5% / STARTER 35% /
 * BACKUP 40% / FRINGE 20%, matching the rough shape of NFL active
 * rosters. Tier can drift later as a player's skills evolve.
 */
export type TalentTier = 'STAR' | 'STARTER' | 'BACKUP' | 'FRINGE';

/**
 * Fine-grained talent grade (Skill Adjudicator, 8 tiers) — the resolution real
 * NFL talent stratifies into (4 tiers was far too coarse for a 32-team league).
 * This is the SOURCE OF TRUTH; the legacy 4-tier `TalentTier` is DERIVED from
 * it (`gradeToTier`), so the ~130 existing tier consumers keep working unchanged
 * while generation / development / awards / the Adjudicator gain real resolution.
 *
 * Anchors: ELITE = 1st-team All-Pro, STAR = Pro Bowl, down to FRINGE = camp body.
 * The abilities / X-Factor layer sits ON TOP of ELITE (the "generational" cut).
 */
export type TalentGrade =
  | 'ELITE'
  | 'STAR'
  | 'HIGH_STARTER'
  | 'STARTER'
  | 'WEAK_STARTER'
  | 'ROTATIONAL'
  | 'BACKUP'
  | 'FRINGE';

/**
 * String-literal union of all player archetype IDs registered in the
 * `engine/archetypes` catalog. Defined here (in the types layer) so
 * `Player.archetype` can be strictly typed without creating a circular
 * dependency between the types and archetypes modules.
 *
 * Adding a new archetype: add its ID here, then add the data entry in
 * `engine/archetypes/catalog.ts` with the same ID.
 */
export type ArchetypeId =
  // Offense
  | 'QB_PRECISION_PASSER'
  | 'QB_VERTICAL_PASSER'
  | 'QB_POCKET_PASSER'
  | 'QB_DUAL_THREAT'
  | 'RB_POWER_BACK'
  | 'RB_RECEIVING_BACK'
  | 'RB_ZONE_RUNNER'
  | 'FB_LEAD_BLOCKER'
  | 'WR_POSSESSION'
  | 'WR_DEEP_THREAT'
  | 'WR_SLOT_TECHNICIAN'
  | 'WR_YAC_SPECIALIST'
  | 'TE_RECEIVING'
  | 'TE_BLOCKING'
  | 'TE_VERSATILE'
  | 'OL_ZONE_BLOCKER'
  | 'OL_POWER_BLOCKER'
  | 'OL_PASS_PROTECTOR'
  // Defense
  | 'DL_PENETRATING_DT'
  | 'DL_NOSE_TACKLE'
  | 'DL_EDGE_PASS_RUSHER'
  | 'DL_TWO_GAP_DE'
  | 'LB_4_3_MIKE'
  | 'LB_3_4_ILB'
  | 'LB_COVERAGE'
  | 'LB_EDGE_3_4'
  | 'DB_PRESS_CB'
  | 'DB_ZONE_CB'
  | 'DB_SLOT_CB'
  | 'DB_BALL_HAWK_S'
  | 'DB_BOX_S'
  // Special teams
  | 'ST_KICKER'
  | 'ST_PUNTER'
  | 'ST_LONG_SNAPPER';

/**
 * Ground-truth player record. Hidden ratings (currentSkill, ceilings,
 * archetype fit) live here and are **never displayed numerically to the
 * player**. The UI reads from the knowledge layer with attributed
 * descriptions instead.
 */
export interface Player {
  id: PlayerId;
  firstName: string;
  lastName: string;
  position: Position;
  positionGroup: PositionGroup;

  /** Years since draft entry. 0 = rookie. */
  experienceYears: number;
  /** Birthdate in ISO YYYY-MM-DD; age is derived from sim clock. */
  birthDate: string;

  /** Team currently rostering this player; null = free agent / retired. */
  teamId: TeamId | null;
  contractId: ContractId | null;

  /** Hidden current-skill ratings. NOT for display. Used by sim/dev/trade. */
  current: PlayerSkills;
  /** Hidden maximum-potential ceilings. NOT for display. Used by development module. */
  ceiling: PlayerSkills;

  /** Hidden development archetype affecting growth response. NOT for display. */
  developmentArchetype: PlayerDevelopmentArchetype;

  /**
   * Talent tier rolled at generation. Drives initial contract sizing
   * and is a useful one-number summary for systems that need a tier
   * but don't want to recompute from skills. Player tier can shift
   * over a career; the value here is the *generation-time* tier.
   */
  tier: TalentTier;

  /**
   * Fine 8-tier talent grade (Skill Adjudicator). Source of truth; `tier` is
   * derived from this via `gradeToTier`. Evolves over a career like `tier`.
   */
  talentGrade: TalentGrade;

  /** Position-specific archetype tag. Drives scheme fit. See ArchetypeId enum. */
  archetype: ArchetypeId;

  /** Injury status. Affects availability and game-sim performance. */
  injury: InjuryStatus | null;

  /** Cumulative wear/conditioning from regular play; 0..100. Internal. */
  conditioning: number;

  /**
   * Sim tick at which this player most recently demanded a trade
   * through their agent, or `null` if they're currently content with
   * their situation. Set when a STAR / STARTER's mood collapses below
   * the trade-request threshold; cleared when their mood recovers.
   *
   * Future slices will let NPC GMs read this flag to decide which
   * dissatisfied players to pursue. The trade primitive itself
   * (v0.14.0) is unaware of this flag — the existence of a request
   * doesn't force any team to act, it just makes the demand observable.
   */
  tradeRequestedOnTick: number | null;

  /**
   * Hidden personality dial for how this player carries themselves in
   * the locker room. Rolled at generation, stable for life. Drives the
   * mood drift target, the per-week noise envelope, and the cap on
   * positive contagion lift. See `MoodProfile` for the archetype
   * distribution.
   */
  moodProfile: MoodProfile;

  /**
   * Hidden mood — the player's happiness with their current situation.
   * 0..100, baseline 75 ("content"). Drifts weekly during the season
   * based on team results, HC fit, and playing-time expectations vs
   * reality. Per North Star, never displayed numerically to the player;
   * the dev inspector exposes both bucket label and raw value, the
   * eventual Phase 4 scouting/news surfaces will use attributed
   * observations only.
   *
   * Buckets (see `moodBucket`):
   *   0..19   wants_out
   *   20..39  frustrated
   *   40..59  unsettled
   *   60..79  content
   *   80..100 happy
   */
  mood: number;

  /**
   * Year-by-year stat snapshots, one entry per season the player
   * recorded non-zero output. Populated by `advanceSeason` at the end
   * of each played season. Empty for new rookies. Cleared with the
   * player on retirement.
   */
  careerStats: readonly CareerSeasonStats[];

  /**
   * Year-end awards this player has won. Populated by `advanceSeason`
   * for the league's MVP / OPOY / DPOY / OROY / DROY winners. Empty
   * for new rookies. Cleared with the player on retirement.
   */
  careerAwards: readonly CareerAward[];

  /**
   * Draft provenance / backstory (v0.92). The round the player was
   * drafted in (1–7), or `null` if undrafted (UDFA). Combined with
   * `experienceYears` this answers "was this a 1st-round pick two years
   * ago?" — pedigree that NFL decision-making leans on (a recent
   * high-pick young QB is the franchise plan; a 6th-rounder isn't).
   *
   * At league creation this is *synthesized* from tier + position (a
   * star was probably a high pick; a good late-rounder is a gem). On a
   * real draft it records the actual pick. Hidden ground truth — the
   * eventual game UI surfaces it as narrative, not as a tuning number.
   */
  draftRound: number | null;
  /** Overall draft slot (1..~224), or `null` if undrafted. See `draftRound`. */
  draftOverallPick: number | null;

  /**
   * College biographical backstory (v0.119) — recruiting pedigree, transfer /
   * redshirt history, multi-sport, NFL bloodline, captaincy. Drafted players
   * carry the real facts from their `CollegePlayer`; generated veterans get a
   * synthesized one from tier + position. Optional so pre-v0.119 saves stay
   * valid until the migration backfills them. The Narrator renders it as prose
   * (`narrateBackstory`); pure public bio, surfaced as narrative not numbers.
   */
  collegeBackstory?: PlayerBackstory;

  // ── Physical profile (v0.94, player-model overhaul Stage 1) ──────────────
  // Size as ground truth — gates plausible roles and feeds role-based
  // scheme fit. Drafted players carry their real combine measurables;
  // generated veterans roll a position-appropriate profile. Hidden truth
  // (surfaced via scouting/measurables, not as raw tuning numbers).
  /** Height in inches. */
  heightInches: number;
  /** Weight in pounds. */
  weightLbs: number;
  /** Arm length in inches. */
  armLengthInches: number;
  /** Hand size in inches. */
  handSizeInches: number;

  /**
   * Hidden standout abilities / X-Factors (v0.102). Ability ids from
   * `players/abilities.ts`. 0 or 1 in practice — sparse, emerge from the
   * granular profile. Ground truth: the game UI surfaces only descriptive
   * scout/media hints, never the flag (North Star). The game sim boosts the
   * ability's facet (Superstar always-on, X-Factor when it activates).
   */
  abilities: readonly string[];
}

/**
 * Skill ratings are stored as 0..100 numbers in the engine but are
 * **NEVER** displayed to the player as numbers. They surface only through
 * descriptive scout reports, observable performance, and statistics.
 */
export interface PlayerSkills {
  // ── Physical ──────────────────────────────────────────────────────────
  speed: number;
  acceleration: number;
  agility: number;
  changeOfDirection: number; // v0.95 — short-area quickness / cuts
  strength: number;
  jumping: number; // v0.95 — verticals / contested / batted balls
  stamina: number; // v0.95 — in-game endurance
  durability: number;

  // ── Legacy umbrella techniques (kept for back-compat; ~30 consumers
  //    read them). Joined by the granular skills below — see
  //    `players/skill-keys.ts`. ──────────────────────────────────────────
  technicalSkill: number;
  handsBallSkills: number;
  blockingTechnique: number;
  passRushTechnique: number;
  coverageTechnique: number;
  tacklingTechnique: number;

  // ── Mental / intangible ───────────────────────────────────────────────
  footballIq: number;
  playRecognition: number; // v0.95 — defensive read/diagnose
  decisionMaking: number;
  leadership: number;
  competitiveness: number;
  workEthic: number;
  coachability: number;
  composure: number;

  // ── Granular skills (v0.95, player-model overhaul Stage 2) ────────────
  // Madden-style + finer breakouts. Each rolls under a parent umbrella
  // (GRANULAR_PARENT) unless an archetype overrides it.

  // QB passing — depth, horizontal placement, situational, + spectacular.
  throwPower: number;
  accuracyShort: number;
  accuracyMedium: number;
  accuracyDeep: number;
  accuracyLeft: number;
  accuracyMiddle: number;
  accuracyRight: number;
  throwOnRun: number;
  throwUnderPressure: number;
  spectacularThrow: number; // off-platform / no-look / cross-body (Mahomes)
  breakSack: number;
  playAction: number;

  // Ball carrier.
  carrying: number;
  ballCarrierVision: number;
  jukeMove: number;
  spinMove: number;
  stiffArm: number;
  trucking: number;
  breakTackle: number;
  elusiveness: number;

  // Receiving.
  routeShort: number;
  routeMedium: number;
  routeDeep: number;
  releaseVsPress: number; // beating a jam at the line
  releaseVsOff: number; // separating vs off coverage
  catching: number;
  catchInTraffic: number;
  contestedCatch: number;

  // Blocking.
  runBlockPower: number;
  runBlockFinesse: number;
  passBlockPower: number;
  passBlockFinesse: number;
  impactBlock: number;
  leadBlock: number;

  // Pass rush — power moves.
  bullRush: number;
  longArm: number;
  pushPull: number;
  // Pass rush — finesse moves.
  swimMove: number;
  ripMove: number;
  spinRush: number;
  crossChop: number;
  ghostMove: number;
  // Pass rush — fundamentals.
  getOff: number; // first-step explosion off the snap
  bend: number; // ankle flexion / edge bend
  handTechnique: number; // hand placement / fighting

  // Run defense / tackling.
  blockShedding: number;
  tackle: number;
  hitPower: number;
  pursuit: number;

  // Coverage.
  manCoverage: number;
  zoneCoverage: number;
  pressCoverage: number;
  ballSkills: number; // defensive playmaking — INTs / PBUs

  // Special teams.
  kickPower: number;
  kickAccuracy: number;
  puntPower: number;
  puntAccuracy: number;
}

/**
 * Personality archetype determining how a player engages with the
 * locker room. NOT directly displayed to the player — surfaces only
 * through observable behavior (mood swings, media leaks, leadership
 * presence). Inspector exposes this for tuning.
 *
 *   stabilizer  — Manning/Lewis-tier room anchors. Setpoint 80-90,
 *                 minimal week-to-week variance. ~5% of the league.
 *   anchor      — Reliable veterans, content professionals. Setpoint
 *                 70-80, low variance. ~20%.
 *   normal      — The bulk of the league. Setpoint 60-75, moderate
 *                 variance. ~50%.
 *   moody       — Swings with the wind, susceptible to results +
 *                 locker-room weather. Setpoint 50-65, high variance.
 *                 ~20%.
 *   distraction — Talent that brings drama: media blowups, off-field
 *                 incidents, openly feuds (Hill / Ruggs / AJ Brown
 *                 archetype). Setpoint 35-55, very high variance. ~5%.
 */
export type MoodArchetype =
  | 'stabilizer'
  | 'anchor'
  | 'normal'
  | 'moody'
  | 'distraction';

export interface MoodProfile {
  archetype: MoodArchetype;
  /** Their natural equilibrium mood, 30..95. Drift pulls toward this. */
  setPoint: number;
  /** Per-week swing envelope, 1..10. Multiplies weekly noise + incident odds. */
  volatility: number;
  /** Strength of regression toward `setPoint` each week, 0.1..1.0. */
  resilience: number;
}

export type PlayerDevelopmentArchetype =
  | 'FAST_LEARNER'
  | 'SLOW_STEADY'
  | 'ADVERSITY_DRIVEN'
  | 'EARLY_BLOOMER'
  | 'LATE_DEVELOPER'
  | 'CONFIDENCE_DEPENDENT';

export interface InjuryStatus {
  type: string;
  severity: 'MINOR' | 'MODERATE' | 'MAJOR';
  /** Sim-week the injury occurred. */
  occurredOnTick: number;
  /** Sim-week the player is expected back. */
  estimatedReturnTick: number;
}
