import type { LeagueState } from '../types/league.js';
import type { TeamState } from '../types/team.js';
import type { Player } from '../types/player.js';
import type { Position } from '../types/enums.js';
import { ROSTER_BLUEPRINT_53 } from '../players/roster-blueprint.js';
import { ageOfPlayer } from '../season/development.js';

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
 *   score      = max(-2, starterSlots - qse + ageBonus)
 *
 * `starterSlots` is a hand-tuned table of "how many starter-grade
 * players you ideally have at this position." It is *not* the
 * blueprint depth count — blueprint says "3 QBs on the 53," but
 * starter slots says "you need 1 starter-quality QB."
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

export interface PositionNeed {
  position: Position;
  /** Higher = bigger need. Negative values mean stacked at this slot. */
  score: number;
  /** Count of STAR + STARTER players at this position. */
  starterCount: number;
  /** Blueprint roster depth target at this position. */
  blueprintTarget: number;
  /** Age of the highest-tier player at this position, or null if none. */
  bestStarterAge: number | null;
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

    let qse = 0;
    let starterCount = 0;
    let bestTierPlayer: Player | null = null;
    let bestTierRank = -1;
    for (const p of players) {
      qse += TIER_WEIGHT[p.tier];
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

    const score = Math.max(SCORE_FLOOR, starterSlots - qse + ageBonus);
    needs.push({
      position,
      score: round2(score),
      starterCount,
      blueprintTarget: blueprintByPos.get(position) ?? 0,
      bestStarterAge,
    });
  }

  needs.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    // Deterministic tiebreak: by canonical position order.
    return canonicalPositionOrder(a.position) - canonicalPositionOrder(b.position);
  });
  return needs;
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
