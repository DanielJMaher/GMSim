import type { Prng } from '../prng/index.js';
import { PlayerId } from '../types/ids.js';
import { Position } from '../types/enums.js';
import type { CollegePlayer, ClassYear, CollegeSchool } from '../types/college.js';
import { rollSkills, rollDevelopmentArchetype } from '../players/skills.js';
import { ageToBirthDate } from '../players/age.js';
import { positionGroupFor } from '../players/position-group.js';
import { generateName } from '../personnel/name-generator.js';
import { rollMeasurables } from './measurables.js';
import {
  rollPersonalityVoice,
  rollHiddenIntangibles,
  rollCharacterFlags,
  rollBloodline,
  rollInjuryHistory,
  rollMultiSportBackground,
} from './character.js';
import { rollRecruitingProfile } from './recruiting.js';
import { rollCollegeStats } from './college-stats.js';
import {
  rollPositionProjection,
  pickTrueArchetype,
  pickAssumedArchetype,
} from './conversion.js';
import { getArchetypeById } from '../archetypes/index.js';

/**
 * Roughly even position distribution that mirrors how college rosters
 * cycle players through the draft pipeline. Slightly OL-heavy
 * because OL roster spots churn through more bodies; QB-light
 * because there's only one starter and most teams develop one
 * draftable QB per cycle.
 *
 * The pool generator samples from this distribution to decide
 * what college position each prospect plays.
 */
const COLLEGE_POSITION_WEIGHTS: ReadonlyArray<{ value: Position; weight: number }> = [
  { value: Position.QB, weight: 6 },
  { value: Position.RB, weight: 9 },
  { value: Position.FB, weight: 1 },
  { value: Position.WR, weight: 14 },
  { value: Position.TE, weight: 6 },
  { value: Position.LT, weight: 4 },
  { value: Position.LG, weight: 4 },
  { value: Position.C, weight: 3 },
  { value: Position.RG, weight: 4 },
  { value: Position.RT, weight: 4 },
  { value: Position.EDGE, weight: 9 },
  { value: Position.DT, weight: 7 },
  { value: Position.NT, weight: 2 },
  { value: Position.ILB, weight: 6 },
  { value: Position.OLB, weight: 5 },
  { value: Position.CB, weight: 9 },
  { value: Position.S, weight: 6 },
  { value: Position.NICKEL, weight: 1 },
  { value: Position.K, weight: 1 },
  { value: Position.P, weight: 1 },
  { value: Position.LS, weight: 1 },
];

export function pickCollegePosition(prng: Prng): Position {
  return prng.weighted(COLLEGE_POSITION_WEIGHTS);
}

const CLASS_YEAR_AGE_RANGE: Record<ClassYear, [number, number]> = {
  TRUE_FR: [18, 19],
  RS_FR: [19, 20],
  SO: [19, 21],
  JR: [20, 22],
  SR: [21, 23],
  RS_SR: [22, 24],
};

function rollAgeForClass(prng: Prng, classYear: ClassYear): number {
  const [min, max] = CLASS_YEAR_AGE_RANGE[classYear];
  return prng.nextRange(min, max + 1);
}

export interface GenerateCollegePlayerOptions {
  /** Stable suffix for the player ID. */
  idSuffix: string;
  /** What class year the prospect is currently in. */
  classYear: ClassYear;
  /** What school they currently attend. */
  school: CollegeSchool;
  /**
   * Sim year to anchor birthdates against. The pool generator passes
   * the current sim year so prospects' ages are correct relative to
   * the league epoch.
   */
  simYear: number;
  /** Optional override for college position; otherwise sampled. */
  forcePosition?: Position;
  /**
   * If true, the prospect is marked as a transfer (changed schools
   * mid-career). Caller decides — the pool generator rolls this
   * during prospect creation.
   */
  isTransfer?: boolean;
}

/**
 * Generate a fully-formed college prospect. Deterministic for the
 * given (prng, options).
 *
 * Pipeline:
 *   1. Pick college position (or take supplied override).
 *   2. Decide NFL position projection — rolls conversion candidacy.
 *   3. Roll true NFL archetype from projected-position pool.
 *   4. Roll talent tier — biases skill rolls.
 *   5. Roll skills (current + ceiling) using ROOKIE realization curve
 *      so they look age-appropriate (lots of physical, less polish).
 *   6. Roll development archetype.
 *   7. Decide assumed archetype — same as truth or off-the-mark for
 *      conversion candidates / misread cases.
 *   8. Roll measurables — position-keyed, lightly correlated to skills.
 *   9. Roll personality voice + hidden intangibles + bloodline.
 *  10. Roll injury history across played years.
 *  11. Roll recruiting profile (star, rank, hometown, background).
 *  12. Roll college stats per played year.
 *  13. Roll character flags from everything assembled above.
 *  14. Generate name + birthdate.
 */
