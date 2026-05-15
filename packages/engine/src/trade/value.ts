import type { LeagueState } from '../types/league.js';
import type { Player, TalentTier } from '../types/player.js';
import type { TeamState } from '../types/team.js';
import type { Position } from '../types/enums.js';
import { CompetitiveWindow } from '../types/enums.js';
import { schemeFitForPlayer } from '../scheme/fit.js';
import { currentCapHit } from '../contracts/cap.js';
import { ageOfPlayer } from '../season/development.js';

/**
 * Doc 14 five-factor trade-value evaluator.
 *
 * Each player has a perceived value (in $M of cap-equivalent dollars)
 * from a specific evaluating team's perspective. Different teams value
 * the same player differently — a perfect scheme fit on a contender
 * is worth more than a scheme misfit on a rebuilder. The five factors
 * compose multiplicatively over a tier × position base:
 *
 *   value = tierBase
 *         × positionalMultiplier
 *         × abilityMultiplier
 *         × schemeFitMultiplier
 *         × ageContractMultiplier
 *         × timingMultiplier
 *
 * Per Doc 14:
 *   1. Player ability & performance
 *   2. Scheme fit differential
 *   3. Age & contract status
 *   4. Positional value hierarchy
 *   5. Timing & market dynamics (competitive window alignment)
 *
 * Two factors not yet implemented for lack of underlying data:
 *   - Scout-report consensus (Phase 4, Doc 4 / Doc 18)
 *   - Pro-Bowl recognition (we have MVP/OPOY/DPOY/COY but no Pro Bowl)
 * These slots will be added as those features land — the breakdown
 * surface stays stable.
 */

/** Top-level result: $M total value + per-factor rationale. */
export interface PlayerValueBreakdown {
  /** Total perceived value in $M. */
  total: number;
  /** Final dollar value after all multipliers applied to the tier base. */
  totalDollars: number;
  factors: {
    ability: ValueFactor;
    schemeFit: ValueFactor;
    ageContract: ValueFactor;
    positional: ValueFactor;
    timing: ValueFactor;
  };
}

/**
 * One factor's contribution. `multiplier` is the multiplicative weight
 * applied to the running total; `rationale` is a short human-readable
 * explanation surfaced by the inspector.
 */
export interface ValueFactor {
  multiplier: number;
  rationale: string;
}

/** Bundle of per-player valuations for an entire trade package. */
export interface TradePackageEvaluation {
  /** Per-player breakdowns for assets coming TO the evaluating team. */
  received: readonly { playerId: string; breakdown: PlayerValueBreakdown }[];
  /** Per-player breakdowns for assets going FROM the evaluating team. */
  given: readonly { playerId: string; breakdown: PlayerValueBreakdown }[];
  /** Sum of received `total` minus sum of given `total`. Positive = good deal. */
  netValue: number;
}

/**
 * Tier base value in $M. Anchors the entire model; each factor
 * multiplies around this baseline. STARs anchor around top-of-market
 * veteran cap hits, FRINGE anchors near league minimum.
 */
const TIER_BASE_MILLIONS: Record<TalentTier, number> = {
  STAR: 28,
  STARTER: 10,
  BACKUP: 3,
  FRINGE: 0.9,
};

/**
 * Positional value multiplier — Doc 14 positional hierarchy. Elite
 * tier positions command large premiums; specialists discount.
 */
const POSITIONAL_MULTIPLIER: Record<Position, number> = {
  QB: 2.0,
  EDGE: 1.6,
  LT: 1.4,
  CB: 1.3,
  WR: 1.3,
  S: 1.1,
  RT: 1.1,
  C: 1.0,
  DT: 1.0,
  ILB: 1.0,
  OLB: 1.0,
  LG: 0.95,
  RG: 0.95,
  RB: 0.9,
  TE: 0.9,
  NICKEL: 0.95,
  NT: 0.85,
  FB: 0.55,
  K: 0.6,
  P: 0.55,
  LS: 0.4,
};

/** Expected average skill summary at each tier (0..100), for ability deltas. */
const TIER_SKILL_BASELINE: Record<TalentTier, number> = {
  STAR: 80,
  STARTER: 70,
  BACKUP: 60,
  FRINGE: 50,
};

/**
 * Compute one team's perceived value of a single player. Pure compute
 * over league state; no PRNG. Used by both the NPC trade-request
 * matcher and the proactive-trades pass to gate trade firing.
 */
