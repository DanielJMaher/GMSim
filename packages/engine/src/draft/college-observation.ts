import type { Prng } from '../prng/index.js';
import type { CollegeScout, CollegePlayer, CollegePlayerObservation, ScoutRegion } from '../types/college.js';
import type { Player, PlayerSkills } from '../types/player.js';
import type { TeamId } from '../types/ids.js';
import { STATE_TO_REGION } from '../types/college.js';
import { COLLEGE_SCHOOLS } from '../data/colleges/index.js';
import { positionGroupFor } from '../players/position-group.js';
import { composedQuirkEffect } from '../scouting/quirks.js';

const SCHOOL_BY_ID = new Map(COLLEGE_SCHOOLS.map((s) => [s.id, s] as const));

/** Number of college prospects each scout assesses in a sweep cycle. */
const OBSERVATIONS_PER_SCOUT = 6;

/**
 * Base noise stdev (in raw 0..100 skill points) at zero accuracy.
 * Higher than NFL's 15 — college evaluation is harder (less film,
 * less data, prospect still developing). Scaled by
 * `(1 - scout.trueAccuracy[group])` so a perfect scout reads true
 * skills cleanly and a floor-accuracy scout's reads are dominated
 * by noise.
 */
const BASE_NOISE_STDEV = 18;

/**
 * Regional accuracy bonus when scout's `preferredRegion` matches the
 * prospect's hometown OR school state. Modest — 0.06 — so the bonus
 * is felt across many observations but doesn't dominate base accuracy.
 */
const REGIONAL_ACCURACY_BONUS = 0.06;

const PLAYER_SKILL_KEYS: readonly (keyof PlayerSkills)[] = [
  'speed', 'acceleration', 'agility', 'strength', 'durability',
  'technicalSkill', 'footballIq', 'decisionMaking', 'handsBallSkills',
  'blockingTechnique', 'passRushTechnique', 'coverageTechnique',
  'tacklingTechnique', 'leadership', 'competitiveness', 'workEthic',
  'coachability', 'composure',
];

/**
 * Generate one league-wide sweep of college observations. Every
 * scout on every team produces ~`OBSERVATIONS_PER_SCOUT` reports
 * on prospects whose **projected NFL position group** matches the
 * scout's `knownSpecialty`. Sampled with a regional bias — scouts
 * are likelier to evaluate prospects in their preferred region.
 *
 * Used both at league creation (initial sweep) and from the
 * advanceCollegeScoutingCycle primitive (per-season refresh).
 */
export function generateInitialCollegeObservations(
  prng: Prng,
  scoutsByTeam: Readonly<Record<TeamId, readonly CollegeScout[]>>,
  collegePool: readonly CollegePlayer[],
  observedOnTick: number,
): CollegePlayerObservation[] {
  const observations: CollegePlayerObservation[] = [];

  // Pre-bucket prospects by projected NFL position group + region
  // so per-scout sampling is fast at 32-team scale.
  const byGroup = bucketByPositionGroup(collegePool);

  for (const teamId of Object.keys(scoutsByTeam) as TeamId[]) {
    const scouts = scoutsByTeam[teamId] ?? [];
    for (const scout of scouts) {
      const scoutPrng = prng.fork(`cobs:${scout.id}`);
      const candidates = byGroup.get(scout.knownSpecialty) ?? [];
      if (candidates.length === 0) continue;

      const targets = sampleByRegion(
        scoutPrng.fork('sample'),
        candidates,
        scout.preferredRegion,
        Math.min(OBSERVATIONS_PER_SCOUT, candidates.length),
      );

      for (const target of targets) {
        observations.push(
          generateCollegeObservation(
            scoutPrng.fork(`p:${target.id}`),
            scout,
            target,
            observedOnTick,
          ),
        );
      }
    }
  }

  return observations;
}

export function generateCollegeObservation(
  prng: Prng,
  scout: CollegeScout,
  prospect: CollegePlayer,
  observedOnTick: number,
): CollegePlayerObservation {
  const projectedGroup = positionGroupFor(prospect.nflProjectedPosition);
  const baseAccuracy = scout.trueAccuracy[projectedGroup] ?? 0.4;
  const regionalBonus = regionalBonusForProspect(scout.preferredRegion, prospect);
  const accuracy = clampUnit(baseAccuracy + regionalBonus);

  const skills: Partial<Record<keyof PlayerSkills, number>> = {};
  const confidence: Partial<Record<keyof PlayerSkills, number>> = {};

  for (const skill of PLAYER_SKILL_KEYS) {
    const trueValue = prospect.current[skill];
    // The NFL quirk pool reads from `Player`-shaped fields. The
    // CollegePlayer mirrors PlayerSkills + tier + experience, but
    // not all the NFL fields the quirks read (career awards, mood
    // archetype, etc.). For slice 2 we apply quirks against a
    // `Player`-compatible projection of the prospect — see helper.
    const playerLike = collegeProspectAsPlayerLike(prospect);
    const quirk = composedQuirkEffect(scout.quirks, playerLike, skill);
    const noiseStdev = BASE_NOISE_STDEV * (1 - accuracy) * quirk.noiseMultiplier;
    const observed = clampSkill(trueValue + prng.normal(0, noiseStdev) + quirk.bias);
    const skillConfidence = clampUnit(accuracy + quirk.confidenceDelta);
    skills[skill] = Math.round(observed);
    confidence[skill] = Number(skillConfidence.toFixed(2));
  }

  return {
    scoutId: scout.id,
    collegePlayerId: prospect.id,
    observedOnTick,
    skills,
    confidence,
  };
}

