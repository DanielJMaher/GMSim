import type { Prng } from '../prng/index.js';
import type { MatchupFacets } from './strength.js';

/**
 * Matchup-driven (bottom-up) game simulation — tier 2, drive-based (v0.105+).
 *
 * Built SIDE-BY-SIDE with the legacy top-down `outcome.rollStats`: a game is a
 * sequence of drives, each drive a down-and-distance loop of plays whose
 * outcomes are shaped by the offense's facets vs the defense's. Drive results
 * (TD/FG/punt/turnover/downs) and team production EMERGE from the plays rather
 * than being rolled at the team level and divided — so (in stage 1b) an elite
 * player's production can separate. Stage 1a establishes realistic DRIVE
 * outcomes, calibrated against the Magistrate's real-NFL bar.
 *
 * NOT wired into the live game flow yet — exposed for the Magistrate to
 * validate before any swap-in.
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
  /** Plays run on the drive (incl. the punt/FG attempt). */
  plays: number;
  /** Net offensive yards gained. */
  yards: number;
}

export interface DriveGameResult {
  homeScore: number;
  awayScore: number;
  driveLog: DriveOutcome[];
}

// ── Calibration constants (tuned against the Magistrate 2015-2024 bar:
//    TD 21.7% / FG 14.6% / Punt 37.2% / Turnover 11.5% / Downs 4.7%;
//    1.95 pts, 5.5 plays, 30.9 yds per drive; 5.52 yds/play; 39.6% 3rd-down). ──
const PLAY_BUDGET = 124; // total offensive plays/game across both teams
const HALF_PLAYS = 62;
const PASS_RATE = 0.57;
const BASE_COMPLETION = 0.655;
const YDS_PER_COMPLETION = 13;
const YDS_PER_COMPLETION_SD = 11;
const RUN_YDS = 4.7;
const RUN_YDS_SD = 7.5;
const SACK_RATE = 0.06;
const SACK_YDS = 7;
const INT_RATE = 0.03;
const FUMBLE_LOST_RATE = 0.011;
const KICKOFF_START = 27; // own yardline after a touchback-ish kickoff

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Field-goal make probability by attempt distance (yards). */
function fgSuccess(distance: number): number {
  if (distance <= 30) return 0.97;
  if (distance <= 40) return 0.9;
  if (distance <= 47) return 0.8;
  if (distance <= 53) return 0.62;
  if (distance <= 57) return 0.45;
  return 0.25;
}

/** Pass more on obvious passing downs. */
function passRate(down: number, togo: number): number {
  if (down >= 3 && togo >= 6) return 0.82;
  if (down >= 3 && togo <= 2) return 0.35;
  return PASS_RATE;
}

interface DriveCtx {
  passEdge: number;
  protEdge: number;
  runEdge: number;
}

function driveCtx(off: MatchupFacets, def: MatchupFacets): DriveCtx {
  return {
    passEdge: (off.qbPlay * 0.5 + off.receivingCorps * 0.5) - def.coverage,
    protEdge: off.passProtection - def.passRush,
    runEdge: (off.runBlocking * 0.5 + off.rushingCorps * 0.5) - def.runDefense,
  };
}

