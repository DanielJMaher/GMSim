import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from './runner.js';
import { advanceSeason } from './advance.js';
import { ageOfPlayer } from './development.js';
import { computeRecords } from './standings.js';
import { currentCapHit, summarizeTeamCap } from '../contracts/cap.js';
import { WEEKS_PER_LEAGUE_YEAR } from '../contracts/constants.js';
import type { LeagueState } from '../types/league.js';

/**
 * Run `n` season cycles (simulate → advance) on a fresh league for `seed`.
 * Returns the post-advance league after the n-th iteration.
 */
function runSeasons(seed: string, n: number): LeagueState {
  let league = createLeague({ seed });
  for (let i = 0; i < n; i++) {
    league = simulateSeason(league);
    league = advanceSeason(league);
  }
  return league;
}

describe('advanceSeason', () => {
  it('throws if the league has no schedule', () => {
    const league = createLeague({ seed: 'adv-noschedule' });
    expect(() => advanceSeason(league)).toThrow(/schedule/);
  });

  it('increments seasonNumber by 1 and tick by one league-year', () => {
    const league = simulateSeason(createLeague({ seed: 'adv-tick' }));
    const next = advanceSeason(league);
    expect(next.seasonNumber).toBe(league.seasonNumber + 1);
    expect(next.tick).toBe(league.tick + WEEKS_PER_LEAGUE_YEAR);
    expect(next.phase).toBe('OFFSEASON_PRE_FA');
    expect(next.schedule).toBeNull();
  });

  it('appends one TeamSeasonRecord per team per advance', () => {
    let league = createLeague({ seed: 'adv-history' });
    expect(Object.values(league.teams)[0]!.seasonHistory.length).toBe(0);

    for (let i = 1; i <= 5; i++) {
      league = simulateSeason(league);
      league = advanceSeason(league);
      for (const team of Object.values(league.teams)) {
        expect(team.seasonHistory.length).toBe(i);
        expect(team.seasonHistory[i - 1]!.seasonNumber).toBe(i);
      }
    }
  });

  it('records on history match computeRecords from the just-played season', () => {
    const played = simulateSeason(createLeague({ seed: 'adv-history-match' }));
    const records = computeRecords(played);
    const next = advanceSeason(played);
    for (const team of Object.values(next.teams)) {
      const r = records.get(team.identity.id)!;
      const last = team.seasonHistory[team.seasonHistory.length - 1]!;
      expect(last.wins).toBe(r.wins);
      expect(last.losses).toBe(r.losses);
      expect(last.ties).toBe(r.ties);
    }
  });

  it('flags the Super Bowl winner with championshipResult=won_super_bowl', () => {
    const played = simulateSeason(createLeague({ seed: 'adv-champ' }));
    const champId = played.schedule!.playoffs!.championId!;
    const next = advanceSeason(played);
    const champ = next.teams[champId]!;
    expect(champ.seasonHistory[0]!.championshipResult).toBe('won_super_bowl');
    expect(champ.seasonHistory[0]!.madePlayoffs).toBe(true);
  });

  it('determinism — same seed + same advance cycles → identical state', () => {
    const a = runSeasons('adv-det', 3);
    const b = runSeasons('adv-det', 3);
    expect(a.seasonNumber).toBe(b.seasonNumber);
    expect(a.tick).toBe(b.tick);
    // Spot-check players + contracts; full deepEqual on LeagueState is huge
    // but tractable, and catches drift anywhere in the structure.
    expect(a.players).toEqual(b.players);
    expect(a.contracts).toEqual(b.contracts);
    expect(a.teams).toEqual(b.teams);
  });

  describe('player development', () => {
    it('increments experienceYears for every player', () => {
      const before = simulateSeason(createLeague({ seed: 'adv-exp' }));
      const after = advanceSeason(before);
      for (const before_p of Object.values(before.players)) {
        const after_p = after.players[before_p.id]!;
        expect(after_p.experienceYears).toBe(before_p.experienceYears + 1);
      }
    });

    it('age derived from birthDate increments by 1 per season', () => {
      let league = createLeague({ seed: 'adv-age' });
      const samplePlayer = Object.values(league.players)[0]!;
      const startAge = ageOfPlayer(samplePlayer, league.seasonNumber);
      for (let i = 1; i <= 3; i++) {
        league = simulateSeason(league);
        league = advanceSeason(league);
        const age = ageOfPlayer(samplePlayer, league.seasonNumber);
        expect(age).toBe(startAge + i);
      }
    });

    it('keeps every skill in [1, 99] across multiple seasons', () => {
      const league = runSeasons('adv-bounds', 5);
      for (const player of Object.values(league.players)) {
        for (const value of Object.values(player.current)) {
          expect(value).toBeGreaterThanOrEqual(1);
          expect(value).toBeLessThanOrEqual(99);
        }
      }
    });
  });

  describe('contract advancement', () => {
    it('no contract has yearsRemaining <= 0 after advance', () => {
      const league = runSeasons('adv-contract-renew', 6);
      for (const contract of Object.values(league.contracts)) {
        expect(contract.yearsRemaining).toBeGreaterThan(0);
        expect(contract.yearsRemaining).toBeLessThanOrEqual(contract.realYears);
      }
    });

    it('contract that had 1 year remaining is renewed (realYears reset)', () => {
      const played = simulateSeason(createLeague({ seed: 'adv-renew-detect' }));
      const expiring = Object.values(played.contracts).filter(
        (c) => c.yearsRemaining === 1,
      );
      expect(expiring.length).toBeGreaterThan(0); // sanity: some contracts expire
      const next = advanceSeason(played);
      for (const c of expiring) {
        const renewed = next.contracts[c.id]!;
        // After renewal, yearsRemaining is reset to a fresh contract length;
        // it should match the new realYears (= 1 or 2 per the renewal logic).
        expect(renewed.yearsRemaining).toBe(renewed.realYears);
        expect(renewed.realYears).toBeGreaterThanOrEqual(1);
        expect(renewed.realYears).toBeLessThanOrEqual(2);
      }
    });

    it('contract with multi-year remaining decrements by exactly 1', () => {
      const played = simulateSeason(createLeague({ seed: 'adv-decrement' }));
      const ongoing = Object.values(played.contracts).filter(
        (c) => c.yearsRemaining > 1,
      );
      const next = advanceSeason(played);
      for (const c of ongoing) {
        expect(next.contracts[c.id]!.yearsRemaining).toBe(c.yearsRemaining - 1);
      }
    });
  });

  describe('roster + cap stability', () => {
    it('every team keeps its 53-man roster across multiple seasons', () => {
      const league = runSeasons('adv-roster', 5);
      for (const team of Object.values(league.teams)) {
        expect(team.rosterIds.length).toBe(53);
      }
    });

    it('every roster player still has a resolvable contract after 5 seasons', () => {
      const league = runSeasons('adv-contract-resolve', 5);
      for (const team of Object.values(league.teams)) {
        for (const playerId of team.rosterIds) {
          const player = league.players[playerId]!;
          expect(player.contractId).not.toBeNull();
          const contract = league.contracts[player.contractId!]!;
          expect(contract).toBeDefined();
          expect(currentCapHit(contract)).toBeGreaterThan(0);
        }
      }
    });

    it('average cap usage stays in a plausible band across 5 seasons', () => {
      const league = runSeasons('adv-cap', 5);
      let totalUsage = 0;
      for (const team of Object.values(league.teams)) {
        const summary = summarizeTeamCap(team, league);
        totalUsage += summary.capUsed;
        // Per-team sanity: not impossibly high (more than 2× cap is broken)
        // and not zero (fully renewed-to-nothing rosters are also wrong).
        expect(summary.capUsed).toBeGreaterThan(20_000_000);
        expect(summary.capUsed).toBeLessThan(league.salaryCap * 2);
      }
      const avg = totalUsage / Object.values(league.teams).length;
      // Phase 2 auto-renew is a placeholder; a wide band keeps this from
      // turning into a fragile golden-number test. The point is to catch
      // catastrophic drift, not to pin the exact number.
      expect(avg).toBeGreaterThan(150_000_000);
      expect(avg).toBeLessThan(310_000_000);
    });
  });
});