export function generateCollegePlayer(
  prng: Prng,
  options: GenerateCollegePlayerOptions,
): CollegePlayer {
  const positionPrng = prng.fork('position');
  const collegePosition = options.forcePosition ?? pickCollegePosition(positionPrng);

  const projection = rollPositionProjection(prng.fork('proj'), collegePosition);
  const archetypeId = pickTrueArchetype(prng.fork('arch'), projection.projected);
  const archetype = getArchetypeById(archetypeId);
  if (!archetype) throw new Error(`Archetype lookup failed for id: ${archetypeId}`);

  // Use ROOKIE realization curve — college prospects are physically
  // close to their ceiling but not yet polished. Same dial NFL rookies
  // get when they enter the league.
  const skillRoll = rollSkills(prng.fork('skills'), archetype, 'ROOKIE', projection.projected);
  const current = skillRoll.current;
  const ceiling = skillRoll.ceiling;
  // Talent-spread fix Lever 2 (2026-06-03): the prospect's tier is the tier the
  // generated SKILLS actually express — NOT a separate independent roll. The old
  // code rolled `tier` from its own fork, fully decoupled from `rollSkills`'
  // internal grade, so a prospect's recruiting stars / stats / character AND the
  // stored tier had nothing to do with his real talent. That decoupling is why
  // the consensus board's top-32 tier mix read ~random (STAR ≈ 5%×32 ≈ 1.6): a
  // skill-ranked board can't concentrate a tier that was rolled independently of
  // skills. Keying tier off the skill roll makes the whole prospect coherent —
  // blue-chips now get blue-chip recruiting + production too.
  const tier = skillRoll.tier;
  const developmentArchetype = rollDevelopmentArchetype(prng.fork('dev'));

  const assumedArchetype = pickAssumedArchetype(
    prng.fork('assumed'),
    archetypeId,
    collegePosition,
    projection.isConversion,
  );

  const measurables = rollMeasurables(prng.fork('measurables'), {
    position: collegePosition,
    skills: current,
  });

  const voice = rollPersonalityVoice(prng.fork('voice'));
  const intangibles = rollHiddenIntangibles(prng.fork('intang'), voice, tier);

  const name = generateName(prng.fork('name'));
  const bloodline = rollBloodline(prng.fork('blood'), name.lastName);

  const isTransfer = options.isTransfer ?? false;
  const recruiting = rollRecruitingProfile({
    prng: prng.fork('recruit'),
    grade: skillRoll.talentGrade,
    school: options.school,
  });
  const injuryHistory = rollInjuryHistory(prng.fork('injuries'), options.classYear);
  const multiSportBackground = rollMultiSportBackground(
    prng.fork('multisport'),
    positionGroupFor(projection.projected),
  );
  // Redshirted at some point (~40% of real prospects). RS_FR / RS_SR redshirted
  // by definition; everyone else rolls — base chosen so the drafted set lands
  // near the real 40%.
  const redshirted =
    options.classYear === 'RS_FR' ||
    options.classYear === 'RS_SR' ||
    prng.fork('redshirt').next() < 0.37;

  const collegeStats = rollCollegeStats({
    prng: prng.fork('stats'),
    classYear: options.classYear,
    position: collegePosition,
    tier,
    school: options.school,
    skills: current,
  });

  // STARTED_LATE: did the prospect's first starting season come late?
  // Heuristic — the first stat line shows zero starts AND they're a JR/SR.
  const startedLate = collegeStats.length > 0
    && collegeStats[0]!.starts === 0
    && (options.classYear === 'JR' || options.classYear === 'SR' || options.classYear === 'RS_SR');

  const characterFlags = rollCharacterFlags({
    prng: prng.fork('flags'),
    voice,
    tier,
    background: recruiting.background,
    intangibles,
    isTransfer,
    injuryCount: injuryHistory.length,
    classYear: options.classYear,
    startedLate,
    hasBloodline: bloodline.hasNflFamily,
  });

  const ageYears = rollAgeForClass(prng.fork('age'), options.classYear);
  const birthDate = ageToBirthDate(prng.fork('birth'), ageYears, options.simYear);

  const isDraftEligible =
    options.classYear === 'JR' || options.classYear === 'SR' || options.classYear === 'RS_SR';
  // SR / RS_SR auto-declare at generation (eligibility runs out
  // next year — they have no choice). JRs are undeclared at
  // generation; `rollJuniorDeclarations` flips them per tier-
  // weighted probability at the start of each advance. Pre-JR
  // classes stay false (not yet eligible to declare). v0.53 made
  // this match the aging-time auto-declare in `advanceCollegePool`
  // — without it, initial boards generate empty under the v0.53
  // declared-only filter.
  const hasDeclared =
    options.classYear === 'SR' || options.classYear === 'RS_SR';

  return {
    id: PlayerId(`CP_${options.idSuffix}`),
    firstName: name.firstName,
    lastName: name.lastName,
    schoolId: options.school.id,
    classYear: options.classYear,
    isDraftEligible,
    hasDeclared,
    hasReturnedToSchool: false,
    birthDate,
    collegePosition,
    nflProjectedPosition: projection.projected,
    isConversionCandidate: projection.isConversion,
    alternatePositions: projection.alternates,
    current,
    ceiling,
    developmentArchetype,
    tier,
    archetype: archetypeId,
    assumedArchetype,
    archetypeMisreadFlag: archetypeId !== assumedArchetype,
    measurables,
    hiddenIntangibles: intangibles,
    personalityVoice: voice,
    recruiting,
    bloodline,
    characterFlags,
    multiSportBackground,
    transferred: isTransfer,
    redshirted,
    injuryHistory,
    collegeStats,
  };
}
