/**
 * Doc 5 dynamic situational modifiers — slice 1.
 *
 * Each team's effective pick-value chart shifts based on organizational
 * state. Per Doc 5: "Every NPC team's trade value chart shifts
 * dynamically based on organizational situation, personnel pressures,
 * and human motivations." Static chart (v0.40) is the baseline; this
 * layer applies per-team multipliers on top.
 *
 * Per North Star: modifiers are **never surfaced to the player** as
 * numbers or labels. They manifest only through observable NPC trade
 * behavior — an elderly-owner team consistently overpaying for
 * current capital, a rebuilder refusing to move down off a future
 * pick. Daniel discovers each team's chart organically.
 *
 * Slice 1 ships the framework + four modifiers. Doc 5 specifies
 * many more (hot-seat HC, GM contract status, first-year HC without
 * QB, roster-state, etc.); each is its own follow-on once the
 * supporting state lands.
 *
 *   Modifier                      | Slice 1?  | Why deferred (if not)
 *   ──────────────────────────────┼───────────┼─────────────────────────
 *   TeamPersonality baseline      | YES       |
 *   CompetitiveWindow override    | YES       |
 *   RING_CHASER + legacyMotivation| YES       |
 *   QB premium                    | YES       |
 *   Hot-seat HC                   | no        | needs HC tenure tracking
 *   First-year HC w/o QB          | no        | needs hire-date + roster lookup
 *   GM contract status            | no        | not modeled
 *   Aging franchise QB            | no        | roster analysis (later)
 *   Gaping LT hole                | no        | roster analysis (later)
 *   Excess draft capital          | no        | derive from draftPicks (later)
 *
 * Asymmetric perspective (slice 1 cap): the on-clock team's
 * modifiers drive ratio + sweetener selection in `evaluateTradeUpForPick`.
 * The trading-up team's modifiers do NOT yet shape offer
 * construction or desire — that's slice 2. The asymmetry that ships
 * in slice 1 is per-on-clock-team: a rebuilder accepts deals a
 * championship team would refuse, even from the same trading-up
 * partner.
 */

import { CompetitiveWindow } from '../types/enums.js';
import type { TeamState } from '../types/team.js';
import type { Owner, Gm, HeadCoach } from '../types/personnel.js';
import type { OwnerId, GmId, CoachId } from '../types/ids.js';
import { computeTeamPersonality } from '../personnel/team-personality.js';

/**
 * Per-team chart multipliers. Compose multiplicatively over the
 * Doc 5 base chart value. `currentMultiplier` applies when the pick
 * is current-year (yearsOut === 0); `futureMultiplier` applies for
 * any future-year pick (and stacks with `FUTURE_YEAR_DISCOUNTS`).
 */
export interface ChartModifiers {
  currentMultiplier: number;
  futureMultiplier: number;
}

export const NEUTRAL_MODIFIERS: ChartModifiers = {
  currentMultiplier: 1.0,
  futureMultiplier: 1.0,
};

/**
 * QB premium applied to the current-year pick value when the target
 * prospect is a QB. Doc 5: "When a QB is the clear target of a
 * trade-up, the acquiring team's chart value threshold increases by
 * 25-50% depending on GM personality and desperation level."
 *
 * Slice 1: flat 30% (mid-range of Doc 5's 25-50%). Both sides see
 * the inflated value (both know it's a QB pick) — the on-clock team
 * resists trading down more strongly AND the trading-up team values
 * the acquisition more highly. Per-team scaling by GM desperation
 * arrives in slice 2 alongside the hot-seat/GM-contract modifiers.
 */
export const QB_CURRENT_PICK_PREMIUM = 1.3;

/**
 * Compute a team's per-team chart modifiers from their organizational
 * state. Pure function — no PRNG. Cheap enough to call inline; tests
 * call it directly with hand-built inputs.
 *
 * Returns `NEUTRAL_MODIFIERS` when any required organizational
 * reference is missing (defensive — a migrated league with broken
 * personnel pointers shouldn't crash the draft).
 */
