import type { OwnerId, GmId, CoachId, CoordinatorId, MediaOutletId, TeamId } from './ids.js';
import type { PositionGroup } from './enums.js';
import type { CareerAward } from './awards.js';

/**
 * Spectrum scores are 1–10. Stored as ground truth and **never displayed
 * to the player** per North Star. Manifest only through observable behavior.
 *
 * Spectrum definitions come from the Personnel Generation System design
 * document. Quirks and personality traits are layered on top of spectrums
 * to produce individual variation.
 */

export type Spectrum = number; // 1..10, validated at construction

// ─── OWNER ──────────────────────────────────────────────────────────────────

export interface OwnerSpectrums {
  involvement: Spectrum;
  patience: Spectrum;
  financialCommitment: Spectrum;
  footballKnowledge: Spectrum;
  legacyMotivation: Spectrum;
  fanConnection: Spectrum;
  riskTolerance: Spectrum;
  ego: Spectrum;
}

export type OwnerQuirk =
  | 'HEADLINE_HUNGRY'
  | 'LOYALTY_BLIND'
  | 'PANIC_SELLER'
  | 'RING_CHASER'
  | 'RELIC'
  | 'RELOCATION_THREAT'
  | 'PR_OBSESSED'
  | 'MICRO_MANAGER'
  | 'TALENT_MAGNET'
  | 'COMMUNITY_CHAMPION';

export interface Owner {
  id: OwnerId;
  name: string;
  spectrums: OwnerSpectrums;
  /** 2–4 quirks per Personnel Generation doc. */
  quirks: readonly OwnerQuirk[];
  personality: PersonalityTraits;
}

// ─── FRONT-OFFICE LIFECYCLE (GM hire/fire design doc) ───────────────────────

/**
 * Employment status for GMs and head coaches. Fired personnel are
 * NEVER deleted from `LeagueState.gms` / `coaches` — they flip to
 * `UNEMPLOYED` and form the retread hiring market; their stints stay
 * readable as history. `RETIRED` is reserved for future use (aging
 * personnel); no S1 path sets it.
 */
export type PersonnelStatus = 'EMPLOYED' | 'UNEMPLOYED' | 'RETIRED';

/** How a career stint ended. `null` end = the stint is still open. */
export type StintEnd =
  | 'FIRED'
  | 'JOINT_FIRED'      // clean house — went down with the other chair
  | 'FIRED_IN_SEASON'  // S2: mid-season firing
  | 'PROMOTED'         // S4: coordinator left for a head-coaching job
  | 'RESIGNED'
  | 'RETIRED';

/**
 * One job a GM or HC held — the résumé line. Append-only on
 * `Gm.careerStints` / `HeadCoach.careerStints`. Season records
 * accumulate onto the open stint once per season during the
 * front-office evaluation; the stint closes (toSeason + end set)
 * when the person is fired. Powers the retread market weighting and
 * the inspector's records-during-tenure view.
 */
export interface CareerStint {
  teamId: TeamId;
  /** S4 (v0.140) extended with the coordinator tier (OC/DC stints). */
  role: 'GM' | 'HC' | 'OC' | 'DC';
  /** First season worked in this job (1-indexed league season). */
  fromSeason: number;
  /** Last season worked, or null while the stint is open. */
  toSeason: number | null;
  wins: number;
  losses: number;
  ties: number;
  playoffAppearances: number;
  /** Super Bowl wins during the stint. */
  championships: number;
  end: StintEnd | null;
}

// ─── GM ─────────────────────────────────────────────────────────────────────

export interface GmSpectrums {
  analyticsReliance: Spectrum;
  tradeAggressiveness: Spectrum;
  draftConviction: Spectrum;
  freeAgencyDiscipline: Spectrum;
  capManagement: Spectrum;
  patienceUnderPressure: Spectrum;
  talentEvaluationAccuracy: Spectrum;
  intangiblesWeighting: Spectrum;
  evolutionRate: Spectrum;
  relationshipQuality: Spectrum;
  /**
   * How much this GM lets the MEDIA consensus pull their draft board (1..10).
   * High = a media-driven GM whose board chases public risers/darlings,
   * especially on prospects their own staff scouted thinly; low = a
   * film-room GM who ignores the noise and trusts only firsthand reads.
   */
  mediaTrust: Spectrum;
}

