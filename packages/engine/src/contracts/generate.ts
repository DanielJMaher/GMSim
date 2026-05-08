import { ContractId } from '../types/ids.js';
import type { Contract, ContractGuarantee } from '../types/contract.js';
import type { Player } from '../types/player.js';
import type { Prng } from '../prng/index.js';
import { TIER_TEMPLATES } from './tiers.js';
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

  const realYears = prng.nextRange(template.yearsRange[0], template.yearsRange[1] + 1);
  const yearsRemaining = options.fresh ? realYears : prng.nextRange(1, realYears + 1);
  const yearsElapsed = realYears - yearsRemaining;
  const signedOnTick = options.currentTick - yearsElapsed * WEEKS_PER_LEAGUE_YEAR;

  const signingBonus = roundMoney(
    prng.nextRange(template.signingBonusRange[0], template.signingBonusRange[1] + 1),
  );

  const baseSalaries: number[] = [];
  for (let i = 0; i < realYears; i++) {
    const base = roundMoney(
      prng.nextRange(template.baseSalaryPerYearRange[0], template.baseSalaryPerYearRange[1] + 1),
    );
    baseSalaries.push(base);
  }

  const guarantees: ContractGuarantee[] = [];
  for (let i = 0; i < realYears; i++) {
    // Guarantee taper: years 1-2 typically guaranteed, later years
    // less so. Stars get more guarantee depth than fringe.
    const taper = guaranteeTaperFor(tier, i, realYears);
    guarantees.push({
      baseGuaranteedPct: taper.pct,
      type: taper.type,
    });
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
 * Round to the nearest $1k. NFL contract reporting is to the dollar
 * but engine logic gets cleaner with thousands and the precision
 * difference doesn't matter.
 */
function roundMoney(value: number): number {
  return Math.round(value / 1000) * 1000;
}

function guaranteeTaperFor(
  tier: 'STAR' | 'STARTER' | 'BACKUP' | 'FRINGE',
  yearIndex: number,
  totalYears: number,
): { pct: number; type: ContractGuarantee['type'] } {
  // Year 0/1 of any deal: high guarantee. Later years: declining.
  const yearOfDeal = yearIndex + 1; // 1-indexed for human reasoning
  if (tier === 'STAR') {
    if (yearOfDeal <= 2) return { pct: 100, type: 'FULLY_GUARANTEED' };
    if (yearOfDeal === totalYears) return { pct: 0, type: 'NONE' };
    return { pct: 50, type: 'INJURY_ONLY' };
  }
  if (tier === 'STARTER') {
    if (yearOfDeal === 1) return { pct: 100, type: 'FULLY_GUARANTEED' };
    if (yearOfDeal === 2) return { pct: 50, type: 'INJURY_ONLY' };
    return { pct: 0, type: 'NONE' };
  }
  if (tier === 'BACKUP') {
    if (yearOfDeal === 1) return { pct: 50, type: 'INJURY_ONLY' };
    return { pct: 0, type: 'NONE' };
  }
  return { pct: 0, type: 'NONE' }; // fringe — vet minimum, no guarantees
}
