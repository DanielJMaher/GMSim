import type { LeagueState } from '../types/league.js';
import type { TeamState } from '../types/team.js';
import type { Player } from '../types/player.js';
import type { ScheduledGame, TeamGameStats } from '../types/game.js';
import { type PlayerGameStats, emptyPlayerGameStats } from '../types/stats.js';
import { Position, PositionGroup } from '../types/enums.js';
import { getArchetypeById } from '../archetypes/index.js';
import { roleStickinessBonus } from '../players/depth-chart.js';

/**
 * Rank-weighted shares for spreading small per-game defensive turnover
 * events (interceptions) across a unit. The lead ball-hawk (rank 0) is
 * picked most often but the takeaways are shared down the depth chart, so
 * no single defender hoards a team's whole season of picks.
 */
const DEF_TURNOVER_SLOTS = [0.3, 0.22, 0.17, 0.12, 0.09, 0.06, 0.04];

/**
 * Rank-weighted shares for spreading sacks across the pass rush. Steeper
 * than the INT slots — an elite edge rusher genuinely dominates his team's
 * sack production (DPOY types take the bulk), so the league leader still
 * lands ~18-20, but the takedowns no longer all pile onto him every game
 * (which clustered too many players at 17-19).
 */
const SACK_PICK_SLOTS = [0.5, 0.28, 0.14, 0.08];

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
  // Bottom-up stat engine (v0.106+): the drive sim already attributed every
  // play to a specific player, so return the emergent lines verbatim instead
  // of distributing the team box score top-down.
  if (game.result.playerStats) return game.result.playerStats;
  const home = league.teams[game.homeTeamId];
  const away = league.teams[game.awayTeamId];
  if (!home || !away) return [];

  const lines = new Map<string, PlayerGameStats>();
  attributeOffense(home, game.result.homeStats, game.result.homeScore, game.id, lines, league);
  attributeOffense(away, game.result.awayStats, game.result.awayScore, game.id, lines, league);
  // Defense reads its own `sacks` (defensive credit) and the
  // opponent's `turnovers` (which the defense forced).
  attributeDefense(home, game.result.homeStats, game.result.awayStats, game.id, lines, league);
  attributeDefense(away, game.result.awayStats, game.result.homeStats, game.id, lines, league);

  // Drop empty stat lines (every-zero entries from rosters that didn't
  // contribute, e.g. a 3rd-string QB with 0 attempts).
  return [...lines.values()].filter(isNonEmpty);
}

