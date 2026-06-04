import type { PlayerId, ScoutId, TeamId, ContractId, CoachId, DraftPickId } from './ids.js';
import type { Position, PositionGroup } from './enums.js';
import type {
  PlayerSkills,
  PlayerDevelopmentArchetype,
  TalentTier,
  ArchetypeId,
} from './player.js';
import type { ScoutQuirk } from './scout.js';

/**
 * College class year. Drives draft eligibility and skill maturity:
 *   TRUE_FR / RS_FR / SO  — not eligible
 *   JR / SR / RS_SR       — eligible (juniors must declare to enter)
 *
 * Per the Draft Module design, college players are evaluated across
 * multiple years. A junior with 2 college seasons of tape looks
 * different to scouts than a one-year breakout senior.
 */
export type ClassYear = 'TRUE_FR' | 'RS_FR' | 'SO' | 'JR' | 'SR' | 'RS_SR';

/**
 * Conference tier — used by scouts/media to weight signal quality.
 * SEC tape is graded harder than MAC tape; an SEC corner facing
 * NFL-bound receivers every week reveals more than a MAC corner does.
 *
 *   POWER     — SEC, Big Ten, ACC, Big 12 (and recent merger oddities)
 *   GROUP_OF_5 — AAC, Mountain West, MAC, Sun Belt, C-USA
 *   FCS       — non-FBS Division I
 *   SMALL     — DII / DIII / NAIA
 *
 * Slice 1 carries this as a tag; later slices use it to bias
 * scout coverage decisions and observation noise.
 */
export type ConferenceTier = 'POWER' | 'GROUP_OF_5' | 'FCS' | 'SMALL';

/**
 * Recruiting star rating — 247Sports/Rivals composite shorthand.
 * Distribution is heavily skewed: 5-stars are extremely rare, 1-2
 * stars dominate the population. Correlates LOOSELY with NFL ceiling
 * — high-star recruits hit at higher rates, but bust + small-school
 * gem narratives are real and frequent enough to matter.
 */
export type StarRating = 1 | 2 | 3 | 4 | 5;

/**
 * Where a prospect comes from at a high level. Tags the narrative arc
 * scouts/media tell about the player. Hidden facts about pedigree
 * still exist in the underlying data; this is the genre tag.
 *
 *   PEDIGREE          — high-recruit, marquee program, expected NFL prospect
 *   BIG_PROGRAM       — solid recruit, P5 program, on the radar
 *   DEVELOPMENTAL     — mid-tier recruit who improved year-over-year at a big school
 *   SMALL_SCHOOL_GEM  — high talent at a low-tier school; coverage gap risk
 *   WALK_ON_STORY     — unrecruited, made his way; rare but powerful narrative
 *   TRANSFER          — moved between schools; arc is broken across programs
 */
export type RecruitingBackground =
  | 'PEDIGREE'
  | 'BIG_PROGRAM'
  | 'DEVELOPMENTAL'
  | 'SMALL_SCHOOL_GEM'
  | 'WALK_ON_STORY'
  | 'TRANSFER';

/**
 * Personality "voice" — drives the eventual blurb-generator tone in
 * later slices (scout reports, coach reports, media). Distinct from
 * mental skills (which are the *content* of intangibles); voice is
 * *how* the prospect comes across in interviews / locker rooms.
 *
 *   QUIET_WORKER  — heads-down grinder, lets tape talk
 *   ALPHA_LEADER  — commands the room, vocal captain type
 *   BRASH         — confident-bordering-on-arrogant; great or grating
 *   ANALYTICAL    — film-junkie, articulate about scheme
 *   INSTINCTIVE   — "just plays football", limited verbal articulation
 *   CHARISMATIC   — media gold; magnetic personality
 *
 * Same skill profile + different voice = noticeably different
 * scout-report flavor. Per North Star, voice is hidden ground truth;
 * it surfaces only through observation language.
 */
export type PersonalityVoice =
  | 'QUIET_WORKER'
  | 'ALPHA_LEADER'
  | 'BRASH'
  | 'ANALYTICAL'
  | 'INSTINCTIVE'
  | 'CHARISMATIC';

