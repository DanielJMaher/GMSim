import type { Prng } from '../prng/index.js';
import { Prng as PrngClass } from '../prng/index.js';
import type { CollegePlayer, ClassYear, CollegeSchool, CollegeSeasonStats, CollegeInjury } from '../types/college.js';
import type { PlayerId } from '../types/ids.js';
import { COLLEGE_SCHOOLS } from '../data/colleges/index.js';
import { generateCollegePlayer } from './generate-college-player.js';
import { rollCollegeStats } from './college-stats.js';

/**
 * Per-class population sizes. v0.52 bumps ~25% across the board so
 * the declared+eligible cohort (SR + RS_SR + declared JRs) reliably
 * clears the **350-prospect floor** Daniel set for "a real draft
 * class size."
 *
 * Pre-v0.52 sizes produced ~287 declared-eligible (180 SR + 25 RS_SR
 * + ~82 declared JRs at JR_DECLARATION_RATE × 190). v0.52 sizes
 * target ~365 declared (225 SR + 30 RS_SR + ~110 declared JRs at
 * same rate × 250).
 *
 * Pool stays approximately stable across `advanceCollegePool` calls
 * because TRUE_FR inflow (265) closely matches SR + RS_SR outflow
 * (~255). Mid-cohort attrition modeling (transfers, walk-outs,
 * early declarations) is deferred — cohort sizes naturally taper
 * down through the years rather than via per-year attrition rolls.
 *
 *   TRUE_FR (incoming) — set ≈ senior outflow for stability
 *   RS_FR              — reduced (some redshirt, some attrited)
 *   SO                 — further reduced
 *   JR                 — eligible for draft
 *   SR                 — auto-declared
 *   RS_SR              — rare extra-year guys
 */
const CLASS_TARGETS: Record<ClassYear, number> = {
  TRUE_FR: 290,
  RS_FR: 275,
  SO: 270,
  JR: 270,
  SR: 250,
  RS_SR: 35,
};

/**
 * School-tier sampling weights. Roughly 65% Power 5, 25% Group of 5,
 * 8% FCS, 2% small school. Mirrors the realistic NFL talent funnel.
 */
const SCHOOL_TIER_WEIGHTS: ReadonlyArray<{ value: CollegeSchool['tier']; weight: number }> = [
  { value: 'POWER', weight: 65 },
  { value: 'GROUP_OF_5', weight: 25 },
  { value: 'FCS', weight: 8 },
  { value: 'SMALL', weight: 2 },
];

const SCHOOLS_BY_TIER: Record<CollegeSchool['tier'], CollegeSchool[]> = {
  POWER: [],
  GROUP_OF_5: [],
  FCS: [],
  SMALL: [],
};
for (const school of COLLEGE_SCHOOLS) {
  SCHOOLS_BY_TIER[school.tier].push(school);
}

const SCHOOL_BY_ID = new Map(COLLEGE_SCHOOLS.map((s) => [s.id, s] as const));

function pickSchool(prng: Prng): CollegeSchool {
  const tier = prng.weighted(SCHOOL_TIER_WEIGHTS);
  const pool = SCHOOLS_BY_TIER[tier];
  if (pool.length === 0) {
    return SCHOOLS_BY_TIER.POWER[0]!;
  }
  return pool[prng.nextInt(pool.length)]!;
}

/**
 * ~5% of prospects are transfers. Transfer rolls are independent of
 * tier — top recruits and walk-ons both transfer in real life.
 */
function rollIsTransfer(prng: Prng): boolean {
  return prng.next() < 0.05;
}

const CLASS_YEARS: readonly ClassYear[] = ['TRUE_FR', 'RS_FR', 'SO', 'JR', 'SR', 'RS_SR'];

export interface GenerateInitialCollegePoolOptions {
  /** Sim year to anchor birthdates against. Defaults to 2026. */
  simYear?: number;
  /** Stable id prefix for generated college player IDs. */
  idPrefix?: string;
}

/**
 * Generate the league's initial college pool — populated at league
 * creation. Produces approximately 1100 prospects spread across
 * TRUE_FR through RS_SR, sampled across schools by tier-weight.
 *
 * Deterministic for a given (prng, options) pair.
 */
export function generateInitialCollegePool(
  prng: Prng,
  options: GenerateInitialCollegePoolOptions = {},
): readonly CollegePlayer[] {
  const simYear = options.simYear ?? 2026;
  const idPrefix = options.idPrefix ?? 'C0';
  const players: CollegePlayer[] = [];
  let counter = 0;
  for (const classYear of CLASS_YEARS) {
    const target = CLASS_TARGETS[classYear];
    const classPrng = prng.fork(`class:${classYear}`);
    for (let i = 0; i < target; i++) {
      const playerPrng = classPrng.fork(`p:${i}`);
      const school = pickSchool(playerPrng.fork('school'));
      const isTransfer = rollIsTransfer(playerPrng.fork('transfer'));
      const cp = generateCollegePlayer(playerPrng, {
        idSuffix: `${idPrefix}_${classYear}_${counter}`,
        classYear,
        school,
        simYear,
        isTransfer,
      });
      players.push(cp);
      counter++;
    }
  }
  return players;
}

/**
 * Class-year aging map applied each `advanceCollegePool` call.
 * Returns null for SR / RS_SR — those prospects exit the pool
 * (drafted-or-not; slice 1 just expires them).
 */
const CLASS_AGE_NEXT: Record<ClassYear, ClassYear | null> = {
  TRUE_FR: 'RS_FR',
  RS_FR: 'SO',
  SO: 'JR',
  JR: 'SR',
  SR: null,
  RS_SR: null,
};

