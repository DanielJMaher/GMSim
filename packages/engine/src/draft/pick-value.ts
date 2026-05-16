/**
 * Draft Pick Trade Value Chart — Doc 5 (base layer).
 *
 * Modified Jimmy Johnson chart, recalibrated against
 * Fitzgerald-Spielberger performance methodology and real NFL trade
 * data 2015–2024. Per Doc 5:
 *
 *   - Pick 1 = 10,000 points
 *   - Exponential decay in round 1
 *   - Flatter curve in rounds 2–4 — middle rounds deliberately more
 *     valuable than Johnson
 *   - Near-linear in rounds 5–7
 *   - Future-year picks carry an explicit discount
 *
 * Static base chart only. Doc 5's dynamic situational modifiers
 * (coaching pressure, GM desperation, ownership philosophy, roster
 * state, competitive window) are a separate slice that reads
 * organizational state and applies team-specific multipliers on top
 * of this baseline. Same for the QB-premium override.
 *
 * Per North Star: chart values are exposed for the NPC trade logic;
 * the eventual game UI surfaces them indirectly through observed
 * NPC offer behavior, never as a numerical "fair value" label.
 */

/**
 * Pick values 1..257 (real NFL drafts go to 257 with compensatory
 * picks; our 7-round 32-team draft uses 1..224). Round boundaries:
 *   R1: 1–32      R2: 33–64    R3: 65–96    R4: 97–128
 *   R5: 129–160   R6: 161–192  R7: 193–257
 */
export const BASE_PICK_VALUES: readonly number[] = [
  // ─── ROUND 1 (1–32) ───────────────────────────────────────────────
  10000, 9400, 8800, 8200, 7600, 7050, 6550, 6100, 5700, 5350,
  5000, 4700, 4430, 4180, 3950, 3740, 3540, 3350, 3170, 3000,
  2840, 2690, 2550, 2420, 2300, 2185, 2080, 1980, 1885, 1795,
  1710, 1630,
  // ─── ROUND 2 (33–64) ──────────────────────────────────────────────
  2050, 1980, 1910, 1840, 1770, 1700, 1635, 1570, 1510, 1455,
  1400, 1350, 1300, 1255, 1210, 1165, 1120, 1080, 1040, 1000,
  965, 930, 895, 862, 830, 800, 772, 745, 720, 696,
  673, 650,
  // ─── ROUND 3 (65–96) ──────────────────────────────────────────────
  630, 610, 591, 573, 556, 540, 524, 509, 494, 480,
  467, 454, 441, 429, 417, 406, 395, 384, 374, 364,
  354, 345, 336, 327, 319, 311, 303, 295, 288, 281,
  274, 267,
  // ─── ROUND 4 (97–128) ─────────────────────────────────────────────
  260, 254, 248, 242, 236, 230, 225, 220, 215, 210,
  205, 200, 195, 191, 187, 183, 179, 175, 171, 167,
  163, 160, 157, 154, 151, 148, 145, 142, 139, 136,
  133, 130,
  // ─── ROUND 5 (129–160) — linear 128 → 84 ─────────────────────────
  ...linearRange(128, 84, 32),
  // ─── ROUND 6 (161–192) — linear 82 → 54 ──────────────────────────
  ...linearRange(82, 54, 32),
  // ─── ROUND 7 (193–257) — linear 52 → 20 ──────────────────────────
  ...linearRange(52, 20, 65),
];

/**
 * Per-year discount applied to a pick that won't be drafted until
 * `yearsOut` league years from now. Per Doc 5:
 *   Current year (0): 100%
 *   Next year     (1): 75%
 *   Two out       (2): 58%
 *   Three out     (3): 44%
 *
 * Picks more than 3 years out cap at the 3-year discount — Doc 5
 * doesn't specify beyond 3 and the curve flattens enough that
 * extrapolating would be over-engineering for slice 1.
 */
export const FUTURE_YEAR_DISCOUNTS: readonly number[] = [1.0, 0.75, 0.58, 0.44];

/**
 * Reference to a draft pick — what round/overall it is and how many
 * league years out from the current draft. Used as the unit asset
 * when comparing trade packages.
 *
 * Future slices will introduce a stored `DraftPickAsset` on
 * `LeagueState` that tracks ownership of specific picks (so trades
 * actually move picks between teams). For now this type exists as
 * the lookup shape — callers can build them from arbitrary inputs.
 */
