import type { Position } from '../types/enums.js';
import type { Player } from '../types/player.js';
import type { LeagueState } from '../types/league.js';
import type { SkillCategory } from './skill-keys.js';
import { Prng } from '../prng/index.js';

/**
 * Per-position aging curves (Living Careers slice S2).
 *
 * Hand-derived from THE ACTUARY's real-NFL baselines
 * (`truth-arbiter/data/aging-baselines.json`, nflverse 2003-2024,
 * 29,212 player-seasons; regenerate with `run actuary`). The engine stays
 * pure: this is a reviewable data file, not a runtime fetch. The Actuary's
 * A2 probe (`run actuary sim`) re-measures the sim's YoY production change
 * by position x age and compares it to the real curves — these parameters
 * are calibrated against that gate, in production space, not eyeballed.
 *
 * Model summary (consumed by `season/development.ts`):
 *  - GROWTH tapers out around `growthEnd` (position peak, from real chained
 *    curves: RB 24, CB 23-24, WR/EDGE/LB 25, TE 24-26, IDL/QB 27, QB
 *    plateaus to 32).
 *  - DECLINE is per skill category with position-specific onsets:
 *    physical first and fastest, technique later and slower (the "lost a
 *    step but smarter" middle age is emergent), mental barely and very late.
 *    Rates ramp with years past onset.
 *  - CLIFF: each year at/past `cliffOnset`, a hazard roll; on hit the player
 *    takes a large one-year hit (real 33-34 cells run -20..-32%/yr; RBs and
 *    corners cliff much earlier). Rating loss is permanent by construction,
 *    so a cliff season starts a collapse, not a dip.
 *  - Every player carries a hidden DECLINE-RATE multiplier (derived
 *    deterministically from league seed + player id — no save-format
 *    change), nudged by durability: two same-age WRs age differently.
 *
 * Real-curve provenance per bucket is noted inline as
 * `peak / notable YoY cells / cliff` from the baselines.
 */

export type AgingBucket =
  | 'QB'
  | 'RB'
  | 'WR'
  | 'TE'
  | 'OL'
  | 'EDGE'
  | 'IDL'
  | 'LB'
  | 'CB'
  | 'S'
  | 'ST';

export interface PositionAgingCurve {
  bucket: AgingBucket;
  /** Real production peak age (documentation; growth tapers around it). */
  realPeakAge: number;
  /** Age where gap-to-ceiling growth has effectively ended. */
  growthEnd: number;
  /** Physical skills start declining at this age… */
  physicalDeclineOnset: number;
  /** …at this many rating points/yr (before ramp + per-player multiplier). */
  physicalDeclineRate: number;
  /** Technique (umbrella + granular) decline onset/rate — the post-peak erosion. */
  techniqueDeclineOnset: number;
  techniqueDeclineRate: number;
  /** Mental decline onset/rate — late and gentle (smart old players). */
  mentalDeclineOnset: number;
  mentalDeclineRate: number;
  /** Decline accelerates: rate × (1 + ramp × yearsPastOnset). */
  declineRamp: number;
  /** Cliff hazard: P(cliff this year) = base + perYear × yearsPastOnset (capped). */
  cliffOnset: number;
  cliffHazardBase: number;
  cliffHazardPerYear: number;
  /** Cliff magnitude in rating points (uniform draw), full hit on physical
   *  keys, 60% on technique keys. */
  cliffMagnitudeMin: number;
  cliffMagnitudeMax: number;
}

const CLIFF_HAZARD_CAP = 0.4;