/**
 * Bucket the college pool by projected NFL position group. Scouts
 * evaluate prospects through the lens of where they'll line up in
 * the NFL, not where they currently play in college — this is the
 * conversion-candidate axis from Doc 3 manifesting in the scout's
 * focus.
 */
function bucketByPositionGroup(
  collegePool: readonly CollegePlayer[],
): Map<string, CollegePlayer[]> {
  const buckets = new Map<string, CollegePlayer[]>();
  for (const cp of collegePool) {
    const group = positionGroupFor(cp.nflProjectedPosition);
    let bucket = buckets.get(group);
    if (!bucket) {
      bucket = [];
      buckets.set(group, bucket);
    }
    bucket.push(cp);
  }
  return buckets;
}

/**
 * Return regional accuracy bonus if scout's preferred region covers
 * either the prospect's hometown or their school. NATIONAL scouts
 * get no bonus but no penalty either.
 */
function regionalBonusForProspect(region: ScoutRegion, prospect: CollegePlayer): number {
  if (region === 'NATIONAL') return 0;
  const hometownRegion = STATE_TO_REGION[prospect.recruiting.hometown.state];
  if (hometownRegion === region) return REGIONAL_ACCURACY_BONUS;
  const school = SCHOOL_BY_ID.get(prospect.schoolId);
  if (school) {
    const schoolRegion = STATE_TO_REGION[school.state];
    if (schoolRegion === region) return REGIONAL_ACCURACY_BONUS;
  }
  return 0;
}

/**
 * Sample `k` prospects with a 70% bias toward the scout's preferred
 * region. NATIONAL scouts sample uniformly. The bias is intentional
 * but soft — scouts still cover off-region prospects, they just see
 * more in-region ones (matching real college-scouting deployment
 * patterns).
 */
function sampleByRegion(
  prng: Prng,
  candidates: readonly CollegePlayer[],
  region: ScoutRegion,
  k: number,
): CollegePlayer[] {
  if (region === 'NATIONAL' || candidates.length === 0) {
    return sampleWithoutReplacement(prng, candidates, k);
  }
  const inRegion: CollegePlayer[] = [];
  const offRegion: CollegePlayer[] = [];
  for (const cp of candidates) {
    if (regionalBonusForProspect(region, cp) > 0) inRegion.push(cp);
    else offRegion.push(cp);
  }
  // 70/30 split, with fallback to whichever bucket has candidates if
  // one is empty.
  const inCount = Math.min(inRegion.length, Math.round(k * 0.7));
  const offCount = Math.min(offRegion.length, k - inCount);
  // If we couldn't fill `k` because of skewed buckets, top up from
  // the other side.
  const remaining = k - inCount - offCount;
  let extra: CollegePlayer[] = [];
  if (remaining > 0) {
    if (inRegion.length > inCount) {
      extra = sampleWithoutReplacement(prng.fork('extra-in'), inRegion.slice(inCount), remaining);
    } else if (offRegion.length > offCount) {
      extra = sampleWithoutReplacement(prng.fork('extra-off'), offRegion.slice(offCount), remaining);
    }
  }
  const inSample = sampleWithoutReplacement(prng.fork('in'), inRegion, inCount);
  const offSample = sampleWithoutReplacement(prng.fork('off'), offRegion, offCount);
  return [...inSample, ...offSample, ...extra];
}

function sampleWithoutReplacement<T>(prng: Prng, items: readonly T[], k: number): T[] {
  const arr = [...items];
  const n = arr.length;
  const limit = Math.min(k, n);
  for (let i = 0; i < limit; i++) {
    const j = i + prng.nextInt(n - i);
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr.slice(0, limit);
}

/**
 * The NFL `quirkEffect` reads from `Player`-shaped fields
 * (`careerAwards`, `experienceYears`, `tier`, etc.). Project
 * a `CollegePlayer` into the minimal `Player`-like shape those
 * effects need so we can reuse the same quirk pool without
 * duplication.
 *
 * Notes:
 *   - `careerAwards` is empty for college players (no NFL awards yet),
 *     so OVERVALUES_NAME_RECOGNITION effectively no-ops on prospects.
 *   - `experienceYears` is 0 (treating prospects as pre-NFL rookies),
 *     so YOUNG_PLAYER_BIAS fires for everyone — appropriate.
 *   - `tier` carries through directly so SHARP_ON_ROLE_PLAYERS and
 *     PRACTICE_SQUAD_GEM_HUNTER fire on FRINGE-tier prospects.
 */
function collegeProspectAsPlayerLike(prospect: CollegePlayer): Player {
  // The quirk pool reads `tier`, `experienceYears`, and `careerAwards`
  // off the player. We provide just those plus the skill fields the
  // surrounding observation loop reads. The remaining `Player` fields
  // are filled with zero/empty values that the quirks never consult,
  // so the cast is sound for this call site.
  return {
    id: prospect.id,
    current: prospect.current,
    ceiling: prospect.ceiling,
    tier: prospect.tier,
    experienceYears: 0,
    careerAwards: [],
  } as unknown as Player;
}

function clampSkill(v: number): number {
  return Math.max(0, Math.min(100, v));
}

function clampUnit(v: number): number {
  return Math.max(0, Math.min(1, v));
}
