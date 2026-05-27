import type { Prng } from '../prng/index.js';
import type {
  CollegePlayer,
  CollegePlayerObservation,
  CombineMeasurables,
  CharacterFlag,
} from '../types/college.js';
import type { PlayerId } from '../types/ids.js';

/**
 * NFL Combine invite cap. The real combine invites ~320-340 prospects
 * each year, and every one of them is already on teams' radar — the
 * combine refines the read on known prospects, it does NOT discover
 * unknowns. So invitations go to the top declared prospects by current
 * scouting stock; a prospect with no scouting reads isn't invited (and
 * therefore can't vault onto a board off a workout alone).
 */
export const COMBINE_INVITE_CAP = 330;

/**
 * Pick the combine field: the top `max` declared, draft-eligible
 * prospects ranked by confidence-weighted observed grade across all
 * accumulated scouting observations. Prospects with zero reads are not
 * invited. Deterministic (stable id tiebreak); pure.
 */
export function selectCombineInvitees(
  collegePool: readonly CollegePlayer[],
  observations: readonly CollegePlayerObservation[],
  max: number = COMBINE_INVITE_CAP,
): CollegePlayer[] {
  const agg = new Map<PlayerId, { wsum: number; csum: number }>();
  for (const obs of observations) {
    let sSum = 0;
    let sN = 0;
    let cSum = 0;
    let cN = 0;
    for (const v of Object.values(obs.skills)) {
      if (typeof v === 'number') {
        sSum += v;
        sN += 1;
      }
    }
    for (const v of Object.values(obs.confidence)) {
      if (typeof v === 'number') {
        cSum += v;
        cN += 1;
      }
    }
    const overall = sN > 0 ? sSum / sN : 0;
    const conf = cN > 0 ? cSum / cN : 0;
    if (conf <= 0) continue;
    const cur = agg.get(obs.collegePlayerId) ?? { wsum: 0, csum: 0 };
    cur.wsum += overall * conf;
    cur.csum += conf;
    agg.set(obs.collegePlayerId, cur);
  }

  return collegePool
    .filter((cp) => cp.isDraftEligible && cp.hasDeclared && (agg.get(cp.id)?.csum ?? 0) > 0)
    .map((cp) => {
      const a = agg.get(cp.id)!;
      return { cp, grade: a.wsum / a.csum };
    })
    .sort((a, b) => b.grade - a.grade || (a.cp.id < b.cp.id ? -1 : a.cp.id > b.cp.id ? 1 : 0))
    .slice(0, max)
    .map((r) => r.cp);
}

/**
 * Per-drill measurement noise — combine is precisely measured, so
 * these are TIGHT. The combine's role is a near-truth reveal of
 * the prospect's `measurables` (ground truth) to every team
 * simultaneously. Scout estimates carry much larger noise — that's
 * the workout-warrior / tape-star tension surfacing at the combine.
 */
const NOISE = {
  height: 0.2,    // inches
  weight: 1.0,    // lbs
  arm: 0.1,       // inches
  hand: 0.1,      // inches
  forty: 0.03,    // seconds
  bench: 1.0,     // reps
  vert: 0.5,      // inches
  broad: 2.0,     // inches
  cone: 0.05,     // seconds
  shuttle: 0.04,  // seconds
};

/**
 * Drills classified as "speed/explosion" — the riskiest for prospects
 * to run because a bad number is hard to walk back. TAPE_STAR_POOR_TESTER
 * types skip these at higher rates.
 */
const SPEED_DRILLS = new Set(['forty', 'vert', 'broad', 'cone', 'shuttle']);

export interface RollCombineResultsOptions {
  prng: Prng;
  prospect: CollegePlayer;
  measuredOnTick: number;
}

/**
 * Generate one prospect's combine results. Universal physical
 * measurements (height/weight/arm/hand/bench) are reported with
 * small noise; per-drill participation is rolled per drill based
 * on character flags + recruiting profile.
 *
 * Skip-rate model:
 *   - Base 20% chance per drill that a prospect opts out (Doc 3:
 *     "Prospects independently decide whether to participate").
 *   - WORKOUT_WARRIOR → 0% skip on every drill (they live for this).
 *   - TAPE_STAR_POOR_TESTER → 50% skip on speed/explosion drills.
 *   - INJURY_PRONE → +10% skip on every drill.
 *   - 5-star + PEDIGREE → +10% skip overall (top picks have little
 *     to gain).
 *
 * `attended: false` is reserved for prospects who skip the combine
 * entirely — slice 4 always sets `attended: true` for declared
 * draft-eligible prospects; a future slice can model strategic
 * full-skips.
 */
