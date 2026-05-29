/**
 * Player abilities / X-Factors (v0.102, player-model overhaul item 4).
 *
 * A small layer of standout traits on top of the granular skill model. Two
 * tiers, à la Madden:
 *   - SUPERSTAR: an always-on edge a very good player carries.
 *   - X_FACTOR: a true difference-maker that, when it activates in a game,
 *     can DOMINATE — but doesn't every week (the activation roll lives in
 *     the game sim). Chase / Calvin Johnson / Revis / Brady tier.
 *
 * Abilities are HIDDEN ground truth (per North Star the game UI surfaces
 * only descriptive scout/media hints, never the flag). They EMERGE from
 * the granular profile: a player only qualifies when his demanded skills
 * clear a high bar, so a Gunslinger is a genuinely big-armed/deep-accurate
 * QB, an Unblockable edge genuinely has the get-off + bend + hands. Sparse
 * by construction (most players have none; X-Factors are rare).
 *
 * The `facet` names a `MatchupFacets` key (kept as a string to avoid a
 * players→games import); the game sim boosts that facet when the ability
 * is in effect.
 */

import type { Prng } from '../prng/index.js';
import type { PlayerSkills } from '../types/player.js';
import { PositionGroup } from '../types/enums.js';

export type AbilityTier = 'SUPERSTAR' | 'X_FACTOR';

/** Names a MatchupFacets key the ability amplifies in-game. */
export type AbilityFacet =
  | 'qbPlay'
  | 'receivingCorps'
  | 'rushingCorps'
  | 'passProtection'
  | 'passRush'
  | 'coverage'
  | 'runDefense';

export interface Ability {
  id: string;
  label: string;
  tier: AbilityTier;
  /** Position groups that can carry this ability. */
  positionGroups: readonly PositionGroup[];
  /** Skills whose mean must clear the tier threshold to qualify. */
  demandedSkills: readonly (keyof PlayerSkills)[];
  /** The team facet this ability boosts in the game sim. */
  facet: AbilityFacet;
}

const { QB, SKILL, OL, DL, LB, DB } = PositionGroup;

