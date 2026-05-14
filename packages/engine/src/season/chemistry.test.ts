import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from './runner.js';
import {
  teamChemistry,
  chemistryBucket,
  CHEMISTRY_BUCKETS,
} from './chemistry.js';
import type { LeagueState } from '../types/league.js';

describe('chemistryBucket', () => {
  it('maps known values to expected labels', () => {
    expect(chemistryBucket(0)).toBe('toxic');
    expect(chemistryBucket(19)).toBe('toxic');
    expect(chemistryBucket(20)).toBe('divided');
    expect(chemistryBucket(40)).toBe('neutral');
    expect(chemistryBucket(60)).toBe('cohesive');
    expect(chemistryBucket(80)).toBe('locked_in');
    expect(chemistryBucket(100)).toBe('locked_in');
  });

  it('bucket order is ascending by severity', () => {
    expect(CHEMISTRY_BUCKETS).toEqual([
      'toxic',
      'divided',
      'neutral',
      'cohesive',
      'locked_in',
    ]);
  });
});

describe('teamChemistry', () => {
  it('starts at a personality-driven score with no trade requests', () => {
    // v0.18.0: each player starts at their moodProfile.setPoint, so
    // team scores reflect the personality mix of the roster — usually
    // in the 60-80 band (normal/anchor heavy with a few outliers).
    // No team should start with open trade requests.
    const league = createLeague({ seed: 'chem-init' });
    for (const team of Object.values(league.teams)) {
      const tc = teamChemistry(team, league);
      expect(tc.score).toBeGreaterThan(55);
      expect(tc.score).toBeLessThan(85);
      expect(tc.tradeRequestCount).toBe(0);
    }
  });

  it('weights STAR mood more heavily than FRINGE', () => {
    const base = createLeague({ seed: 'chem-tier-weight' });
    const team = Object.values(base.teams)[0]!;
    // Build two parallel scenarios on the same roster:
    //   A: every STAR at mood 10, every other tier at mood 100
    //   B: every FRINGE at mood 10, every other tier at mood 100
    // Because STARs weigh 4× and FRINGEs weigh 0.5×, scenario A
    // should yield a lower team chemistry score.
    const playersA: typeof base.players = { ...base.players };
    const playersB: typeof base.players = { ...base.players };
    for (const id of team.rosterIds) {
      const p = base.players[id]!;
      playersA[id] = { ...p, mood: p.tier === 'STAR' ? 10 : 100 };
      playersB[id] = { ...p, mood: p.tier === 'FRINGE' ? 10 : 100 };
    }
    const leagueA: LeagueState = { ...base, players: playersA };
    const leagueB: LeagueState = { ...base, players: playersB };
    const scoreA = teamChemistry(team, leagueA).score;
    const scoreB = teamChemistry(team, leagueB).score;
    expect(scoreA).toBeLessThan(scoreB);
  });

  it('counts players in the unhappy + trade-request buckets', () => {
    const base = createLeague({ seed: 'chem-counters' });
    const team = Object.values(base.teams)[0]!;
    const players: typeof base.players = { ...base.players };
    const tradeRequesterIds = team.rosterIds.slice(0, 2);
    const otherUnhappyIds = team.rosterIds.slice(2, 5);
    for (const id of tradeRequesterIds) {
      players[id] = {
        ...players[id]!,
        mood: 10,
        tradeRequestedOnTick: base.tick,
      };
    }
    for (const id of otherUnhappyIds) {
      players[id] = { ...players[id]!, mood: 15 };
    }
    const league: LeagueState = { ...base, players };
    const tc = teamChemistry(team, league);
    expect(tc.unhappyCount).toBe(tradeRequesterIds.length + otherUnhappyIds.length);
    expect(tc.tradeRequestCount).toBe(tradeRequesterIds.length);
  });

  it('drops out of cohesive into divided / toxic when many players collapse', () => {
    const base = createLeague({ seed: 'chem-collapse' });
    const team = Object.values(base.teams)[0]!;
    const players: typeof base.players = { ...base.players };
    // Tank every rostered player below 30.
    for (const id of [...team.rosterIds, ...team.injuredReserveIds]) {
      players[id] = { ...players[id]!, mood: 10 };
    }
    const league: LeagueState = { ...base, players };
    const tc = teamChemistry(team, league);
    expect(tc.score).toBeLessThan(20);
    expect(tc.bucket).toBe('toxic');
  });

  it('is responsive to a full simmed season — scores diverge across teams', () => {
    const after = simulateSeason(createLeague({ seed: 'chem-diverge' }));
    const scores = Object.values(after.teams).map((t) => teamChemistry(t, after).score);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    // After 18 weeks of varying W/L records + locker-room contagion,
    // the league shouldn't sit at one flat number — some rooms drag,
    // some teams lock in. The exact spread depends on the seed but
    // even a modest one demonstrates the metric is live.
    expect(max - min).toBeGreaterThan(3);
  });
});