export function rollCombineResults(options: RollCombineResultsOptions): CombineMeasurables {
  const { prng, prospect, measuredOnTick } = options;
  const flags = new Set<CharacterFlag>(prospect.characterFlags);
  const truth = prospect.measurables;

  const skipDrill = (drill: string): boolean => {
    if (flags.has('WORKOUT_WARRIOR')) return false;
    let p = 0.20;
    if (flags.has('TAPE_STAR_POOR_TESTER') && SPEED_DRILLS.has(drill)) p = 0.50;
    if (flags.has('INJURY_PRONE')) p += 0.10;
    if (prospect.recruiting.starRating === 5 && prospect.recruiting.background === 'PEDIGREE') {
      p += 0.10;
    }
    return prng.next() < p;
  };

  // Height/weight/arm/hand are part of the medical/measurement
  // intake — every attending prospect gets these. They never skip
  // (you walk in, you get measured).
  const result: CombineMeasurables = {
    attended: true,
    heightInches: round1(truth.heightInches + prng.normal(0, NOISE.height)),
    weightLbs: Math.round(truth.weightLbs + prng.normal(0, NOISE.weight)),
    armLengthInches: round1(truth.armLengthInches + prng.normal(0, NOISE.arm)),
    handSizeInches: round1(truth.handSizeInches + prng.normal(0, NOISE.hand)),
    measuredOnTick,
  };

  // Per-drill participation.
  if (!skipDrill('forty')) {
    result.fortyYardSeconds = round2(truth.fortyYardSeconds + prng.normal(0, NOISE.forty));
  }
  if (!skipDrill('bench')) {
    result.benchPress225Reps = Math.max(0, Math.round(truth.benchPress225Reps + prng.normal(0, NOISE.bench)));
  }
  if (!skipDrill('vert')) {
    result.verticalInches = round1(truth.verticalInches + prng.normal(0, NOISE.vert));
  }
  if (!skipDrill('broad')) {
    result.broadJumpInches = Math.round(truth.broadJumpInches + prng.normal(0, NOISE.broad));
  }
  if (!skipDrill('cone')) {
    result.threeConeSeconds = round2(truth.threeConeSeconds + prng.normal(0, NOISE.cone));
  }
  if (!skipDrill('shuttle')) {
    result.shuttleSeconds = round2(truth.shuttleSeconds + prng.normal(0, NOISE.shuttle));
  }

  return result;
}

/**
 * Run the combine for the entire pool — every draft-eligible
 * declared prospect attends. Deterministic for a given (prng, pool, tick).
 *
 * Returns the new combineResults map (not the league) so callers can
 * fold it in as they see fit. For slice 4 the caller is `createLeague`
 * (initial) or `advanceSeason` (per-cycle), both of which produce a
 * complete map — there's no "merge with prior combine" because each
 * combine is a fresh sweep of the current pool.
 *
 * Note: slice 4 treats all draft-eligible prospects as effectively
 * declared (the `hasDeclared` flag is always false in current code
 * — the future draft-event slice will flip it). For now we run the
 * combine for every draft-eligible prospect regardless of declaration,
 * matching the underlying intent: "if you might be drafted, you go
 * to the combine."
 */
export function runCombine(
  prng: Prng,
  collegePool: readonly CollegePlayer[],
  measuredOnTick: number,
): Record<PlayerId, CombineMeasurables> {
  const out: Record<PlayerId, CombineMeasurables> = {} as Record<PlayerId, CombineMeasurables>;
  for (const prospect of collegePool) {
    if (!prospect.isDraftEligible) continue;
    const prospectPrng = prng.fork(`combine:${prospect.id}`);
    out[prospect.id] = rollCombineResults({
      prng: prospectPrng,
      prospect,
      measuredOnTick,
    });
  }
  return out;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
