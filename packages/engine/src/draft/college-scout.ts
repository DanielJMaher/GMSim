import { ScoutId } from '../types/ids.js';
import { PositionGroup } from '../types/enums.js';
import type { Prng } from '../prng/index.js';
import type { CollegeScout, ScoutRegion } from '../types/college.js';
import type { ScoutQuirk } from '../types/scout.js';
import type { Owner, Gm } from '../types/personnel.js';
import { generateName } from '../personnel/name-generator.js';
import { SCOUT_QUIRK_POOL } from '../scouting/quirks.js';

const POSITION_GROUPS: readonly PositionGroup[] = [
  PositionGroup.QB,
  PositionGroup.SKILL,
  PositionGroup.OL,
  PositionGroup.DL,
  PositionGroup.LB,
  PositionGroup.DB,
  PositionGroup.ST,
];

const REGIONS: readonly ScoutRegion[] = [
  'NATIONAL',
  'NORTHEAST',
  'SOUTHEAST',
  'MIDWEST',
  'SOUTHWEST',
  'WEST',
];

/**
 * College scout regional weighting. Most scouts have a regional focus
 * — the SE / SW are the talent-richest in real life, so most scouts
 * cover them. NATIONAL scouts (cross-country generalists) are rarer
 * but valuable; they don't get a regional bonus but don't penalize
 * non-preferred regions either.
 */
const REGION_WEIGHTS: ReadonlyArray<{ value: ScoutRegion; weight: number }> = [
  { value: 'SOUTHEAST', weight: 30 },
  { value: 'SOUTHWEST', weight: 22 },
  { value: 'MIDWEST', weight: 18 },
  { value: 'WEST', weight: 14 },
  { value: 'NORTHEAST', weight: 10 },
  { value: 'NATIONAL', weight: 6 },
];

/**
 * College scout staff size — 10–15 per team per Doc 3. Mapped from
 * Owner financial commitment with a slightly steeper curve than NFL
 * scouts since college scouting departments scale more dramatically:
 *   1–3   → 10 scouts (cheap ownership)
 *   4–6   → 12 scouts
 *   7–8   → 14 scouts
 *   9–10  → 15 scouts
 */
export function collegeScoutStaffSize(ownerFinancialCommitment: number): number {
  if (ownerFinancialCommitment <= 3) return 10;
  if (ownerFinancialCommitment <= 6) return 12;
  if (ownerFinancialCommitment <= 8) return 14;
  return 15;
}

/**
 * Mean trueAccuracy for this team's college scouts. Same blend as
 * NFL scouts (Owner financialCommitment + GM talentEvaluationAccuracy)
 * but with a slightly different floor — college evaluation is harder
 * (less film, less data, more noise), so even elite orgs cap a touch
 * lower than for pro-personnel work.
 */
export function teamCollegeScoutAccuracyMean(owner: Owner, gm: Gm): number {
  const ownerComponent = owner.spectrums.financialCommitment / 10;
  const gmComponent = gm.spectrums.talentEvaluationAccuracy / 10;
  const raw = (ownerComponent + gmComponent) / 2;
  return 0.35 + raw * 0.45; // 0.35..0.80 vs NFL's 0.40..0.85
}

export function generateCollegeScout(
  prng: Prng,
  idSeed: string,
  baseAccuracyMean: number,
): CollegeScout {
  const name = generateName(prng);
  const age = Math.round(prng.normal(40, 9, { min: 26, max: 64 }));
  const yearsExperience = Math.max(
    1,
    Math.min(age - 22, Math.round(prng.normal(age - 30, 4, { min: 1, max: age - 22 }))),
  );

  const knownSpecialty = prng.pick(POSITION_GROUPS);
  const preferredRegion = prng.weighted(REGION_WEIGHTS);

  const trueAccuracy: Record<PositionGroup, number> = {} as Record<PositionGroup, number>;
  for (const group of POSITION_GROUPS) {
    trueAccuracy[group] = clampAccuracy(prng.normal(baseAccuracyMean, 0.10));
  }

  const specialtyBonus = prng.normal(0.10, 0.03, { min: 0.02, max: 0.20 });
  trueAccuracy[knownSpecialty] = clampAccuracy(trueAccuracy[knownSpecialty] + specialtyBonus);

  // Hidden depths — same 30% chance as NFL scouts.
  if (prng.next() < 0.30) {
    const offSpecialty = POSITION_GROUPS.filter((g) => g !== knownSpecialty);
    const hiddenGroup = prng.pick(offSpecialty);
    const hiddenBonus = prng.normal(0.10, 0.03, { min: 0.02, max: 0.20 });
    trueAccuracy[hiddenGroup] = clampAccuracy(trueAccuracy[hiddenGroup] + hiddenBonus);
  }

  const quirks = pickCollegeScoutQuirks(prng);

  return {
    id: ScoutId(`CSCOUT_${idSeed}`),
    name: name.fullName,
    age,
    yearsExperience,
    knownSpecialty,
    preferredRegion,
    trueAccuracy,
    quirks,
  };
}

export function generateTeamCollegeScouts(
  prng: Prng,
  idSeedPrefix: string,
  owner: Owner,
  gm: Gm,
): CollegeScout[] {
  const count = collegeScoutStaffSize(owner.spectrums.financialCommitment);
  const accuracyMean = teamCollegeScoutAccuracyMean(owner, gm);
  const scouts: CollegeScout[] = [];
  for (let i = 0; i < count; i++) {
    const scout = generateCollegeScout(
      prng.fork(`cscout-${i}`),
      `${idSeedPrefix}_${i}`,
      accuracyMean,
    );
    scouts.push(scout);
  }
  return scouts;
}

void REGIONS; // Region pool is referenced via REGION_WEIGHTS; kept for completeness.

function pickCollegeScoutQuirks(prng: Prng): readonly ScoutQuirk[] {
  // Same distribution as NFL: 60% one quirk, 40% two distinct quirks.
  const count = prng.next() < 0.4 ? 2 : 1;
  const pool = [...SCOUT_QUIRK_POOL];
  prng.shuffle(pool);
  return pool.slice(0, count);
}

function clampAccuracy(v: number): number {
  return Math.max(0.18, Math.min(0.95, v));
}