export interface PickReference {
  /** 1..257. Out-of-range values evaluate to 0. */
  overallPick: number;
  /** 0 = current draft, 1 = next year, 2 = two years out, etc. */
  yearsOut: number;
}

/**
 * Chart value of a single pick at `overallPick` evaluated `yearsOut`
 * years from the current draft. 0 for invalid pick numbers.
 */
export function pickValue(overallPick: number, yearsOut = 0): number {
  if (!Number.isInteger(overallPick) || overallPick < 1 || overallPick > BASE_PICK_VALUES.length) {
    return 0;
  }
  if (!Number.isInteger(yearsOut) || yearsOut < 0) return 0;
  const base = BASE_PICK_VALUES[overallPick - 1]!;
  const discountIdx = Math.min(yearsOut, FUTURE_YEAR_DISCOUNTS.length - 1);
  const discount = FUTURE_YEAR_DISCOUNTS[discountIdx]!;
  return base * discount;
}

/**
 * Total chart value of a pick package. Sums `pickValue` across all
 * entries. An empty package is worth 0.
 */
export function valueOfPicks(picks: readonly PickReference[]): number {
  let total = 0;
  for (const p of picks) total += pickValue(p.overallPick, p.yearsOut);
  return total;
}

export interface PickTradeEvaluation {
  /** Total chart value the evaluating team gives up. */
  givingValue: number;
  /** Total chart value the evaluating team receives. */
  receivingValue: number;
  /** receivingValue − givingValue. Positive = win, negative = loss. */
  netValue: number;
  /**
   * receivingValue / givingValue. 1.0 = even. > 1 = receiving more
   * than giving. 0 when giving nothing (degenerate).
   */
  ratio: number;
  /**
   * Within ±10% of fair (ratio in [0.90, 1.10]) — conventional band
   * NFL front offices treat as a "fair" trade by Johnson-style charts.
   * The future situational-modifier slice will add NPC tolerance
   * dials (analytics GMs stay near 1.0; desperate GMs accept much
   * worse ratios).
   */
  isChartFair: boolean;
}

const FAIR_TRADE_BAND = 0.10;

/**
 * Compare two pick packages from the perspective of the team that's
 * GIVING `giving` and RECEIVING `receiving`. Pure math against the
 * base chart — no modifiers applied. NPC trade decisions will read
 * the base ratio and apply situational tolerance on top.
 *
 * For trade-up logic (a future slice): a team trading UP gives more
 * value than they receive — the ratio drops below 1.0, conventionally
 * to ~0.84 (Doc 5: "16–20% premium to move up in the early first
 * round") and 30–60% for QB targets.
 */
export function comparePickPackages(
  giving: readonly PickReference[],
  receiving: readonly PickReference[],
): PickTradeEvaluation {
  const givingValue = valueOfPicks(giving);
  const receivingValue = valueOfPicks(receiving);
  const netValue = receivingValue - givingValue;
  const ratio = givingValue > 0 ? receivingValue / givingValue : 0;
  const isChartFair = givingValue === 0 || Math.abs(1 - ratio) <= FAIR_TRADE_BAND;
  return { givingValue, receivingValue, netValue, ratio, isChartFair };
}

/**
 * Resolve an overall pick number to its round (1..7+). Picks beyond
 * round 7 (193+) all return 7 since they're compensatory rounds in
 * real NFL but our chart treats them as round-7 extensions.
 */
export function roundForOverallPick(overallPick: number): number {
  if (overallPick <= 32) return 1;
  if (overallPick <= 64) return 2;
  if (overallPick <= 96) return 3;
  if (overallPick <= 128) return 4;
  if (overallPick <= 160) return 5;
  if (overallPick <= 192) return 6;
  return 7;
}

// ─── helpers ───────────────────────────────────────────────────────────

/**
 * Build `count` integer values stepping linearly from `start` to
 * `end` (inclusive on both ends). Used for rounds 5-7 which Doc 5
 * specifies as "near-linear" ranges rather than explicit per-pick
 * values.
 */
function linearRange(start: number, end: number, count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [Math.round(start)];
  const step = (end - start) / (count - 1);
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(Math.round(start + step * i));
  return out;
}
