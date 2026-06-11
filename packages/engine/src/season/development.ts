import type { Prng } from '../prng/index.js';
import type { Player, PlayerSkills, PlayerDevelopmentArchetype, TalentGrade } from '../types/player.js';
import { gradeToTier } from '../players/skills.js';
import type { LeagueState } from '../types/league.js';
import type { PlayerSeasonStats } from '../types/stats.js';
import type { PlayerId } from '../types/ids.js';
import { PositionGroup } from '../types/enums.js';
import { positionGroupFor } from '../players/position-group.js';
import { ALL_SKILL_KEYS, categoryFor } from '../players/skill-keys.js';
import { keySkillAverage } from '../archetypes/key-skill.js';
import {
  curveForPosition,
  declineMultiplierFor,
  declineFor,
  cliffHazard,
  type PositionAgingCurve,
} from '../players/aging-curves.js';
import {
  careerShapeFor,
  resurgenceWindowFor,
  SHAPE_MODIFIERS,
  type ShapeModifiers,
} from '../players/career-shapes.js';

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

  // The hidden career shape (S3) bends the position curve per player —
  // METEORs fade early and hard, EVERGREENs barely age, SECOND_PEAKs get a
  // seed-rolled 2-year resurgence window in the early-decline years.
  const shape = careerShapeFor(league, player);
  const mods = SHAPE_MODIFIERS[shape];
  let inResurgence = false;
  if (mods.resurgence) {
    const firstOnset =
      Math.min(curve.physicalDeclineOnset, curve.techniqueDeclineOnset) + mods.declineOnsetShift;
    const w = resurgenceWindowFor(league, player, firstOnset);
    inResurgence = ageNext >= w.start && ageNext <= w.end;
  }

  const { newCurrent, newCeiling } = applyDevelopment(
    prng,
    player,
    ageNext,
    curve,
    mods,
    inResurgence,
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
    ceiling: newCeiling,
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

/** Ceiling-bump eligibility: young + a breakout season (perfMult >= 1.3). */
const CEILING_BUMP_MAX_AGE = 25;
const CEILING_BUMP_CHANCE = 0.15;
/** Erosion: stalled gap above this shaves toward current each year. */
const CEILING_EROSION_FLOOR_GAP = 5;
const CEILING_EROSION_RATE = 0.15;

function applyDevelopment(
  prng: Prng,
  player: Player,
  age: number,
  curve: PositionAgingCurve,
  mods: ShapeModifiers,
  inResurgence: boolean,
  declineMult: number,
  performanceMultiplier: number,
): { newCurrent: PlayerSkills; newCeiling: PlayerSkills } {
  // Cliff roll first (one per player-year): past the position's cliff age,
  // a hazard roll can produce a collapse season. The hit lands fully on
  // physical keys and at 60% on technique keys; ratings never come back, so
  // a cliff starts the end of a career, not a dip. Shape scales the hazard
  // (METEORs cliff easily, EVERGREENs resist); a resurgence year never cliffs.
  let cliffMagnitude = 0;
  const hazard = Math.min(0.4, cliffHazard(curve, age) * mods.cliffHazardMult);
  if (!inResurgence && prng.next() < hazard) {
    cliffMagnitude =
      curve.cliffMagnitudeMin + prng.next() * (curve.cliffMagnitudeMax - curve.cliffMagnitudeMin);
  }

  // Ceiling bump (S3): a young player coming off a breakout season has a
  // shot at raising his hidden tech/mental ceilings — the documented design
  // intent ("rare random ceiling bumps for very young outperformers") that
  // was never implemented. Marginal by design: +1..2 per key, one roll/yr.
  const bumpCeilings =
    age <= CEILING_BUMP_MAX_AGE &&
    performanceMultiplier >= 1.3 &&
    prng.next() < CEILING_BUMP_CHANCE;

  const effGrowthEnd = curve.growthEnd + mods.growthEndShift;
  const newCurrent = {} as PlayerSkills;
  const newCeiling = {} as PlayerSkills;
  for (const key of ALL_SKILL_KEYS) {
    const cur = player.current[key];
    let ceil = player.ceiling[key];
    const cat = categoryFor(key);
    let next = cur;

    if (cat === 'technical' || cat === 'mental') {
      if (bumpCeilings && ceil > cur) {
        ceil = Math.min(99, ceil + prng.nextRange(1, 3));
      } else if (!inResurgence && age >= effGrowthEnd - 1) {
        // Ceiling erosion: potential a player never grew into evaporates as
        // the growth window closes — busts EMERGE rather than being rolled.
        // Underperformance (perfMult <= 0.95) accelerates the rot.
        const gap = ceil - cur;
        if (gap > CEILING_EROSION_FLOOR_GAP) {
          const rate = CEILING_EROSION_RATE * (performanceMultiplier <= 0.95 ? 1.5 : 1);
          ceil = Math.max(cur, ceil - (gap - CEILING_EROSION_FLOOR_GAP) * rate);
        }
      }
    }

    // Growth: close some fraction of the gap to ceiling, tapering toward the
    // (shape-shifted) growth end, scaled by shape + archetype, then by the
    // season-performance multiplier on technical/mental skills. A resurgence
    // year reopens tech/mental growth at a prime-like rate.
    const gap = Math.max(0, ceil - cur);
    if (gap > 0) {
      let rate = growthRate(age, effGrowthEnd, curve, cat, player.developmentArchetype);
      if (cat === 'technical' || cat === 'mental') {
        rate *= mods.growthMult;
        if (inResurgence) rate = Math.max(rate, 0.12);
        rate *= performanceMultiplier;
        // S4: the residual signal finally feeds the perf-reactive archetypes.
        // ADVERSITY_DRIVEN players answer a bad year with a growth spurt;
        // CONFIDENCE_DEPENDENT players amplify whichever way the season went.
        if (player.developmentArchetype === 'ADVERSITY_DRIVEN' && performanceMultiplier <= 0.95) {
          rate *= 1.35;
        } else if (player.developmentArchetype === 'CONFIDENCE_DEPENDENT') {
          rate *= Math.pow(performanceMultiplier, 0.6);
        }
      }
      next += gap * rate + prng.normal(0, 0.5);
    }

    // Position- and category-specific aging decline, shifted/scaled by shape
    // (an onset shift of +3 delays both the start and the ramp progression),
    // nearly suppressed during a resurgence window. S4: bad seasons age a
    // post-peak player faster; strong late seasons slow the fade (bounded).
    let decline = declineFor(curve, cat, age - mods.declineOnsetShift) * declineMult * mods.declineRateMult;
    if (age >= effGrowthEnd) {
      if (performanceMultiplier <= 0.85) decline *= 1.35;
      else if (performanceMultiplier <= 0.92) decline *= 1.2;
      else if (performanceMultiplier >= 1.12) decline *= 0.85;
    }
    if (inResurgence) decline *= 0.35;
    if (decline > 0) {
      next -= prng.normal(decline, decline * 0.3, { min: 0, max: decline * 2.5 });
    }

    // Cliff season: large permanent hit to the body, most of it physical.
    if (cliffMagnitude > 0) {
      if (cat === 'physical') next -= cliffMagnitude;
      else if (cat === 'technical') next -= cliffMagnitude * 0.6;
    }

    newCurrent[key] = Math.max(1, Math.min(99, Math.round(next)));
    newCeiling[key] = Math.max(newCurrent[key], Math.min(99, Math.round(ceil)));
  }
  return { newCurrent, newCeiling };
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
  effGrowthEnd: number,
  curve: PositionAgingCurve,
  category: 'physical' | 'technical' | 'mental' | 'stable',
  archetype: PlayerDevelopmentArchetype,
): number {
  let base = 0;
  if (category === 'physical') {
    base = age <= 22 ? 0.05 : 0; // post-rookie bodies only decline
  } else if (category === 'technical' || category === 'mental') {
    const early = age <= 22 ? 0.3 : age === 23 ? 0.22 : age === 24 ? 0.16 : 0.1;
    let taper = Math.min(1, Math.max(0, (effGrowthEnd + 2 - age) / 4));
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
      // Perf-reactive archetypes — handled in applyDevelopment where the
      // season's performance multiplier is in scope (S4).
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
 * Compute a per-player development multiplier from their season stats —
 * v2 (Living Careers S4): the RESIDUAL signal. Expectation is set by
 * SAME-RATING peers (rating quartiles within the position group), not the
 * whole group's median — a star producing like a median star is neutral, so
 * good players don't compound automatically (no rich-get-richer loop); a
 * backup outproducing his band is a genuine breakout. Bands with fewer than
 * four members fall back to the whole-group median.
 *
 * Players with no stats (didn't play, OL, ST) land on the neutral 1.0
 * multiplier — no penalty for unused players.
 *
 * Multiplier mapping (relative score = playerScore / bandMedian), hard caps:
 *   ≥ 1.5  → 1.30  (breakout)
 *   ≥ 1.15 → 1.12  (above band)
 *   ≥ 0.55 → 1.00  (in band / neutral)
 *   ≥ 0.30 → 0.92  (below band)
 *   <  0.30 → 0.85 (collapse season)
 *
 * Consumed by `advancePlayerDevelopment`: scales tech/mental growth, feeds
 * ADVERSITY_DRIVEN / CONFIDENCE_DEPENDENT, and modulates post-peak decline
 * (bad years age you; good late years slow the fade).
 */
export function computePerformanceMultipliers(
  league: LeagueState,
  seasonStats: ReadonlyMap<PlayerId, PlayerSeasonStats>,
): Map<PlayerId, number> {
  interface Entry {
    playerId: PlayerId;
    rating: number;
    score: number;
  }
  const byGroup = new Map<PositionGroup, Entry[]>();
  for (const [playerId, stats] of seasonStats) {
    const player = league.players[playerId];
    if (!player) continue;
    const group = positionGroupFor(player.position);
    const score = scorePerformance(group, stats);
    if (score === null) continue;
    const arr = byGroup.get(group) ?? [];
    arr.push({ playerId, rating: keySkillAverage(player.current, player.archetype), score });
    byGroup.set(group, arr);
  }

  const MIN_BAND = 4;
  const result = new Map<PlayerId, number>();
  for (const [, entries] of byGroup) {
    const groupMedian = median(entries.map((e) => e.score));
    // Rating quartiles within the group — same-caliber peers.
    const sorted = [...entries].sort((a, b) => a.rating - b.rating);
    const bandSize = Math.ceil(sorted.length / 4);
    for (let b = 0; b < 4; b++) {
      const band = sorted.slice(b * bandSize, (b + 1) * bandSize);
      if (band.length === 0) continue;
      const expected =
        band.length >= MIN_BAND ? median(band.map((e) => e.score)) : groupMedian;
      for (const e of band) {
        if (!expected || expected <= 0) {
          result.set(e.playerId, 1.0);
          continue;
        }
        const relative = e.score / expected;
        let multiplier: number;
        if (relative >= 1.5) multiplier = 1.3;
        else if (relative >= 1.15) multiplier = 1.12;
        else if (relative >= 0.55) multiplier = 1.0;
        else if (relative >= 0.3) multiplier = 0.92;
        else multiplier = 0.85;
        result.set(e.playerId, multiplier);
      }
    }
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
