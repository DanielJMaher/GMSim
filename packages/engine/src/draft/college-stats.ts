import type { Prng } from '../prng/index.js';
import { Position } from '../types/enums.js';
import type { ClassYear, CollegeSchool, CollegeSeasonStats } from '../types/college.js';
import type { PlayerSkills, TalentTier } from '../types/player.js';

/**
 * Generate the prospect's college-career stats up to their current
 * class year. Each played season produces one `CollegeSeasonStats`.
 * Slice 1 ships season totals only — week-by-week progression lands
 * when the college season simulation does (deferred; significant
 * scope of its own).
 *
 * Production scales with:
 *   - tier (better players post better numbers, with noise)
 *   - class year (juniors typically have 2 years of starting tape)
 *   - school tier (POWER programs play 12 games, FCS often 11)
 *   - position (stats are position-keyed, see `statsForPosition`)
 *
 * Stat lines are deliberately rough — the design doc says "realistic
 * college stats" and slice 1's job is to provide a defensible
 * year-over-year arc for the eventual scout-report blurb generator
 * to draw on. Polish (deeper distributions, situation-aware
 * production) is appropriate for a later slice.
 */
export interface RollCollegeStatsOptions {
  prng: Prng;
  classYear: ClassYear;
  position: Position;
  tier: TalentTier;
  school: CollegeSchool;
  skills: PlayerSkills;
}

export function rollCollegeStats(options: RollCollegeStatsOptions): readonly CollegeSeasonStats[] {
  const yearsPlayed = startedYears(options.classYear);
  if (yearsPlayed === 0) return [];

  const ladder: ClassYear[] = ['TRUE_FR', 'RS_FR', 'SO', 'JR', 'SR', 'RS_SR'];
  const currentIdx = ladder.indexOf(options.classYear);

  const stats: CollegeSeasonStats[] = [];
  for (let i = 0; i < yearsPlayed; i++) {
    const yearClass = ladder[Math.max(0, currentIdx - (yearsPlayed - 1 - i))]!;
    const isStartingYear = isStartingClassYear(yearClass);
    const lineup = statsForPosition(options, yearClass, isStartingYear);
    stats.push(lineup);
  }
  return stats;
}

/**
 * How many seasons of recorded production this class year carries.
 * Aligns with `rollInjuryHistory` in `character.ts`. RS_FR has 0
 * recorded seasons (they redshirted); SO has 1; JR has 2; SR has 3;
 * RS_SR has 4.
 */
function startedYears(classYear: ClassYear): number {
  switch (classYear) {
    case 'TRUE_FR':
      return 0;
    case 'RS_FR':
      return 0;
    case 'SO':
      return 1;
    case 'JR':
      return 2;
    case 'SR':
      return 3;
    case 'RS_SR':
      return 4;
  }
}

function isStartingClassYear(yearClass: ClassYear): boolean {
  // TRUE_FR / RS_FR / SO seasons may be limited starts (rotational role)
  return yearClass === 'JR' || yearClass === 'SR' || yearClass === 'RS_SR';
}

