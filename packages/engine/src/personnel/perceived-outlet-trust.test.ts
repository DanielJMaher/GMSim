import { describe, it, expect } from 'vitest';
import { Prng } from '../prng/index.js';
import { seedPerceivedOutletReliability } from './perceived-outlet-trust.js';
import type { Gm, GmSpectrums } from '../types/personnel.js';
import type { MediaOutlet } from '../types/media.js';
import { GmId, MediaOutletId } from '../types/ids.js';
import type { PositionGroup } from '../types/enums.js';

const GROUPS: readonly PositionGroup[] = ['QB', 'SKILL', 'OL', 'DL', 'LB', 'DB', 'ST'];

function spectrums(over: Partial<GmSpectrums>): GmSpectrums {
  return {
    analyticsReliance: 5,
    tradeAggressiveness: 5,
    draftConviction: 5,
    freeAgencyDiscipline: 5,
    capManagement: 5,
    patienceUnderPressure: 5,
    talentEvaluationAccuracy: 5,
    intangiblesWeighting: 5,
    evolutionRate: 5,
    relationshipQuality: 5,
    mediaTrust: 5,
    ...over,
  };
}

function gm(id: string, over: Partial<GmSpectrums>): Gm {
  return {
    id: GmId(id),
    name: id,
    spectrums: spectrums(over),
    positionalBias: { position: 'QB', bias: 1 },
    quirks: [],
    personality: {} as Gm['personality'],
  };
}

/** Build N outlets with a spread of true accuracy and hype. */
function outlets(n: number, accFn: (i: number) => number, hypeFn: (i: number) => number) {
  const out: Record<MediaOutletId, MediaOutlet> = {};
  for (let i = 0; i < n; i++) {
    const id = MediaOutletId(`OUT_${i}`);
    const acc = accFn(i);
    const hype = hypeFn(i);
    out[id] = {
      id,
      name: id,
      tier: 'COLUMNIST',
      focus: 'BOTH',
      market: 'NATIONAL',
      accuracySpectrum: acc,
      hypeSpectrum: hype,
      accuracyByGroup: Object.fromEntries(GROUPS.map((g) => [g, acc])) as MediaOutlet['accuracyByGroup'],
      hypeByGroup: Object.fromEntries(GROUPS.map((g) => [g, hype])) as MediaOutlet['hypeByGroup'],
    };
  }
  return out;
}

function meanAbsError(
  perceived: ReturnType<typeof seedPerceivedOutletReliability>,
  outs: Record<MediaOutletId, MediaOutlet>,
): number {
  let sum = 0;
  let n = 0;
  for (const id of Object.keys(outs) as MediaOutletId[]) {
    for (const g of GROUPS) {
      sum += Math.abs((perceived[id]?.[g] ?? 0) - outs[id]!.accuracyByGroup[g]);
      n++;
    }
  }
  return n ? sum / n : 0;
}

describe('seedPerceivedOutletReliability', () => {
  // A spread of true accuracy 2..9 across 16 outlets, neutral hype.
  const outs = outlets(16, (i) => 2 + (i % 8), () => 5.5);

  it('is deterministic for a given PRNG seed + GM', () => {
    const g = gm('A', { talentEvaluationAccuracy: 6, mediaTrust: 5 });
    const a = seedPerceivedOutletReliability(new Prng('seed::A'), g, outs);
    const b = seedPerceivedOutletReliability(new Prng('seed::A'), g, outs);
    expect(a).toEqual(b);
  });

  it('produces a perceived value in [1,10] for every outlet/group', () => {
    const g = gm('B', { talentEvaluationAccuracy: 3, mediaTrust: 9 });
    const p = seedPerceivedOutletReliability(new Prng('seed::B'), g, outs);
    for (const id of Object.keys(outs) as MediaOutletId[]) {
      for (const grp of GROUPS) {
        const v = p[id]![grp];
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(10);
      }
    }
  });

  it('a sharp evaluator is far better calibrated to the truth than a poor one', () => {
    const sharp = gm('SHARP', { talentEvaluationAccuracy: 10, mediaTrust: 5 });
    const poor = gm('POOR', { talentEvaluationAccuracy: 1, mediaTrust: 5 });
    const sharpErr = meanAbsError(seedPerceivedOutletReliability(new Prng('s'), sharp, outs), outs);
    const poorErr = meanAbsError(seedPerceivedOutletReliability(new Prng('p'), poor, outs), outs);
    expect(sharpErr).toBeLessThan(poorErr);
    // The sharp GM should land genuinely close to truth.
    expect(sharpErr).toBeLessThan(1.5);
  });

  it('a buzz-chaser (high mediaTrust) over-rates a loud (high-hype) outlet vs a skeptic', () => {
    // One loud, low-accuracy outlet (acc 3, hype 10) — the classic trap.
    const trap = outlets(1, () => 3, () => 10);
    const id = MediaOutletId('OUT_0');
    // Hold evaluator skill high so noise is small and the hype-skew dominates.
    const chaser = gm('CHASER', { talentEvaluationAccuracy: 9, mediaTrust: 10 });
    const skeptic = gm('SKEPTIC', { talentEvaluationAccuracy: 9, mediaTrust: 1 });
    const cVal = seedPerceivedOutletReliability(new Prng('c'), chaser, trap)[id]!.QB;
    const sVal = seedPerceivedOutletReliability(new Prng('k'), skeptic, trap)[id]!.QB;
    expect(cVal).toBeGreaterThan(sVal);
  });
});
