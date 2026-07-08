import type { Prng } from '../prng/index.js';
import type { MatchupFacets } from './strength.js';
import { matchupFacets } from './strength.js';
import type { Player, PlayerSkills } from '../types/player.js';
import type { TeamState } from '../types/team.js';
import type { LeagueState } from '../types/league.js';
import type { HeadCoach } from '../types/personnel.js';
import { Position } from '../types/enums.js';
import { teamChemistry } from '../season/chemistry.js';

/**
 * Matchup-driven (bottom-up) game simulation — tier 2, drive-based (v0.105+).
 *
 * Built SIDE-BY-SIDE with the legacy top-down `outcome.rollStats` (not wired
 * into the live flow). A game is a sequence of drives, each a down-and-distance
 * loop of plays whose outcomes are shaped by the offense's facets vs the
 * defense's.
 *
 * Stage 1a: realistic DRIVE outcomes (calibrated against the Magistrate bar).
 * Stage 1b: per-play production ATTRIBUTION to specific players (targeted
 * receiver, ball carrier, QB, pass rusher, DB) by skill-weighted share — so an
 * elite player is fed more and his stat line SEPARATES. Attribution assigns the
 * already-calibrated play outcomes to players, so team aggregates (and thus the
 * Magistrate calibration) are preserved.
 */

export type DriveResult =
  | 'TD'
  | 'FG'
  | 'MISSED_FG'
  | 'PUNT'
  | 'TURNOVER'
  | 'DOWNS'
  | 'SAFETY'
  | 'END_HALF';

export interface DriveOutcome {
  offense: 'home' | 'away';
  result: DriveResult;
  plays: number;
  yards: number;
  /** Game-clock seconds this drive consumed (v0.178 — the clock IS the
   *  half budget; see the CLOCK_* constants). 0 on END_HALF markers. */
  clock: number;
  /** Field position the drive started at (own-yards 0-100), P1 v0.179 —
   *  set by the possession-chain from the prior drive's transition. */
  start: number;
}

/** Per-player accrued game stat line (subset of PlayerSeasonStats). */
export interface PlayerStatLine {
  passAttempts: number;
  passCompletions: number;
  passingYards: number;
  passingTds: number;
  interceptionsThrown: number;
  rushingAttempts: number;
  rushingYards: number;
  rushingTds: number;
  targets: number;
  receptions: number;
  receivingYards: number;
  receivingTds: number;
  tackles: number;
  sacks: number;
  interceptions: number;
  fumblesLost: number;
  fieldGoalsMade: number;
  fieldGoalsAttempted: number;
  extraPointsMade: number;
  punts: number;
  puntYards: number;
  returnYards: number;
  returnTds: number;
}

export interface DriveGameResult {
  homeScore: number;
  awayScore: number;
  driveLog: DriveOutcome[];
  /** Bottom-up per-player stat lines (only when run with personnel). */
  playerStats?: Map<string, PlayerStatLine>;
}

// ── Calibration constants (Magistrate 2015-2024 bar; see git history). ──
//
// The game clock (v0.178 — the W-L pass-delta campaign's convicted fix).
// The old budget was 62 PLAYS per half per game, every play costing 1 —
// which handed snap share to the better team (drives sustain → eat the
// budget): sim winners took +4.2 snaps/game vs the real +0.8, cancelling
// ~⅔ of the game script's (real-calibrated) pass-rate separation and
// pinning the Scorekeeper's W-L pass delta at ~33 vs the real 9.5. The
// real clock EQUALIZES snaps: incompletions stop it, runs burn it.
// Costs are SECONDS consumed until the next snap, derived from nflverse
// pbp 2022-2024 (REG, n=102,187 scrimmage plays; `_clock_cost_bar.mjs`):
// run 34.0s · completion 31.3s · incompletion 5.0s · sack 33.1s ·
// INT/throwaway 7.3s. Trailing-big-late offenses compress non-stopped
// plays (hurry-up: completions 25.0s, runs 30.3s → ×0.85); leading-big-
// late completions stretch (34.7s → ×1.11). Punts/FGs approximate the
// run cost. HALF_CLOCK_SECONDS is the calibration knob replacing the old
// play cap — tuned so plays/team-game lands on the real 62.7.
const HALF_CLOCK_SECONDS = 1560;
const CLOCK_RUN = 34.0;
const CLOCK_COMPLETE = 31.3;
const CLOCK_INCOMPLETE = 5.0;
const CLOCK_SACK = 33.1;
const CLOCK_TURNOVER = 7.3;
/** Script-state cost modifiers. The gates are |shift| at ~Q4 ±7 (the
 *  pbp derivation's hurry/kill states: shift(−7, Q4) = +0.16,
 *  shift(+7, Q4) = −0.20). */
const HURRY_SHIFT_GATE = 0.15;
const HURRY_COST_MULT = 0.85;
const KILL_SHIFT_GATE = 0.15;
const KILL_COMPLETE_MULT = 1.11;

// ── End-of-half clock management (P2, v0.180) ────────────────────────────────
// The real end-of-half possession asymmetry: a LEADING offense with the ball
// runs the clock out (victory kneels) once it safely can, sooner when the
// trailing defense is out of timeouts; the trailing defense burns timeouts to
// stop the clock and get the ball back. So winners bank their (non-offensive)
// kneel possessions while the pass-heavy hurry-up drives fall to the trailer —
// the real reason losers out-pass winners on volume (real snap skew W−L +0.88,
// offensive drives W 10.22 / L 10.50). Thresholds are in clock-BUDGET seconds
// (HALF_CLOCK_SECONDS units), calibrated so the possession asymmetry lands on
// the real offensive-drive split without starving rush volume (the two-minute
// pass boost and the kneel both trade run plays away).
const HALF_TIMEOUTS = 3;
const TIMEOUT_WINDOW = 240; // remaining budget-sec inside which the trailing defense burns timeouts
const KNEEL_CLOCK = 130; // remaining budget-sec a leader can kneel out with the trailer at 0 timeouts
const TIMEOUT_KNEEL_SECS = 25; // each remaining trailer timeout the leader must additionally cover
const TWO_MIN_WINDOW = 170; // remaining budget-sec inside which a TRAILING offense runs the two-minute drill
const TWO_MIN_PASS_BOOST = 0.16; // extra pass-rate shift in the two-minute drill (throw to move + stop the clock)

function playClock(kind: PlayResult['kind'], scriptShift: number): number {
  const base =
    kind === 'run' ? CLOCK_RUN
    : kind === 'complete' ? CLOCK_COMPLETE
    : kind === 'incomplete' ? CLOCK_INCOMPLETE
    : kind === 'sack' ? CLOCK_SACK
    : CLOCK_TURNOVER; // int | fumble — the clock stops at the change
  if (scriptShift >= HURRY_SHIFT_GATE && kind !== 'incomplete') return base * HURRY_COST_MULT;
  if (scriptShift <= -KILL_SHIFT_GATE && kind === 'complete') return base * KILL_COMPLETE_MULT;
  return base;
}