export const AGING_CURVES: Record<AgingBucket, PositionAgingCurve> = {
  // peak 27, plateau 93+ through age 32, then -4.1/-7.8/-9.8%/yr; cliff late.
  QB: {
    bucket: 'QB',
    realPeakAge: 27,
    growthEnd: 30,
    physicalDeclineOnset: 30,
    physicalDeclineRate: 0.8,
    techniqueDeclineOnset: 33,
    techniqueDeclineRate: 0.6,
    mentalDeclineOnset: 36,
    mentalDeclineRate: 0.5,
    declineRamp: 0.2,
    cliffOnset: 34,
    cliffHazardBase: 0.1,
    cliffHazardPerYear: 0.06,
    cliffMagnitudeMin: 3,
    cliffMagnitudeMax: 7,
  },
  // peak 24; -8.9%/yr from 25, -15.5% at 28, ~55% of peak by 30, -24% at 33.
  RB: {
    bucket: 'RB',
    realPeakAge: 24,
    growthEnd: 24,
    physicalDeclineOnset: 25,
    physicalDeclineRate: 1.4,
    techniqueDeclineOnset: 27,
    techniqueDeclineRate: 0.7,
    mentalDeclineOnset: 35,
    mentalDeclineRate: 0.5,
    declineRamp: 0.32,
    cliffOnset: 28,
    cliffHazardBase: 0.08,
    cliffHazardPerYear: 0.08,
    cliffMagnitudeMin: 4,
    cliffMagnitudeMax: 9,
  },
  // peak 25; -9..-10.5%/yr at 26-27, 61% of peak by 30, -29.9% at 32.
  WR: {
    bucket: 'WR',
    realPeakAge: 25,
    growthEnd: 24,
    physicalDeclineOnset: 25,
    physicalDeclineRate: 1.8,
    techniqueDeclineOnset: 26,
    techniqueDeclineRate: 0.95,
    mentalDeclineOnset: 35,
    mentalDeclineRate: 0.5,
    declineRamp: 0.28,
    cliffOnset: 30,
    cliffHazardBase: 0.08,
    cliffHazardPerYear: 0.08,
    cliffMagnitudeMin: 4,
    cliffMagnitudeMax: 8,
  },
  // peak 24-26 plateau; -11.8% at 27, -17.1% at 30.
  TE: {
    bucket: 'TE',
    realPeakAge: 25,
    growthEnd: 25,
    physicalDeclineOnset: 25,
    physicalDeclineRate: 1.8,
    techniqueDeclineOnset: 27,
    techniqueDeclineRate: 0.9,
    mentalDeclineOnset: 35,
    mentalDeclineRate: 0.5,
    declineRamp: 0.28,
    cliffOnset: 30,
    cliffHazardBase: 0.07,
    cliffHazardPerYear: 0.08,
    cliffMagnitudeMin: 4,
    cliffMagnitudeMax: 8,
  },
  // no production stats — hand-set: long plateau, late peak, durable; snap
  // survival says OL careers run longer than skill positions.
  OL: {
    bucket: 'OL',
    realPeakAge: 27,
    growthEnd: 28,
    physicalDeclineOnset: 28,
    physicalDeclineRate: 0.8,
    techniqueDeclineOnset: 31,
    techniqueDeclineRate: 0.5,
    mentalDeclineOnset: 35,
    mentalDeclineRate: 0.5,
    declineRamp: 0.22,
    cliffOnset: 33,
    cliffHazardBase: 0.08,
    cliffHazardPerYear: 0.08,
    cliffMagnitudeMin: 3,
    cliffMagnitudeMax: 7,
  },
  // peak 25 but holds 95-97% through 28; -7..-9%/yr 29-33; -31.8% at 34.
  EDGE: {
    bucket: 'EDGE',
    realPeakAge: 25,
    growthEnd: 27,
    physicalDeclineOnset: 26,
    physicalDeclineRate: 0.9,
    techniqueDeclineOnset: 29,
    techniqueDeclineRate: 0.6,
    mentalDeclineOnset: 35,
    mentalDeclineRate: 0.5,
    declineRamp: 0.26,
    cliffOnset: 32,
    cliffHazardBase: 0.07,
    cliffHazardPerYear: 0.08,
    cliffMagnitudeMin: 4,
    cliffMagnitudeMax: 8,
  },
  // peak 27, lumpy plateau through 30, -27.9% at 34.
  IDL: {
    bucket: 'IDL',
    realPeakAge: 27,
    growthEnd: 28,
    physicalDeclineOnset: 28,
    physicalDeclineRate: 0.9,
    techniqueDeclineOnset: 30,
    techniqueDeclineRate: 0.5,
    mentalDeclineOnset: 35,
    mentalDeclineRate: 0.5,
    declineRamp: 0.26,
    cliffOnset: 33,
    cliffHazardBase: 0.08,
    cliffHazardPerYear: 0.08,
    cliffMagnitudeMin: 4,
    cliffMagnitudeMax: 8,
  },
  // peak 25; -7.6..-9.6%/yr 26-28; -32% at 34.
  LB: {
    bucket: 'LB',
    realPeakAge: 25,
    growthEnd: 25,
    physicalDeclineOnset: 26,
    physicalDeclineRate: 1.5,
    techniqueDeclineOnset: 28,
    techniqueDeclineRate: 0.8,
    mentalDeclineOnset: 35,
    mentalDeclineRate: 0.5,
    declineRamp: 0.26,
    cliffOnset: 32,
    cliffHazardBase: 0.07,
    cliffHazardPerYear: 0.08,
    cliffMagnitudeMin: 4,
    cliffMagnitudeMax: 8,
  },
  // earliest peak (23); gentle erosion through 29, -13.5% at 32, -23% at 33.
  CB: {
    bucket: 'CB',
    realPeakAge: 23,
    growthEnd: 24,
    physicalDeclineOnset: 25,
    physicalDeclineRate: 1.8,
    techniqueDeclineOnset: 26,
    techniqueDeclineRate: 0.95,
    mentalDeclineOnset: 35,
    mentalDeclineRate: 0.5,
    declineRamp: 0.28,
    cliffOnset: 31,
    cliffHazardBase: 0.08,
    cliffHazardPerYear: 0.08,
    cliffMagnitudeMin: 4,
    cliffMagnitudeMax: 8,
  },
  // peak 24; -8..-11%/yr 28-31, -17.6% at 32.
  S: {
    bucket: 'S',
    realPeakAge: 24,
    growthEnd: 24,
    physicalDeclineOnset: 25,
    physicalDeclineRate: 1.8,
    techniqueDeclineOnset: 27,
    techniqueDeclineRate: 0.9,
    mentalDeclineOnset: 35,
    mentalDeclineRate: 0.5,
    declineRamp: 0.26,
    cliffOnset: 32,
    cliffHazardBase: 0.07,
    cliffHazardPerYear: 0.08,
    cliffMagnitudeMin: 4,
    cliffMagnitudeMax: 8,
  },
  // kickers/punters: effectively evergreen into the late 30s.
  ST: {
    bucket: 'ST',
    realPeakAge: 30,
    growthEnd: 30,
    physicalDeclineOnset: 33,
    physicalDeclineRate: 0.5,
    techniqueDeclineOnset: 36,
    techniqueDeclineRate: 0.4,
    mentalDeclineOnset: 38,
    mentalDeclineRate: 0.4,
    declineRamp: 0.15,
    cliffOnset: 38,
    cliffHazardBase: 0.1,
    cliffHazardPerYear: 0.08,
    cliffMagnitudeMin: 3,
    cliffMagnitudeMax: 6,
  },
};

