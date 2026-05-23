import { GameId } from '../types/ids.js';
import type { Prng } from '../prng/index.js';
import type { CollegeGame } from '../types/college-season.js';
import type { CollegeSchool } from '../types/college.js';
import { COLLEGE_SCHOOLS } from '../data/colleges/index.js';

/**
 * Number of regular-season weeks. Real CFB runs ~13 weeks ending
 * with rivalry/championship weekend; we compress to 12 weeks of
 * play. Each FBS school plays ~12 games (a few may miss one if
 * the per-week matching algorithm can't find them a non-rematch
 * partner — exceedingly rare given 117 teams and 11 prior weeks
 * of meetings).
 */
export const COLLEGE_REGULAR_SEASON_WEEKS = 12;

/**
 * Generate the FBS regular-season schedule. Slice 1 model:
 *
 *   - All POWER + GROUP_OF_5 schools play (FCS / SMALL schools sit
 *     out — FCS guarantee games can land in a polish slice).
 *   - 12 weeks of pairings. Each week assigns matchups via a
 *     greedy partner-search: each unmatched school first looks for
 *     an in-conference mate who hasn't met them yet, then falls
 *     back to any non-rematch partner. ~70% of games end up in-
 *     conference under this rule on average.
 *   - Pairs that have already met this season are never repeated.
 *   - 117 FBS teams is odd, so each week has exactly 1 bye team.
 *
 * Deterministic for a given (prng, seasonNumber) pair.
 */
export function generateCollegeRegularSeason(
  prng: Prng,
  seasonNumber: number,
): CollegeGame[][] {
  const fbsSchools = COLLEGE_SCHOOLS.filter(
    (s) => s.tier === 'POWER' || s.tier === 'GROUP_OF_5',
  );

  const metPairs = new Set<string>();
  const weeks: CollegeGame[][] = [];
  let gameCounter = 0;

  for (let w = 0; w < COLLEGE_REGULAR_SEASON_WEEKS; w++) {
    const weekPrng = prng.fork(`week-${w + 1}`);
    const games = buildWeekMatching(
      weekPrng,
      fbsSchools,
      metPairs,
      w + 1,
      seasonNumber,
      gameCounter,
    );
    for (const g of games) {
      const key = pairKey(g.homeSchoolId, g.awaySchoolId);
      metPairs.add(key);
    }
    gameCounter += games.length;
    weeks.push(games);
  }
  return weeks;
}

/**
 * Build one week's matching. Greedy partner-search with
 * conference-preference: for each unmatched school, first look for
 * a non-rematch in-conference partner; if none, accept any
 * non-rematch partner. Schools with no valid partner get a bye
 * (very rare; only happens if a school has literally exhausted
 * every available non-met opponent).
 *
 * Schools are shuffled by `prng` to randomize match order while
 * staying deterministic. Home/away coin flip on each pair.
 */
function buildWeekMatching(
  prng: Prng,
  schools: readonly CollegeSchool[],
  metPairs: ReadonlySet<string>,
  weekNumber: number,
  seasonNumber: number,
  startingGameCounter: number,
): CollegeGame[] {
  const shuffled = [...schools];
  prng.shuffle(shuffled);

  const used = new Set<number>();
  const games: CollegeGame[] = [];
  let counter = startingGameCounter;

  for (let i = 0; i < shuffled.length; i++) {
    if (used.has(i)) continue;
    const a = shuffled[i]!;

    // Pass 1 — conference mate who hasn't met us.
    let partnerIdx = findPartner(shuffled, i, used, metPairs, a.conferenceId);
    // Pass 2 — any non-rematch partner.
    if (partnerIdx === -1) {
      partnerIdx = findPartner(shuffled, i, used, metPairs, null);
    }
    if (partnerIdx === -1) continue; // bye

    used.add(i);
    used.add(partnerIdx);
    const b = shuffled[partnerIdx]!;
    const homeIsA = prng.next() < 0.5;
    const home = homeIsA ? a : b;
    const away = homeIsA ? b : a;
    counter++;
    games.push({
      id: GameId(
        `CFB_S${seasonNumber}_W${weekNumber}_${home.id}_${away.id}_${counter}`,
      ),
      weekNumber,
      homeSchoolId: home.id,
      awaySchoolId: away.id,
      bowlName: null,
      result: null,
      kind: 'REGULAR',
    });
  }

  return games;
}

/**
 * Find the index of the first unused school after `fromIdx` who is
 * a valid partner — not already used, not a rematch, and (if
 * `requireConferenceId` is non-null) in the same conference.
 * Returns -1 if no candidate qualifies.
 */
function findPartner(
  schools: readonly CollegeSchool[],
  fromIdx: number,
  used: ReadonlySet<number>,
  metPairs: ReadonlySet<string>,
  requireConferenceId: string | null,
): number {
  const a = schools[fromIdx]!;
  for (let j = fromIdx + 1; j < schools.length; j++) {
    if (used.has(j)) continue;
    const b = schools[j]!;
    if (requireConferenceId !== null && b.conferenceId !== requireConferenceId) {
      continue;
    }
    const key = pairKey(a.id, b.id);
    if (metPairs.has(key)) continue;
    return j;
  }
  return -1;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
