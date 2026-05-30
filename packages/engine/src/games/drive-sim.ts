import type { Prng } from '../prng/index.js';
import type { MatchupFacets } from './strength.js';
import { matchupFacets } from './strength.js';
import type { Player, PlayerSkills } from '../types/player.js';
import type { TeamState } from '../types/team.js';
import type { LeagueState } from '../types/league.js';
import { Position } from '../types/enums.js';

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
  sacks: number;
  interceptions: number;
}

export interface DriveGameResult {
  homeScore: number;
  awayScore: number;
  driveLog: DriveOutcome[];
  /** Bottom-up per-player stat lines (only when run with personnel). */
  playerStats?: Map<string, PlayerStatLine>;
}

// ── Calibration constants (Magistrate 2015-2024 bar; see git history). ──
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
const KICKOFF_START = 27;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function fgSuccess(distance: number): number {
  if (distance <= 30) return 0.97;
  if (distance <= 40) return 0.9;
  if (distance <= 47) return 0.8;
  if (distance <= 53) return 0.62;
  if (distance <= 57) return 0.45;
  return 0.25;
}

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

type PlayKind = 'complete' | 'incomplete' | 'int' | 'sack' | 'run' | 'fumble';
interface PlayResult {
  isPass: boolean;
  gain: number;
  kind: PlayKind;
}

