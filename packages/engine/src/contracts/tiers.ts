import type { TalentTier } from '../players/skills.js';
import type { PlayerSkills } from '../types/player.js';
import { getArchetypeById } from '../archetypes/index.js';
import type { ArchetypeId } from '../types/player.js';
import { Position } from '../types/enums.js';

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
 * Per-position salary multiplier on the (position-agnostic) tier template.
 *
 * The NFL cap is wildly position-dependent: a top QB eats ~17-18% of the cap, a
 * top RB ~4%, a long snapper <1%. The tier templates above produce a STAR deal
 * at ~7% of cap regardless of position; these factors scale that to each
 * position's real top-of-market.
 *
 * Derived by The Liquidator from real OverTheCap data (contracts signed 2021+,
 * mean of the top-10 APY-as-%-of-cap per position): factor = realElite% ÷ 7.06,
 * where 7.06% is the STAR template's position-agnostic APY. Re-run
 * `pnpm --filter @gmsim/truth-arbiter run liquidator` to recheck against the
 * market.
 */
export const POSITION_SALARY_FACTOR: Record<Position, number> = {
  [Position.QB]: 2.5,
  [Position.WR]: 1.57,
  [Position.EDGE]: 1.37,
  [Position.LT]: 1.26,
  [Position.CB]: 1.17,
  [Position.NICKEL]: 1.17,
  [Position.DT]: 1.06,
  [Position.NT]: 1.06,
  [Position.S]: 0.99,
  [Position.OLB]: 0.97,
  [Position.ILB]: 0.97,
  [Position.RT]: 0.93,
  [Position.TE]: 0.86,
  [Position.RG]: 0.76,
  [Position.C]: 0.74,
  [Position.LG]: 0.67,
  [Position.RB]: 0.54,
  [Position.K]: 0.27,
  [Position.P]: 0.2,
  [Position.FB]: 0.17,
  [Position.LS]: 0.1,
};

/**
 * How strongly the positional premium applies at each tier. The premium is a
 * top-of-market phenomenon — minimum-salary deals are position-agnostic in the
 * real NFL (the CBA minimum is the same for a fringe QB and a fringe LS) — so
 * the factor is blended toward 1.0 as tier falls.
 */
const TIER_PREMIUM_WEIGHT: Record<TalentTier, number> = {
  STAR: 1.0,
  STARTER: 0.65,
  BACKUP: 0.3,
  FRINGE: 0.1,
};

/**
 * Effective salary multiplier for a player at `position` and `tier`: the
 * position's market factor, blended toward 1.0 by tier so stars get the full
 * positional premium while fringe deals stay near the (position-agnostic)
 * minimum.
 */
export function positionSalaryFactor(position: Position, tier: TalentTier): number {
  const raw = POSITION_SALARY_FACTOR[position] ?? 1.0;
  // Dampen the raw market spread toward 1.0. GMSim assigns talent to teams
  // without cap-awareness, so the full real spread (an 18%-of-cap QB) lets a
  // team randomly stack premium stars far past the cap, beyond what offseason
  // compliance can unwind. Dampening keeps a strong, realistic positional
  // ordering while bounding the worst-case team total to a compliable overage.
  const damped = 1 + (raw - 1) * PREMIUM_DAMPEN;
  return 1 + (damped - 1) * TIER_PREMIUM_WEIGHT[tier];
}

const PREMIUM_DAMPEN = 0.5;

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
