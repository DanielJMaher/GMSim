import type { LeagueState } from '../types/league.js';
import type { TeamState } from '../types/team.js';
import type { Player } from '../types/player.js';
import type { Position } from '../types/enums.js';
import { ROSTER_BLUEPRINT_53 } from '../players/roster-blueprint.js';
import { ageOfPlayer } from '../season/development.js';
import { keySkillAverage } from '../archetypes/key-skill.js';
import { POSITION_DRAFT_VALUE } from './position-value.js';

/**
 * Team Needs (v0.55).
 *
 * Surfaces the "top N positions this team needs to improve" — the
 * NFL-fan-style need list that draft analysts publish ahead of every
 * draft. Used by the inspector to annotate team draft boards and the
 * draft-replay pick view, and intended as input to future NPC AI
 * draft/FA targeting (no engine consumer yet).
 *
 * Pure function over LeagueState — no PRNG, no migration shape.
 *
 * ## Model
 *
 * For each `Position`, compute a need score from the team's current
 * roster. Top-of-need positions surface when (a) the team is thin on
 * quality at the slot, (b) the best player is aging, or (c) the
 * blueprint depth target is unmet.
 *
 *   qse        = stars * 1.2 + starters * 0.85
 *              + backups * 0.25 + fringe * 0.05
 *   ageBonus   = bestStarterAge ≥ 30 ? clamp((bestStarterAge - 29) * 0.3, 0, 1.5)
 *              : 0
 *   rawNeed    = starterSlots - qse + ageBonus
 *   neediness  = max(0, rawNeed)                          // 0 if stacked
 *   score      = neediness > 0 ? neediness * positionValue
 *                              : max(-2, rawNeed)         // stacked sort below
 *
 * `starterSlots` is a hand-tuned table of "how many starter-grade
 * players you ideally have at this position." It is *not* the
 * blueprint depth count — blueprint says "3 QBs on the 53," but
 * starter slots says "you need 1 starter-quality QB."
 *
 * ## Positional value (v0.91)
 *
 * A bare slot shortfall isn't worth the same everywhere — an open QB
 * hole dwarfs an open safety hole in draft terms (see
 * `position-value.ts` for the open-market + rookie-scale reasoning).
 * `neediness` is therefore multiplied by `POSITION_DRAFT_VALUE`, so a
 * genuine premium-position need out-ranks an equal-magnitude need at a
 * replaceable spot. Stacked positions (rawNeed ≤ 0) keep their raw
 * (negative) score so they still sort to the bottom.
 *
 * ## QB rule (v0.92 — pedigree-aware)
 *
 * A team with no starter-quality-or-better QB has a standing premium need
 * at the position, floored at `QB_NO_ANSWER_FLOOR` so it can't be buried
 * under a stack of skill-position shortfalls — *unless* it has a recent
 * first-round QB it's developing (the franchise plan). That carve-out is
 * driven by **draft pedigree** (`Player.draftRound` + `experienceYears`),
 * not age or tier: a team building around last year's top-5 pick does not
 * "need" a QB even while he's raw, but a team starting a journeyman with a
 * 6th-round kid behind him still does. The franchise QB also counts as a
 * provisional starter in `qse`, so QB drops off the need list entirely
 * rather than merely losing the floor. This is what stops NPC teams from
 * drafting a QB every single year. See `isFranchiseDevQb`.
 *
 * ## Output ordering
 *
 * Returned list is sorted by score desc. UI takes top N. A team
 * with no thin spots can produce all-negative scores; callers should
 * still display the top positions (the least-stacked spots).
 */

/**
 * Approximate count of starter-quality players each position needs.
 * Reflects modern NFL usage (3-WR base, nickel-heavy DBs, EDGE-pair
 * priority). Specialists (FB, K, P, LS) score low so they rarely
 * crack the top-5 unless a team has literally nobody at the spot.
 */
