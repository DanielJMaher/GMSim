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
 *
 * `dampen` pulls the raw market spread toward 1.0 (see `PREMIUM_DAMPEN`). The
 * seed generator uses the default low dampen because it assigns talent to teams
 * without cap-awareness; the free-agent auction is cap-gated (teams only bid
 * within real cap room, falling back to vet-min when no one can afford) so it
 * passes a higher `FA_PREMIUM_DAMPEN` for a steeper, more realistic spread.
 */
export function positionSalaryFactor(
  position: Position,
  tier: TalentTier,
  dampen: number = PREMIUM_DAMPEN,
): number {
  const raw = POSITION_SALARY_FACTOR[position] ?? 1.0;
  const damped = 1 + (raw - 1) * dampen;
  return 1 + (damped - 1) * TIER_PREMIUM_WEIGHT[tier];
}

/**
 * Seed-generation dampen. GMSim assigns talent to teams without cap-awareness,
 * so the full real spread (an 18%-of-cap QB) lets a team randomly stack premium
 * stars far past the cap, beyond what offseason compliance can unwind. Dampening
 * keeps a strong, realistic positional ordering while bounding the worst-case
 * team total to a compliable overage.
 */
const PREMIUM_DAMPEN = 0.5;

/**
 * Free-agency dampen — higher than the seed dampen because the auction is
 * cap-gated, so a steeper positional premium can't blow up team cap totals the
 * way un-cap-aware seed assignment can. Lifts the premium-position top-of-market
 * (a STAR QB FA) toward real OTC without breaking cap-compliance tests.
 */
export const FA_PREMIUM_DAMPEN = 0.85;

/**
 * Target guaranteed money as a fraction of total contract value for a
 * top-of-market (STAR) deal at each position — The Liquidator Slice 3.
 *
 * Real guaranteed % is steeply position-dependent (an elite QB locks in ~69% of
 * the deal; a RB ~25%, a long snapper ~10%), because guaranteed money is what
 * makes a player expensive to move — teams commit it to franchise cornerstones
 * and withhold it from commodity positions. GMSim's pre-Slice-3 generator scaled
 * signing bonus AND base by the same `positionSalaryFactor`, so the
 * guaranteed/value RATIO was position-invariant (flat ~55-60% everywhere). These
 * targets restore the spread.
 *
 * Numbers are the real value-weighted guaranteed % per OTC position bucket
 * (contracts signed 2021+), mapped onto GMSim positions. Re-derive with
 * `pnpm --filter @gmsim/truth-arbiter run liquidator gtd`.
 */
export const POSITION_GUARANTEE_AT_STAR: Record<Position, number> = {
  [Position.QB]: 0.69,
  [Position.EDGE]: 0.47,
  [Position.LT]: 0.46,
  [Position.WR]: 0.44,
  [Position.RT]: 0.43,
  [Position.DT]: 0.41,
  [Position.NT]: 0.41,
  [Position.CB]: 0.4,
  [Position.NICKEL]: 0.4,
  [Position.LG]: 0.39,
  [Position.C]: 0.38,
  [Position.S]: 0.36,
  [Position.OLB]: 0.36,
  [Position.ILB]: 0.36,
  [Position.TE]: 0.36,
  [Position.RG]: 0.34,
  [Position.FB]: 0.26,
  [Position.P]: 0.26,
  [Position.RB]: 0.25,
  [Position.K]: 0.25,
  [Position.LS]: 0.1,
};

/**
 * Per-tier guarantee-depth multiplier on `POSITION_GUARANTEE_AT_STAR`. The
 * position spread is a top-of-market phenomenon: fringe/vet-minimum deals carry
 * ~no guarantees regardless of position, while franchise deals lock in the full
 * positional share. STAR exceeds 1.0 because the targets are the *value-weighted*
 * real numbers (which already blend in cheaper lower-tier deals); the league's
 * value-weighted guaranteed % only lands on the real target if the franchise
 * deals that dominate the weighting sit above it. Calibrated against
 * `run liquidator gtd` so GMSim's value-weighted guaranteed % matches real.
 */
const TIER_GUARANTEE_WEIGHT: Record<TalentTier, number> = {
  STAR: 1.25,
  STARTER: 0.95,
  BACKUP: 0.5,
  FRINGE: 0.0,
};

/**
 * Target guaranteed fraction of total value for a player at `position`+`tier`.
 * The seed contract generator builds the signing-bonus / guaranteed-base split
 * to hit this, keeping total value (APY) fixed so the cap calibration from the
 * position SALARY factor is untouched — only the guaranteed share (and hence
 * dead money on a trade/release) moves. Clamped to ≤0.95 so a contract never
 * needs more guaranteed money than it has value.
 */
export function positionGuaranteeTarget(position: Position, tier: TalentTier): number {
  const star = POSITION_GUARANTEE_AT_STAR[position] ?? 0.4;
  return Math.min(0.95, star * TIER_GUARANTEE_WEIGHT[tier]);
}

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