/**
 * Discrete narrative flags attached to the prospect — observable
 * facts that affect perception independent of the underlying skills.
 * A prospect can carry multiple flags; some are mutually exclusive
 * in practice (CAPTAIN + COACH_CONFLICT is implausible).
 *
 *   OFF_FIELD_INCIDENT    — arrest, suspension, public-record problem
 *   COACH_CONFLICT        — open friction with college HC
 *   INJURY_PRONE          — recurring injuries in college (count > 2)
 *   LATE_BLOOMER          — didn't start until JR/SR; tape sample short
 *   TRANSFER_PORTAL       — transferred mid-career; redundant with
 *                           background=TRANSFER but kept for query clarity
 *   CAPTAIN               — voted team captain — leadership signal
 *   ACADEMIC_HONORS       — strong academic standing — football IQ proxy
 *   MEDIA_DARLING         — beloved by college press; hype distorted upward
 *   PRACTICE_LEGEND       — coaches rave about practice habits
 *   WORKOUT_WARRIOR       — tests great but tape is meh
 *   TAPE_STAR_POOR_TESTER — tape is a yes; combine numbers will hurt them
 *   SYSTEM_PRODUCT        — production inflated by college scheme/scheme-mates
 *   LEGACY                — NFL bloodline — see `bloodline` for the relation
 */
export type CharacterFlag =
  | 'OFF_FIELD_INCIDENT'
  | 'COACH_CONFLICT'
  | 'INJURY_PRONE'
  | 'LATE_BLOOMER'
  | 'TRANSFER_PORTAL'
  | 'CAPTAIN'
  | 'ACADEMIC_HONORS'
  | 'MEDIA_DARLING'
  | 'PRACTICE_LEGEND'
  | 'WORKOUT_WARRIOR'
  | 'TAPE_STAR_POOR_TESTER'
  | 'SYSTEM_PRODUCT'
  | 'LEGACY';

/**
 * Bloodline relation if the prospect has NFL family. Affects how
 * scouts/media frame the prospect — pedigree is a real factor in
 * pre-draft narratives. Hidden in the engine sense that the
 * eventual UI will surface "father played in the league" as a
 * descriptive narrative tag, not as a numerical value.
 */
export type BloodlineRelation = 'FATHER' | 'BROTHER' | 'UNCLE' | 'COUSIN';

export interface Bloodline {
  hasNflFamily: boolean;
  /** null when `hasNflFamily` is false. */
  relation: BloodlineRelation | null;
  /** null when `hasNflFamily` is false. Free-form name string. */
  relativeName: string | null;
  /** Whether the relative made a Pro Bowl / All-Pro tier. Pure narrative. */
  relativeWasStar: boolean;
}

/**
 * A college school. Real-ish names + conferences. Slice 1 ships a
 * static catalog (see `engine/src/data/colleges`). Schools are
 * referenced by id; the catalog provides display name + conference.
 */
export interface CollegeSchool {
  /** Stable internal id, e.g. "ALABAMA". */
  readonly id: string;
  /** Display name, e.g. "Alabama". */
  readonly name: string;
  /** Conference id (e.g. "SEC"). */
  readonly conferenceId: string;
  /** Conference tier. Drives signal weight. */
  readonly tier: ConferenceTier;
  /** Two-letter US state code. Used for hometown cohesion + region. */
  readonly state: string;
}

export interface CollegeConference {
  readonly id: string;
  readonly name: string;
  readonly tier: ConferenceTier;
}

/**
 * Hometown — city + US state. Drives regional scout coverage in
 * later slices (a scout based in the Southeast covers SEC + ACC +
 * regional small schools more efficiently). Slice 1 carries the
 * data; coverage logic lands in slice 2.
 */
export interface Hometown {
  city: string;
  state: string;
}

/**
 * Combine-shape physical measurables. Held as ground truth on the
 * prospect. The eventual Combine slice produces *reported* values
 * (with measurement noise). For slice 1, these are the underlying
 * truth — scouts haven't measured the prospect yet, so nothing is
 * exposed via the knowledge layer.
 *
 * Independent of `PlayerSkills.speed` etc. — a player can post a
 * great 40 (raw measurable) and still play slow on tape (skill).
 * That gap is the workout-warrior / tape-star tension the doc
 * calls out repeatedly.
 */
export interface Measurables {
  /** Height in inches. */
  heightInches: number;
  /** Weight in pounds. */
  weightLbs: number;
  /** Arm length in inches. Matters for OL/DB/DL evaluation. */
  armLengthInches: number;
  /** Hand size in inches. Matters for QB/WR/DB grip. */
  handSizeInches: number;
  /** 40-yard dash, seconds. */
  fortyYardSeconds: number;
  /** Bench press 225-lb reps. */
  benchPress225Reps: number;
  /** Vertical jump in inches. */
  verticalInches: number;
  /** Broad jump in inches. */
  broadJumpInches: number;
  /** 3-cone drill, seconds. */
  threeConeSeconds: number;
  /** 20-yard shuttle, seconds. */
  shuttleSeconds: number;
}

