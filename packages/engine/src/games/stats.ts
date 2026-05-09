import type { LeagueState } from '../types/league.js';
import type { TeamState } from '../types/team.js';
import type { Player } from '../types/player.js';
import type { ScheduledGame, TeamGameStats } from '../types/game.js';
import { type PlayerGameStats, emptyPlayerGameStats } from '../types/stats.js';
import { Position, PositionGroup } from '../types/enums.js';
import { getArchetypeById } from '../archetypes/index.js';

/**
 * Derive per-player stat lines for a played game by distributing
 * team-level GameResult stats across the rosters that played.
 *
 * Pure & deterministic — no PRNG. Same input → same output. The
 * distribution is intentionally simple (proportional to skill +
 * archetype role) since this is Phase 2 attribute-time derivation,
 * not a play-by-play simulator.
 *
 * Stat conventions (matching conventional NFL box scores):
 *   - `team.turnovers` = turnovers the team's offense committed
 *     (~60% picks, ~40% fumbles in our split)
 *   - `team.sacks` = sacks the team's defense generated
 *
 * Players with all-zero lines are omitted from the result.
 */
export function deriveGamePlayerStats(
  game: ScheduledGame,
  league: LeagueState,
): readonly PlayerGameStats[] {
  if (!game.result) return [];
  const home = league.teams[game.homeTeamId];
  const away = league.teams[game.awayTeamId];
  if (!home || !away) return [];

  const lines = new Map<string, PlayerGameStats>();
  attributeOffense(home, game.result.homeStats, lines, league);
  attributeOffense(away, game.result.awayStats, lines, league);
  // Defense reads its own `sacks` (defensive credit) and the
  // opponent's `turnovers` (which the defense forced).
  attributeDefense(home, game.result.homeStats, game.result.awayStats, lines, league);
  attributeDefense(away, game.result.awayStats, game.result.homeStats, lines, league);

  // Drop empty stat lines (every-zero entries from rosters that didn't
  // contribute, e.g. a 3rd-string QB with 0 attempts).
  return [...lines.values()].filter(isNonEmpty);
}

function isNonEmpty(s: PlayerGameStats): boolean {
  return (
    s.passAttempts > 0 ||
    s.rushingAttempts > 0 ||
    s.targets > 0 ||
    s.tackles > 0 ||
    s.sacks > 0 ||
    s.interceptions > 0
  );
}

function getOrInit(
  lines: Map<string, PlayerGameStats>,
  playerId: string,
): PlayerGameStats {
  let s = lines.get(playerId);
  if (!s) {
    s = emptyPlayerGameStats(playerId as PlayerGameStats['playerId']);
    lines.set(playerId, s);
  }
  return s;
}

// ─── Offense ──────────────────────────────────────────────────────────

