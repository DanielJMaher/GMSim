import { describe, it, expect } from 'vitest';
import { simulateSeason } from './runner.js';
import { tickPhase } from './lifecycle.js';
import { createLeague } from '../league/generate.js';
import { computeRecords, playoffSeeds } from './standings.js';
import { Conference } from '../types/enums.js';

describe('simulateSeason', () => {
  it('populates schedule with results for every game', () => {
    const league = createLeague({ seed: 'rs-1' });
    const after = simulateSeason(league);
    expect(after.schedule).not.toBeNull();
    for (const week of after.schedule!.regularSeason) {
      for (const game of week) {
        expect(game.result).not.toBeNull();
      }
    }
  });

  it('every team has 17 game results across the season', () => {
    const league = createLeague({ seed: 'rs-2' });
    const after = simulateSeason(league);
    const counts = new Map<string, number>();
    for (const week of after.schedule!.regularSeason) {
      for (const game of week) {
        counts.set(game.homeTeamId, (counts.get(game.homeTeamId) ?? 0) + 1);
        counts.set(game.awayTeamId, (counts.get(game.awayTeamId) ?? 0) + 1);
      }
    }
    for (const [, count] of counts) {
      expect(count).toBe(17);
    }
  });

  it('records sum to 17 wins+losses+ties per team', () => {
    const league = createLeague({ seed: 'rs-3' });
    const after = simulateSeason(league);
    const records = computeRecords(after);
    for (const team of Object.values(after.teams)) {
      const r = records.get(team.identity.id)!;
      expect(r.wins + r.losses + r.ties).toBe(17);
    }
  });

  it('total wins league-wide equal total losses', () => {
    const league = createLeague({ seed: 'rs-4' });
    const after = simulateSeason(league);
    const records = computeRecords(after);
    let totalWins = 0;
    let totalLosses = 0;
    for (const r of records.values()) {
      totalWins += r.wins;
      totalLosses += r.losses;
    }
    expect(totalWins).toBe(totalLosses);
  });

  it('determinism — same league yields same season results', () => {
    const a = simulateSeason(createLeague({ seed: 'det-rs' }));
    const b = simulateSeason(createLeague({ seed: 'det-rs' }));
    expect(a.schedule).toEqual(b.schedule);
  });

  describe('playoffs', () => {
    const league = createLeague({ seed: 'po-1' });
    const after = simulateSeason(league);

    it('produces a 6-game wild card round (3 per conference)', () => {
      expect(after.schedule!.playoffs!.wildCard.length).toBe(6);
    });

    it('produces a 4-game divisional round (2 per conference)', () => {
      expect(after.schedule!.playoffs!.divisional.length).toBe(4);
    });

    it('produces a 2-game conference championships round', () => {
      expect(after.schedule!.playoffs!.conference.length).toBe(2);
    });

    it('produces a single Super Bowl', () => {
      expect(after.schedule!.playoffs!.superBowl.length).toBe(1);
    });

    it('crowns a champion', () => {
      expect(after.schedule!.playoffs!.championId).not.toBeNull();
    });

    it('every playoff game has a result', () => {
      const po = after.schedule!.playoffs!;
      for (const game of [...po.wildCard, ...po.divisional, ...po.conference, ...po.superBowl]) {
        expect(game.result).not.toBeNull();
      }
    });

    it('seeds the top 7 teams from each conference', () => {
      const records = computeRecords(after);
      const seeds = playoffSeeds(after, records);
      expect(seeds[Conference.AFC].length).toBe(7);
      expect(seeds[Conference.NFC].length).toBe(7);
    });
  });

  describe('tickPhase equivalence (v0.56)', () => {
    it('tick-by-tick reaches the same final state as bulk simulateSeason', () => {
      const bulk = simulateSeason(createLeague({ seed: 'tick-equiv' }));
      let stepped = createLeague({ seed: 'tick-equiv' });
      for (let i = 0; i < 100; i++) {
        if (stepped.lifecyclePhase === 'SUPER_BOWL') break;
        stepped = tickPhase(stepped);
      }
      expect(stepped.lifecyclePhase).toBe('SUPER_BOWL');
      expect(stepped.schedule).toEqual(bulk.schedule);
      expect(stepped.players).toEqual(bulk.players);
      expect(stepped.teams).toEqual(bulk.teams);
      expect(stepped.transactionLog).toEqual(bulk.transactionLog);
    });

    it('reaches Super Bowl in the expected number of ticks (v0.64: full calendar)', () => {
      // v0.64 unified-calendar cycle — phases fire in true calendar
      // date order (see season/timeline.ts). To reach SUPER_BOWL:
      //   1 PRESEASON (late Aug)
      // + 17 NFL regular-season weeks (Sept–Dec), interleaved with
      // + 12 college regular-season weeks (late Aug–Nov)
      // + 1 TRADE_DEADLINE marker (late Oct)
      // + 7 college postseason phases (conf champs → Heisman → bowls →
      //   CFP rounds, the CFP final landing mid-January)
      // + 1 DRAFT_DECLARATION beat (Jan 20, day after the CFP final)
      // + 4 NFL playoff rounds (WC, DIV, CONF, SB)
      // The pre-draft beats (Combine, Pro Days, Top-30) fire AFTER the
      // Super Bowl, so they don't count here.
      let league = createLeague({ seed: 'tick-count' });
      let preseasonTicks = 0;
      let regSeasonTicks = 0;
      let collegeRegTicks = 0;
      let tradeDeadlineTicks = 0;
      let collegePostseasonTicks = 0;
      let declarationTicks = 0;
      let allStarTicks = 0;
      let nflPlayoffTicks = 0;
      for (let i = 0; i < 100; i++) {
        if (league.lifecyclePhase === 'SUPER_BOWL') break;
        league = tickPhase(league);
        const p = league.lifecyclePhase;
        if (p === 'PRESEASON') preseasonTicks++;
        else if (p === 'REGULAR_SEASON_WEEK') regSeasonTicks++;
        else if (p === 'COLLEGE_WEEK') collegeRegTicks++;
        else if (p === 'TRADE_DEADLINE') tradeDeadlineTicks++;
        else if (p === 'DRAFT_DECLARATION') declarationTicks++;
        else if (p === 'SHRINE_BOWL' || p === 'SENIOR_BOWL') allStarTicks++;
        else if (
          p === 'COLLEGE_CONFERENCE_CHAMPIONSHIPS' ||
          p === 'HEISMAN_CEREMONY' ||
          p === 'COLLEGE_BOWL_GAMES' ||
          p === 'CFP_FIRST_ROUND' ||
          p === 'CFP_QUARTERFINALS' ||
          p === 'CFP_SEMIFINALS' ||
          p === 'CFP_FINAL'
        ) {
          collegePostseasonTicks++;
        } else {
          nflPlayoffTicks++;
        }
      }
      expect(preseasonTicks).toBe(1);
      expect(regSeasonTicks).toBe(17);
      expect(collegeRegTicks).toBe(12);
      expect(tradeDeadlineTicks).toBe(1);
      expect(collegePostseasonTicks).toBe(7);
      expect(declarationTicks).toBe(1);
      expect(allStarTicks).toBe(2);
      expect(nflPlayoffTicks).toBe(4);
    });

    it('NFL currentWeek progresses 0..16 across the interleaved cycle', () => {
      let league = createLeague({ seed: 'tick-week' });
      const observedWeeks: number[] = [];
      // Pump ticks; record currentWeek only when an NFL week just
      // fired. Need enough ticks to cover the interleaved NFL+college
      // cycle plus the postseason chain.
      for (let i = 0; i < 50; i++) {
        league = tickPhase(league);
        if (
          league.lifecyclePhase === 'REGULAR_SEASON_WEEK' &&
          league.currentWeek !== null
        ) {
          // Push only when we see a NEW week (the same week reads
          // would repeat across COLLEGE_WEEK ticks if we sampled
          // every tick).
          if (observedWeeks[observedWeeks.length - 1] !== league.currentWeek) {
            observedWeeks.push(league.currentWeek);
          }
        }
        if (observedWeeks.length === 17 && league.lifecyclePhase === 'REGULAR_SEASON_WEEK') break;
      }
      expect(observedWeeks).toEqual(Array.from({ length: 17 }, (_, i) => i));

      // v0.63.1: after the last NFL regular-season week (Dec 28), the
      // next dated events are the CFP quarterfinals (Jan 1) and
      // semifinals (Jan 9) BEFORE the NFL Wild Card (Jan 13). Pump
      // until Wild Card and confirm we passed through those CFP rounds
      // first, with currentWeek cleared once the playoffs begin.
      const phasesUntilWildCard: string[] = [];
      for (let i = 0; i < 10; i++) {
        league = tickPhase(league);
        phasesUntilWildCard.push(league.lifecyclePhase);
        if (league.lifecyclePhase === 'WILD_CARD') break;
      }
      expect(league.lifecyclePhase).toBe('WILD_CARD');
      expect(league.currentWeek).toBeNull();
      expect(phasesUntilWildCard).toContain('CFP_QUARTERFINALS');
      expect(phasesUntilWildCard).toContain('CFP_SEMIFINALS');
      expect(phasesUntilWildCard.indexOf('CFP_SEMIFINALS')).toBeLessThan(
        phasesUntilWildCard.indexOf('WILD_CARD'),
      );
    });

    it('college regular season is 12 weeks; college pool stats accumulate', () => {
      let league = createLeague({ seed: 'tick-college' });
      const observedCollegeWeeks: number[] = [];
      for (let i = 0; i < 60; i++) {
        league = tickPhase(league);
        if (
          league.lifecyclePhase === 'COLLEGE_WEEK' &&
          league.collegeCurrentWeek !== null
        ) {
          if (
            observedCollegeWeeks[observedCollegeWeeks.length - 1] !==
            league.collegeCurrentWeek
          ) {
            observedCollegeWeeks.push(league.collegeCurrentWeek);
          }
        }
        if (
          observedCollegeWeeks.length === 12 &&
          league.lifecyclePhase === 'COLLEGE_WEEK'
        ) {
          break;
        }
      }
      expect(observedCollegeWeeks).toEqual(Array.from({ length: 12 }, (_, i) => i));
      // College schedule should be populated and have a regular
      // season with 12 weeks of games.
      expect(league.collegeSchedule).not.toBeNull();
      expect(league.collegeSchedule!.regularSeason.length).toBe(12);
      // Some per-prospect stats should have accumulated.
      expect(league.collegeGameStats.length).toBeGreaterThan(0);
    });
  });
});
