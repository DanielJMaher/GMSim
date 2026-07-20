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

  // Gate-optimization pass (2026-07-04): six multi-season tests each
  // walked their OWN 5-6 season league (31 season-sims — advance was
  // ~16 min of the CI wall) to assert independent invariants, most only
  // at the END state. One shared 6-season trajectory asserts all of them
  // EVERY season — strictly stronger at a fifth of the sim cost.
  it('6-season trajectory: history appends, skills bounded, contracts renew, rosters hold 53, contracts resolve, cap band', () => {
    let league = createLeague({ seed: 'adv-trajectory' });
    expect(Object.values(league.teams)[0]!.seasonHistory.length).toBe(0);

    for (let season = 1; season <= 6; season++) {
      league = advanceSeason(simulateSeason(league));

      // One TeamSeasonRecord per team per advance, dated to the season.
      for (const team of Object.values(league.teams)) {
        expect(team.seasonHistory.length, `season ${season}: history`).toBe(season);
        expect(team.seasonHistory[season - 1]!.seasonNumber).toBe(season);
      }

      // Development keeps every skill in [1, 99].
      for (const player of Object.values(league.players)) {
        for (const value of Object.values(player.current)) {
          expect(value).toBeGreaterThanOrEqual(1);
          expect(value).toBeLessThanOrEqual(99);
        }
      }

      // Contract advancement: nothing lingers at/below 0 years remaining.
      for (const contract of Object.values(league.contracts)) {
        expect(contract.yearsRemaining).toBeGreaterThan(0);
        expect(contract.yearsRemaining).toBeLessThanOrEqual(contract.realYears);
      }

      // Every team at exactly 53 with every rostered player on a resolvable,
      // positive-cap-hit contract. INV-FLOOR (v0.186, `enforceRosterFloor`):
      // the under-53 half is guaranteed by the restructure-first floor ladder
      // (a compliant-but-cap-strapped team frees room for its 53rd body), the
      // over-53 half by the POST_DRAFT_ROSTER cutdown.
      for (const team of Object.values(league.teams)) {
        expect(team.rosterIds.length, `season ${season}: ${team.identity.id}`).toBe(53);
        for (const playerId of team.rosterIds) {
          const player = league.players[playerId]!;
          expect(player.contractId).not.toBeNull();
          const contract = league.contracts[player.contractId!]!;
          expect(contract).toBeDefined();
          expect(currentCapHit(contract)).toBeGreaterThan(0);
        }
      }

      // Average cap usage in a plausible cap-relative band (the cap grows
      // ~6%/yr — v0.176). Wide: catches catastrophic drift, not exact values.
      let totalUsage = 0;
      for (const team of Object.values(league.teams)) {
        const summary = summarizeTeamCap(team, league);
        totalUsage += summary.capUsed;
        expect(summary.capUsed).toBeGreaterThan(20_000_000);
        expect(summary.capUsed).toBeLessThan(league.salaryCap * 2);
      }
      const avg = totalUsage / Object.values(league.teams).length;
      expect(avg / league.salaryCap, `season ${season}: cap usage`).toBeGreaterThan(0.55);
      expect(avg / league.salaryCap, `season ${season}: cap usage`).toBeLessThan(1.0);
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
    it('increments experienceYears for every surviving player', () => {
      const before = simulateSeason(createLeague({ seed: 'adv-exp' }));
      const after = advanceSeason(before);
      let checked = 0;
      for (const before_p of Object.values(before.players)) {
        const after_p = after.players[before_p.id];
        // Player may have retired and been removed; covered by retirement tests.
        if (!after_p) continue;
        expect(after_p.experienceYears).toBe(before_p.experienceYears + 1);
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
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

    // Skill bounds ride the shared 6-season trajectory above.
  });

  describe('contract advancement', () => {
    // Contract-renewal boundedness rides the shared 6-season trajectory above.

    it('contract that had 1 year remaining expires — original contract is dropped', () => {
      const played = simulateSeason(createLeague({ seed: 'adv-renew-detect' }));
      const expiring = Object.values(played.contracts).filter(
        (c) => c.yearsRemaining === 1,
      );
      expect(expiring.length).toBeGreaterThan(0); // sanity: some contracts expire
      const next = advanceSeason(played);
      for (const c of expiring) {
        // Original contract IDs no longer appear in the league after expiration.
        // The player either becomes a free agent or signs a new (different-ID)
        // 1-year prove-it deal during the offseason refill.
        expect(next.contracts[c.id]).toBeUndefined();
      }
    });

    it('expired-contract player is either retired, a free agent, or signed to a fresh tier-appropriate deal', () => {
      const played = simulateSeason(createLeague({ seed: 'adv-fa-or-sign' }));
      const expiring = Object.values(played.contracts).filter(
        (c) => c.yearsRemaining === 1,
      );
      const next = advanceSeason(played);
      let stillInLeague = 0;
      let onTeam = 0;
      for (const c of expiring) {
        const player = next.players[c.playerId];
        if (!player) continue; // retired and removed
        stillInLeague++;
        if (player.teamId === null) {
          expect(player.contractId).toBeNull();
        } else {
          onTeam++;
          const newContract = next.contracts[player.contractId!]!;
          expect(newContract).toBeDefined();
          expect(newContract.id).not.toBe(c.id); // fresh contract, not the same ID
          expect(newContract.yearsRemaining).toBe(newContract.realYears);
          // FA market deals: STAR=4, STARTER=3, BACKUP=2, FRINGE=1.
          expect(newContract.realYears).toBeGreaterThanOrEqual(1);
          expect(newContract.realYears).toBeLessThanOrEqual(4);
        }
      }
      expect(stillInLeague).toBeGreaterThan(0);
      expect(onTeam).toBeGreaterThan(0);
    });

    it('contract with multi-year remaining decrements by exactly 1', () => {
      const played = simulateSeason(createLeague({ seed: 'adv-decrement' }));
      const ongoing = Object.values(played.contracts).filter(
        (c) => c.yearsRemaining > 1,
      );
      const next = advanceSeason(played);
      let checked = 0;
      for (const c of ongoing) {
        const after = next.contracts[c.id];
        if (!after) continue; // retired
        expect(after.yearsRemaining).toBe(c.yearsRemaining - 1);
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
    });
  });

  // roster + cap stability (53-man rosters, resolvable contracts, cap
  // band) rides the shared 6-season trajectory above — asserted every
  // season instead of once at season 5.
});
