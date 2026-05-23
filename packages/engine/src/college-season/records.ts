import type { CollegeGame, CollegeTeamRecord } from '../types/college-season.js';
import { COLLEGE_SCHOOLS } from '../data/colleges/index.js';

const CONFERENCE_BY_SCHOOL = new Map(
  COLLEGE_SCHOOLS.map((s) => [s.id, s.conferenceId] as const),
);

/**
 * Derive each FBS school's regular-season record from the played
 * weeks. Total + conference wins/losses are tracked separately so
 * the conference-championship selector can break ties by conference
 * record.
 *
 * Ties (rare in CFB, OT is mandatory) are not modeled in Slice 1 —
 * `rollScores` enforces a winner. Conference-championship and CFP
 * games are excluded (they're played later in the lifecycle).
 */
export function computeCollegeRecords(
  regularSeason: ReadonlyArray<readonly CollegeGame[]>,
): Map<string, CollegeTeamRecord> {
  const records = new Map<string, CollegeTeamRecord>();

  const ensure = (schoolId: string): CollegeTeamRecord => {
    let r = records.get(schoolId);
    if (!r) {
      r = {
        schoolId,
        wins: 0,
        losses: 0,
        conferenceWins: 0,
        conferenceLosses: 0,
      };
      records.set(schoolId, r);
    }
    return r;
  };

  for (const week of regularSeason) {
    for (const game of week) {
      if (!game.result || game.kind !== 'REGULAR') continue;
      const home = ensure(game.homeSchoolId);
      const away = ensure(game.awaySchoolId);
      const homeWon = game.result.homeScore > game.result.awayScore;
      const isConfGame =
        CONFERENCE_BY_SCHOOL.get(game.homeSchoolId) ===
        CONFERENCE_BY_SCHOOL.get(game.awaySchoolId);
      if (homeWon) {
        home.wins++;
        away.losses++;
        if (isConfGame) {
          home.conferenceWins++;
          away.conferenceLosses++;
        }
      } else {
        away.wins++;
        home.losses++;
        if (isConfGame) {
          away.conferenceWins++;
          home.conferenceLosses++;
        }
      }
    }
  }
  return records;
}

/**
 * Sort schools by overall record, with conference record as the
 * primary tiebreaker. Returns the school ids in descending order
 * (best record first).
 */
export function sortByRecord(
  schoolIds: readonly string[],
  records: ReadonlyMap<string, CollegeTeamRecord>,
): string[] {
  return [...schoolIds].sort((a, b) => {
    const ra = records.get(a);
    const rb = records.get(b);
    if (!ra || !rb) return 0;
    if (ra.wins !== rb.wins) return rb.wins - ra.wins;
    if (ra.conferenceWins !== rb.conferenceWins) {
      return rb.conferenceWins - ra.conferenceWins;
    }
    // Final tiebreaker: alphabetical (deterministic + stable).
    return a < b ? -1 : a > b ? 1 : 0;
  });
}