const PASS_RATE = 0.57;
const BASE_COMPLETION = 0.655;
// v0.157: real yds/completion is 11.3 (Scorekeeper). The drive sim scores
// PURELY GEOMETRICALLY (a TD needs ballOn to reach 100), so this constant
// had to be 13 to make geometric accumulation yield real POINTS — at the
// cost of +14% inflated YARDS (live yds/completion 13.4, plays/drive 6.3).
// Lowered to 11.5 (≈ real yards) once the red-zone TD conversion below
// backfills the points the shorter completions no longer grind out.
const YDS_PER_COMPLETION = 11.5;
const YDS_PER_COMPLETION_SD = 11;
const RUN_YDS = 4.7;
const RUN_YDS_SD = 7.5;
const SACK_RATE = 0.06;
const SACK_YDS = 7;
// v0.158 raised both (INT 0.03→0.033, fumble 0.011→0.014) to lift total
// drive-level turnovers onto the bar (10.0→11.3 giveaways/100 drives, real
// 11.5). But it did so by over-feeding the INT channel: box-score INTs ran
// 1.0/team-game (real 0.8) and the turnover MIX came out ~81% INT vs the real
// ~62% — which also inflated the def-INT leaderboard (a cluster of ball-hawks
// at the top). v0.159 rebalances the SAME total toward fumbles: INT back down
// and fumble up so the league keeps its ~11.3 takeaways/100 drives (Magistrate
// untouched) while box INTs land at the real ~0.8 and the INT/fumble split
// matches real. Fumbles aren't attributed to a defender, so shifting load off
// INTs de-inflates the picks leaderboard without touching team turnovers.
const INT_RATE = 0.027;
const FUMBLE_LOST_RATE = 0.022;
const KICKOFF_TOUCHBACK = 25; // own-25 touchback line (real post-kickoff start ~25.4)

// ── Drive-extending defensive penalties (v0.158) ─────────────────────────
// The geometric pass/run model has no penalties, so it under-sustains: real
// drives convert via DPI / defensive holding / illegal contact (automatic
// first downs) that the model misses, leaving GMSim drives short (plays/
// drive 5.22 vs 5.5, yards/drive 29.0 vs 30.9) and punting too much (40.5
// vs 37.2). A per-play chance of a drive-extending defensive penalty gives
// an automatic first down + penalty yards. It adds FIELD POSITION (drive
// yards) but is NOT attributed to any player's pass/rush line, so it closes
// the sustain gap without re-inflating the de-inflated box score. Fires in
// both the live and facet paths. Kept GENTLE (~0.025/play-iteration ≈ 2
// per team-game): penalties sustain drives INTO the red zone where the trip
// resolution converts them, so an aggressive rate over-scores — the red-zone
// TD base is trimmed in tandem and turnovers carry most of the punt fix.
const DEF_PENALTY_RATE = 0.025;

/** Penalty yardage for a drive-extending defensive foul: usually a 5-yard
 *  (holding / illegal contact / offsides) auto first down, sometimes a big
 *  DPI spot foul. */
function penaltyYards(prng: Prng): number {
  return prng.next() < 0.25 ? prng.nextRange(12, 28) : 5;
}

// ── Red-zone trip resolution (v0.157) ────────────────────────────────────
// Geometric scoring under-converts the red zone: real offenses score a TD on
// ~58% of red-zone trips, kick a FG on ~30%, and fail on ~12% — but pure
// yardage accumulation stalls on the short field (plays clamp, drives grind
// and punt-equivalent), so it both under-scores AND, with an additive TD
// hack, cannibalizes field goals. Instead, once a positive play reaches the
// red zone the trip is RESOLVED as a real outcome distribution: TD (depth +
// edge scaled), else FG (the chip shot), else a rare fail. This produces the
// real TD AND FG rates BY CONSTRUCTION (no FG cannibalization) and decouples
// POINTS from raw YARDS, letting YDS_PER_COMPLETION sit at the real ~11.5.
// Mid-range FGs (outside the 20) still come from the geometric 4th-down
// logic. Fires in BOTH the live and facet paths (keyed off field position +
// edge, not player attribution) so the Magistrate and the live league agree.
const RED_ZONE_LINE = 80; // the opponent's 20 — the real NFL red zone
const RED_ZONE_TD_BASE = 0.42; // TD prob for a trip entering at the 20 (depth 0)
// v0.179 (P1): trimmed 0.48→0.42 — field-position chaining converts short-field
// turnovers into points the old base double-counted. Centered on the LIVE path
// (Scorekeeper points/game ~23); the facet Magistrate reads ~2 lower on drive
// count until P5's sustain fix restores plays/drive. See GAME_SIM_REBUILD.md §2.5/P1.
const RED_ZONE_TD_DEPTH = 0.48; // additional TD prob at the goal line (depth 1)
const RED_ZONE_TD_EDGE = 0.004; // per-point passEdge adjustment
const RED_ZONE_FG_CONDITIONAL = 0.82; // of NON-TD trips, the share that kick (else fail) — real FG 30 / fail 12

