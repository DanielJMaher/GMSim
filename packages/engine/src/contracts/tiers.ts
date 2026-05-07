import type { TalentTier } from '../players/skills.js';
import type { PlayerSkills } from '../types/player.js';
import { getArchetypeById } from '../archetypes/index.js';
import type { ArchetypeId } from '../types/player.js';

/**
 * Salary tier templates. Each tier defines the contract shape — length,
 * signing-bonus magnitude, average annual cap hit — for players at that
 * tier. Veteran-minimum and rookie-scale-ish numbers are loose
 * approximations; they're tunable without breaking the engine.
 *
 * Cap-hit averages roughly produce ~$230M total per team across a
 * 53-man roster ($240M cap room with comfortable margin under a $255M
 * cap), matching realistic NFL roster spending in mid-offseason.
 */

export interface TierTemplate {
  /** Inclusive contract length range, in league-years. */
  yearsRange: [number, number];
  /** Total signing-bonus dollar range. */
  signingBonusRange: [number, number];
  /** Average per-year base salary range. Per-year noise is layered on top. */
  baseSalaryPerYearRange: [number, number];
  /** Probability of having a no-trade clause. */
  noTradeClauseProb: number;
}

/**
 * Salary numbers tuned so the average team cap usage at league
 * creation falls in the $220M–$260M range under a $255M cap — a few
 * teams over, most slightly under, mirroring real-world spring NFL
 * cap distributions.
 */
export const TIER_TEMPLATES: Record<TalentTier, TierTemplate> = {
  STAR: {
    yearsRange: [4, 4],
    signingBonusRange: [18_000_000, 38_000_000],
    baseSalaryPerYearRange: [8_000_000, 14_000_000],
    noTradeClauseProb: 0.5,
  },
  STARTER: {
    yearsRange: [3, 4],
    signingBonusRange: [3_000_000, 9_000_000],
    baseSalaryPerYearRange: [3_000_000, 6_500_000],
    noTradeClauseProb: 0.05,
  },
  BACKUP: {
    yearsRange: [2, 3],
    signingBonusRange: [200_000, 1_000_000],
    baseSalaryPerYearRange: [1_000_000, 2_000_000],
    noTradeClauseProb: 0.0,
  },
  FRINGE: {
    yearsRange: [1, 2],
    signingBonusRange: [0, 100_000],
    baseSalaryPerYearRange: [900_000, 1_200_000],
    noTradeClauseProb: 0.0,
  },
};

/**
 * Derive a talent tier from a player's actual skill profile. We use
 * the average of skills the player's archetype emphasizes (skillWeight ≥ 1.2)
 * as a one-number summary. Falls back to a neutral set of skills if
 * the archetype is unknown.
 *
 * Thresholds calibrated against the player generator's tier-based
 * ceiling means (STAR=90, STARTER=78, BACKUP=66, FRINGE=54) so the
 * derived tier mostly matches the original tier the generator rolled
 * — but stays a single source of truth at the *current ratings* so
 * a developing player whose skills have grown can rise out of FRINGE.
 */
export function deriveTier(skills: PlayerSkills, archetypeId: ArchetypeId): TalentTier {
  const archetype = getArchetypeById(archetypeId);
  const keys = archetype
    ? (Object.entries(archetype.skillWeights)
        .filter(([, w]) => (w ?? 1) >= 1.2)
        .map(([k]) => k as keyof PlayerSkills))
    : (['technicalSkill', 'footballIq', 'speed'] as (keyof PlayerSkills)[]);
  if (keys.length === 0) return 'BACKUP';
  const avg = keys.reduce((s, k) => s + skills[k], 0) / keys.length;
  if (avg >= 80) return 'STAR';
  if (avg >= 70) return 'STARTER';
  if (avg >= 60) return 'BACKUP';
  return 'FRINGE';
}
