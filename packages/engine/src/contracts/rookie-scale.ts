import { ContractId } from '../types/ids.js';
import type { Contract, ContractGuarantee } from '../types/contract.js';
import type { Player } from '../types/player.js';
import { LEAGUE_MINIMUM_SALARY } from './constants.js';

/**
 * NFL rookie-scale contracts. Per the CBA, drafted players sign 4-year
 * deals (5-year team option for round 1) at predetermined slot values
 * — much cheaper than the veteran-tier contracts the rest of
 * `generate.ts` produces. This module is a rough approximation: total
 * money + signing bonus scale by overall pick, every contract is a
 * fixed 4 years with simple guarantee structure.
 *
 * A future slice can layer in the full per-slot CBA table + the
 * round-1 fifth-year option mechanic.
 */

const ROOKIE_YEARS = 4;

/**
 * Total contract value (signing bonus + 4 years of base salary) by
 * overall pick number. Loosely tracks the real NFL rookie scale:
 *
 *   Pick #1   ~$40M / 4yr
 *   Pick #32  ~$13M / 4yr (end of round 1)
 *   Pick #64  ~$7M / 4yr  (end of round 2)
 *   Pick #100 ~$5M / 4yr  (round 3)
 *   Pick #150 ~$4.2M / 4yr (round 4)
 *   Pick #200 ~$4M / 4yr   (round 5–6)
 *   Pick #224 ~$3.9M / 4yr (round 7)
 *
 * Floor at LEAGUE_MINIMUM_SALARY × 4 ($3.6M) so no rookie deal goes
 * below the league-minimum total.
 */
function totalValueForPick(overallPick: number): number {
  // Exponential decay shaped to hit the rough anchors above.
  // value(pick) = 4_000_000 + 36_000_000 * exp(-(pick - 1) / 25)
  const base = 4_000_000;
  const top = 36_000_000;
  const decay = Math.exp(-(overallPick - 1) / 25);
  const value = base + top * decay;
  const floor = LEAGUE_MINIMUM_SALARY * ROOKIE_YEARS;
  return Math.max(floor, Math.round(value / 1000) * 1000);
}

/**
 * Signing-bonus share of total value by overall pick. Top picks get
 * a larger signing bonus (longer proration window matters more for
 * cap mechanics), late picks get a smaller / nominal bonus.
 *
 *   Pick #1   ~60% of total = ~$24M bonus
 *   Pick #32  ~40% = ~$5M
 *   Pick #200+ ~10% = ~$400K
 */
function signingBonusShareForPick(overallPick: number): number {
  if (overallPick === 1) return 0.60;
  if (overallPick <= 10) return 0.55;
  if (overallPick <= 32) return 0.40;
  if (overallPick <= 64) return 0.30;
  if (overallPick <= 100) return 0.20;
  return 0.10;
}

export interface GenerateRookieContractOptions {
  player: Player;
  /** Stable suffix for the contract ID. Typically the player's id. */
  idSuffix: string;
  /** Sim tick the contract signs on. */
  currentTick: number;
  /** Overall draft pick (1..224). Drives the scale. */
  overallPick: number;
}

/**
 * Produce a rookie-scale contract for a drafted prospect. The deal
 * is a 4-year, fully fresh contract (`yearsRemaining === realYears`)
 * — drafted players come straight onto the roster.
 *
 * Guarantee shape: years 1–2 fully guaranteed (per real NFL — every
 * rookie deal guarantees year 1 base + signing bonus, and top picks
 * get year 2 fully guaranteed too). Years 3–4 partially guaranteed
 * for high picks, unguaranteed for late picks.
 */
