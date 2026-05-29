import type { Player, PlayerSkills } from '../types/player.js';
import type {
  OffensiveSchemeArchetype,
  DefensiveSchemeArchetype,
} from '../types/personnel.js';
import { getArchetypeById, type ArchetypeId } from '../archetypes/index.js';

/**
 * Look up the offensive scheme fit multiplier for an archetype + scheme.
 * Returns 1.0 (neutral) if the archetype isn't registered for the scheme
 * or if it's a defensive archetype.
 */
export function offensiveSchemeFit(
  archetypeId: ArchetypeId,
  scheme: OffensiveSchemeArchetype,
): number {
  const archetype = getArchetypeById(archetypeId);
  if (!archetype) return 1.0;
  if (archetype.side !== 'OFFENSE') return 1.0;
  return archetype.offensiveSchemeFit?.[scheme] ?? 1.0;
}

/**
 * Look up the defensive scheme fit multiplier for an archetype + scheme.
 * Returns 1.0 (neutral) if the archetype isn't registered for the scheme
 * or if it's an offensive archetype.
 */
export function defensiveSchemeFit(
  archetypeId: ArchetypeId,
  scheme: DefensiveSchemeArchetype,
): number {
  const archetype = getArchetypeById(archetypeId);
  if (!archetype) return 1.0;
  if (archetype.side !== 'DEFENSE') return 1.0;
  return archetype.defensiveSchemeFit?.[scheme] ?? 1.0;
}

// ── Role-based fit (v0.96, player-model overhaul Stage 3) ─────────────────
//
// The archetype↔scheme multiplier is a *role* baseline ("a speed rusher
// fits a 4-3"). But every player with that archetype used to get the same
// 1.5 — Myles Garrett and a camp body alike. Real fit depends on whether
// the player actually *embodies* the role: only blue-chip edges are a true
// fit for every system; role players are scheme-locked.
//
// We modulate the baseline by `embodiment` (0..1) — how strongly the
// player's skills match the archetype's demanded skills:
//   - bonus schemes (baseline > 1): realized in proportion to embodiment,
//     so only players who actually have the goods get the premium fit.
//   - penalty schemes (baseline < 1): applied in proportion to (1 −
//     embodiment), so a blue-chip transcends scheme (fits everywhere)
//     while a one-dimensional role player takes the hit.
// Neutral baselines (== 1) are unaffected. Output stays in the catalog's
// [0.5, 1.7] range, so downstream consumers are unchanged in scale.

/** Skills below this archetype-key average embody none of the role; at/above
 * the high mark they fully embody it. */
const EMBODY_LOW = 50;
const EMBODY_HIGH = 88;
/** Archetype skill-weight at/above which a skill counts as "demanded". */
const DEMANDED_WEIGHT = 1.2;

/**
 * 0..1 — how strongly a player's current skills embody the demanded skills
 * of their archetype (weighted by how much the archetype emphasizes each).
 * No skills available → 1.0 (fall back to the raw archetype baseline).
 */
function embodiment(
  current: PlayerSkills | undefined,
  skillWeights: Partial<Record<keyof PlayerSkills, number>>,
): number {
  if (!current) return 1.0;
  let wsum = 0;
  let w = 0;
  for (const [k, weight] of Object.entries(skillWeights) as [keyof PlayerSkills, number][]) {
    if (weight < DEMANDED_WEIGHT) continue;
    const v = current[k];
    if (typeof v !== 'number') continue;
    wsum += v * weight;
    w += weight;
  }
  if (w === 0) return 1.0;
  const meanKey = wsum / w;
  return Math.max(0, Math.min(1, (meanKey - EMBODY_LOW) / (EMBODY_HIGH - EMBODY_LOW)));
}

function modulate(baseline: number, embody: number): number {
  if (baseline >= 1.0) return 1.0 + (baseline - 1.0) * embody;
  // Penalty: blue-chips (embody→1) resist it; role players (embody→0) eat it.
  return 1.0 + (baseline - 1.0) * (1 - embody);
}

/**
 * Compute the scheme fit for a player given a team's offensive and
 * defensive scheme. Reads `player.archetype` for the role baseline and
 * `player.current` (when present) to modulate by how well the player
 * embodies that role — so only blue-chips realize a premium fit and
 * transcend non-ideal schemes. Callers without skills (a bare archetype)
 * get the raw baseline.
 *
 * Special-teams archetypes are scheme-neutral (always 1.0).
 * Returns a multiplier in the catalog's [0.5, 1.7] range.
 */
export function schemeFitForPlayer(
  player: Pick<Player, 'archetype'> & { current?: PlayerSkills },
  context: {
    offensiveScheme: OffensiveSchemeArchetype;
    defensiveScheme: DefensiveSchemeArchetype;
  },
): number {
  const archetype = getArchetypeById(player.archetype as ArchetypeId);
  if (!archetype) return 1.0;
  let baseline: number;
  switch (archetype.side) {
    case 'OFFENSE':
      baseline = archetype.offensiveSchemeFit?.[context.offensiveScheme] ?? 1.0;
      break;
    case 'DEFENSE':
      baseline = archetype.defensiveSchemeFit?.[context.defensiveScheme] ?? 1.0;
      break;
    default:
      return 1.0; // special teams
  }
  const embody = embodiment(player.current, archetype.skillWeights);
  const fit = modulate(baseline, embody);
  return Math.max(0.5, Math.min(1.7, fit));
}
