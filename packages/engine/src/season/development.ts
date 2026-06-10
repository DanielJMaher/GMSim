import type { Prng } from '../prng/index.js';
import type { Player, PlayerSkills, PlayerDevelopmentArchetype, TalentGrade } from '../types/player.js';
import { gradeToTier } from '../players/skills.js';
import type { LeagueState } from '../types/league.js';
import type { PlayerSeasonStats } from '../types/stats.js';
import type { PlayerId } from '../types/ids.js';
import { PositionGroup } from '../types/enums.js';
import { positionGroupFor } from '../players/position-group.js';
import { ALL_SKILL_KEYS, categoryFor } from '../players/skill-keys.js';
import {
  curveForPosition,
  declineMultiplierFor,
  declineFor,
  cliffHazard,
  type PositionAgingCurve,
} from '../players/aging-curves.js';

/**
 * Apply one year of development to a player (Living Careers S2).
 *
 * Growth closes the gap to the hidden ceiling, tapering out around the
 * position's real peak age. Decline is position- and category-specific
 * (physical first, technique post-peak, mental late) per
 * `players/aging-curves.ts` — parameters derived from THE ACTUARY's real-NFL
 * baselines and calibrated against its sim-side probe (`run actuary sim`).
 * Past the position's cliff age, an annual hazard roll can produce a cliff
 * season (a large permanent hit) — some RBs collapse at 28, some never seem
 * to. Each player carries a hidden decline-rate multiplier so identical-age
 * peers age differently.
 *
 * Source: Player Development System Design Document + the Living Careers
 * plan (2026-06-10). Coaching-focus allocation remains deferred; every
 * player receives baseline coaching attention.
 */
export function advancePlayerDevelopment(
  prng: Prng,
  player: Player,
  league: LeagueState,
  performanceMultiplier = 1.0,
): Player {
  const ageNext = ageOfPlayer(player, league.seasonNumber + 1);
  const curve = curveForPosition(player.position);
  const declineMult = declineMultiplierFor(league, player);

  const newCurrent = applyDevelopment(
    prng,
    player,
    ageNext,
    curve,
    declineMult,
    performanceMultiplier,
  );
  // Tier shifts as skills change. We don't store an "original" tier;
  // re-derive from new current ratings using the same skill-key logic
  // contracts use. The fine grade is the source of truth; tier derives from it.
  const newGrade = deriveGradeFromSkills(newCurrent, player);

  return {
    ...player,
    experienceYears: player.experienceYears + 1,
    current: newCurrent,
    talentGrade: newGrade,
    tier: gradeToTier(newGrade),
  };
}

/**
 * Compute a player's age in a given season number. Year 1 of the
 * league corresponds to sim-year 2026; year N is 2026 + (N-1).
 */
export function ageOfPlayer(player: Player, seasonNumber: number): number {
  const birthYear = Number(player.birthDate.slice(0, 4));
  const simYear = 2026 + (seasonNumber - 1);
  return simYear - birthYear;
}

function applyDevelopment(
  prng: Prng,
  player: Player,
  age: number,
  curve: PositionAgingCurve,
  declineMult: number,
  performanceMultiplier: number,
): PlayerSkills {
  // Cliff roll first (one per player-year): past the position's cliff age,
  // a hazard roll can produce a collapse season. The hit lands fully on
  // physical keys and at 60% on technique keys; ratings never come back, so
  // a cliff starts the end of a career, not a dip.
  let cliffMagnitude = 0;
  if (prng.next() < cliffHazard(curve, age)) {
    cliffMagnitude =
      curve.cliffMagnitudeMin + prng.next() * (curve.cliffMagnitudeMax - curve.cliffMagnitudeMin);
  }

  const result = {} as PlayerSkills;
  for (const key of ALL_SKILL_KEYS) {
    const cur = player.current[key];
    const ceil = player.ceiling[key];
    const cat = categoryFor(key);
    let next = cur;

    // Growth: close some fraction of the gap to ceiling, tapering toward the
    // position's growth end, scaled by archetype, then by the
    // season-performance multiplier on technical/mental skills.
    const gap = Math.max(0, ceil - cur);
    if (gap > 0) {
      let rate = growthRate(age, curve, cat, player.developmentArchetype);
      if (cat === 'technical' || cat === 'mental') {
        rate *= performanceMultiplier;
      }
      next += gap * rate + prng.normal(0, 0.5);
    }

    // Position- and category-specific aging decline.
    const decline = declineFor(curve, cat, age) * declineMult;
    if (decline > 0) {
      next -= prng.normal(decline, decline * 0.3, { min: 0, max: decline * 2.5 });
    }

    // Cliff season: large permanent hit to the body, most of it physical.
    if (cliffMagnitude > 0) {
      if (cat === 'physical') next -= cliffMagnitude;
      else if (cat === 'technical') next -= cliffMagnitude * 0.6;
    }

    result[key] = Math.max(1, Math.min(99, Math.round(next)));
  }
  return result;
}