const STARTER_SLOTS: Readonly<Record<Position, number>> = {
  QB: 1,
  RB: 1.2,
  FB: 0.3,
  WR: 3,
  TE: 1.5,
  LT: 1,
  LG: 1,
  C: 1,
  RG: 1,
  RT: 1,
  EDGE: 2,
  DT: 1.5,
  NT: 0.5,
  ILB: 1.5,
  OLB: 1.5,
  CB: 2.5,
  S: 2,
  NICKEL: 1,
  K: 1,
  P: 1,
  LS: 1,
};

/** Tier weights — quality-equivalents contributed by each tier. */
const TIER_WEIGHT = {
  STAR: 1.2,
  STARTER: 0.85,
  BACKUP: 0.25,
  FRINGE: 0.05,
} as const;

const AGE_BONUS_THRESHOLD = 29;
const AGE_BONUS_PER_YEAR = 0.3;
const AGE_BONUS_CAP = 1.5;
const SCORE_FLOOR = -2;

/** Minimum QB neediness when a team has no starter-quality-or-better QB
 * and no recent first-round QB. Floors QB near the top of the board. */
const QB_NO_ANSWER_FLOOR = 1.2;
/** A first-round QB this many seasons in or fewer counts as the franchise
 * plan (the rookie-deal development window). After it, an unproven
 * first-rounder is a bust and QB re-opens as a need. */
const FRANCHISE_DEV_QB_MAX_EXPERIENCE = 4;

/** True if this QB was a first-round pick still inside his rookie window —
 * the developmental franchise QB a team is committed to. Pedigree (draft
 * round), not tier: a recent top pick is the plan even before he's proven;
 * a late-round young QB is not. */
function isFranchiseDevQb(p: Player): boolean {
  return (
    p.position === 'QB' &&
    p.draftRound === 1 &&
    p.experienceYears <= FRANCHISE_DEV_QB_MAX_EXPERIENCE
  );
}

/**
 * True when a team has NO answer at quarterback (2026-06-03) — no starter-
 * quality-or-better QB AND no recent first-round developmental QB. This is the
 * same condition that floors QB near the top of `computeTeamNeeds`; the draft
 * uses it to let a QB-desperate team REACH for a passer (take its best available
 * QB even when a non-QB outranks him on the board). A backup journeyman doesn't
 * satisfy the need; last year's top-5 pick does.
 */
export function hasDesperateQbNeed(
  team: TeamState,
  players: Readonly<Record<string, Player>>,
): boolean {
  let hasStarterQb = false;
  let hasFranchiseDev = false;
  for (const pid of team.rosterIds) {
    const p = players[pid];
    if (!p || p.position !== 'QB') continue;
    if (p.tier === 'STAR' || p.tier === 'STARTER') hasStarterQb = true;
    if (isFranchiseDevQb(p)) hasFranchiseDev = true;
  }
  return !hasStarterQb && !hasFranchiseDev;
}

/**
 * QB upgrade DESIRE at the top of the draft (v0.150) — graded, not binary.
 *
 * The binary `hasDesperateQbNeed` undercounts real top-of-draft QB demand:
 * the team picking #1 takes the franchise QB even when it HAS a mediocre
 * starter (Carolina over the Darnold class, Chicago over Fields). The
 * binary was good enough at v0.143 only because broken FA retention made
 * ~45% of primary passers walk every offseason — once the re-sign window
 * (v0.148) fixed the ecology, almost every team read "settled" and the
 * #1-overall QB share collapsed to 7% (real: 75%).
 *
 *   1.0  — no starter-quality QB and no franchise-dev R1 QB (desperate)
 *   0.0  — a franchise-dev R1 QB in his rookie window, or a top-quartile
 *          QB room (the true Baltimore case — you don't draft over him)
 *   else — scaled by where the team's best QB ranks among all 32 teams'
 *          best QBs (`keySkillAverage`, the same quality signal the depth
 *          chart and sim use): bottom-quartile rooms (~the teams actually
 *          picking high, since QB quality drives losing) still hunt the
 *          franchise QB at premier slots.
 */
