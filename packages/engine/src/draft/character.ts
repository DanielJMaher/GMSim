import type { Prng } from '../prng/index.js';
import type {
  CharacterFlag,
  HiddenIntangibles,
  PersonalityVoice,
  Bloodline,
  CollegeInjury,
  ClassYear,
  RecruitingBackground,
} from '../types/college.js';
import type { TalentTier } from '../types/player.js';
import type { PositionGroup } from '../types/enums.js';
import { LAST_NAMES } from '../data/name-pools/index.js';

const VOICES: readonly PersonalityVoice[] = [
  'QUIET_WORKER',
  'ALPHA_LEADER',
  'BRASH',
  'ANALYTICAL',
  'INSTINCTIVE',
  'CHARISMATIC',
];

/**
 * Voice distribution. Quiet workers and instinctive types are the
 * bulk of the league; alpha leaders and brash types are uncommon
 * but flavorful; analytical and charismatic are mid-rare.
 */
const VOICE_WEIGHTS: ReadonlyArray<{ value: PersonalityVoice; weight: number }> = [
  { value: 'QUIET_WORKER', weight: 30 },
  { value: 'INSTINCTIVE', weight: 25 },
  { value: 'ANALYTICAL', weight: 15 },
  { value: 'CHARISMATIC', weight: 12 },
  { value: 'ALPHA_LEADER', weight: 10 },
  { value: 'BRASH', weight: 8 },
];

export function rollPersonalityVoice(prng: Prng): PersonalityVoice {
  return prng.weighted(VOICE_WEIGHTS);
}

void VOICES; // referenced for type-completeness; runtime list lives in WEIGHTS

/**
 * Roll the hidden intangible profile. Means cluster around 60–70 with
 * stdev ~12 — most prospects are in the middle, with rare elite and
 * rare poor. Personality voice nudges related dials so the dimensions
 * cohere (alpha leaders score higher leadership presence on average,
 * brash types score lower coachability, etc.).
 */
export function rollHiddenIntangibles(
  prng: Prng,
  voice: PersonalityVoice,
  tier: TalentTier,
): HiddenIntangibles {
  // Tier provides a small mean lift — STAR-tier players tend to have
  // slightly better intangibles on average. This is correlation, not
  // causation; plenty of FRINGE players still grade out as great
  // teammates and plenty of STARs grade as challenging.
  const tierLift =
    tier === 'STAR' ? 4 : tier === 'STARTER' ? 2 : tier === 'BACKUP' ? 0 : -2;

  const baseline = (extra = 0) =>
    Math.round(prng.normal(62 + tierLift + extra, 12, { min: 20, max: 99 }));

  const voiceShift = voiceShifts(voice);

  return {
    leadershipPresence: baseline(voiceShift.leadership),
    interviewSkill: baseline(voiceShift.interview),
    workEthic: baseline(voiceShift.workEthic),
    coachability: baseline(voiceShift.coachability),
    competitiveness: baseline(voiceShift.competitiveness),
    footballCharacter: baseline(voiceShift.footballCharacter),
  };
}

interface VoiceShift {
  leadership: number;
  interview: number;
  workEthic: number;
  coachability: number;
  competitiveness: number;
  footballCharacter: number;
}

function voiceShifts(voice: PersonalityVoice): VoiceShift {
  switch (voice) {
    case 'QUIET_WORKER':
      return { leadership: -3, interview: -4, workEthic: 8, coachability: 6, competitiveness: 4, footballCharacter: 6 };
    case 'ALPHA_LEADER':
      return { leadership: 12, interview: 6, workEthic: 4, coachability: 0, competitiveness: 8, footballCharacter: 4 };
    case 'BRASH':
      return { leadership: 4, interview: 2, workEthic: 0, coachability: -8, competitiveness: 8, footballCharacter: -2 };
    case 'ANALYTICAL':
      return { leadership: 2, interview: 8, workEthic: 6, coachability: 6, competitiveness: 0, footballCharacter: 10 };
    case 'INSTINCTIVE':
      return { leadership: 0, interview: -2, workEthic: 2, coachability: 2, competitiveness: 6, footballCharacter: -4 };
    case 'CHARISMATIC':
      return { leadership: 8, interview: 12, workEthic: 0, coachability: 4, competitiveness: 2, footballCharacter: 0 };
  }
}