/**
 * Per-age, per-category, per-archetype growth rate: the fraction of the
 * remaining gap to ceiling closed in one year.
 *
 * Early-career learning is fast everywhere (rookies gain 6-12 technical
 * points/yr); the taper is position-specific — growth dies out ~2 years
 * past the position's `growthEnd` (a CB is done growing at ~25 while a QB
 * keeps learning to 30+). Mental skills keep a floor of slow growth until
 * their decline onset (film study never stops).
 */
function growthRate(
  age: number,
  curve: PositionAgingCurve,
  category: 'physical' | 'technical' | 'mental' | 'stable',
  archetype: PlayerDevelopmentArchetype,
): number {
  let base = 0;
  if (category === 'physical') {
    base = age <= 22 ? 0.05 : 0; // post-rookie bodies only decline
  } else if (category === 'technical' || category === 'mental') {
    const early = age <= 22 ? 0.3 : age === 23 ? 0.22 : age === 24 ? 0.16 : 0.1;
    let taper = Math.min(1, Math.max(0, (curve.growthEnd + 2 - age) / 4));
    if (category === 'mental' && age < curve.mentalDeclineOnset) {
      taper = Math.max(taper, 0.3);
    }
    base = early * taper;
  } else {
    // stable
    base = age <= 22 ? 0.1 : age <= 24 ? 0.08 : 0.03;
  }

  // Archetype modifiers (age-keyed equivalents of the old stage modifiers).
  switch (archetype) {
    case 'FAST_LEARNER':
      base *= age <= 24 ? 1.5 : 0.9;
      break;
    case 'SLOW_STEADY':
      base *= 0.85;
      break;
    case 'EARLY_BLOOMER':
      base *= age <= 22 ? 1.7 : age >= 34 ? 0.6 : 0.85;
      break;
    case 'LATE_DEVELOPER':
      base *= age <= 22 ? 0.6 : age >= 25 && age <= 33 ? 1.5 : 1.0;
      break;
    case 'ADVERSITY_DRIVEN':
    case 'CONFIDENCE_DEPENDENT':
      // S4 placeholder — these archetypes get their data feed when the
      // residual performance signal lands. Treat as average until then.
      break;
  }

  return base;
}

/**
 * Derive talent tier from current skills using the same key-skill
 * average the inspector uses. Mirrors the contracts module's
 * `deriveTier` but lives here so the development module doesn't need
 * to import contracts (avoids a circular dep risk if contracts ever
 * needs to advance via development data).
 */
/**
 * Derive the fine 8-grade from current key-skill average. Thresholds split
 * the legacy 4-tier cuts (80/70/60) in two, so `gradeToTier` of the result
 * reproduces the old tier exactly — tier behavior is unchanged, grade adds
 * resolution.
 */
function deriveGradeFromSkills(skills: PlayerSkills, player: Player): TalentGrade {
  const keys = keySkillsForArchetype(player.archetype);
  if (keys.length === 0) return 'ROTATIONAL';
  const avg = keys.reduce((s, k) => s + skills[k], 0) / keys.length;
  if (avg >= 86) return 'ELITE';
  if (avg >= 80) return 'STAR';
  if (avg >= 75) return 'HIGH_STARTER';
  if (avg >= 70) return 'STARTER';
  if (avg >= 65) return 'WEAK_STARTER';
  if (avg >= 60) return 'ROTATIONAL';
  if (avg >= 54) return 'BACKUP';
  return 'FRINGE';
}