/**
 * One college season's statistical output. Slice 1 ships
 * season-totals; week-by-week progression lands when the college
 * season simulation does (deferred — significant scope of its own).
 *
 * Stats are position-correlated — a QB has passing/rushing fields
 * filled, a DL has tackles/sacks, etc. Zero where not applicable;
 * mirrors the NFL `PlayerSeasonStats` shape so the eventual
 * scouting UI can render college years and pro years with the
 * same components.
 */
export interface CollegeSeasonStats {
  /** Class year the prospect held during this season. */
  classYear: ClassYear;
  /** School id during this season — captures transfers. */
  schoolId: string;
  /** Games played. */
  games: number;
  /** Games started. */
  starts: number;

  // Passing
  passAttempts: number;
  passCompletions: number;
  passingYards: number;
  passingTds: number;
  interceptionsThrown: number;

  // Rushing
  rushingAttempts: number;
  rushingYards: number;
  rushingTds: number;

  // Receiving
  targets: number;
  receptions: number;
  receivingYards: number;
  receivingTds: number;

  // Defense
  tackles: number;
  sacks: number;
  interceptions: number;
  passesDefended: number;
  forcedFumbles: number;
}

/**
 * One past injury during the prospect's college career. Doctors and
 * team medical staffs evaluate this in later slices. Slice 1 carries
 * the data; medical-evaluation surface comes when combine + medical
 * staff systems land.
 */
export interface CollegeInjury {
  /** Description label, e.g. "ACL", "high ankle sprain", "concussion". */
  label: string;
  /** Class year the injury occurred. */
  classYear: ClassYear;
  /** Severity tier — affects medical-eval weight. */
  severity: 'MINOR' | 'MODERATE' | 'MAJOR';
  /** Games missed because of the injury. */
  gamesMissed: number;
}

/**
 * Recruiting profile — the story the prospect carried into college.
 * Some 5-star recruits flame out, some walk-ons turn into stars.
 * Star rating correlates with NFL ceiling but with significant
 * noise; the engine respects this with a deliberate noise term.
 */
export interface RecruitingProfile {
  starRating: StarRating;
  /**
   * National recruiting rank (top 300). Null if unranked / outside
   * the top 300 — typical for 1–2 star recruits.
   */
  nationalRank: number | null;
  /** Where the prospect grew up. */
  hometown: Hometown;
  /** Narrative arc tag. */
  background: RecruitingBackground;
}

/**
 * Hidden personality dials affecting perception independent of
 * `PlayerSkills`. These are the things coach visits + interviews +
 * locker-room observation reveal in later slices. Per North Star
 * never displayed numerically; the eventual UI surfaces them through
 * descriptive language only.
 *
 *   leadershipPresence — how the prospect carries themselves; coach-visit
 *                        evaluation lane.
 *   interviewSkill     — how well they present in formal interviews
 *                        (combine meetings, team meetings).
 *   workEthic          — observable through year-over-year improvement
 *                        and practice-habit reports.
 *   coachability       — how they respond to correction. Subtle.
 *   competitiveness    — bring-it-every-snap factor.
 *   footballCharacter  — distinct from off-field. Are they a film-room
 *                        guy? Do they study? Different from raw IQ.
 */
export interface HiddenIntangibles {
  leadershipPresence: number;
  interviewSkill: number;
  workEthic: number;
  coachability: number;
  competitiveness: number;
  footballCharacter: number;
}

/**
 * The full college prospect record. Lives on `LeagueState.collegePool`.
 * Promoted to a `Player` when drafted (future slice owns the conversion).
 *
 * Hidden ground truth fields:
 *   `current`, `ceiling`, `archetype`, `tier`, `developmentArchetype`,
 *   `nflProjectedPosition`, `hiddenIntangibles`, `personalityVoice`,
 *   `measurables` (until combined / scouted).
 *
 * Visible-ish (revealed through scouts / media / coaches in later slices):
 *   `assumedArchetype` (what college coaching is calling them),
 *   `recruiting` (public record), `school`, `classYear`, `bloodline`
 *   (public knowledge), `characterFlags` (some public, some privileged),
 *   `collegeStats`.
 *
 * Per North Star: a UI prop typed as `{ speed: 88 }` is a bug. The
 * eventual draft-board UI must read through the knowledge layer with
 * attribution + per-skill confidence. Slice 1 ships the engine-side
 * truth; slice 2 ships the scouts who observe it.
 */
export interface CollegePlayer {
  /**
   * Player id — shared namespace with NFL `Player.id` so that the
   * future draft-event slice can promote a prospect to a player
   * without remapping references. Carries a `CP_` prefix so
   * inspection can tell college-stage records apart at a glance.
   */
  id: PlayerId;
  firstName: string;
  lastName: string;