export type GmQuirk =
  | 'COMBINE_OBSESSED'
  | 'FILM_ROOM_HERMIT'
  | 'HOMETOWN_HERO_BIAS'
  | 'SCAR_TISSUE'
  | 'PHONE_ALWAYS_ON'
  | 'THE_HOARDER'
  | 'LOYALTY_KEEPER'
  | 'RECLAMATION_PROJECT_ADDICT'
  | 'STAR_CHASER'
  | 'PROCESS_PURIST';

/** Hidden positional bias — a specific position the GM systematically over- or undervalues. */
export interface PositionalBias {
  /** Position abbreviation (Position enum). */
  position: string;
  /** Direction and magnitude. Negative = undervalues; positive = overvalues. */
  bias: -2 | -1 | 1 | 2;
}

/**
 * A GM's *perceived* reliability of each media outlet, per position group
 * (1-10, mirroring `MediaOutlet.accuracyByGroup`). This is the GM's BELIEF
 * about which outlets to trust and WHERE — correlated with the outlet's true
 * accuracy but deliberately miscalibrated: sharp GMs (high
 * `talentEvaluationAccuracy`) start near the truth; poor GMs sit near a flat
 * prior with noise; buzz-chasers (high `mediaTrust`) over-rate loud
 * (high-hype) outlets. The draft board blends a media read by THIS, not by
 * the outlet's ground-truth accuracy — so a GM can chase the wrong voice and
 * bust. Evolves toward the truth over seasons (learning). Ground truth, never
 * shown numerically in the game UI (North Star); the dev inspector exposes it.
 */
export type PerceivedOutletReliability = Readonly<
  Record<MediaOutletId, Readonly<Record<PositionGroup, number>>>
>;

export interface Gm {
  id: GmId;
  name: string;
  spectrums: GmSpectrums;
  positionalBias: PositionalBias;
  quirks: readonly GmQuirk[];
  personality: PersonalityTraits;
  /**
   * Per-outlet, per-group perceived reliability (see
   * `PerceivedOutletReliability`). Optional for forward-compat: leagues
   * created before this feature backfill it deterministically in
   * `runMigrations`, and the board blend falls back to the outlet's true
   * accuracy when it is absent.
   */
  perceivedOutletReliability?: PerceivedOutletReliability;
  /**
   * Employment status (front-office lifecycle, v0.138). Pre-v0.138
   * saves backfill `'EMPLOYED'` in `migrateLeagueForward`.
   */
  status: PersonnelStatus;
  /**
   * Job history résumé (front-office lifecycle, v0.138). The open
   * stint is created lazily on first season evaluation, so backfilled
   * saves self-heal. Pre-v0.138 saves backfill `[]`.
   */
  careerStints: readonly CareerStint[];
}

// ─── HEAD COACH ─────────────────────────────────────────────────────────────

export interface HcSpectrums {
  offensiveDefensiveIdentity: Spectrum; // 1 pure D, 10 pure O
  playCallingAggression: Spectrum;
  playerRelationships: Spectrum;
  schemeFlexibility: Spectrum;
  qbDevelopment: Spectrum;
  gameManagement: Spectrum;
  pressureResponse: Spectrum;
  staffDevelopment: Spectrum;
  adaptability: Spectrum;
  experience: Spectrum;
}

export type HcQuirk =
  | 'FOURTH_DOWN_GAMBLER'
  | 'RUN_FIRST_NO_MATTER_WHAT'
  | 'QB_WHISPERER'
  | 'CLOCK_KILLER'
  | 'BLITZ_HAPPY'
  | 'CULTURE_CARRIER'
  | 'LOYAL_TO_A_FAULT'
  | 'GADGET_PLAY_LOVER'
  | 'HALFTIME_ADJUSTER'
  | 'PRESS_CONFERENCE_DISASTER';

export type OffensiveSchemeArchetype =
  | 'WEST_COAST'
  | 'AIR_RAID'
  | 'PRO_STYLE'
  | 'RUN_HEAVY_POWER'
  | 'SPREAD'
  | 'RPO_BASED'
  | 'MULTIPLE_HYBRID';

