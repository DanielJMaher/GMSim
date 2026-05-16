import type { Prng } from '../prng/index.js';
import { Position } from '../types/enums.js';
import type { ArchetypeId } from '../types/player.js';
import { getArchetypesForPosition } from '../archetypes/index.js';

/**
 * Conversion candidate map — which NFL positions are realistic
 * projections for a player whose college position is X. Per Doc 3:
 *
 *   "A 6'3" 235lb DE with elite speed but low bench press may be a
 *    scheme fit at DE for a 4-3 team but projects as a 3-4 OLB for
 *    3-4 teams. The same conversion candidate may be identified by
 *    multiple teams or missed entirely by most of the league."
 *
 * Slice 1 carries a fixed conversion table; the engine assigns a
 * realistic alternate to ~14% of prospects (the "primary" projection
 * differs from college position) and another ~25% who have a
 * plausible alternate without being a primary-converter (the
 * "creative team might consider" cases).
 */

const CONVERSION_TABLE: Partial<Record<Position, readonly Position[]>> = {
  // Edge / OLB tweeners
  [Position.EDGE]: [Position.OLB, Position.DT],
  [Position.OLB]: [Position.EDGE, Position.ILB],
  [Position.DT]: [Position.NT, Position.EDGE],
  [Position.NT]: [Position.DT],

  // LB / S overlap (modern hybrid box-S role)
  [Position.ILB]: [Position.OLB, Position.S],
  [Position.S]: [Position.NICKEL, Position.CB, Position.ILB],

  // Corner tweeners
  [Position.CB]: [Position.NICKEL, Position.S],
  [Position.NICKEL]: [Position.CB, Position.S],

  // Skill conversions
  [Position.WR]: [Position.S, Position.NICKEL],
  [Position.RB]: [Position.WR],
  [Position.TE]: [Position.LT, Position.RT, Position.RB], // big TE → tackle, satellite TE → bell-cow back
  [Position.FB]: [Position.RB, Position.TE],

  // OL flex (interior tackle conversions are common)
  [Position.LT]: [Position.LG, Position.RT],
  [Position.RT]: [Position.RG, Position.LT],
  [Position.LG]: [Position.C, Position.RG],
  [Position.RG]: [Position.C, Position.LG],
  [Position.C]: [Position.LG, Position.RG],
};

/**
 * Roll the prospect's NFL position projection.
 *
 *   ~86% of prospects project at their college position.
 *   ~14% are primary-conversion candidates: their best NFL fit is a
 *        different position than they currently play.
 *
 * Returns a tuple of (projectedPrimary, alternates). Alternates is
 * always a non-empty list when there's a known conversion path;
 * empty otherwise (kickers, punters, long snappers).
 */
export function rollPositionProjection(
  prng: Prng,
  collegePosition: Position,
): { projected: Position; alternates: readonly Position[]; isConversion: boolean } {
  const conversionPath = CONVERSION_TABLE[collegePosition];
  if (!conversionPath || conversionPath.length === 0) {
    return { projected: collegePosition, alternates: [], isConversion: false };
  }

  // 14% chance of a primary conversion. When converting, weight toward
  // the first listed alternate (the "most natural" fit per the table).
  if (prng.next() < 0.14) {
    const projected =
      prng.next() < 0.65 ? conversionPath[0]! : prng.pick(conversionPath);
    // Build alternates: original college position + remaining table entries.
    const alts: Position[] = [collegePosition];
    for (const p of conversionPath) {
      if (p !== projected && !alts.includes(p)) alts.push(p);
    }
    return { projected, alternates: alts, isConversion: true };
  }

  // Non-converter — but ~25% still carry a plausible alternate the
  // creative team-evaluator might consider.
  if (prng.next() < 0.25) {
    return {
      projected: collegePosition,
      alternates: conversionPath.slice(0, 1),
      isConversion: false,
    };
  }
  return { projected: collegePosition, alternates: [], isConversion: false };
}

/**
 * Pick the prospect's TRUE NFL archetype — drawn from the archetypes
 * valid for their projected NFL position. Uniform across the
 * archetype pool for that position; college coaches haven't filtered
 * the prospect through scheme yet.
 */
export function pickTrueArchetype(prng: Prng, projectedPosition: Position): ArchetypeId {
  const candidates = getArchetypesForPosition(projectedPosition);
  if (candidates.length === 0) {
    throw new Error(`No archetypes registered for projected position: ${projectedPosition}`);
  }
  return prng.pick(candidates).id;
}

/**
 * Pick what college coaches + media are CALLING the prospect.
 *
 * For non-converters: usually the same archetype as the truth, with
 *   a ~12% chance of a different-but-position-valid archetype (the
 *   "scout report misread" axis).
 *
 * For conversion candidates: the assumed archetype is drawn from the
 *   college-position pool, not the projected-NFL-position pool. This
 *   is the "DE who's actually a 3-4 OLB" case — college coaches see
 *   a DE and call him a DE, but the truth is he's an OLB.
 */
export function pickAssumedArchetype(
  prng: Prng,
  trueArchetype: ArchetypeId,
  collegePosition: Position,
  isConversion: boolean,
): ArchetypeId {
  if (isConversion) {
    const candidates = getArchetypesForPosition(collegePosition);
    if (candidates.length > 0) return prng.pick(candidates).id;
  }
  // Non-converter — 88% same as true archetype, 12% different-valid.
  if (prng.next() < 0.88) return trueArchetype;
  const candidates = getArchetypesForPosition(collegePosition);
  if (candidates.length <= 1) return trueArchetype;
  // Pick a different one
  for (let i = 0; i < 5; i++) {
    const pick = prng.pick(candidates).id;
    if (pick !== trueArchetype) return pick;
  }
  return trueArchetype;
}