  // ── Identity ────────────────────────────────────────────────────────
  schoolId: string;
  classYear: ClassYear;
  /**
   * True iff `classYear` ∈ {JR, SR, RS_SR}. Eligible-but-not-declared
   * juniors are still in the pool; the draft event will gate on
   * `hasDeclared`.
   */
  isDraftEligible: boolean;
  /**
   * True iff the prospect has declared for the upcoming draft.
   * Seniors are auto-declared; juniors roll a declaration each
   * offseason. False juniors stay in the pool another year.
   */
  hasDeclared: boolean;
  /**
   * True iff this prospect explicitly chose to return to college
   * (a JR who rolled non-declare). Distinct from "hasDeclared=false"
   * — a fresh JR who hasn't had their declaration roll yet is
   * `hasDeclared=false` AND `hasReturnedToSchool=false` (i.e.,
   * pending; still on the board). A JR who actively decided to
   * return has `hasReturnedToSchool=true` and is removed from
   * draft boards until the next aging cycle resets the flag (when
   * they age into SR and auto-declare).
   *
   * v0.53.1+. Pre-v0.53.1 saves backfill to `false`.
   */
  hasReturnedToSchool: boolean;

  /** Birthdate in ISO YYYY-MM-DD; age derived from sim clock. */
  birthDate: string;

  // ── Position + projection ────────────────────────────────────────────
  /** Position they play in college. */
  collegePosition: Position;
  /**
   * Position scouts/coaches who get them right project them to play
   * in the NFL. Same as `collegePosition` for non-converters. The
   * realistic conversion examples from Doc 3:
   *   college DE → NFL OLB (3-4)
   *   college S  → NFL CB
   *   college TE → NFL OL
   *   college RB → NFL WR
   *   college WR → NFL S
   *
   * Hidden ground truth — only revealed through evaluation in later
   * slices.
   */
  nflProjectedPosition: Position;
  /** True iff `nflProjectedPosition !== collegePosition`. Convenience flag. */
  isConversionCandidate: boolean;
  /** Realistic alternate positions a creative team might consider. */
  alternatePositions: readonly Position[];

  // ── Hidden skill state (mirrors NFL Player exactly) ──────────────────
  current: PlayerSkills;
  ceiling: PlayerSkills;
  developmentArchetype: PlayerDevelopmentArchetype;
  /** NFL talent tier they project to. NOT what they look like in college. */
  tier: TalentTier;

  // ── Archetype tension ────────────────────────────────────────────────
  /** True NFL archetype — ground truth. */
  archetype: ArchetypeId;
  /**
   * What college coaching + media is currently calling them. Often
   * matches `archetype`; for conversion candidates and miscast
   * prospects, diverges. The gap between assumed and true is the
   * "scout could miss this" axis from Doc 3.
   */
  assumedArchetype: ArchetypeId;
  /** Convenience flag: archetype !== assumedArchetype. */
  archetypeMisreadFlag: boolean;

  // ── Physical ─────────────────────────────────────────────────────────
  measurables: Measurables;

  // ── Hidden personality ───────────────────────────────────────────────
  hiddenIntangibles: HiddenIntangibles;
  personalityVoice: PersonalityVoice;

  // ── Public-facing pre-draft narrative ────────────────────────────────
  recruiting: RecruitingProfile;
  bloodline: Bloodline;
  /** Narrative + descriptive flags attached to the prospect. */
  characterFlags: readonly CharacterFlag[];
  /**
   * Played a second varsity sport in high school (basketball / track / baseball
   * is the common trio). The overwhelming majority of real NFL prospects did
   * (~82% in the Beast bios) — a baseline athleticism cue, slightly more common
   * for skill / DB athletes and rarer in the trenches. Pure narrative.
   */
  multiSportBackground: boolean;
  /** Past injuries through their college career. */
  injuryHistory: readonly CollegeInjury[];

  // ── Production ───────────────────────────────────────────────────────
  /**
   * Per-class-year stat snapshots. Always at least one entry (the
   * year they're currently playing through). Empty for true freshmen
   * who haven't finished their first season. Length grows with each
   * year they remain in the pool.
   */
  collegeStats: readonly CollegeSeasonStats[];
}

// ─── College Scout (Doc 3) ──────────────────────────────────────────────