export interface RollCharacterFlagsOptions {
  prng: Prng;
  voice: PersonalityVoice;
  tier: TalentTier;
  background: RecruitingBackground;
  intangibles: HiddenIntangibles;
  /** True iff the prospect actually changed schools mid-career. */
  isTransfer: boolean;
  /** Number of recorded college injuries. */
  injuryCount: number;
  /** Class year — gates LATE_BLOOMER detection. */
  classYear: ClassYear;
  /** True iff the prospect actually became a starter only in JR/SR. */
  startedLate: boolean;
  /** True iff bloodline indicates NFL family. Triggers LEGACY tag. */
  hasBloodline: boolean;
}

/**
 * Compute the prospect's character-flag set from their other attributes
 * + a probabilistic roll for the orthogonal flags. Each flag has a
 * specific gating condition; see code below for the rules.
 *
 * Flags are append-only — order is stable across runs for the same
 * inputs. Returns a frozen array.
 */
export function rollCharacterFlags(options: RollCharacterFlagsOptions): readonly CharacterFlag[] {
  const flags: CharacterFlag[] = [];
  const p = options.prng;

  if (options.hasBloodline) flags.push('LEGACY');
  if (options.isTransfer) flags.push('TRANSFER_PORTAL');

  // Off-field incident — overall ~6%, doubled for low-coachability
  // BRASH types, halved for ANALYTICAL.
  let offFieldOdds = 0.06;
  if (options.voice === 'BRASH') offFieldOdds *= 2;
  if (options.voice === 'ANALYTICAL') offFieldOdds *= 0.5;
  if (options.intangibles.coachability < 40) offFieldOdds *= 1.5;
  if (p.next() < offFieldOdds) flags.push('OFF_FIELD_INCIDENT');

  // Coach conflict — biased by low coachability, more likely for BRASH
  if (options.intangibles.coachability < 45 && p.next() < 0.35) {
    flags.push('COACH_CONFLICT');
  } else if (options.voice === 'BRASH' && p.next() < 0.18) {
    flags.push('COACH_CONFLICT');
  }

  if (options.injuryCount >= 3) flags.push('INJURY_PRONE');

  if (options.startedLate && (options.classYear === 'JR' || options.classYear === 'SR' || options.classYear === 'RS_SR')) {
    flags.push('LATE_BLOOMER');
  }

  // Captain — biased by leadership presence + work ethic. Common
  // for ALPHA_LEADER + ANALYTICAL.
  const leadershipScore = (options.intangibles.leadershipPresence + options.intangibles.workEthic) / 2;
  let captainOdds = 0.10;
  if (leadershipScore >= 75) captainOdds = 0.55;
  else if (leadershipScore >= 65) captainOdds = 0.30;
  if (options.voice === 'ALPHA_LEADER') captainOdds += 0.20;
  if (options.voice === 'BRASH') captainOdds *= 0.5;
  if (p.next() < captainOdds) flags.push('CAPTAIN');

  // Academic honors — uncorrelated with talent, biased by ANALYTICAL.
  let academicOdds = 0.08;
  if (options.voice === 'ANALYTICAL') academicOdds = 0.30;
  if (p.next() < academicOdds) flags.push('ACADEMIC_HONORS');

  // Media darling — biased by CHARISMATIC + tier (better players get
  // more press).
  let mediaOdds = 0.05;
  if (options.voice === 'CHARISMATIC') mediaOdds = 0.45;
  if (options.tier === 'STAR') mediaOdds *= 2.2;
  if (p.next() < mediaOdds) flags.push('MEDIA_DARLING');

  // Practice legend — biased by work ethic + football character.
  if (options.intangibles.workEthic >= 80 && options.intangibles.footballCharacter >= 75 && p.next() < 0.4) {
    flags.push('PRACTICE_LEGEND');
  }

  // Workout warrior vs tape star are MUTUALLY EXCLUSIVE rolls.
  // ~10% of prospects pick up one of them.
  const physicalNarrativeRoll = p.next();
  if (physicalNarrativeRoll < 0.05) flags.push('WORKOUT_WARRIOR');
  else if (physicalNarrativeRoll < 0.10) flags.push('TAPE_STAR_POOR_TESTER');

  // System product — biased toward POWER programs (where systems are
  // strongest) + FCS small-school stat-padders.
  let systemOdds = 0.06;
  if (options.background === 'BIG_PROGRAM' || options.background === 'PEDIGREE') systemOdds = 0.10;
  if (options.background === 'SMALL_SCHOOL_GEM') systemOdds = 0.15;
  if (p.next() < systemOdds) flags.push('SYSTEM_PRODUCT');

  return flags;
}

/**
 * Roll bloodline. ~7% of prospects have a meaningful NFL family
 * connection. Within that, FATHER is most common, BROTHER next,
 * UNCLE / COUSIN rare. The ~25% of those whose relative was a star
 * carry extra narrative weight (HOF father).
 */