export const ABILITIES: readonly Ability[] = [
  // QB
  { id: 'GUNSLINGER', label: 'Gunslinger', tier: 'SUPERSTAR', positionGroups: [QB], demandedSkills: ['throwPower', 'accuracyDeep'], facet: 'qbPlay' },
  { id: 'SURGEON', label: 'Surgeon', tier: 'SUPERSTAR', positionGroups: [QB], demandedSkills: ['accuracyShort', 'accuracyMedium'], facet: 'qbPlay' },
  { id: 'ESCAPE_ARTIST', label: 'Escape Artist', tier: 'SUPERSTAR', positionGroups: [QB], demandedSkills: ['breakSack', 'throwOnRun'], facet: 'qbPlay' },
  { id: 'ICE_IN_VEINS', label: 'Ice in the Veins', tier: 'X_FACTOR', positionGroups: [QB], demandedSkills: ['throwUnderPressure', 'composure', 'decisionMaking'], facet: 'qbPlay' },
  // Skill — receiving
  { id: 'SEPARATOR', label: 'Separator', tier: 'SUPERSTAR', positionGroups: [SKILL], demandedSkills: ['routeShort', 'routeMedium', 'releaseVsOff'], facet: 'receivingCorps' },
  { id: 'YAC_KING', label: 'YAC King', tier: 'SUPERSTAR', positionGroups: [SKILL], demandedSkills: ['elusiveness', 'breakTackle'], facet: 'receivingCorps' },
  { id: 'MISMATCH_NIGHTMARE', label: 'Mismatch Nightmare', tier: 'X_FACTOR', positionGroups: [SKILL], demandedSkills: ['contestedCatch', 'catchInTraffic', 'jumping'], facet: 'receivingCorps' },
  { id: 'DEEP_THREAT', label: 'Deep Threat', tier: 'X_FACTOR', positionGroups: [SKILL], demandedSkills: ['routeDeep', 'speed'], facet: 'receivingCorps' },
  // Skill — rushing
  { id: 'WORKHORSE', label: 'Workhorse', tier: 'SUPERSTAR', positionGroups: [SKILL], demandedSkills: ['carrying', 'breakTackle', 'trucking'], facet: 'rushingCorps' },
  { id: 'HUMAN_JOYSTICK', label: 'Human Joystick', tier: 'X_FACTOR', positionGroups: [SKILL], demandedSkills: ['elusiveness', 'jukeMove', 'changeOfDirection'], facet: 'rushingCorps' },
  // OL
  { id: 'IMMOVABLE', label: 'Immovable', tier: 'SUPERSTAR', positionGroups: [OL], demandedSkills: ['passBlockPower', 'strength'], facet: 'passProtection' },
  { id: 'MIRROR_MASTER', label: 'Mirror Master', tier: 'SUPERSTAR', positionGroups: [OL], demandedSkills: ['passBlockFinesse', 'changeOfDirection'], facet: 'passProtection' },
  // DL / EDGE
  { id: 'QUICK_TWITCH', label: 'Quick Twitch', tier: 'SUPERSTAR', positionGroups: [DL], demandedSkills: ['getOff', 'acceleration'], facet: 'passRush' },
  { id: 'POWER_BULLY', label: 'Power Bully', tier: 'SUPERSTAR', positionGroups: [DL], demandedSkills: ['bullRush', 'strength'], facet: 'passRush' },
  { id: 'UNBLOCKABLE', label: 'Unblockable', tier: 'X_FACTOR', positionGroups: [DL], demandedSkills: ['getOff', 'bend', 'handTechnique'], facet: 'passRush' },
  // LB
  { id: 'ENFORCER', label: 'Enforcer', tier: 'SUPERSTAR', positionGroups: [LB], demandedSkills: ['tackle', 'hitPower', 'blockShedding'], facet: 'runDefense' },
  { id: 'SIDELINE_TO_SIDELINE', label: 'Sideline to Sideline', tier: 'SUPERSTAR', positionGroups: [LB], demandedSkills: ['pursuit', 'speed', 'playRecognition'], facet: 'runDefense' },
  // DB
  { id: 'BALLHAWK', label: 'Ballhawk', tier: 'SUPERSTAR', positionGroups: [DB], demandedSkills: ['ballSkills', 'playRecognition'], facet: 'coverage' },
  { id: 'CENTERFIELD', label: 'Centerfield', tier: 'SUPERSTAR', positionGroups: [DB], demandedSkills: ['zoneCoverage', 'playRecognition', 'speed'], facet: 'coverage' },
  { id: 'LOCKDOWN', label: 'Lockdown', tier: 'X_FACTOR', positionGroups: [DB], demandedSkills: ['manCoverage', 'pressCoverage'], facet: 'coverage' },
];

const ABILITY_BY_ID = new Map(ABILITIES.map((a) => [a.id, a] as const));
export function getAbility(id: string): Ability | undefined {
  return ABILITY_BY_ID.get(id);
}

/**
 * Hedged, descriptive scouting phrase for each ability — the knowledge-layer
 * HINT (North Star). A scout/media read surfaces this kind of language, never
 * the ability flag itself: the player UI learns "flashes rare arm talent",
 * not "has GUNSLINGER".
 */
export const ABILITY_HINTS: Record<string, string> = {
  GUNSLINGER: 'flashes rare arm talent — drives the deep ball with velocity',
  SURGEON: 'surgical short-to-intermediate accuracy; rarely misses the easy throw',
  ESCAPE_ARTIST: 'slippery in the pocket — extends plays and throws on the move',
  ICE_IN_VEINS: 'unflappable late — the moment never seems too big',
  SEPARATOR: 'creates separation at will with a crisp route tree',
  YAC_KING: 'dangerous after the catch; the first man rarely brings him down',
  MISMATCH_NIGHTMARE: 'wins the jump ball — a matchup problem in traffic',
  DEEP_THREAT: 'takes the top off the defense with true vertical speed',
  WORKHORSE: 'punishing between the tackles; can carry the load',
  HUMAN_JOYSTICK: 'absurd change of direction — makes defenders miss in a phone booth',
  IMMOVABLE: 'anchors like a wall; the bull rush goes nowhere',
  MIRROR_MASTER: 'mirrors speed rushers effortlessly off the edge',
  QUICK_TWITCH: 'explosive first step; beats tackles off the snap',
  POWER_BULLY: 'walks blockers into the backfield with raw power',
  UNBLOCKABLE: 'a one-man wrecking crew off the edge when he gets going',
  ENFORCER: 'a thumper in the box — sheds blocks and finishes tackles',
  SIDELINE_TO_SIDELINE: 'ranges sideline to sideline; nothing outruns him',
  BALLHAWK: 'a nose for the football; takes it away',
  CENTERFIELD: 'patrols the deep middle and erases the post',
  LOCKDOWN: 'travels with the No. 1 and takes him out of the game',
};

