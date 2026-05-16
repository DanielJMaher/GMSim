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

// Slice 3: per-team draft boards
export { regenerateDraftBoards, regenerateDraftBoardsForLeague } from './board.js';

// Slice 4: combine + pro days
export { runCombine, rollCombineResults } from './combine.js';
export { runProDays } from './pro-days.js';

// Slice 5a: junior declaration + single-round draft
export { rollJuniorDeclarations } from './declaration.js';
export { computeDraftOrder } from './draft-order.js';
export { promoteProspectToPlayer, promoteProspectToFreeAgent } from './promote.js';
export type { PromoteOptions, PromoteResult } from './promote.js';
export { runDraft, applyDraftResult } from './event.js';
export type { RunDraftOptions, DraftRunResult } from './event.js';

// Slice 5c (UDFA): undrafted-rookie-FA pipeline
export { runUdfaPromotion, applyUdfaResult } from './udfa.js';
export type { RunUdfaPromotionOptions, UdfaPromotionResult } from './udfa.js';

// Slice 6: head-coach visits during NFL bye weeks
export {
  runCoachVisits,
  applyCoachVisits,
  coachVisitAccuracy,
} from './coach-visits.js';
export type { RunCoachVisitsOptions } from './coach-visits.js';

// Slice (Doc 5): pick value chart — base
export {
  BASE_PICK_VALUES,
  FUTURE_YEAR_DISCOUNTS,
  pickValue,
  valueOfPicks,
  comparePickPackages,
  roundForOverallPick,
} from './pick-value.js';
export type { PickReference, PickTradeEvaluation } from './pick-value.js';
