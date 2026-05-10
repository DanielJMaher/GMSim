import type { Prng } from '../prng/index.js';
import type { Player, PlayerSkills, PlayerDevelopmentArchetype, TalentTier } from '../types/player.js';
import type { LeagueState } from '../types/league.js';
import type { PlayerSeasonStats } from '../types/stats.js';
import type { PlayerId } from '../types/ids.js';
import { PositionGroup } from '../types/enums.js';
import { positionGroupFor } from '../players/position-group.js';

/**
 * Apply one year of development to a player. Hidden ceilings shift only
 * marginally (and only upward via exceptional-performance breakthroughs,
 * which we approximate with rare random ceiling bumps for very young
 * outperformers). Current ratings advance toward the ceiling based on
 * age stage and development archetype, with physical decline for
 * veterans/aging.
 *
 * Source: Player Development System Design Document — hidden mechanics,
 * scheme-specific growth, archetype-based optimization. Phase 2 omits
 * the coaching focus allocation interface (deferred) and treats every
 * player as receiving baseline coaching attention.
 */
export function advancePlayerDevelopment(
  prng: Prng,
  player: Player,
  league: LeagueState,
  performanceMultiplier = 1.0,
): Player {
  const ageNext = ageOfPlayer(player, league.seasonNumber + 1);
  const stageNext = stageForAge(ageNext);

  const newCurrent = applyDevelopment(prng, player, stageNext, performanceMultiplier);
  // Tier shifts as skills change. We don't store an "original" tier;
  // re-derive from new current ratings using the same skill-key logic
  // contracts use.
  const newTier = deriveTierFromSkills(newCurrent, player);

  return {
    ...player,
    experienceYears: player.experienceYears + 1,
    current: newCurrent,
    tier: newTier,
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

type AgeStage = 'ROOKIE' | 'DEVELOPING' | 'PRIME' | 'VETERAN' | 'AGING';

function stageForAge(age: number): AgeStage {
  if (age <= 22) return 'ROOKIE';
  if (age <= 24) return 'DEVELOPING';
  if (age <= 29) return 'PRIME';
  if (age <= 33) return 'VETERAN';
  return 'AGING';
}

const PHYSICAL_KEYS: readonly (keyof PlayerSkills)[] = [
  'speed', 'acceleration', 'agility', 'strength', 'durability',
];
const TECHNICAL_KEYS: readonly (keyof PlayerSkills)[] = [
  'technicalSkill', 'handsBallSkills', 'blockingTechnique',
  'passRushTechnique', 'coverageTechnique', 'tacklingTechnique',
];
const MENTAL_KEYS: readonly (keyof PlayerSkills)[] = [
  'footballIq', 'decisionMaking', 'leadership', 'composure',
];
const STABLE_KEYS: readonly (keyof PlayerSkills)[] = [
  'competitiveness', 'workEthic', 'coachability',
];

const ALL_SKILL_KEYS: readonly (keyof PlayerSkills)[] = [
  ...PHYSICAL_KEYS, ...TECHNICAL_KEYS, ...MENTAL_KEYS, ...STABLE_KEYS,
];

function categoryFor(key: keyof PlayerSkills): 'physical' | 'technical' | 'mental' | 'stable' {
  if (PHYSICAL_KEYS.includes(key)) return 'physical';
  if (TECHNICAL_KEYS.includes(key)) return 'technical';
  if (MENTAL_KEYS.includes(key)) return 'mental';
  return 'stable';
}

function applyDevelopment(
  prng: Prng,
  player: Player,
  stage: AgeStage,
  performanceMultiplier: number,
): PlayerSkills {
  const result = {} as PlayerSkills;
  for (const key of ALL_SKILL_KEYS) {
    const cur = player.current[key];
    const ceil = player.ceiling[key];
    const cat = categoryFor(key);
    let next = cur;

    // Growth: close some fraction of the gap to ceiling, scaled by
    // stage + archetype, then by season-performance multiplier on
    // technical/mental skills (the categories players can grow into).
    const gap = Math.max(0, ceil - cur);
    if (gap > 0) {
      let rate = growthRate(stage, cat, player.developmentArchetype);
      if (cat === 'technical' || cat === 'mental') {
        rate *= performanceMultiplier;
      }
      next += gap * rate + prng.normal(0, 0.5);
    }

    // Aging decline for physical skills only (per design doc).
    if (cat === 'physical') {
      if (stage === 'VETERAN') next -= prng.normal(0.6, 0.3);
      else if (stage === 'AGING') next -= prng.normal(2.2, 0.7);
    }

    result[key] = Math.max(1, Math.min(99, Math.round(next)));
  }
  return result;
}

/**
 * Per-stage, per-category, per-archetype growth rate. Returns the
 * fraction of remaining gap to ceiling closed in one year.
 *
 * Numbers tuned so that:
 *   - A rookie's technical skills typically gain 6-12 points/yr
 *   - A prime player's technical skills gain 1-3 points/yr
 *   - Stable traits move minimally
 *   - Physical skills only ever decline (no growth post-rookie)
 */
function growthRate(
  stage: AgeStage,
  category: 'physical' | 'technical' | 'mental' | 'stable',
  archetype: PlayerDevelopmentArchetype,
): number {
  let base = 0;
  if (category === 'physical') {
    if (stage === 'ROOKIE') base = 0.05;
    else base = 0; // post-rookie, only decline (handled separately)
  } else if (category === 'technical' || category === 'mental') {
    if (stage === 'ROOKIE') base = 0.32;
    else if (stage === 'DEVELOPING') base = 0.25;
    else if (stage === 'PRIME') base = 0.1;
    else if (stage === 'VETERAN') base = 0.04;
    else base = 0.02; // AGING
  } else {
    // stable
    if (stage === 'ROOKIE') base = 0.1;
    else if (stage === 'DEVELOPING') base = 0.08;
    else base = 0.03;
  }

  // Archetype modifiers
  switch (archetype) {
    case 'FAST_LEARNER':
      base *= stage === 'ROOKIE' || stage === 'DEVELOPING' ? 1.5 : 0.9;
      break;
    case 'SLOW_STEADY':
      base *= 0.85;
      break;
    case 'EARLY_BLOOMER':
      base *= stage === 'ROOKIE' ? 1.7 : stage === 'AGING' ? 0.6 : 0.85;
      break;
    case 'LATE_DEVELOPER':
      base *= stage === 'ROOKIE' ? 0.6 : stage === 'PRIME' || stage === 'VETERAN' ? 1.5 : 1.0;
      break;
    case 'ADVERSITY_DRIVEN':
    case 'CONFIDENCE_DEPENDENT':
      // Phase 2 placeholder — these archetypes need game-performance feedback,
      // which the simulator doesn't yet track per-player. Treat as average.
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
function deriveTierFromSkills(skills: PlayerSkills, player: Player): TalentTier {
  // Use the same key-skill set as the contracts module: skills with
  // archetype weight ≥ 1.2.
  // Loose duplication is intentional — keeps this module standalone.
  const archetype = player.archetype;
  const keys = keySkillsForArchetype(archetype);
  if (keys.length === 0) return 'BACKUP';
  const avg = keys.reduce((s, k) => s + skills[k], 0) / keys.length;
  if (avg >= 80) return 'STAR';
  if (avg >= 70) return 'STARTER';
  if (avg >= 60) return 'BACKUP';
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
