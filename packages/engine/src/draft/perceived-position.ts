/**
 * Perceived NFL-position projection (v0.127) — scouts identifying conversions.
 *
 * Per Doc 3: "A 6'3 235 DE with elite speed but a low bench may be a DE for a
 * 4-3 team but a 3-4 OLB for 3-4 teams. The same conversion candidate may be
 * identified by multiple teams or missed entirely by most of the league."
 *
 * Until now the boards read the prospect's TRUE `nflProjectedPosition` directly
 * — every team omnisciently knew the conversion. This makes the projection a
 * PERCEIVED, fallible read: each team forms its own belief about where a
 * prospect plays, and that belief drives the board's value (scheme fit,
 * positional premium, need). Three outcomes:
 *
 *   - IDENTIFIED — a real conversion the team sees → values him at the true spot.
 *   - MISSED     — a real conversion the team doesn't see → values him as what he
 *                  looks like at his college spot (the missed-conversion discount).
 *   - INVENTED   — a non-converter a needy team talks itself into moving → values
 *                  him at a spot he doesn't actually fit (the reach).
 *
 * Identification is driven by scout quality + whether the team's NEED primes the
 * move, and (Living Voice "opinions too") rides `voiceSeed`: the same world's
 * conversions get seen or missed differently each playthrough. When no voice
 * channel is supplied (legacy / test callers) the read is omniscient — identical
 * to the pre-feature behavior, so only voice-seeded live boards diverge.
 */

import type { Prng } from '../prng/index.js';
import type { Position } from '../types/enums.js';
import type { ArchetypeId } from '../types/player.js';
import type { CollegePlayer } from '../types/college.js';
import { convertiblePositions } from '../players/position-conversion.js';
import { getArchetypesForPosition } from '../archetypes/index.js';

/** Mirrors `board.ts` MIN_CONVERSION_PRESSURE — a need this real to prime a move. */
const MIN_CONVERSION_PRESSURE = 0.6;

// Identification of a REAL conversion: baseline + scout quality + need priming.
const ID_BASE = 0.5;
const ID_SCOUT = 0.35;
const ID_NEED = 0.15;
const ID_MIN = 0.3;
const ID_MAX = 0.96;
// Invention of a conversion that ISN'T there: low, need-driven, damped by good
// scouting (a sharp staff doesn't force a square peg into a round hole).
const INVENT_BASE = 0.1;
const INVENT_SCOUT_DAMP = 0.5;

export type PerceivedKind = 'natural' | 'identified' | 'missed' | 'invented';

export interface PerceivedProjection {
  /** Where THIS team believes the prospect projects (drives board value). */
  position: Position;
  /** The archetype the team evaluates him as (valid for `position`). */
  archetype: ArchetypeId;
  /** The team perceives a move off his college position (real or imagined). */
  sawConversion: boolean;
  kind: PerceivedKind;
}

export interface PerceiveParams {
  /** Team's mean college-scout accuracy, 0..1. */
  scoutSkill: number;
  /** Per-position need pressure for the team (primes / invents moves). */
  needPressure?: Readonly<Record<Position, number>> | undefined;
  /** Voice channel (seed by `voiceSeed` + team + prospect). Omit → omniscient. */
  prng?: Prng | undefined;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Form one team's perceived projection for one prospect. Deterministic given
 * the supplied `prng` (which the caller seeds off `voiceSeed`). With no `prng`
 * the read is omniscient (true projection) — the legacy path.
 */
export function perceiveProjection(prospect: CollegePlayer, p: PerceiveParams): PerceivedProjection {
  const natural = prospect.collegePosition;
  const trueProj = prospect.nflProjectedPosition;
  const trueArch = prospect.archetype;

  // No voice channel → omniscient, exactly the pre-feature behavior.
  if (!p.prng) {
    return {
      position: trueProj,
      archetype: trueArch,
      sawConversion: prospect.isConversionCandidate,
      kind: prospect.isConversionCandidate ? 'identified' : 'natural',
    };
  }

  const need = p.needPressure;

  // A real conversion exists — does this team see it?
  if (prospect.isConversionCandidate && trueProj !== natural) {
    const primed = need && (need[trueProj] ?? 0) >= MIN_CONVERSION_PRESSURE ? ID_NEED : 0;
    const prob = clamp(ID_BASE + ID_SCOUT * p.scoutSkill + primed, ID_MIN, ID_MAX);
    if (p.prng.next() < prob) {
      return { position: trueProj, archetype: trueArch, sawConversion: true, kind: 'identified' };
    }
    // Missed — evaluates him as what he appears to be at his college spot.
    return {
      position: natural,
      archetype: prospect.assumedArchetype,
      sawConversion: false,
      kind: 'missed',
    };
  }

  // Non-converter — a needy team may invent a move to a hole on its roster.
  if (need) {
    let bestC: Position | null = null;
    let bestP = MIN_CONVERSION_PRESSURE;
    for (const c of convertiblePositions(natural)) {
      if (c === natural) continue;
      const pc = need[c] ?? 0;
      if (pc > bestP) {
        bestP = pc;
        bestC = c;
      }
    }
    if (bestC) {
      const prob = INVENT_BASE * (1 - INVENT_SCOUT_DAMP * p.scoutSkill) * Math.min(1, bestP);
      if (p.prng.next() < prob) {
        const arch = getArchetypesForPosition(bestC);
        return {
          position: bestC,
          archetype: arch.length ? p.prng.pick(arch).id : prospect.assumedArchetype,
          sawConversion: true,
          kind: 'invented',
        };
      }
    }
  }

  // Correct read of a non-converter — identical to the pre-feature path.
  return { position: trueProj, archetype: trueArch, sawConversion: false, kind: 'natural' };
}

/** Team mean college-scout accuracy (0..1) — the identification skill signal. */
export function teamScoutSkill(
  scouts: readonly { trueAccuracy: Readonly<Record<string, number>> }[],
): number {
  if (scouts.length === 0) return 0.5;
  let sum = 0;
  let n = 0;
  for (const s of scouts) {
    for (const v of Object.values(s.trueAccuracy)) {
      sum += v;
      n += 1;
    }
  }
  return n > 0 ? sum / n : 0.5;
}
