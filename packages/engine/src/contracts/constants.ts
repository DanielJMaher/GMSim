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
