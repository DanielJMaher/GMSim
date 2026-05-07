import type { PlayerId, TeamId, ContractId } from './ids.js';
import type { Position, PositionGroup } from './enums.js';

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

  /** Position-specific archetype tag. Drives scheme fit. See ArchetypeId enum. */
  archetype: ArchetypeId;

  /** Injury status. Affects availability and game-sim performance. */
  injury: InjuryStatus | null;

  /** Cumulative wear/conditioning from regular play; 0..100. Internal. */
  conditioning: number;
}

/**
 * Skill ratings are stored as 0..100 numbers in the engine but are
 * **NEVER** displayed to the player as numbers. They surface only through
 * descriptive scout reports, observable performance, and statistics.
 */
export interface PlayerSkills {
  // Physical
  speed: number;
  acceleration: number;
  agility: number;
  strength: number;
  durability: number;

  // Position-skill umbrellas. Sub-skills under each are computed when needed.
  // Stored at this granularity to keep the type small; sub-skill resolution
  // happens in the archetype-fit + scheme-fit calculations.
  technicalSkill: number;
  footballIq: number;
  decisionMaking: number;
  handsBallSkills: number;
  blockingTechnique: number;
  passRushTechnique: number;
  coverageTechnique: number;
  tacklingTechnique: number;

  // Mental/intangible
  leadership: number;
  competitiveness: number;
  workEthic: number;
  coachability: number;
  composure: number;
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
