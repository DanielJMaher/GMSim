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
import type { PlayerId } from '../types/ids.js';
import { ScoutId } from '../types/ids.js';
import { COLLEGE_SCHOOLS } from '../data/colleges/index.js';
import { computeCombineAthleticism } from '../draft/athleticism.js';
import { positionGroupFor } from '../players/position-group.js';
import { PROSPECT_PROJECTION } from '../draft/college-observation.js';

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
/** Base read noise stdev at zero accuracy (mirrors the college scout base). */
const BASE_NOISE_STDEV = 18;

/**
 * Media read model (v0.88 recalibration). The media is a USEFUL data point
 * that mostly tracks reality, not a false-flag machine. An outlet's read is
 * truth + accuracy noise + a small **signed optimism lean**:
 *
 *   - `outletOptimism` maps hypeSpectrum to a signed lean in ~[-1, +1]
 *     centered on a neutral (~5.5) outlet, so optimists read a touch HIGH,
 *     skeptics read a touch LOW, and the multi-outlet CONSENSUS lands near
 *     truth (it no longer floats everyone up).
 *   - the lean is larger on flashy / established prospects (pedigree +
 *     talent) and on combine risers — optimists amplify the names everyone
 *     already likes, they don't invent scrubs.
 *   - on TOP of that, each optimistic outlet hard-champions a few stable,
 *     idiosyncratic "darlings" (`DARLING_BONUS`) — the rare 1-of-N outlet
 *     pushing a mid prospect toward the 1st round. Bounded + uncommon.
 *
 * Magnitudes are small so the consensus mostly matches the real board and a
 * sharp (high-accuracy, neutral-hype) outlet reads close to truth — i.e.
 * listening to a good outlet pays off.
 */
const HYPE_BASE_GAIN = 2; // optimism lean independent of flashiness
const HYPE_FLASH_GAIN = 4; // extra optimism lean on flashy/established prospects
const COMBINE_LEAN_GAIN = 4; // optimist's extra lean on a combine riser
const DARLING_BONUS = 15; // the rare hard over-hype, on an outlet's few darlings
const DARLING_MAX = 3; // most darlings a (max-optimist) outlet champions
/** Coverage weight of combine athleticism (who the media TALKS about; the
 * combine is public so this is outlet-independent). Read bias is separate. */
const ATHLETIC_COVERAGE_WEIGHT = 0.35;

/**
 * Shared per-prospect misread (v0.91). Pooling many outlets' reads makes the
 * media CONSENSUS near-perfect (idiosyncratic noise averages out), which made
 * "listening to the media" a cheat code. Real draft media share a common read
 * off the same tape — and that shared read is sometimes simply wrong on a
 * guy. This adds one stable, prospect-specific offset applied identically to
 * EVERY outlet's evaluators, so it does NOT average away — it caps consensus
 * accuracy at a realistic level (~0.92 rank-corr vs ~0.97 before) while
 * leaving each outlet's relative reliability intact. Deterministic + stable
 * across rounds (seeded off the prospect id), so it adds no week-to-week
 * jitter; it reads as a persistent media blind spot you can learn. Tuning
 * knob — raise to make the consensus less accurate.
 */
const SHARED_MISREAD_STDEV = 2.0;

/**
 * Per-outlet UNCERTAINTY DISAGREEMENT (2026-06-03, the Ombudsman fix). Real
 * draft media barely disagree on blue-chips (everyone has Trevor Lawrence #1)
 * but disagree WILDLY down-board (a Day-2 guy is one outlet's 1st-rounder and
 * another's 5th) — the spread-by-tier gradient explodes ~6.6x from the top-10 to
 * the mid-board. This adds a stable, idiosyncratic per-(outlet, prospect) lean
 * whose magnitude SCALES WITH the prospect's uncertainty — ~0 on a true
 * blue-chip, full on a fringe mid-rounder — so outlets converge at the top and
 * scatter down-board. Keyed off true ceiling + a hash of (outlet, id):
 * deterministic and round-stable.
 *
 * v0.116 — the rank-perturbation fix. Two pieces keep the spread in the
 * mid-board instead of leaking up into the top tier:
 *   1. The media grades PROJECTED ability (see generateMediaObservation), so
 *      blue-chip grades genuinely SEPARATE from the mid-board (after Lever 3's
 *      steeper pyramid). Without this the read was flat rookie `current` and a
 *      mid's swing reached the top.
 *   2. The lean is CAPPED (`LEAN_CAP`) BELOW the blue-chip↔mid grade gap, so a
 *      contested mid scatters densely among other mids but hits a wall it can't
 *      cross into the blue-chip tier — a bounded RANK perturbation expressed in
 *      grade space. Blue-chips also carry uncertainty 0 (no lean), so the cap
 *      mainly bounds the mids while the top LOCKS hard.
 * Result (`run ombudsman`): top-10 spread ~2.4 ≈ real 2.8 — the media now
 * genuinely AGREES on the obvious blue-chips (was ~3.6, disagreeing on locks);
 * 11-32 ≈ real (9.3 vs 8.5). The deep mid-board (33-64) spread stays ~8 (real
 * 18.6): a hard limit of the spread-BY-CONSENSUS-TIER metric, not the model — a
 * contested mid with genuinely high spread no longer has a stable consensus
 * rank, so he leaves the 33-64 bin (binning self-selection). Underlying behavior
 * (locks lock, mids contested) is correct; the measured gradient tops ~3.2x.
 */
