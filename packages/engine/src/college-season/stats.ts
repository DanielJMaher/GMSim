import type { CollegePlayer } from '../types/college.js';
import { Position } from '../types/enums.js';
import type {
  CollegeGame,
  CollegePlayerGameStats,
  CollegeTeamGameStats,
} from '../types/college-season.js';
import { emptyCollegePlayerGameStats } from '../types/college-season.js';

/**
 * Depth-chart slot shares (v0.83). College box scores are distributed
 * across an ASSUMED full position room, and only the pool prospects'
 * slices are recorded — the rest implicitly belongs to non-draft-eligible
 * teammates and is dropped. This is the fix for the "lone pool prospect
 * inherits the whole team's stat line" bug: a single pool WR takes the
 * WR1 slot (~23% of targets), not 100%. Shares are absolute, NOT
 * normalized to the pool players present.
 *
 * Grounded in real per-game distributions: a team's lead receiver sees
 * ~22-25% of targets, the lead back ~50% of carries, the lead tackler
 * ~12-16% of team tackles. Sums need not reach 1.0 — unfilled slots are
 * production that went to untracked teammates.
 */
const RECV_SLOTS = [0.26, 0.19, 0.15, 0.11, 0.09, 0.07, 0.05, 0.04, 0.03, 0.01];
const RUSH_SLOTS = [0.5, 0.28, 0.14, 0.06, 0.02];
const QB_SLOTS = [0.92, 0.08];
const LB_TACKLE_SLOTS = [0.3, 0.25, 0.2, 0.13, 0.08, 0.04];
const DB_TACKLE_SLOTS = [0.24, 0.21, 0.18, 0.15, 0.11, 0.07, 0.04];
const DL_TACKLE_SLOTS = [0.27, 0.23, 0.19, 0.15, 0.1, 0.06];
const SACK_SLOTS = [0.42, 0.3, 0.18, 0.1];
const INT_SLOTS = [0.4, 0.3, 0.2, 0.1];

/**
 * Derive per-prospect stat lines for a played college game by
 * distributing team-level `CollegeGameResult` stats across the
 * school's prospect cohort.
 *
 * Pure & deterministic — no PRNG. Same input → same output. The
 * distribution is intentionally simple (proportional to skill +
 * position role) since this is attribute-time derivation, not a
 * play-by-play simulator.
 *
 * Stats are only attributed to prospects in the league's college
 * pool. Walk-ons + redshirts + non-draft-eligible roster fillers
 * are NOT modeled — team-level stats not attributable to a pool
 * prospect (e.g. school has no pool QB) are dropped. This is a
 * deliberate Slice 1 simplification: pool prospects are by
 * definition the draft-relevant ones, and that's the cohort the
 * scouting/Heisman/media layers care about.
 *
 * Players with all-zero lines are omitted from the result.
 */
export function deriveCollegeGamePlayerStats(
  game: CollegeGame,
  prospectsBySchool: ReadonlyMap<string, readonly CollegePlayer[]>,
  playedOnTick: number,
): readonly CollegePlayerGameStats[] {
  if (!game.result) return [];
  const home = prospectsBySchool.get(game.homeSchoolId) ?? [];
  const away = prospectsBySchool.get(game.awaySchoolId) ?? [];

  const lines = new Map<string, CollegePlayerGameStats>();
  attributeOffense(
    home,
    game.homeSchoolId,
    game.result.homeStats,
    game.result.homeScore,
    game,
    playedOnTick,
    lines,
  );
  attributeOffense(
    away,
    game.awaySchoolId,
    game.result.awayStats,
    game.result.awayScore,
    game,
    playedOnTick,
    lines,
  );
  // Defense: a team's defensive stat line is keyed off the OPPONENT's
  // turnovers (defense forced them) and own `sacks` (defense earned them).
  attributeDefense(
    home,
    game.homeSchoolId,
    game.result.homeStats,
    game.result.awayStats,
    game,
    playedOnTick,
    lines,
  );
  attributeDefense(
    away,
    game.awaySchoolId,
    game.result.awayStats,
    game.result.homeStats,
    game,
    playedOnTick,
    lines,
  );

  const out = [...lines.values()];
  for (const s of out) capGameLine(s);
  return out.filter(isNonEmpty);
}

