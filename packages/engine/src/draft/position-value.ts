/**
 * Positional draft value (v0.91).
 *
 * Not every position is worth the same draft capital. A rookie contract is
 * a **slot-based, position-independent** cost (the #1 pick costs the same
 * whether he's a QB or a guard — see the CBA rookie wage scale), so the
 * VALUE of a draft pick at a position is its *surplus*: the open-market
 * price of that position's production minus the fixed slot cost. Because
 * the slot cost is the same across positions, surplus — and therefore
 * draft value — tracks the open-market price of the position.
 *
 * Open-market top APY by position (Over The Cap, 2025 — fetched directly),
 * which anchors the spread below:
 *
 *   QB ~$55M · EDGE ~$50M · WR ~$42M · iDL/DT ~$32M · CB ~$31M ·
 *   OT ~$30M (Tunsil/Sewell) · S ~$25M · G ~$24M · LB ~$21M ·
 *   RB ~$20.6M · TE ~$19M · C ~$18M (one $27M outlier) ·
 *   K ~$7M · P ~$4M · FB ~$3.8M · LS ~$1.8M
 *
 * Rookie wage scale (CBA, fetched from spotrac/coverage): purely SLOT-
 * based and POSITION-INDEPENDENT — the #1 pick signs the same ~$48.7M /
 * 4yr (~$12.2M/yr) whether he's a QB or a guard; ~$6-9.6M total in round
 * 2. Because the slot cost is identical across positions, draft surplus
 * (market value − slot cost) ranks positions the same way market value
 * does — it just widens the gap at the top. A franchise QB on a rookie
 * deal is ~$43M/yr of surplus; a top safety ~$13M/yr; a back-end RB/TE
 * barely clears the slot cost — which is *why* you don't spend a premium
 * pick on them. So the rookie scale doesn't reorder the table below; it's
 * the justification for the premium, and the reason the replaceable spots
 * sit well under 1.0.
 *
 * The multipliers below DON'T copy veteran APY 1:1 — they fold in
 * draft-specific positional value (blindside-tackle premium; how
 * replaceable / scheme-dependent / draftable-late a position is) per
 * Daniel's model. The result: a heavy premium on QB / EDGE / LT, a
 * moderate one on WR / CB / interior-DL / RT / guards, and the lightest
 * on the replaceable spots (RB, nose tackle, C, LB, S, nickel, TE) —
 * without fully devaluing any of them (floor well above zero).
 *
 * (Interior DL tracks the market here rather than Daniel's original
 * "lightest" suggestion: top-tier 3-techs are paid like premium players,
 * so a blue-chip interior pass-rusher warrants a high pick.)
 *
 * 1.0 = neutral. Used as a multiplier on roster need (`team-needs.ts`)
 * and, compressed, as a shading factor on the draft board's talent
 * signal (`board.ts`) so premium positions out-rank equal-graded
 * non-premium ones — i.e. nobody takes a safety in the top 5-10 over a
 * comparable QB/edge/tackle.
 */

import type { Position } from '../types/enums.js';

export const POSITION_DRAFT_VALUE: Readonly<Record<Position, number>> = {
  // Heaviest — franchise cornerstones; the surplus on a rookie deal is
  // enormous (QB) or protects/creates the biggest swings (EDGE, blindside).
  QB: 1.6,
  EDGE: 1.4,
  LT: 1.3,
  // Moderate — valuable and worth high picks, but deeper talent pools /
  // more replaceable than the cornerstones. DT sits here (not in the
  // light tier) because the open market pays interior pass-rushers like
  // premium players — top-5 iDL APY ~$27.5M, right alongside CB (~$28M)
  // and tackle (~$29M), and far above guards/safeties/LBs. (Run-stuffing
  // nose tackles are a separate, cheap position — see NT below.)
  WR: 1.12,
  CB: 1.1,
  DT: 1.05,
  RT: 1.05,
  RG: 1.0,
  LG: 1.0,
  // Lightest — real contributors, but the most replaceable, scheme-
  // dependent, or cheapest on the open market. Not devalued to zero;
  // an elite one still has clear value.
  S: 0.88,
  TE: 0.88,
  C: 0.88,
  ILB: 0.82,
  OLB: 0.82,
  NICKEL: 0.82,
  NT: 0.8,
  RB: 0.78,
  // Specialists — rarely worth meaningful draft capital.
  FB: 0.55,
  K: 0.6,
  P: 0.55,
  LS: 0.5,
};

/**
 * How strongly positional value shades the draft BOARD's talent signal.
 * The full need-side multiplier (above) would make every board QB-QB-QB
 * at the top and erase team-to-team divergence, so the board uses a
 * compressed version: `1 + (value - 1) * BOARD_PREMIUM_STRENGTH`. Tuning
 * knob — raise to push premium positions earlier, lower to let raw talent
 * dominate.
 */
export const BOARD_PREMIUM_STRENGTH = 0.15;

/**
 * Compressed positional factor applied multiplicatively to a prospect's
 * observed talent on the draft board. ~0.75 (specialists) … ~1.30 (QB).
 */
export function boardPositionalFactor(position: Position): number {
  const value = POSITION_DRAFT_VALUE[position];
  return 1 + (value - 1) * BOARD_PREMIUM_STRENGTH;
}
