import { describe, it, expect } from 'vitest';
import { Prng } from '../prng/index.js';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from './runner.js';
import { advanceSeason } from './advance.js';
import { ageOfPlayer } from './development.js';
import { rollRetirement, retirementProbabilityForAge, rollWashout } from './retirement.js';

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

describe('rollWashout (v0.93 low-skill FA washout)', () => {
  it('never washes out a rostered player (team set)', () => {
    const prng = new Prng('wo-rostered');
    for (let i = 0; i < 100; i++) {
      expect(rollWashout(prng, 'FRINGE', 28, false)).toBe(false);
    }
  });

  it('never washes out a starter-or-better free agent under 27', () => {
    const prng = new Prng('wo-starter');
    for (let i = 0; i < 100; i++) {
      expect(rollWashout(prng, 'STARTER', 24, true)).toBe(false);
      expect(rollWashout(prng, 'STAR', 26, true)).toBe(false);
      expect(rollWashout(prng, 'ELITE', 26, true)).toBe(false);
    }
  });

  it('washes out unsigned vets at the age floor regardless of grade (v0.130.1)', () => {
    // Going unsigned a whole year IS the signal — the measured pool leak was
    // ~1,600 unsigned STARTER+/HIGH_STARTER players idling toward the age
    // curve. 27-29 → 0.25; 30+ → 0.6.
    const trials = 1000;
    let mid = 0;
    let old = 0;
    const prngMid = new Prng('wo-vet-mid');
    const prngOld = new Prng('wo-vet-old');
    for (let i = 0; i < trials; i++) {
      if (rollWashout(prngMid, 'STARTER', 28, true)) mid++;
      if (rollWashout(prngOld, 'HIGH_STARTER', 31, true)) old++;
    }
    expect(mid).toBeGreaterThan(trials * 0.15);
    expect(mid).toBeLessThan(trials * 0.35);
    expect(old).toBeGreaterThan(trials * 0.5);
    expect(old).toBeLessThan(trials * 0.7);
  });

  it('never washes out a sub-23 free agent (give prospects time)', () => {
    const prng = new Prng('wo-young');
    for (let i = 0; i < 100; i++) {
      expect(rollWashout(prng, 'FRINGE', 22, true)).toBe(false);
    }
  });

  it('washes out fringe free agents at a meaningful per-offseason rate', () => {
    const prng = new Prng('wo-fringe');
    let out = 0;
    const trials = 1000;
    for (let i = 0; i < trials; i++) {
      if (rollWashout(prng, 'FRINGE', 25, true)) out++;
    }
    expect(out).toBeGreaterThan(trials * 0.5);
    expect(out).toBeLessThan(trials * 0.7);
  });

  // The players-store boundedness check rides the shared 10-season
  // trajectory below (gate-optimization pass, 2026-07-04) — one walk,
  // asserted EVERY season, instead of its own 10-season sim.
});

describe('advanceSeason — retirement integration', () => {
  // Gate-optimization pass (2026-07-04): five multi-season tests each
  // walked their OWN 5-10 season league (38 season-sims — retirement was
  // ~15 min of the CI wall) to assert independent read-only invariants.
  // One shared 10-season trajectory asserts all of them EVERY season —
  // strictly stronger than the old single point-in-time checks (roster
  // shape was only checked at season 5, the age cap only at season 8)
  // at under half the sim cost.
  it('10-season trajectory: retirements fire, rosters hold 53+16, ages cap at 40, players store bounded, age distribution plausible', () => {
    let league = createLeague({ seed: 'retire-trajectory' });
    for (let season = 1; season <= 10; season++) {
      const played = simulateSeason(league);
      const beforeIds = new Set(Object.keys(played.players));
      const after = advanceSeason(played);

      // At least one player retires EVERY offseason on a 32-team league.
      const carried = Object.keys(after.players).filter((id) => beforeIds.has(id));
      expect(beforeIds.size - carried.length, `season ${season}: retirements`).toBeGreaterThan(0);

      // Every team at exactly 53 active + 16 PS after every offseason,
      // through retirement churn.
      for (const team of Object.values(after.teams)) {
        expect(team.rosterIds.length, `season ${season}: ${team.identity.id} active`).toBe(53);
        expect(team.practiceSquadIds.length, `season ${season}: ${team.identity.id} PS`).toBe(16);
      }

      // Age cap: 40+ retires unconditionally, so the post-advance upper
      // bound is exactly 40 (a surviving 39 moves to 40).
      for (const player of Object.values(after.players)) {
        expect(ageOfPlayer(player, after.seasonNumber)).toBeLessThanOrEqual(40);
      }

      // players store stays bounded (no unsigned pile-up): active 53 +
      // PS 16 × 32 teams = 2208 rostered; the FA pool is the rolling
      // unsigned cohort, which PLATEAUS with the v0.130.1 unsigned-vet
      // age floor — measured ~4,250 at season 10 (equilibrium ~4,300);
      // 4,800 = ~13% seed-variance headroom.
      expect(
        Object.keys(after.players).length,
        `season ${season}: players store`,
      ).toBeLessThan(4800);

      league = after;
    }

    // End state: the population resets toward the generation distribution
    // (avg ~26) instead of aging without bound (~37 pre-retirement).
    const players = Object.values(league.players);
    const avgAge =
      players.reduce((s, p) => s + ageOfPlayer(p, league.seasonNumber), 0) / players.length;
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