/**
 * Regional preference for a college scout. Doc 3:
 *
 *   "All 32 teams deploy scouts to regions and schools based on the
 *    college football schedule simultaneously. Coverage competition —
 *    when multiple teams deploy scouts to the same region or school,
 *    the quality of intelligence gathered is affected."
 *
 * Slice 2 ships `preferredRegion` as a soft attribute that affects
 * accuracy bonus when evaluating prospects from that region. Active
 * deployment (where the scout actually traveled this week) is a
 * later slice — depends on a college-football schedule simulation.
 *
 *   NATIONAL — no preferred region; uniform accuracy across all states.
 *   <region> — bonus when evaluating prospects whose hometown OR
 *              school state falls in this region.
 */
export type ScoutRegion =
  | 'NATIONAL'
  | 'NORTHEAST'    // CT, MA, ME, NH, NJ, NY, PA, RI, VT
  | 'SOUTHEAST'    // AL, FL, GA, MS, NC, SC, TN, VA, WV
  | 'MIDWEST'      // IA, IL, IN, KS, KY, MI, MN, MO, ND, NE, OH, SD, WI
  | 'SOUTHWEST'    // AR, LA, NM, OK, TX
  | 'WEST';        // AK, AZ, CA, CO, HI, ID, MT, NV, OR, UT, WA, WY

/**
 * Map US 2-letter state codes to scout regions. Used by the college
 * observation generator to apply a regional accuracy bonus when a
 * scout's `preferredRegion` matches a prospect's hometown/school.
 */
export const STATE_TO_REGION: Readonly<Record<string, ScoutRegion>> = {
  AL: 'SOUTHEAST', AK: 'WEST', AZ: 'WEST', AR: 'SOUTHWEST', CA: 'WEST',
  CO: 'WEST', CT: 'NORTHEAST', DE: 'NORTHEAST', FL: 'SOUTHEAST', GA: 'SOUTHEAST',
  HI: 'WEST', ID: 'WEST', IL: 'MIDWEST', IN: 'MIDWEST', IA: 'MIDWEST',
  KS: 'MIDWEST', KY: 'MIDWEST', LA: 'SOUTHWEST', ME: 'NORTHEAST', MD: 'NORTHEAST',
  MA: 'NORTHEAST', MI: 'MIDWEST', MN: 'MIDWEST', MS: 'SOUTHEAST', MO: 'MIDWEST',
  MT: 'WEST', NE: 'MIDWEST', NV: 'WEST', NH: 'NORTHEAST', NJ: 'NORTHEAST',
  NM: 'SOUTHWEST', NY: 'NORTHEAST', NC: 'SOUTHEAST', ND: 'MIDWEST', OH: 'MIDWEST',
  OK: 'SOUTHWEST', OR: 'WEST', PA: 'NORTHEAST', RI: 'NORTHEAST', SC: 'SOUTHEAST',
  SD: 'MIDWEST', TN: 'SOUTHEAST', TX: 'SOUTHWEST', UT: 'WEST', VT: 'NORTHEAST',
  VA: 'SOUTHEAST', WA: 'WEST', WV: 'SOUTHEAST', WI: 'MIDWEST', WY: 'WEST',
};

/**
 * College scout — separate from the NFL `Scout` (which evaluates
 * existing pros). Per Doc 3, every team fields **10–15 college scouts**
 * — significantly larger than NFL pro-personnel staffs. Each scout
 * carries:
 *
 *   `knownSpecialty`      — PositionGroup the GM understands them to
 *                            focus on. Drives which prospects they
 *                            most often evaluate.
 *   `preferredRegion`     — geographic affinity. Bonus accuracy when
 *                            evaluating prospects from this region.
 *                            'NATIONAL' for pure cross-country scouts.
 *   `trueAccuracy`        — hidden per-PositionGroup accuracy 0..1.
 *                            Often (not always) higher in known
 *                            specialty.
 *   `quirks`              — 1–2 personality quirks that bias
 *                            evaluation noise + confidence in
 *                            specific contexts. Reuses NFL `ScoutQuirk`
 *                            pool — quirks transfer cleanly.
 *
 * Per North Star, `trueAccuracy` and `quirks` are NEVER displayed
 * numerically. The dev inspector exposes them; the eventual draft-
 * board UI will surface only `knownSpecialty` + `preferredRegion`
 * + identity, with track-record-based trust building over time.
 */
export interface CollegeScout {
  id: ScoutId;
  name: string;
  age: number;
  yearsExperience: number;
  knownSpecialty: PositionGroup;
  preferredRegion: ScoutRegion;
  /** Hidden per-PositionGroup accuracy, 0..1. */
  trueAccuracy: Readonly<Record<PositionGroup, number>>;
  /** 1–2 quirks from the shared NFL/college quirk pool. */
  quirks: readonly ScoutQuirk[];
}