function attributeOffense(
  team: TeamState,
  teamStats: TeamGameStats,
  lines: Map<string, PlayerGameStats>,
  league: LeagueState,
): void {
  const players = team.rosterIds
    .map((id) => league.players[id])
    .filter((p): p is Player => Boolean(p));

  // ── Passing ──────────────────────────────────────────────────────
  const qbs = players
    .filter((p) => p.position === Position.QB)
    .sort(byTierThenSkill);
  if (qbs.length > 0) {
    // Approx attempts from yards-per-attempt = 7.0
    const totalAttempts = Math.max(0, Math.round(teamStats.passingYards / 7));
    const totalCompletions = Math.round(totalAttempts * 0.65);
    // Pass TDs: rough heuristic. ~1 pass TD per 80 passing yards.
    const totalPassTds = Math.round(teamStats.passingYards / 80);
    // INTs ≈ 60% of team turnovers (rest are fumbles).
    const totalInts = Math.round(teamStats.turnovers * 0.6);

    // QB1 ~93% of pass volume, QB2 ~7%, QB3 ~0% unless QB1+QB2 absent.
    const shares = qbs.length === 1 ? [1] : qbs.length === 2 ? [0.93, 0.07] : [0.93, 0.07, 0];
    splitInt(qbs, shares, totalAttempts, (qb, n) => (getOrInit(lines, qb.id).passAttempts += n));
    splitInt(qbs, shares, totalCompletions, (qb, n) => (getOrInit(lines, qb.id).passCompletions += n));
    splitInt(qbs, shares, teamStats.passingYards, (qb, n) => (getOrInit(lines, qb.id).passingYards += n));
    splitInt(qbs, shares, totalPassTds, (qb, n) => (getOrInit(lines, qb.id).passingTds += n));
    splitInt(qbs, shares, totalInts, (qb, n) => (getOrInit(lines, qb.id).interceptionsThrown += n));
  }

  // ── Rushing ──────────────────────────────────────────────────────
  const rbs = players
    .filter((p) => p.position === Position.RB || p.position === Position.FB)
    .sort(byTierThenSkill);
  if (rbs.length > 0 && teamStats.rushingYards > 0) {
    const totalCarries = Math.max(1, Math.round(teamStats.rushingYards / 4.2));
    const totalRushTds = Math.round(teamStats.rushingYards / 60);
    const shares =
      rbs.length === 1
        ? [1]
        : rbs.length === 2
          ? [0.7, 0.3]
          : [0.62, 0.25, 0.13, ...Array(rbs.length - 3).fill(0)];
    splitInt(rbs, shares, totalCarries, (p, n) => (getOrInit(lines, p.id).rushingAttempts += n));
    splitInt(rbs, shares, teamStats.rushingYards, (p, n) => (getOrInit(lines, p.id).rushingYards += n));
    splitInt(rbs, shares, totalRushTds, (p, n) => (getOrInit(lines, p.id).rushingTds += n));
  }

  // ── Receiving ────────────────────────────────────────────────────
  // Pass-catchers ranked by (positional weight × key-skill avg) so WRs
  // and TEs land above RBs in target priority.
  const receivers = players
    .filter(
      (p) =>
        p.position === Position.WR ||
        p.position === Position.TE ||
        p.position === Position.RB,
    )
    .map((p) => ({ player: p, weight: receivingWeight(p) * keySkillAvg(p) }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 7) // top 7 get 95%+ of targets
    .map((x) => x.player);
  if (receivers.length > 0) {
    const totalAttempts = Math.max(0, Math.round(teamStats.passingYards / 7));
    const totalCompletions = Math.round(totalAttempts * 0.65);
    const totalPassTds = Math.round(teamStats.passingYards / 80);
    const shares = recvSharesFor(receivers.length);
    splitInt(receivers, shares, totalAttempts, (p, n) => (getOrInit(lines, p.id).targets += n));
    splitInt(receivers, shares, totalCompletions, (p, n) => (getOrInit(lines, p.id).receptions += n));
    splitInt(receivers, shares, teamStats.passingYards, (p, n) => (getOrInit(lines, p.id).receivingYards += n));
    splitInt(receivers, shares, totalPassTds, (p, n) => (getOrInit(lines, p.id).receivingTds += n));
  }
}

function recvSharesFor(n: number): number[] {
  // Pareto-ish target distribution.
  const base = [0.28, 0.20, 0.16, 0.13, 0.10, 0.08, 0.05];
  const out = base.slice(0, n);
  const total = out.reduce((s, v) => s + v, 0);
  // Normalize to 1.0 in case we sliced fewer than 7.
  return out.map((v) => v / total);
}

function receivingWeight(p: Player): number {
  if (p.position === Position.WR) return 1.0;
  if (p.position === Position.TE) {
    // Receiving TEs rank with WRs; blocking TEs rank lower.
    return p.archetype === 'TE_RECEIVING' ? 0.9 : p.archetype === 'TE_VERSATILE' ? 0.75 : 0.45;
  }
  if (p.position === Position.RB) {
    return p.archetype === 'RB_RECEIVING_BACK' ? 0.6 : 0.35;
  }
  return 0.2;
}

// ─── Defense ──────────────────────────────────────────────────────────

function attributeDefense(
  team: TeamState,
  ownStats: TeamGameStats,
  oppStats: TeamGameStats,
  lines: Map<string, PlayerGameStats>,
  league: LeagueState,
): void {
  const players = team.rosterIds
    .map((id) => league.players[id])
    .filter((p): p is Player => Boolean(p));

  // ── Tackles ──────────────────────────────────────────────────────
  // Roughly ~55 tackles per team per game in the NFL. LBs ~50-55%,
  // DBs ~28-32%, DL ~12-18% — tuned a bit so totals don't explode for
  // big-play games.
  const totalTackles = 55;
  const lbs = players.filter((p) => positionGroup(p.position) === PositionGroup.LB);
  const dbs = players.filter((p) => positionGroup(p.position) === PositionGroup.DB);
  const dls = players.filter((p) => positionGroup(p.position) === PositionGroup.DL);

  const lbTackles = Math.round(totalTackles * 0.55);
  const dbTackles = Math.round(totalTackles * 0.30);
  const dlTackles = Math.round(totalTackles * 0.15);

  distributeBySkill(lbs, lbTackles, (p, n) => (getOrInit(lines, p.id).tackles += n));
  distributeBySkill(dbs, dbTackles, (p, n) => (getOrInit(lines, p.id).tackles += n));
  distributeBySkill(dls, dlTackles, (p, n) => (getOrInit(lines, p.id).tackles += n));

  // ── Sacks ────────────────────────────────────────────────────────
  // `ownStats.sacks` = sacks this team's defense generated. EDGE rushers
  // get most; DTs split the rest. LBs occasionally blitz; DBs rarely.
  const totalSacks = ownStats.sacks;
  if (totalSacks > 0) {
    const edges = players.filter((p) => p.position === Position.EDGE);
    const interior = players.filter(
      (p) => p.position === Position.DT || p.position === Position.NT,
    );
    const edgeShare = Math.round(totalSacks * 0.6);
    const dtShare = Math.max(0, totalSacks - edgeShare);
    distributeBySkill(edges, edgeShare, (p, n) => (getOrInit(lines, p.id).sacks += n));
    distributeBySkill(interior, dtShare, (p, n) => (getOrInit(lines, p.id).sacks += n));
  }

  // ── Interceptions ────────────────────────────────────────────────
  // Defensive INTs ≈ 60% of opposing team's turnovers. DBs catch most;
  // a few go to LBs.
  const totalInts = Math.round(oppStats.turnovers * 0.6);
  if (totalInts > 0) {
    const dbInts = Math.round(totalInts * 0.8);
    const lbInts = Math.max(0, totalInts - dbInts);
    distributeBySkill(dbs, dbInts, (p, n) => (getOrInit(lines, p.id).interceptions += n));
    distributeBySkill(lbs, lbInts, (p, n) => (getOrInit(lines, p.id).interceptions += n));
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

function byTierThenSkill(a: Player, b: Player): number {
  const t = tierRank(b) - tierRank(a);
  if (t !== 0) return t;
  return keySkillAvg(b) - keySkillAvg(a);
}

function tierRank(p: Player): number {
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

function keySkillAvg(p: Player): number {
  const archetype = getArchetypeById(p.archetype);
  if (!archetype) return p.current.technicalSkill;
  const weights = archetype.skillWeights ?? {};
  const keys = Object.entries(weights)
    .filter(([, w]) => (w ?? 1) >= 1.2)
    .map(([k]) => k as keyof Player['current']);
  if (keys.length === 0) return p.current.technicalSkill;
  let sum = 0;
  for (const k of keys) sum += p.current[k];
  return sum / keys.length;
}

function positionGroup(position: Position): PositionGroup {
  switch (position) {
    case Position.QB:
      return PositionGroup.QB;
    case Position.RB:
    case Position.FB:
    case Position.WR:
    case Position.TE:
      return PositionGroup.SKILL;
    case Position.LT:
    case Position.LG:
    case Position.C:
    case Position.RG:
    case Position.RT:
      return PositionGroup.OL;
    case Position.EDGE:
    case Position.DT:
    case Position.NT:
      return PositionGroup.DL;
    case Position.ILB:
    case Position.OLB:
      return PositionGroup.LB;
    case Position.CB:
    case Position.S:
    case Position.NICKEL:
      return PositionGroup.DB;
    case Position.K:
    case Position.P:
    case Position.LS:
      return PositionGroup.ST;
  }
}

/**
 * Allocate `total` integer units across `players` by their `shares`.
 * Largest remainders carry the rounding so the per-player ints sum to
 * `total` exactly. Used for QB/RB/WR top-down distributions.
 */
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
  // Largest remainders get the rounding.
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

/**
 * Distribute `total` units across `players` proportional to each
 * player's key-skill average. Used for tackles, sacks, defensive ints
 * — broad position groups where ranking by skill alone is sufficient.
 */
function distributeBySkill(
  players: readonly Player[],
  total: number,
  apply: (p: Player, n: number) => void,
): void {
  if (players.length === 0 || total <= 0) return;
  const weights = players.map(keySkillAvg);
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) {
    apply(players[0]!, total);
    return;
  }
  const shares = weights.map((w) => w / sum);
  splitInt(players, shares, total, apply);
}
