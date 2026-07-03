/**
 * Cap-accounting constants. Centralized here so the rest of the
 * contract module reads cleanly.
 */

/** League-minimum salary (rough 2024 figure for vested veterans), priced at
 *  `ANCHOR_CAP`. Prefer `leagueMinimumSalary(salaryCap)` anywhere the current
 *  cap is available — the real vet minimum grows with the cap. */
export const LEAGUE_MINIMUM_SALARY = 900_000;

/**
 * The salary cap every historical dollar constant in the engine was tuned
 * against (the 2024-ish $255M default birth cap). Cap-relative pricing
 * divides a tuned dollar figure by this anchor to get its %-of-cap, then
 * multiplies by the CURRENT `league.salaryCap` — so a league whose cap has
 * grown re-prices deals against today's ceiling instead of 2024's.
 */
export const ANCHOR_CAP = 255_000_000;

/**
 * Annual salary-cap growth applied at POST_SEASON_FINALIZE (v0.176).
 * Daniel's calibration (2026-07-03): "the most realistic growth over the
 * last 20 years." Real cap CAGR: 2005 $85.5M → 2025 $279.2M = 6.10%/yr;
 * 2006 $102M → 2026 $301.2M = 5.56%/yr (Spotrac CBA history / RealGM).
 * 6% flat splits the two 20-year windows. Deterministic — no jitter — so
 * a save's cap schedule reproduces from the seed alone.
 */
export const SALARY_CAP_ANNUAL_GROWTH = 1.06;

/** Vet minimum scaled to the current cap (rounded to $10k). */
export function leagueMinimumSalary(salaryCap: number): number {
  return Math.round(((LEAGUE_MINIMUM_SALARY / ANCHOR_CAP) * salaryCap) / 10_000) * 10_000;
}

/** Maximum number of years a signing bonus can prorate across. */
export const MAX_PRORATION_YEARS = 5;

/** Approximate weeks in a league-year (regular season + playoffs + offseason). */
export const WEEKS_PER_LEAGUE_YEAR = 52;

/** Practice squad size per team (NFL standard: 16). */
export const PRACTICE_SQUAD_SIZE = 16;

/**
 * Annualized practice-squad salary. Real NFL: ~$13K-$22K/week × 18 weeks ≈
 * $234K–$396K. Engine uses a flat midpoint that's well below the active
 * roster's LEAGUE_MINIMUM_SALARY so PS contracts are visibly cheaper.
 */
export const PRACTICE_SQUAD_SALARY = 250_000;

/**
 * NFL top-51 rule: during the offseason (until the regular season opens),
 * only the 51 highest cap hits on a team's roster count toward the cap.
 * Switches to all 53 during REGULAR_SEASON and PLAYOFFS phases.
 */
export const TOP_51_OFFSEASON = 51;
