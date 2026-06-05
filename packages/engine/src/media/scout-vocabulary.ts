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

type VocabBucket =
  | 'QB' | 'RB' | 'WR' | 'TE' | 'OL' | 'EDGE' | 'DT' | 'LB' | 'CB' | 'S' | 'ST';

const POSITION_TO_BUCKET: Partial<Record<Position, VocabBucket>> = {
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

/** A position-appropriate positive scouting trait phrase. */
export function scoutTraitFor(prng: Prng, position: Position): string {
  const bucket = POSITION_TO_BUCKET[position] ?? 'ST';
  return prng.pick(TRAITS[bucket]);
}