function keySkillsForArchetype(archetypeId: string): readonly (keyof PlayerSkills)[] {
  // Avoid an import-cycle through `archetypes/index.ts` by inlining a
  // minimal lookup. The full archetype catalog is the source of truth;
  // this is just key-set extraction for tier derivation.
  // For Phase 2 we approximate via position-group conventions.
  if (archetypeId.startsWith('QB_')) {
    return ['technicalSkill', 'footballIq', 'decisionMaking', 'composure'];
  }
  if (archetypeId.startsWith('WR_') || archetypeId.startsWith('TE_')) {
    return ['technicalSkill', 'handsBallSkills', 'speed', 'agility'];
  }
  if (archetypeId.startsWith('RB_') || archetypeId.startsWith('FB_')) {
    return ['speed', 'agility', 'strength', 'technicalSkill'];
  }
  if (archetypeId.startsWith('OL_')) {
    return ['blockingTechnique', 'strength', 'agility', 'technicalSkill'];
  }
  if (archetypeId.startsWith('DL_')) {
    return ['passRushTechnique', 'strength', 'speed', 'technicalSkill'];
  }
  if (archetypeId.startsWith('LB_')) {
    return ['speed', 'tacklingTechnique', 'coverageTechnique', 'footballIq'];
  }
  if (archetypeId.startsWith('DB_')) {
    return ['coverageTechnique', 'speed', 'agility', 'footballIq'];
  }
  return ['technicalSkill', 'composure'];
}

// ─── Performance-driven growth multipliers ────────────────────────────

/**
 * Compute a per-player development multiplier from their season stats.
 * Players who outperform the league median for their position group
 * grow faster (technical/mental skills only); below-median performers
 * grow slightly slower. Players with no stats (didn't play, OL, ST)
 * land on the neutral 1.0 multiplier — no penalty for unused players.
 *
 * Multiplier mapping (relative score = playerScore / positionMedian):
 *   ≥ 1.5  → 1.30  (great season)
 *   ≥ 1.1  → 1.10  (above average)
 *   ≥ 0.5  → 1.00  (average / neutral)
 *   <  0.5 → 0.95  (below average; mild slow-down)
 */
export function computePerformanceMultipliers(
  league: LeagueState,
  seasonStats: ReadonlyMap<PlayerId, PlayerSeasonStats>,
): Map<PlayerId, number> {
  // Collect scores per position group.
  const scoresByGroup = new Map<PositionGroup, number[]>();
  const playerScores = new Map<PlayerId, number>();
  for (const [playerId, stats] of seasonStats) {
    const player = league.players[playerId];
    if (!player) continue;
    const group = positionGroupFor(player.position);
    const score = scorePerformance(group, stats);
    if (score === null) continue;
    playerScores.set(playerId, score);
    const arr = scoresByGroup.get(group) ?? [];
    arr.push(score);
    scoresByGroup.set(group, arr);
  }

  // Median per group.
  const medianByGroup = new Map<PositionGroup, number>();
  for (const [group, arr] of scoresByGroup) {
    medianByGroup.set(group, median(arr));
  }

  const result = new Map<PlayerId, number>();
  for (const [playerId, score] of playerScores) {
    const player = league.players[playerId]!;
    const group = positionGroupFor(player.position);
    const groupMedian = medianByGroup.get(group);
    if (!groupMedian || groupMedian <= 0) {
      result.set(playerId, 1.0);
      continue;
    }
    const relative = score / groupMedian;
    let multiplier: number;
    if (relative >= 1.5) multiplier = 1.3;
    else if (relative >= 1.1) multiplier = 1.1;
    else if (relative >= 0.5) multiplier = 1.0;
    else multiplier = 0.95;
    result.set(playerId, multiplier);
  }
  return result;
}

/**
 * Per-position-group performance score. Returns null for groups whose
 * individual stats aren't tracked yet (OL, ST) — those players get the
 * neutral 1.0 multiplier without skewing other groups' medians.
 */
function scorePerformance(group: PositionGroup, stats: PlayerSeasonStats): number | null {
  switch (group) {
    case PositionGroup.QB:
      return stats.passingYards + 25 * stats.passingTds - 25 * stats.interceptionsThrown;
    case PositionGroup.SKILL:
      return (
        stats.rushingYards +
        stats.receivingYards +
        50 * (stats.rushingTds + stats.receivingTds)
      );
    case PositionGroup.DL:
    case PositionGroup.LB:
    case PositionGroup.DB:
      return stats.tackles + 30 * stats.sacks + 60 * stats.interceptions;
    case PositionGroup.OL:
    case PositionGroup.ST:
      return null; // no individual stats yet
  }
}

function median(arr: readonly number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1]! + sorted[mid]!) / 2;
  return sorted[mid]!;
}
