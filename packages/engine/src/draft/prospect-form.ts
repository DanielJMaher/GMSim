/**
 * In-season prospect form (v0.81) — how a prospect's weekly game
 * production is moving their draft stock, weighted by who they did it
 * against.
 *
 * Per the weekly-scouting plan (Daniel 2026-05-27):
 *   - PER-GAME vs EXPECTATION. Each game's production is scored against
 *     what the prospect's true skill + position baseline predict. Beating
 *     that lifts the read; a dud drops it. A high-rated prospect is
 *     *expected* to produce, so the same line moves a no-name more — the
 *     "he's helping himself" signal.
 *   - OPPONENT QUALITY. A big game against a strong team counts for more
 *     than padding stats against a cupcake. Each game's delta is scaled
 *     by the opponent's `collegeTeamStrength` relative to an average team.
 *   - PER-GAME CAP, SEASON UNCAPPED. One game can't crown a prospect
 *     (each game's move is clamped to ±`FORM_PER_GAME_CAP`), but a full
 *     season of dominance accumulates without limit — so a small-school
 *     riser can climb all year. The funnel widens gradually, never in one
 *     jump (see CLAUDE.md draft-scouting conventions).
 *
 * Output is a signed "form bias" in skill points per prospect, summed
 * across every game played so far this season. The weekly media read
 * folds it in as a directional term, exactly like combine athleticism.
 *
 * Pure + deterministic — no PRNG. Players with no box-score production
 * (OL, specialists, anyone who hasn't played) get 0.
 */

import type { CollegePlayer } from '../types/college.js';
import type { CollegeGame, CollegePlayerGameStats } from '../types/college-season.js';
import type { GameId, PlayerId } from '../types/ids.js';
import { Position } from '../types/enums.js';

// ── Tuning knobs ────────────────────────────────────────────────────────
/** Max skill-point swing a single game can contribute (season total is uncapped). */
export const FORM_PER_GAME_CAP = 6;
/** Skill points per unit of (relative over-performance × opponent factor). */
const FORM_GAIN = 4;
/** Relative over-performance is clamped to this band before scaling. */
const OVER_MIN = -1;
const OVER_MAX = 2;
/** collegeTeamStrength midpoint — the "average" opponent (POWER baseline 78, G5 65). */
const AVG_OPPONENT_STRENGTH = 70;
/** Opponent factor band: a cupcake discounts to OPP_MIN, a juggernaut amplifies to OPP_MAX. */
const OPP_MIN = 0.5;
const OPP_MAX = 1.5;
/** Skill pivot the expectation scales around — a pivot-skill prospect expects the position baseline. */
const EXPECT_SKILL_PIVOT = 72;

/**
 * Per-game production a pivot-skill (`EXPECT_SKILL_PIVOT`) starter is
 * expected to post, in the same units as `productionScore`. Positions
 * with no box-score production (OL, specialists) are absent → their form
 * bias is always 0 (tape/combine moves them, not the stat sheet).
 */
