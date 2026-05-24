export {
  collegeTeamStrength,
  bucketProspectsBySchool,
} from './strength.js';

export {
  generateCollegeRegularSeason,
  COLLEGE_REGULAR_SEASON_WEEKS,
} from './schedule.js';

export { simulateCollegeGame } from './outcome.js';
export type { SimulateCollegeGameOptions } from './outcome.js';

export { deriveCollegeGamePlayerStats } from './stats.js';

export {
  computeCollegeRecords,
  sortByRecord as sortCollegeSchoolsByRecord,
} from './records.js';

export {
  buildConferenceChampionships,
  conferenceChampions,
  buildCfpBracket,
  buildCfpQuarterfinals,
  buildCfpSemifinals,
  buildCfpFinal,
  buildBowlSlate,
} from './postseason.js';

export {
  runAllStarShowcase,
  prospectTalentScore,
} from './all-star.js';
export type {
  AllStarShowcaseOptions,
  AllStarShowcaseResult,
} from './all-star.js';
