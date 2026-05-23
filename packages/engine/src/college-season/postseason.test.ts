import { describe, it, expect } from 'vitest';
import {
  buildCfpBracket,
  buildBowlSlate,
  buildConferenceChampionships,
} from './postseason.js';
import type { CollegeTeamRecord, CollegeGame } from '../types/college-season.js';
import { COLLEGE_SCHOOLS } from '../data/colleges/index.js';
import { GameId } from '../types/ids.js';

/**
 * Build a synthetic records map: each FBS school gets a record
 * derived from a per-school seed so we have varied wins/losses.
 */
function syntheticRecords(): Map<string, CollegeTeamRecord> {
  const records = new Map<string, CollegeTeamRecord>();
  const fbs = COLLEGE_SCHOOLS.filter(
    (s) => s.tier === 'POWER' || s.tier === 'GROUP_OF_5',
  );
  for (let i = 0; i < fbs.length; i++) {
    const school = fbs[i]!;
    // Spread records 0-12 wins by school index for determinism.
    const wins = (i * 7) % 13;
    const losses = 12 - wins;
    records.set(school.id, {
      schoolId: school.id,
      wins,
      losses,
      conferenceWins: Math.max(0, wins - 2),
      conferenceLosses: Math.max(0, losses - 2),
    });
  }
  return records;
}

function fakeChampionshipGame(homeId: string, awayId: string, homeWins: boolean): CollegeGame {
  return {
    id: GameId(`CC_${homeId}_${awayId}`),
    weekNumber: 1,
    homeSchoolId: homeId,
    awaySchoolId: awayId,
    bowlName: 'Test Conf Championship',
    kind: 'CONFERENCE_CHAMPIONSHIP',
    result: {
      homeScore: homeWins ? 35 : 21,
      awayScore: homeWins ? 21 : 35,
      homeStats: { totalYards: 400, passingYards: 250, rushingYards: 150, turnovers: 1, sacks: 2 },
      awayStats: { totalYards: 380, passingYards: 220, rushingYards: 160, turnovers: 2, sacks: 3 },
      variance: 'controlled',
    },
  };
}

describe('buildConferenceChampionships', () => {
  it('produces one championship per FBS conference', () => {
    const records = syntheticRecords();
    const games = buildConferenceChampionships(records, 1);
    // 4 Power + 5 G5 = 9 conferences.
    expect(games.length).toBe(9);
    for (const g of games) {
      expect(g.kind).toBe('CONFERENCE_CHAMPIONSHIP');
      expect(g.bowlName).toMatch(/Championship/);
    }
  });
});

describe('buildCfpBracket', () => {
  it('produces a 12-school bracket with 4 first-round games', () => {
    const records = syntheticRecords();
    // Pick the 9 conference champions as the top-record school per
    // conference; rely on syntheticRecords' index-based spread.
    const conferenceChamps: CollegeGame[] = [];
    const seenConfs = new Set<string>();
    for (const school of COLLEGE_SCHOOLS) {
      if (school.tier !== 'POWER' && school.tier !== 'GROUP_OF_5') continue;
      if (seenConfs.has(school.conferenceId)) continue;
      seenConfs.add(school.conferenceId);
      // Pick the synthetic-best school in the conference as the
      // "winner" of the conference championship.
      const inConf = COLLEGE_SCHOOLS.filter(
        (s) => s.conferenceId === school.conferenceId,
      );
      const sorted = inConf.slice().sort((a, b) => {
        const ra = records.get(a.id);
        const rb = records.get(b.id);
        return (rb?.wins ?? 0) - (ra?.wins ?? 0);
      });
      if (sorted.length < 2) continue;
      conferenceChamps.push(fakeChampionshipGame(sorted[0]!.id, sorted[1]!.id, true));
    }
    const bracket = buildCfpBracket(records, conferenceChamps, 1);
    expect(bracket.seeds.length).toBe(12);
    expect(bracket.firstRound.length).toBe(4);
    expect(bracket.quarterfinals.length).toBe(0); // not yet played
    expect(bracket.semifinals.length).toBe(0);
    expect(bracket.final.length).toBe(0);
    expect(bracket.championSchoolId).toBeNull();

    // First-round pairings: 5v12, 6v11, 7v10, 8v9.
    for (let i = 0; i < bracket.firstRound.length; i++) {
      const game = bracket.firstRound[i]!;
      expect(game.kind).toBe('CFP_FIRST_ROUND');
    }
  });
});

describe('buildBowlSlate', () => {
  it('selects non-CFP teams with 6+ wins and pairs them into bowl games', () => {
    const records = syntheticRecords();
    const cfpSchools = new Set<string>();
    const slate = buildBowlSlate(records, cfpSchools, 1);
    // At most 15 bowl matchups (30 teams) given our BOWL_NAMES catalog.
    expect(slate.length).toBeGreaterThan(0);
    expect(slate.length).toBeLessThanOrEqual(15);
    for (const game of slate) {
      expect(game.kind).toBe('BOWL');
      expect(game.bowlName).not.toBeNull();
      const home = records.get(game.homeSchoolId);
      const away = records.get(game.awaySchoolId);
      expect(home?.wins ?? 0).toBeGreaterThanOrEqual(6);
      expect(away?.wins ?? 0).toBeGreaterThanOrEqual(6);
    }
  });

  it('excludes CFP schools from the bowl slate', () => {
    const records = syntheticRecords();
    const cfpSchools = new Set<string>(['ALABAMA', 'GEORGIA', 'OHIO_STATE']);
    const slate = buildBowlSlate(records, cfpSchools, 1);
    for (const game of slate) {
      expect(cfpSchools.has(game.homeSchoolId)).toBe(false);
      expect(cfpSchools.has(game.awaySchoolId)).toBe(false);
    }
  });
});