/**
 * One attributed observation made by a college scout about a college
 * prospect. The set of all observations is the engine's college-
 * scouting intelligence store; the eventual draft-board UI will read
 * through a knowledge-layer filter that limits to "what the viewer's
 * scouts have observed" and reconciles conflicting reports by
 * confidence.
 *
 * Mirrors `PlayerObservation` shape so slice 3 (draft boards) can use
 * the same confidence-weighted aggregation as the NFL watch-list code.
 */
export interface CollegePlayerObservation {
  scoutId: ScoutId;
  /** ID of the observed `CollegePlayer`. */
  collegePlayerId: PlayerId;
  /** Sim tick when this observation was recorded. */
  observedOnTick: number;
  /** Observed values for the skills this scout assessed, 0..100. */
  skills: Readonly<Partial<Record<keyof PlayerSkills, number>>>;
  /**
   * Per-skill confidence, 0..1. Mirrors keys of `skills`. Lower
   * confidence = noisier estimate; the knowledge layer should
   * weight accordingly when reconciling reports from multiple
   * sources.
   */
  confidence: Readonly<Partial<Record<keyof PlayerSkills, number>>>;
}

// ─── Draft Board (Doc 3 — slice 3) ──────────────────────────────────────

/**
 * Why a prospect appears high on a team's internal draft board. Per
 * Doc 3's "32 unique boards" framing, the same prospect can hit
 * different boards for different reasons — a CONVERSION_PROJECTION
 * pick on a 3-4 team becomes a non-pick on a 4-3 team that doesn't
 * see the OLB conversion. The reason is derived heuristically from
 * which component of the priority composite dominated.
 *
 *   BLUE_CHIP             — high observed skill + high confidence
 *                           (consensus top-tier pick on most boards)
 *   SCHEME_FIT            — strong archetype match for the team's
 *                           offensive/defensive scheme
 *   POSITIONAL_NEED       — team is thin at the prospect's projected
 *                           NFL position group; talent matters more
 *                           at this group right now
 *   CONVERSION_PROJECTION — the prospect is a position-conversion
 *                           candidate AND this team's projected
 *                           position is a strong fit for them
 *   DEVELOPMENTAL         — high ceiling-vs-current gap; long-term
 *                           value over short-term polish
 */
export type DraftBoardReason =
  | 'BLUE_CHIP'
  | 'SCHEME_FIT'
  | 'POSITIONAL_NEED'
  | 'CONVERSION_PROJECTION'
  | 'DEVELOPMENTAL';

/**
 * One prospect on a team's internal draft board. Derived from the
 * team's own scouts' observations, the team's scheme, and the team's
 * positional needs. Per Doc 3:
 *
 *   "All 32 teams maintain their own internal big board throughout
 *    the pre-draft process. No two teams have the same board —
 *    scheme fit and organizational biases create meaningful
 *    differences in prospect rankings across all 32 teams."
 *
 * The same prospect may appear on many teams' boards with different
 * priorities + reasons. Slice 3 takes the top N (default 50) per
 * team, sorted by priority. Future slices can add lookahead-based
 * board adjustments (trade-up scenarios, runs at a position).
 */
export interface DraftBoardEntry {
  /** ID of the `CollegePlayer` this entry tracks. */
  collegePlayerId: PlayerId;
  /** Composite priority — higher = stronger interest. Not capped. */
  priority: number;
  reason: DraftBoardReason;
  /**
   * Confidence-weighted aggregate of the prospect's key skills from
   * the team's own scout reports. The team's *belief* about the
   * prospect's skill level — not the truth.
   */
  observedSkillScore: number;
  /** Scheme-fit multiplier in the team's scheme (uses true archetype). */
  schemeFit: number;
  /** Mean per-skill confidence across this team's reports. */
  meanConfidence: number;
  /** How many independent reports this team has on this prospect. */
  observationCount: number;
  /** Sim tick when this entry was added (= regeneration tick). */
  addedOnTick: number;
  /**
   * The position THIS team would play the prospect at (2026-06-03). Usually his
   * `nflProjectedPosition`, but a team with a hole at a convertible spot values
   * (and would draft + play) him there instead — e.g. a team needing a left
   * tackle assigns a projected RIGHT tackle to LT. When it differs from the
   * prospect's natural position the prospect is a planned CONVERSION, and the
   * board values him at the assigned position's premium. Optional for
   * back-compat (legacy boards / hand-built test entries → treat as natural).
   */
  assignedPosition?: Position;
}

// ─── Combine + Pro Days (Doc 3 — slice 4) ───────────────────────────────