export type DefensiveSchemeArchetype =
  | 'BASE_4_3'
  | 'BASE_3_4'
  | 'NICKEL_HEAVY_3_3_5'
  | 'COVER_2_SHELL'
  | 'AGGRESSIVE_BLITZ_PRESS'
  | 'HYBRID_MULTIPLE';

export interface HeadCoach {
  id: CoachId;
  name: string;
  spectrums: HcSpectrums;
  offensiveScheme: OffensiveSchemeArchetype;
  defensiveScheme: DefensiveSchemeArchetype;
  quirks: readonly HcQuirk[];
  personality: PersonalityTraits;
  /**
   * Coach-of-the-Year awards earned across simulated seasons.
   * Populated by `advanceSeason`. Empty for newly-generated coaches.
   */
  careerAwards: readonly CareerAward[];
  /** Employment status (front-office lifecycle, v0.138). See `Gm.status`. */
  status: PersonnelStatus;
  /** Job history résumé (front-office lifecycle, v0.138). See `Gm.careerStints`. */
  careerStints: readonly CareerStint[];
}

// ─── COORDINATORS (S4, v0.140) ──────────────────────────────────────────────

/**
 * A coordinator — the tier beneath head coach (Coaching Staff doc #8).
 * Deliberately LITE relative to `HeadCoach`: a name, a side, a scheme,
 * and a hidden `stock` (league reputation, 1-10) that moves with his
 * unit's season performance. Coordinators are carousel entities — they
 * do not influence game sim in S4 (same as HCs; that's a named future
 * thread). Their purpose: the realistic HC hiring pipeline. Most new
 * head coaches are coordinators poached off successful units; a hired
 * coordinator converts to a full `HeadCoach` (carrying his OC/DC
 * career stints) and his old seat backfills.
 */
export interface Coordinator {
  id: CoordinatorId;
  name: string;
  side: 'OC' | 'DC';
  /** Scheme he runs — `OffensiveSchemeArchetype` for OCs, `DefensiveSchemeArchetype` for DCs. */
  scheme: OffensiveSchemeArchetype | DefensiveSchemeArchetype;
  /**
   * Hidden coaching quality / league reputation, 1-10. Nudged each
   * season by his unit's league rank (points scored for OCs, points
   * allowed for DCs). Drives HC-candidacy weighting. Never shown
   * numerically in a game UI; the inspector exposes it.
   */
  stock: number;
  status: PersonnelStatus;
  careerStints: readonly CareerStint[];
}

// ─── PERSONALITY (shared across owner/gm/hc) ────────────────────────────────

export interface PersonalityTraits {
  egoLevel: Spectrum;
  confidence: Spectrum;
  openness: Spectrum;
  loyalty: Spectrum;
  integrity: Spectrum;
  composure: Spectrum;
}

// ─── TEAM PERSONALITY (computed) ────────────────────────────────────────────

/**
 * Derived from Owner + GM + HC + Fan Base via the L/L-01 formula:
 *   Team Personality = 50% Owner + 20% GM + 20% HC + 10% Fans
 *
 * Recomputed any time a component changes (hire/fire/ownership transition).
 * Read by every NPC AI module. Never displayed to the player.
 */
export interface TeamPersonality {
  riskTolerance: number; // 1..10
  analyticsOrientation: number;
  patienceLevel: number;
  financialAggressiveness: number;
  championshipUrgency: number;
  organizationalStability: number;
}

// ─── FAN BASE ───────────────────────────────────────────────────────────────

/**
 * Fan-base profile influences Team Personality at 10% weight per the
 * L/L-01 resolution. Derived at league creation from market size +
 * franchise history archetype, then evolves slowly over multiple
 * seasons in response to results (handled in season simulation).
 *
 * All six dimensions are 1..10. Like everything else in personnel,
 * never displayed to the player as numbers — only manifest through
 * media coverage tone, organizational pressure, and observable behavior.
 */
export interface FanBaseProfile {
  riskTolerance: number;
  analyticsOrientation: number;
  patienceLevel: number;
  financialAggressiveness: number;
  championshipUrgency: number;
  organizationalStability: number;
}
