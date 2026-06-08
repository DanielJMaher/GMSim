import type { Prng } from '../prng/index.js';
import type { Position } from '../types/enums.js';

/**
 * Position-aware scouting trait vocabulary (2026-06-04).
 *
 * Generated prospect media used to say only "{pos}" — a QB take and an EDGE take
 * read identically. The Truth Arbiter's Scribe agent measured the REAL per-
 * position scouting vocabulary (Beast + PFF: QBs get "pocket / arm / processing",
 * EDGE gets "bend / first step / hands", CB gets "press / ball skills / hips").
 * These pools are the NFL-authentic trait phrases that vocabulary grounds, so a
 * generated take now sounds like a scout who actually watched THAT position.
 *
 * Noun phrases — they slot into "... flashes {trait} ..." / "scouts love his
 * {trait}". Pure cosmetic flavor (headline text); no ground-truth leakage.
 */

export type VocabBucket =
  | 'QB' | 'RB' | 'WR' | 'TE' | 'OL' | 'EDGE' | 'DT' | 'LB' | 'CB' | 'S' | 'ST';

export const POSITION_TO_BUCKET: Partial<Record<Position, VocabBucket>> = {
  QB: 'QB',
  RB: 'RB', FB: 'RB',
  WR: 'WR',
  TE: 'TE',
  LT: 'OL', LG: 'OL', C: 'OL', RG: 'OL', RT: 'OL',
  EDGE: 'EDGE',
  DT: 'DT', NT: 'DT',
  ILB: 'LB', OLB: 'LB',
  CB: 'CB', NICKEL: 'CB',
  S: 'S',
  K: 'ST', P: 'ST', LS: 'ST',
};

// Bare noun phrases (no leading article) so they slot cleanly after "the" /
// "{name}'s" in the templates.
const TRAITS: Record<VocabBucket, readonly string[]> = {
  QB: ['pocket poise', 'arm talent', 'easy velocity', 'quick processing', 'deep-ball touch', 'off-platform creativity', 'throwing anticipation'],
  RB: ['vision and patience', 'contact balance', 'burst through the hole', 'three-down receiving chops', 'tackle-breaking power', 'one-cut decisiveness'],
  WR: ['route-running nuance', 'yards-after-catch juice', 'high-pointing ability', 'separation quickness', 'strong hands through contact', 'release quickness off the line'],
  TE: ['seam-stretching speed', 'reliable hands', 'in-line blocking pop', 'move-tight-end versatility', 'red-zone catch radius'],
  OL: ['pass-pro anchoring', 'light feet in space', 'hand placement and punch', 'people-moving run blocking', 'finishing nastiness'],
  EDGE: ['corner-bending ability', 'explosive first-step quickness', 'relentless motor', 'active, heavy hands', 'pass-rush polish', 'edge-setting strength'],
  DT: ['gap penetration', 'point-of-attack anchoring', 'interior-rush disruption', 'heavy hands to stack and shed', 'short-area quickness for his size'],
  LB: ['downhill trigger', 'sideline-to-sideline range', 'coverage instincts', 'block-shedding strength', 'blitz timing'],
  CB: ['press-man cover skills', 'ball production', 'fluid hips', 'sticky trail coverage', 'recovery speed', 'catch-point physicality'],
  S: ['range over the top', 'box-safety physicality', 'sound alley fits', 'centerfield instincts', 'down-or-deep versatility'],
  ST: ['leg strength', 'pinpoint placement', 'consistent operation time', 'pressure-proof composure'],
};

// Bare noun phrases naming the position-specific FAILURE MODE — the weakness
// pole of the Scribe's per-position polarity (the words real reports reach for
// on the down side, distinct per position; see the Scribe's `positionPolarity`).
// They slot after "the concern is {w}" / "{w} shows up on tape".
const WEAKNESS_TRAITS: Record<VocabBucket, readonly string[]> = {
  QB: ['happy feet under pressure', 'a tendency to stare down the first read', 'erratic placement on the move', 'lateness driving throws into tight windows', 'inconsistent footwork from clean pockets'],
  RB: ['shaky pass protection', 'a habit of dancing instead of hitting the hole', 'a limited route tree out of the backfield', 'ball security in traffic'],
  WR: ['a narrow route tree', 'body-catching away from his frame', 'inconsistent releases against press', 'drops on contested catches'],
  TE: ['inline blocking that lags the receiving game', 'tightness sinking his hips', 'a limited catch radius', 'effort as a run blocker'],
  OL: ['lunging and waist-bending in space', 'heavy feet redirecting to counters', 'hand placement that drifts late in reps', 'a high pad level out of his stance'],
  EDGE: ['a limited counter-rush plan', 'getting washed against the run', 'a high pad level off the edge', 'stiffness flattening to the quarterback'],
  DT: ['pad level that rises out of his stance', 'a thin pass-rush plan', 'wearing down on long drives', 'getting moved off the spot against doubles'],
  LB: ['false steps in his run fits', 'stiffness opening his hips in coverage', 'getting caught up in the wash', 'over-aggression against play-action'],
  CB: ['grabbiness at the top of the route', 'a tendency to peek into the backfield', 'tightness flipping his hips', 'inconsistent tackling in run support'],
  S: ['tightness in deep transitions', 'poor angles to the football', 'a tendency to bite on play-action', 'inconsistent tackling in the alley'],
  ST: ['inconsistent operation time', 'leg strength on the longer attempts', 'directional consistency'],
};

/** The vocabulary bucket for a position (with the ST fallback). */
export function bucketFor(position: Position): VocabBucket {
  return POSITION_TO_BUCKET[position] ?? 'ST';
}

/** A position-appropriate positive scouting trait phrase. */
export function scoutTraitFor(prng: Prng, position: Position): string {
  const bucket = POSITION_TO_BUCKET[position] ?? 'ST';
  return prng.pick(TRAITS[bucket]);
}

/** A position-appropriate WEAKNESS phrase — the failure mode scouts flag for
 *  that position (the down pole of the per-position polarity). */
export function scoutConcernFor(prng: Prng, position: Position): string {
  const bucket = POSITION_TO_BUCKET[position] ?? 'ST';
  return prng.pick(WEAKNESS_TRAITS[bucket]);
}

/**
 * `n` DISTINCT position-appropriate trait phrases (for a multi-point scout
 * report — a real writeup cites two or three different things, never the same
 * trait twice). Falls back to fewer if the bucket is small. Deterministic.
 */
export function scoutTraitsFor(prng: Prng, position: Position, n: number): string[] {
  const bucket = POSITION_TO_BUCKET[position] ?? 'ST';
  const pool = [...TRAITS[bucket]];
  const out: string[] = [];
  const take = Math.min(n, pool.length);
  for (let i = 0; i < take; i++) {
    out.push(pool.splice(prng.nextInt(pool.length), 1)[0]!);
  }
  return out;
}