/**
 * Combine drill results for one prospect. All 32 teams observe these
 * simultaneously when the event runs each offseason. Per-drill noise
 * is small (combines are precisely measured), so combine numbers are
 * a near-truth reveal of the prospect's `measurables` — but with a
 * `participated` flag per drill because prospects often skip events
 * (workout-warriors run everything; pedigree first-rounders may skip
 * the riskier drills like 3-cone with nothing to gain).
 *
 * Stored on `LeagueState.combineResults` keyed by the prospect's
 * `PlayerId`. The eventual draft-board UI shows combine numbers
 * alongside scout-estimated skills so the user can spot
 * workout-warrior gaps ("posts a 4.41 but tape says 4.6").
 */
export interface CombineMeasurables {
  /** Whether the prospect attended at all. False = skipped entirely. */
  attended: boolean;
  /** Per-drill reported values (undefined when skipped). */
  heightInches?: number;
  weightLbs?: number;
  armLengthInches?: number;
  handSizeInches?: number;
  fortyYardSeconds?: number;
  benchPress225Reps?: number;
  verticalInches?: number;
  broadJumpInches?: number;
  threeConeSeconds?: number;
  shuttleSeconds?: number;
  /** Sim tick when the combine ran. */
  measuredOnTick: number;
}

/**
 * One team's pro-day attendance record. The full pro-day schedule
 * covers every school with ≥1 draft-eligible prospect; each team
 * decides per school whether to send a scout/coach. Deterministic
 * for a given league seed + season number.
 *
 * Per Doc 3:
 *   "Popular pro days may have 20+ NFL teams in attendance while
 *    smaller programs may host only 2-3 teams. Teams that deploy
 *    to less popular programs may find overlooked value."
 *
 * Slice 4 records attendance. The eventual observation-pipeline
 * refactor can apply a per-team accuracy bonus on subsequent reads
 * of attended-school prospects.
 */
export interface ProDayAttendanceRecord {
  /** Stable school id (see `engine/src/data/colleges`). */
  schoolId: string;
  attended: boolean;
  /**
   * Why the team attended (or didn't). Derived from how many of the
   * school's prospects sit on the team's draft board top 30:
   *   AUTO       — score ≥ 3 (multiple board prospects)
   *   INTERESTED — score 1–2, hit the per-prospect attend roll
   *   FLYER      — score 0, hit the small-school flyer roll
   *   SKIP       — `attended` is false
   */
  reason: 'AUTO' | 'INTERESTED' | 'FLYER' | 'SKIP';
  /** Number of prospects from this school on team's top-30 board. */
  boardCount: number;
}

// ─── Coach visits (Doc 3 — slice 6) ─────────────────────────────────────

/**
 * One head-coach observation of a college prospect, filed during an
 * NFL bye week when the coach attended a college game. Coaches grade
 * a FOCUSED SUBSET of player dimensions — the ones you can read live
 * from the sideline / press box:
 *
 *   - Mental / intangible — leadership, competitiveness, workEthic,
 *     coachability, composure, footballIq, decisionMaking
 *   - Scheme proxy — technicalSkill (how well the prospect operates
 *     a system)
 *
 * Coaches do NOT report physical measurables (speed, strength,
 * vertical, etc.) — those come from scouts + combine. The narrowness
 * is the point: coach visits are a quality-over-quantity intel
 * stream. Per Doc 3, coach visits are "primary strength" on these
 * dimensions and significantly more accurate than scout reports.
 *
 * Attributed to the specific coach (and via team lookup, to the
 * specific team). Same per-skill / per-confidence shape as
 * `CollegePlayerObservation` so the eventual knowledge-layer reads
 * both streams through one filter.
 */
export interface CoachVisitObservation {
  coachId: CoachId;
  /** ID of the observed `CollegePlayer`. */
  collegePlayerId: PlayerId;
  /** Sim tick when the visit happened. */
  observedOnTick: number;
  /** Observed values for the dimensions this coach graded, 0..100. */
  skills: Readonly<Partial<Record<keyof PlayerSkills, number>>>;
  /** Per-skill confidence, 0..1. Mirrors keys of `skills`. */
  confidence: Readonly<Partial<Record<keyof PlayerSkills, number>>>;
}

// ─── Draft Pick Asset (Doc 5 follow-on — tradeable picks) ──────────────

/**
 * A draft pick as a tradeable asset. Each team starts owning their
 * own future picks across the 3-year horizon; trades change
 * `currentTeamId` while `originalTeamId` stays fixed (the latter is
 * what determines the pick's slot — a pick traded from a bad team
 * to a good team still picks at the bad team's slot).
 *
 * Slot ordering is computed at draft time, not stored on the asset,
 * because the original team's standings can change year over year
 * (a future-year pick from team X is more or less valuable depending
 * on how X performs between now and then). The asset just records
 * who originated the pick + who currently owns it; the draft event
 * sorts by the original team's just-finished-season standing.
 */
