import type { Prng } from '../prng/index.js';
import type { Gm, PerceivedOutletReliability } from '../types/personnel.js';
import type { MediaOutlet } from '../types/media.js';
import type { MediaOutletId, GmId } from '../types/ids.js';
import type { PositionGroup } from '../types/enums.js';

/**
 * Seed a GM's *perceived* media-outlet reliability (Slice 2 of "GMs consume
 * the media"). Before this, every GM weighted a media read by the outlet's
 * TRUE per-group accuracy — omniscient. Now each GM carries their own belief
 * about which outlets to trust, and it can be wrong.
 *
 * Model, per outlet × position group:
 *
 *   perceived = clamp( prior + k·(true − prior) + noise + hypeSkew , 1, 10 )
 *
 *   - `prior` (5.5): the neutral "average outlet" assumption a GM defaults to.
 *   - `k` ∈ [0.15, 0.85] from `talentEvaluationAccuracy`: a sharp evaluator
 *     starts close to the truth; a poor one barely moves off the prior.
 *   - `noise`: miscalibration, magnitude ∝ (1 − k) — poor evaluators are
 *     not just less informed, they're more randomly wrong.
 *   - `hypeSkew`: a high-`mediaTrust` GM over-rates loud (high-`hypeByGroup`)
 *     outlets and under-rates measured ones; a skeptic does the reverse.
 *     Because hype correlates negatively with real accuracy in the outlet
 *     pool, this is exactly how a buzz-chaser ends up trusting the wrong
 *     voice and reaching at the draft.
 *
 * Deterministic: caller forks the PRNG per GM.
 */
const PRIOR = 5.5;
const CALIBRATION_MIN = 0.15;
const CALIBRATION_SPAN = 0.7;
const NOISE_SPAN = 3;
const HYPE_SKEW = 2;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** talentEvaluationAccuracy 1..10 → calibration weight 0.15..0.85. */
function calibration(talentEvaluationAccuracy: number): number {
  const t = clamp(talentEvaluationAccuracy, 1, 10);
  return CALIBRATION_MIN + ((t - 1) / 9) * CALIBRATION_SPAN;
}

export function seedPerceivedOutletReliability(
  prng: Prng,
  gm: Gm,
  outlets: Readonly<Record<MediaOutletId, MediaOutlet>>,
): PerceivedOutletReliability {
  const k = calibration(gm.spectrums.talentEvaluationAccuracy);
  const noiseMag = (1 - k) * NOISE_SPAN;
  const mt = (gm.spectrums.mediaTrust - 5.5) / 4.5; // -1..+1

  const out: Record<MediaOutletId, Record<PositionGroup, number>> = {};
  for (const outletId of Object.keys(outlets) as MediaOutletId[]) {
    const outlet = outlets[outletId]!;
    const perGroup: Record<PositionGroup, number> = {} as Record<PositionGroup, number>;
    for (const g of Object.keys(outlet.accuracyByGroup) as PositionGroup[]) {
      const trueAcc = outlet.accuracyByGroup[g];
      const hype = outlet.hypeByGroup[g] ?? outlet.hypeSpectrum;
      const base = PRIOR + k * (trueAcc - PRIOR);
      const noise = noiseMag > 0 ? (prng.next() * 2 - 1) * noiseMag : 0;
      const hp = (hype - 5.5) / 4.5; // -1..+1
      const skew = mt * hp * HYPE_SKEW;
      perGroup[g] = clamp(base + noise + skew, 1, 10);
    }
    out[outletId] = perGroup;
  }
  return out;
}

/**
 * Seed perceived reliability for every GM, forking the PRNG per GM id so the
 * result is stable and order-independent. Returns a new `gms` map; the input
 * is not mutated.
 */
export function seedPerceivedReliabilityForGms(
  prng: Prng,
  gms: Readonly<Record<GmId, Gm>>,
  outlets: Readonly<Record<MediaOutletId, MediaOutlet>>,
): Record<GmId, Gm> {
  const out: Record<GmId, Gm> = {};
  for (const [id, gm] of Object.entries(gms) as [GmId, Gm][]) {
    out[id] = {
      ...gm,
      perceivedOutletReliability: seedPerceivedOutletReliability(prng.fork(id), gm, outlets),
    };
  }
  return out;
}