const POSITION_BASELINE: Partial<Record<Position, number>> = {
  [Position.QB]: 18,
  [Position.RB]: 16,
  [Position.FB]: 6,
  [Position.WR]: 14,
  [Position.TE]: 10,
  [Position.EDGE]: 12,
  [Position.OLB]: 12,
  [Position.DT]: 9,
  [Position.NT]: 8,
  [Position.ILB]: 14,
  [Position.CB]: 9,
  [Position.NICKEL]: 9,
  [Position.S]: 11,
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Single-game production score for a prospect, in position-neutral
 * "fantasy-ish" points. Only the box-score fields the college game sim
 * actually produces are read (passing/rushing/receiving + tackles/sacks/
 * interceptions). Higher = a bigger statistical game.
 */
export function productionScore(line: CollegePlayerGameStats, position: Position): number {
  switch (position) {
    case Position.QB:
      return (
        line.passingYards * 0.04 +
        line.passingTds * 4 -
        line.interceptionsThrown * 2.5 +
        line.rushingYards * 0.08 +
        line.rushingTds * 4
      );
    case Position.RB:
      return (
        line.rushingYards * 0.1 +
        line.rushingTds * 6 +
        line.receivingYards * 0.08 +
        line.receivingTds * 6
      );
    case Position.FB:
      return line.rushingYards * 0.1 + line.rushingTds * 6 + line.receivingYards * 0.08;
    case Position.WR:
    case Position.TE:
      return line.receivingYards * 0.1 + line.receivingTds * 6 + line.receptions * 0.4;
    case Position.EDGE:
    case Position.OLB:
      return line.tackles * 0.8 + line.sacks * 6 + line.interceptions * 8;
    case Position.DT:
    case Position.NT:
      return line.tackles * 0.9 + line.sacks * 7;
    case Position.ILB:
      return line.tackles * 0.7 + line.sacks * 5 + line.interceptions * 8;
    case Position.CB:
    case Position.NICKEL:
      return line.tackles * 0.8 + line.interceptions * 12;
    case Position.S:
      return line.tackles * 0.8 + line.interceptions * 10;
    default:
      // OL + specialists: no counting stats → no box-score form signal.
      return 0;
  }
}

/** Mean of a prospect's true current skills (0..100) — the "overall". */
function overall(cp: CollegePlayer): number {
  const vals = Object.values(cp.current) as number[];
  if (vals.length === 0) return 0;
  let sum = 0;
  for (const v of vals) sum += v;
  return sum / vals.length;
}

export interface FormBiasInputs {
  /** Prospects to score (e.g. the in-season draft-eligible field). */
  eligible: readonly CollegePlayer[];
  /** This season's per-game stat lines so far (any order). */
  gameStats: readonly CollegePlayerGameStats[];
  /** Played games this season, keyed by id — to resolve each line's opponent. */
  gamesById: ReadonlyMap<GameId, CollegeGame>;
  /** Each school's `collegeTeamStrength` this season. */
  strengthBySchool: ReadonlyMap<string, number>;
}

/**
 * Season-to-date form bias (signed skill points) per eligible prospect.
 * Sums a per-game, opponent-weighted over/under-performance delta — each
 * game clamped to ±`FORM_PER_GAME_CAP`, the season total uncapped.
 */
export function computeProspectFormBias(inputs: FormBiasInputs): Map<PlayerId, number> {
  const { eligible, gameStats, gamesById, strengthBySchool } = inputs;

  const posById = new Map<PlayerId, Position>();
  const overallById = new Map<PlayerId, number>();
  for (const cp of eligible) {
    posById.set(cp.id, cp.collegePosition);
    overallById.set(cp.id, overall(cp));
  }

  const bias = new Map<PlayerId, number>();
  for (const cp of eligible) bias.set(cp.id, 0);

  for (const line of gameStats) {
    const position = posById.get(line.playerId);
    if (position === undefined) continue; // not in the scored field
    const baseline = POSITION_BASELINE[position];
    if (baseline === undefined) continue; // OL / specialist — no box-score signal

    const skill = overallById.get(line.playerId) ?? EXPECT_SKILL_PIVOT;
    const expected = baseline * (skill / EXPECT_SKILL_PIVOT);
    if (expected <= 0) continue;

    const prod = productionScore(line, position);
    // Relative over/under-performance vs what this prospect's skill predicts.
    const over = clamp(prod / expected - 1, OVER_MIN, OVER_MAX);

    // Who did they do it against? Strong opponent amplifies, cupcake discounts.
    const oppStrength = opponentStrength(line, gamesById, strengthBySchool);
    const oppFactor = clamp(oppStrength / AVG_OPPONENT_STRENGTH, OPP_MIN, OPP_MAX);

    const gameDelta = clamp(FORM_GAIN * over * oppFactor, -FORM_PER_GAME_CAP, FORM_PER_GAME_CAP);
    bias.set(line.playerId, (bias.get(line.playerId) ?? 0) + gameDelta);
  }

  return bias;
}

/**
 * Strength of the opponent a stat line was earned against. Falls back to
 * the average when the game or opponent strength can't be resolved (so an
 * unresolved game neither amplifies nor discounts).
 */
function opponentStrength(
  line: CollegePlayerGameStats,
  gamesById: ReadonlyMap<GameId, CollegeGame>,
  strengthBySchool: ReadonlyMap<string, number>,
): number {
  const game = gamesById.get(line.gameId);
  if (!game) return AVG_OPPONENT_STRENGTH;
  const opponentId =
    game.homeSchoolId === line.schoolId ? game.awaySchoolId : game.homeSchoolId;
  return strengthBySchool.get(opponentId) ?? AVG_OPPONENT_STRENGTH;
}