export function agingBucketFor(position: Position): AgingBucket {
  switch (position) {
    case 'QB':
      return 'QB';
    case 'RB':
    case 'FB':
      return 'RB';
    case 'WR':
      return 'WR';
    case 'TE':
      return 'TE';
    case 'LT':
    case 'LG':
    case 'C':
    case 'RG':
    case 'RT':
      return 'OL';
    case 'EDGE':
      return 'EDGE';
    case 'DT':
    case 'NT':
      return 'IDL';
    case 'ILB':
    case 'OLB':
      return 'LB';
    case 'CB':
    case 'NICKEL':
      return 'CB';
    case 'S':
      return 'S';
    case 'K':
    case 'P':
    case 'LS':
      return 'ST';
  }
}

export function curveForPosition(position: Position): PositionAgingCurve {
  return AGING_CURVES[agingBucketFor(position)];
}

/**
 * Hidden per-player decline-rate multiplier — why two same-age WRs age
 * differently. Derived deterministically from the league seed + player id
 * (stable across the whole career, no save-format change), then nudged by
 * current durability so brittle players age faster as their bodies go.
 */
export function declineMultiplierFor(league: LeagueState, player: Player): number {
  const prng = new Prng(`${league.seed}:aging:${player.id}`);
  const base = prng.normal(1.0, 0.22, { min: 0.55, max: 1.7 });
  const durabilityShift = (55 - player.current.durability) * 0.004;
  return Math.min(1.8, Math.max(0.5, base + durabilityShift));
}

