import { ContractId } from '../types/ids.js';
import type { Contract, ContractGuarantee } from '../types/contract.js';
import type { Player } from '../types/player.js';
import type { Prng } from '../prng/index.js';
import { TIER_TEMPLATES, positionSalaryFactor, positionGuaranteeTarget } from './tiers.js';
import { WEEKS_PER_LEAGUE_YEAR } from './constants.js';

export interface GenerateContractOptions {
  player: Player;
  /** Stable suffix for the contract ID. Typically the player's id. */
  idSuffix: string;
  /** Current league tick. Used to set yearsRemaining + signedOnTick consistently. */
  currentTick: number;
  /**
   * If true, the contract is brand new — yearsRemaining = realYears
   * and signedOnTick = currentTick. Used by retirement replacement
   * for incoming rookies. Default (false) rolls yearsRemaining
   * uniformly in [1, realYears] so league-creation contracts look
   * mid-stream.
   */
  fresh?: boolean;
}

/**
 * Generate a contract for a player based on their derived tier (current
 * skills). The output models a contract already in progress — `yearsRemaining`
 * is rolled in `[1, realYears]` so the league-creation league has
 * realistic mid-deal contracts across all years.
 *
 * Phase 1 simplifications:
 *   - No void years (those land with the restructure mechanic)
 *   - No incentives / rolling guarantees (specifically supported by
 *     the type system but not exercised by generation yet)
 *   - No roster or workout bonuses (zero arrays)
 */
export function generateContract(prng: Prng, options: GenerateContractOptions): Contract {
  // Use the player's stored tier rather than re-deriving from current
  // skills. Generation-time tier is the source of truth at league-creation;
  // re-derivation can drift if skill rolls happen to land near a boundary.
  const tier = options.player.tier;
  const template = TIER_TEMPLATES[tier];
  // Scale the position-agnostic tier template to the player's position so the
  // cap structure matches the real NFL (a STAR QB ≫ a STAR RB). Derived from
  // real OverTheCap top-of-market by The Liquidator.
  const posFactor = positionSalaryFactor(options.player.position, tier);

  const realYears = prng.nextRange(template.yearsRange[0], template.yearsRange[1] + 1);
  const yearsRemaining = options.fresh ? realYears : prng.nextRange(1, realYears + 1);
  const yearsElapsed = realYears - yearsRemaining;
  const signedOnTick = options.currentTick - yearsElapsed * WEEKS_PER_LEAGUE_YEAR;

  // Roll the position-scaled bonus + base as before — their SUM is the total
  // contract value, which drives APY (and thus the cap structure the position
  // SALARY factor calibrates). We keep that total fixed and only re-split it
  // between signing bonus and base below, so the guaranteed-money fix never
  // disturbs the cap calibration.
  const rolledBonus = roundMoney(
    prng.nextRange(template.signingBonusRange[0], template.signingBonusRange[1] + 1) * posFactor,
  );
  const rolledBase: number[] = [];
  for (let i = 0; i < realYears; i++) {
    rolledBase.push(
      roundMoney(
        prng.nextRange(template.baseSalaryPerYearRange[0], template.baseSalaryPerYearRange[1] + 1) *
          posFactor,
      ),
    );
  }
  const totalValue = rolledBonus + rolledBase.reduce((s, v) => s + v, 0);

  // The Liquidator Slice 3: split `totalValue` to hit a position+tier guaranteed
  // target. Guaranteed money = signing bonus (fully guaranteed) + guaranteed
  // base. We make the signing bonus a fixed share of the guaranteed dollars and
  // fully-guarantee leading base years for the rest — so a premium-position
  // STAR locks in a big bonus (expensive to trade), a commodity-position deal
  // stays mostly non-guaranteed (cheap to move), and total value is unchanged.
  const guaranteedTarget = positionGuaranteeTarget(options.player.position, tier);
  const guaranteedDollars = guaranteedTarget * totalValue;
  const signingBonus = roundMoney(BONUS_SHARE_OF_GUARANTEE * guaranteedDollars);

  // Redistribute the remaining value across base years, preserving the rolled
  // per-year shape (ramp/noise). Falls back to an even split if the roll summed
  // to zero (only possible for a degenerate template).
  const baseTotal = Math.max(0, totalValue - signingBonus);
  const rolledBaseSum = rolledBase.reduce((s, v) => s + v, 0);
  const baseSalaries: number[] = rolledBase.map((b) =>
    roundMoney(rolledBaseSum > 0 ? (baseTotal * b) / rolledBaseSum : baseTotal / realYears),
  );

  // Front-load guarantees: fully guarantee leading base years until the
  // guaranteed-base budget is spent, partially guarantee the boundary year.
  let guaranteedBaseRemaining = Math.max(0, guaranteedDollars - signingBonus);
  const guarantees: ContractGuarantee[] = [];
  for (let i = 0; i < realYears; i++) {
    const yearBase = baseSalaries[i] ?? 0;
    if (yearBase <= 0 || guaranteedBaseRemaining <= 0) {
      guarantees.push({ baseGuaranteedPct: 0, type: 'NONE' });
      continue;
    }
    if (guaranteedBaseRemaining >= yearBase) {
      guarantees.push({ baseGuaranteedPct: 100, type: 'FULLY_GUARANTEED' });
      guaranteedBaseRemaining -= yearBase;
    } else {
      const pct = Math.round((guaranteedBaseRemaining / yearBase) * 100);
      guarantees.push({ baseGuaranteedPct: pct, type: 'INJURY_ONLY' });
      guaranteedBaseRemaining = 0;
    }
  }

  const noTradeClause = prng.next() < template.noTradeClauseProb;

  return {
    id: ContractId(`C_${options.idSuffix}`),
    playerId: options.player.id,
    teamId: options.player.teamId!, // caller must have assigned a team
    signedOnTick,
    realYears,
    voidYears: 0,
    yearsRemaining,
    baseSalaries,
    signingBonus,
    rosterBonuses: new Array(realYears).fill(0),
    workoutBonuses: new Array(realYears).fill(0),
    guarantees,
    incentives: [],
    noTradeClause,
  };
}

/**
 * Share of a contract's guaranteed money that comes as signing bonus (the rest
 * is fully-guaranteed base salary). Real deals run ~50-70% bonus; 0.6 keeps a
 * realistic mix where the bonus is the dominant guaranteed component — and it's
 * the bonus proration that accelerates into dead money on a trade/release, so a
 * higher-guarantee (premium) position is also harder to move.
 */
const BONUS_SHARE_OF_GUARANTEE = 0.6;

/**
 * Round to the nearest $1k. NFL contract reporting is to the dollar
 * but engine logic gets cleaner with thousands and the precision
 * difference doesn't matter.
 */
function roundMoney(value: number): number {
  return Math.round(value / 1000) * 1000;
}