export interface AdvanceCollegePoolOptions {
  /** Sim year for the new freshman class. */
  simYear: number;
  /** Stable id prefix for generated freshman IDs. */
  freshmanIdPrefix: string;
}

export interface AdvanceCollegePoolResult {
  /** Pool after aging existing prospects + injecting a freshman class. */
  nextPool: readonly CollegePlayer[];
  /** IDs of prospects who exited the pool (SR/RS_SR cohort). */
  expiredIds: readonly PlayerId[];
}

/**
 * Roll the college pool forward one year. Mechanics:
 *
 *   1. Advance every prospect's class year (TRUE_FR → RS_FR, …).
 *   2. SR / RS_SR exit the pool (slice 1 just expires them; the
 *      future draft event slice will promote drafted prospects to
 *      NFL Players and expire the rest).
 *   3. Append a new season of college stats matching the new class
 *      year (skipped for the no-recorded-production stages).
 *   4. Append at most one new injury this season (independent roll).
 *   5. Inject a fresh TRUE_FR class (~`CLASS_TARGETS.TRUE_FR`).
 *
 * Determinism: callers fork the league's PRNG with a stable label
 * (e.g. `seasonNumber`) before calling. A given (prng, pool, options)
 * always produces the same next pool.
 */
export function advanceCollegePool(
  prng: Prng,
  pool: readonly CollegePlayer[],
  options: AdvanceCollegePoolOptions,
): AdvanceCollegePoolResult {
  const expiredIds: PlayerId[] = [];
  const nextPool: CollegePlayer[] = [];

  for (const prospect of pool) {
    const nextClass = CLASS_AGE_NEXT[prospect.classYear];
    if (nextClass === null) {
      expiredIds.push(prospect.id);
      continue;
    }
    const advancedPrng = prng.fork(`advance:${prospect.id}`);
    const newStats = extendCollegeStats(advancedPrng.fork('stats'), prospect, nextClass);
    const newInjuries = extendInjuryHistory(advancedPrng.fork('inj'), prospect, nextClass);
    const isDraftEligible =
      nextClass === 'JR' || nextClass === 'SR' || nextClass === 'RS_SR';

    nextPool.push({
      ...prospect,
      classYear: nextClass,
      isDraftEligible,
      collegeStats: newStats,
      injuryHistory: newInjuries,
    });
  }

  // Inject fresh TRUE_FR cohort.
  const freshmanPrng = prng.fork('freshman-class');
  const target = CLASS_TARGETS.TRUE_FR;
  for (let i = 0; i < target; i++) {
    const playerPrng = freshmanPrng.fork(`p:${i}`);
    const school = pickSchool(playerPrng.fork('school'));
    const cp = generateCollegePlayer(playerPrng, {
      idSuffix: `${options.freshmanIdPrefix}_TRUE_FR_${i}`,
      classYear: 'TRUE_FR',
      school,
      simYear: options.simYear,
      isTransfer: false,
    });
    nextPool.push(cp);
  }

  return { nextPool, expiredIds };
}

function extendCollegeStats(
  prng: Prng,
  prospect: CollegePlayer,
  newClass: ClassYear,
): readonly CollegeSeasonStats[] {
  // No new season for TRUE_FR or RS_FR — they redshirt or barely play.
  if (newClass === 'TRUE_FR' || newClass === 'RS_FR') {
    return prospect.collegeStats;
  }
  const school = SCHOOL_BY_ID.get(prospect.schoolId) ?? SCHOOLS_BY_TIER.POWER[0]!;
  const arc = rollCollegeStats({
    prng,
    classYear: newClass,
    position: prospect.collegePosition,
    tier: prospect.tier,
    school,
    skills: prospect.current,
  });
  // The arc returned is the full career arc up to newClass. We want
  // only the entry for newClass to append to the prospect's existing
  // arc (which has the prior years).
  const lastNewEntry = arc[arc.length - 1];
  if (!lastNewEntry) return prospect.collegeStats;
  return [...prospect.collegeStats, lastNewEntry];
}

function extendInjuryHistory(
  prng: Prng,
  prospect: CollegePlayer,
  newClass: ClassYear,
): readonly CollegeInjury[] {
  if (prng.next() >= 0.25) return prospect.injuryHistory;
  const labels: ReadonlyArray<{ label: string; sev: 'MINOR' | 'MODERATE' | 'MAJOR'; miss: readonly [number, number] }> = [
    { label: 'high ankle sprain', sev: 'MINOR', miss: [1, 4] },
    { label: 'shoulder sprain', sev: 'MINOR', miss: [1, 3] },
    { label: 'concussion', sev: 'MODERATE', miss: [1, 2] },
    { label: 'hamstring strain', sev: 'MINOR', miss: [1, 3] },
    { label: 'MCL sprain', sev: 'MODERATE', miss: [2, 5] },
    { label: 'broken hand', sev: 'MODERATE', miss: [2, 5] },
  ];
  const spec = labels[prng.nextInt(labels.length)]!;
  const [missLo, missHi] = spec.miss;
  return [
    ...prospect.injuryHistory,
    {
      label: spec.label,
      classYear: newClass,
      severity: spec.sev,
      gamesMissed: prng.nextInt(missHi - missLo + 1) + missLo,
    },
  ];
}

/**
 * Convenience: build a fresh root PRNG forked from the league seed
 * for college-pool work. Mirrors the pattern used elsewhere.
 */
export function collegePrngForLeague(seed: string, label: string): Prng {
  return new PrngClass(`${seed}::college::${label}`);
}
