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
  CombineMeasurables,
  ConferenceTier,
} from '../types/college.js';
import type { MediaOutlet, MediaTier } from '../types/media.js';
import type { PlayerSkills } from '../types/player.js';
import { ScoutId } from '../types/ids.js';
import { COLLEGE_SCHOOLS } from '../data/colleges/index.js';
import { computeCombineAthleticism } from '../draft/athleticism.js';

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
/**
 * Combine reactivity (v0.76) — once a class has tested, athletic
 * percentile feeds the media's read on two channels:
 *   - COVERAGE: a freak workout pulls a prospect into the notable class
 *     the media talks about (everyone saw the 4.3), weighted alongside
 *     pedigree + talent. Outlet-independent — the combine is public.
 *   - READ BIAS: a max-hype outlet inflates a max-athletic prospect by
 *     up to this many skill points (the workout-warrior false flag);
 *     low-hype outlets read the same freak near truth, so he rises
 *     loudly on hype boards and only quietly elsewhere.
 * Both terms are 0 before the combine (athleticism is 0 with no data),
 * so this is fully backward-compatible pre-combine.
 */
const ATHLETIC_COVERAGE_WEIGHT = 0.35;
const COMBINE_HYPE_BIAS = 10;

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

export interface MediaCoverageOptions {
  /** How many of the notable class each evaluator files on. */
  readsPerEvaluator?: number;
  /** Extra accuracy (0..1) on every read this round — coverage sharpens
   * as the draft nears (more film, more sources). */
  accuracyBoost?: number;
}

/**
 * Generate one round of media observations across every college-focused
 * outlet. Each outlet's evaluators file on the top of the notable class
 * with the outlet's accuracy (+ a round-level boost) and hype bias.
 *
 * v0.74: callers replace the media stream with each round, scaling
 * `readsPerEvaluator` + `accuracyBoost` by how close to the draft we
 * are — see `mediaCoverageForLevel`.
 *
 * v0.76: pass the class's `combineResults` to make the read combine-
 * reactive — a workout warrior climbs onto the media's radar (coverage)
 * and gets inflated on hype boards (read bias). Omit it (or pass `{}`)
 * for a pre-combine, combine-agnostic read.
 */
export function generateMediaCollegeObservations(
  prng: Prng,
  outlets: Readonly<Record<string, MediaOutlet>>,
  pool: readonly CollegePlayer[],
  observedOnTick: number,
  options: MediaCoverageOptions = {},
  combineResults: Readonly<Record<string, CombineMeasurables>> = {},
): CollegePlayerObservation[] {
  const reads = options.readsPerEvaluator ?? READS_PER_EVALUATOR;
  const accuracyBoost = options.accuracyBoost ?? 0;

  const eligible = pool.filter((cp) => cp.isDraftEligible && cp.hasDeclared);
  if (eligible.length === 0) return [];

  // Athletic percentile within the declared field. All zero before the
  // class has tested (no combine data) → combine reactivity is a no-op
  // pre-combine.
  const athleticism = computeCombineAthleticism(eligible, combineResults);

  // The notable class: the prospects the media actually covers. Ranked by
  // pedigree + talent (flashiness) AND combine athleticism — a freak
  // workout pulls an under-the-radar prospect onto the media's radar.
  const notable = [...eligible]
    .map((cp) => {
      const flash = flashiness(cp);
      const athletic = athleticism.get(cp.id) ?? 0;
      const coverage = clamp(flash + ATHLETIC_COVERAGE_WEIGHT * athletic, 0, 1);
      return { cp, flash, athletic, coverage };
    })
    .sort((a, b) => b.coverage - a.coverage || (a.cp.id < b.cp.id ? -1 : 1))
    .slice(0, NOTABLE_CLASS_SIZE);

  const observations: CollegePlayerObservation[] = [];
  for (const outlet of Object.values(outlets)) {
    if (outlet.focus !== 'COLLEGE') continue;
    const accuracy = clamp(outlet.accuracySpectrum / 10 + accuracyBoost, 0, 1);
    const hype = clamp(outlet.hypeSpectrum / 10, 0, 1);
    const evaluatorCount = EVALUATORS_BY_TIER[outlet.tier] ?? 2;
    const outletPrng = prng.fork(`outlet:${outlet.id}`);

    for (let e = 0; e < evaluatorCount; e++) {
      const evalPrng = outletPrng.fork(`e${e}`);
      const evaluatorId = ScoutId(`${outlet.id}::e${e}`);
      // Each evaluator files on the top `reads` of the notable class —
      // the names the media obsesses over.
      const targets = notable.slice(0, reads);
      for (const { cp, flash, athletic } of targets) {
        // Hype inflates the big names (pedigree/talent) AND the combine
        // freaks; both are hype-scaled, so an honest outlet reads near
        // truth while a hype outlet crowns the workout warrior.
        const hypeBias = hype * (HYPE_MAX_BIAS * flash + COMBINE_HYPE_BIAS * athletic);
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

/**
 * Map a coverage "level" (0 = preseason whispers, 1 = the final pre-draft
 * sweep) to a round's reads + accuracy boost. Coverage broadens and
 * sharpens as the draft nears, so the board firms up over the year.
 */
export function mediaCoverageForLevel(level: number): MediaCoverageOptions {
  const l = clamp(level, 0, 1);
  return {
    readsPerEvaluator: Math.round(18 + l * 32), // 18 → 50
    accuracyBoost: l * 0.12, // 0 → +0.12
  };
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
