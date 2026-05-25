/**
 * Media prospect evaluators (v0.70) — the media's read on the draft class.
 *
 * Per the agreed model, each media outlet is backed by N behind-the-
 * scenes evaluators (a BLOG = the lone-streamer with 1; an INSIDER desk
 * has a staff). Each evaluator files an attributed observation on the
 * notable prospects, reusing the same observation shape team scouts use
 * — so the media's opinion is produced by the same machinery, just with
 * the outlet's accuracy and a **hype bias** layered on.
 *
 * Two knobs, straight off the `MediaOutlet`:
 *   - `accuracySpectrum` (1..10) → evaluator accuracy (read noise).
 *   - `hypeSpectrum` (1..10) → a directional optimism bias toward
 *     *flashy* prospects (blue-blood schools, high talent). A high-hype
 *     outlet inflates the big names — the false-flag mechanic. Aggregate
 *     more evaluators (bigger outlet) → a tighter, steadier read; a
 *     1-evaluator blog swings.
 *
 * Output is a separate observation stream (`LeagueState.mediaCollegeObservations`)
 * so it never contaminates the 32 team boards — teams that choose to
 * weight the buzz can blend it in later. Determinism: forked per outlet
 * + evaluator off the cycle PRNG.
 */

import type { Prng } from '../prng/index.js';
import type {
  CollegePlayer,
  CollegePlayerObservation,
  ConferenceTier,
} from '../types/college.js';
import type { MediaOutlet, MediaTier } from '../types/media.js';
import type { PlayerSkills } from '../types/player.js';
import { ScoutId } from '../types/ids.js';
import { COLLEGE_SCHOOLS } from '../data/colleges/index.js';

// ── Tuning knobs ────────────────────────────────────────────────────────
/** Evaluators per outlet by tier — a BLOG is the lone streamer. */
const EVALUATORS_BY_TIER: Record<MediaTier, number> = {
  INSIDER: 6,
  BEAT: 4,
  COLUMNIST: 3,
  RADIO: 2,
  BLOG: 1,
};
/** How many of the notable class each evaluator files on. */
const READS_PER_EVALUATOR = 40;
/** Size of the "notable" class the media covers (top of the board). */
const NOTABLE_CLASS_SIZE = 120;
/** Max optimism (skill points) a max-hype outlet adds to a max-flashy prospect. */
const HYPE_MAX_BIAS = 12;
/** Base read noise stdev at zero accuracy (mirrors the college scout base). */
const BASE_NOISE_STDEV = 18;

const SCHOOL_PRESTIGE: Record<ConferenceTier, number> = {
  POWER: 1.0,
  GROUP_OF_5: 0.5,
  FCS: 0.25,
  SMALL: 0.12,
};

const SCHOOL_TIER_BY_ID = new Map<string, ConferenceTier>(
  COLLEGE_SCHOOLS.map((s) => [s.id, s.tier] as const),
);

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function meanCurrent(cp: CollegePlayer): number {
  const vals = Object.values(cp.current) as number[];
  if (vals.length === 0) return 0;
  let sum = 0;
  for (const v of vals) sum += v;
  return sum / vals.length / 100; // → 0..1
}

/**
 * How much the media gravitates to a prospect — big-school pedigree +
 * raw talent. Drives both who's "notable" and how hard hype inflates
 * them.
 */
function flashiness(cp: CollegePlayer): number {
  const prestige = SCHOOL_PRESTIGE[SCHOOL_TIER_BY_ID.get(cp.schoolId) ?? 'GROUP_OF_5'];
  return clamp(0.6 * prestige + 0.4 * meanCurrent(cp), 0, 1);
}

/**
 * Generate one cycle of media observations across every college-focused
 * outlet. Each outlet's evaluators file on the top of the notable class
 * with the outlet's accuracy + hype bias.
 */
export function generateMediaCollegeObservations(
  prng: Prng,
  outlets: Readonly<Record<string, MediaOutlet>>,
  pool: readonly CollegePlayer[],
  observedOnTick: number,
): CollegePlayerObservation[] {
  const eligible = pool.filter((cp) => cp.isDraftEligible && cp.hasDeclared);
  if (eligible.length === 0) return [];

  // The notable class: the prospects the media actually covers, by
  // flashiness (pedigree + talent), capped.
  const notable = [...eligible]
    .map((cp) => ({ cp, flash: flashiness(cp) }))
    .sort((a, b) => b.flash - a.flash || (a.cp.id < b.cp.id ? -1 : 1))
    .slice(0, NOTABLE_CLASS_SIZE);

  const observations: CollegePlayerObservation[] = [];
  for (const outlet of Object.values(outlets)) {
    if (outlet.focus !== 'COLLEGE') continue;
    const accuracy = clamp(outlet.accuracySpectrum / 10, 0, 1);
    const hype = clamp(outlet.hypeSpectrum / 10, 0, 1);
    const evaluatorCount = EVALUATORS_BY_TIER[outlet.tier] ?? 2;
    const outletPrng = prng.fork(`outlet:${outlet.id}`);

    for (let e = 0; e < evaluatorCount; e++) {
      const evalPrng = outletPrng.fork(`e${e}`);
      const evaluatorId = ScoutId(`${outlet.id}::e${e}`);
      // Each evaluator files on the top READS_PER_EVALUATOR of the
      // notable class — the names the media obsesses over.
      const targets = notable.slice(0, READS_PER_EVALUATOR);
      for (const { cp, flash } of targets) {
        const hypeBias = HYPE_MAX_BIAS * hype * flash;
        observations.push(
          generateMediaObservation(
            evalPrng.fork(`p:${cp.id}`),
            evaluatorId,
            cp,
            accuracy,
            hypeBias,
            observedOnTick,
          ),
        );
      }
    }
  }
  return observations;
}

function generateMediaObservation(
  prng: Prng,
  evaluatorId: ReturnType<typeof ScoutId>,
  prospect: CollegePlayer,
  accuracy: number,
  hypeBias: number,
  observedOnTick: number,
): CollegePlayerObservation {
  const noiseStdev = BASE_NOISE_STDEV * (1 - accuracy);
  const skills: Partial<Record<keyof PlayerSkills, number>> = {};
  const confidence: Partial<Record<keyof PlayerSkills, number>> = {};
  for (const [key, trueValue] of Object.entries(prospect.current) as [keyof PlayerSkills, number][]) {
    const observed = clamp(trueValue + prng.normal(0, noiseStdev) + hypeBias, 0, 100);
    skills[key] = Math.round(observed);
    confidence[key] = Number(accuracy.toFixed(2));
  }
  return {
    scoutId: evaluatorId,
    collegePlayerId: prospect.id,
    observedOnTick,
    skills,
    confidence,
  };
}
