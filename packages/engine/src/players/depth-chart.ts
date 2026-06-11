/**
 * Depth chart — the canonical "who starts / who's next" ordering per team
 * (Daniel-approved 2026-05-29; the "68-rated backup STARTING" confusion was
 * the trigger: the engine had no explicit starter concept, just ad-hoc
 * orderings scattered through the game sim).
 *
 * Slice 1 is a PURE, DERIVED model: the chart is computed from the roster on
 * demand, not stored on `LeagueState` — no migration, no save-format change,
 * trivially deterministic. Ranking within a position uses the same
 * archetype-key-skill composite the game sim's personnel ranking uses
 * (`keySkillAverage`), so the chart and the sim agree about who the best
 * player at a spot is.
 *
 * The base lineup is 11-personnel offense + nickel defense (the modern NFL
 * default): scheme-aware variants (a 3-4 swapping an EDGE for an OLB, heavy
 * packages) layer on later as transforms of `BASE_STARTER_COUNTS`.
 *
 * Consumer wiring is deliberately NOT in this slice (each is its own
 * calibration-gated follow-up): team needs (starter hole vs depth hole),
 * mood (playing-time expectation vs actual depth slot), game-sim personnel,
 * and the outcome.ts QB1 selection should all converge on this ordering.
 */

import type { LeagueState } from '../types/league.js';
import type { Player } from '../types/player.js';
import type { PlayerId, TeamId } from '../types/ids.js';
import { Position } from '../types/enums.js';
import { keySkillAverage } from '../archetypes/key-skill.js';

/** Starters per position in the base lineup (11 offense + 11 nickel defense + 3 ST). */
export const BASE_STARTER_COUNTS: Readonly<Record<Position, number>> = {
  // Offense — 11 personnel (1 RB / 1 TE / 3 WR).
  QB: 1,
  RB: 1,
  FB: 0,
  WR: 3,
  TE: 1,
  LT: 1,
  LG: 1,
  C: 1,
  RG: 1,
  RT: 1,
  // Defense — nickel base (4 front / 2 LB / 5 DB).
  EDGE: 2,
  DT: 1,
  NT: 1,
  ILB: 1,
  OLB: 1,
  CB: 2,
  S: 2,
  NICKEL: 1,
  // Special teams.
  K: 1,
  P: 1,
  LS: 1,
};

export interface DepthChartSlot {
  position: Position;
  /** Rostered players at this position, best first. */
  playerIds: readonly PlayerId[];
  /** How many start in the base lineup (may exceed available bodies). */
  starterCount: number;
}

export interface TeamDepthChart {
  teamId: TeamId;
  slots: Readonly<Record<Position, DepthChartSlot>>;
  /** The projected starting lineup: top-`starterCount` ids across positions. */
  starterIds: readonly PlayerId[];
}

/**
 * The depth composite — how the chart ranks players within a position.
 * Archetype-weighted key skills (the sim's own signal). Exported so future
 * consumers (needs, mood, personnel) rank identically.
 */
export function depthScore(player: Player): number {
  return keySkillAverage(player.current, player.archetype);
}

/**
 * Role stickiness (Living Careers S4): veterans hold their jobs until a
 * challenger is CLEARLY better, not marginally better — real teams play the
 * incumbent through a down year. Up to +4 composite points of incumbency
 * (full at ~5 accrued seasons). Consumed by the depth-chart ordering and the
 * game-sim stat attribution so a declining vet stays in the lineup an extra
 * year or two and his decline is VISIBLE in production instead of him
 * silently vanishing from the qualifying sample (the Actuary's
 * production-coupling residual).
 */
export function roleStickinessBonus(player: Player): number {
  return Math.min(4, player.experienceYears * 0.8);
}

/**
 * Compute one team's depth chart from its active roster. Pure and
 * deterministic: composite descending, player id ascending on ties.
 */
export function computeTeamDepthChart(league: LeagueState, teamId: TeamId): TeamDepthChart | null {
  const team = league.teams[teamId];
  if (!team) return null;

  const byPosition = new Map<Position, { id: PlayerId; score: number }[]>();
  for (const pos of Object.values(Position)) byPosition.set(pos, []);

  for (const playerId of team.rosterIds) {
    const player = league.players[playerId];
    if (!player) continue;
    byPosition
      .get(player.position)
      ?.push({ id: playerId, score: depthScore(player) + roleStickinessBonus(player) });
  }

  const slots = {} as Record<Position, DepthChartSlot>;
  const starterIds: PlayerId[] = [];
  for (const pos of Object.values(Position)) {
    const entries = byPosition.get(pos)!;
    entries.sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));
    const starterCount = BASE_STARTER_COUNTS[pos];
    slots[pos] = {
      position: pos,
      playerIds: entries.map((e) => e.id),
      starterCount,
    };
    for (let i = 0; i < Math.min(starterCount, entries.length); i++) {
      starterIds.push(entries[i]!.id);
    }
  }

  return { teamId, slots, starterIds };
}

/** All 32 charts, keyed by team id. */
export function computeLeagueDepthCharts(league: LeagueState): Record<string, TeamDepthChart> {
  const out: Record<string, TeamDepthChart> = {};
  for (const teamId of Object.keys(league.teams)) {
    const chart = computeTeamDepthChart(league, teamId as TeamId);
    if (chart) out[teamId] = chart;
  }
  return out;
}

/** Is this player in the projected base starting lineup? */
export function isProjectedStarter(chart: TeamDepthChart, playerId: PlayerId): boolean {
  return chart.starterIds.includes(playerId);
}

/**
 * A player's depth slot at his position: 1 = first-string, 2 = next, …
 * Returns null if he isn't on this chart.
 */
export function depthRank(chart: TeamDepthChart, playerId: PlayerId): number | null {
  for (const slot of Object.values(chart.slots)) {
    const idx = slot.playerIds.indexOf(playerId);
    if (idx >= 0) return idx + 1;
  }
  return null;
}