/** Simulate one drive from `startYardline` (own side; 0=own goal, 100=opp goal). */
function simulateDrive(prng: Prng, ctx: DriveCtx, startYardline: number): { result: DriveResult; plays: number; yards: number } {
  let ballOn = startYardline;
  let down = 1;
  let togo = 10;
  let plays = 0;

  for (;;) {
    // 4th-down decision. Real drives end on downs ~4.7% of the time, so teams
    // go for it in short/medium situations (and ~half fail) rather than always
    // punting.
    if (down === 4) {
      const toGoal = 100 - ballOn;
      const fgDist = toGoal + 17;
      const inFgRange = fgDist <= 56;
      let go = false;
      if (toGoal <= 2 && togo <= 1) {
        go = prng.next() < 0.55; // 4th-and-inches at the goal line
      } else if (inFgRange) {
        go = false; // in FG range → kick (the realistic default)
      } else if (togo <= 1 && ballOn >= 30) {
        go = prng.next() < 0.8; // 4th-and-1
      } else if (togo <= 2 && ballOn >= 42) {
        go = prng.next() < 0.6; // 4th-and-2
      } else if (togo <= 5 && ballOn >= 45) {
        go = prng.next() < 0.5; // short-medium, midfield/dead zone
      } else if (ballOn >= 48) {
        go = prng.next() < 0.35; // 4th-and-long dead zone (gamble vs punt)
      }
      if (!go) {
        plays++;
        if (inFgRange) {
          return { result: prng.next() < fgSuccess(fgDist) ? 'FG' : 'MISSED_FG', plays, yards: ballOn - startYardline };
        }
        return { result: 'PUNT', plays, yards: ballOn - startYardline };
      }
    }

    plays++;
    let gain = 0;
    const isPass = prng.next() < passRate(down, togo);
    if (isPass) {
      if (prng.next() < clamp(SACK_RATE - ctx.protEdge * 0.0018, 0.02, 0.14)) {
        gain = -SACK_YDS;
      } else if (prng.next() < clamp(INT_RATE - ctx.passEdge * 0.0007, 0.004, 0.06)) {
        return { result: 'TURNOVER', plays, yards: ballOn - startYardline };
      } else if (prng.next() < clamp(BASE_COMPLETION + ctx.passEdge * 0.004, 0.45, 0.82)) {
        gain = Math.round(prng.normal(YDS_PER_COMPLETION + ctx.passEdge * 0.05, YDS_PER_COMPLETION_SD));
        if (gain < -3) gain = -3;
      } else {
        gain = 0; // incompletion
      }
    } else {
      if (prng.next() < FUMBLE_LOST_RATE) {
        return { result: 'TURNOVER', plays, yards: ballOn - startYardline };
      }
      gain = Math.round(prng.normal(RUN_YDS + ctx.runEdge * 0.06, RUN_YDS_SD));
    }

    ballOn += gain;
    if (ballOn >= 100) return { result: 'TD', plays, yards: 100 - startYardline };
    if (ballOn <= 0) return { result: 'SAFETY', plays, yards: ballOn - startYardline };
    togo -= gain;
    if (togo <= 0) {
      down = 1;
      togo = Math.min(10, 100 - ballOn);
    } else {
      down++;
      if (down > 4) return { result: 'DOWNS', plays, yards: ballOn - startYardline };
    }
  }
}

const POINTS: Partial<Record<DriveResult, number>> = { TD: 7, FG: 3 };

/**
 * Simulate a full game's drives from the two teams' matchup facets. Returns
 * the drive log + final score. Deterministic for the given prng.
 */
export function simulateGameDrives(
  prng: Prng,
  homeFacets: MatchupFacets,
  awayFacets: MatchupFacets,
): DriveGameResult {
  const ctx = {
    home: driveCtx(homeFacets, awayFacets),
    away: driveCtx(awayFacets, homeFacets),
  };
  const driveLog: DriveOutcome[] = [];
  let homeScore = 0;
  let awayScore = 0;
  let d = 0;

  // Two halves; the team with the ball when a half's play budget is exhausted
  // ends in END_HALF (clock), mirroring real drive-result mix.
  let offense: 'home' | 'away' = 'home';
  for (let half = 0; half < 2; half++) {
    let halfPlays = 0;
    for (;;) {
      if (halfPlays >= HALF_PLAYS) {
        // Clock-kill possession to close the half.
        driveLog.push({ offense, result: 'END_HALF', plays: prng.nextRange(1, 4), yards: 0 });
        offense = offense === 'home' ? 'away' : 'home';
        break;
      }
      const drive = simulateDrive(prng.fork(`drive:${half}:${d++}`), ctx[offense], KICKOFF_START);
      halfPlays += drive.plays;
      driveLog.push({ offense, ...drive });
      const pts = POINTS[drive.result] ?? 0;
      if (offense === 'home') homeScore += pts;
      else awayScore += pts;
      // Safety: 2 points to the defense.
      if (drive.result === 'SAFETY') {
        if (offense === 'home') awayScore += 2;
        else homeScore += 2;
      }
      offense = offense === 'home' ? 'away' : 'home';
    }
  }
  void PLAY_BUDGET;
  return { homeScore, awayScore, driveLog };
}