/**
 * Rating points of decline this year for one skill category (before the
 * per-player multiplier and noise). Zero before the category's onset.
 */
export function declineFor(curve: PositionAgingCurve, category: SkillCategory, age: number): number {
  if (category === 'stable') return 0;
  let onset: number;
  let rate: number;
  if (category === 'physical') {
    onset = curve.physicalDeclineOnset;
    rate = curve.physicalDeclineRate;
  } else if (category === 'technical') {
    onset = curve.techniqueDeclineOnset;
    rate = curve.techniqueDeclineRate;
  } else {
    onset = curve.mentalDeclineOnset;
    rate = curve.mentalDeclineRate;
  }
  if (age < onset) return 0;
  return rate * (1 + curve.declineRamp * (age - onset));
}

/** P(cliff season) at `age` — 0 before onset, capped at {@link CLIFF_HAZARD_CAP}. */
export function cliffHazard(curve: PositionAgingCurve, age: number): number {
  if (age < curve.cliffOnset) return 0;
  return Math.min(
    CLIFF_HAZARD_CAP,
    curve.cliffHazardBase + curve.cliffHazardPerYear * (age - curve.cliffOnset),
  );
}

/**
 * Injury proneness rises with age (Living Careers S5). Real bar (Actuary
 * baselines): P(next season injury-shortened, ≤8 games) runs ~17% through
 * the mid-20s, 20.8% at 28, 22% at 31, 31.6% at 34 — roughly a 1.8× rise.
 * Scales the per-game injury roll: flat through 26, then +8.5%/yr, shifted
 * by current durability (which itself declines with age, so brittle old
 * players compound — as they should).
 */
export function injuryAgeMultiplier(player: Player, seasonNumber: number): number {
  const age = 2026 + (seasonNumber - 1) - Number(player.birthDate.slice(0, 4));
  const ageFactor = age <= 26 ? 1.0 : 1.0 + (Math.min(age, 36) - 26) * 0.085;
  const durabilityFactor = 1 + (55 - player.current.durability) * 0.006;
  return Math.max(0.6, ageFactor * durabilityFactor);
}

/**
 * A MAJOR injury leaves permanent hidden damage (Living Careers S5) — the
 * Gurley mechanism, and the injury path into never-fulfilled careers:
 * durability always takes a hit, and each explosive trait has a coin-flip
 * chance of losing a step. Deterministic from (player id, tick) so the same
 * injury always scars the same way. Ratings never come back; ceilings are
 * untouched (physical growth ended at 22 anyway).
 */
export function applyInjuryScar(player: Player, occurredOnTick: number): Player {
  const prng = new Prng(`${player.id}:scar:${occurredOnTick}`);
  const current = { ...player.current };
  const hit = (v: number, amount: number): number => Math.max(1, Math.round(v - amount));
  current.durability = hit(current.durability, prng.nextRange(2, 6));
  for (const key of ['speed', 'acceleration', 'agility'] as const) {
    if (prng.next() < 0.5) current[key] = hit(current[key], prng.nextRange(1, 4));
  }
  return { ...player, current };
}