function isNonEmpty(s: PlayerGameStats): boolean {
  // Any positive count triggers retention. Yardage fields are checked
  // explicitly so a player who picked up rounding-slack yards (e.g. 4
  // receiving yards on a single-yard target) doesn't get filtered out
  // and silently lose those yards from the league total.
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
  pointsScored: number,
  gameId: string,
  lines: Map<string, PlayerGameStats>,
  league: LeagueState,
): void {
  const players = team.rosterIds
    .map((id) => league.players[id])
    .filter((p): p is Player => Boolean(p));

  // Total offensive TDs derived from points, not yardage. NFL avg
  // 2014-2024: ~64% of total points come from offensive TDs (the rest
  // are FGs, defensive scores, safeties, special-teams TDs). 62% of
  // those offensive TDs are passing.
  const totalOffensiveTds = Math.max(0, Math.round((pointsScored * 0.64) / 7));
  const passShareOfTds = clamp01(
    teamStats.passingYards / Math.max(1, teamStats.passingYards + teamStats.rushingYards),
    0.45,
    0.78,
  );
  const totalPassTds = Math.round(totalOffensiveTds * (passShareOfTds * 1.05));
  const totalRushTds = Math.max(0, totalOffensiveTds - totalPassTds);

  // ── Passing ──────────────────────────────────────────────────────
  const qbs = players
    .filter((p) => p.position === Position.QB)
    .sort(byTierThenSkill);
  // Completion rate driven by the starting QB's accuracy (v0.98 sub-slice
  // C) — shared by the passing + receiving splits so receptions match.
  const compRate = qbs.length > 0 ? qbCompletionRate(qbs[0]!) : 0.64;
  if (qbs.length > 0) {
    // NFL yards-per-attempt 2014-2024 averages ~7.2. Use 7.6 here so
    // attempts land at ~30/game given ~230 pass yards (we slightly
    // under-shoot pass volume on purpose to leave headroom for the
    // top-end stat lines).
    const totalAttempts = Math.max(0, Math.round(teamStats.passingYards / 7.6));
    const totalCompletions = Math.round(totalAttempts * compRate);
    // INTs ≈ 50% of team turnovers (the rest are fumbles by
    // ball-carriers / strip-sacks). `fractionalRound` keeps the
    // mean at 0.5 × turnovers — `Math.round` would round 0.5 up to 1
    // and inflate INTs by ~50%.
    const totalInts = fractionalRound(
      teamStats.turnovers * 0.5,
      `${gameId}:int:${team.identity.abbreviation}`,
    );

    // QB1 ~93% of pass volume, QB2 ~7%.
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
    const totalCarries = Math.max(1, Math.round(teamStats.rushingYards / 4.3));
    const ladder: number[] =
      rbs.length === 1
        ? [1]
        : rbs.length === 2
          ? [0.7, 0.3]
          : [0.62, 0.25, 0.13, ...(Array(rbs.length - 3).fill(0) as number[])];
    const shares = skillAdjustedShares(rbs, ladder);
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
    .map((p) => ({
      player: p,
      weight: receivingWeight(p) * (keySkillAvg(p) + roleStickinessBonus(p)),
    }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 7) // top 7 get 95%+ of targets
    .map((x) => x.player);
  if (receivers.length > 0) {
    const totalAttempts = Math.max(0, Math.round(teamStats.passingYards / 7.6));
    const totalCompletions = Math.round(totalAttempts * compRate);
    const shares = skillAdjustedShares(receivers, recvSharesFor(receivers.length));
    splitInt(receivers, shares, totalAttempts, (p, n) => (getOrInit(lines, p.id).targets += n));
    splitInt(receivers, shares, totalCompletions, (p, n) => (getOrInit(lines, p.id).receptions += n));
    splitInt(receivers, shares, teamStats.passingYards, (p, n) => (getOrInit(lines, p.id).receivingYards += n));
    splitInt(receivers, shares, totalPassTds, (p, n) => (getOrInit(lines, p.id).receivingTds += n));
  }
}

function clamp01(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Deterministic mean-preserving fractional rounding. Rounds `value`
 * to an integer where the fractional part determines the probability
 * of rounding up, with the decision made by hashing `seed`. Same
 * inputs → same output; aggregate expected value matches `value`.
 *
 * Used in stat derivation to avoid `Math.round`'s round-half-up bias
 * when distributing fractional team-level numbers (e.g., INTs ≈
 * turnovers × 0.5) into integer per-player game lines.
 */
function fractionalRound(value: number, seed: string): number {
  const floor = Math.floor(value);
  const frac = value - floor;
  if (frac === 0) return floor;
  const h = fnv1aHash(seed);
  // h is in [0, 2^32). Scale to [0, 1).
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

/** Deterministic hash → uniform [0, 1). */
function hashUnit(s: string): number {
  return fnv1aHash(s) / 0x100000000;
}

/**
 * Deterministically pick one player from a skill-ranked list using
 * absolute `weights` by rank — a hash-seeded weighted draw. Spreads small
 * per-game events across a unit over a season instead of always landing on
 * the top-ranked player (the largest-remainder failure mode).
 */
function pickByRankWeight<T>(
  ranked: readonly T[],
  weights: readonly number[],
  seed: string,
): T | undefined {
  if (ranked.length === 0) return undefined;
  const n = Math.min(ranked.length, weights.length);
  let total = 0;
  for (let i = 0; i < n; i++) total += weights[i]!;
  if (total <= 0) return ranked[0];
  let r = hashUnit(seed) * total;
  for (let i = 0; i < n; i++) {
    r -= weights[i]!;
    if (r <= 0) return ranked[i];
  }
  return ranked[n - 1];
}

function recvSharesFor(n: number): number[] {
  // Pareto-ish target distribution.
  const base = [0.28, 0.20, 0.16, 0.13, 0.10, 0.08, 0.05];
  const out = base.slice(0, n);
  const total = out.reduce((s, v) => s + v, 0);
  // Normalize to 1.0 in case we sliced fewer than 7.
  return out.map((v) => v / total);
}

/**
 * Continuous production coupling (Living Careers S4). The fixed rank-share
 * ladders made production ORDINAL: a declining WR1 kept the full WR1 share
 * until his rank flipped, so per-player production never showed gradual
 * decline (the Actuary's pooled decline regions read ~0%/yr vs real ~-8).
 * Blend each rank's ladder share with the player's actual rating relative
 * to the best rating in the group — equal ratings reproduce the ladder
 * exactly; a fading vet's share shrinks every year even while he holds the
 * job, and a rising backup eats share before he takes it. Renormalized, so
 * team totals are untouched.
 */
export function skillAdjustedShares(ranked: readonly Player[], ladder: readonly number[]): number[] {
  const n = Math.min(ranked.length, ladder.length);
  let top = 1;
  for (let i = 0; i < n; i++) top = Math.max(top, keySkillAvg(ranked[i]!));
  const raw: number[] = [];
  let rawSum = 0;
  let ladderSum = 0;
  for (let i = 0; i < ladder.length; i++) {
    const share = ladder[i]!;
    ladderSum += share;
    const p = ranked[i];
    const adjusted = p && share > 0 ? share * Math.pow(keySkillAvg(p) / top, 2.0) : share;
    raw.push(adjusted);
    rawSum += adjusted;
  }
  if (rawSum <= 0) return [...ladder];
  return raw.map((v) => (v * ladderSum) / rawSum);
}

/**
 * Per-QB completion rate (v0.98, overhaul Stage 5 sub-slice C). NFL avg is
 * ~64%; an accurate, decisive QB completes a higher share of the same
 * volume (Brady/Brees territory) while an erratic one dips. Driven by the
 * granular accuracy skills + decisions, centered on the league-typical QB1
 * so the league-wide completion rate stays ~64%.
 */
const QB_ACC_REF = 74; // ~league-average QB1 accuracy composite
export function qbCompletionRate(qb: Player): number {
  const c = qb.current;
  const acc = (c.accuracyShort + c.accuracyMedium + c.decisionMaking + c.footballIq) / 4;
  const rate = 0.64 + (acc - QB_ACC_REF) * 0.0045;
  return Math.max(0.54, Math.min(0.72, rate));
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
  gameId: string,
  lines: Map<string, PlayerGameStats>,
  league: LeagueState,
): void {
  const players = team.rosterIds
    .map((id) => league.players[id])
    .filter((p): p is Player => Boolean(p));

  // ── Tackles ──────────────────────────────────────────────────────
  // ~62 solo+assist tackles per team per game in the NFL. Distribution:
  // LBs ~50-55%, DBs ~28-32%, DL ~13-18%. Slightly inflated for runs
  // (more LB/DL involvement) and slightly compressed for shootouts.
  const totalTackles = 62;
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
  // Sacks spread across the rush by a rank-weighted draw (like INTs) so a
  // single edge doesn't vacuum every game's sack via largest-remainder.
  // ~60% go to an edge, ~40% to the interior.
  const totalSacks = ownStats.sacks;
  if (totalSacks > 0) {
    const edgesRanked = players.filter((p) => p.position === Position.EDGE).sort(byTierThenSkill);
    const interiorRanked = players
      .filter((p) => p.position === Position.DT || p.position === Position.NT)
      .sort(byTierThenSkill);
    const edgeSlots = coupledSlots(edgesRanked, SACK_PICK_SLOTS);
    const interiorSlots = coupledSlots(interiorRanked, SACK_PICK_SLOTS);
    for (let i = 0; i < totalSacks; i++) {
      const seed = `${gameId}:sack:${team.identity.abbreviation}:${i}`;
      const preferEdge = hashUnit(`${seed}:grp`) < 0.6;
      const primary = preferEdge ? edgesRanked : interiorRanked;
      const pool = primary.length > 0 ? primary : preferEdge ? interiorRanked : edgesRanked;
      const slots = pool === edgesRanked ? edgeSlots : interiorSlots;
      const pick = pickByRankWeight(pool, slots, seed);
      if (pick) getOrInit(lines, pick.id).sacks += 1;
    }
  }

  // ── Interceptions ────────────────────────────────────────────────
  // Defensive INTs ≈ 50% of opposing team's turnovers (the rest are
  // forced fumbles). Matches the offensive 0.5 split.
  //
  // Picks are SPREAD across the secondary by a rank-weighted draw rather
  // than handed to the single top-skill DB. `distributeBySkill` used
  // largest-remainder rounding, so a per-game count of 0-1 always landed
  // on the highest-skill defender — inflating one ball-hawk to ~15 INTs a
  // season (real NFL leader ~7, most teams' leader ~4-6). A ball-hawk
  // still leads (rank-0 weight is highest) but the picks are shared.
  const totalInts = fractionalRound(
    oppStats.turnovers * 0.5,
    `${gameId}:def-int:${team.identity.abbreviation}`,
  );
  if (totalInts > 0) {
    const dbsRanked = [...dbs].sort(byTierThenSkill);
    const lbsRanked = [...lbs].sort(byTierThenSkill);
    const dbSlots = coupledSlots(dbsRanked, DEF_TURNOVER_SLOTS);
    const lbSlots = coupledSlots(lbsRanked, DEF_TURNOVER_SLOTS);
    for (let i = 0; i < totalInts; i++) {
      const seed = `${gameId}:dint:${team.identity.abbreviation}:${i}`;
      // ~80% of picks go to a DB, ~20% to a LB (fall back if a group is empty).
      const preferDb = hashUnit(`${seed}:grp`) < 0.8;
      const primary = preferDb ? dbsRanked : lbsRanked;
      const pool = primary.length > 0 ? primary : preferDb ? lbsRanked : dbsRanked;
      const pick = pickByRankWeight(pool, pool === dbsRanked ? dbSlots : lbSlots, seed);
      if (pick) getOrInit(lines, pick.id).interceptions += 1;
    }
  }
}

/**
 * Rating-coupled slot weights for the rank-weighted defensive draws (S4):
 * the fixed slot ladders made sack/INT shares ordinal — a fading rusher
 * kept his rank-0 draw odds until passed. Scaling each slot by the
 * occupant's rating relative to the group's best makes event odds track
 * the rating continuously, same as the offensive share coupling.
 */
function coupledSlots(ranked: readonly Player[], slots: readonly number[]): number[] {
  const n = Math.min(ranked.length, slots.length);
  let top = 1;
  for (let i = 0; i < n; i++) top = Math.max(top, keySkillAvg(ranked[i]!));
  return slots.map((w, i) =>
    ranked[i] ? w * Math.pow(keySkillAvg(ranked[i]!) / top, 2.0) : w,
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

function byTierThenSkill(a: Player, b: Player): number {
  const t = tierRank(b) - tierRank(a);
  if (t !== 0) return t;
  // Role stickiness (S4): incumbent vets hold rank until clearly passed.
  return (
    keySkillAvg(b) + roleStickinessBonus(b) - (keySkillAvg(a) + roleStickinessBonus(a))
  );
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