function redZoneTdChance(passEdge: number, ballOn: number): number {
  const depth = (ballOn - RED_ZONE_LINE) / (100 - RED_ZONE_LINE); // 0..1
  return clamp(
    RED_ZONE_TD_BASE + depth * RED_ZONE_TD_DEPTH + passEdge * RED_ZONE_TD_EDGE,
    0.06,
    0.95,
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function fgSuccess(distance: number, kickerRating = KICKER_NEUTRAL): number {
  const base =
    distance <= 30 ? 0.97
    : distance <= 40 ? 0.9
    : distance <= 47 ? 0.8
    : distance <= 53 ? 0.62
    : distance <= 57 ? 0.45
    : 0.25;
  // Kicker skill (P4a): a strong leg lifts the make rate, most felt at range.
  return clamp(base + (kickerRating - KICKER_NEUTRAL) * FG_KICKER_K, 0.02, 0.995);
}

// ── Game script (v0.149 — the Scorekeeper's W-L pass-delta finding) ──────
//
// Real winners out-pass losers by only ~+9.5 yds/game (REG 2011-2025)
// because play-calling follows the SCORE: trailing teams throw their way
// back (garbage time included), leading teams run the clock out. A
// score-blind PASS_RATE made GMSim's pass volume track team quality, so
// winners out-passed losers by ~+96 yds. The shift is CENTERED — symmetric
// in the score difference, so one side's extra passes are the other side's
// extra runs and the league-wide pass rate / Magistrate drive bar hold —
// and ramps quadratically with game progress (the script is a second-half
// phenomenon; a 7-point first-quarter lead barely changes the calls).
// Script v2 (v0.153) — shape locked to the measured real pass-rate table
// (nflverse pbp 2015-2024, 5,246 team-games; see _pace_script_out.txt):
// the script is a Q4 STEP, not a ramp. Within-quarter shifts vs the tied
// baseline: H1 ≈ nothing (Q2 variation is the two-minute drill, uniform
// across score states); Q3 mild trail-side (+9pp down 14+), weak lead-side;
// Q4 explodes and is LEAD-HEAVY — down 14+ → 79% pass (+20), down 1-6 →
// 69% (+10), up 1-6 → 45% (−14!), up 7-13 → 39% (−20), up 14+ → 30% (−29).
// Leaders protect ANY Q4 lead hard; trailers escalate with the deficit.
export const SCRIPT_TRAIL_BASE = 0.08;
export const SCRIPT_TRAIL_SLOPE = 0.12; // saturates ~10-point deficits
export const SCRIPT_LEAD_BASE = 0.12;
export const SCRIPT_LEAD_SLOPE = 0.17; // saturates ~14-point leads
export const SCRIPT_Q3_TRAIL = 0.45; // Q3 strength as a fraction of Q4's
export const SCRIPT_Q3_LEAD = 0.2;
// Q2 script (v0.178 — the W-L pass-delta campaign's rate-channel finding):
// the v0.153 lock zeroed the whole first half, but the real table has a
// solid TRAIL-side Q2 script — down 14+ passes at 68% vs 60% tied (+8pp)
// — while the lead side is flat (61% at +14). Zeroing Q2 was ~2pp of the
// realized W-L pass-rate gap (sim 6.8pp vs real 10.3pp). Q1 is flat in
// real data and stays scriptless.
export const SCRIPT_Q2_TRAIL = 0.4; // fraction of Q4 trail strength (real: 8/20pp)
export const SCRIPT_Q2_LEAD = 0.03; // real lead-side Q2 is ~flat

/** Pass-rate shift for the OFFENSE: + when trailing, − when leading.
 *  `progress` is 0..1 of regulation. Zero through the first half, partial
 *  in Q3, full step in Q4. Exported for tests. */
export function gameScriptShift(offenseScoreDiff: number, progress: number): number {
  if (offenseScoreDiff === 0 || progress < 0.25) return 0;
  if (offenseScoreDiff < 0) {
    const d = -offenseScoreDiff;
    const late = progress >= 0.75 ? 1 : progress >= 0.5 ? SCRIPT_Q3_TRAIL : SCRIPT_Q2_TRAIL;
    return late * (SCRIPT_TRAIL_BASE + SCRIPT_TRAIL_SLOPE * clamp((d - 1) / 9, 0, 1));
  }
  const late = progress >= 0.75 ? 1 : progress >= 0.5 ? SCRIPT_Q3_LEAD : SCRIPT_Q2_LEAD;
  return (
    -late *
    (SCRIPT_LEAD_BASE + SCRIPT_LEAD_SLOPE * clamp((offenseScoreDiff - 1) / 13, 0, 1))
  );
}

function passRate(down: number, togo: number, scriptShift: number): number {
  // 3rd-and-long is pass-dominant regardless of script (dampened shift);
  // 3rd-and-short and neutral downs carry the full script.
  if (down >= 3 && togo >= 6) return clamp(0.82 + scriptShift * 0.4, 0.15, 0.95);
  if (down >= 3 && togo <= 2) return clamp(0.35 + scriptShift, 0.15, 0.95);
  return clamp(PASS_RATE + scriptShift, 0.15, 0.92);
}

interface DriveCtx {
  passEdge: number;
  protEdge: number;
  runEdge: number;
  /** Chemistry mistakes channel (P3): >1 for a toxic room (more turnovers),
   *  <1 for a cohesive one. 1 on the facet path. */
  turnoverMult: number;
  /** Coaching 4th-down aggression (P3): scales the go-for-it probabilities.
   *  1 on the facet path. */
  aggression: number;
  /** Offense's kicker rating (P4a): shifts FG make rate. ST_NEUTRAL on the
   *  facet path. */
  kickerRating: number;
}

// ── League-mean edge re-centering (2026-06-23) ───────────────────────────
// The drive sim's scoring is anchored to the FRESH-league edge balance (the
// Magistrate's calibration). But the league talent SCALE legitimately drifts
// as rosters mature: short-window positions (CB/WR/RB) peak early and decline
// (Actuary-validated aging), so over ~10 seasons league-mean coverage erodes
// while QB survivorship lifts qbPlay — the QB-weighted league-mean `passEdge`
// climbs from ~0 to ~+12, inflating scoring +3.3 pts/game. This drift is a
// season-VARYING quantity (proven: it can't be removed by a static generation
// or constant fix — the developed equilibrium moves and QB survivorship is
// irreducible). So scoring is made INVARIANT to the absolute talent scale: each
// edge is re-centered on the league's CURRENT season mean, restoring the
// fresh-league effective balance. The team-to-team SPREAD is untouched (a
// uniform shift), so standings spread / W-L parity / Pythagorean hold; the
// offset is ~0 at a fresh league (Magistrate green by construction) and cancels
// exactly the mature-league drift. Computed once per league-season (memoized),
// so no per-game cost.
//
// Fresh-league baseline league-mean edges (createLeague, the calibration
// anchor — `_fresh_facet_probe`): passEdge +0.1, runEdge 0.0, protEdge −3.9.
const BASE_PASS_EDGE = 0.1;
const BASE_RUN_EDGE = 0.0;
const BASE_PROT_EDGE = -3.9;

interface EdgeRecenter {
  pass: number;
  run: number;
  prot: number;
}
const ZERO_RECENTER: EdgeRecenter = { pass: 0, run: 0, prot: 0 };

// Memoized per (seed, seasonNumber) — a season-level constant. matchupFacets
// over 32 rosters is far too costly to recompute per game (the live season
// reassigns `league.players` on every injury, so an object-identity cache would
// miss nearly every game → ~16× the facet work → minutes-long season ticks).
// seed+seasonNumber is the only league-stable identity across a season's games;
// the offset is computed once from the first game's rosters and reused (it
// barely moves within a season). Deterministic — a pure function of league
// state. Bounded in practice by distinct (seed × season).
const recenterCache = new Map<string, EdgeRecenter>();

function leagueRecenter(league: LeagueState): EdgeRecenter {
  const key = `${league.seed}:${league.seasonNumber}`;
  const cached = recenterCache.get(key);
  if (cached) return cached;
  let passOff = 0;
  let cover = 0;
  let runOff = 0;
  let runDef = 0;
  let prot = 0;
  let rush = 0;
  let n = 0;
  for (const team of Object.values(league.teams)) {
    const f = matchupFacets(team, league);
    passOff += f.qbPlay * 0.65 + f.receivingCorps * 0.35;
    cover += f.coverage;
    runOff += f.runBlocking * 0.5 + f.rushingCorps * 0.5;
    runDef += f.runDefense;
    prot += f.passProtection;
    rush += f.passRush;
    n++;
  }
  if (n === 0) return ZERO_RECENTER;
  const offset: EdgeRecenter = {
    pass: passOff / n - cover / n - BASE_PASS_EDGE,
    run: runOff / n - runDef / n - BASE_RUN_EDGE,
    prot: prot / n - rush / n - BASE_PROT_EDGE,
  };
  recenterCache.set(key, offset);
  return offset;
}

// QB share of pass offense raised 0.5→0.65 (2026-06-18, team-quality↔QB
// coupling). `passEdge` drives completions/yards/INTs → scoring → wins, but QB
// touches the game ONLY here, so its share of the outcome was diluted: the
// #1-overall QB probe showed the worst teams (picking #1) held a STAR/STARTER QB
// 82% of the time and read "settled", dropping #1-QB share to ~50% (real 75%).
// Real bad teams are bad BECAUSE of QB; weighting qbPlay over receivingCorps
// makes a poor QB drag a team's passing (and record) down so it lands at #1
// QB-needy. Roughly scoring-neutral on average (the two facets share a scale);
// it widens the by-QB spread. Verified vs the Scorekeeper/Magistrate bars.
//
// `rc` re-centers each edge on the league's current season mean (see above) —
// ZERO for the facet-only path, the live league's offset on the live path.
function driveCtx(off: MatchupFacets, def: MatchupFacets, rc: EdgeRecenter = ZERO_RECENTER): DriveCtx {
  return {
    passEdge: (off.qbPlay * 0.65 + off.receivingCorps * 0.35) - def.coverage - rc.pass,
    protEdge: off.passProtection - def.passRush - rc.prot,
    runEdge: (off.runBlocking * 0.5 + off.rushingCorps * 0.5) - def.runDefense - rc.run,
    turnoverMult: 1, // set from team chemistry on the live path (P3)
    aggression: 1, // set from the head coach on the live path (P3)
    kickerRating: KICKER_NEUTRAL, // set from the roster's kicker on the live path (P4a)
  };
}

type PlayKind = 'complete' | 'incomplete' | 'int' | 'sack' | 'run' | 'fumble';
interface PlayResult {
  isPass: boolean;
  gain: number;
  kind: PlayKind;
}

/** Resolve one play's OUTCOME from the matchup (the calibrated 1a logic). */
function resolvePlay(
  prng: Prng,
  ctx: DriveCtx,
  down: number,
  togo: number,
  scriptShift = 0,
): PlayResult {
  const isPass = prng.next() < passRate(down, togo, scriptShift);
  if (isPass) {
    if (prng.next() < clamp(SACK_RATE - ctx.protEdge * 0.0018, 0.02, 0.14)) {
      return { isPass, gain: -SACK_YDS, kind: 'sack' };
    }
    if (prng.next() < clamp((INT_RATE - ctx.passEdge * 0.0007) * ctx.turnoverMult, 0.004, 0.08)) {
      return { isPass, gain: 0, kind: 'int' };
    }
    if (prng.next() < clamp(BASE_COMPLETION + ctx.passEdge * 0.004, 0.45, 0.82)) {
      let gain = Math.round(prng.normal(YDS_PER_COMPLETION + ctx.passEdge * 0.05, YDS_PER_COMPLETION_SD));
      if (gain < -3) gain = -3;
      return { isPass, gain, kind: 'complete' };
    }
    return { isPass, gain: 0, kind: 'incomplete' };
  }
  if (prng.next() < FUMBLE_LOST_RATE * ctx.turnoverMult) return { isPass: false, gain: 0, kind: 'fumble' };
  const gain = Math.round(prng.normal(RUN_YDS + ctx.runEdge * 0.06, RUN_YDS_SD));
  return { isPass: false, gain, kind: 'run' };
}

// ── Player attribution (stage 1b) ────────────────────────────────────────

interface PRef {
  id: string;
  weight: number;
}
export interface TeamPersonnel {
  qb: string | null;
  /** Backup QB — takes a small share of dropbacks (spot duty / garbage time)
   *  so the starter doesn't post 100% of a team's passing every season. */
  qb2: string | null;
  receivers: PRef[];
  rushers: PRef[];
  passRush: PRef[];
  coverage: PRef[];
  /** Tackle-eligible defenders, group-weighted (LB > DB > DL) so the
   *  tackle leaderboard is LB-dominated like the real NFL. */
  tacklers: PRef[];
  /** Special-teams unit players (P4b) for stat attribution, and their ratings
   *  (P4a, 0-100) for outcomes: kicker (FG), punter (net punt), top return man
   *  (KO/punt). ids null / rating neutral when the roster has none. */
  kicker: string | null;
  punter: string | null;
  returner: string | null;
  kickerRating: number;
  punterRating: number;
  returnerRating: number;
}

const RECV_KEYS: (keyof PlayerSkills)[] = ['routeShort', 'routeMedium', 'routeDeep', 'releaseVsOff', 'catching', 'catchInTraffic'];
const RUSH_KEYS: (keyof PlayerSkills)[] = ['carrying', 'ballCarrierVision', 'elusiveness', 'breakTackle', 'speed'];
const PRUSH_KEYS: (keyof PlayerSkills)[] = ['getOff', 'bend', 'handTechnique', 'ripMove', 'bullRush'];
const COV_KEYS: (keyof PlayerSkills)[] = ['manCoverage', 'zoneCoverage', 'ballSkills', 'playRecognition'];

function meanKeys(p: Player, keys: (keyof PlayerSkills)[]): number {
  let s = 0;
  for (const k of keys) s += p.current[k];
  return s / keys.length;
}

const RECV_POS_FACTOR: Partial<Record<Position, number>> = {
  [Position.WR]: 1.0,
  [Position.TE]: 0.72,
  [Position.RB]: 0.42,
};

/** Skill-weighted depth at each role so the best players are fed the most;
 *  weight is steepened (skill³ over a floor) so elites genuinely separate. */
function steep(score: number): number {
  return Math.pow(Math.max(0, score - 35), 3);
}

/** Receivers use a gentler curve: the cube over-concentrates targets onto WR1
 *  (~43% target share); ^1.6 keeps elite separation but lands WR1 near the real
 *  ~28-30% share, so no single receiver posts a record-shattering line. */
function recvSteep(score: number): number {
  return Math.pow(Math.max(0, score - 35), 1.6);
}

/** Pass rush uses a gentler curve still: the cube let an elite edge with a
 *  weak supporting cast vacuum 60%+ of his team's sacks (a 25-sack season,
 *  above the real ~18 leader / 22.5 record). A lower floor + ^1.4 compresses
 *  the elite-vs-rotation gap so even a dominant edge tops out near the real
 *  ~40% of team sacks, landing the league leader in the real ~18 range. */
function prushSteep(score: number): number {
  return Math.pow(Math.max(0, score - 25), 1.4);
}

/** Sack-share role factor by position. EDGE rushers generate the bulk of
 *  sacks; interior linemen and blitzing off-ball LBs get a real but smaller
 *  share. Without this, a high-rated NT/DT competed equally with edges and
 *  could LEAD the league in sacks (a 24-sack NT) — interior linemen almost
 *  never do. Matches the real ~edge 60% / interior 30% / LB 10% sack split. */
const PRUSH_POS_FACTOR: Partial<Record<Position, number>> = {
  [Position.EDGE]: 1.0,
  [Position.DT]: 0.5,
  [Position.NT]: 0.4,
  [Position.OLB]: 0.5,
};

const QB_TIER_RANK: Record<string, number> = { STAR: 4, STARTER: 3, BACKUP: 2, FRINGE: 1 };

/** Share of dropbacks the backup QB takes (spot duty / garbage time). Keeps the
 *  starter near ~92%, so the league passing leader lands in the realistic range
 *  instead of posting 100% of a high-volume team's yards. */
const BACKUP_QB_SHARE = 0.08;

export function buildTeamPersonnel(players: Player[]): TeamPersonnel {
  // Pick the starter the way the rest of the engine identifies QB1 — tier
  // first, then depth-chart (roster) order among ties — so the bottom-up sim
  // feeds the same QB1 the stat consumers expect. Stable sort preserves roster
  // order within a tier. The next QB is the backup who gets spot snaps.
  const qbs = players
    .filter((p) => p.position === Position.QB)
    .sort((a, b) => (QB_TIER_RANK[b.tier] ?? 0) - (QB_TIER_RANK[a.tier] ?? 0));
  const qb = qbs[0];
  const qb2 = qbs[1];

  const receivers: PRef[] = players
    .filter((p) => p.position === Position.WR || p.position === Position.TE || p.position === Position.RB)
    .map((p) => ({ id: p.id, weight: recvSteep(meanKeys(p, RECV_KEYS)) * (RECV_POS_FACTOR[p.position] ?? 0.3) }))
    .filter((r) => r.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 6);

  const rushers: PRef[] = players
    .filter((p) => p.position === Position.RB || p.position === Position.FB)
    .map((p) => ({ id: p.id, weight: steep(meanKeys(p, RUSH_KEYS)) * (p.position === Position.RB ? 1 : 0.35) }))
    .filter((r) => r.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3);

  const passRush: PRef[] = players
    .filter((p) => PRUSH_POS_FACTOR[p.position] !== undefined)
    .map((p) => ({
      id: p.id,
      weight: prushSteep(meanKeys(p, PRUSH_KEYS)) * (PRUSH_POS_FACTOR[p.position] ?? 0),
    }))
    .filter((r) => r.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 6);

  const covPos = new Set<Position>([Position.CB, Position.S, Position.NICKEL, Position.ILB, Position.OLB]);
  // NOTE (Living Careers S4): no stickiness bonus or extra steepening in
  // these weights — in the drive sim, usage share IS production share (no
  // separate per-snap efficiency channel), so propping up a fading vet's
  // weight cancels the decline the Actuary needs to see, and steepening
  // measured WORSE on the pooled decline gate. The architectural fix for
  // the remaining flat decline regions is a usage-vs-efficiency split — a
  // future slice.
  const coverage: PRef[] = players
    .filter((p) => covPos.has(p.position))
    .map((p) => ({ id: p.id, weight: meanKeys(p, COV_KEYS) }))
    .filter((r) => r.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 6);

  // Tacklers: real NFL tackle distribution is ~LB 55% / DB 30% / DL 15%,
  // so weight each defender by his group factor × tackling-relevant skill.
  const tackleGroup: Partial<Record<Position, number>> = {
    [Position.ILB]: 1.0, [Position.OLB]: 0.9,
    [Position.S]: 0.7, [Position.CB]: 0.55, [Position.NICKEL]: 0.55,
    [Position.EDGE]: 0.4, [Position.DT]: 0.32, [Position.NT]: 0.32,
  };
  const tacklers: PRef[] = [];
  for (const p of players) {
    const g = tackleGroup[p.position];
    if (!g) continue;
    const weight = g * (p.current.tacklingTechnique * 0.5 + p.current.playRecognition * 0.5);
    if (weight > 0) tacklers.push({ id: p.id, weight });
  }
  tacklers.sort((a, b) => b.weight - a.weight);
  tacklers.splice(14);

  // Special teams (P4a/P4b): the roster's best kicker (FG), punter (net punt),
  // and return man (KO/punt) — id for stat attribution + rating for outcomes.
  const bestPlayerBy = (pos: Position, keys: (keyof PlayerSkills)[]): Player | null => {
    let best: Player | null = null;
    let bestR = -1;
    for (const p of players) {
      if (p.position !== pos) continue;
      const r = meanKeys(p, keys);
      if (r > bestR) {
        bestR = r;
        best = p;
      }
    }
    return best;
  };
  const kickerP = bestPlayerBy(Position.K, ['kickPower', 'kickAccuracy']);
  const punterP = bestPlayerBy(Position.P, ['puntPower', 'puntAccuracy']);
  let returnerP: Player | null = null;
  let bestRet = -1;
  for (const p of players) {
    if (p.position !== Position.WR && p.position !== Position.RB && p.position !== Position.CB) continue;
    const r = (p.current.speed + p.current.elusiveness) / 2;
    if (r > bestRet) {
      bestRet = r;
      returnerP = p;
    }
  }

  return {
    qb: qb?.id ?? null,
    qb2: qb2?.id ?? null,
    receivers,
    rushers,
    passRush,
    coverage,
    tacklers,
    kicker: kickerP?.id ?? null,
    punter: punterP?.id ?? null,
    returner: returnerP?.id ?? null,
    kickerRating: kickerP ? meanKeys(kickerP, ['kickPower', 'kickAccuracy']) : KICKER_NEUTRAL,
    punterRating: punterP ? meanKeys(punterP, ['puntPower', 'puntAccuracy']) : PUNTER_NEUTRAL,
    returnerRating: returnerP ? (returnerP.current.speed + returnerP.current.elusiveness) / 2 : RETURNER_NEUTRAL,
  };
}

function pick(prng: Prng, refs: PRef[]): string | null {
  if (refs.length === 0) return null;
  const total = refs.reduce((s, r) => s + r.weight, 0);
  if (total <= 0) return refs[0]!.id;
  let r = prng.next() * total;
  for (const ref of refs) {
    r -= ref.weight;
    if (r <= 0) return ref.id;
  }
  return refs[refs.length - 1]!.id;
}

function emptyLine(): PlayerStatLine {
  return {
    passAttempts: 0, passCompletions: 0, passingYards: 0, passingTds: 0, interceptionsThrown: 0,
    rushingAttempts: 0, rushingYards: 0, rushingTds: 0, targets: 0, receptions: 0,
    receivingYards: 0, receivingTds: 0, tackles: 0, sacks: 0, interceptions: 0,
    fumblesLost: 0, fieldGoalsMade: 0, fieldGoalsAttempted: 0, extraPointsMade: 0,
    punts: 0, puntYards: 0, returnYards: 0, returnTds: 0,
  };
}
function line(stats: Map<string, PlayerStatLine>, id: string): PlayerStatLine {
  let l = stats.get(id);
  if (!l) { l = emptyLine(); stats.set(id, l); }
  return l;
}

interface Attr {
  off: TeamPersonnel;
  def: TeamPersonnel;
  stats: Map<string, PlayerStatLine>;
}

const POINTS: Partial<Record<DriveResult, number>> = { TD: 7, FG: 3 };

function simulateDrive(
  prng: Prng,
  ctx: DriveCtx,
  startYardline: number,
  attr: Attr | null,
  scriptShift = 0,
): { result: DriveResult; plays: number; yards: number; clock: number } {
  let ballOn = startYardline;
  let down = 1;
  let togo = 10;
  let plays = 0;
  let clock = 0;
  let redZoneRolled = false; // red-zone TD conversion fires at most once/drive

  for (;;) {
    // Drive-extending defensive penalty (v0.158): an automatic first down
    // (DPI / holding / illegal contact) the per-play model otherwise misses.
    // Resolves before the down logic so it can also rescue a 4th-down punt;
    // adds field position but no player pass/rush stat, and doesn't consume a
    // down or count as an offensive play. A DPI in the end zone spots at the
    // 1 (no penalty TD).
    if (prng.next() < DEF_PENALTY_RATE) {
      ballOn = Math.min(99, ballOn + penaltyYards(prng));
      down = 1;
      togo = Math.min(10, 100 - ballOn);
      continue;
    }
    if (down === 4) {
      const toGoal = 100 - ballOn;
      const fgDist = toGoal + 17;
      const inFgRange = fgDist <= 56;
      // Coach 4th-down aggression (P3) scales every go-for-it probability.
      const goP = (p: number): boolean => prng.next() < clamp(p * ctx.aggression, 0.02, 0.97);
      let go = false;
      if (toGoal <= 2 && togo <= 1) go = goP(0.55);
      else if (inFgRange) go = false;
      else if (togo <= 1 && ballOn >= 30) go = goP(0.8);
      else if (togo <= 2 && ballOn >= 42) go = goP(0.6);
      else if (togo <= 5 && ballOn >= 45) go = goP(0.5);
      else if (ballOn >= 48) go = goP(0.35);
      if (!go) {
        plays++;
        clock += CLOCK_RUN; // punt/FG snap ≈ run-cost (clock runs to the kick)
        if (inFgRange) {
          const made = prng.next() < fgSuccess(fgDist, ctx.kickerRating);
          if (attr?.off.kicker) {
            const kl = line(attr.stats, attr.off.kicker);
            kl.fieldGoalsAttempted += 1;
            if (made) kl.fieldGoalsMade += 1;
          }
          return { result: made ? 'FG' : 'MISSED_FG', plays, yards: ballOn - startYardline, clock };
        }
        return { result: 'PUNT', plays, yards: ballOn - startYardline, clock };
      }
    }

    plays++;
    const pr = resolvePlay(prng, ctx, down, togo, scriptShift);
    clock += playClock(pr.kind, scriptShift);

    // ── Attribute the play's outcome to specific players (stage 1b). ──
    let scorer: { id: string; kind: 'rec' | 'rush'; passer?: string } | null = null;
    let tackleEligible = false; // a run or completion ends in a tackle (unless a TD)
    if (attr) {
      if (pr.isPass) {
        if (pr.kind === 'sack') {
          const d = pick(prng, attr.def.passRush);
          if (d) {
            const dl = line(attr.stats, d);
            dl.sacks += 1;
            dl.tackles += 1; // a sack is also a tackle
          }
        } else {
          // The starter takes most dropbacks; the backup gets occasional spot
          // duty so no QB posts 100% of a team's season passing.
          const passer =
            attr.off.qb2 && prng.next() < BACKUP_QB_SHARE ? attr.off.qb2 : attr.off.qb;
          if (passer) line(attr.stats, passer).passAttempts += 1;
          const recvId = pick(prng, attr.off.receivers);
          if (recvId) line(attr.stats, recvId).targets += 1;
          if (pr.kind === 'complete' && passer) {
            const q = line(attr.stats, passer);
            q.passCompletions += 1;
            q.passingYards += pr.gain;
            if (recvId) {
              const r = line(attr.stats, recvId);
              r.receptions += 1;
              r.receivingYards += pr.gain;
              scorer = { id: recvId, kind: 'rec', passer };
            }
            tackleEligible = true;
          } else if (pr.kind === 'int') {
            if (passer) line(attr.stats, passer).interceptionsThrown += 1;
            const d = pick(prng, attr.def.coverage);
            if (d) line(attr.stats, d).interceptions += 1;
          }
        }
      } else {
        const rbId = pick(prng, attr.off.rushers);
        if (rbId) {
          const r = line(attr.stats, rbId);
          r.rushingAttempts += 1;
          if (pr.kind === 'run') {
            r.rushingYards += pr.gain;
            scorer = { id: rbId, kind: 'rush' };
            tackleEligible = true;
          } else if (pr.kind === 'fumble') {
            r.fumblesLost += 1; // ball-carrier fumble attribution (P4b)
          }
        }
      }
    }

    if (pr.kind === 'int' || pr.kind === 'fumble') {
      return { result: 'TURNOVER', plays, yards: ballOn - startYardline, clock };
    }
    ballOn += pr.gain;
    const advanced = pr.kind === 'complete' || pr.kind === 'run';
    const scoreTd = (): { result: DriveResult; plays: number; yards: number; clock: number } => {
      if (attr && scorer) {
        if (scorer.kind === 'rec') {
          line(attr.stats, scorer.id).receivingTds += 1;
          if (scorer.passer) line(attr.stats, scorer.passer).passingTds += 1;
        } else {
          line(attr.stats, scorer.id).rushingTds += 1;
        }
      }
      // The kicker's extra point (the sim scores a TD as 7 = 6 + the XP).
      if (attr?.off.kicker) line(attr.stats, attr.off.kicker).extraPointsMade += 1;
      return { result: 'TD', plays, yards: 100 - startYardline, clock };
    };
    if (ballOn >= 100) return scoreTd();
    // Red-zone trip resolution (v0.157): the first positive play to reach the
    // red zone resolves the trip — TD (attributed to this play's carrier on
    // the live path), else the chip-shot FG, else a rare fail — at real
    // red-zone rates. Replaces the geometric grind inside the 20.
    if (advanced && !redZoneRolled && ballOn >= RED_ZONE_LINE) {
      redZoneRolled = true;
      const roll = prng.next();
      const pTd = redZoneTdChance(ctx.passEdge, ballOn);
      if (roll < pTd) return scoreTd();
      if (roll < pTd + (1 - pTd) * RED_ZONE_FG_CONDITIONAL) {
        const fgDist = 100 - ballOn + 17;
        const made = prng.next() < fgSuccess(fgDist, ctx.kickerRating);
        if (attr?.off.kicker) {
          const kl = line(attr.stats, attr.off.kicker);
          kl.fieldGoalsAttempted += 1;
          if (made) kl.fieldGoalsMade += 1;
        }
        return {
          result: made ? 'FG' : 'MISSED_FG',
          plays,
          yards: ballOn - startYardline,
          clock,
        };
      }
      return { result: 'DOWNS', plays, yards: ballOn - startYardline, clock };
    }
    // A run/completion that didn't score ends in a tackle by the defense.
    if (attr && tackleEligible) {
      const t = pick(prng, attr.def.tacklers);
      if (t) line(attr.stats, t).tackles += 1;
    }
    if (ballOn <= 0) return { result: 'SAFETY', plays, yards: ballOn - startYardline, clock };
    togo -= pr.gain;
    if (togo <= 0) {
      down = 1;
      togo = Math.min(10, 100 - ballOn);
    } else {
      down++;
      if (down > 4) return { result: 'DOWNS', plays, yards: ballOn - startYardline, clock };
    }
  }
}

interface Side {
  ctx: DriveCtx;
  pers: TeamPersonnel | null;
}

/**
 * Home-field edge as a ZERO-SUM half-edge (v0.156): the home offense gets
 * +HOME_FIELD_EDGE on its pass/run edges and the away offense gets the
 * SAME amount subtracted (home defense plays up at home). The old model
 * added +9 to the home side ONLY, which was non-zero-sum: because
 * `resolvePlay` turns edge into yards (`+passEdge×0.05`) and completions
 * (`+passEdge×0.004`), the un-debited home boost injected league-wide
 * passing/scoring inflation (+24% scoring, yds/completion 13.7 vs real
 * 11.3) that the Magistrate never caught — its facet-audit path applies no
 * HFA. A symmetric ±edge keeps the league scoring mean ON the calibrated
 * baseline for ANY magnitude (home gain == away loss), so this constant
 * tunes ONLY the home win rate. Calibrated to the real 55.4% home win%
 * (Scorekeeper bar) for identical teams; the differential is 2×.
 */
const HOME_FIELD_EDGE = 2;

interface GameOpts {
  /** Resolve a regulation tie with overtime + a yardage/coin tiebreak so the
   *  game always has a winner (the live season requires one). Off for the
   *  Magistrate's facet-only path so OT drives don't skew its drive metrics. */
  resolveTie?: boolean;
}

// ── Field position after each drive (P1 rebuild, 2026-07-07) ─────────────────
// The next possession no longer always starts at own 27; it starts from where
// the prior drive ENDED, by transition type. Real bars (pbp 2015-24,
// `_drive_start_bars.mjs`, 56,489 drives): kickoff own 25.4 (45% of drives) ·
// punt own 24.4 (38%) · INT own 47 · fumble own 53 · downs own 36 · missed-FG
// own 36.5. Turnovers now hand out the short fields that produce points; punts
// net real field position. Constants calibrated to those bars (`_fieldpos_probe`).
const NET_PUNT = 44; // gross ~45 − return, tuned to receiving start own ~24.4
const NET_PUNT_SD = 8;
const FREE_KICK_START = 42; // safety free-kick receiving start (rare)
const TURNOVER_SPOT_OFFSET = 8; // INT-downfield / fumble mix → receiving own ~49
const MISSED_FG_SPOT_OFFSET = 3; // opponent takes over ~ the kick spot

// ── Special teams as a roster dimension (P4a, v0.182) ────────────────────────
// Kicker / punter / returner ratings (0-100, neutral ~74) shift the FG make
// rate, net punt, and return field position around the calibrated means — a
// great ST unit is a real edge. MEAN-NEUTRAL: a 74-rated unit reproduces the
// bars, so league FG% / drive starts / scoring hold and only the SPREAD moves.
// Per-unit neutral references = the league-average rating for each ST role
// (kicker/punter ~65; return men are the FASTEST players ~87). Centering each
// modulation on its own average keeps it MEAN-NEUTRAL — an average unit
// reproduces the calibrated FG% / net-punt / drive-start bars.
const KICKER_NEUTRAL = 65;
const PUNTER_NEUTRAL = 65;
const RETURNER_NEUTRAL = 87;
const FG_KICKER_K = 0.004; // FG make-rate per kicker-point over neutral (most at range)
const PUNT_NET_K = 0.15; // net-punt yards per punter-point over neutral
const RETURN_NET_K = 0.13; // net-punt yards shaved per returner-point over neutral
const KO_RETURN_K = 0.1; // kickoff-return start yards per returner-point over neutral

function kickoffReturn(prng: Prng, returnerRating = RETURNER_NEUTRAL): number {
  if (prng.next() < 0.7) return KICKOFF_TOUCHBACK; // touchback (returner irrelevant)
  const ret = Math.round(20 + prng.normal(6, 7) + (returnerRating - RETURNER_NEUTRAL) * KO_RETURN_K);
  return clamp(ret + (prng.next() < 0.015 ? prng.nextRange(25, 60) : 0), 1, 99);
}
function puntReturn(fromPos: number, prng: Prng, punterRating = PUNTER_NEUTRAL, returnerRating = RETURNER_NEUTRAL): number {
  const net = prng.normal(NET_PUNT, NET_PUNT_SD) + (punterRating - PUNTER_NEUTRAL) * PUNT_NET_K - (returnerRating - RETURNER_NEUTRAL) * RETURN_NET_K;
  const landing = fromPos + net;
  if (landing >= 100) return 20; // punted into the end zone → touchback
  return clamp(Math.round(100 - landing), 1, 99);
}
/** Where the OPPONENT starts (own-yards 0-100), given how this drive ended. The
 *  kicking team's punter and the receiving team's returner shape the punt/KO. */
function nextStart(result: DriveResult, endBallOn: number, prng: Prng, punterRating = PUNTER_NEUTRAL, returnerRating = RETURNER_NEUTRAL): number {
  switch (result) {
    case 'TD':
    case 'FG':
      return kickoffReturn(prng, returnerRating);
    case 'SAFETY':
      return clamp(Math.round(prng.normal(FREE_KICK_START, 8)), 20, 60);
    case 'PUNT':
      return puntReturn(endBallOn, prng, punterRating, returnerRating);
    case 'MISSED_FG':
      return clamp(Math.round(100 - endBallOn + MISSED_FG_SPOT_OFFSET), 1, 99);
    case 'TURNOVER':
      return clamp(Math.round(100 - endBallOn - TURNOVER_SPOT_OFFSET), 1, 99);
    default: // DOWNS
      return clamp(Math.round(100 - endBallOn), 1, 99);
  }
}

function runGame(
  prng: Prng,
  home: Side,
  away: Side,
  stats: Map<string, PlayerStatLine> | null,
  opts: GameOpts = {},
): DriveGameResult {
  const driveLog: DriveOutcome[] = [];
  let homeScore = 0;
  let awayScore = 0;
  let driveIdx = 0;
  let totalClock = 0;
  let offense: 'home' | 'away' = 'home';
  // Special-teams ratings by side (P4a) — the returner shapes KO/punt starts,
  // the punter the net punt. ST_NEUTRAL on the facet path (no personnel).
  const returnerOf = (side: 'home' | 'away'): number => (side === 'home' ? home : away).pers?.returnerRating ?? RETURNER_NEUTRAL;
  const punterOf = (side: 'home' | 'away'): number => (side === 'home' ? home : away).pers?.punterRating ?? PUNTER_NEUTRAL;

  // Play one drive starting at `startPos` (own-yards). Returns the raw drive so
  // the caller can chain field position off its ending spot.
  const playDriveAt = (
    startPos: number,
    hurry = false,
  ): { result: DriveResult; plays: number; yards: number; clock: number } => {
    const off = offense === 'home' ? home : away;
    const def = offense === 'home' ? away : home;
    const attr: Attr | null = stats && off.pers && def.pers ? { off: off.pers, def: def.pers, stats } : null;
    // Game script (v0.149): trailing late tilts pass, leading late tilts run.
    // Progress is CLOCK-based (v0.178). A TRAILING offense inside the two-minute
    // window runs the drill (P2): throw to move fast + stop the clock.
    const diff = offense === 'home' ? homeScore - awayScore : awayScore - homeScore;
    const progress = Math.min(1, totalClock / (2 * HALF_CLOCK_SECONDS));
    const scriptShift = gameScriptShift(diff, progress) + (hurry ? TWO_MIN_PASS_BOOST : 0);
    const drive = simulateDrive(
      prng.fork(`drive:${driveIdx}`),
      off.ctx,
      startPos,
      attr,
      scriptShift,
    );
    driveLog.push({ offense, start: startPos, ...drive });
    const pts = POINTS[drive.result] ?? 0;
    if (offense === 'home') homeScore += pts;
    else awayScore += pts;
    if (drive.result === 'SAFETY') {
      if (offense === 'home') awayScore += 2;
      else homeScore += 2;
    }
    return drive;
  };

  // Possessions CHAIN off real field position (P1, v0.179): a drive ends, the
  // opponent takes over from where it ended (kickoff after a score, net punt,
  // the turnover/downs spot), and the half runs on the v0.178 clock budget —
  // still strict-alternation on that budget (the possession asymmetry from
  // timeouts/two-minute/kneel lands in P2). Opening possession is a coin toss;
  // whoever receives H1 kicks off H2.
  const homeReceivesH1 = prng.fork('toss').next() < 0.5;
  for (let half = 0; half < 2; half++) {
    offense = half === 0 ? (homeReceivesH1 ? 'home' : 'away') : homeReceivesH1 ? 'away' : 'home';
    let startPos = kickoffReturn(prng.fork(`open:${half}`), returnerOf(offense)); // opening kickoff
    let halfClock = 0;
    const timeouts = { home: HALF_TIMEOUTS, away: HALF_TIMEOUTS };
    for (;;) {
      const remaining = HALF_CLOCK_SECONDS - halfClock;
      if (remaining <= 0) {
        driveLog.push({ offense, start: startPos, result: 'END_HALF', plays: prng.fork(`eh:${half}`).nextRange(1, 4), yards: 0, clock: 0 });
        break;
      }
      // End-of-half clock management (P2): a leading offense runs the clock out;
      // the trailing defense burns timeouts first to try to get the ball back.
      const offScore = offense === 'home' ? homeScore : awayScore;
      const defScore = offense === 'home' ? awayScore : homeScore;
      const defense = offense === 'home' ? 'away' : 'home';
      if (offScore > defScore && remaining < TIMEOUT_WINDOW && timeouts[defense] > 0) {
        timeouts[defense] -= 1; // trailer stops the clock on the leader's possession
      }
      if (offScore > defScore && remaining <= KNEEL_CLOCK - TIMEOUT_KNEEL_SECS * timeouts[defense]) {
        // Victory kneels: the leader ends the half; a non-offensive possession.
        driveLog.push({ offense, start: startPos, result: 'END_HALF', plays: prng.fork(`kneel:${half}:${driveIdx}`).nextRange(2, 4), yards: 0, clock: 0 });
        break;
      }
      const twoMin = offScore < defScore && remaining < TWO_MIN_WINDOW; // trailer runs the two-minute drill
      const drive = playDriveAt(startPos, twoMin);
      halfClock += drive.clock;
      totalClock += drive.clock;
      const endBallOn = startPos + drive.yards; // where the drive ended (own-yards)
      const kicking = offense; // team that just kicked / punted
      offense = offense === 'home' ? 'away' : 'home'; // receiving team
      startPos = nextStart(drive.result, endBallOn, prng.fork(`fp:${driveIdx}`), punterOf(kicking), returnerOf(offense));
      if (drive.result === 'PUNT' && stats) {
        // Punter stat line (P4b): net punt = how far the ball moved to the
        // receiving team's new start (receiving own `startPos` → kicking-frame
        // (100 − startPos), minus the punter's spot `endBallOn`).
        const punterId = (kicking === 'home' ? home : away).pers?.punter;
        if (punterId) {
          const pl = line(stats, punterId);
          pl.punts += 1;
          pl.puntYards += Math.max(0, Math.round(100 - startPos - endBallOn));
        }
      }
      driveIdx++;
    }
  }

  // Overtime — the live game must produce a winner. Each round both teams get
  // one kickoff possession; a round that ends with a lead ends the game.
  // (OT possession coin-flip lands in P2; today home receives first.)
  if (opts.resolveTie && homeScore === awayScore) {
    let otYardsHome = 0;
    let otYardsAway = 0;
    // Coin flip for first possession (P2, v0.180) — replaces the old always-home.
    const otFirst: 'home' | 'away' = prng.fork('ot-toss').next() < 0.5 ? 'home' : 'away';
    const otSecond: 'home' | 'away' = otFirst === 'home' ? 'away' : 'home';
    for (let round = 0; round < 8 && homeScore === awayScore; round++) {
      offense = otFirst;
      const yFirst = Math.max(0, playDriveAt(kickoffReturn(prng.fork(`otko:${round}:1`), returnerOf(offense))).yards);
      driveIdx++;
      offense = otSecond;
      const ySecond = Math.max(0, playDriveAt(kickoffReturn(prng.fork(`otko:${round}:2`), returnerOf(offense))).yards);
      driveIdx++;
      if (otFirst === 'home') { otYardsHome += yFirst; otYardsAway += ySecond; }
      else { otYardsAway += yFirst; otYardsHome += ySecond; }
    }
    if (homeScore === awayScore) {
      if (otYardsHome > otYardsAway) homeScore += 3;
      else if (otYardsAway > otYardsHome) awayScore += 3;
      else if (prng.fork('ot-coin').next() < 0.5) homeScore += 3;
      else awayScore += 3;
    }
  }

  const result: DriveGameResult = { homeScore, awayScore, driveLog };
  if (stats) result.playerStats = stats;
  return result;
}

/** Facet-only drive sim (no player attribution, no HFA/OT) — used by the
 *  Magistrate to validate drive realism. */
export function simulateGameDrives(
  prng: Prng,
  homeFacets: MatchupFacets,
  awayFacets: MatchupFacets,
): DriveGameResult {
  return runGame(
    prng,
    { ctx: driveCtx(homeFacets, awayFacets), pers: null },
    { ctx: driveCtx(awayFacets, homeFacets), pers: null },
    null,
  );
}

export interface DriveGameOptions {
  /** Disable home-field advantage (neutral-site games, e.g. the Super Bowl). */
  neutralSite?: boolean;
}

// ── Coaching & team chemistry into the game (P3, v0.181) ─────────────────────
// The bottom-up sim builds its box score from player facets (ratings + mood +
// scheme-fit) but never saw the HEAD COACH or the team's CHEMISTRY — both live
// only in the (unused-by-this-path) top-down teamStrength. P3 wires them in:
//   coaching → a competence edge (game-day spectrums) + 4th-down aggression;
//     a great-vs-terrible HC swings ~2-3pp win% (Daniel-set, v0.181). Talent
//     dominates, so it moves per-team win% but NOT the league standings spread
//     (season-wins sd 2.6 vs real 3.3 is a separate talent-spread item).
//   chemistry → the MISTAKES channel: a toxic room commits more turnovers, a
//     locked-in room fewer — ASYMMETRIC (toxic bites harder), on top of the
//     per-player mood already in the facets (a distinct channel, no double-count).
const COACH_EDGE_K = 0.55; // edge per game-day-spectrum-avg point over the 5.5 midpoint (v0.181: a great-vs-terrible HC swings ~2-3pp win% — visible, still talent-secondary)
const COACH_AGGR_K = 0.06; // 4th-down go scaling per playCallingAggression point over midpoint
const COACH_GAMBLER_AGGR = 0.2; // FOURTH_DOWN_GAMBLER quirk bonus to aggression
const CHEM_NEUTRAL = 55; // chemistry score (0-100) that is a turnover no-op
const CHEM_TOXIC_TO_K = 0.005; // turnover-rate rise per point BELOW neutral (toxic)
const CHEM_GOOD_TO_K = 0.003; // turnover-rate fall per point ABOVE neutral (cohesive) — gentler = asymmetric

/** Head-coach competence edge from the game-day spectrums, centered on the
 *  5.5 spectrum midpoint (≈0 league mean, so scoring holds; spread widens). */
function headCoachEdge(hc: HeadCoach): number {
  const s = hc.spectrums;
  const avg = (s.gameManagement + s.playCallingAggression + s.adaptability + s.pressureResponse + s.experience) / 5;
  return COACH_EDGE_K * (avg - 5.5);
}
function coachAggression(hc: HeadCoach): number {
  return 1 + COACH_AGGR_K * (hc.spectrums.playCallingAggression - 5.5) + (hc.quirks.includes('FOURTH_DOWN_GAMBLER') ? COACH_GAMBLER_AGGR : 0);
}
/** Turnover multiplier from team chemistry (0-100), asymmetric about neutral. */
function chemTurnoverMult(chemScore: number): number {
  const d = chemScore - CHEM_NEUTRAL;
  return 1 + (d < 0 ? -CHEM_TOXIC_TO_K * d : -CHEM_GOOD_TO_K * d);
}

/** Full bottom-up game: builds facets + personnel from the rosters and returns
 *  the drive log + emergent per-player stat lines. Applies home-field advantage
 *  and resolves ties (the live season needs a winner). */
export function simulateGameWithDrives(
  prng: Prng,
  homeTeam: TeamState,
  awayTeam: TeamState,
  league: LeagueState,
  opts: DriveGameOptions = {},
): DriveGameResult {
  const playersOf = (t: TeamState): Player[] =>
    t.rosterIds.map((id) => league.players[id]).filter((p): p is Player => Boolean(p));
  const hf = matchupFacets(homeTeam, league);
  const af = matchupFacets(awayTeam, league);
  // Re-center each edge on this league-season's mean (invariant to the talent
  // scale's over-seasons drift; ~0 at a fresh league).
  const rc = leagueRecenter(league);
  const homeCtx = driveCtx(hf, af, rc);
  const awayCtx = driveCtx(af, hf, rc);
  if (!opts.neutralSite) {
    // Zero-sum: home offense plays up, away offense plays down by the same
    // amount (home defense plays up at home). League scoring mean is
    // unchanged; only the home/away win balance shifts.
    homeCtx.passEdge += HOME_FIELD_EDGE;
    homeCtx.runEdge += HOME_FIELD_EDGE;
    awayCtx.passEdge -= HOME_FIELD_EDGE;
    awayCtx.runEdge -= HOME_FIELD_EDGE;
  }
  // Coaching & chemistry (P3): the head coach's competence lifts the team's
  // edges and sets its 4th-down aggression; team chemistry drives the turnover
  // (mistakes) channel. Centered so the league scoring mean holds; the SPREAD
  // widens (better coaches / rooms separate → standings spread toward real).
  const homeHc = league.coaches[homeTeam.headCoachId];
  const awayHc = league.coaches[awayTeam.headCoachId];
  if (homeHc) {
    const e = headCoachEdge(homeHc);
    homeCtx.passEdge += e;
    homeCtx.runEdge += e;
    homeCtx.aggression = coachAggression(homeHc);
  }
  if (awayHc) {
    const e = headCoachEdge(awayHc);
    awayCtx.passEdge += e;
    awayCtx.runEdge += e;
    awayCtx.aggression = coachAggression(awayHc);
  }
  homeCtx.turnoverMult = chemTurnoverMult(teamChemistry(homeTeam, league).score);
  awayCtx.turnoverMult = chemTurnoverMult(teamChemistry(awayTeam, league).score);
  // Special teams (P4a): the offense's kicker shapes its FG make rate.
  const homePers = buildTeamPersonnel(playersOf(homeTeam));
  const awayPers = buildTeamPersonnel(playersOf(awayTeam));
  homeCtx.kickerRating = homePers.kickerRating;
  awayCtx.kickerRating = awayPers.kickerRating;
  return runGame(
    prng,
    { ctx: homeCtx, pers: homePers },
    { ctx: awayCtx, pers: awayPers },
    new Map<string, PlayerStatLine>(),
    { resolveTie: true },
  );
}
