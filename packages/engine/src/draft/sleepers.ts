/**
 * Scout sleepers (v0.68) — each scout's personal "I love this guy"
 * prospects, the mechanic behind real board divergence.
 *
 * Every scout, each pre-draft cycle, rolls 3–5 sleepers and produces
 * optimistic, high-conviction observations of them — so their team's
 * board ranks those prospects above consensus. Two channels feed the
 * roll, both gated by a *real* signal so conviction is earned (a scout
 * never hypes a no-tools, no-production prospect):
 *
 *   TAPE        — a genuinely good player overlooked because of a small
 *                 school / low profile (high true talent + production,
 *                 low visibility). "I watched him, he can play."
 *   MEASURABLES — an elite athletic workout even when the production
 *                 wasn't there (top combine measurables + low
 *                 production). "You can't teach a 4.3 and a 40-inch
 *                 vert." Higher bust risk — whether it translates rides
 *                 on the scout's accuracy (low-accuracy scouts produce
 *                 the workout-warrior bust / false-flag).
 *
 * The love magnitude is bounded by the winning signal's strength, so a
 * limited prospect can't be inflated into a blue-chipper. Selection is
 * weighted by `worthiness`, so scrubs are essentially never picked.
 *
 * Pure + deterministic: `buildSleeperProfiles` is computed once per
 * cycle (pool-wide), then `selectScoutSleepers` samples per scout off a
 * forked PRNG. Tuning knobs are the constants below.
 */

import type { Prng } from '../prng/index.js';
import type {
  CollegePlayer,
  CollegeScout,
  CombineMeasurables,
  ConferenceTier,
} from '../types/college.js';
import type { CollegeSeasonStatLine } from '../types/college-season.js';
import type { PlayerId } from '../types/ids.js';
import { COLLEGE_SCHOOLS } from '../data/colleges/index.js';
import { positionGroupFor } from '../players/position-group.js';

export type SleeperChannel = 'TAPE' | 'MEASURABLES';

export interface SleeperProfile {
  prospectId: PlayerId;
  channel: SleeperChannel;
  /** Selection weight — how compelling a sleeper this prospect is. */
  worthiness: number;
  /** Optimism bias (skill points) applied to a believer's observation. */
  love: number;
  /** Projected NFL position group, for scout-specialty weighting. */
  positionGroup: string;
}

export interface SleeperPick {
  prospectId: PlayerId;
  channel: SleeperChannel;
  love: number;
}

// ── Tuning knobs ────────────────────────────────────────────────────────
const MIN_SLEEPERS = 3;
const MAX_SLEEPERS = 5;
const WORTHINESS_FLOOR = 0.18; // below this, a prospect is never a sleeper
const LOVE_MIN = 5; // skill-point optimism for a marginal sleeper
const LOVE_MAX = 14; // for a maximal-signal sleeper
const SPECIALTY_WEIGHT = 1.6; // boost for prospects in the scout's specialty
/** Confidence bonus on a sleeper observation — the scout is sure. */
export const SLEEPER_CONFIDENCE_BONUS = 0.15;

const SCHOOL_VISIBILITY: Record<ConferenceTier, number> = {
  POWER: 1.0,
  GROUP_OF_5: 0.55,
  FCS: 0.3,
  SMALL: 0.15,
};

const TIER_TALENT: Record<string, number> = {
  STAR: 1.0,
  STARTER: 0.72,
  BACKUP: 0.45,
  FRINGE: 0.2,
};

const SCHOOL_TIER_BY_ID = new Map<string, ConferenceTier>(
  COLLEGE_SCHOOLS.map((s) => [s.id, s.tier] as const),
);

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function meanCurrent(cp: CollegePlayer): number {
  const vals = Object.values(cp.current) as number[];
  if (vals.length === 0) return 0;
  let sum = 0;
  for (const v of vals) sum += v;
  return sum / vals.length / 100; // → 0..1
}

/** A scalar production score from a prospect's season line. */
function productionRaw(line: CollegeSeasonStatLine | undefined): number {
  if (!line) return 0;
  return (
    line.passingYards * 0.5 +
    line.rushingYards +
    line.receivingYards +
    (line.passingTds + line.rushingTds + line.receivingTds) * 30 +
    line.sacks * 40 +
    line.interceptions * 40 +
    line.tackles * 5
  );
}

/**
 * Per-prospect athleticism, 0..1, as the mean drill percentile within
 * the combine field (lower-is-better drills inverted). Non-attendees
 * and prospects without combine data score 0.
 */
