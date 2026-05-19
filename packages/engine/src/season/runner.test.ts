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

    it('regular season takes 17 ticks; playoffs take 4 ticks', () => {
      let league = createLeague({ seed: 'tick-count' });
      let regSeasonTicks = 0;
      let playoffTicks = 0;
      for (let i = 0; i < 100; i++) {
        if (league.lifecyclePhase === 'SUPER_BOWL') break;
        league = tickPhase(league);
        if (league.lifecyclePhase === 'REGULAR_SEASON_WEEK') regSeasonTicks++;
        else playoffTicks++;
      }
      expect(regSeasonTicks).toBe(17);
      expect(playoffTicks).toBe(4);
    });

    it('currentWeek progresses 0..16 during regular season then resets to null', () => {
      let league = createLeague({ seed: 'tick-week' });
      const weeks: (number | null)[] = [];
      // Play through 17 regular-season weeks one at a time.
      for (let i = 0; i < 17; i++) {
        league = tickPhase(league);
        weeks.push(league.currentWeek);
      }
      expect(weeks).toEqual(Array.from({ length: 17 }, (_, i) => i));
      expect(league.lifecyclePhase).toBe('REGULAR_SEASON_WEEK');

      // Next tick transitions to WILD_CARD and resets currentWeek.
      league = tickPhase(league);
      expect(league.lifecyclePhase).toBe('WILD_CARD');
      expect(league.currentWeek).toBeNull();
    });
  });
});
