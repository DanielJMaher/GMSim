import type { Prng } from '../prng/index.js';
import type { FanBaseProfile } from '../types/personnel.js';
import type { MarketSize, FranchiseHistory } from '../types/enums.js';
import { rollSpectrum } from './spectrums.js';
import type { SpectrumRange } from './archetypes/index.js';

/**
 * Generate a fan-base profile per the L/L-01 resolution doc:
 *   1. Roll each dimension within the range defined by market size.
 *   2. Apply franchise-history modifiers.
 *   3. Clamp every dimension back to [1, 10].
 *
 * The result is stable at league creation; gradual evolution over
 * seasons (per the doc's "Fan base evolution: gradual shifts based on
 * team performance over multiple seasons") is handled in season sim.
 */
export function generateFanBase(
  prng: Prng,
  marketSize: MarketSize,
  history: FranchiseHistory,
): FanBaseProfile {
  const ranges = MARKET_RANGES[marketSize];
  const baseline: FanBaseProfile = {
    riskTolerance: rollSpectrum(prng, ranges.riskTolerance),
    analyticsOrientation: rollSpectrum(prng, ranges.analyticsOrientation),
    patienceLevel: rollSpectrum(prng, ranges.patienceLevel),
    financialAggressiveness: rollSpectrum(prng, ranges.financialAggressiveness),
    championshipUrgency: rollSpectrum(prng, ranges.championshipUrgency),
    organizationalStability: rollSpectrum(prng, ranges.organizationalStability),
  };

  return applyHistoryModifiers(baseline, history);
}

interface MarketRanges {
  riskTolerance: SpectrumRange;
  analyticsOrientation: SpectrumRange;
  patienceLevel: SpectrumRange;
  financialAggressiveness: SpectrumRange;
  championshipUrgency: SpectrumRange;
  organizationalStability: SpectrumRange;
}

/**
 * Per L/L-01 resolution doc. The doc specifies five dimensions; the
 * sixth (organizationalStability contribution from fans) is derived
 * from the same market-size logic — bigger markets = noisier press =
 * less organizational stability contribution from fans.
 */
const MARKET_RANGES: Record<MarketSize, MarketRanges> = {
  LARGE: {
    riskTolerance: [3, 6],
    analyticsOrientation: [6, 9],
    patienceLevel: [2, 5],
    financialAggressiveness: [7, 10],
    championshipUrgency: [8, 10],
    organizationalStability: [2, 5],
  },
  MEDIUM: {
    riskTolerance: [4, 7],
    analyticsOrientation: [4, 7],
    patienceLevel: [4, 7],
    financialAggressiveness: [4, 7],
    championshipUrgency: [4, 8],
    organizationalStability: [4, 7],
  },
  SMALL: {
    riskTolerance: [6, 9],
    analyticsOrientation: [2, 5],
    patienceLevel: [6, 9],
    financialAggressiveness: [3, 6],
    championshipUrgency: [3, 7],
    organizationalStability: [5, 8],
  },
};

/**
 * Franchise-history modifiers per the L/L-01 resolution doc. Modifiers
 * are added after market-size baseline rolls; final values are clamped
 * to [1, 10].
 */
function applyHistoryModifiers(baseline: FanBaseProfile, history: FranchiseHistory): FanBaseProfile {
  const mod = HISTORY_MODIFIERS[history];
  return {
    riskTolerance: clamp(baseline.riskTolerance + (mod.riskTolerance ?? 0)),
    analyticsOrientation: clamp(baseline.analyticsOrientation + (mod.analyticsOrientation ?? 0)),
    patienceLevel: clamp(baseline.patienceLevel + (mod.patienceLevel ?? 0)),
    financialAggressiveness: clamp(baseline.financialAggressiveness + (mod.financialAggressiveness ?? 0)),
    championshipUrgency: clamp(baseline.championshipUrgency + (mod.championshipUrgency ?? 0)),
    organizationalStability: clamp(baseline.organizationalStability + (mod.organizationalStability ?? 0)),
  };
}

const HISTORY_MODIFIERS: Record<FranchiseHistory, Partial<FanBaseProfile>> = {
  RECENT_DYNASTY: { championshipUrgency: 2, patienceLevel: -2 },
  SLEEPING_GIANT: { championshipUrgency: 3, riskTolerance: 1 },
  LOVABLE_LOSER: { championshipUrgency: -1, patienceLevel: 3 },
  CINDERELLA_STORY: { riskTolerance: 2, patienceLevel: 2 },
  REBUILD_IN_PROGRESS: { patienceLevel: 1, analyticsOrientation: 1 },
  CONTROVERSIAL_FRANCHISE: { organizationalStability: -2, championshipUrgency: 1 },
  NEW_IDENTITY: { patienceLevel: 2, riskTolerance: 1 },
  PERENNIAL_CONTENDER: { championshipUrgency: 1, analyticsOrientation: 1 },
  CURSED_FRANCHISE: { riskTolerance: -1, championshipUrgency: 2 },
  SURPRISE_CHAMPION: { patienceLevel: -1, championshipUrgency: 2 },
};

function clamp(v: number): number {
  return Math.max(1, Math.min(10, v));
}
