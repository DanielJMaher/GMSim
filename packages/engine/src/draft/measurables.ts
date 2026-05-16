import type { Prng } from '../prng/index.js';
import type { Position } from '../types/enums.js';
import type { Measurables } from '../types/college.js';
import type { PlayerSkills } from '../types/player.js';

/**
 * Position-baseline measurable distributions. Means + stdevs are
 * grounded in real NFL Combine averages so generated prospects look
 * physically plausible at a glance: most QBs are ~6'3" 215, most
 * NTs are ~6'2" 335, most RBs are ~5'10" 215.
 *
 * The generator deliberately decouples measurables from `PlayerSkills`
 * by ~70% — speed skill correlates with 40-time, but only loosely.
 * The remaining variance is the "workout warrior" / "tape star, poor
 * tester" tension Doc 3 calls out: a player can run a great 40 and
 * still play slow on tape, or a player can be a 4.7-40 type whose
 * route running and acceleration in pads make them play fast.
 */

interface PositionBaseline {
  // Means
  height: number; // inches
  weight: number; // lbs
  arm: number;    // inches
  hand: number;   // inches
  forty: number;  // seconds
  bench: number;  // 225-lb reps
  vert: number;   // inches
  broad: number;  // inches
  cone: number;   // 3-cone seconds
  shuttle: number; // 20-yard shuttle seconds
  // Stdevs
  heightSd: number;
  weightSd: number;
  fortySd: number;
  benchSd: number;
}

const POSITION_BASELINES: Record<Position, PositionBaseline> = {
  QB: {
    height: 75, weight: 220, arm: 32.5, hand: 9.5, forty: 4.8, bench: 12,
    vert: 31, broad: 110, cone: 7.1, shuttle: 4.3,
    heightSd: 1.5, weightSd: 12, fortySd: 0.18, benchSd: 4,
  },
  RB: {
    height: 70, weight: 215, arm: 31.0, hand: 9.0, forty: 4.55, bench: 18,
    vert: 35, broad: 117, cone: 7.0, shuttle: 4.25,
    heightSd: 1.5, weightSd: 12, fortySd: 0.10, benchSd: 4,
  },
  FB: {
    height: 71, weight: 240, arm: 31.5, hand: 9.2, forty: 4.75, bench: 22,
    vert: 32, broad: 110, cone: 7.2, shuttle: 4.4,
    heightSd: 1.4, weightSd: 12, fortySd: 0.10, benchSd: 4,
  },
  WR: {
    height: 73, weight: 200, arm: 32.0, hand: 9.3, forty: 4.50, bench: 13,
    vert: 36, broad: 121, cone: 6.9, shuttle: 4.20,
    heightSd: 2.2, weightSd: 14, fortySd: 0.10, benchSd: 4,
  },
  TE: {
    height: 76, weight: 250, arm: 33.0, hand: 9.7, forty: 4.75, bench: 20,
    vert: 33, broad: 116, cone: 7.1, shuttle: 4.35,
    heightSd: 1.4, weightSd: 12, fortySd: 0.12, benchSd: 4,
  },
  LT: {
    height: 78, weight: 315, arm: 34.5, hand: 10.0, forty: 5.20, bench: 25,
    vert: 28, broad: 102, cone: 7.6, shuttle: 4.7,
    heightSd: 1.0, weightSd: 12, fortySd: 0.15, benchSd: 5,
  },
  LG: {
    height: 76, weight: 315, arm: 33.0, hand: 10.0, forty: 5.25, bench: 28,
    vert: 27, broad: 100, cone: 7.7, shuttle: 4.75,
    heightSd: 1.2, weightSd: 12, fortySd: 0.15, benchSd: 5,
  },
  C: {
    height: 75, weight: 305, arm: 32.5, hand: 9.8, forty: 5.20, bench: 26,
    vert: 28, broad: 100, cone: 7.6, shuttle: 4.7,
    heightSd: 1.2, weightSd: 12, fortySd: 0.15, benchSd: 5,
  },
  RG: {
    height: 76, weight: 315, arm: 33.0, hand: 10.0, forty: 5.25, bench: 28,
    vert: 27, broad: 100, cone: 7.7, shuttle: 4.75,
    heightSd: 1.2, weightSd: 12, fortySd: 0.15, benchSd: 5,
  },
  RT: {
    height: 78, weight: 315, arm: 34.5, hand: 10.0, forty: 5.20, bench: 25,
    vert: 28, broad: 102, cone: 7.6, shuttle: 4.7,
    heightSd: 1.0, weightSd: 12, fortySd: 0.15, benchSd: 5,
  },
  EDGE: {
    height: 76, weight: 260, arm: 33.5, hand: 9.7, forty: 4.70, bench: 22,
    vert: 34, broad: 119, cone: 7.0, shuttle: 4.35,
    heightSd: 1.4, weightSd: 14, fortySd: 0.12, benchSd: 5,
  },
  DT: {
    height: 75, weight: 305, arm: 33.5, hand: 10.0, forty: 5.05, bench: 28,
    vert: 29, broad: 105, cone: 7.6, shuttle: 4.6,
    heightSd: 1.2, weightSd: 14, fortySd: 0.18, benchSd: 5,
  },
  NT: {
    height: 75, weight: 335, arm: 34.0, hand: 10.0, forty: 5.30, bench: 30,
    vert: 26, broad: 98, cone: 7.9, shuttle: 4.85,
    heightSd: 1.2, weightSd: 14, fortySd: 0.18, benchSd: 5,
  },
  ILB: {
    height: 73, weight: 235, arm: 32.0, hand: 9.5, forty: 4.65, bench: 22,
    vert: 34, broad: 117, cone: 7.0, shuttle: 4.30,
    heightSd: 1.4, weightSd: 12, fortySd: 0.12, benchSd: 5,
  },
  OLB: {
    height: 74, weight: 240, arm: 33.0, hand: 9.5, forty: 4.65, bench: 22,
    vert: 35, broad: 119, cone: 7.0, shuttle: 4.30,
    heightSd: 1.4, weightSd: 12, fortySd: 0.12, benchSd: 5,
  },
  CB: {
    height: 71, weight: 195, arm: 31.5, hand: 9.2, forty: 4.45, bench: 13,
    vert: 36, broad: 122, cone: 6.85, shuttle: 4.15,
    heightSd: 1.5, weightSd: 10, fortySd: 0.08, benchSd: 4,
  },
  S: {
    height: 73, weight: 210, arm: 32.0, hand: 9.4, forty: 4.55, bench: 15,
    vert: 35, broad: 121, cone: 7.0, shuttle: 4.25,
    heightSd: 1.4, weightSd: 10, fortySd: 0.10, benchSd: 4,
  },
  NICKEL: {
    height: 71, weight: 200, arm: 31.5, hand: 9.2, forty: 4.50, bench: 14,
    vert: 36, broad: 121, cone: 6.90, shuttle: 4.20,
    heightSd: 1.4, weightSd: 10, fortySd: 0.08, benchSd: 4,
  },
  K: {
    height: 73, weight: 195, arm: 31.0, hand: 9.0, forty: 4.95, bench: 10,
    vert: 30, broad: 105, cone: 7.4, shuttle: 4.5,
    heightSd: 2.0, weightSd: 14, fortySd: 0.20, benchSd: 4,
  },
  P: {
    height: 74, weight: 210, arm: 32.0, hand: 9.2, forty: 4.95, bench: 12,
    vert: 30, broad: 108, cone: 7.4, shuttle: 4.5,
    heightSd: 2.0, weightSd: 14, fortySd: 0.20, benchSd: 4,
  },
  LS: {
    height: 73, weight: 240, arm: 32.0, hand: 9.5, forty: 5.10, bench: 20,
    vert: 28, broad: 105, cone: 7.5, shuttle: 4.6,
    heightSd: 1.5, weightSd: 12, fortySd: 0.20, benchSd: 5,
  },
};

