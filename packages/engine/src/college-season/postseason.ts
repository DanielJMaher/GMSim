import { GameId } from '../types/ids.js';
import type { CollegeGame, CfpBracket, CollegeTeamRecord } from '../types/college-season.js';
import { COLLEGE_SCHOOLS, CONFERENCES } from '../data/colleges/index.js';
import { sortByRecord } from './records.js';

const FBS_CONFERENCES = CONFERENCES.filter(
  (c) => c.tier === 'POWER' || c.tier === 'GROUP_OF_5',
);

const SCHOOLS_BY_CONFERENCE = new Map<string, string[]>();
for (const school of COLLEGE_SCHOOLS) {
  if (school.tier !== 'POWER' && school.tier !== 'GROUP_OF_5') continue;
  const arr = SCHOOLS_BY_CONFERENCE.get(school.conferenceId) ?? [];
  arr.push(school.id);
  SCHOOLS_BY_CONFERENCE.set(school.conferenceId, arr);
}

/**
 * Build conference championship matchups. Each FBS conference's
 * top 2 finishers (by conference record, then overall record) play.
 * Returns one `CollegeGame` per conference.
 */
export function buildConferenceChampionships(
  records: ReadonlyMap<string, CollegeTeamRecord>,
  seasonNumber: number,
): CollegeGame[] {
  const games: CollegeGame[] = [];
  let counter = 0;
  for (const conf of FBS_CONFERENCES) {
    const schools = SCHOOLS_BY_CONFERENCE.get(conf.id) ?? [];
    if (schools.length < 4) continue;
    // Sort conference-mates by their conference record first, with
    // overall record as the secondary key.
    const sorted = [...schools].sort((a, b) => {
      const ra = records.get(a);
      const rb = records.get(b);
      if (!ra || !rb) return 0;
      if (ra.conferenceWins !== rb.conferenceWins) {
        return rb.conferenceWins - ra.conferenceWins;
      }
      if (ra.wins !== rb.wins) return rb.wins - ra.wins;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    const one = sorted[0];
    const two = sorted[1];
    if (!one || !two) continue;
    counter++;
    games.push({
      id: GameId(`CFB_S${seasonNumber}_CONFCHAMP_${conf.id}_${counter}`),
      weekNumber: counter,
      homeSchoolId: one,
      awaySchoolId: two,
      bowlName: `${conf.name} Championship`,
      result: null,
      kind: 'CONFERENCE_CHAMPIONSHIP',
    });
  }
  return games;
}

/**
 * Identify the school that won each conference championship. Used
 * by CFP selection to prefer conference champions over at-large
 * candidates with equal records.
 */
export function conferenceChampions(
  championshipGames: readonly CollegeGame[],
): Set<string> {
  const champs = new Set<string>();
  for (const game of championshipGames) {
    if (!game.result) continue;
    const winner =
      game.result.homeScore > game.result.awayScore
        ? game.homeSchoolId
        : game.awaySchoolId;
    champs.add(winner);
  }
  return champs;
}

/**
 * Build the 12-team College Football Playoff bracket per the
 * 2024-format rules:
 *
 *   - Top 5 highest-ranked conference champions auto-qualify
 *   - Top 4 of those (highest record among champions) get a
 *     first-round bye (seeds 1-4)
 *   - Remaining 7 spots filled by best overall records (champions
 *     beyond top-5 + at-large non-champions), seeded 5-12 by record
 *   - First round: 5v12, 6v11, 7v10, 8v9 (higher seed hosts)
 *
 * `seeds` is returned in seed order (index 0 = seed 1).
 */
export function buildCfpBracket(
  records: ReadonlyMap<string, CollegeTeamRecord>,
  championshipGames: readonly CollegeGame[],
  seasonNumber: number,
): CfpBracket {
  const champs = conferenceChampions(championshipGames);
  const allFbs = [...records.keys()];

  // Sort all FBS schools by overall record.
  const overallSorted = sortByRecord(allFbs, records);

  // Pick the top 5 conference champions (in overall order).
  const champSorted = overallSorted.filter((id) => champs.has(id));
  const autoChamps = champSorted.slice(0, 5);
  const remainingChampPool = champSorted.slice(5);

  // The top 4 of `autoChamps` are byes (seeds 1-4).
  const byes = autoChamps.slice(0, 4);

  // Remaining 8 spots: 5th champion + 7 best non-bye (non-bye-champ
  // candidates + non-champions).
  const fifthChamp = autoChamps[4];
  const usedIds = new Set([...byes]);
  if (fifthChamp) usedIds.add(fifthChamp);
  const atLargePool = overallSorted.filter((id) => !usedIds.has(id));
  const atLargePicks = atLargePool.slice(0, 7);

  // Seeds 5-12: (fifth champion if any) + at-large, sorted by record.
  const lowerSeedPool = [
    ...(fifthChamp ? [fifthChamp] : []),
    ...remainingChampPool,
    ...atLargePicks,
  ];
  const lowerSeedSorted = sortByRecord(lowerSeedPool, records).slice(0, 8);

  const seeds = [...byes, ...lowerSeedSorted];

  // First round: 5v12, 6v11, 7v10, 8v9.
  const firstRound: CollegeGame[] = [];
  const pairings: ReadonlyArray<[number, number]> = [
    [4, 11], // seeds 5 (idx 4) vs 12 (idx 11)
    [5, 10],
    [6, 9],
    [7, 8],
  ];
  let counter = 0;
  for (const [hiIdx, loIdx] of pairings) {
    const hi = seeds[hiIdx];
    const lo = seeds[loIdx];
    if (!hi || !lo) continue;
    counter++;
    firstRound.push({
      id: GameId(`CFB_S${seasonNumber}_CFP_R1_${hi}_${lo}_${counter}`),
      weekNumber: counter,
      // Higher seed hosts (real CFP rule).
      homeSchoolId: hi,
      awaySchoolId: lo,
      bowlName: 'CFP First Round',
      result: null,
      kind: 'CFP_FIRST_ROUND',
    });
  }

  return {
    seeds,
    firstRound,
    quarterfinals: [],
    semifinals: [],
    final: [],
    championSchoolId: null,
  };
}

/**
 * Build quarterfinal matchups. Pairing:
 *   QF1: seed 1 vs winner(8/9)
 *   QF2: seed 2 vs winner(7/10)
 *   QF3: seed 3 vs winner(6/11)
 *   QF4: seed 4 vs winner(5/12)
 * Quarterfinals are played at neutral-site bowls (real format).
 */
export function buildCfpQuarterfinals(
  bracket: CfpBracket,
  seasonNumber: number,
): CollegeGame[] {
  if (bracket.firstRound.length !== 4) return [];
  const winners = bracket.firstRound.map((g) => {
    if (!g.result) return null;
    return g.result.homeScore > g.result.awayScore ? g.homeSchoolId : g.awaySchoolId;
  });
  // firstRound order matches the pairings [[5,12],[6,11],[7,10],[8,9]],
  // so winners[0] = winner of 5v12, winners[1] = 6v11, winners[2] = 7v10, winners[3] = 8v9.
  const pairings: ReadonlyArray<[number, number]> = [
    [0, 3], // seed 1 (idx 0) vs winner(8/9) (winners[3])
    [1, 2], // seed 2 vs winner(7/10)
    [2, 1], // seed 3 vs winner(6/11)
    [3, 0], // seed 4 vs winner(5/12)
  ];
  const games: CollegeGame[] = [];
  let counter = 0;
  for (const [byeIdx, winIdx] of pairings) {
    const bye = bracket.seeds[byeIdx];
    const winner = winners[winIdx];
    if (!bye || !winner) continue;
    counter++;
    games.push({
      id: GameId(`CFB_S${seasonNumber}_CFP_QF_${bye}_${winner}_${counter}`),
      weekNumber: counter,
      homeSchoolId: bye,
      awaySchoolId: winner,
      bowlName: `CFP Quarterfinal`,
      result: null,
      kind: 'CFP_QUARTERFINAL',
    });
  }
  return games;
}

/**
 * Build semifinal matchups. Bracket logic:
 *   SF1: QF1 winner vs QF4 winner
 *   SF2: QF2 winner vs QF3 winner
 */
export function buildCfpSemifinals(
  bracket: CfpBracket,
  seasonNumber: number,
): CollegeGame[] {
  if (bracket.quarterfinals.length !== 4) return [];
  const winners = bracket.quarterfinals.map((g) => {
    if (!g.result) return null;
    return g.result.homeScore > g.result.awayScore ? g.homeSchoolId : g.awaySchoolId;
  });
  const games: CollegeGame[] = [];
  const pairs: ReadonlyArray<[number, number]> = [
    [0, 3],
    [1, 2],
  ];
  let counter = 0;
  for (const [a, b] of pairs) {
    const wa = winners[a];
    const wb = winners[b];
    if (!wa || !wb) continue;
    counter++;
    games.push({
      id: GameId(`CFB_S${seasonNumber}_CFP_SF_${wa}_${wb}_${counter}`),
      weekNumber: counter,
      homeSchoolId: wa,
      awaySchoolId: wb,
      bowlName: 'CFP Semifinal',
      result: null,
      kind: 'CFP_SEMIFINAL',
    });
  }
  return games;
}

export function buildCfpFinal(
  bracket: CfpBracket,
  seasonNumber: number,
): CollegeGame[] {
  if (bracket.semifinals.length !== 2) return [];
  const winners = bracket.semifinals.map((g) => {
    if (!g.result) return null;
    return g.result.homeScore > g.result.awayScore ? g.homeSchoolId : g.awaySchoolId;
  });
  const a = winners[0];
  const b = winners[1];
  if (!a || !b) return [];
  return [
    {
      id: GameId(`CFB_S${seasonNumber}_CFP_FINAL_${a}_${b}`),
      weekNumber: 1,
      homeSchoolId: a,
      awaySchoolId: b,
      bowlName: 'CFP National Championship',
      result: null,
      kind: 'CFP_FINAL',
    },
  ];
}

/**
 * Curated set of bowl game names. Slice 1 picks 15 generic-ish
 * names; the slate fills with the top 30 non-CFP teams who hit the
 * bowl-eligibility threshold (6+ wins).
 */
const BOWL_NAMES: readonly string[] = [
  'Rose Bowl',
  'Sugar Bowl',
  'Orange Bowl',
  'Cotton Bowl',
  'Fiesta Bowl',
  'Peach Bowl',
  'Citrus Bowl',
  'Gator Bowl',
  'Outback Bowl',
  'Sun Bowl',
  'Music City Bowl',
  'Liberty Bowl',
  'Holiday Bowl',
  'Las Vegas Bowl',
  'Independence Bowl',
];

const BOWL_ELIGIBILITY_MIN_WINS = 6;

/**
 * Build the non-CFP bowl slate. Selects bowl-eligible (6+ wins)
 * schools NOT in the CFP, pairs them in order of record, and slots
 * the pairings into named bowl games.
 *
 * Slice 1 model: simple greedy pairing (1st seed vs 2nd seed in
 * the top bowl, 3rd vs 4th in the second bowl, etc.). Real bowls
 * pair conference tie-ins; that nuance lands when bowl payouts
 * matter.
 */
export function buildBowlSlate(
  records: ReadonlyMap<string, CollegeTeamRecord>,
  cfpSchools: ReadonlySet<string>,
  seasonNumber: number,
): CollegeGame[] {
  const allEligible = [...records.entries()]
    .filter(([id, r]) => !cfpSchools.has(id) && r.wins >= BOWL_ELIGIBILITY_MIN_WINS)
    .map(([id]) => id);
  const sorted = sortByRecord(allEligible, records);
  const maxTeams = BOWL_NAMES.length * 2;
  const slate = sorted.slice(0, maxTeams);

  const games: CollegeGame[] = [];
  for (let i = 0; i + 1 < slate.length; i += 2) {
    const a = slate[i]!;
    const b = slate[i + 1]!;
    const bowlIdx = i / 2;
    const bowlName = BOWL_NAMES[bowlIdx] ?? `Bowl Game ${bowlIdx + 1}`;
    games.push({
      id: GameId(`CFB_S${seasonNumber}_BOWL_${bowlIdx}_${a}_${b}`),
      weekNumber: bowlIdx + 1,
      homeSchoolId: a,
      awaySchoolId: b,
      bowlName,
      result: null,
      kind: 'BOWL',
    });
  }
  return games;
}