const OUTLET_DISAGREEMENT_STDEV = 24;
/** Max grade-points the lean can move a prospect — the "wall" that keeps a
 *  contested mid from leaping into the blue-chip tier. Set below the projected
 *  blue-chip↔mid gap (~10 after Lever 3). The single knob the gradient is most
 *  sensitive to. */
const LEAN_CAP = 10;
/** Ceiling-overall band mapping a prospect's TRUE ceiling to [lock, contested].
 *  ≥ HI is a media lock (uncertainty 0); ≤ LO is maximally contested
 *  (uncertainty 1). Anchored to the Lever-3 pyramid (blue-chip ceiling ~88+,
 *  mid-board ~78). Tuned vs `run ombudsman`. */
const UNCERTAINTY_CEIL_HI = 88;
const UNCERTAINTY_CEIL_LO = 74;

/** 0 (lock) … 1 (contested), from the prospect's true ceiling mean. Blue-chips
 *  genuinely ARE the obvious ones, so this is keyed off ground truth. */
function prospectUncertainty(cp: CollegePlayer): number {
  const vals = Object.values(cp.ceiling) as number[];
  if (vals.length === 0) return 1;
  let s = 0;
  for (const v of vals) s += v;
  const ceilMean = s / vals.length;
  return clamp(
    (UNCERTAINTY_CEIL_HI - ceilMean) / (UNCERTAINTY_CEIL_HI - UNCERTAINTY_CEIL_LO),
    0,
    1,
  );
}

/**
 * Stable idiosyncratic per-(outlet, prospect) read lean, ~N(0, σ·uncertainty).
 * Shared by all of an outlet's evaluators (it's the OUTLET's take on the guy),
 * so it shifts the whole outlet's read and shows up as inter-outlet spread —
 * scaled so blue-chips barely move and mid-rounders scatter.
 */
function outletProspectLean(outletId: string, cp: CollegePlayer): number {
  const u = prospectUncertainty(cp);
  if (u <= 0 || OUTLET_DISAGREEMENT_STDEV <= 0) return 0;
  const id = cp.id as string;
  const u1 = (fnv1a(`olean1:${outletId}:${id}`) + 1) / 4294967297;
  const u2 = (fnv1a(`olean2:${outletId}:${id}`) + 1) / 4294967297;
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  // Capped BELOW the projected blue-chip↔mid grade gap — the wall that keeps a
  // contested mid scattering among mids instead of leaping into the top tier.
  return clamp(z * OUTLET_DISAGREEMENT_STDEV * u, -LEAN_CAP, LEAN_CAP);
}

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
 * Signed optimism lean for an outlet, ~[-1, +1]. A neutral outlet
 * (hypeSpectrum ~5.5) reads at truth; clickbait outlets lean up, measured
 * outlets lean down. Centering is what keeps the multi-outlet consensus
 * anchored to reality instead of floating everyone up.
 */
function outletOptimism(outlet: MediaOutlet): number {
  return optimismFromHype(outlet.hypeSpectrum);
}

/**
 * Map a hype value (1-10) to a signed optimism lean, ~[-1, +1]. Used both
 * for the outlet headline (darling selection) and per-position-group
 * (v0.89) — an outlet leans up where it's a hype machine, down where it's
 * measured, so the consensus across outlets stays anchored to truth.
 */
function optimismFromHype(hype: number): number {
  return clamp((hype - 5.5) / 4.5, -1, 1);
}

