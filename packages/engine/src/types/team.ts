import type { TeamId, OwnerId, GmId, CoachId, CoordinatorId, ScoutId, PlayerId } from './ids.js';
import type { Conference, Division, MarketSize, FranchiseHistory, CompetitiveWindow } from './enums.js';
import type { FanBaseProfile } from './personnel.js';

/**
 * Front-office lifecycle state (GM hire/fire design doc §3.1, v0.138).
 * Ground truth — the game UI never reads seat pressure; the inspector
 * (calibration lens) does.
 */
export interface FrontOfficeState {
  /** First season the current GM works(ed) for this team. */
  gmHiredSeason: number;
  /** First season the current HC works(ed) for this team. */
  hcHiredSeason: number;
  /**
   * GM who hired the current HC — the "his guy" coupling that drives
   * the firing ladder. `null` = inherited (hired by a since-departed
   * GM), which shields the current GM when this coach fails.
   */
  hcHiredByGmId: GmId | null;
  /**
   * How many of his OWN coach hires this GM has watched get fired
   * while keeping his job. 0 → next own-hire firing is "coach #1"
   * (GM usually survives); 1+ → "coach #2" (the GM goes, per the
   * zero-survivors-in-years-4-7 finding).
   */
  gmCoachFiringsSurvived: number;
  /**
   * Set when a GM survives a 2nd-own-hire firing — his seat is floored
   * near the firing threshold so a mediocre next season finishes the
   * job (the empirical "gone within 12 months" pattern).
   */
  gmLameDuck: boolean;
  /**
   * Pending vacancies: the fired person's id stays on `gmId` /
   * `headCoachId` (caretaker) until the hiring window fills the seat
   * at POST_SEASON_FINALIZE; these flags mark the seat as open.
   */
  gmVacant: boolean;
  hcVacant: boolean;
  /**
   * S2 (v0.139): an in-season HC firing installs a generated interim
   * on `headCoachId` (hcVacant stays true — the seat is still open).
   * Interims don't accumulate career stints, aren't fired again, and
   * don't trigger a TeamPersonality recompute; the hiring window
   * either promotes them (~20%, the Antonio Pierce path) or replaces
   * them.
   */
  hcInterim: boolean;
  /**
   * S4 (v0.140): seasons left on the HC's contract. Set to 5 on a
   * permanent hire, decremented each season, quietly extended back to
   * 4 when the coach has banked real credit. Cheap owners hesitate to
   * eat 3+ remaining years (threshold bump); a final-year coach is
   * cheap to move on from (threshold cut).
   */
  hcContractYearsRemaining: number;
  /**
   * Owner-confidence pressure, accumulated per season. Range ~[-60,
   * 110]: negative = banked credit (playoff runs, beating
   * expectations), above the ~70 firing threshold = gone. Hidden
   * ground truth per North Star.
   */
  seatPressure: { gm: number; hc: number };
}

/**
 * Base team identity — the immutable parts of a franchise (city, division,
 * conference, market size). These come from `packages/data/src/team-base`.
 *
 * Real NFL team names are used because GMSim is single-player and internal
 * (per project scope). If distribution ever expands, this is the layer that
 * needs to switch to fictional naming.
 */
export interface TeamIdentity {
  id: TeamId;
  /** Three-letter NFL abbreviation, e.g. 'KC', 'PHI', 'NYG'. */
  abbreviation: string;
  /** City or region, e.g. 'Kansas City', 'New England'. */
  location: string;
  /** Nickname, e.g. 'Chiefs', 'Patriots'. */
  nickname: string;
  /** Full name, e.g. 'Kansas City Chiefs'. Convenience field; equals `${location} ${nickname}`. */
  fullName: string;
  conference: Conference;
  division: Division;
  /** Per Personnel Generation doc: 8 LARGE, 14 MEDIUM, 10 SMALL. Drives fan-base baseline. */
  marketSize: MarketSize;
}

/**
 * Per-game-instance team state. Generated fresh at league creation and
 * mutated throughout the simulation. Personnel (owner/gm/hc), roster,
 * scheme, and modifiers come together here.
 *
 * Note: this is the **ground truth** record. The UI must not read this
 * directly — it must read from the knowledge layer. See docs/NORTH_STAR.md.
 */
export interface TeamState {
  identity: TeamIdentity;
  ownerId: OwnerId;
  gmId: GmId;
  headCoachId: CoachId;
  /**
   * S4 (v0.140): the coordinator tier. Resolved via
   * `LeagueState.coordinators`. Backfilled by migration on older saves.
   */
  ocId: CoordinatorId;
  dcId: CoordinatorId;
  /**
   * NFL player scouts on staff. 3–5 per team; count + accuracy mean
   * tied to Owner `financialCommitment` + GM `talentEvaluationAccuracy`
   * at league creation. Distinct from college scouts (which arrive
   * with the Draft Module). See `docs/design-docs` Doc 4.
   */
  scoutIds: readonly ScoutId[];
  /**
   * College scouts on staff — Doc 3 says 10–15 per team. Count +
   * accuracy mean track Owner `financialCommitment` + GM
   * `talentEvaluationAccuracy`, same dials as the NFL scout staff.
   * Stored as `ScoutId` (the brand) but resolved via
   * `LeagueState.collegeScouts` (NFL scouts go through `LeagueState.scouts`).
   * Empty array on pre-Draft-module saves; backfilled by migrations.
   */
  collegeScoutIds: readonly ScoutId[];
  /** Current 53-man active roster. Practice squad and reserve lists tracked separately. */
  rosterIds: readonly PlayerId[];
  /**
   * Players moved off the active roster onto injured reserve. Entries
   * sit here until the offseason heal in `advanceSeason` returns them
   * to `rosterIds`. IR players still count against the salary cap (their
   * contracts remain active) but are skipped for game-sim strength and
   * per-week injury rolls.
   */
  injuredReserveIds: readonly PlayerId[];
  /**
   * Practice squad — developmental players on cheap 1-year deals,
   * separate from the active 53. PS contracts are below the league
   * minimum and are NOT counted toward `teamCapUsage` (which iterates
   * `rosterIds`). Re-stocked each offseason. Poaching / promotion
   * mechanics land in a future slice.
   */
  practiceSquadIds: readonly PlayerId[];
  /**
   * Dead money cap charges from prior releases / trades, indexed by
   * future season offset (0 = current league year, 1 = next, …).
   * Charges shift left by one each `advanceSeason` call so index 0 is
   * always the current year.
   */
  deadMoneyByYear: readonly number[];
  /** Procedurally generated franchise history archetype. Affects fan baseline. */
  franchiseHistory: FranchiseHistory;
  /** Per-team fan-base profile. Evolves slowly with results. Feeds Team Personality. */
  fanBase: FanBaseProfile;
  /** Current competitive window state. Updated by Dynasty Cycles module each offseason. */
  competitiveWindow: CompetitiveWindow;
  /** Year-end win-loss across all simulated seasons; indexed by season number from league start. */
  seasonHistory: readonly TeamSeasonRecord[];
  /**
   * Front-office lifecycle state (v0.138). Pre-v0.138 saves backfill
   * in `migrateLeagueForward` (hired seasons = 1, zero pressure).
   */
  frontOffice: FrontOfficeState;
}

export interface TeamSeasonRecord {
  seasonNumber: number;
  wins: number;
  losses: number;
  ties: number;
  divisionFinish: number;
  madePlayoffs: boolean;
  championshipResult?: 'won_super_bowl' | 'lost_super_bowl' | 'lost_conference' | 'lost_divisional' | 'lost_wildcard';
}