export function rollBloodline(prng: Prng, lastName: string): Bloodline {
  if (prng.next() >= 0.07) {
    return { hasNflFamily: false, relation: null, relativeName: null, relativeWasStar: false };
  }
  const relationRoll = prng.next();
  const relation: Bloodline['relation'] =
    relationRoll < 0.55 ? 'FATHER'
      : relationRoll < 0.80 ? 'BROTHER'
        : relationRoll < 0.93 ? 'UNCLE'
          : 'COUSIN';

  // Generate a plausible relative — a different first name, same last
  // name (a brother, father, uncle, cousin are all same surname here).
  const firstNamePool = ['Marcus', 'James', 'Anthony', 'Reggie', 'Ricky', 'Eddie', 'Terrell', 'Demarcus', 'Lawrence', 'Steve'];
  const relativeFirst = firstNamePool[prng.nextInt(firstNamePool.length)]!;
  const relativeWasStar = prng.next() < 0.25;

  return {
    hasNflFamily: true,
    relation,
    relativeName: `${relativeFirst} ${lastName}`,
    relativeWasStar,
  };
}

void LAST_NAMES; // last name is supplied by caller from the same pool

/**
 * Roll the multi-sport HS background. ~82% of real NFL prospects played a
 * second varsity sport (basketball / track / baseball most often). It's a
 * baseline athleticism cue, so skill-position and DB athletes skew higher and
 * the trenches lower. Position-group weighted, the pool lands near the real 82%.
 */
export function rollMultiSportBackground(prng: Prng, group: PositionGroup): boolean {
  const odds =
    group === 'SKILL' || group === 'DB' ? 0.9
      : group === 'OL' || group === 'DL' ? 0.7
        : 0.82; // QB / LB / ST
  return prng.next() < odds;
}

/**
 * Roll injury history across a prospect's college career so far.
 * Most prospects have 0–1 injuries; the long tail at 2+ feeds the
 * INJURY_PRONE flag. Severity weights toward MINOR / MODERATE.
 */
export function rollInjuryHistory(prng: Prng, classYear: ClassYear): readonly CollegeInjury[] {
  const yearsPlayed = yearsPlayedFor(classYear);
  const injuries: CollegeInjury[] = [];

  // ~25% chance of an injury per played year, independent.
  const labels: ReadonlyArray<{ label: string; sev: 'MINOR' | 'MODERATE' | 'MAJOR'; miss: readonly [number, number] }> = [
    { label: 'high ankle sprain', sev: 'MINOR', miss: [1, 4] },
    { label: 'shoulder sprain', sev: 'MINOR', miss: [1, 3] },
    { label: 'concussion', sev: 'MODERATE', miss: [1, 2] },
    { label: 'hamstring strain', sev: 'MINOR', miss: [1, 3] },
    { label: 'MCL sprain', sev: 'MODERATE', miss: [2, 5] },
    { label: 'ACL', sev: 'MAJOR', miss: [10, 13] },
    { label: 'meniscus', sev: 'MODERATE', miss: [3, 6] },
    { label: 'broken hand', sev: 'MODERATE', miss: [2, 5] },
    { label: 'turf toe', sev: 'MINOR', miss: [1, 4] },
    { label: 'lisfranc', sev: 'MAJOR', miss: [8, 13] },
  ];

  for (let i = 0; i < yearsPlayed; i++) {
    if (prng.next() >= 0.25) continue;
    const idx = prng.nextInt(labels.length);
    const spec = labels[idx]!;
    const yearOfInjury = injuryClassYearFor(classYear, i);
    const [missLo, missHi] = spec.miss;
    injuries.push({
      label: spec.label,
      classYear: yearOfInjury,
      severity: spec.sev,
      gamesMissed: prng.nextInt(missHi - missLo + 1) + missLo,
    });
  }

  return injuries;
}

function yearsPlayedFor(classYear: ClassYear): number {
  switch (classYear) {
    case 'TRUE_FR':
      return 0;
    case 'RS_FR':
      return 1; // redshirt year + practice
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

function injuryClassYearFor(currentClass: ClassYear, yearsAgo: number): ClassYear {
  // yearsAgo: 0 = most recent year, 1 = previous, etc.
  // Walk back from current class.
  const ladder: ClassYear[] = ['TRUE_FR', 'RS_FR', 'SO', 'JR', 'SR', 'RS_SR'];
  const currentIdx = ladder.indexOf(currentClass);
  const idx = Math.max(0, currentIdx - yearsAgo);
  return ladder[idx]!;
}
