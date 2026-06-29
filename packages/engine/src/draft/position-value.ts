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

// ─── Recalibration to DRAFT CAPITAL (v0.163, 2026-06-17) ─────────────────────
//
// The table below was re-derived from BOTH the original APY/surplus study AND
// the Goatinator's real top-of-draft data, after a multi-lever investigation
// (slot-premium, talent-pyramid, and need levers were each measured and ruled
// out). The old table was pure VETERAN APY; the recalibration blends APY (which
// still sets the within-tier ORDER) with the real DRAFT position-mix (top-10
// 2011-2026: QB 22% · OL 19% · EDGE 14% · WR 14% · DB 11% · LB 8% · RB 6% ·
// iDL 4% · TE 3%) and COMPRESSES the spread, because:
//
//   • The rookie wage scale makes draft capital far more position-agnostic than
//     veteran APY — an elite player at ANY position is huge surplus on a rookie
//     deal, so real teams DO spend top-10 picks on RBs (Bijan #8, Saquon #2) and
//     off-ball LBs. The old 0.78/0.82 values buried them; raised toward ~0.9.
//   • EDGE APY (~$50M) is second only to QB, but edges are PLENTIFUL — the
//     Goatinator showed GMSim drafting them at ~25% of the top 10 vs a real 14%
//     (the lone position DRIFT), because the high value vaulted the deep elite-
//     edge supply up the board's top-10 grade×value ranking, which picks track.
//     The marginal edge commands less DRAFT capital than its APY implies →
//     EDGE drops from the runaway #2 (1.4) to ≈ WR, below the blindside tackle.
//   • OL is the 2nd-most-drafted GROUP (19%) yet ran UNDER; tackles stay premium
//     (LT blindside) and RT/C come up.
//
// LG/RG are pinned at the 1.0 neutral anchor (the board factor's identity
// point). Verified against the Goatinator top-10 mix + #1-QB share + the Truth
// Arbiter class-talent board; this is the top-of-draft FEEL knob the prior
// APY-only comment flagged as a separate lever.
export const POSITION_DRAFT_VALUE: Readonly<Record<Position, number>> = {
  // Cornerstone — the one position whose surplus dwarfs all others.
  QB: 1.55,
  // Premium — blindside tackle leads the field (OL is drafted heavily and the
  // LT premium is real); EDGE is the premium non-OL spot, above interior DL/OL
  // but below the blindside tackle.
  LT: 1.3,
  EDGE: 1.18,
  // WR trimmed below EDGE (v0.167): at 1.18 (= EDGE) the DRAFT over-reached WR
  // to ~17-19% of the top-10 (real 14%) on skill-position need pressure, while
  // the board only ranks ~11% WR there — the gap is a need-driven reach the
  // value scale should not amplify, so WR drops toward the receiving-market APY.
  WR: 1.12,
  RT: 1.12,
  // Moderate — worth high picks, deeper pools / more replaceable. iDL tracks
  // the market (top-5 iDL APY ~$27.5M) alongside CB; interior guards anchor the
  // 1.0 neutral.
  CB: 1.05,
  DT: 1.05,
  LG: 1.0,
  RG: 1.0,
  // Draftable-but-replaceable — compressed UP toward neutral vs the old table,
  // because rookie-scale economics make an elite one a real top-pick target
  // (the Bijan/Roquan reality), not the near-floor the veteran market implies.
  // NB: RB/TE stay BELOW neutral by design (replaceable) — the test pins their
  // board factor < 1. Their top-10 under-ranking (board ~1%/0% vs real 6%/3%)
  // is a perceived-skill cap on elite ball-carriers/move-TEs, not a value gap;
  // the value scale can't lift it without making RB a premium position.
  C: 0.95,
  ILB: 0.95,
  OLB: 0.92,
  RB: 0.9,
  S: 0.9,
  TE: 0.9,
  NICKEL: 0.85,
  NT: 0.8,
  // Specialists — rarely worth meaningful draft capital.
  K: 0.6,
  FB: 0.55,
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

// ─── Slot-aware premium (v0.143 — the Goatinator finding) ────────────────
//
// Boards are talent rankings and stay lightly shaded (above) so they keep
// team-to-team divergence. But the PICK at a premier slot is a surplus-value
// decision, not BPA: real #1 overalls are 75% QBs, and nobody has spent one
// on a guard or a safety in the wage-scale era. The Goatinator measured
// GMSim's #1 at 23% QB with DBs going first 16% of the time — because the
// board's ×1.09-compressed QB factor lets raw talent win the top slots.
//
// At pick time the decision loop re-ranks its top remaining board entries
// with positional value at a SLOT-DEPENDENT strength: full surplus thinking
// at #1 overall, decaying linearly back to the board's baseline by
// `SLOT_PREMIUM_DECAY_END_PICK` — beyond that, behavior is exactly the old
// take-your-board-order. Calibrated against the Goatinator's real bar
// (top-10 mix + #1/#2/#3 QB share).

/** Positional strength applied at #1 overall (1.0 = full POSITION_DRAFT_VALUE). */
export const SLOT_PREMIUM_FULL_STRENGTH = 1.0;

/** Overall pick where the slot premium has fully decayed to the board baseline. */
export const SLOT_PREMIUM_DECAY_END_PICK = 40;

/**
 * Exponential decay constant (in picks). The premium must fade FAST: a
 * linear decay held ~80% strength at pick 10 and the calibration run
 * showed QB/EDGE flooding the entire top 10 (+12/+17pp) while LB/RB/TE
 * dropped to zero — real drafts still spend picks 4-10 on the Sauce
 * Gardners and Bijan Robinsons. τ=5 keeps full GOAT thinking at 1-3
 * (~72% strength at #3) but is down to ~27% by pick 10.
 */
export const SLOT_PREMIUM_DECAY_TAU = 5;

/** Positional shading strength in effect when picking at `overallPick`. */
export function slotPremiumStrength(overallPick: number): number {
  if (overallPick <= 1) return SLOT_PREMIUM_FULL_STRENGTH;
  if (overallPick >= SLOT_PREMIUM_DECAY_END_PICK) return BOARD_PREMIUM_STRENGTH;
  const decayed =
    BOARD_PREMIUM_STRENGTH +
    (SLOT_PREMIUM_FULL_STRENGTH - BOARD_PREMIUM_STRENGTH) *
      Math.exp(-(overallPick - 1) / SLOT_PREMIUM_DECAY_TAU);
  return decayed;
}

/**
 * How much of the slot premium NON-QB positions receive (v0.155). QB now
 * has its own dedicated top-slot path (`qbRevealedSlotBoost` / graded
 * desire), so `slotAwarePickBoost` only ever shades non-QB positions — and
 * the Goatinator showed EDGE flooding the top 10 (35% of picks vs real 14%)
 * NOT on talent but on premium: the EDGE-oversupply probe found only 21% of
 * top-10 edges were their team's board #1 (mean board rank 3.8), i.e. the
 * 1.4 value was vaulting board-rank-4 edges over board-top non-premium
 * prospects. Real GMs take one blue-chip edge near the top, not three. This
 * factor (0.5) halves the non-QB premium spread so edges go closer to
 * board-talent order; OL/WR/DB — which the probe showed win at board #1, on
 * talent, not premium — barely move (they weren't riding the premium). QB
 * is unaffected (separate path). */
export const SLOT_PREMIUM_NONQB_FACTOR = 0.5;

/**
 * Pick-time multiplier applied ON TOP of a board entry's priority (which
 * already carries the compressed `boardPositionalFactor`): the EXTRA
 * positional strength this slot demands beyond the board baseline, so the
 * composed weight ≈ `1 + (value − 1) × slotPremiumStrength × nonQbFactor`.
 * Returns 1.0 for every position once the decay window ends — pick order
 * beyond `SLOT_PREMIUM_DECAY_END_PICK` is untouched.
 */
export function slotAwarePickBoost(position: Position, overallPick: number): number {
  const value = POSITION_DRAFT_VALUE[position] ?? 1.0;
  const extra = Math.max(0, slotPremiumStrength(overallPick) - BOARD_PREMIUM_STRENGTH);
  // QB routes through its own boost (qbRevealedSlotBoost) in the pick loop;
  // when this is called for QB (the graded-desire path beyond the GOAT
  // window) keep full strength, else damp to the non-QB factor.
  const factor = position === 'QB' ? 1 : SLOT_PREMIUM_NONQB_FACTOR;
  return 1 + (value - 1) * extra * factor;
}

// ─── QB-room gate on the slot premium (v0.145 — need-aware surplus) ──────
//
// The slot premium is a SURPLUS argument, and the QB surplus only exists
// where the roster has the hole: real #1 overalls are 75% QBs because the
// teams picking there are QB-desperate, not because surplus overrides a
// filled QB room. No team with an established starter has spent a top-8
// pick on a QB in the wage-scale era (succession swings — Love, Hurts —
// happen at pick 26+/round 2). The pick loop therefore applies the QB
// boost only to QB-needy teams (`hasDesperateQbNeed`, the same condition
// that gates the QB reach); a SETTLED team's QB entries are instead
// dampened inside the premier window, so a board-topping QB routes to the
// trade-up market (the desperate team below pays up) instead of becoming
// a redundant pick. Non-QB premiums stay need-blind — real teams do take
// BPA EDGE/LT while stacked.
export const QB_SETTLED_DAMPEN = 0.6;
export const QB_SETTLED_DAMPEN_END_PICK = 8;

/** Pick-time QB factor for a team that already has its quarterback. */
export function qbSettledPickFactor(overallPick: number): number {
  return overallPick <= QB_SETTLED_DAMPEN_END_PICK ? QB_SETTLED_DAMPEN : 1.0;
}

// ─── Revealed top-slot QB preference (v0.152) ────────────────────────────
//
// POSITION_DRAFT_VALUE.QB = 1.6 prices the APY-surplus argument, but the
// REVEALED preference at the top of real drafts is stronger: 75% of #1
// overalls are QBs, Carolina took Young over Anderson with Anderson the
// consensus better prospect, and three-firsts trade-up packages exist only
// for QBs. v0.151 fixed QB supply at the top of the class (top-10 volume
// on the real bar) yet the #1 slot still went EDGE — the 1.6/1.4 ratio
// makes a full-desire team need its QB within ~87% of the top EDGE's
// priority. A FULL-desire team (no answer at QB, or a bottom-half room)
// weighs QBs at this value instead; graded/settled teams are untouched.
export const QB_REVEALED_SLOT_VALUE = 2.0;

/** Pick past which the revealed QB boost fades to board-neutral (v0.167). The
 *  #1-3 QB slot decay (75/44/25) is set by the Rosen rule; beyond the premier
 *  window the revealed boost over-pushed QBs at picks 4-10, lifting top-10 QB
 *  volume to ~27% vs real ~22%. */
const QB_REVEALED_FADE_END_PICK = 7;

/** Slot boost for a full-desire team's QB candidates — same decay as the
 *  regular premium, stronger value (~1.85 at #1). Held full through the premier
 *  window (picks 1-3, where the #1-QB share is calibrated) then FADED to
 *  board-neutral by pick 7, so a QB-needy mid-first-round team is selective —
 *  it takes a passer only if he's clearly its best board value, matching the
 *  real picks-4-10 QB rate (~0.11/slot) instead of over-drafting (~0.19). */
export function qbRevealedSlotBoost(overallPick: number): number {
  const extra = Math.max(0, slotPremiumStrength(overallPick) - BOARD_PREMIUM_STRENGTH);
  const boost = 1 + (QB_REVEALED_SLOT_VALUE - 1) * extra;
  if (overallPick <= 3) return boost;
  const fade = Math.max(0, 1 - (overallPick - 3) / (QB_REVEALED_FADE_END_PICK - 3));
  return 1 + (boost - 1) * fade;
}