/**
 * Hard single-game ceilings as a backstop (v0.83). The slot distribution
 * keeps normal games realistic; these caps ensure even an extreme team
 * line can never yield a record-shattering individual game. Set above the
 * 99th-percentile real college game, below the absurd.
 */
function capGameLine(s: CollegePlayerGameStats): void {
  s.passAttempts = Math.min(s.passAttempts, 65);
  s.passCompletions = Math.min(s.passCompletions, 50);
  s.passingYards = Math.min(s.passingYards, 550);
  s.passingTds = Math.min(s.passingTds, 7);
  s.interceptionsThrown = Math.min(s.interceptionsThrown, 6);
  s.rushingAttempts = Math.min(s.rushingAttempts, 40);
  s.rushingYards = Math.min(s.rushingYards, 320);
  s.rushingTds = Math.min(s.rushingTds, 6);
  s.targets = Math.min(s.targets, 26);
  s.receptions = Math.min(s.receptions, 18);
  s.receivingYards = Math.min(s.receivingYards, 280);
  s.receivingTds = Math.min(s.receivingTds, 5);
  s.tackles = Math.min(s.tackles, 22);
  s.sacks = Math.min(s.sacks, 6);
  s.interceptions = Math.min(s.interceptions, 4);
}

function isNonEmpty(s: CollegePlayerGameStats): boolean {
  return (
    s.passAttempts > 0 ||
    s.passingYards > 0 ||
    s.rushingAttempts > 0 ||
    s.rushingYards > 0 ||
    s.targets > 0 ||
    s.receivingYards > 0 ||
    s.tackles > 0 ||
    s.sacks > 0 ||
    s.interceptions > 0
  );
}

function getOrInit(
  lines: Map<string, CollegePlayerGameStats>,
  prospect: CollegePlayer,
  schoolId: string,
  game: CollegeGame,
  playedOnTick: number,
): CollegePlayerGameStats {
  let s = lines.get(prospect.id);
  if (!s) {
    s = emptyCollegePlayerGameStats(
      prospect.id,
      schoolId,
      game.id,
      playedOnTick,
      game.weekNumber,
      game.kind,
    );
    lines.set(prospect.id, s);
  }
  return s;
}

// ─── Offense ──────────────────────────────────────────────────────────