function computeAthleticism(
  eligible: readonly CollegePlayer[],
  combine: Readonly<Record<string, CombineMeasurables>>,
): Map<PlayerId, number> {
  type Drill = { key: keyof CombineMeasurables; lowerBetter: boolean };
  const drills: Drill[] = [
    { key: 'fortyYardSeconds', lowerBetter: true },
    { key: 'verticalInches', lowerBetter: false },
    { key: 'broadJumpInches', lowerBetter: false },
    { key: 'benchPress225Reps', lowerBetter: false },
    { key: 'threeConeSeconds', lowerBetter: true },
    { key: 'shuttleSeconds', lowerBetter: true },
  ];

  // Sorted value lists per drill (attendees only) for percentile lookup.
  const sortedByDrill = new Map<string, number[]>();
  for (const d of drills) {
    const vals: number[] = [];
    for (const cp of eligible) {
      const m = combine[cp.id];
      const v = m?.attended ? (m[d.key] as number | undefined) : undefined;
      if (typeof v === 'number') vals.push(v);
    }
    vals.sort((a, b) => a - b);
    sortedByDrill.set(d.key, vals);
  }

  const athleticism = new Map<PlayerId, number>();
  for (const cp of eligible) {
    const m = combine[cp.id];
    if (!m?.attended) {
      athleticism.set(cp.id, 0);
      continue;
    }
    let sum = 0;
    let n = 0;
    for (const d of drills) {
      const v = m[d.key] as number | undefined;
      if (typeof v !== 'number') continue;
      const sorted = sortedByDrill.get(d.key)!;
      if (sorted.length < 2) continue;
      // Percentile = fraction of the field this value beats.
      const below = lowerBound(sorted, v);
      let pct = below / (sorted.length - 1);
      if (d.lowerBetter) pct = 1 - pct;
      sum += clamp01(pct);
      n += 1;
    }
    athleticism.set(cp.id, n > 0 ? sum / n : 0);
  }
  return athleticism;
}

function lowerBound(sorted: readonly number[], v: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Compute the league-wide sleeper profile for every draft-eligible,
 * declared prospect. Called once per pre-draft cycle; scouts then sample
 * from it.
 */
export function buildSleeperProfiles(
  pool: readonly CollegePlayer[],
  combineResults: Readonly<Record<string, CombineMeasurables>>,
  seasonStats: readonly CollegeSeasonStatLine[],
): Map<PlayerId, SleeperProfile> {
  const eligible = pool.filter((cp) => cp.isDraftEligible && cp.hasDeclared);

  const statByPlayer = new Map<PlayerId, CollegeSeasonStatLine>();
  for (const line of seasonStats) statByPlayer.set(line.playerId, line);

  // Normalize production across the field.
  let maxProd = 1;
  for (const cp of eligible) {
    const p = productionRaw(statByPlayer.get(cp.id));
    if (p > maxProd) maxProd = p;
  }

  const athleticism = computeAthleticism(eligible, combineResults);

  const profiles = new Map<PlayerId, SleeperProfile>();
  for (const cp of eligible) {
    const tierTalent = TIER_TALENT[cp.tier] ?? 0.4;
    const trueTalent = clamp01(0.6 * tierTalent + 0.4 * meanCurrent(cp));
    const visibility = SCHOOL_VISIBILITY[SCHOOL_TIER_BY_ID.get(cp.schoolId) ?? 'GROUP_OF_5'];
    const underVisibility = 1 - visibility;
    const production = clamp01(productionRaw(statByPlayer.get(cp.id)) / maxProd);
    const athletic = athleticism.get(cp.id) ?? 0;

    // TAPE: good + productive + overlooked. MEASURABLES: freak athlete +
    // thin production + (somewhat) under the radar.
    const tapeSignal = trueTalent * underVisibility * (0.4 + 0.6 * production);
    const measurablesSignal = athletic * (1 - production) * (0.4 + 0.6 * underVisibility);

    const worthiness = Math.max(tapeSignal, measurablesSignal);
    if (worthiness < WORTHINESS_FLOOR) continue;

    const channel: SleeperChannel = tapeSignal >= measurablesSignal ? 'TAPE' : 'MEASURABLES';
    const signalStrength = channel === 'TAPE' ? trueTalent : athletic;
    const love = LOVE_MIN + (LOVE_MAX - LOVE_MIN) * clamp01(signalStrength);

    profiles.set(cp.id, {
      prospectId: cp.id,
      channel,
      worthiness,
      love,
      positionGroup: positionGroupFor(cp.nflProjectedPosition),
    });
  }
  return profiles;
}

/**
 * Roll one scout's 3–5 sleepers — a `worthiness`-weighted sample,
 * nudged toward the scout's specialty so different scouts surface
 * different gems (and a DB scout finds DB sleepers).
 */
export function selectScoutSleepers(
  prng: Prng,
  scout: CollegeScout,
  profiles: ReadonlyMap<PlayerId, SleeperProfile>,
): SleeperPick[] {
  const pool = [...profiles.values()];
  if (pool.length === 0) return [];

  const count = Math.min(
    pool.length,
    MIN_SLEEPERS + prng.nextInt(MAX_SLEEPERS - MIN_SLEEPERS + 1),
  );

  const weighted = pool.map((p) => ({
    profile: p,
    weight:
      p.worthiness * (p.positionGroup === scout.knownSpecialty ? SPECIALTY_WEIGHT : 1),
  }));

  const picks: SleeperPick[] = [];
  for (let i = 0; i < count && weighted.length > 0; i++) {
    const total = weighted.reduce((s, w) => s + w.weight, 0);
    if (total <= 0) break;
    let r = prng.next() * total;
    let idx = 0;
    for (; idx < weighted.length; idx++) {
      r -= weighted[idx]!.weight;
      if (r <= 0) break;
    }
    if (idx >= weighted.length) idx = weighted.length - 1;
    const chosen = weighted.splice(idx, 1)[0]!;
    picks.push({
      prospectId: chosen.profile.prospectId,
      channel: chosen.profile.channel,
      love: chosen.profile.love,
    });
  }
  return picks;
}
