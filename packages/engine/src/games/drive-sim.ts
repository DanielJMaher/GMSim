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
  tackles: number;
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
const INT_RATE = 0.03;
const FUMBLE_LOST_RATE = 0.011;
const KICKOFF_START = 27;

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
const RED_ZONE_TD_BASE = 0.52; // TD prob for a trip entering at the 20 (depth 0)
const RED_ZONE_TD_DEPTH = 0.48; // additional TD prob at the goal line (depth 1)
const RED_ZONE_TD_EDGE = 0.004; // per-point passEdge adjustment
const RED_ZONE_FG_CONDITIONAL = 0.82; // of NON-TD trips, the share that kick (else fail)

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

function fgSuccess(distance: number): number {
  if (distance <= 30) return 0.97;
  if (distance <= 40) return 0.9;
  if (distance <= 47) return 0.8;
  if (distance <= 53) return 0.62;
  if (distance <= 57) return 0.45;
  return 0.25;
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

/** Pass-rate shift for the OFFENSE: + when trailing, − when leading.
 *  `progress` is 0..1 of regulation. Zero through the first half, partial
 *  in Q3, full step in Q4. Exported for tests. */
export function gameScriptShift(offenseScoreDiff: number, progress: number): number {
  if (offenseScoreDiff === 0 || progress < 0.5) return 0;
  if (offenseScoreDiff < 0) {
    const d = -offenseScoreDiff;
    const late = progress >= 0.75 ? 1 : SCRIPT_Q3_TRAIL;
    return late * (SCRIPT_TRAIL_BASE + SCRIPT_TRAIL_SLOPE * clamp((d - 1) / 9, 0, 1));
  }
  const late = progress >= 0.75 ? 1 : SCRIPT_Q3_LEAD;
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

  const passRushPos = new Set<Position>([Position.EDGE, Position.DT, Position.NT, Position.OLB]);
  const passRush: PRef[] = players
    .filter((p) => passRushPos.has(p.position))
    .map((p) => ({ id: p.id, weight: steep(meanKeys(p, PRUSH_KEYS)) }))
    .filter((r) => r.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);

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

  return { qb: qb?.id ?? null, qb2: qb2?.id ?? null, receivers, rushers, passRush, coverage, tacklers };
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
): { result: DriveResult; plays: number; yards: number } {
  let ballOn = startYardline;
  let down = 1;
  let togo = 10;
  let plays = 0;
  let redZoneRolled = false; // red-zone TD conversion fires at most once/drive

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
    const pr = resolvePlay(prng, ctx, down, togo, scriptShift);

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
          }
        }
      }
    }

    if (pr.kind === 'int' || pr.kind === 'fumble') {
      return { result: 'TURNOVER', plays, yards: ballOn - startYardline };
    }
    ballOn += pr.gain;
    const advanced = pr.kind === 'complete' || pr.kind === 'run';
    const scoreTd = (): { result: DriveResult; plays: number; yards: number } => {
      if (attr && scorer) {
        if (scorer.kind === 'rec') {
          line(attr.stats, scorer.id).receivingTds += 1;
          if (scorer.passer) line(attr.stats, scorer.passer).passingTds += 1;
        } else {
          line(attr.stats, scorer.id).rushingTds += 1;
        }
      }
      return { result: 'TD', plays, yards: 100 - startYardline };
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
        return {
          result: prng.next() < fgSuccess(fgDist) ? 'FG' : 'MISSED_FG',
          plays,
          yards: ballOn - startYardline,
        };
      }
      return { result: 'DOWNS', plays, yards: ballOn - startYardline };
    }
    // A run/completion that didn't score ends in a tackle by the defense.
    if (attr && tackleEligible) {
      const t = pick(prng, attr.def.tacklers);
      if (t) line(attr.stats, t).tackles += 1;
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
  let d = 0;
  let totalPlays = 0;
  let offense: 'home' | 'away' = 'home';

  const playDrive = (tag: string): { result: DriveResult; plays: number; yards: number } => {
    const off = offense === 'home' ? home : away;
    const def = offense === 'home' ? away : home;
    const attr: Attr | null = stats && off.pers && def.pers ? { off: off.pers, def: def.pers, stats } : null;
    // Game script (v0.149): the offense calls plays knowing the score and
    // how late it is — trailing late tilts pass, leading late tilts run.
    const diff = offense === 'home' ? homeScore - awayScore : awayScore - homeScore;
    const progress = Math.min(1, totalPlays / (2 * HALF_PLAYS));
    const drive = simulateDrive(
      prng.fork(tag),
      off.ctx,
      KICKOFF_START,
      attr,
      gameScriptShift(diff, progress),
    );
    driveLog.push({ offense, ...drive });
    const pts = POINTS[drive.result] ?? 0;
    if (offense === 'home') homeScore += pts;
    else awayScore += pts;
    if (drive.result === 'SAFETY') {
      if (offense === 'home') awayScore += 2;
      else homeScore += 2;
    }
    return drive;
  };

  for (let half = 0; half < 2; half++) {
    let halfPlays = 0;
    for (;;) {
      if (halfPlays >= HALF_PLAYS) {
        driveLog.push({ offense, result: 'END_HALF', plays: prng.nextRange(1, 4), yards: 0 });
        offense = offense === 'home' ? 'away' : 'home';
        break;
      }
      const drive = playDrive(`drive:${half}:${d++}`);
      halfPlays += drive.plays;
      totalPlays += drive.plays;
      offense = offense === 'home' ? 'away' : 'home';
    }
  }

  // Overtime — the live game must produce a winner. Each round both teams get
  // one possession; a round that ends with a lead ends the game. Capped, then
  // broken by total OT yardage (else a coin flip) so it always terminates.
  if (opts.resolveTie && homeScore === awayScore) {
    let otYardsHome = 0;
    let otYardsAway = 0;
    for (let round = 0; round < 8 && homeScore === awayScore; round++) {
      offense = 'home';
      otYardsHome += Math.max(0, playDrive(`ot:${round}:h`).yards);
      offense = 'away';
      otYardsAway += Math.max(0, playDrive(`ot:${round}:a`).yards);
    }
    if (homeScore === awayScore) {
      if (otYardsHome > otYardsAway) homeScore += 3;
      else if (otYardsAway > otYardsHome) awayScore += 3;
      else if (prng.next() < 0.5) homeScore += 3;
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
  const homeCtx = driveCtx(hf, af);
  const awayCtx = driveCtx(af, hf);
  if (!opts.neutralSite) {
    // Zero-sum: home offense plays up, away offense plays down by the same
    // amount (home defense plays up at home). League scoring mean is
    // unchanged; only the home/away win balance shifts.
    homeCtx.passEdge += HOME_FIELD_EDGE;
    homeCtx.runEdge += HOME_FIELD_EDGE;
    awayCtx.passEdge -= HOME_FIELD_EDGE;
    awayCtx.runEdge -= HOME_FIELD_EDGE;
  }
  return runGame(
    prng,
    { ctx: homeCtx, pers: buildTeamPersonnel(playersOf(homeTeam)) },
    { ctx: awayCtx, pers: buildTeamPersonnel(playersOf(awayTeam)) },
    new Map<string, PlayerStatLine>(),
    { resolveTie: true },
  );
}
