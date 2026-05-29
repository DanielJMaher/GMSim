/**
 * Public API for the GMSim engine.
 *
 * Adding a module's exports here is what "ships" it. Modules with no
 * public surface yet (game-sim, draft, trade, etc.) will land their
 * exports as they're built.
 */

export * from './types/index.js';
export { Prng } from './prng/index.js';
export type { PrngState } from './prng/index.js';

// Phase 1 — Foundation systems
export {
  generateOwner,
  generateGm,
  generateHeadCoach,
  generateFanBase,
  computeTeamPersonality,
  generateTeamPersonnel,
  OWNER_ARCHETYPES,
  GM_ARCHETYPES,
  HC_ARCHETYPES,
  OWNER_QUIRK_POOL,
  GM_QUIRK_POOL,
  HC_QUIRK_POOL,
} from './personnel/index.js';
export type { TeamPersonnelBundle, Archetype, SpectrumRange } from './personnel/index.js';

export { createLeague } from './league/index.js';
export type { CreateLeagueOptions } from './league/index.js';

// Scheme module
export {
  OFFENSIVE_SCHEMES,
  DEFENSIVE_SCHEMES,
  offensiveSchemeFit,
  defensiveSchemeFit,
  schemeFitForPlayer,
} from './scheme/index.js';
export type { OffensiveSchemeDefinition, DefensiveSchemeDefinition } from './scheme/index.js';

// Player Archetype catalog
export {
  PLAYER_ARCHETYPES,
  getArchetypeById,
  getArchetypesForPosition,
} from './archetypes/index.js';
export type { PlayerArchetype, ArchetypeId } from './archetypes/index.js';

// Player generation
export {
  generatePlayer,
  generateRoster,
  ROSTER_BLUEPRINT_53,
  ROSTER_SIZE,
  positionGroupFor,
  rollAgeProfile,
  rollSkills,
  rollDevelopmentArchetype,
  ABILITIES,
  getAbility,
  assignAbilities,
} from './players/index.js';
export type {
  GeneratePlayerOptions,
  GenerateRosterOptions,
  RosterPositionSlot,
  AgeStage,
  AgeProfile,
  TalentTier,
  RolledSkills,
  Ability,
  AbilityTier,
  AbilityFacet,
} from './players/index.js';

// Contracts + cap accounting
export {
  generateContract,
  TIER_TEMPLATES,
  deriveTier,
  signingBonusProrationPerYear,
  capHitForYear,
  currentCapHit,
  teamCapUsage,
  summarizeTeamCap,
  deadMoneyOnPreJune1Release,
  LEAGUE_MINIMUM_SALARY,
  MAX_PRORATION_YEARS,
  WEEKS_PER_LEAGUE_YEAR,
} from './contracts/index.js';
export type {
  GenerateContractOptions,
  TierTemplate,
  TeamCapSummary,
} from './contracts/index.js';

// Phase 2 — Game simulation + season runner
export { teamStrength, simulateGame } from './games/index.js';
export type { SimulateGameOptions } from './games/index.js';
export { deriveGamePlayerStats } from './games/stats.js';
export {
  generateSchedule,
  simulateSeason,
  runPlayoffs,
  computeRecords,
  sortByRecord,
  divisionStandings,
  playoffSeeds,
  winPct,
  advanceSeason,
  tickPhase,
  nextPhaseAfter,
  LIFECYCLE_ORDER,
  buildSeasonTimeline,
  REGULAR_SEASON_WEEKS,
  phaseCalendarLabel,
  phaseCalendarDate,
  formatCalendarDate,
  isTradeDeadlineWeek,
  TRADE_DEADLINE_WEEK_INDEX,
  SEASON_ONE_ANCHOR_YEAR,
  CALENDAR_ANCHORS,
  advancePlayerDevelopment,
  ageOfPlayer,
  rollRetirement,
  retirementProbabilityForAge,
  processRetirements,
  seasonStatsForLeague,
  playerSeasonStats,
  seasonAwards,
  weeklyMoodUpdate,
  moodBucket,
  moodMultiplier,
  MOOD_BUCKETS,
  MOOD_BASELINE,
  TRADE_REQUEST_THRESHOLD,
  TRADE_REQUEST_RESOLVE_THRESHOLD,
  teamChemistry,
  chemistryBucket,
  CHEMISTRY_BUCKETS,
  deriveNewsFeed,
  type TeamRecord,
  type RetirementOutcome,
  type SeasonAwards,
  type PlayerAward,
  type CoachAward,
  type MoodBucket,
  type ChemistryBucket,
  type TeamChemistry,
  type NewsItem,
  type NewsSource,
  type NewsFeedOptions,
  type CalendarDate,
  type LifecyclePhase,
  type TimelineStep,
} from './season/index.js';
export type { SimulateSeasonOptions } from './season/index.js';