/** Resolve one play's OUTCOME from the matchup (the calibrated 1a logic). */
function resolvePlay(prng: Prng, ctx: DriveCtx, down: number, togo: number): PlayResult {
  const isPass = prng.next() < passRate(down, togo);
  if (isPass) {
    if (prng.next() < clamp(SACK_RATE - ctx.protEdge * 0.0018, 0.02, 0.14)) {
      return { isPass, gain: -SACK_YDS, kind: 'sack' };
    }
    if (prng.next() < clamp(INT_RATE - ctx.passEdge * 0.0007, 0.004, 0.06)) {
      return { isPass, gain: 0, kind: 'int' };
    }
    if (prng.next() < clamp(BASE_COMPLETION + ctx.passEdge * 0.004, 0.45, 0.82)) {
      let gain = Math.round(prng.normal(YDS_PER_COMPLETION + ctx.passEdge * 0.05, YDS_PER_COMPLETION_SD));
      if (gain < -3) gain = -3;
      return { isPass, gain, kind: 'complete' };
    }
    return { isPass, gain: 0, kind: 'incomplete' };
  }
  if (prng.next() < FUMBLE_LOST_RATE) return { isPass: false, gain: 0, kind: 'fumble' };
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
  receivers: PRef[];
  rushers: PRef[];
  passRush: PRef[];
  coverage: PRef[];
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

export function buildTeamPersonnel(players: Player[]): TeamPersonnel {
  const qb = players
    .filter((p) => p.position === Position.QB)
    .sort((a, b) => meanKeys(b, ['accuracyShort', 'accuracyMedium', 'accuracyDeep', 'decisionMaking']) - meanKeys(a, ['accuracyShort', 'accuracyMedium', 'accuracyDeep', 'decisionMaking']))[0];

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

  const passRushPos = new Set<Position>([Position.EDGE, Position.DT, Position.NT, Position.OLB]);
  const passRush: PRef[] = players
    .filter((p) => passRushPos.has(p.position))
    .map((p) => ({ id: p.id, weight: steep(meanKeys(p, PRUSH_KEYS)) }))
    .filter((r) => r.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);

  const covPos = new Set<Position>([Position.CB, Position.S, Position.NICKEL, Position.ILB, Position.OLB]);
  const coverage: PRef[] = players
    .filter((p) => covPos.has(p.position))
    .map((p) => ({ id: p.id, weight: meanKeys(p, COV_KEYS) }))
    .filter((r) => r.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 6);

  return { qb: qb?.id ?? null, receivers, rushers, passRush, coverage };
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
    receivingYards: 0, receivingTds: 0, sacks: 0, interceptions: 0,
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
): { result: DriveResult; plays: number; yards: number } {
  let ballOn = startYardline;
  let down = 1;
  let togo = 10;
  let plays = 0;

  for (;;) {
    if (down === 4) {
      const toGoal = 100 - ballOn;
      const fgDist = toGoal + 17;
      const inFgRange = fgDist <= 56;
      let go = false;
      if (toGoal <= 2 && togo <= 1) go = prng.next() < 0.55;
      else if (inFgRange) go = false;
      else if (togo <= 1 && ballOn >= 30) go = prng.next() < 0.8;
      else if (togo <= 2 && ballOn >= 42) go = prng.next() < 0.6;
      else if (togo <= 5 && ballOn >= 45) go = prng.next() < 0.5;
      else if (ballOn >= 48) go = prng.next() < 0.35;
      if (!go) {
        plays++;
        if (inFgRange) {
          return { result: prng.next() < fgSuccess(fgDist) ? 'FG' : 'MISSED_FG', plays, yards: ballOn - startYardline };
        }
        return { result: 'PUNT', plays, yards: ballOn - startYardline };
      }
    }

    plays++;
    const pr = resolvePlay(prng, ctx, down, togo);

    // ── Attribute the play's outcome to specific players (stage 1b). ──
    let scorer: { id: string; kind: 'rec' | 'rush' } | null = null;
    if (attr) {
      if (pr.isPass) {
        if (pr.kind === 'sack') {
          const d = pick(prng, attr.def.passRush);
          if (d) line(attr.stats, d).sacks += 1;
        } else {
          if (attr.off.qb) line(attr.stats, attr.off.qb).passAttempts += 1;
          const recvId = pick(prng, attr.off.receivers);
          if (recvId) line(attr.stats, recvId).targets += 1;
          if (pr.kind === 'complete' && attr.off.qb) {
            const q = line(attr.stats, attr.off.qb);
            q.passCompletions += 1;
            q.passingYards += pr.gain;
            if (recvId) {
              const r = line(attr.stats, recvId);
              r.receptions += 1;
              r.receivingYards += pr.gain;
              scorer = { id: recvId, kind: 'rec' };
            }
          } else if (pr.kind === 'int') {
            if (attr.off.qb) line(attr.stats, attr.off.qb).interceptionsThrown += 1;
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
          }
        }
      }
    }

    if (pr.kind === 'int' || pr.kind === 'fumble') {
      return { result: 'TURNOVER', plays, yards: ballOn - startYardline };
    }
    ballOn += pr.gain;
    if (ballOn >= 100) {
      if (attr && scorer) {
        if (scorer.kind === 'rec') {
          line(attr.stats, scorer.id).receivingTds += 1;
          if (attr.off.qb) line(attr.stats, attr.off.qb).passingTds += 1;
        } else {
          line(attr.stats, scorer.id).rushingTds += 1;
        }
      }
      return { result: 'TD', plays, yards: 100 - startYardline };
    }
    if (ballOn <= 0) return { result: 'SAFETY', plays, yards: ballOn - startYardline };
    togo -= pr.gain;
    if (togo <= 0) {
      down = 1;
      togo = Math.min(10, 100 - ballOn);
    } else {
      down++;
      if (down > 4) return { result: 'DOWNS', plays, yards: ballOn - startYardline };
    }
  }
}

interface Side {
  ctx: DriveCtx;
  pers: TeamPersonnel | null;
}

function runGame(prng: Prng, home: Side, away: Side, stats: Map<string, PlayerStatLine> | null): DriveGameResult {
  const driveLog: DriveOutcome[] = [];
  let homeScore = 0;
  let awayScore = 0;
  let d = 0;
  let offense: 'home' | 'away' = 'home';

  for (let half = 0; half < 2; half++) {
    let halfPlays = 0;
    for (;;) {
      if (halfPlays >= HALF_PLAYS) {
        driveLog.push({ offense, result: 'END_HALF', plays: prng.nextRange(1, 4), yards: 0 });
        offense = offense === 'home' ? 'away' : 'home';
        break;
      }
      const off = offense === 'home' ? home : away;
      const def = offense === 'home' ? away : home;
      const attr: Attr | null = stats && off.pers && def.pers ? { off: off.pers, def: def.pers, stats } : null;
      const drive = simulateDrive(prng.fork(`drive:${half}:${d++}`), off.ctx, KICKOFF_START, attr);
      halfPlays += drive.plays;
      driveLog.push({ offense, ...drive });
      const pts = POINTS[drive.result] ?? 0;
      if (offense === 'home') homeScore += pts;
      else awayScore += pts;
      if (drive.result === 'SAFETY') {
        if (offense === 'home') awayScore += 2;
        else homeScore += 2;
      }
      offense = offense === 'home' ? 'away' : 'home';
    }
  }
  const result: DriveGameResult = { homeScore, awayScore, driveLog };
  if (stats) result.playerStats = stats;
  return result;
}

/** Facet-only drive sim (no player attribution) — used by the Magistrate. */
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

/** Full bottom-up game: builds facets + personnel from the rosters and returns
 *  the drive log + emergent per-player stat lines (stage 1b). */
export function simulateGameWithDrives(
  prng: Prng,
  homeTeam: TeamState,
  awayTeam: TeamState,
  league: LeagueState,
): DriveGameResult {
  const playersOf = (t: TeamState): Player[] =>
    t.rosterIds.map((id) => league.players[id]).filter((p): p is Player => Boolean(p));
  const hf = matchupFacets(homeTeam, league);
  const af = matchupFacets(awayTeam, league);
  return runGame(
    prng,
    { ctx: driveCtx(hf, af), pers: buildTeamPersonnel(playersOf(homeTeam)) },
    { ctx: driveCtx(af, hf), pers: buildTeamPersonnel(playersOf(awayTeam)) },
    new Map<string, PlayerStatLine>(),
  );
}
