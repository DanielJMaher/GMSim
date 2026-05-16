/**
 * Draft Module — Doc 3.
 *
 * Slice 1 (v0.32.0) ships the College Player substrate: a deep
 * `CollegePlayer` entity with school/conference, recruiting profile,
 * combine-shape measurables, archetype + assumed-archetype tension,
 * character flags, personality voice, bloodline, injury history,
 * per-year college stats, and pool generation/advance primitives.
 *
 * Future slices in this lane:
 *   - Slice 2: College scouts + observations
 *   - Slice 3: 32 internal draft boards (watch-list-shaped, scheme-fit-aware)
 *   - Combine, pro days, war room, draft event itself, media outlets,
 *     coach visits, post-season film study, position-conversion ID,
 *     week-by-week college stats progression — each its own future slice.
 */

export {
  generateCollegePlayer,
  pickCollegePosition,
  type GenerateCollegePlayerOptions,
} from './generate-college-player.js';

export {
  generateInitialCollegePool,
  advanceCollegePool,
  collegePrngForLeague,
  type GenerateInitialCollegePoolOptions,
  type AdvanceCollegePoolOptions,
  type AdvanceCollegePoolResult,
} from './pool.js';

export { rollMeasurables, type RollMeasurablesOptions } from './measurables.js';

export {
  rollPersonalityVoice,
  rollHiddenIntangibles,
  rollCharacterFlags,
  rollBloodline,
  rollInjuryHistory,
  type RollCharacterFlagsOptions,
} from './character.js';

export {
  rollStarRating,
  rollNationalRank,
  rollHometown,
  deriveBackground,
  rollRecruitingProfile,
  type RollRecruitingProfileOptions,
} from './recruiting.js';

export { rollCollegeStats, type RollCollegeStatsOptions } from './college-stats.js';

export {
  rollPositionProjection,
  pickTrueArchetype,
  pickAssumedArchetype,
} from './conversion.js';

export {
  COLLEGE_SCHOOLS,
  CONFERENCES,
  getSchoolById,
  getSchoolsByTier,
} from '../data/colleges/index.js';

// Slice 2: College scouts + observations
export {
  generateCollegeScout,
  generateTeamCollegeScouts,
  collegeScoutStaffSize,
  teamCollegeScoutAccuracyMean,
} from './college-scout.js';

export {
  generateInitialCollegeObservations,
  generateCollegeObservation,
} from './college-observation.js';

export { advanceCollegeScoutingCycle } from './college-cycle.js';
