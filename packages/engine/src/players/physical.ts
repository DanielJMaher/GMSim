/**
 * Physical profile generation (v0.94, player-model overhaul Stage 1).
 *
 * NFL `Player` records now carry size — height, weight, arm length, hand
 * size — the same dimensions college prospects already have on their
 * `Measurables`. Size is ground truth that gates plausible roles (no
 * 6'1"/225 base end; no 6'5"/330 coverage safety) and feeds the
 * role-based scheme fit (Stage 3). Drafted prospects carry their real
 * combine measurables through promotion; generated veterans (league
 * creation, migration backfill) roll a position-appropriate profile here.
 *
 * Distributions are per-position gaussians tuned to real NFL norms.
 * Deterministic from the supplied PRNG.
 */

import type { Prng } from '../prng/index.js';
import { Position } from '../types/enums.js';

export interface PhysicalProfile {
  /** Height in inches. */
  heightInches: number;
  /** Weight in pounds. */
  weightLbs: number;
  /** Arm length in inches. */
  armLengthInches: number;
  /** Hand size in inches. */
  handSizeInches: number;
}

interface SizeSpec {
  height: [mean: number, sd: number];
  weight: [mean: number, sd: number];
  arm: [mean: number, sd: number];
  hand: [mean: number, sd: number];
}

// Per-position size norms (height/arm/hand in inches, weight in lbs).
const SIZE_BY_POSITION: Record<Position, SizeSpec> = {
  [Position.QB]: { height: [75, 1.2], weight: [223, 8], arm: [32.0, 0.6], hand: [9.6, 0.4] },
  [Position.RB]: { height: [70, 1.2], weight: [214, 9], arm: [31.2, 0.6], hand: [9.3, 0.4] },
  [Position.FB]: { height: [72, 1.0], weight: [245, 8], arm: [32.0, 0.6], hand: [9.6, 0.4] },
  [Position.WR]: { height: [73, 1.7], weight: [200, 11], arm: [32.0, 0.7], hand: [9.4, 0.4] },
  [Position.TE]: { height: [77, 1.1], weight: [250, 9], arm: [33.3, 0.7], hand: [9.9, 0.4] },
  [Position.LT]: { height: [78, 1.0], weight: [312, 9], arm: [34.5, 0.7], hand: [10.2, 0.4] },
  [Position.LG]: { height: [77, 1.0], weight: [314, 9], arm: [33.8, 0.7], hand: [10.1, 0.4] },
  [Position.C]: { height: [76, 1.0], weight: [305, 8], arm: [33.0, 0.6], hand: [10.0, 0.4] },
  [Position.RG]: { height: [77, 1.0], weight: [314, 9], arm: [33.8, 0.7], hand: [10.1, 0.4] },
  [Position.RT]: { height: [78, 1.0], weight: [312, 9], arm: [34.5, 0.7], hand: [10.2, 0.4] },
  [Position.EDGE]: { height: [76, 1.2], weight: [260, 10], arm: [34.0, 0.8], hand: [9.9, 0.4] },
  [Position.DT]: { height: [75, 1.1], weight: [305, 12], arm: [33.5, 0.8], hand: [10.0, 0.4] },
  [Position.NT]: { height: [74, 1.0], weight: [330, 12], arm: [33.5, 0.7], hand: [10.1, 0.4] },
  [Position.ILB]: { height: [73, 1.0], weight: [240, 8], arm: [32.5, 0.6], hand: [9.7, 0.4] },
  [Position.OLB]: { height: [74, 1.2], weight: [245, 9], arm: [33.0, 0.7], hand: [9.8, 0.4] },
  [Position.CB]: { height: [71, 1.3], weight: [193, 8], arm: [31.5, 0.7], hand: [9.3, 0.4] },
  [Position.S]: { height: [72, 1.2], weight: [207, 8], arm: [32.0, 0.7], hand: [9.4, 0.4] },
  [Position.NICKEL]: { height: [70, 1.1], weight: [190, 7], arm: [31.0, 0.6], hand: [9.2, 0.4] },
  [Position.K]: { height: [73, 1.5], weight: [200, 10], arm: [31.5, 0.8], hand: [9.3, 0.4] },
  [Position.P]: { height: [74, 1.5], weight: [210, 10], arm: [32.0, 0.8], hand: [9.4, 0.4] },
  [Position.LS]: { height: [74, 1.2], weight: [240, 9], arm: [32.5, 0.7], hand: [9.7, 0.4] },
};

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * Roll a position-appropriate physical profile. Deterministic from `prng`.
 */
export function generatePhysicalProfile(prng: Prng, position: Position): PhysicalProfile {
  const spec = SIZE_BY_POSITION[position];
  return {
    heightInches: Math.round(prng.normal(spec.height[0], spec.height[1], { min: 66, max: 82 })),
    weightLbs: Math.round(prng.normal(spec.weight[0], spec.weight[1], { min: 160, max: 360 })),
    armLengthInches: round1(prng.normal(spec.arm[0], spec.arm[1], { min: 29, max: 37 })),
    handSizeInches: round1(prng.normal(spec.hand[0], spec.hand[1], { min: 8, max: 11.5 })),
  };
}
