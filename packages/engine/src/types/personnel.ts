import type { OwnerId, GmId, CoachId } from './ids.js';

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

export interface Gm {
  id: GmId;
  name: string;
  spectrums: GmSpectrums;
  positionalBias: PositionalBias;
  quirks: readonly GmQuirk[];
  personality: PersonalityTraits;
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
