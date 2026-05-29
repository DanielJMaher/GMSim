/**
 * Draft provenance / backstory synthesis (v0.92).
 *
 * Generated players (league creation, retirement-replacement vets) need a
 * plausible draft *history* so the rest of the sim can reason about
 * pedigree: was this 24-year-old QB a first-round pick the team is
 * building around, or a 6th-rounder who's just a body? That distinction
 * drives roster needs (a recent 1st-round QB suppresses QB need; a
 * late-round one doesn't), and feeds narrative ("former top-10 bust",
 * "undrafted gem").
 *
 * The synthesis correlates draft round with talent **tier** (a STAR was
 * probably drafted early; a FRINGE late or undrafted) with deliberate
 * spread so the league has gems (late picks who turned into stars) and
 * busts (early picks stuck at backup). A mild premium-position skew pulls
 * QBs / edge / tackle / corner a touch earlier, matching how those
 * positions come off the board. Deterministic from the supplied PRNG.
 *
 * Real drafts do NOT use this — `promoteProspectToPlayer` records the
 * actual pick. This is only for players who enter the league already
 * "having been drafted" in some prior, unsimulated season.
 */

import type { Prng } from '../prng/index.js';
import type { Position } from '../types/enums.js';
import type { TalentTier } from '../types/player.js';
import { POSITION_DRAFT_VALUE } from '../draft/position-value.js';

export interface DraftProvenance {
  /** 1–7, or null for undrafted (UDFA). */
  round: number | null;
  /** Overall slot 1..~224, or null for undrafted. */
  overallPick: number | null;
}

/** 7 rounds × 32 picks ≈ the modern draft. */
const PICKS_PER_ROUND = 32;
const ROUNDS = 7;

/**
 * Per-tier round weights. Index 0..6 = rounds 1..7; index 7 = UDFA.
 * Loose enough to leave room for gems (a STAR who slid) and busts.
 */
const TIER_ROUND_WEIGHTS: Record<TalentTier, readonly number[]> = {
  //          R1  R2  R3  R4  R5  R6  R7  UDFA
  STAR: [55, 18, 10, 6, 4, 3, 2, 2],
  STARTER: [22, 22, 18, 13, 9, 6, 5, 5],
  BACKUP: [6, 10, 14, 16, 16, 14, 12, 12],
  FRINGE: [2, 4, 7, 10, 14, 16, 17, 30],
};

/**
 * Premium-position skew: high draft-value positions (QB, EDGE, LT, CB…)
 * come off the board earlier, so shift a little weight from the late
 * rounds/UDFA into rounds 1–2. Strength scales with how far the
 * position's value sits above neutral (1.0).
 */
function applyPositionSkew(weights: number[], position: Position): number[] {
  const premium = POSITION_DRAFT_VALUE[position] - 1; // >0 premium, <0 cheap
  if (premium <= 0) return weights;
  const pull = Math.min(0.6, premium); // cap the skew
  const out = [...weights];
  // Move a fraction of the UDFA + R6/R7 mass up into R1/R2.
  const fromUdfa = out[7]! * pull;
  const fromR7 = out[6]! * pull * 0.5;
  out[7] = out[7]! - fromUdfa;
  out[6] = out[6]! - fromR7;
  out[0] = out[0]! + (fromUdfa + fromR7) * 0.6; // R1
  out[1] = out[1]! + (fromUdfa + fromR7) * 0.4; // R2
  return out;
}

/**
 * Synthesize a draft backstory for a generated player from tier +
 * position. Deterministic from `prng`.
 */
export function synthesizeDraftProvenance(
  prng: Prng,
  tier: TalentTier,
  position: Position,
): DraftProvenance {
  const weights = applyPositionSkew([...TIER_ROUND_WEIGHTS[tier]], position);
  const idx = prng.weighted(weights.map((weight, value) => ({ value, weight })));
  if (idx === ROUNDS) return { round: null, overallPick: null }; // UDFA
  const round = idx + 1;
  const slotInRound = prng.nextRange(1, PICKS_PER_ROUND + 1); // 1..32
  const overallPick = idx * PICKS_PER_ROUND + slotInRound;
  return { round, overallPick };
}

/**
 * Round → provenance for an actually-drafted player (real pick known).
 * UDFAs (no pick) map to undrafted.
 */
export function provenanceFromOverallPick(overallPick: number | null): DraftProvenance {
  if (overallPick === null || overallPick <= 0) return { round: null, overallPick: null };
  const round = Math.min(ROUNDS, Math.ceil(overallPick / PICKS_PER_ROUND));
  return { round, overallPick };
}