/** The hedged scouting phrase for an ability, or undefined if unknown. */
export function describeAbilityHint(id: string): string | undefined {
  return ABILITY_HINTS[id];
}

/**
 * The ability ids a profile QUALIFIES for — the latent trait, WITHOUT the
 * sparse grant roll `assignAbilities` applies. This is the ground-truth
 * "does this player actually have this trait" used by the knowledge layer
 * (a scout/media evaluator reads against it) and the perceived/real lens.
 * Returns at most one (X-Factor preferred), mirroring the grant rule.
 */
export function latentAbilities(
  positionGroup: PositionGroup,
  current: PlayerSkills,
): string[] {
  const eligible = ABILITIES.filter((a) => a.positionGroups.includes(positionGroup));
  const best = (tier: AbilityTier, bar: number): Ability | undefined =>
    eligible
      .filter((a) => a.tier === tier && meanOf(current, a.demandedSkills) >= bar)
      .map((a) => ({ a, score: meanOf(current, a.demandedSkills) }))
      .sort((p, q) => q.score - p.score || (p.a.id < q.a.id ? -1 : 1))[0]?.a;
  const x = best('X_FACTOR', X_FACTOR_THRESHOLD);
  if (x) return [x.id];
  const s = best('SUPERSTAR', SUPERSTAR_THRESHOLD);
  return s ? [s.id] : [];
}

/** Ability ids in the catalog valid for a position group (for false-flag draws). */
export function eligibleAbilityIds(positionGroup: PositionGroup): string[] {
  return ABILITIES.filter((a) => a.positionGroups.includes(positionGroup)).map((a) => a.id);
}

// Skill bar a player must clear (mean of demanded skills) to qualify, by
// tier. X-Factors need elite skills; even then they're granted sparingly.
const SUPERSTAR_THRESHOLD = 84;
const X_FACTOR_THRESHOLD = 90;
const X_FACTOR_GRANT_CHANCE = 0.6;
const SUPERSTAR_GRANT_CHANCE = 0.5;

function meanOf(current: PlayerSkills, keys: readonly (keyof PlayerSkills)[]): number {
  let s = 0;
  for (const k of keys) s += current[k];
  return keys.length > 0 ? s / keys.length : 0;
}

/**
 * Assign at most one ability to a player from their position group +
 * granular skills. X-Factors take precedence over Superstars when both
 * qualify. Deterministic from `prng`. Returns ability ids (0 or 1).
 */
export function assignAbilities(
  prng: Prng,
  positionGroup: PositionGroup,
  current: PlayerSkills,
): string[] {
  const eligible = ABILITIES.filter((a) => a.positionGroups.includes(positionGroup));
  // X-Factor candidates first (higher bar), then Superstar.
  const xCandidates = eligible.filter(
    (a) => a.tier === 'X_FACTOR' && meanOf(current, a.demandedSkills) >= X_FACTOR_THRESHOLD,
  );
  if (xCandidates.length > 0 && prng.fork('x-grant').next() < X_FACTOR_GRANT_CHANCE) {
    const pick = xCandidates
      .map((a) => ({ a, score: meanOf(current, a.demandedSkills) }))
      .sort((p, q) => q.score - p.score || (p.a.id < q.a.id ? -1 : 1))[0]!;
    return [pick.a.id];
  }
  const sCandidates = eligible.filter(
    (a) => a.tier === 'SUPERSTAR' && meanOf(current, a.demandedSkills) >= SUPERSTAR_THRESHOLD,
  );
  if (sCandidates.length > 0 && prng.fork('s-grant').next() < SUPERSTAR_GRANT_CHANCE) {
    const pick = sCandidates
      .map((a) => ({ a, score: meanOf(current, a.demandedSkills) }))
      .sort((p, q) => q.score - p.score || (p.a.id < q.a.id ? -1 : 1))[0]!;
    return [pick.a.id];
  }
  return [];
}
