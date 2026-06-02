/**
 * Per-position athletic baselines (player-model overhaul Slice 3, 2026-06-02).
 *
 * The pre-Slice-3 generation rolled physical attributes (speed, strength, …)
 * off TALENT GRADE alone, so a STAR DT was as fast as a STAR CB — there was no
 * size/position physical tradeoff (the Adjudicator measured strength↔speed at
 * +0.61; real NFL is strongly NEGATIVE). This module supplies position-specific
 * ABSOLUTE baselines so a CB is fast-and-light and a DT is slow-and-strong, and
 * the tradeoff falls out automatically.
 *
 * Source: per-position means from the open nflverse combine dataset (2000-2026,
 * ~9k players — the same raw measurables ras.football's RAS is built on; see
 * `truth-arbiter run ras`). The mean measurables are stored here and converted
 * to 0-100 attribute baselines by the functions below (global, so attributes
 * stay absolute and cross-position comparable). Within-position variation comes
 * from the per-player athleticism latent (a reproduced RAS) in `rollSkills`.
 */

import { Position } from '../types/enums.js';

interface CombineMean {
  forty: number;
  bench: number;
  vertical: number;
  cone: number;
  shuttle: number;
}

// Per-position combine means (nflverse 2000-2026). Engine positions the combine
// doesn't separate are derived: LT/RT←OT, LG/RG←OG, NT←DT (heavier/slower),
// NICKEL←CB (smaller/quicker). K/P/LS use specialist norms (no 3-cone/shuttle →
// reuse a neutral agility).
const POS_COMBINE_MEAN: Record<Position, CombineMean> = {
  [Position.QB]: { forty: 4.8, bench: 19.3, vertical: 31.4, cone: 7.2, shuttle: 4.3 },
  [Position.RB]: { forty: 4.5, bench: 19.4, vertical: 34.5, cone: 7.1, shuttle: 4.3 },
  [Position.FB]: { forty: 4.8, bench: 23.0, vertical: 32.8, cone: 7.3, shuttle: 4.4 },
  [Position.WR]: { forty: 4.5, bench: 14.7, vertical: 35.5, cone: 7.0, shuttle: 4.2 },
  [Position.TE]: { forty: 4.8, bench: 20.3, vertical: 33.3, cone: 7.2, shuttle: 4.4 },
  [Position.LT]: { forty: 5.2, bench: 24.4, vertical: 28.4, cone: 7.8, shuttle: 4.8 },
  [Position.RT]: { forty: 5.2, bench: 24.4, vertical: 28.4, cone: 7.8, shuttle: 4.8 },
  [Position.LG]: { forty: 5.3, bench: 25.6, vertical: 28.0, cone: 7.9, shuttle: 4.8 },
  [Position.RG]: { forty: 5.3, bench: 25.6, vertical: 28.0, cone: 7.9, shuttle: 4.8 },
  [Position.C]: { forty: 5.2, bench: 26.2, vertical: 28.5, cone: 7.7, shuttle: 4.6 },
  [Position.EDGE]: { forty: 4.8, bench: 23.7, vertical: 33.4, cone: 7.3, shuttle: 4.4 },
  [Position.DT]: { forty: 5.1, bench: 27.2, vertical: 29.6, cone: 7.7, shuttle: 4.6 },
  [Position.NT]: { forty: 5.25, bench: 28.5, vertical: 27.5, cone: 7.9, shuttle: 4.7 },
  [Position.ILB]: { forty: 4.8, bench: 22.4, vertical: 33.2, cone: 7.2, shuttle: 4.3 },
  [Position.OLB]: { forty: 4.7, bench: 22.0, vertical: 34.6, cone: 7.1, shuttle: 4.3 },
  [Position.CB]: { forty: 4.5, bench: 14.5, vertical: 36.1, cone: 6.9, shuttle: 4.2 },
  [Position.S]: { forty: 4.6, bench: 16.7, vertical: 35.7, cone: 7.0, shuttle: 4.2 },
  [Position.NICKEL]: { forty: 4.5, bench: 14.0, vertical: 36.3, cone: 6.85, shuttle: 4.15 },
  [Position.K]: { forty: 4.9, bench: 15.2, vertical: 33.5, cone: 7.3, shuttle: 4.4 },
  [Position.P]: { forty: 4.9, bench: 16.0, vertical: 31.6, cone: 7.2, shuttle: 4.4 },
  [Position.LS]: { forty: 5.0, bench: 16.9, vertical: 29.3, cone: 7.4, shuttle: 4.5 },
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Measurable → 0-100 attribute conversions. Calibrated so the league's fast/
// strong positions land high and trench positions land low, on an absolute
// (cross-position) scale: e.g. forty 4.25 ≈ 99 speed, 5.30 ≈ 63.
function speedFromForty(t: number): number {
  return clamp(99 - (t - 4.25) * 34, 20, 99);
}
function strengthFromBench(b: number): number {
  return clamp(55 + (b - 14.5) * 2.6, 20, 99);
}
function agilityFromCone(c: number): number {
  return clamp(96 - (c - 6.8) * 32, 20, 99);
}
function codFromShuttle(s: number): number {
  return clamp(96 - (s - 4.1) * 48, 20, 99);
}
function jumpFromVert(v: number): number {
  return clamp(55 + (v - 28) * 3.2, 20, 99);
}

export interface AthleticBaseline {
  speed: number;
  acceleration: number;
  agility: number;
  changeOfDirection: number;
  jumping: number;
  strength: number;
}

/** Engine attributes that are baselined off POSITION (not talent grade). */
export const POSITION_BASELINED_SKILLS: ReadonlySet<string> = new Set([
  'speed',
  'acceleration',
  'agility',
  'changeOfDirection',
  'jumping',
  'strength',
]);

function baselineFor(m: CombineMean): AthleticBaseline {
  const speed = speedFromForty(m.forty);
  return {
    speed,
    // Acceleration tracks the 40 too (we lack the 10-yd split); a hair above
    // top speed, capped.
    acceleration: clamp(speed + 2, 20, 99),
    agility: agilityFromCone(m.cone),
    changeOfDirection: codFromShuttle(m.shuttle),
    jumping: jumpFromVert(m.vertical),
    strength: strengthFromBench(m.bench),
  };
}

const ATHLETIC_BASELINE: Record<Position, AthleticBaseline> = Object.fromEntries(
  (Object.keys(POS_COMBINE_MEAN) as Position[]).map((p) => [p, baselineFor(POS_COMBINE_MEAN[p])]),
) as Record<Position, AthleticBaseline>;

/** Position's absolute athletic baseline (mean) for the physical attributes. */
export function athleticBaseline(position: Position): AthleticBaseline {
  return ATHLETIC_BASELINE[position];
}
