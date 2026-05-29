/**
 * Centralized skill-key taxonomy (player-model overhaul, Stage 2).
 *
 * Single source of truth for which keys exist on `PlayerSkills`, what
 * development category each belongs to, and — for the granular skills —
 * which legacy "umbrella" skill they roll under. Both player generation
 * (`players/skills.ts`) and development (`season/development.ts`) import
 * from here so the two can't drift.
 *
 * ## Granular vs umbrella (additive design)
 *
 * The original model had coarse umbrella techniques (`passRushTechnique`,
 * `coverageTechnique`, …). Those are KEPT — ~30 consumers read them — but
 * are now joined by Madden-style **granular** attributes (specific
 * pass-rush moves, QB placement + spectacular, WR releases, coverage
 * man/zone/press, etc.). Each granular declares a `parent` umbrella; at
 * generation a granular's archetype weight defaults to its parent's
 * weight unless the archetype overrides it specifically — so existing
 * archetype definitions automatically bias the new granulars, and
 * specialization (speed-rush vs power-rush edge) comes from a few
 * per-archetype granular overrides.
 */

import type { PlayerSkills } from '../types/player.js';

export type SkillCategory = 'physical' | 'technical' | 'mental' | 'stable';
type SkillKey = keyof PlayerSkills;

/** Physical / athletic. Peak early, decline late. */
export const PHYSICAL_KEYS: readonly SkillKey[] = [
  'speed',
  'acceleration',
  'agility',
  'changeOfDirection',
  'strength',
  'jumping',
  'stamina',
  'durability',
];

/** Mental. Grow through prime. */
export const MENTAL_KEYS: readonly SkillKey[] = [
  'footballIq',
  'playRecognition',
  'decisionMaking',
  'composure',
];

/** Stable traits. Barely move over a career. */
export const STABLE_KEYS: readonly SkillKey[] = ['leadership', 'competitiveness', 'workEthic', 'coachability'];

/** Legacy umbrella techniques — kept for back-compat; rolled independently. */
export const UMBRELLA_KEYS: readonly SkillKey[] = [
  'technicalSkill',
  'handsBallSkills',
  'blockingTechnique',
  'passRushTechnique',
  'coverageTechnique',
  'tacklingTechnique',
];

/**
 * Granular technique skills → their parent umbrella. A granular's
 * archetype weight defaults to its parent's weight (see
 * `effectiveSkillWeight`). All are development-category `technical`.
 */
export const GRANULAR_PARENT: Readonly<Record<string, SkillKey>> = {
  // QB passing
  throwPower: 'technicalSkill',
  accuracyShort: 'technicalSkill',
  accuracyMedium: 'technicalSkill',
  accuracyDeep: 'technicalSkill',
  accuracyLeft: 'technicalSkill',
  accuracyMiddle: 'technicalSkill',
  accuracyRight: 'technicalSkill',
  throwOnRun: 'technicalSkill',
  throwUnderPressure: 'technicalSkill',
  spectacularThrow: 'technicalSkill',
  breakSack: 'technicalSkill',
  playAction: 'technicalSkill',
  // Ball carrier
  carrying: 'technicalSkill',
  ballCarrierVision: 'technicalSkill',
  jukeMove: 'technicalSkill',
  spinMove: 'technicalSkill',
  stiffArm: 'technicalSkill',
  trucking: 'technicalSkill',
  breakTackle: 'technicalSkill',
  elusiveness: 'technicalSkill',
  // Receiving — routes/releases under technicalSkill, catching under handsBallSkills
  routeShort: 'technicalSkill',
  routeMedium: 'technicalSkill',
  routeDeep: 'technicalSkill',
  releaseVsPress: 'technicalSkill',
  releaseVsOff: 'technicalSkill',
  catching: 'handsBallSkills',
  catchInTraffic: 'handsBallSkills',
  contestedCatch: 'handsBallSkills',
  // Blocking
  runBlockPower: 'blockingTechnique',
  runBlockFinesse: 'blockingTechnique',
  passBlockPower: 'blockingTechnique',
  passBlockFinesse: 'blockingTechnique',
  impactBlock: 'blockingTechnique',
  leadBlock: 'blockingTechnique',
  // Pass rush — power moves
  bullRush: 'passRushTechnique',
  longArm: 'passRushTechnique',
  pushPull: 'passRushTechnique',
  // Pass rush — finesse moves
  swimMove: 'passRushTechnique',
  ripMove: 'passRushTechnique',
  spinRush: 'passRushTechnique',
  crossChop: 'passRushTechnique',
  ghostMove: 'passRushTechnique',
  // Pass rush — fundamentals
  getOff: 'passRushTechnique',
  bend: 'passRushTechnique',
  handTechnique: 'passRushTechnique',
  // Run defense / tackling
  blockShedding: 'tacklingTechnique',
  tackle: 'tacklingTechnique',
  hitPower: 'tacklingTechnique',
  pursuit: 'tacklingTechnique',
  // Coverage
  manCoverage: 'coverageTechnique',
  zoneCoverage: 'coverageTechnique',
  pressCoverage: 'coverageTechnique',
  ballSkills: 'coverageTechnique',
  // Special teams
  kickPower: 'technicalSkill',
  kickAccuracy: 'technicalSkill',
  puntPower: 'technicalSkill',
  puntAccuracy: 'technicalSkill',
};

export const GRANULAR_KEYS: readonly SkillKey[] = Object.keys(GRANULAR_PARENT) as SkillKey[];

/** Every key on PlayerSkills — the roll set + development iteration set. */
export const ALL_SKILL_KEYS: readonly SkillKey[] = [
  ...PHYSICAL_KEYS,
  ...MENTAL_KEYS,
  ...STABLE_KEYS,
  ...UMBRELLA_KEYS,
  ...GRANULAR_KEYS,
];

const PHYSICAL_SET = new Set<string>(PHYSICAL_KEYS);
const MENTAL_SET = new Set<string>(MENTAL_KEYS);
const STABLE_SET = new Set<string>(STABLE_KEYS);

export function categoryFor(key: SkillKey): SkillCategory {
  if (PHYSICAL_SET.has(key)) return 'physical';
  if (MENTAL_SET.has(key)) return 'mental';
  if (STABLE_SET.has(key)) return 'stable';
  return 'technical'; // umbrellas + granulars
}

/**
 * Archetype weight for a skill: an explicit per-skill weight wins;
 * otherwise a granular inherits its parent umbrella's weight; otherwise
 * neutral (1.0).
 */
export function effectiveSkillWeight(
  skillWeights: Partial<Record<SkillKey, number>>,
  key: SkillKey,
): number {
  const explicit = skillWeights[key];
  if (explicit !== undefined) return explicit;
  const parent = GRANULAR_PARENT[key];
  if (parent !== undefined) {
    const inherited = skillWeights[parent];
    if (inherited !== undefined) return inherited;
  }
  return 1.0;
}