function statsForPosition(
  options: RollCollegeStatsOptions,
  yearClass: ClassYear,
  isStartingYear: boolean,
): CollegeSeasonStats {
  const { prng, position, tier, school, skills } = options;
  const games = school.tier === 'POWER' || school.tier === 'GROUP_OF_5'
    ? 12 + (prng.next() < 0.4 ? 1 : 0) // bowl game lifts to 13
    : 11;
  const starts = isStartingYear
    ? Math.max(0, games - prng.nextInt(2))
    : Math.max(0, Math.round(games * (prng.next() * 0.4)));

  // Tier multiplier — STAR posts ~1.4x league mean, FRINGE ~0.5x
  const tierMul = tier === 'STAR' ? 1.4
    : tier === 'STARTER' ? 1.1
      : tier === 'BACKUP' ? 0.85
        : 0.5;
  // Conference quality — small-school stat-padding bumps numbers up,
  // power-conference defensive competition reins them in.
  const tierAdjust = school.tier === 'SMALL' ? 1.2
    : school.tier === 'FCS' ? 1.15
      : school.tier === 'GROUP_OF_5' ? 1.05
        : 1.0;
  const productionScale = tierMul * tierAdjust;

  const zero = baselineZero();

  switch (position) {
    case Position.QB: {
      const att = Math.round((isStartingYear ? prng.normal(360, 40) : 80) * productionScale);
      const compPct = clamp(prng.normal(0.59 + (skills.technicalSkill - 70) / 400, 0.04), 0.45, 0.78);
      const ypa = clamp(prng.normal(7.2 + (skills.decisionMaking - 70) / 60, 0.6), 5.5, 11.5);
      const tdRate = clamp(prng.normal(0.05 + (skills.handsBallSkills - 70) / 1200, 0.01), 0.02, 0.10);
      const intRate = clamp(prng.normal(0.025 - (skills.decisionMaking - 70) / 2400, 0.008), 0.005, 0.06);
      return {
        ...zero, classYear: yearClass, schoolId: school.id, games, starts,
        passAttempts: Math.max(0, att),
        passCompletions: Math.max(0, Math.round(att * compPct)),
        passingYards: Math.max(0, Math.round(att * ypa)),
        passingTds: Math.max(0, Math.round(att * tdRate)),
        interceptionsThrown: Math.max(0, Math.round(att * intRate)),
        rushingAttempts: Math.max(0, Math.round((isStartingYear ? prng.normal(70, 25) : 15) * (skills.speed > 75 ? 1.4 : 0.8))),
        rushingYards: 0,
        rushingTds: 0,
      };
    }
    case Position.RB: {
      const att = Math.round((isStartingYear ? prng.normal(180, 50) : 50) * productionScale);
      const ypc = clamp(prng.normal(5.0 + (skills.acceleration - 70) / 80, 0.6), 3.0, 8.5);
      const tdRate = clamp(prng.normal(0.06 + (skills.strength - 70) / 1500, 0.015), 0.02, 0.14);
      return {
        ...zero, classYear: yearClass, schoolId: school.id, games, starts,
        rushingAttempts: Math.max(0, att),
        rushingYards: Math.max(0, Math.round(att * ypc)),
        rushingTds: Math.max(0, Math.round(att * tdRate)),
        targets: Math.max(0, Math.round(prng.normal(28, 12))),
        receptions: Math.max(0, Math.round(prng.normal(20, 10))),
        receivingYards: Math.max(0, Math.round(prng.normal(160, 80))),
        receivingTds: Math.max(0, prng.nextInt(3)),
      };
    }
    case Position.WR: {
      const tgt = Math.round((isStartingYear ? prng.normal(85, 25) : 25) * productionScale);
      const catchRate = clamp(prng.normal(0.62 + (skills.handsBallSkills - 70) / 400, 0.06), 0.4, 0.85);
      const ypr = clamp(prng.normal(13.5 + (skills.speed - 70) / 60, 1.5), 8, 22);
      const tdRate = clamp(prng.normal(0.08 + (skills.acceleration - 70) / 1500, 0.025), 0.02, 0.18);
      const rec = Math.max(0, Math.round(tgt * catchRate));
      return {
        ...zero, classYear: yearClass, schoolId: school.id, games, starts,
        targets: Math.max(0, tgt),
        receptions: rec,
        receivingYards: Math.max(0, Math.round(rec * ypr)),
        receivingTds: Math.max(0, Math.round(rec * tdRate)),
      };
    }
    case Position.TE: {
      const tgt = Math.round((isStartingYear ? prng.normal(50, 20) : 15) * productionScale);
      const catchRate = clamp(prng.normal(0.66, 0.06), 0.45, 0.85);
      const ypr = clamp(prng.normal(11.5, 2), 7, 18);
      const tdRate = clamp(prng.normal(0.10, 0.03), 0.02, 0.20);
      const rec = Math.max(0, Math.round(tgt * catchRate));
      return {
        ...zero, classYear: yearClass, schoolId: school.id, games, starts,
        targets: Math.max(0, tgt),
        receptions: rec,
        receivingYards: Math.max(0, Math.round(rec * ypr)),
        receivingTds: Math.max(0, Math.round(rec * tdRate)),
      };
    }
    case Position.FB: {
      return {
        ...zero, classYear: yearClass, schoolId: school.id, games, starts,
        rushingAttempts: Math.max(0, Math.round((isStartingYear ? prng.normal(20, 10) : 5) * productionScale)),
        rushingYards: Math.max(0, Math.round(prng.normal(70, 40) * productionScale)),
        rushingTds: prng.nextInt(3),
        targets: Math.max(0, Math.round(prng.normal(15, 8))),
        receptions: Math.max(0, Math.round(prng.normal(10, 6))),
        receivingYards: Math.max(0, Math.round(prng.normal(70, 40))),
        receivingTds: prng.nextInt(2),
      };
    }
    case Position.LT:
    case Position.LG:
    case Position.C:
    case Position.RG:
    case Position.RT:
      // OL doesn't accumulate counting stats — games + starts is the
      // visible production. Tape is what scouts actually grade.
      return { ...zero, classYear: yearClass, schoolId: school.id, games, starts };

    case Position.EDGE:
    case Position.OLB: {
      const baseTackles = isStartingYear ? prng.normal(45, 15) : 18;
      const sackBonus = (skills.passRushTechnique - 70) / 12;
      return {
        ...zero, classYear: yearClass, schoolId: school.id, games, starts,
        tackles: Math.max(0, Math.round(baseTackles * productionScale)),
        sacks: Math.max(0, Math.round((prng.normal(7 + sackBonus, 3)) * productionScale)),
        forcedFumbles: prng.nextInt(4),
      };
    }
    case Position.DT:
    case Position.NT: {
      const baseTackles = isStartingYear ? prng.normal(35, 12) : 14;
      return {
        ...zero, classYear: yearClass, schoolId: school.id, games, starts,
        tackles: Math.max(0, Math.round(baseTackles * productionScale)),
        sacks: Math.max(0, Math.round(prng.normal(3.5, 2) * productionScale)),
        forcedFumbles: prng.nextInt(3),
      };
    }
    case Position.ILB: {
      const baseTackles = isStartingYear ? prng.normal(85, 20) : 35;
      return {
        ...zero, classYear: yearClass, schoolId: school.id, games, starts,
        tackles: Math.max(0, Math.round(baseTackles * productionScale)),
        sacks: Math.max(0, Math.round(prng.normal(2.5, 1.5))),
        interceptions: prng.nextInt(3),
        passesDefended: prng.nextInt(5),
        forcedFumbles: prng.nextInt(3),
      };
    }
    case Position.CB:
    case Position.NICKEL: {
      const cov = (skills.coverageTechnique - 70) / 10;
      return {
        ...zero, classYear: yearClass, schoolId: school.id, games, starts,
        tackles: Math.max(0, Math.round((isStartingYear ? prng.normal(48, 15) : 22) * productionScale)),
        interceptions: Math.max(0, Math.round(prng.normal(2.5 + cov / 2, 1))),
        passesDefended: Math.max(0, Math.round(prng.normal(8 + cov, 3))),
        forcedFumbles: prng.nextInt(2),
      };
    }
    case Position.S: {
      return {
        ...zero, classYear: yearClass, schoolId: school.id, games, starts,
        tackles: Math.max(0, Math.round((isStartingYear ? prng.normal(72, 18) : 30) * productionScale)),
        interceptions: Math.max(0, Math.round(prng.normal(3, 1.5))),
        passesDefended: Math.max(0, Math.round(prng.normal(6, 2))),
        forcedFumbles: prng.nextInt(3),
      };
    }
    case Position.K:
    case Position.P:
    case Position.LS:
      // Specialists — slice 1 ships games + starts only. A future
      // specialist-stats expansion can add FG%, punt avg, etc.
      return { ...zero, classYear: yearClass, schoolId: school.id, games, starts };
  }
}

function baselineZero(): Omit<CollegeSeasonStats, 'classYear' | 'schoolId' | 'games' | 'starts'> {
  return {
    passAttempts: 0,
    passCompletions: 0,
    passingYards: 0,
    passingTds: 0,
    interceptionsThrown: 0,
    rushingAttempts: 0,
    rushingYards: 0,
    rushingTds: 0,
    targets: 0,
    receptions: 0,
    receivingYards: 0,
    receivingTds: 0,
    tackles: 0,
    sacks: 0,
    interceptions: 0,
    passesDefended: 0,
    forcedFumbles: 0,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
