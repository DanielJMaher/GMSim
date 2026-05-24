import { GameId } from '../types/ids.js';
import type { TeamState } from '../types/team.js';
import type { ScheduledGame, SeasonSchedule } from '../types/game.js';
import type { Prng } from '../prng/index.js';

/** Number of NFL regular-season weeks. Exported so the unified
 * season timeline (`season/timeline.ts`) can enumerate week steps
 * without hard-coding the count. */
export const REGULAR_SEASON_WEEKS = 17;

/**
 * Generate a regular-season schedule. Phase 2 takes a deliberately
 * simple "always succeeds" approach: 17 weeks of perfect matchings
 * (every team plays exactly one game per week, no byes). This produces
 * 17 games per team, 16 games per week, 272 games total — matching
 * NFL volume.
 *
 * What's *not* preserved here vs. real NFL:
 *   - No bye weeks (real NFL has 18 weeks with each team off once)
 *   - Division pairs are not guaranteed to play exactly twice
 *   - Cross-conference rotation pattern is not enforced
 *
 * Trade-off: this scheduler always succeeds (deterministic + robust)
 * and produces valid 17-game seasons that drive realistic standings,
 * playoffs, and stat distributions. The exact NFL formula can layer in
 * later as a refinement when the surrounding systems demand it.
 *
 * Soft preference: matchups that would exceed 2 meetings against the
 * same opponent are rejected and the week's matching is re-rolled, so
 * teams get reasonable opponent variety across the season.
 */
export function generateSchedule(
  prng: Prng,
  teams: readonly TeamState[],
  seasonNumber: number,
): SeasonSchedule {
  if (teams.length !== 32) {
    throw new Error(`generateSchedule expects 32 teams, got ${teams.length}`);
  }

  const matchupCount = new Map<string, number>();
  const weeks: ScheduledGame[][] = [];

  for (let w = 0; w < REGULAR_SEASON_WEEKS; w++) {
    const weekGames = generateWeekMatching(
      prng.fork(`week-${w + 1}`),
      teams,
      matchupCount,
      w + 1,
    );
    weeks.push(weekGames);
  }

  return {
    seasonNumber,
    regularSeason: weeks,
    playoffs: null,
  };
}

/**
 * Build a perfect matching of all 32 teams for a single week. Retries
 * up to 200 shuffles if the random matching produces an over-met
 * matchup (>2 meetings between the same pair); accepts the best matching
 * we've seen if no perfect retry succeeds. Per-week generation always
 * returns 16 games — never fails.
 */
function generateWeekMatching(
  prng: Prng,
  teams: readonly TeamState[],
  matchupCount: Map<string, number>,
  weekNumber: number,
): ScheduledGame[] {
  let bestGames: ScheduledGame[] | null = null;
  let bestPenalty = Number.POSITIVE_INFINITY;

  for (let attempt = 0; attempt < 200; attempt++) {
    const shuffled = [...teams];
    prng.shuffle(shuffled);

    const tempCount = new Map(matchupCount);
    const games: ScheduledGame[] = [];
    let penalty = 0;

    for (let i = 0; i < shuffled.length; i += 2) {
      const a = shuffled[i]!;
      const b = shuffled[i + 1]!;
      const key = pairKey(a.identity.id, b.identity.id);
      const meetings = tempCount.get(key) ?? 0;
      // Penalty for over-met matchups: real-world NFL never plays the
      // same regular-season pair more than twice. We discourage but
      // don't strictly forbid (so the algorithm can't get stuck).
      if (meetings >= 2) penalty += 10;
      const homeIsA = prng.next() < 0.5;
      const home = homeIsA ? a : b;
      const away = homeIsA ? b : a;
      games.push({
        id: GameId(
          `G_S${weekNumber}_W${weekNumber}_${home.identity.abbreviation}_${away.identity.abbreviation}_${i}`,
        ),
        weekNumber,
        homeTeamId: home.identity.id,
        awayTeamId: away.identity.id,
        result: null,
        kind: 'REGULAR',
      });
      tempCount.set(key, meetings + 1);
    }

    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestGames = games;
      // Update matchupCount snapshot so subsequent weeks see this matching's effect
      if (penalty === 0) {
        for (const [k, v] of tempCount) matchupCount.set(k, v);
        return games;
      }
    }
  }

  // Use the best matching we found (lowest over-met penalty).
  if (!bestGames) throw new Error('week matching failed unexpectedly');
  // Apply this matching's count updates.
  for (const game of bestGames) {
    const key = pairKey(game.homeTeamId, game.awayTeamId);
    matchupCount.set(key, (matchupCount.get(key) ?? 0) + 1);
  }
  return bestGames;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