function attributeOffense(
  prospects: readonly CollegePlayer[],
  schoolId: string,
  teamStats: CollegeTeamGameStats,
  pointsScored: number,
  game: CollegeGame,
  playedOnTick: number,
  lines: Map<string, CollegePlayerGameStats>,
): void {
  if (prospects.length === 0) return;

  // Offensive-TD split mirrors NFL stats logic. College passing-TD
  // share is slightly lower than NFL (more rushing TDs in college
  // option / spread schemes).
  const totalOffensiveTds = Math.max(0, Math.round((pointsScored * 0.62) / 7));
  const passShareOfTds = clamp01(
    teamStats.passingYards / Math.max(1, teamStats.passingYards + teamStats.rushingYards),
    0.40,
    0.72,
  );
  const totalPassTds = Math.round(totalOffensiveTds * passShareOfTds);
  const totalRushTds = Math.max(0, totalOffensiveTds - totalPassTds);

  // ── Passing ──────────────────────────────────────────────────────
  const qbs = prospects
    .filter((p) => p.collegePosition === Position.QB)
    .sort(byTierThenSkill);
  if (qbs.length > 0) {
    // College yards-per-attempt ~7.3 historically; use 7.8 to mirror
    // the modern spread era.
    const totalAttempts = Math.max(0, Math.round(teamStats.passingYards / 7.8));
    const totalCompletions = Math.round(totalAttempts * 0.62);
    const totalInts = fractionalRound(
      teamStats.turnovers * 0.5,
      `${game.id}:int:${schoolId}`,
    );
    splitBySlots(qbs, QB_SLOTS, totalAttempts, (qb, n) => (getOrInit(lines, qb, schoolId, game, playedOnTick).passAttempts += n));
    splitBySlots(qbs, QB_SLOTS, totalCompletions, (qb, n) => (getOrInit(lines, qb, schoolId, game, playedOnTick).passCompletions += n));
    splitBySlots(qbs, QB_SLOTS, teamStats.passingYards, (qb, n) => (getOrInit(lines, qb, schoolId, game, playedOnTick).passingYards += n));
    splitBySlots(qbs, QB_SLOTS, totalPassTds, (qb, n) => (getOrInit(lines, qb, schoolId, game, playedOnTick).passingTds += n));
    splitBySlots(qbs, QB_SLOTS, totalInts, (qb, n) => (getOrInit(lines, qb, schoolId, game, playedOnTick).interceptionsThrown += n));
  }

  // ── Rushing ──────────────────────────────────────────────────────
  const rbs = prospects
    .filter((p) => p.collegePosition === Position.RB || p.collegePosition === Position.FB)
    .sort(byTierThenSkill);
  if (rbs.length > 0 && teamStats.rushingYards > 0) {
    // College YPC ~4.6; carries = rushingYards / 4.6.
    const totalCarries = Math.max(1, Math.round(teamStats.rushingYards / 4.6));
    splitBySlots(rbs, RUSH_SLOTS, totalCarries, (p, n) => (getOrInit(lines, p, schoolId, game, playedOnTick).rushingAttempts += n));
    splitBySlots(rbs, RUSH_SLOTS, teamStats.rushingYards, (p, n) => (getOrInit(lines, p, schoolId, game, playedOnTick).rushingYards += n));
    splitBySlots(rbs, RUSH_SLOTS, totalRushTds, (p, n) => (getOrInit(lines, p, schoolId, game, playedOnTick).rushingTds += n));
  }

  // ── Receiving ────────────────────────────────────────────────────
  const receivers = prospects
    .filter(
      (p) =>
        p.collegePosition === Position.WR ||
        p.collegePosition === Position.TE ||
        p.collegePosition === Position.RB,
    )
    .map((p) => ({ player: p, weight: receivingWeight(p) * keySkillAvg(p) }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, RECV_SLOTS.length)
    .map((x) => x.player);
  if (receivers.length > 0) {
    const totalAttempts = Math.max(0, Math.round(teamStats.passingYards / 7.8));
    const totalCompletions = Math.round(totalAttempts * 0.62);
    splitBySlots(receivers, RECV_SLOTS, totalAttempts, (p, n) => (getOrInit(lines, p, schoolId, game, playedOnTick).targets += n));
    splitBySlots(receivers, RECV_SLOTS, totalCompletions, (p, n) => (getOrInit(lines, p, schoolId, game, playedOnTick).receptions += n));
    splitBySlots(receivers, RECV_SLOTS, teamStats.passingYards, (p, n) => (getOrInit(lines, p, schoolId, game, playedOnTick).receivingYards += n));
    splitBySlots(receivers, RECV_SLOTS, totalPassTds, (p, n) => (getOrInit(lines, p, schoolId, game, playedOnTick).receivingTds += n));
  }
}

function clamp01(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

function fractionalRound(value: number, seed: string): number {
  const floor = Math.floor(value);
  const frac = value - floor;
  if (frac === 0) return floor;
  const h = fnv1aHash(seed);
  const r = h / 0x100000000;
  return floor + (r < frac ? 1 : 0);
}

function fnv1aHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Distribute `total` integer units across `players` (already ranked, best
 * first) using ABSOLUTE depth-chart `slotShares`. Player i receives
 * `round(total × slotShares[i])`; players beyond the slot list — and slots
 * beyond the players present — get nothing (that production belonged to
 * untracked, non-draft-eligible teammates). This is what bounds a lone
 * pool prospect to his depth-chart slice instead of the whole team line.
 */
function splitBySlots<T>(
  players: readonly T[],
  slotShares: readonly number[],
  total: number,
  apply: (p: T, n: number) => void,
): void {
  if (players.length === 0 || total <= 0) return;
  const n = Math.min(players.length, slotShares.length);
  for (let i = 0; i < n; i++) {
    const units = Math.round(total * slotShares[i]!);
    if (units > 0) apply(players[i]!, units);
  }
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function receivingWeight(p: CollegePlayer): number {
  if (p.collegePosition === Position.WR) return 1.0;
  if (p.collegePosition === Position.TE) return 0.75;
  if (p.collegePosition === Position.RB) return 0.4;
  return 0.2;
}

// ─── Defense ──────────────────────────────────────────────────────────

function attributeDefense(
  prospects: readonly CollegePlayer[],
  schoolId: string,
  ownStats: CollegeTeamGameStats,
  oppStats: CollegeTeamGameStats,
  game: CollegeGame,
  playedOnTick: number,
  lines: Map<string, CollegePlayerGameStats>,
): void {
  if (prospects.length === 0) return;

  // ── Tackles ──────────────────────────────────────────────────────
  // Derived from the OPPONENT's offensive output (more plays faced → more
  // tackles), not a constant — this both varies game-to-game and tracks
  // strength of schedule. Roughly: plays ≈ opp attempts + carries; ~80%
  // of plays end in a recorded tackle. A typical ~410-yd opponent yields
  // ~62 team tackles; a high-tempo opponent more.
  const oppPlays = oppStats.passingYards / 7.8 + oppStats.rushingYards / 4.6;
  const totalTackles = clampInt(Math.round(oppPlays * 0.8 + 6), 38, 85);
  const lbs = [...prospects]
    .filter((p) => p.collegePosition === Position.ILB || p.collegePosition === Position.OLB)
    .sort(byTierThenSkill);
  const dbs = [...prospects]
    .filter(
      (p) =>
        p.collegePosition === Position.CB ||
        p.collegePosition === Position.S ||
        p.collegePosition === Position.NICKEL,
    )
    .sort(byTierThenSkill);
  const dls = [...prospects]
    .filter(
      (p) =>
        p.collegePosition === Position.EDGE ||
        p.collegePosition === Position.DT ||
        p.collegePosition === Position.NT,
    )
    .sort(byTierThenSkill);

  // LBs ~52% / DBs ~32% / DL ~16% of team tackles; within each group the
  // production is spread over a full rotation via slot shares so a lone
  // pool defender takes only the lead-defender slice, not the group total.
  splitBySlots(lbs, LB_TACKLE_SLOTS, Math.round(totalTackles * 0.52), (p, n) => (getOrInit(lines, p, schoolId, game, playedOnTick).tackles += n));
  splitBySlots(dbs, DB_TACKLE_SLOTS, Math.round(totalTackles * 0.32), (p, n) => (getOrInit(lines, p, schoolId, game, playedOnTick).tackles += n));
  splitBySlots(dls, DL_TACKLE_SLOTS, Math.round(totalTackles * 0.16), (p, n) => (getOrInit(lines, p, schoolId, game, playedOnTick).tackles += n));

  // Sacks: ownStats.sacks = sacks this team's defense earned.
  const totalSacks = ownStats.sacks;
  if (totalSacks > 0) {
    const edges = [...prospects].filter((p) => p.collegePosition === Position.EDGE).sort(byTierThenSkill);
    const interior = [...prospects]
      .filter((p) => p.collegePosition === Position.DT || p.collegePosition === Position.NT)
      .sort(byTierThenSkill);
    const edgeShare = Math.round(totalSacks * 0.62);
    const dtShare = Math.max(0, totalSacks - edgeShare);
    splitBySlots(edges, SACK_SLOTS, edgeShare, (p, n) => (getOrInit(lines, p, schoolId, game, playedOnTick).sacks += n));
    splitBySlots(interior, SACK_SLOTS, dtShare, (p, n) => (getOrInit(lines, p, schoolId, game, playedOnTick).sacks += n));
  }

  // Defensive interceptions: ≈ 50% of opponent's turnovers.
  const totalInts = fractionalRound(
    oppStats.turnovers * 0.5,
    `${game.id}:def-int:${schoolId}`,
  );
  if (totalInts > 0) {
    const dbInts = Math.round(totalInts * 0.8);
    const lbInts = Math.max(0, totalInts - dbInts);
    splitBySlots(dbs, INT_SLOTS, dbInts, (p, n) => (getOrInit(lines, p, schoolId, game, playedOnTick).interceptions += n));
    splitBySlots(lbs, INT_SLOTS, lbInts, (p, n) => (getOrInit(lines, p, schoolId, game, playedOnTick).interceptions += n));
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

function byTierThenSkill(a: CollegePlayer, b: CollegePlayer): number {
  const t = tierRank(b) - tierRank(a);
  if (t !== 0) return t;
  return keySkillAvg(b) - keySkillAvg(a);
}

function tierRank(p: CollegePlayer): number {
  switch (p.tier) {
    case 'STAR':
      return 4;
    case 'STARTER':
      return 3;
    case 'BACKUP':
      return 2;
    case 'FRINGE':
      return 1;
  }
}

function keySkillAvg(p: CollegePlayer): number {
  return (p.current.technicalSkill + p.current.footballIq + p.current.speed) / 3;
}

