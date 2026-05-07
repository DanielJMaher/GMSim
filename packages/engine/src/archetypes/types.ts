import type { Position, PositionGroup } from '../types/enums.js';
import type {
  OffensiveSchemeArchetype,
  DefensiveSchemeArchetype,
} from '../types/personnel.js';
import type { PlayerSkills, ArchetypeId } from '../types/player.js';

export type { ArchetypeId } from '../types/player.js';

/**
 * A position-specific archetype that defines:
 *   1. What kind of player this is (skill priorities)
 *   2. How well that player fits each scheme (multipliers)
 *
 * Source: Player Archetypes by Scheme Identity Design Document
 * (Drive ID `1QFkiduUxrs5UsHCc4JdLkukIsc64Ib_hYUqTQog-N_I`).
 *
 * Unspecified scheme-fit values default to 1.0 (neutral). Multipliers
 * generally fall in [0.5, 1.7]:
 *   - 1.0   = neutral fit
 *   - > 1.0 = good fit (player is more valuable in this scheme)
 *   - < 1.0 = poor fit (player undervalued / underperforms)
 */
export interface PlayerArchetype {
  /** Stable internal ID. Never displayed to player. */
  readonly id: ArchetypeId;
  /** Human-readable label for debug/inspector. */
  readonly label: string;
  /** One-line description of what this archetype represents. */
  readonly description: string;
  readonly side: 'OFFENSE' | 'DEFENSE' | 'SPECIAL_TEAMS';
  /** Position group this archetype belongs to. */
  readonly positionGroup: PositionGroup;
  /** Specific positions this archetype is valid for. */
  readonly positions: readonly Position[];
  /**
   * Multipliers per offensive scheme. For OFFENSE-side archetypes only.
   * Unspecified schemes default to 1.0.
   */
  readonly offensiveSchemeFit?: Partial<Record<OffensiveSchemeArchetype, number>>;
  /**
   * Multipliers per defensive scheme. For DEFENSE-side archetypes only.
   * Unspecified schemes default to 1.0.
   */
  readonly defensiveSchemeFit?: Partial<Record<DefensiveSchemeArchetype, number>>;
  /**
   * Relative importance of each skill for this archetype. Used by
   * player generation to bias skill rolls — high-weighted skills are
   * rolled higher on average for archetype-matched players.
   *
   * Default weight for unspecified skills is 1.0. Range typically
   * [0.4, 1.6] in practice.
   */
  readonly skillWeights: Partial<Record<keyof PlayerSkills, number>>;
}