export interface DraftPickAsset {
  id: DraftPickId;
  /**
   * Team the pick was originally awarded to. Determines slot in the
   * pick's round (via that team's just-finished-season standings).
   * Never changes once the asset is created.
   */
  originalTeamId: TeamId;
  /**
   * Team that currently owns the pick. Equal to `originalTeamId` at
   * creation; trades update this. The team that actually makes the
   * pick when the asset is consumed.
   */
  currentTeamId: TeamId;
  /** League season number this pick is for (the season that draft fires for). */
  seasonNumber: number;
  /** 1..7. Slice 5b doesn't support compensatory rounds yet. */
  round: number;
}

// ─── Draft event (Doc 3 — slice 5a) ─────────────────────────────────────

/**
 * One pick from a completed draft. Appended to `LeagueState.draftHistory`
 * as picks fire; the array is the durable record of every pick across
 * every draft the league has run.
 *
 * Shares `PlayerId` namespace: `collegePlayerId === promotedPlayerId`
 * since promotion preserves the id. The two fields exist as separate
 * names so consumers reading just the record don't have to know that
 * detail.
 */
export interface DraftPickRecord {
  /** Sim season this draft kicked off the season for. */
  seasonNumber: number;
  /** Round number (1 for slice 5a). */
  round: number;
  /** Overall pick number across the entire draft (1-indexed). */
  overallPick: number;
  /** Team making the pick. */
  teamId: TeamId;
  collegePlayerId: PlayerId;
  promotedPlayerId: PlayerId;
  contractId: ContractId;
  pickedOnTick: number;
  /**
   * Prospect's rank on the picking team's draft board at pick time.
   * null if the prospect wasn't on the board (BPA fallback). Lets the
   * inspector show whether each team "got their guy" or "took a flyer".
   */
  boardRankAtPick: number | null;
  /** Prospect's priority on the picking team's board, or null. */
  boardPriorityAtPick: number | null;
  /** Reason badge from the picking team's board, or null. */
  boardReasonAtPick: DraftBoardReason | null;
  /**
   * The prospect's NATURAL projected position when the team drafted him to
   * CONVERT to a different spot (2026-06-03) — e.g. a projected RT drafted to
   * play LT records `convertedFromPosition: 'RT'` while the promoted player's
   * `position` is `LT`. Absent for the common case (played at his natural spot).
   */
  convertedFromPosition?: Position;
  /**
   * Draft pick asset that was consumed for this pick (v0.44.0+).
   * Lets the inspector cross-reference picks with their tradeable
   * asset record (e.g., "team X picked here via a pick originally
   * owned by team Y"). Optional for back-compat with pre-v0.44 saves
   * and direct `runDraft` callers that bypass the asset system.
   */
  pickAssetId?: DraftPickId;
  /**
   * Original team that the pick belonged to. Equals `teamId` for
   * un-traded picks; differs when the pick was traded. Optional for
   * back-compat.
   */
  originalTeamId?: TeamId;
}

// ─── Trade-up history (Doc 3 — draft trades, v0.45 firing + v0.52 persistence) ─

/**
 * One trade-up that fired inside a draft event. v0.45 introduced
 * trade-up firing inside `runDraft`; v0.52 persists these records on
 * `LeagueState.tradeUpHistory` so the inspector can render
 * draft-trade activity without having to replay the draft.
 *
 * Asymmetric semantics: `onClockTeamId` was originally on the
 * clock at `overallPick` and DROPPED DOWN; `tradingUpTeamId` MOVED
 * UP and acquired the slot. The on-clock team receives
 * `swapAssetId` (the trading-up team's same-round pick) plus all
 * `futurePickIds` as compensation; the trading-up team receives
 * `onClockAssetId` (the slot that just fired).
 */
export interface TradeUpRecord {
  seasonNumber: number;
  round: number;
  /** Slot the on-clock pick occupied (the slot the trading-up team acquired). */
  overallPick: number;
  onClockTeamId: TeamId;
  onClockAssetId: DraftPickId;
  tradingUpTeamId: TeamId;
  swapAssetId: DraftPickId;
  /** Future-year pick assets that flipped from trading-up team to on-clock team. */
  futurePickIds: readonly DraftPickId[];
  targetCollegePlayerId: PlayerId;
  /** receivingValue / givingValue from on-clock perspective. Static base chart (v0.45). */
  ratio: number;
}
