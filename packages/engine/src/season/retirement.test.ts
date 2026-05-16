import { describe, it, expect } from 'vitest';
import { Prng } from '../prng/index.js';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from './runner.js';
import { advanceSeason } from './advance.js';
import { ageOfPlayer } from './development.js';
import { rollRetirement, retirementProbabilityForAge } from './retirement.js';

function runSeasons(seed: string, n: number) {
  let league = createLeague({ seed });
  for (let i = 0; i < n; i++) {
    league = simulateSeason(league);
    league = advanceSeason(league);
  }
  return league;
}

describe('retirementProbabilityForAge', () => {
  it('is 0 for any age 33 or under', () => {
    for (let age = 18; age <= 33; age++) {
      expect(retirementProbabilityForAge(age)).toBe(0);
    }
  });

  it('is 1 for age 40 and above', () => {
    expect(retirementProbabilityForAge(40)).toBe(1);
    expect(retirementProbabilityForAge(45)).toBe(1);
  });

  it('monotonically non-decreasing in age', () => {
    let prev = -1;
    for (let age = 18; age <= 50; age++) {
      const p = retirementProbabilityForAge(age);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });
});

describe('rollRetirement', () => {
  it('always returns false for under-34 players', () => {
    const prng = new Prng('roll-young');
    for (let i = 0; i < 100; i++) {
      expect(rollRetirement(prng, 28)).toBe(false);
    }
  });

  it('always returns true for 40+ players', () => {
    const prng = new Prng('roll-old');
    for (let i = 0; i < 50; i++) {
      expect(rollRetirement(prng, 40)).toBe(true);
      expect(rollRetirement(prng, 45)).toBe(true);
    }
  });

  it('returns mixed results for 36-year-olds (~30% retire)', () => {
    const prng = new Prng('roll-36');
    let retired = 0;
    const trials = 1000;
    for (let i = 0; i < trials; i++) {
      if (rollRetirement(prng, 36)) retired++;
    }
    // 30% target, allow ±5% statistical wiggle
    expect(retired).toBeGreaterThan(trials * 0.25);
    expect(retired).toBeLessThan(trials * 0.35);
  });
});

describe('advanceSeason — retirement integration', () => {
  it('retires at least one player per offseason on a 32-team league', () => {
    const played = simulateSeason(createLeague({ seed: 'retire-some' }));
    const before = Object.keys(played.players).length;
    const after = advanceSeason(played);
    const survived = Object.keys(after.players).length;
    // Net player count is constant (rookies replace retirees), so check
    // by intersecting player IDs.
    const beforeIds = new Set(Object.keys(played.players));
    const carried = Object.keys(after.players).filter((id) => beforeIds.has(id));
    const retired = before - carried.length;
    expect(retired).toBeGreaterThan(0);
  });

  it('keeps active + practice-squad population stable across 5 seasons', () => {
    const league = runSeasons('retire-pop', 5);
    let activeTotal = 0;
    let psTotal = 0;
    for (const team of Object.values(league.teams)) {
      activeTotal += team.rosterIds.length;
      psTotal += team.practiceSquadIds.length;
    }
    // Every team always at 53 active + 16 PS post-offseason.
    expect(activeTotal).toBe(32 * 53);
    expect(psTotal).toBe(32 * 16);
    // The full league.players store also holds unsigned free agents
    // (post-expiration leftovers); it stays bounded but isn't fixed at
    // a single number.
    expect(Object.keys(league.players).length).toBeGreaterThanOrEqual(activeTotal + psTotal);
  });

  it('every team stays at 53 active + 16 PS across 5 seasons even with retirement churn', () => {
    const league = runSeasons('retire-rosters', 5);
    for (const team of Object.values(league.teams)) {
      expect(team.rosterIds.length).toBe(53);
      expect(team.practiceSquadIds.length).toBe(16);
    }
  });

  it('caps player age — no one survives past 40 across 8 seasons', () => {
    const league = runSeasons('retire-age-cap', 8);
    for (const player of Object.values(league.players)) {
      const age = ageOfPlayer(player, league.seasonNumber);
      // 40+ retires unconditionally, so the upper bound after advance
      // is exactly 40 (a 39 last year that survived the roll moves to 40).
      expect(age).toBeLessThanOrEqual(40);
    }
  });

  it('average roster age is plausible after 10 seasons (mid-20s to low-30s)', () => {
    const league = runSeasons('retire-age-band', 10);
    const players = Object.values(league.players);
    const avgAge =
      players.reduce((s, p) => s + ageOfPlayer(p, league.seasonNumber), 0) /
      players.length;
    // Without retirement the validation harness saw avg ~37. With
    // retirement the population should reset toward the original
    // distribution (avg ~26). Allow a wide band.
    expect(avgAge).toBeGreaterThan(23);
    expect(avgAge).toBeLessThan(33);
  });

  it('every retiree has their contract dropped from league.contracts', () => {
    const played = simulateSeason(createLeague({ seed: 'retire-contracts' }));
    const beforeContracts = new Set(Object.keys(played.contracts));
    const after = advanceSeason(played);
    const beforePlayerIds = new Set(Object.keys(played.players));
    const afterPlayerIds = new Set(Object.keys(after.players));
    const retiredIds = [...beforePlayerIds].filter((id) => !afterPlayerIds.has(id));
    expect(retiredIds.length).toBeGreaterThan(0);

    for (const retiredId of retiredIds) {
      const retiree = played.players[retiredId]!;
      if (!retiree.contractId) continue;
      // Old contract gone…
      expect(after.contracts[retiree.contractId]).toBeUndefined();
      // …and old contract ID no longer claimed by any surviving player.
      for (const p of Object.values(after.players)) {
        expect(p.contractId).not.toBe(retiree.contractId);
      }
      expect(beforeContracts.has(retiree.contractId)).toBe(true); // sanity
    }
  });

  it('processRetirements no longer auto-generates replacement rookies on active rosters', () => {
    // Slice 5b removed the in-place rookie injection from
    // processRetirements. New active-roster players post-advance are
    // all drafted prospects (CP_-prefixed). No retirement-replacement
    // rookies should appear on any team's active roster.
    //
    // (Practice-squad refill still generates fresh non-CP_ rookies;
    // those are on practiceSquadIds, not rosterIds — excluded by the
    // active-roster filter below.)
    const played = simulateSeason(createLeague({ seed: 'retire-rookies' }));
    const beforeIds = new Set(Object.keys(played.players));
    const after = advanceSeason(played);
    const activeRosterIds = new Set<string>();
    for (const team of Object.values(after.teams)) {
      for (const pid of team.rosterIds) activeRosterIds.add(pid);
    }
    const newActiveNonDraft = Object.keys(after.players)
      .filter((id) => !beforeIds.has(id))
      .filter((id) => activeRosterIds.has(id))
      .filter((id) => !id.startsWith('CP_'));
    expect(newActiveNonDraft.length).toBe(0);
  });

  it('every new on-roster player from advanceSeason has a fresh contract', () => {
    // Post-slice-5b: retirement no longer creates rookies. New on-
    // roster players post-advance are all drafted prospects (CP_-
    // prefixed ids). Each should land with a fresh rookie-scale
    // contract (yearsRemaining === realYears). UDFAs are excluded
    // because they're FAs with no contract.
    const played = simulateSeason(createLeague({ seed: 'retire-fresh-contracts' }));
    const beforeIds = new Set(Object.keys(played.players));
    const after = advanceSeason(played);
    const newOnRosterIds = Object.keys(after.players)
      .filter((id) => !beforeIds.has(id))
      .filter((id) => after.players[id]!.teamId !== null);
    expect(newOnRosterIds.length).toBeGreaterThan(0);
    for (const id of newOnRosterIds) {
      const rookie = after.players[id]!;
      expect(rookie.contractId).not.toBeNull();
      const contract = after.contracts[rookie.contractId!]!;
      expect(contract.yearsRemaining).toBe(contract.realYears);
    }
  });

  it('determinism — retirement outcomes match across identical runs', () => {
    const a = runSeasons('retire-det', 4);
    const b = runSeasons('retire-det', 4);
    expect(Object.keys(a.players).sort()).toEqual(Object.keys(b.players).sort());
    expect(Object.keys(a.contracts).sort()).toEqual(Object.keys(b.contracts).sort());
    expect(a.players).toEqual(b.players);
    expect(a.contracts).toEqual(b.contracts);
  });
});
