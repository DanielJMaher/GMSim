import type { CollegePlayer } from '../types/college.js';
import { Position } from '../types/enums.js';
import type {
  CollegeGame,
  CollegePlayerGameStats,
  CollegeTeamGameStats,
} from '../types/college-season.js';
import { emptyCollegePlayerGameStats } from '../types/college-season.js';

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

  return [...lines.values()].filter(isNonEmpty);
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
    const shares = qbs.length === 1 ? [1] : qbs.length === 2 ? [0.92, 0.08] : [0.92, 0.08, 0];
    splitInt(qbs, shares, totalAttempts, (qb, n) => (getOrInit(lines, qb, schoolId, game, playedOnTick).passAttempts += n));
    splitInt(qbs, shares, totalCompletions, (qb, n) => (getOrInit(lines, qb, schoolId, game, playedOnTick).passCompletions += n));
    splitInt(qbs, shares, teamStats.passingYards, (qb, n) => (getOrInit(lines, qb, schoolId, game, playedOnTick).passingYards += n));
    splitInt(qbs, shares, totalPassTds, (qb, n) => (getOrInit(lines, qb, schoolId, game, playedOnTick).passingTds += n));
    splitInt(qbs, shares, totalInts, (qb, n) => (getOrInit(lines, qb, schoolId, game, playedOnTick).interceptionsThrown += n));
  }

  // ── Rushing ──────────────────────────────────────────────────────
  const rbs = prospects
    .filter((p) => p.collegePosition === Position.RB || p.collegePosition === Position.FB)
    .sort(byTierThenSkill);
  if (rbs.length > 0 && teamStats.rushingYards > 0) {
    // College YPC ~4.6; carries = rushingYards / 4.6.
    const totalCarries = Math.max(1, Math.round(teamStats.rushingYards / 4.6));
    const shares =
      rbs.length === 1
        ? [1]
        : rbs.length === 2
          ? [0.68, 0.32]
          : [0.60, 0.25, 0.15, ...Array(rbs.length - 3).fill(0)];
    splitInt(rbs, shares, totalCarries, (p, n) => (getOrInit(lines, p, schoolId, game, playedOnTick).rushingAttempts += n));
    splitInt(rbs, shares, teamStats.rushingYards, (p, n) => (getOrInit(lines, p, schoolId, game, playedOnTick).rushingYards += n));
    splitInt(rbs, shares, totalRushTds, (p, n) => (getOrInit(lines, p, schoolId, game, playedOnTick).rushingTds += n));
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
    .slice(0, 7)
    .map((x) => x.player);
  if (receivers.length > 0) {
    const totalAttempts = Math.max(0, Math.round(teamStats.passingYards / 7.8));
    const totalCompletions = Math.round(totalAttempts * 0.62);
    const shares = recvSharesFor(receivers.length);
    splitInt(receivers, shares, totalAttempts, (p, n) => (getOrInit(lines, p, schoolId, game, playedOnTick).targets += n));
    splitInt(receivers, shares, totalCompletions, (p, n) => (getOrInit(lines, p, schoolId, game, playedOnTick).receptions += n));
    splitInt(receivers, shares, teamStats.passingYards, (p, n) => (getOrInit(lines, p, schoolId, game, playedOnTick).receivingYards += n));
    splitInt(receivers, shares, totalPassTds, (p, n) => (getOrInit(lines, p, schoolId, game, playedOnTick).receivingTds += n));
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

function recvSharesFor(n: number): number[] {
  const base = [0.30, 0.22, 0.16, 0.12, 0.09, 0.07, 0.04];
  const out = base.slice(0, n);
  const total = out.reduce((s, v) => s + v, 0);
  return out.map((v) => v / total);
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

  // College tackle volume is similar to NFL; use 65 total per game
  // (slightly higher than NFL's 62 to reflect longer games and
  // more snaps).
  const totalTackles = 65;
  const lbs = prospects.filter(
    (p) => p.collegePosition === Position.ILB || p.collegePosition === Position.OLB,
  );
  const dbs = prospects.filter(
    (p) =>
      p.collegePosition === Position.CB ||
      p.collegePosition === Position.S ||
      p.collegePosition === Position.NICKEL,
  );
  const dls = prospects.filter(
    (p) =>
      p.collegePosition === Position.EDGE ||
      p.collegePosition === Position.DT ||
      p.collegePosition === Position.NT,
  );

  const lbTackles = Math.round(totalTackles * 0.52);
  const dbTackles = Math.round(totalTackles * 0.32);
  const dlTackles = Math.round(totalTackles * 0.16);

  distributeBySkill(lbs, lbTackles, (p, n) => (getOrInit(lines, p, schoolId, game, playedOnTick).tackles += n));
  distributeBySkill(dbs, dbTackles, (p, n) => (getOrInit(lines, p, schoolId, game, playedOnTick).tackles += n));
  distributeBySkill(dls, dlTackles, (p, n) => (getOrInit(lines, p, schoolId, game, playedOnTick).tackles += n));

  // Sacks: ownStats.sacks = sacks this team's defense earned.
  const totalSacks = ownStats.sacks;
  if (totalSacks > 0) {
    const edges = prospects.filter((p) => p.collegePosition === Position.EDGE);
    const interior = prospects.filter(
      (p) => p.collegePosition === Position.DT || p.collegePosition === Position.NT,
    );
    const edgeShare = Math.round(totalSacks * 0.62);
    const dtShare = Math.max(0, totalSacks - edgeShare);
    distributeBySkill(edges, edgeShare, (p, n) => (getOrInit(lines, p, schoolId, game, playedOnTick).sacks += n));
    distributeBySkill(interior, dtShare, (p, n) => (getOrInit(lines, p, schoolId, game, playedOnTick).sacks += n));
  }

  // Defensive interceptions: ≈ 50% of opponent's turnovers.
  const totalInts = fractionalRound(
    oppStats.turnovers * 0.5,
    `${game.id}:def-int:${schoolId}`,
  );
  if (totalInts > 0) {
    const dbInts = Math.round(totalInts * 0.8);
    const lbInts = Math.max(0, totalInts - dbInts);
    distributeBySkill(dbs, dbInts, (p, n) => (getOrInit(lines, p, schoolId, game, playedOnTick).interceptions += n));
    distributeBySkill(lbs, lbInts, (p, n) => (getOrInit(lines, p, schoolId, game, playedOnTick).interceptions += n));
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

function splitInt<T>(
  players: readonly T[],
  shares: readonly number[],
  total: number,
  apply: (p: T, n: number) => void,
): void {
  if (players.length === 0 || total <= 0) return;
  const raw: number[] = [];
  let allocated = 0;
  for (let i = 0; i < players.length; i++) {
    const share = shares[i] ?? 0;
    const v = total * share;
    raw.push(v);
    allocated += Math.floor(v);
  }
  const remainders = raw
    .map((v, i) => ({ frac: v - Math.floor(v), i }))
    .sort((a, b) => b.frac - a.frac);
  const slack = total - allocated;
  const ints = raw.map((v) => Math.floor(v));
  for (let k = 0; k < slack; k++) {
    const idx = remainders[k % remainders.length]!.i;
    ints[idx]! += 1;
  }
  for (let i = 0; i < players.length; i++) {
    if (ints[i]! > 0) apply(players[i]!, ints[i]!);
  }
}

function distributeBySkill(
  prospects: readonly CollegePlayer[],
  total: number,
  apply: (p: CollegePlayer, n: number) => void,
): void {
  if (prospects.length === 0 || total <= 0) return;
  const weights = prospects.map(keySkillAvg);
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) {
    apply(prospects[0]!, total);
    return;
  }
  const shares = weights.map((w) => w / sum);
  splitInt(prospects, shares, total, apply);
}
