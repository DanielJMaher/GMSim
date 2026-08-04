import { Position } from '../types/enums.js';

/**
 * Static 53-man roster position blueprint. Each entry is "give the team
 * `count` players at this position." Total counts must sum to 53.
 *
 * This is a starting blueprint applied uniformly to all 32 teams.
 * Scheme-specific roster shapes (e.g., 3-4 teams carrying more NTs and
 * fewer 4-3 DTs) can be layered on later as a transform that swaps
 * counts before generation.
 */
export interface RosterPositionSlot {
  position: Position;
  count: number;
}

export const ROSTER_BLUEPRINT_53: readonly RosterPositionSlot[] = [
  // Skill positions (16)
  { position: Position.QB, count: 3 },
  { position: Position.RB, count: 3 },
  { position: Position.FB, count: 1 },
  { position: Position.WR, count: 6 },
  { position: Position.TE, count: 3 },
  // OL (10)
  { position: Position.LT, count: 2 },
  { position: Position.LG, count: 2 },
  { position: Position.C, count: 2 },
  { position: Position.RG, count: 2 },
  { position: Position.RT, count: 2 },
  // DL (8)
  { position: Position.EDGE, count: 4 },
  { position: Position.DT, count: 3 },
  { position: Position.NT, count: 1 },
  // LB (6)
  { position: Position.ILB, count: 3 },
  { position: Position.OLB, count: 3 },
  // DB (10)
  { position: Position.CB, count: 5 },
  { position: Position.S, count: 4 },
  { position: Position.NICKEL, count: 1 },
  // ST (3)
  { position: Position.K, count: 1 },
  { position: Position.P, count: 1 },
  { position: Position.LS, count: 1 },
] as const;

export const ROSTER_SIZE = ROSTER_BLUEPRINT_53.reduce((s, p) => s + p.count, 0);

/**
 * How many STARTER-CALIBRE (tier STAR or STARTER) players a team actually
 * wants at a position — the quality analogue of `ROSTER_BLUEPRINT_53`, which
 * is a roster-SHAPE number (how many bodies you carry).
 *
 * Talent Allocation slice (2026-07-30, `docs/design-docs/TALENT_ALLOCATION.md`).
 * Before this, `proactive-trades.ts` used the blueprint COUNT as the quality
 * target: a team "needed" a QB unless it had THREE starter-calibre QBs, and
 * could only register surplus worth selling with MORE than three. Measured
 * against the Madden corpus 2018-2024 at top-40% selectivity (= the engine's
 * own STAR/STARTER tier rate), that over-demanded starter-calibre players by
 * **1.7-2.6x at every position** — real teams carry ~27.7 of them, the engine
 * targeted 53. Consequence at QB: rooms held >=2 starter-calibre QBs 23.3% of
 * the time vs a real 4.7%, and the QB1-QB2 gap ladder read 0.98 (pure i.i.d.
 * order statistics) against a real 1.88.
 *
 * DERIVATION DISCIPLINE — the real bar is measured at POSITION-GROUP level
 * (Madden's position labels are inconsistent across years: `LCB`/`RCB`/`CB`/
 * `DB` all appear, so per-fine-position real numbers are not trustworthy).
 * The within-group split below is an explicit MODELLING CHOICE informed by how
 * many players actually start at each spot; **the group SUM is the quantity
 * validated against the real bar.** Do not mistake the split for a measurement.
 *
 * Group sums vs measured real (every group within +/-0.55; total 26 vs 27.7 —
 * deliberately a touch UNDER, since the failure mode being corrected is
 * over-demand and erring low is the safe direction):
 *
 *   qb 1/1.15 · rb 2/2.24 · wr 3/3.37 · te 2/1.74 · ol 5/4.67
 *   dl 4/4.40 · lb 3/3.32 · db 5/5.54 · st 1/1.25
 *
 * A target of 0 (FB, NT, P, LS) means "never registers as a quality need" —
 * teams will not spend acquisition capital there. Intended and realistic.
 * Roster SHAPE is unaffected: the blueprint still governs how many bodies a
 * team carries, and the vet-min fill-up / practice-squad paths still fill those
 * slots. This constant governs only whether a team reads as NEEDING QUALITY.
 *
 * Validated by: `_qbroom_d2_allocation.mjs` (ladder ratio, clustering rate),
 * the Barterer (trade volume — this moves both demand and supply sides), the
 * Goatinator QB dual-gate, and `roster-blueprint.test.ts`'s group-sum check.
 */
export const QUALITY_DEPTH_TARGET: Readonly<Record<Position, number>> = {
  [Position.QB]: 1,
  [Position.RB]: 2,
  [Position.FB]: 0,
  [Position.WR]: 3,
  [Position.TE]: 2,
  [Position.LT]: 1,
  [Position.LG]: 1,
  [Position.C]: 1,
  [Position.RG]: 1,
  [Position.RT]: 1,
  [Position.EDGE]: 2,
  [Position.DT]: 2,
  [Position.NT]: 0,
  [Position.ILB]: 1,
  [Position.OLB]: 2,
  [Position.CB]: 2,
  [Position.S]: 2,
  [Position.NICKEL]: 1,
  [Position.K]: 1,
  [Position.P]: 0,
  [Position.LS]: 0,
} as const;