export function evaluatePlayerValue(
  team: TeamState,
  player: Player,
  league: LeagueState,
): PlayerValueBreakdown {
  const tierBase = TIER_BASE_MILLIONS[player.tier];
  const positional = positionalFactor(player.position);
  const ability = abilityFactor(player);
  const schemeFit = schemeFitFactor(team, player, league);
  const ageContract = ageContractFactor(player, league);
  const timing = timingFactor(team, player);

  const combined =
    ability.multiplier *
    schemeFit.multiplier *
    ageContract.multiplier *
    positional.multiplier *
    timing.multiplier;
  const total = tierBase * combined;

  return {
    total,
    totalDollars: total * 1_000_000,
    factors: { ability, schemeFit, ageContract, positional, timing },
  };
}

/**
 * Evaluate a full trade package from one team's perspective. Returns
 * per-asset breakdowns plus the netValue — positive means the team
 * perceives a gain. A trade is mutually acceptable when both teams'
 * `netValue` are positive.
 */
export function evaluateTradePackage(
  team: TeamState,
  incoming: readonly Player[],
  outgoing: readonly Player[],
  league: LeagueState,
): TradePackageEvaluation {
  const received = incoming.map((p) => ({
    playerId: p.id as string,
    breakdown: evaluatePlayerValue(team, p, league),
  }));
  const given = outgoing.map((p) => ({
    playerId: p.id as string,
    breakdown: evaluatePlayerValue(team, p, league),
  }));
  const receivedTotal = received.reduce((s, r) => s + r.breakdown.total, 0);
  const givenTotal = given.reduce((s, g) => s + g.breakdown.total, 0);
  return { received, given, netValue: receivedTotal - givenTotal };
}

// ─── per-factor implementations ────────────────────────────────────────

function positionalFactor(position: Position): ValueFactor {
  const m = POSITIONAL_MULTIPLIER[position] ?? 1.0;
  return {
    multiplier: m,
    rationale: `${position} positional weight ×${m.toFixed(2)}`,
  };
}

/**
 * Ability factor — skill-vs-tier-baseline + career-award bumps.
 * STAR who's actually a top-of-tier performer (skills well above STAR
 * baseline) gets a premium; STAR who's borderline gets a slight
 * discount. Career MVPs / OPOY / DPOY add a small bonus each.
 */
function abilityFactor(player: Player): ValueFactor {
  const s = player.current;
  const skillSummary =
    (s.technicalSkill + s.footballIq + s.speed + s.strength + s.decisionMaking) /
    5;
  const baseline = TIER_SKILL_BASELINE[player.tier];
  // Scale: every 10 skill points above/below tier baseline → 10% adjustment.
  const skillDelta = (skillSummary - baseline) / 100;
  const skillMultiplier = clamp(1.0 + skillDelta, 0.75, 1.25);

  // Career awards: +5% per major-award win, capped at +25%.
  const awardCount = (player.careerAwards ?? []).filter((a) =>
    ['MVP', 'OPOY', 'DPOY', 'OROY', 'DROY'].includes(a.kind),
  ).length;
  const awardBonus = Math.min(0.25, awardCount * 0.05);

  const multiplier = skillMultiplier * (1 + awardBonus);
  const parts: string[] = [
    `skills ${skillSummary.toFixed(0)} vs ${player.tier} baseline ${baseline} ×${skillMultiplier.toFixed(2)}`,
  ];
  if (awardCount > 0) parts.push(`${awardCount} major award(s) +${(awardBonus * 100).toFixed(0)}%`);
  return { multiplier, rationale: parts.join(', ') };
}

/**
 * Scheme fit factor — pulls directly from `schemeFitForPlayer`, which
 * returns roughly 0.5-1.7 by archetype × scheme. Mapped to a [0.7,
 * 1.4] multiplier so even a poor fit retains value (a STAR is still a
 * STAR) and a perfect fit is a clear premium but not absurd.
 */
function schemeFitFactor(
  team: TeamState,
  player: Player,
  league: LeagueState,
): ValueFactor {
  const hc = league.coaches[team.headCoachId];
  if (!hc) {
    return { multiplier: 1.0, rationale: 'no HC — neutral scheme fit' };
  }
  const fit = schemeFitForPlayer(player, {
    offensiveScheme: hc.offensiveScheme,
    defensiveScheme: hc.defensiveScheme,
  });
  const multiplier = clamp(0.7 + (fit - 0.5) * 0.583, 0.7, 1.4);
  let label = 'neutral fit';
  if (fit >= 1.3) label = 'perfect fit';
  else if (fit >= 1.1) label = 'good fit';
  else if (fit < 0.85) label = 'poor fit';
  return {
    multiplier,
    rationale: `${label} (raw ${fit.toFixed(2)}) ×${multiplier.toFixed(2)}`,
  };
}

/**
 * Age + contract factor. Combines age-curve adjustment with contract-
 * structure adjustment: rookie deals add surplus value, soon-to-expire
 * contracts discount as rentals, expensive deals discount as cost.
 */