export function computeChartModifiers(
  team: TeamState,
  owners: Readonly<Record<OwnerId, Owner>>,
  gms: Readonly<Record<GmId, Gm>>,
  coaches: Readonly<Record<CoachId, HeadCoach>>,
): ChartModifiers {
  const owner = owners[team.ownerId];
  const gm = gms[team.gmId];
  const hc = coaches[team.headCoachId];
  if (!owner || !gm || !hc) return NEUTRAL_MODIFIERS;

  const tp = computeTeamPersonality(owner, gm, hc, team.fanBase);

  let current = 1.0;
  let future = 1.0;

  // ── TeamPersonality baseline (smooth, 1..10 inputs) ─────────────
  // championshipUrgency above 5 inflates current + deflates future.
  // patienceLevel above 5 inflates future + slightly deflates current.
  // Magnitudes chosen so neither dimension can produce >±30% drift on
  // its own — the discrete modifiers below own the bigger swings.
  const urgencyDelta = (tp.championshipUrgency - 5) * 0.03;
  const patienceDelta = (tp.patienceLevel - 5) * 0.04;
  current *= 1 + urgencyDelta - patienceDelta * 0.4;
  future *= 1 - urgencyDelta * 0.7 + patienceDelta;

  // ── CompetitiveWindow override ──────────────────────────────────
  // Multiplies on top of the personality baseline. CHAMPIONSHIP +
  // CONTENDER lean win-now; RETOOLING + REBUILDING lean future.
  // STAGNANT + EMERGING stay neutral — they could break either way
  // and Doc 5 doesn't pin a direction.
  switch (team.competitiveWindow) {
    case CompetitiveWindow.CHAMPIONSHIP:
      current *= 1.1;
      future *= 0.65;
      break;
    case CompetitiveWindow.CONTENDER:
      current *= 1.05;
      future *= 0.8;
      break;
    case CompetitiveWindow.RETOOLING:
      current *= 0.95;
      future *= 1.1;
      break;
    case CompetitiveWindow.REBUILDING:
      current *= 0.85;
      future *= 1.25;
      break;
    case CompetitiveWindow.EMERGING:
    case CompetitiveWindow.STAGNANT:
      // Neutral — no overlay.
      break;
  }

  // ── Owner RING_CHASER + high legacyMotivation ───────────────────
  // Doc 5: "Elderly owner chasing a championship — one of the most
  // exploitable situations in the game." We don't model literal age,
  // but the RING_CHASER quirk + legacyMotivation ≥ 8 is the
  // motivational pattern Doc 5 actually cares about. The "+5 / -30%
  // future" overlay reflects Doc 5's "future picks treated as nearly
  // free capital."
  const isRingChaser = owner.quirks.includes('RING_CHASER');
  const highLegacy = owner.spectrums.legacyMotivation >= 8;
  if (isRingChaser && highLegacy) {
    future *= 0.7;
    current *= 1.1;
  } else if (isRingChaser || highLegacy) {
    future *= 0.85;
    current *= 1.05;
  }

  return {
    currentMultiplier: round2(current),
    futureMultiplier: round2(future),
  };
}

/**
 * Apply per-team modifiers + the QB-target premium to a base
 * Doc 5 chart value. Composes:
 *
 *   pickValueForTeam = base × (current|future)Multiplier
 *                          × (isQbTarget ? QB_PREMIUM : 1)   (current-year only)
 *
 * The QB premium applies only to the current-year pick that lands
 * the QB. Future picks used as sweetener in a QB trade-up don't get
 * the QB premium — they're compensation, not the QB-acquiring asset.
 */
export function pickValueForTeam(
  baseValue: number,
  modifiers: ChartModifiers,
  yearsOut: number,
  isQbTarget: boolean,
): number {
  if (yearsOut === 0) {
    let v = baseValue * modifiers.currentMultiplier;
    if (isQbTarget) v *= QB_CURRENT_PICK_PREMIUM;
    return v;
  }
  return baseValue * modifiers.futureMultiplier;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
