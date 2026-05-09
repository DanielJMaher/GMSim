import type { LeagueState } from '../types/league.js';
import type { TeamState } from '../types/team.js';
import type { Player } from '../types/player.js';
import { schemeFitForPlayer } from '../scheme/fit.js';
import { getArchetypeById } from '../archetypes/index.js';
import { PositionGroup } from '../types/enums.js';

/**
 * Compute a single-number team strength used as the primary input to
 * game outcome rolls. Higher = stronger team.
 *
 * Composition (rough; tunable):
 *   - 70% top-roster talent (top N players' weighted averages)
 *   - 15% scheme fit aggregate (avg fit-multiplier of contributors)
 *   - 10% coaching contribution (HC game management + player development)
 *   - 5% chemistry contribution (Team Personality organizational stability)
 *
 * Output is a number roughly in [40, 100]. The game outcome calculator
 * uses *differences* between strengths, so absolute scaling matters
 * less than consistent ordinality across the league.
 */
export function teamStrength(team: TeamState, league: LeagueState): number {
  const players = team.rosterIds
    .map((id) => league.players[id])
    .filter((p): p is Player => Boolean(p));
  if (players.length === 0) return 50;

  const hc = league.coaches[team.headCoachId]!;
  const tp = league.teamPersonalities[team.identity.id]!;

  // ─── Talent contribution (top players, position-weighted) ─────────────
  const talent = topTalentScore(players);

  // ─── Scheme fit aggregate ─────────────────────────────────────────────
  let fitSum = 0;
  let fitCount = 0;
  for (const p of players) {
    const fit = schemeFitForPlayer(p, {
      offensiveScheme: hc.offensiveScheme,
      defensiveScheme: hc.defensiveScheme,
    });
    fitSum += fit;
    fitCount++;
  }
  const avgFit = fitCount > 0 ? fitSum / fitCount : 1.0;
  // Map avgFit (range ~0.85..1.4) to a 0-100 contribution centered at 60.
  const fitContribution = (avgFit - 1.0) * 60 + 60; // avg fit 1.0 → 60

  // ─── Coaching contribution ────────────────────────────────────────────
  const coachingContribution =
    (hc.spectrums.gameManagement + hc.spectrums.staffDevelopment) * 5; // 1-10 → 5-50, mid 30

  // ─── Chemistry contribution ───────────────────────────────────────────
  const chemistryContribution = tp.organizationalStability * 6; // 1-10 → 6-60, mid 36

  // Weighted combination
  return (
    talent * 0.7 + fitContribution * 0.15 + coachingContribution * 0.1 + chemistryContribution * 0.05
  );
}

/**
 * Top-talent score: weighted average of position-group leaders.
 *
 * For each position group, take the top N (by archetype-key-skill avg)
 * and average them, then weight groups by importance:
 *   QB  35%, OL 15%, DL 12%, DB 12%, SKILL 12%, LB 10%, ST 4%
 *
 * The QB heavy weight matches NFL reality — a great QB carries
 * everything else more than vice-versa.
 */
function topTalentScore(players: readonly Player[]): number {
  const groupTopN: Record<PositionGroup, number> = {
    QB: 1,
    SKILL: 8,
    OL: 5,
    DL: 4,
    LB: 3,
    DB: 5,
    ST: 1,
  };
  const groupWeight: Record<PositionGroup, number> = {
    QB: 0.35,
    SKILL: 0.12,
    OL: 0.15,
    DL: 0.12,
    LB: 0.1,
    DB: 0.12,
    ST: 0.04,
  };

  let total = 0;
  for (const group of Object.keys(groupTopN) as PositionGroup[]) {
    const groupPlayers = players
      .filter((p) => p.positionGroup === group)
      .map((p) => ({ p, score: keySkillAvg(p) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, groupTopN[group]);
    if (groupPlayers.length === 0) continue;
    const groupAvg =
      groupPlayers.reduce((s, x) => s + x.score, 0) / groupPlayers.length;
    total += groupAvg * groupWeight[group];
  }
  return total;
}

function keySkillAvg(p: Player): number {
  const archetype = getArchetypeById(p.archetype);
  const keys = archetype
    ? (Object.entries(archetype.skillWeights)
        .filter(([, w]) => (w ?? 1) >= 1.2)
        .map(([k]) => k as keyof typeof p.current))
    : (['technicalSkill', 'footballIq', 'speed'] as (keyof typeof p.current)[]);
  if (keys.length === 0) return 50;
  let s = 0;
  for (const k of keys) s += p.current[k];
  return s / keys.length;
}

/**
 * Per-unit strength breakdown used by the stat-rolling layer to scale
 * passing/rushing yards, sacks, and turnovers by relevant roster
 * skill. Each value is on the same 0-100 scale as `teamStrength`.
 *
 * The intent is "this team has a STAR QB and FRINGE OL" reads
 * differently from "this team has a FRINGE QB and STAR OL" in the
 * box score, even if their overall `teamStrength` happens to be equal.
 */
export interface UnitStrengths {
  passOffense: number;
  rushOffense: number;
  passDefense: number;
  rushDefense: number;
}

export function unitStrengths(team: TeamState, league: LeagueState): UnitStrengths {
  const players = team.rosterIds
    .map((id) => league.players[id])
    .filter((p): p is Player => Boolean(p));
  if (players.length === 0) {
    return { passOffense: 50, rushOffense: 50, passDefense: 50, rushDefense: 50 };
  }

  const byPosition = (positions: readonly string[], topN: number): number => {
    const scored = players
      .filter((p) => positions.includes(p.position))
      .map((p) => keySkillAvg(p))
      .sort((a, b) => b - a)
      .slice(0, topN);
    if (scored.length === 0) return 50;
    return scored.reduce((s, v) => s + v, 0) / scored.length;
  };

  const qb = byPosition(['QB'], 1);
  const wrTeRb = byPosition(['WR', 'TE', 'RB'], 4);
  const ol = byPosition(['LT', 'LG', 'C', 'RG', 'RT'], 5);
  const rbFb = byPosition(['RB', 'FB'], 2);
  const edgeDt = byPosition(['EDGE', 'DT', 'NT'], 4);
  const lb = byPosition(['ILB', 'OLB'], 3);
  const db = byPosition(['CB', 'S', 'NICKEL'], 4);

  // Pass offense: QB carries the most weight; receivers + OL pass-pro fill in.
  const passOffense = 0.55 * qb + 0.25 * wrTeRb + 0.20 * ol;
  // Rush offense: top RBs + OL run blocking, with a small QB scrambling share.
  const rushOffense = 0.50 * rbFb + 0.40 * ol + 0.10 * qb;
  // Pass defense: pass-rushers and DBs split the load.
  const passDefense = 0.50 * edgeDt + 0.50 * db;
  // Rush defense: front seven dominates.
  const rushDefense = 0.55 * edgeDt + 0.35 * lb + 0.10 * db;

  return { passOffense, rushOffense, passDefense, rushDefense };
}