export function generateRookieContract(options: GenerateRookieContractOptions): Contract {
  const { player, idSuffix, currentTick, overallPick } = options;
  const total = totalValueForPick(overallPick);
  const bonusShare = signingBonusShareForPick(overallPick);
  const signingBonus = roundMoney(total * bonusShare);
  const baseTotal = total - signingBonus;
  const baseSalaries: number[] = [];
  // Slight ramp — year-1 base ~85% of average, year-4 base ~115% of
  // average. Total still sums to baseTotal.
  const avgBase = baseTotal / ROOKIE_YEARS;
  const ramp = [0.85, 0.95, 1.05, 1.15];
  for (let i = 0; i < ROOKIE_YEARS; i++) {
    baseSalaries.push(Math.max(LEAGUE_MINIMUM_SALARY, roundMoney(avgBase * ramp[i]!)));
  }

  const guarantees: ContractGuarantee[] = [];
  for (let i = 0; i < ROOKIE_YEARS; i++) {
    if (i === 0) {
      guarantees.push({ baseGuaranteedPct: 100, type: 'FULLY_GUARANTEED' });
    } else if (i === 1) {
      // Year 2: fully guaranteed for top 32 picks, injury-only for rounds 2-3, none after
      if (overallPick <= 32) {
        guarantees.push({ baseGuaranteedPct: 100, type: 'FULLY_GUARANTEED' });
      } else if (overallPick <= 100) {
        guarantees.push({ baseGuaranteedPct: 100, type: 'INJURY_ONLY' });
      } else {
        guarantees.push({ baseGuaranteedPct: 0, type: 'NONE' });
      }
    } else if (i === 2) {
      // Year 3: partial guarantee for round-1 picks only
      guarantees.push({
        baseGuaranteedPct: overallPick <= 32 ? 50 : 0,
        type: overallPick <= 32 ? 'INJURY_ONLY' : 'NONE',
      });
    } else {
      guarantees.push({ baseGuaranteedPct: 0, type: 'NONE' });
    }
  }

  return {
    id: ContractId(`C_${idSuffix}`),
    playerId: player.id,
    teamId: player.teamId!,
    signedOnTick: currentTick,
    realYears: ROOKIE_YEARS,
    voidYears: 0,
    yearsRemaining: ROOKIE_YEARS,
    baseSalaries,
    signingBonus,
    rosterBonuses: new Array(ROOKIE_YEARS).fill(0),
    workoutBonuses: new Array(ROOKIE_YEARS).fill(0),
    guarantees,
    incentives: [],
    noTradeClause: false,
  };
}

function roundMoney(value: number): number {
  return Math.round(value / 1000) * 1000;
}

/**
 * Representative overall pick for the *middle* of each round in a
 * 32-team draft (round 1 → pick 16, round 2 → pick 48, …). Used to
 * estimate a round's typical rookie cap hit without knowing the exact
 * slot — good enough for the free-agency rookie-pool reserve.
 */
const ROUND_REPRESENTATIVE_PICK: Readonly<Record<number, number>> = {
  1: 16,
  2: 48,
  3: 80,
  4: 112,
  5: 144,
  6: 176,
  7: 208,
};

/**
 * Estimated Year-1 cap hit for a typical pick in `round` (base salary
 * year-1 + evenly-prorated signing bonus), computed from the same
 * rookie-scale formulas `generateRookieContract` uses so the two can't
 * drift. Feeds the free-agency rookie-pool reserve: at FA time a team
 * holds back roughly its incoming draft class's first-year cap so the
 * post-draft roster stays cap-compliant. Rounds outside 1..7 fall back
 * to the round-7 (cheapest) estimate.
 */
export function estimatedRookieYear1CapHit(round: number): number {
  const pick = ROUND_REPRESENTATIVE_PICK[round] ?? ROUND_REPRESENTATIVE_PICK[7]!;
  const total = totalValueForPick(pick);
  const signingBonus = roundMoney(total * signingBonusShareForPick(pick));
  const avgBase = (total - signingBonus) / ROOKIE_YEARS;
  // Year-1 base uses the 0.85 ramp factor from generateRookieContract.
  const baseYear1 = Math.max(LEAGUE_MINIMUM_SALARY, roundMoney(avgBase * 0.85));
  return baseYear1 + Math.round(signingBonus / ROOKIE_YEARS);
}
