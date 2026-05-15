import { ScoutId } from '../types/ids.js';
import { PositionGroup } from '../types/enums.js';
import type { Prng } from '../prng/index.js';
import type { Scout, ScoutQuirk } from '../types/scout.js';
import type { Owner, Gm } from '../types/personnel.js';
import { generateName } from '../personnel/name-generator.js';
import { SCOUT_QUIRK_POOL } from './quirks.js';

const POSITION_GROUPS: readonly PositionGroup[] = [
  PositionGroup.QB,
  PositionGroup.SKILL,
  PositionGroup.OL,
  PositionGroup.DL,
  PositionGroup.LB,
  PositionGroup.DB,
  PositionGroup.ST,
];

/**
 * Map Owner financial commitment to scout staff size.
 *   1–3 → 3 scouts  (cheap ownership; thin staff)
 *   4–7 → 4 scouts  (mid)
 *   8–10 → 5 scouts (deep-pocketed)
 *
 * Per Doc 4: "Scout quality varies significantly across the 32 teams
 * based on ownership financial commitment and GM priorities."
 */
export function scoutStaffSize(ownerFinancialCommitment: number): number {
  if (ownerFinancialCommitment <= 3) return 3;
  if (ownerFinancialCommitment <= 7) return 4;
  return 5;
}

/**
 * Mean trueAccuracy for this team's scouts. Blend of Owner
 * `financialCommitment` (resources) and GM `talentEvaluationAccuracy`
 * (knows how to read scouts' reports). Result clamped to a usable
 * mid-range so even the worst orgs produce some signal.
 */
export function teamScoutAccuracyMean(owner: Owner, gm: Gm): number {
  const ownerComponent = owner.spectrums.financialCommitment / 10;
  const gmComponent = gm.spectrums.talentEvaluationAccuracy / 10;
  const raw = (ownerComponent + gmComponent) / 2;
  return 0.4 + raw * 0.45;
}

export function generateScout(
  prng: Prng,
  idSeed: string,
  baseAccuracyMean: number,
): Scout {
  const name = generateName(prng);
  const age = Math.round(prng.normal(42, 8, { min: 28, max: 65 }));
  const yearsExperience = Math.max(
    1,
    Math.min(age - 22, Math.round(prng.normal(age - 30, 4, { min: 1, max: age - 22 }))),
  );

  const knownSpecialty = prng.pick(POSITION_GROUPS);

  const trueAccuracy: Record<PositionGroup, number> = {} as Record<PositionGroup, number>;
  for (const group of POSITION_GROUPS) {
    trueAccuracy[group] = clamp01(prng.normal(baseAccuracyMean, 0.1));
  }

  const specialtyBonus = prng.normal(0.1, 0.03, { min: 0.02, max: 0.2 });
  trueAccuracy[knownSpecialty] = clamp01(trueAccuracy[knownSpecialty] + specialtyBonus);

  // "Hidden depths" — Doc 4 says scouts may be unknowingly elite at a
  // group outside their known specialty. 30% chance of an extra bump
  // somewhere off-specialty.
  if (prng.next() < 0.3) {
    const offSpecialty = POSITION_GROUPS.filter((g) => g !== knownSpecialty);
    const hiddenGroup = prng.pick(offSpecialty);
    const hiddenBonus = prng.normal(0.1, 0.03, { min: 0.02, max: 0.2 });
    trueAccuracy[hiddenGroup] = clamp01(trueAccuracy[hiddenGroup] + hiddenBonus);
  }

  const quirks = pickScoutQuirks(prng);

  return {
    id: ScoutId(`SCOUT_${idSeed}`),
    name: name.fullName,
    age,
    yearsExperience,
    knownSpecialty,
    trueAccuracy,
    quirks,
  };
}

export function generateTeamScouts(
  prng: Prng,
  idSeedPrefix: string,
  owner: Owner,
  gm: Gm,
): Scout[] {
  const count = scoutStaffSize(owner.spectrums.financialCommitment);
  const accuracyMean = teamScoutAccuracyMean(owner, gm);
  const scouts: Scout[] = [];
  for (let i = 0; i < count; i++) {
    const scout = generateScout(prng.fork(`scout-${i}`), `${idSeedPrefix}_${i}`, accuracyMean);
    scouts.push(scout);
  }
  return scouts;
}

function pickScoutQuirks(prng: Prng): readonly ScoutQuirk[] {
  // 60% of scouts get 1 quirk, 40% get 2. Distinct draws.
  const count = prng.next() < 0.4 ? 2 : 1;
  const pool = [...SCOUT_QUIRK_POOL];
  prng.shuffle(pool);
  return pool.slice(0, count);
}

function clamp01(v: number): number {
  return Math.max(0.2, Math.min(0.95, v));
}