function fnv1a(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Stable per-prospect shared misread, ~N(0, SHARED_MISREAD_STDEV). Two
 * decorrelated hashes → Box-Muller, so it's deterministic and round-stable
 * with no PRNG threading. The whole media keys on the same (sometimes wrong)
 * read of a prospect.
 */
function sharedMisread(id: string): number {
  if (SHARED_MISREAD_STDEV <= 0) return 0;
  const u1 = (fnv1a(`misread1:${id}`) + 1) / 4294967297; // (0, 1)
  const u2 = (fnv1a(`misread2:${id}`) + 1) / 4294967297;
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return z * SHARED_MISREAD_STDEV;
}

/**
 * The few prospects an optimistic outlet hard-champions (the rare big
 * over-hype). Selection is idiosyncratic per outlet (hash of outlet+id) so
 * it's stable across coverage rounds and can land on a mid prospect — the
 * "Day-3 guy this one outlet swears is a first-rounder" take. Skeptical /
 * neutral outlets champion no one.
 */
function darlingSet(
  outlet: MediaOutlet,
  notableIds: readonly string[],
  optimism: number,
): ReadonlySet<string> {
  if (optimism <= 0.3 || notableIds.length === 0) return EMPTY_SET;
  const k = optimism >= 0.8 ? DARLING_MAX : optimism >= 0.55 ? 2 : 1;
  const ranked = [...notableIds].sort(
    (a, b) => fnv1a(`${outlet.id}:${a}`) - fnv1a(`${outlet.id}:${b}`),
  );
  return new Set(ranked.slice(0, k));
}

const EMPTY_SET: ReadonlySet<string> = new Set();

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
  const notableIds = notable.map((n) => n.cp.id as string);

  const observations: CollegePlayerObservation[] = [];
  for (const outlet of Object.values(outlets)) {
    if (outlet.focus !== 'COLLEGE') continue;
    // Darlings are an outlet-wide idiosyncrasy, selected off the headline
    // hype; the per-read accuracy + optimism are resolved per position
    // group (v0.89) so an outlet reads sharply where it's strong and hypes
    // where it isn't.
    const darlings = darlingSet(outlet, notableIds, outletOptimism(outlet));
    const evaluatorCount = EVALUATORS_BY_TIER[outlet.tier] ?? 2;
    const outletPrng = prng.fork(`outlet:${outlet.id}`);

    for (let e = 0; e < evaluatorCount; e++) {
      const evalPrng = outletPrng.fork(`e${e}`);
      const evaluatorId = ScoutId(`${outlet.id}::e${e}`);
      // Each evaluator files on the top `reads` of the notable class —
      // the names the media obsesses over.
      const targets = notable.slice(0, reads);
      for (const { cp, flash, athletic } of targets) {
        const group = positionGroupFor(cp.nflProjectedPosition);
        const accuracy = clamp(outlet.accuracyByGroup[group] / 10 + accuracyBoost, 0, 1);
        const optimism = optimismFromHype(outlet.hypeByGroup[group]);
        // Small SIGNED optimism lean (bigger on flashy + combine risers),
        // plus a rare hard bonus on this outlet's few darlings. Optimists
        // read a touch high, skeptics low; the consensus stays near truth.
        const bias =
          optimism * (HYPE_BASE_GAIN + HYPE_FLASH_GAIN * flash + COMBINE_LEAN_GAIN * athletic) +
          (darlings.has(cp.id as string) ? DARLING_BONUS : 0) +
          sharedMisread(cp.id as string) +
          outletProspectLean(outlet.id, cp);
        observations.push(
          generateMediaObservation(
            evalPrng.fork(`p:${cp.id}`),
            evaluatorId,
            cp,
            accuracy,
            bias,
            observedOnTick,
          ),
        );
      }
    }
  }
  return observations;
}

// ── Weekly in-season coverage (v0.81) ───────────────────────────────────
/**
 * How much positive season form (in skill points) puts a prospect fully
 * on the media's radar — a breakout climbs onto the notable class even
 * from a small school.
 */
const FORM_COVERAGE_FULL = 18;
/** Coverage weight of form, alongside pedigree (flashiness). */
const FORM_COVERAGE_WEIGHT = 0.45;
/** Scales the public form signal into the read bias every outlet applies. */
const FORM_READ_SCALE = 0.7;
/** Cap on the in-season form contribution to a read — bounds how far a hot
 * (or cold) season alone can move a prospect's media grade. */
const FORM_READ_CAP = 8;