export function qbUpgradeDesire(team: TeamState, league: LeagueState): number {
  if (hasDesperateQbNeed(team, league.players)) return 1.0;

  const bestQbScore = (t: TeamState): { score: number; franchiseDev: boolean } => {
    let score = 0;
    let franchiseDev = false;
    for (const pid of t.rosterIds) {
      const p = league.players[pid];
      if (!p || p.position !== 'QB') continue;
      if (isFranchiseDevQb(p)) franchiseDev = true;
      const s = keySkillAverage(p.current, p.archetype);
      if (s > score) score = s;
    }
    return { score, franchiseDev };
  };

  const mine = bestQbScore(team);
  if (mine.franchiseDev) return 0; // committed to the kid — settled

  let better = 0;
  let others = 0;
  for (const other of Object.values(league.teams)) {
    if (other.identity.id === team.identity.id) continue;
    others++;
    if (bestQbScore(other).score > mine.score) better++;
  }
  const worseFraction = others > 0 ? better / others : 0; // 1 = league-worst QB room
  // Top quartile → 0 (you don't draft over him); bottom HALF → full hunt
  // (a median-or-worse starter never stops a team from taking the consensus
  // franchise QB at the top — Pittsburgh/Pickett wouldn't pass on Caleb);
  // second quartile graded. First cut at (−0.25)/0.5 ×0.9 recovered the
  // #1-overall QB share only to 22% (real 75%) — the slot premium needs
  // near-full desire to outrank EDGE, and the teams actually picking high
  // are almost all bottom-half QB rooms.
  return Math.max(0, Math.min(1, (worseFraction - 0.25) / 0.25));
}

export interface PositionNeed {
  position: Position;
  /** Higher = bigger need. Negative values mean stacked at this slot.
   * Positive scores are `neediness × positionValue` (v0.91). */
  score: number;
  /** Count of STAR + STARTER players at this position. */
  starterCount: number;
  /** Blueprint roster depth target at this position. */
  blueprintTarget: number;
  /** Age of the highest-tier player at this position, or null if none. */
  bestStarterAge: number | null;
  /** Positional draft-value multiplier applied to this need (v0.91). */
  positionValue: number;
}

/**
 * Compute the team's need score per canonical Position, sorted by
 * score descending. UI takes the top N for display.
 *
 * `seasonNumber` defaults to `league.seasonNumber` — pass an
 * override only when computing needs at a historical point.
 */