// Media (v0.62)
export { generateMediaOutlets } from './media/generate.js';
export {
  generateMediaCollegeObservations,
  mediaCoverageForLevel,
} from './media/prospect-evaluators.js';
export type { MediaCoverageOptions } from './media/prospect-evaluators.js';
export { buildProspectSleeperTake } from './media/prospect-takes.js';
export {
  computeOutletMockBoard,
  computeMediaConsensusBoard,
} from './media/mock-boards.js';
export type { MockBoardEntry } from './media/mock-boards.js';
export { computeOutletQualityByGroup } from './media/media-quality.js';
export type { OutletGroupQuality } from './media/media-quality.js';
export { generateHeismanRaceReports, HEISMAN_WATCH_START_WEEK } from './media/heisman-race.js';
export {
  generateWeeklyMediaReports,
  generatePlayoffRoundMediaReports,
} from './media/reports.js';
export type {
  MediaOutlet,
  MediaTier,
  MediaFocus,
  MediaMarket,
  MediaTone,
  MediaReport,
  MediaReportBase,
  TeamWeekReport,
  PlayerTakeReport,
  ProspectBoardReport,
  NarrativeReport,
} from './types/media.js';
export type { MediaOutletId, MediaReportId } from './types/ids.js';

// Roster transactions
export {
  releasePlayer,
  freeAgents,
  freeAgentsByPosition,
  signFreeAgent,
  makeFreeAgentContract,
  applyContractExpirations,
  applyCapCuts,
  refillRosters,
  auctionFreeAgent,
  computeTeamCashBid,
  computePlayerPreference,
  computePlayerPreferenceBreakdown,
  executeTrade,
  runWeeklyNpcTrades,
  runProactiveTrades,
} from './transactions/index.js';
export type {
  SignFreeAgentOptions,
  TradePayload,
  TradeMetadata,
  FaAuctionResult,
  FaBidderDetail,
  PreferenceFactors,
} from './transactions/index.js';

// Trade-value evaluator (Doc 14 5-factor + Doc 5 pick valuation)
export {
  evaluatePlayerValue,
  evaluateTradePackage,
  evaluatePickValue,
} from './trade/value.js';
export type {
  PlayerValueBreakdown,
  PickValueBreakdown,
  TradePackageEvaluation,
  ValueFactor,
} from './trade/value.js';

// Scouting — Doc 4
export {
  generateScout,
  generateTeamScouts,
  scoutStaffSize,
  teamScoutAccuracyMean,
  generateInitialObservations,
  regenerateWatchLists,
  advanceScoutingCycle,
  SCOUT_QUIRK_POOL,
  quirkEffect,
  composedQuirkEffect,
} from './scouting/index.js';
export type { QuirkEffect } from './scouting/index.js';

