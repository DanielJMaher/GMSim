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
import type { TeamState, TeamSeasonRecord } from '../types/team.js';
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
 * Optional situational context. The Doc 5 baseline modifiers
 * (TeamPersonality, CompetitiveWindow, etc.) are time-invariant; this
 * struct carries the calendar-aware overlays that flip on for a
 * specific tick (trade deadline week, etc.).
 */
export interface ChartModifierContext {
  /**
   * v0.58 trade-deadline urgency. When `true`, contenders inflate
   * current-pick value further (overpaying for vets) and rebuilders
   * deflate current-pick value further (accepting cheaper returns).
   * Future-pick values are NOT touched — the deadline pressure is
   * about converting current capital, not shifting horizons.
   */
  isTradeDeadlineWeek?: boolean;
}

const NEUTRAL_CONTEXT: ChartModifierContext = {};

/**
 * Doc 5 trade-deadline urgency overlay (v0.58). Active for one
 * regular-season tick — the week leading up to the NFL trade deadline
 * (Tuesday after Week 8). The asymmetric pressure that drives real
 * trade volume runs THROUGH the picks teams exchange:
 *
 *   - Contenders DEPRECIATE current-pick value (their own picks feel
 *     like chips to spend, not assets to hoard — "what does a 2027 R3
 *     matter if we don't win 2026?"). Lower currentMultiplier means
 *     contenders accept giving up MORE picks for the same vet.
 *
 *   - Rebuilders APPRECIATE current-pick value (the deadline IS their
 *     selling window; smaller pick packages now look acceptable
 *     compared to clinging to a vet whose value erodes through the
 *     spring). Higher currentMultiplier means rebuilders accept
 *     FEWER picks for the same vet.
 *
 * Concretely: trades fire when both `netValue > 0`. The threshold
 * between buyer and seller is roughly `rebuilder_current /
 * contender_current` — raise that ratio and more deals overlap. The
 * v0.58 numbers (~10-15% each side) raise the threshold by ~30%
 * relative to the baseline CompetitiveWindow split.
 *
 * Future-pick values are NOT touched — the deadline pressure is about
 * compressing current-year capital, not shifting horizons.
 */
const DEADLINE_CONTENDER_CURRENT_DROP = 0.85;
const DEADLINE_REBUILDER_CURRENT_BOOST = 1.15;

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
  context: ChartModifierContext = NEUTRAL_CONTEXT,
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

  // ── Hot-seat HC (v0.49 — slice 2) ───────────────────────────────
  // Doc 5: "HC on the hot seat — inflates value of all high-impact
  // positions, deflates future pick value significantly. Observable
  // signal: unusual willingness to give up future capital." We
  // derive the hot-seat signal from team.seasonHistory (3+
  // consecutive sub-.500 finishes). The engine doesn't model HC
  // tenure separately yet, so we're using the team's recent results
  // as a proxy — a team that's been losing for years has a HC under
  // pressure whether or not the same HC stayed through all of it.
  if (isHotSeatByRecord(team.seasonHistory)) {
    current *= 1.1;
    future *= 0.8;
  }

  // ── Trade-deadline urgency overlay (v0.58) ──────────────────────
  // Applies on the single week-8 in-season tick. See
  // `DEADLINE_CONTENDER_CURRENT_DROP` / `DEADLINE_REBUILDER_CURRENT_BOOST`
  // commentary above for why the directions look counterintuitive
  // (contenders DEPRECIATE their own picks, rebuilders APPRECIATE
  // incoming picks) — this is what widens the buyer/seller overlap.
  if (context.isTradeDeadlineWeek) {
    switch (team.competitiveWindow) {
      case CompetitiveWindow.CHAMPIONSHIP:
      case CompetitiveWindow.CONTENDER:
        current *= DEADLINE_CONTENDER_CURRENT_DROP;
        break;
      case CompetitiveWindow.REBUILDING:
      case CompetitiveWindow.RETOOLING:
      case CompetitiveWindow.STAGNANT:
        current *= DEADLINE_REBUILDER_CURRENT_BOOST;
        break;
      case CompetitiveWindow.EMERGING:
        // Neutral — emerging teams sit between buyer + seller
        // motivations and Doc 5 doesn't pin a direction.
        break;
    }
  }

  return {
    currentMultiplier: round2(current),
    futureMultiplier: round2(future),
  };
}

/**
 * Hot-seat HC detection from team season history. Returns true when
 * the team has finished sub-.500 in each of the last
 * `HOT_SEAT_CONSECUTIVE_LOSING_SEASONS` seasons (default 3). Real
 * NFL pressure typically builds over 2-3 seasons before a HC change;
 * this is the engine's proxy until HC tenure tracking lands.
 *
 * Returns false for teams without enough history (rookie leagues or
 * brand-new franchises) — they can't be "on the hot seat" yet.
 */
const HOT_SEAT_CONSECUTIVE_LOSING_SEASONS = 3;

function isHotSeatByRecord(seasonHistory: readonly TeamSeasonRecord[]): boolean {
  if (seasonHistory.length < HOT_SEAT_CONSECUTIVE_LOSING_SEASONS) return false;
  const recent = seasonHistory.slice(-HOT_SEAT_CONSECUTIVE_LOSING_SEASONS);
  for (const rec of recent) {
    if (rec.wins >= rec.losses) return false;
  }
  return true;
}

/**
 * Per-GM QB premium for the current-year on-clock pick when the
 * target is a QB. Doc 5: "When a QB is the clear target of a
 * trade-up, the acquiring team's chart value threshold increases by
 * 25-50% depending on GM personality and desperation level."
 *
 * Mapped from GM.spectrums.patienceUnderPressure (1..10):
 *   patience 1  (most desperate) → 1.50  (max Doc 5 range)
 *   patience 5  (average)        → 1.38
 *   patience 10 (most patient)   → 1.23  (low end of Doc 5 range)
 *
 * The asymmetric design matters: a patient on-clock team (low QB
 * premium) won't resist trading down for QB-targeted offers as
 * strongly, AND a desperate trading-up team (high QB premium) values
 * the on-clock pick higher → they'll overpay aggressively. Both
 * effects push QB trade-ups toward firing.
 */
export function qbPremiumForGm(gm: Gm): number {
  const patience = gm.spectrums.patienceUnderPressure;
  // premium = 1.20 + (11 - patience) * 0.03  → range [1.23, 1.50]
  return round2(1.2 + (11 - patience) * 0.03);
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
  qbPremium?: number,
): number {
  if (yearsOut === 0) {
    let v = baseValue * modifiers.currentMultiplier;
    if (isQbTarget) v *= qbPremium ?? QB_CURRENT_PICK_PREMIUM;
    return v;
  }
  return baseValue * modifiers.futureMultiplier;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
