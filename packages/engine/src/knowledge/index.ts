/**
 * Knowledge layer — the North Star boundary (docs/NORTH_STAR.md, CLAUDE.md
 * invariant #3).
 *
 * The engine stores ground truth (`Player`, full ratings, hidden ceilings,
 * scout reliability). A *game* UI never reads it. What a game UI reads is this
 * module: attributed, qualitative, source-bylined knowledge — who said what,
 * how firmly, and in words rather than numbers.
 *
 * The raw attributed-observation stores live where their systems live
 * (`types/scout.ts PlayerObservation`, `types/college.ts
 * CollegePlayerObservation` / `CoachVisitObservation`, assembled by
 * `draft/dossier.ts`); this module is the consumption surface over them. The
 * inspector is the sanctioned exception — it reads `ProspectDossier` directly
 * for the perceived/real calibration lens; `ProspectSnapshot` is the
 * game-safe projection of the same assembly.
 *
 * Growing rule: a player-facing surface that needs something not exposed here
 * extends this module — it never imports ground truth around it.
 */

export {
  prospectSnapshot,
  confidenceLabel,
  type ProspectSnapshot,
  type AttributedRemark,
  type ConfidenceLabel,
} from './snapshot.js';

// Front-office knowledge (S3, v0.140): the game-safe hot-seat feed —
// attributed, qualitative heat bands, no seat-pressure numbers.
export {
  hotSeatKnowledge,
  type HotSeatKnowledgeItem,
  type HotSeatKnowledgeOptions,
} from './front-office.js';

// The viewer concept (a team's scouting department, or a media outlet) is
// shared with the dossier assembly.
export type { DossierViewer } from '../draft/dossier.js';

// View projections for the game UI (W4 step 2, GAME_UI_FOUNDATION.md D1).
// `apps/game` imports this module and nothing else from the engine; the
// boundary is enforced mechanically by apps/game/src/boundary/engine-imports.test.ts.

// Public world facts: standings, schedule, results, the bracket.
export {
  leagueView,
  type LeagueView,
  type TeamIdentityView,
  type TeamRecordView,
  type DivisionStandingsView,
  type ConferenceSeedsView,
  type GameResultView,
  type ScheduledGameView,
  type PlayoffBracketView,
} from './league-view.js';

// The D2b coach's card: exposure-scaled, letter-banded, never numeric.
export {
  rosterView,
  playerCard,
  exposureOf,
  skillPhrase,
  VETERAN_SERVICE_YEARS,
  type RosterView,
  type RosterPlayerView,
  type CoachLetterGrade,
  type ExposureTier,
} from './roster-view.js';

// The league feed: published media + the public transaction wire. Outlet
// reliability (accuracySpectrum/hypeSpectrum) never crosses -- the player earns
// that read by watching, per the North Star.
export {
  newsView,
  type NewsItemView,
  type NewsSourceView,
  type NewsViewOptions,
} from './news-view.js';

// The box score. No driveLogView: drive logs are not persisted and a replay
// reproduced 2 of 272 games when measured -- see box-score-view.ts.
export {
  boxScoreView,
  driveLogView,
  findScheduledGame,
  type BoxScoreView,
  type BoxScoreLineView,
  type DriveLogView,
  type DriveView,
} from './box-score-view.js';

// The OPAQUE league handle + the small command surface that drives it.
// apps/game may import /types type-only, so any knowledge function returning a
// real LeagueState would reopen the boundary it enforces -- GameLeague has no
// readable members, so `league.players` is a type error rather than a policy
// violation. See game-session.ts.
export {
  newGame,
  advance,
  phaseOf,
  seedOf,
  teamChoices,
  asGameLeague,
  serializeGame,
  restoreGame,
  type GameLeague,
  type NewGameOptions,
  type GamePhaseView,
} from './game-session.js';

// The draft room: the stepped driver behind a game-safe facade. Strips the
// prospect's real tier, the raw board score, and rival need models.
export {
  openDraftRoom,
  stepDraftRoom,
  makeDraftPick,
  autoDraftPick,
  draftRoomView,
  closeDraftRoom,
  type DraftRoom,
  type DraftRoomView,
  type DraftRoomStep,
  type DraftPickView,
  type DraftBoardRowView,
  type OpenDraftRoomOptions,
} from './draft-room.js';

// The war-room wall: your department's composite and the media consensus, with
// the divergence gutter SCOUTING_PROCESS §3 is built around.
export {
  departmentBoard,
  mediaBoard,
  type BoardRowView,
  type MediaBoardRowView,
  requestVisit,
} from './board-view.js';

// The scouting beat. Reuses prospectSnapshot for every read, so there is one
// conversion path for prospect knowledge rather than two that can drift.
export {
  scoutingInbox,
  type InboxItemView,
  type ScoutBylineView,
  type ScoutingInboxOptions,
} from './scouting-inbox.js';

// Your own book. Money crosses in full (§8.3); player QUALITY does not.
export { capView, type CapView, type CapRowView } from './cap-view.js';

// The assignments screen: position-only per Daniel's scope-back. Coverage
// follows the assignment; accuracy does NOT, which is what makes
// mis-assignment bite without a bespoke penalty existing to drift.
export {
  scoutStaffView,
  assignScout,
  type ScoutStaffRowView,
} from './scout-staff.js';

// The free-agency market (D7 seam). Every component of a rival's bid stays
// hidden -- the player learns who overpays by WATCHING, which only works if the
// outcome is public and the reasoning never is.
export {
  openFreeAgency,
  stepFreeAgencyMarket,
  submitFaOffers,
  faMarketView,
  closeFreeAgency,
  type FaMarket,
  type FaMarketView,
  type FaMarketStep,
  type FaPlayerView,
  type FaSigningView,
} from './fa-market.js';