export interface RollMeasurablesOptions {
  position: Position;
  /** Underlying skills — used to apply a modest correlation. */
  skills: PlayerSkills;
}

/**
 * Roll combine-shape measurables for a prospect. Position drives the
 * distribution; underlying skills nudge a few correlated dials so a
 * fast-skill player tends (loosely) to test fast and a strong player
 * tends to bench more. The correlation is intentionally weak so the
 * "tape doesn't match the workout" outliers are common.
 */
export function rollMeasurables(prng: Prng, options: RollMeasurablesOptions): Measurables {
  const baseline = POSITION_BASELINES[options.position];

  const heightInches = clamp(
    round1(prng.normal(baseline.height, baseline.heightSd)),
    62,
    82,
  );
  const weightLbs = clamp(
    Math.round(prng.normal(baseline.weight, baseline.weightSd)),
    150,
    400,
  );

  // Arm/hand correlate with height — taller players have longer arms.
  const heightDelta = heightInches - baseline.height;
  const armLengthInches = clamp(
    round1(baseline.arm + heightDelta * 0.4 + prng.normal(0, 0.5)),
    28,
    38,
  );
  const handSizeInches = clamp(
    round1(baseline.hand + heightDelta * 0.05 + prng.normal(0, 0.3)),
    8,
    11.5,
  );

  // 40 — speed skill nudges this. ~30% correlation: a +20-pt speed
  // skill above mean shaves ~0.06s off the 40, but plenty of noise.
  const speedSignal = (options.skills.speed - 70) / 30; // ~ -2.3 .. +1.0
  const fortyYardSeconds = clamp(
    round2(baseline.forty - speedSignal * 0.06 + prng.normal(0, baseline.fortySd)),
    4.20,
    6.00,
  );

  // Bench — strength skill nudges. Heavier prospects also bench more.
  const strengthSignal = (options.skills.strength - 70) / 30;
  const weightBonus = (weightLbs - baseline.weight) * 0.05;
  const benchPress225Reps = Math.max(
    0,
    Math.round(baseline.bench + strengthSignal * 4 + weightBonus + prng.normal(0, baseline.benchSd)),
  );

  // Vertical / broad — agility + acceleration nudge.
  const explosivenessSignal = (options.skills.acceleration - 70) / 30;
  const verticalInches = clamp(
    round1(baseline.vert + explosivenessSignal * 2 + prng.normal(0, 2)),
    18,
    48,
  );
  const broadJumpInches = clamp(
    Math.round(baseline.broad + explosivenessSignal * 3 + prng.normal(0, 4)),
    80,
    140,
  );

  // 3-cone / shuttle — agility nudge.
  const agilitySignal = (options.skills.agility - 70) / 30;
  const threeConeSeconds = clamp(
    round2(baseline.cone - agilitySignal * 0.10 + prng.normal(0, 0.10)),
    6.40,
    8.50,
  );
  const shuttleSeconds = clamp(
    round2(baseline.shuttle - agilitySignal * 0.06 + prng.normal(0, 0.07)),
    3.90,
    5.20,
  );

  return {
    heightInches,
    weightLbs,
    armLengthInches,
    handSizeInches,
    fortyYardSeconds,
    benchPress225Reps,
    verticalInches,
    broadJumpInches,
    threeConeSeconds,
    shuttleSeconds,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