function ageContractFactor(player: Player, league: LeagueState): ValueFactor {
  const age = ageOfPlayer(player, league.seasonNumber);
  let ageMult: number;
  let ageLabel: string;
  if (age <= 22) {
    ageMult = 1.1;
    ageLabel = `age ${age} (rookie upside)`;
  } else if (age <= 24) {
    ageMult = 1.05;
    ageLabel = `age ${age} (developing)`;
  } else if (age <= 29) {
    ageMult = 1.0;
    ageLabel = `age ${age} (prime)`;
  } else if (age <= 32) {
    ageMult = 0.9;
    ageLabel = `age ${age} (declining)`;
  } else if (age <= 35) {
    ageMult = 0.75;
    ageLabel = `age ${age} (veteran)`;
  } else {
    ageMult = 0.55;
    ageLabel = `age ${age} (aging)`;
  }

  let contractMult = 1.0;
  let contractLabel = 'no contract';
  if (player.contractId) {
    const contract = league.contracts[player.contractId];
    if (contract) {
      const yrs = contract.yearsRemaining;
      if (yrs <= 1) {
        contractMult = 0.9;
        contractLabel = `${yrs}-yr rental`;
      } else if (yrs === 2) {
        contractMult = 1.0;
        contractLabel = '2-yr deal';
      } else {
        contractMult = 1.05;
        contractLabel = `${yrs}-yr cost certainty`;
      }
      // Expensive-contract discount: every $5M of Y1 cap hit above
      // tier-typical drops value 5%, floor at -25%.
      const y1Hit = currentCapHit(contract);
      const expectedHit = expectedY1HitFor(player.tier);
      if (y1Hit > expectedHit) {
        const over = (y1Hit - expectedHit) / 5_000_000;
        const penalty = Math.min(0.25, over * 0.05);
        contractMult *= 1 - penalty;
        if (penalty > 0.01) {
          contractLabel += ` (−${(penalty * 100).toFixed(0)}% expensive)`;
        }
      }
    }
  }

  const multiplier = ageMult * contractMult;
  return {
    multiplier,
    rationale: `${ageLabel} ×${ageMult.toFixed(2)} · ${contractLabel} ×${contractMult.toFixed(2)}`,
  };
}

const EXPECTED_Y1_HIT_BY_TIER: Record<TalentTier, number> = {
  STAR: 12_000_000,
  STARTER: 5_000_000,
  BACKUP: 1_500_000,
  FRINGE: 900_000,
};

function expectedY1HitFor(tier: TalentTier): number {
  return EXPECTED_Y1_HIT_BY_TIER[tier];
}

/**
 * Timing / market-dynamics factor — buyer's competitive window × player
 * tier × age. Contenders pay premiums for proven veterans (win-now);
 * rebuilders pay premiums for young STARs/STARTERs and discount old
 * vets they don't fit into the rebuild.
 */
function timingFactor(team: TeamState, player: Player): ValueFactor {
  const win = team.competitiveWindow;
  const isYoung = player.tier !== 'FRINGE' && estimateYoung(player);
  const isVeteran = estimateVeteran(player);

  let multiplier = 1.0;
  let label = `${win} window`;

  if (win === CompetitiveWindow.CHAMPIONSHIP || win === CompetitiveWindow.CONTENDER) {
    if (player.tier === 'STAR') {
      multiplier = 1.15;
      label = `${win} win-now premium`;
    } else if (player.tier === 'STARTER') {
      multiplier = 1.1;
      label = `${win} win-now premium`;
    }
  } else if (win === CompetitiveWindow.EMERGING) {
    if (player.tier === 'STAR' || player.tier === 'STARTER') {
      multiplier = 1.05;
      label = `${win} accelerator`;
    }
  } else if (win === CompetitiveWindow.REBUILDING) {
    if (isYoung && (player.tier === 'STAR' || player.tier === 'STARTER')) {
      multiplier = 1.15;
      label = `${win} young asset premium`;
    } else if (isVeteran && (player.tier === 'STAR' || player.tier === 'STARTER')) {
      multiplier = 0.8;
      label = `${win} veteran discount`;
    }
  } else if (win === CompetitiveWindow.STAGNANT || win === CompetitiveWindow.RETOOLING) {
    multiplier = 0.95;
    label = `${win} cautious posture`;
  }

  return {
    multiplier,
    rationale: `${label} ×${multiplier.toFixed(2)}`,
  };
}

function estimateYoung(player: Player): boolean {
  // Heuristic without recomputing age here: experienceYears proxies.
  return player.experienceYears <= 3;
}

function estimateVeteran(player: Player): boolean {
  return player.experienceYears >= 8;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