// Draft — Doc 3
//   slice 1: college player substrate (v0.32.0)
//   slice 2: college scouts + observations (v0.33.0)
export {
  generateCollegePlayer,
  pickCollegePosition,
  generateInitialCollegePool,
  advanceCollegePool,
  collegePrngForLeague,
  rollMeasurables,
  rollPersonalityVoice,
  rollHiddenIntangibles,
  rollCharacterFlags,
  rollBloodline,
  rollInjuryHistory,
  rollStarRating,
  rollNationalRank,
  rollHometown,
  deriveBackground,
  rollRecruitingProfile,
  rollCollegeStats,
  rollPositionProjection,
  pickTrueArchetype,
  pickAssumedArchetype,
  COLLEGE_SCHOOLS,
  CONFERENCES,
  getSchoolById,
  getSchoolsByTier,
  // slice 2 — college scouts
  generateCollegeScout,
  generateTeamCollegeScouts,
  collegeScoutStaffSize,
  teamCollegeScoutAccuracyMean,
  generateInitialCollegeObservations,
  generateCollegeObservation,
  advanceCollegeScoutingCycle,
  // slice 3 — per-team draft boards
  regenerateDraftBoards,
  regenerateDraftBoardsForLeague,
  // slice 4 — combine + pro days
  runCombine,
  rollCombineResults,
  runProDays,
  // slice 5a — junior declaration + single-round draft
  rollJuniorDeclarations,
  computeDraftOrder,
  promoteProspectToPlayer,
  promoteProspectToFreeAgent,
  runDraft,
  applyDraftResult,
  // slice 5c — UDFA pipeline
  runUdfaPromotion,
  applyUdfaResult,
  // slice 6 — head-coach visits
  runCoachVisits,
  applyCoachVisits,
  coachVisitAccuracy,
  // Doc 5 — pick value chart (base)
  BASE_PICK_VALUES,
  FUTURE_YEAR_DISCOUNTS,
  pickValue,
  valueOfPicks,
  comparePickPackages,
  roundForOverallPick,
  // Doc 5 follow-on — DraftPickAsset infrastructure
  generateInitialDraftPicks,
  advancePickHorizon,
  picksForRoundInSlotOrder,
  consumePicks,
  buildSlotMap,
  pickOwnershipByTeam,
  DRAFT_PICK_HORIZON_YEARS,
  DRAFT_PICK_ROUNDS,
  // v0.50 — consensus board diagnostic
  computeConsensusBoard,
  consensusRankIndex,
  // v0.55 — team-needs scorer
  computeTeamNeeds,
} from './draft/index.js';
export type {
  PromoteOptions,
  PromoteResult,
  RunDraftOptions,
  DraftRunResult,
  RunUdfaPromotionOptions,
  UdfaPromotionResult,
  RunCoachVisitsOptions,
  PickReference,
  PickTradeEvaluation,
  ConsensusBoardEntry,
  PositionNeed,
} from './draft/index.js';
export type {
  GenerateCollegePlayerOptions,
  GenerateInitialCollegePoolOptions,
  AdvanceCollegePoolOptions,
  AdvanceCollegePoolResult,
  RollMeasurablesOptions,
  RollCharacterFlagsOptions,
  RollRecruitingProfileOptions,
  RollCollegeStatsOptions,
} from './draft/index.js';

// College Football Season — v0.63
//   slice 1: full NCAA structure (regular season + conf champs + bowls + CFP)
export {
  collegeTeamStrength,
  bucketProspectsBySchool,
  generateCollegeRegularSeason,
  COLLEGE_REGULAR_SEASON_WEEKS,
  simulateCollegeGame,
  deriveCollegeGamePlayerStats,
  computeCollegeRecords,
  sortCollegeSchoolsByRecord,
  buildConferenceChampionships,
  conferenceChampions,
  buildCfpBracket,
  buildCfpQuarterfinals,
  buildCfpSemifinals,
  buildCfpFinal,
  buildBowlSlate,
  runAllStarShowcase,
  prospectTalentScore,
  aggregateCollegeSeasonStats,
  collegeStatLeaders,
  latestCollegeSeasonTick,
  heismanScore,
  selectHeisman,
} from './college-season/index.js';
export type {
  SimulateCollegeGameOptions,
  AllStarShowcaseOptions,
  AllStarShowcaseResult,
} from './college-season/index.js';

// Static reference content (32 NFL teams + name pools)
export { NFL_TEAMS, getTeamByAbbreviation, getTeamsByDivision, getTeamsByConference } from './data/team-base/index.js';
export { FIRST_NAMES, LAST_NAMES } from './data/name-pools/index.js';
