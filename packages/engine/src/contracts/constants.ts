/**
 * Cap-accounting constants. Centralized here so the rest of the
 * contract module reads cleanly.
 */

/** League-minimum salary (rough 2024 figure for vested veterans). */
export const LEAGUE_MINIMUM_SALARY = 900_000;

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