export function computeTeamNeeds(
  team: TeamState,
  league: LeagueState,
  seasonNumber: number = league.seasonNumber,
): PositionNeed[] {
  const blueprintByPos = new Map<Position, number>();
  for (const slot of ROSTER_BLUEPRINT_53) blueprintByPos.set(slot.position, slot.count);

  // Group roster players by canonical position.
  const byPosition = new Map<Position, Player[]>();
  for (const pid of team.rosterIds) {
    const p = league.players[pid];
    if (!p) continue;
    const arr = byPosition.get(p.position);
    if (arr) arr.push(p);
    else byPosition.set(p.position, [p]);
  }

  const needs: PositionNeed[] = [];
  for (const position of Object.keys(STARTER_SLOTS) as Position[]) {
    const players = byPosition.get(position) ?? [];
    const starterSlots = STARTER_SLOTS[position];

    // A QB drafted in the first round and still inside his rookie window
    // is the franchise plan — the team is committed to developing him, so
    // he counts as a provisional starter for need purposes (a 6th-rounder
    // does not). See the QB rule below.
    const hasFranchiseDevQb =
      position === 'QB' && players.some((p) => isFranchiseDevQb(p));

    let qse = 0;
    let starterCount = 0;
    let bestTierPlayer: Player | null = null;
    let bestTierRank = -1;
    for (const p of players) {
      let weight = TIER_WEIGHT[p.tier];
      if (position === 'QB' && isFranchiseDevQb(p) && weight < TIER_WEIGHT.STARTER) {
        weight = TIER_WEIGHT.STARTER; // provisional-starter credit
      }
      qse += weight;
      if (p.tier === 'STAR' || p.tier === 'STARTER') starterCount++;
      const rank = tierRank(p.tier);
      if (rank > bestTierRank) {
        bestTierRank = rank;
        bestTierPlayer = p;
      }
    }

    const bestStarterAge =
      bestTierPlayer && (bestTierPlayer.tier === 'STAR' || bestTierPlayer.tier === 'STARTER')
        ? ageOfPlayer(bestTierPlayer, seasonNumber)
        : null;
    const ageBonus =
      bestStarterAge !== null && bestStarterAge > AGE_BONUS_THRESHOLD
        ? Math.min(
            AGE_BONUS_CAP,
            (bestStarterAge - AGE_BONUS_THRESHOLD) * AGE_BONUS_PER_YEAR,
          )
        : 0;

    const rawNeed = starterSlots - qse + ageBonus;
    let neediness = Math.max(0, rawNeed);

    // QB rule: no starter-quality-or-better QB AND no recent first-round
    // QB being developed → a standing premium need, floored near the top
    // of the board. A backup-quality QB doesn't satisfy it UNLESS he was a
    // first-round pick still inside his rookie window (the franchise plan).
    // So a team starting a journeyman with a 6th-round kid behind him still
    // needs a QB; a team developing last year's top-5 pick does not.
    if (position === 'QB' && starterCount === 0 && !hasFranchiseDevQb) {
      neediness = Math.max(neediness, QB_NO_ANSWER_FLOOR);
    }

    const positionValue = POSITION_DRAFT_VALUE[position];
    // Positive needs scale by positional value; stacked positions keep
    // their raw (negative) score so they sort to the bottom.
    const score = neediness > 0 ? neediness * positionValue : Math.max(SCORE_FLOOR, rawNeed);
    needs.push({
      position,
      score: round2(score),
      starterCount,
      blueprintTarget: blueprintByPos.get(position) ?? 0,
      bestStarterAge,
      positionValue,
    });
  }

  needs.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    // Deterministic tiebreak: by canonical position order.
    return canonicalPositionOrder(a.position) - canonicalPositionOrder(b.position);
  });
  return needs;
}

/**
 * Per-position NEED PRESSURE (2026-06-03) — a lightweight, league-free version
 * of the `computeTeamNeeds` shortfall, keyed by canonical `Position` rather than
 * sorted/scored. `pressure[pos] = max(0, starterSlots - qualityEquivalents)`:
 * 0 means the team is stacked at the spot, higher means a bigger hole. Used by
 * the draft board to decide whether to convert a prospect to an adjacent spot
 * (a team with high LT pressure plays a drafted RT at LT). Deliberately omits
 * the age bonus + positional-value scaling that `computeTeamNeeds` applies —
 * the board weighs positional value separately, and conversion shouldn't hinge
 * on a starter being a year from decline.
 */
export function positionNeedPressure(
  team: TeamState,
  players: Readonly<Record<string, Player>>,
): Record<Position, number> {
  const qse = {} as Record<Position, number>;
  for (const pos of Object.keys(STARTER_SLOTS) as Position[]) qse[pos] = 0;
  for (const pid of team.rosterIds) {
    const p = players[pid];
    if (!p) continue;
    qse[p.position] += TIER_WEIGHT[p.tier];
  }
  const pressure = {} as Record<Position, number>;
  for (const pos of Object.keys(STARTER_SLOTS) as Position[]) {
    pressure[pos] = Math.max(0, STARTER_SLOTS[pos] - qse[pos]);
  }
  return pressure;
}

function tierRank(tier: Player['tier']): number {
  switch (tier) {
    case 'STAR':
      return 3;
    case 'STARTER':
      return 2;
    case 'BACKUP':
      return 1;
    case 'FRINGE':
      return 0;
  }
}

const CANONICAL_ORDER: readonly Position[] = [
  'QB', 'RB', 'FB', 'WR', 'TE',
  'LT', 'LG', 'C', 'RG', 'RT',
  'EDGE', 'DT', 'NT',
  'ILB', 'OLB',
  'CB', 'S', 'NICKEL',
  'K', 'P', 'LS',
] as const;

function canonicalPositionOrder(p: Position): number {
  const idx = CANONICAL_ORDER.indexOf(p);
  return idx === -1 ? 99 : idx;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