/**
 * One round of WEEKLY in-season media observations (v0.81). Unlike the
 * offseason rounds, the in-season media covers the draft-eligible field
 * **before anyone has declared** — outlets project who'll come out — so
 * this filters on `isDraftEligible && !hasReturnedToSchool`, not
 * `hasDeclared`.
 *
 * The read is driven by `formBias` — each prospect's season-to-date,
 * opponent-weighted over/under-performance (see `computeProspectFormBias`).
 * Form moves the board two ways:
 *   - COVERAGE: a hot streak pulls a prospect onto the notable class the
 *     media talks about (a small-schooler balling out gets noticed).
 *     Public production, so outlet-independent.
 *   - READ: every outlet nudges its grade by the (scaled) form — a guy
 *     who's been dominating grades up across the board — and a hype outlet
 *     piles extra onto a hot streak (the buzz machine), so risers climb
 *     loudly on hype boards and only quietly on honest ones.
 *
 * Pre-week-1 / quiet weeks (all form 0) reduce to a pedigree-only read.
 */
export function generateWeeklyMediaObservations(
  prng: Prng,
  outlets: Readonly<Record<string, MediaOutlet>>,
  pool: readonly CollegePlayer[],
  formBias: ReadonlyMap<PlayerId, number>,
  observedOnTick: number,
  options: MediaCoverageOptions = {},
): CollegePlayerObservation[] {
  const reads = options.readsPerEvaluator ?? READS_PER_EVALUATOR;
  const accuracyBoost = options.accuracyBoost ?? 0;

  const eligible = pool.filter((cp) => cp.isDraftEligible && !cp.hasReturnedToSchool);
  if (eligible.length === 0) return [];

  // Notable class: pedigree + how hot they've been. Positive form only —
  // a slumping prospect drops in grade but doesn't earn extra coverage.
  const notable = [...eligible]
    .map((cp) => {
      const flash = flashiness(cp);
      const form = formBias.get(cp.id) ?? 0;
      const formNorm = clamp(form / FORM_COVERAGE_FULL, 0, 1);
      const coverage = clamp(flash + FORM_COVERAGE_WEIGHT * formNorm, 0, 1);
      return { cp, flash, form, formNorm, coverage };
    })
    .sort((a, b) => b.coverage - a.coverage || (a.cp.id < b.cp.id ? -1 : 1))
    .slice(0, NOTABLE_CLASS_SIZE);
  const notableIds = notable.map((n) => n.cp.id as string);

  const observations: CollegePlayerObservation[] = [];
  for (const outlet of Object.values(outlets)) {
    if (outlet.focus !== 'COLLEGE') continue;
    const darlings = darlingSet(outlet, notableIds, outletOptimism(outlet));
    const evaluatorCount = EVALUATORS_BY_TIER[outlet.tier] ?? 2;
    const outletPrng = prng.fork(`outlet:${outlet.id}`);

    for (let e = 0; e < evaluatorCount; e++) {
      const evalPrng = outletPrng.fork(`e${e}`);
      const evaluatorId = ScoutId(`${outlet.id}::e${e}`);
      const targets = notable.slice(0, reads);
      for (const { cp, flash, form } of targets) {
        const group = positionGroupFor(cp.nflProjectedPosition);
        const accuracy = clamp(outlet.accuracyByGroup[group] / 10 + accuracyBoost, 0, 1);
        const optimism = optimismFromHype(outlet.hypeByGroup[group]);
        // Bounded public-form contribution (a hot/cold season moves the read
        // at most ±FORM_READ_CAP) + a small signed optimism lean + the rare
        // darling bonus. Optimists read high, skeptics low; consensus ~truth.
        const bias =
          clamp(FORM_READ_SCALE * form, -FORM_READ_CAP, FORM_READ_CAP) +
          optimism * (HYPE_BASE_GAIN + HYPE_FLASH_GAIN * flash) +
          (darlings.has(cp.id as string) ? DARLING_BONUS : 0) +
          sharedMisread(cp.id as string) +
          outletProspectLean(outlet.id, cp);
        observations.push(
          generateMediaObservation(
            evalPrng.fork(`p:${cp.id}`),
            evaluatorId,
            cp,
            accuracy,
            bias,
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
  for (const [key, cur] of Object.entries(prospect.current) as [keyof PlayerSkills, number][]) {
    // The media grades PROJECTED NFL ability (the same upside projection the
    // scouts use), so blue-chip grades SEPARATE from the mid-board — the
    // separation the rank-perturbation gradient (LEAN_CAP) rides on. Without it
    // the read was flat rookie `current` and a contested mid's swing reached the
    // top tier, capping the spread gradient.
    const ceil = prospect.ceiling[key] ?? cur;
    const trueValue = cur + PROSPECT_PROJECTION * (ceil - cur);
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
