import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from '../season/runner.js';
import { advanceSeason } from '../season/advance.js';
import type { LeagueState } from '../types/league.js';
import type { Contract } from '../types/contract.js';
import type { TeamId, PlayerId } from '../types/ids.js';
import { ContractId } from '../types/ids.js';
import { teamCapUsage, currentCapHit, capHitForYear } from '../contracts/cap.js';
import { teamSeasonCash } from '../contracts/cash.js';
import { leagueMinimumSalary } from '../contracts/constants.js';
import { enforceRosterFloor, selectFloorRestructure } from './roster-floor.js';
import { restructureContract } from './restructures.js';

/**
 * Rebuild the sorted-first team into a controlled cap-PINNED, sub-53 state:
 * keep `keep` roster players (the rest become signable free agents), replace
 * each kept player's contract via `makeContract`, then set the salary cap so
 * the team sits `roomDollars` under it — deliberately less than one minimum
 * salary, so the team can't fill its last slots without freeing room. `phase`
 * selects the cap-accounting rule (offseason top-51 vs in-season all-53).
 */
function pinFirstTeam(
  seed: string,
  opts: {
    keep: number;
    roomDollars: number;
    phase: LeagueState['phase'];
    makeContract: (playerId: PlayerId, index: number) => Contract;
  },
): { league: LeagueState; teamId: TeamId; minSalary: number } {
  let league = createLeague({ seed });
  league = { ...league, phase: opts.phase };
  const teamId = (Object.keys(league.teams) as TeamId[]).sort()[0]!;
  const team = league.teams[teamId]!;

  const players = { ...league.players };
  const contracts = { ...league.contracts };
  const kept: PlayerId[] = [];

  team.rosterIds.forEach((pid, index) => {
    const player = players[pid]!;
    // Drop the old contract regardless.
    if (player.contractId) delete contracts[player.contractId];
    if (index < opts.keep) {
      const contract = { ...opts.makeContract(pid, index), teamId };
      contracts[contract.id] = contract;
      players[pid] = { ...player, teamId, contractId: contract.id };
      kept.push(pid);
    } else {
      // Trimmed → signable free agent.
      players[pid] = { ...player, teamId: null, contractId: null };
    }
  });

  const pinnedTeam = { ...team, rosterIds: kept };
  league = {
    ...league,
    players: players as LeagueState['players'],
    contracts: contracts as LeagueState['contracts'],
    teams: { ...league.teams, [teamId]: pinnedTeam } as LeagueState['teams'],
  };

  const usage = teamCapUsage(pinnedTeam, league);
  const salaryCap = usage + opts.roomDollars;
  league = { ...league, salaryCap };
  return { league, teamId, minSalary: leagueMinimumSalary(salaryCap) };
}

/** A restructurable multi-year deal: big convertible base + a real bonus. */
function megaDeal(playerId: PlayerId, currentBase: number): Contract {
  return {
    id: ContractId(`C_MEGA_${playerId}`),
    playerId,
    teamId: 'T' as Contract['teamId'],
    signedOnTick: 0,
    realYears: 5,
    voidYears: 0,
    yearsRemaining: 4, // year-of-deal 1 → currentBase lives at index 1
    baseSalaries: [10_000_000, currentBase, currentBase, currentBase, currentBase],
    signingBonus: 25_000_000,
    rosterBonuses: [0, 0, 0, 0, 0],
    workoutBonuses: [0, 0, 0, 0, 0],
    guarantees: [
      { baseGuaranteedPct: 100, type: 'FULLY_GUARANTEED' },
      { baseGuaranteedPct: 0, type: 'NONE' },
      { baseGuaranteedPct: 0, type: 'NONE' },
      { baseGuaranteedPct: 0, type: 'NONE' },
      { baseGuaranteedPct: 0, type: 'NONE' },
    ],
    incentives: [],
    noTradeClause: false,
  };
}

/** A 1-year deal — never restructure-eligible (yearsRemaining < 2). */
function oneYearDeal(
  playerId: PlayerId,
  base: number,
  guaranteed: boolean,
): Contract {
  return {
    id: ContractId(`C_1YR_${playerId}`),
    playerId,
    teamId: 'T' as Contract['teamId'],
    signedOnTick: 0,
    realYears: 1,
    voidYears: 0,
    yearsRemaining: 1,
    baseSalaries: [base],
    signingBonus: 0,
    rosterBonuses: [0],
    workoutBonuses: [0],
    guarantees: [
      guaranteed
        ? { baseGuaranteedPct: 100, type: 'FULLY_GUARANTEED' }
        : { baseGuaranteedPct: 0, type: 'NONE' },
    ],
    incentives: [],
    noTradeClause: false,
  };
}

const floorTxns = (league: LeagueState, kind: string) =>
  league.transactionLog.filter(
    (t) => t.kind === kind && (t as { forFloor?: true }).forFloor === true,
  );

describe('enforceRosterFloor — rung 1 (restructure-first)', () => {
  it('fills a cap-pinned team to exactly 53 via minimal-footprint restructure', () => {
    // 48 players, one restructurable mega-deal, $0.4M of room (< min salary).
    const { league, teamId } = pinFirstTeam('floor-rung1', {
      keep: 48,
      roomDollars: 400_000,
      phase: 'OFFSEASON_TRANSACTIONS',
      makeContract: (pid, i) =>
        i === 0 ? megaDeal(pid, 30_000_000) : oneYearDeal(pid, 3_000_000, false),
    });

    const before = league.teams[teamId]!.rosterIds.length;
    expect(before).toBe(48);

    const after = enforceRosterFloor(league, league.tick);
    const team = after.teams[teamId]!;

    // Back to exactly 53 and compliant.
    expect(team.rosterIds.length).toBe(53);
    expect(teamCapUsage(team, after)).toBeLessThanOrEqual(after.salaryCap);

    // Rung 1 only: restructures fired, no fringe cut.
    const restructures = floorTxns(after, 'restructure');
    const cuts = floorTxns(after, 'cap-cut');
    expect(restructures.length).toBeGreaterThanOrEqual(1);
    expect(cuts.length).toBe(0);
    expect(floorTxns(after, 'fa-sign').length).toBe(5); // the five refills

    // Minimal footprint: it converted far less than the $30M base could give
    // (a war-chest pass converts the whole base).
    const totalConverted = restructures.reduce(
      (s, t) => s + (t as { convertedAmount: number }).convertedAmount,
      0,
    );
    expect(totalConverted).toBeLessThan(10_000_000);
  });

  it('is deterministic and PRNG-free (same output twice, no fork consumed)', () => {
    const build = () =>
      pinFirstTeam('floor-det', {
        keep: 49,
        roomDollars: 300_000,
        phase: 'OFFSEASON_TRANSACTIONS',
        makeContract: (pid, i) =>
          i === 0 ? megaDeal(pid, 28_000_000) : oneYearDeal(pid, 2_500_000, false),
      }).league;
    const a = enforceRosterFloor(build(), 100);
    const b = enforceRosterFloor(build(), 100);
    expect(a.teams).toEqual(b.teams);
    expect(a.contracts).toEqual(b.contracts);
    expect(a.transactionLog).toEqual(b.transactionLog);
  });
});

describe('enforceRosterFloor — rung 2 (fringe cut)', () => {
  it('cuts the cheapest sufficient vet when nothing is restructurable', () => {
    // All 1-year deals (nothing convertible) → rung 1 finds nothing, rung 2
    // sheds a fringe vet to free room, then refills to 53.
    const { league, teamId } = pinFirstTeam('floor-rung2', {
      keep: 48,
      roomDollars: 300_000,
      phase: 'OFFSEASON_TRANSACTIONS',
      makeContract: (pid) => oneYearDeal(pid, 4_000_000, false),
    });

    const after = enforceRosterFloor(league, league.tick);
    const team = after.teams[teamId]!;

    expect(team.rosterIds.length).toBe(53);
    expect(teamCapUsage(team, after)).toBeLessThanOrEqual(after.salaryCap);
    expect(floorTxns(after, 'restructure').length).toBe(0);
    const cuts = floorTxns(after, 'cap-cut');
    expect(cuts.length).toBeGreaterThanOrEqual(1);
    for (const c of cuts) {
      expect((c as { capSaving: number }).capSaving).toBeGreaterThan(0);
    }
  });
});

describe('enforceRosterFloor — rung 4 (loud failure)', () => {
  it('logs a roster-floor-violation on an unclearable state instead of a silent sub-53', () => {
    // A hand-built IMPOSSIBLE state, unreachable in generated leagues: every
    // deal is a 1-year FULLY-GUARANTEED contract, so nothing is restructurable
    // (yearsRemaining < 2) AND no cut has a positive saving (dead money ==
    // cap hit). A generated pinned team instead carries large MULTI-YEAR deals
    // (rung-1 convertible) — verified by D0-P2 (0 unclearable pins / 7,680
    // team-seasons). The floor's guarantee is "53 or a red test", never a
    // silent 48.
    const { league, teamId } = pinFirstTeam('floor-rung4', {
      keep: 48,
      roomDollars: 200_000,
      phase: 'OFFSEASON_TRANSACTIONS',
      makeContract: (pid) => oneYearDeal(pid, 4_000_000, true),
    });

    const after = enforceRosterFloor(league, league.tick);
    const team = after.teams[teamId]!;

    expect(team.rosterIds.length).toBeLessThan(53); // could not reach 53
    const violations = after.transactionLog.filter(
      (t) => t.kind === 'roster-floor-violation',
    );
    expect(violations.length).toBe(1);
    expect((violations[0] as { teamId: TeamId }).teamId).toBe(teamId);
    expect((violations[0] as { rosterSize: number }).rosterSize).toBe(
      team.rosterIds.length,
    );
  });
});

describe('enforceRosterFloor — body-supply gap (v0.186.1 net-zero cut/re-sign fix)', () => {
  it('does not cut+re-sign the same fringe vet when the FA pool is empty', () => {
    // The tsp-8/NO pathology: a cap-PINNED sub-53 team whose league FA pool is
    // empty. Rung 1 has nothing to restructure (all 1-year deals). Pre-fix, rung
    // 2 cut the cheapest vet to free room; that vet became the ONLY free agent,
    // so `signFloorMinimum` re-signed the SAME just-cut player — zero net roster
    // gain, dead money booked, and a spurious roster-floor-violation, repeated
    // every mid-season week. Post-fix, the body-supply guard recognizes 53 is
    // unreachable without a body to fill it and leaves the team short WITHOUT
    // churn or a cap violation (the boundary + next draft replenish the pool).
    //
    // Build: keep 52 (deficit 1), pin under the cap, then drain the FA pool so
    // NO teamId===null player remains anywhere in the league.
    const { league, teamId } = pinFirstTeam('floor-supply-gap', {
      keep: 52,
      roomDollars: 300_000, // < one min salary → pinned
      phase: 'REGULAR_SEASON',
      makeContract: (pid) => oneYearDeal(pid, 4_000_000, false), // cuttable, not restructurable
    });
    // Drain the pool: park every free agent on a throwaway roster slot so the
    // supply is genuinely zero (mirrors the mid-season all-owned state).
    const otherTeamId = (Object.keys(league.teams) as TeamId[]).sort()[1]!;
    const playersDrained = { ...league.players };
    const parked: PlayerId[] = [];
    for (const [pid, p] of Object.entries(league.players)) {
      if (p.teamId === null) {
        playersDrained[pid as PlayerId] = { ...p, teamId: otherTeamId };
        parked.push(pid as PlayerId);
      }
    }
    const other = league.teams[otherTeamId]!;
    const drained: LeagueState = {
      ...league,
      players: playersDrained as LeagueState['players'],
      teams: {
        ...league.teams,
        [otherTeamId]: { ...other, rosterIds: [...other.rosterIds, ...parked] },
      } as LeagueState['teams'],
    };
    // Sanity: the pinned team is short and no free agent exists.
    expect(drained.teams[teamId]!.rosterIds.length).toBe(52);
    expect(Object.values(drained.players).filter((p) => p.teamId === null).length).toBe(0);

    const after = enforceRosterFloor(drained, 200);

    // No churn: the team was NOT touched (no fringe cut, no re-sign, no dead
    // money booked) and — critically — NO spurious roster-floor-violation.
    expect(floorTxns(after, 'cap-cut').length).toBe(0);
    expect(floorTxns(after, 'fa-sign').length).toBe(0);
    expect(floorTxns(after, 'restructure').length).toBe(0);
    expect(after.transactionLog.filter((t) => t.kind === 'roster-floor-violation').length).toBe(0);
    // Left honestly short at 52 (a body genuinely does not exist to fill it).
    expect(after.teams[teamId]!.rosterIds.length).toBe(52);
    // Untouched by reference — the guard skips before any world-state change.
    expect(after).toBe(drained);
  });

  it('still fills to 53 when the pool has exactly `deficit` bodies (guard is not over-eager)', () => {
    // The guard skips ONLY when supply < deficit. With exactly `deficit` bodies
    // available, the ladder must still reach 53 as before (no regression).
    const { league, teamId } = pinFirstTeam('floor-supply-exact', {
      keep: 50, // deficit 3
      roomDollars: 300_000,
      phase: 'REGULAR_SEASON',
      makeContract: (pid, i) =>
        i === 0 ? megaDeal(pid, 26_000_000) : oneYearDeal(pid, 2_000_000, false),
    });
    // pinFirstTeam already trimmed the other 3 into the FA pool; keep exactly
    // those 3 by parking any surplus FAs elsewhere.
    const fas = Object.values(league.players).filter((p) => p.teamId === null);
    expect(fas.length).toBeGreaterThanOrEqual(3);
    const otherTeamId = (Object.keys(league.teams) as TeamId[]).sort()[1]!;
    const playersTrim = { ...league.players };
    const parked: PlayerId[] = [];
    fas.slice(3).forEach((p) => {
      playersTrim[p.id] = { ...p, teamId: otherTeamId };
      parked.push(p.id);
    });
    const other = league.teams[otherTeamId]!;
    const trimmed: LeagueState = {
      ...league,
      players: playersTrim as LeagueState['players'],
      teams: {
        ...league.teams,
        [otherTeamId]: { ...other, rosterIds: [...other.rosterIds, ...parked] },
      } as LeagueState['teams'],
    };
    expect(Object.values(trimmed.players).filter((p) => p.teamId === null).length).toBe(3);

    const after = enforceRosterFloor(trimmed, 200);
    expect(after.teams[teamId]!.rosterIds.length).toBe(53);
    expect(teamCapUsage(after.teams[teamId]!, after)).toBeLessThanOrEqual(after.salaryCap);
    expect(after.transactionLog.filter((t) => t.kind === 'roster-floor-violation').length).toBe(0);
  });
});

describe('enforceRosterFloor — mid-season posture', () => {
  it('fills a pinned in-season team (post-IR shape) back to 53', () => {
    // REGULAR_SEASON = all-53 cap accounting. A team dropped below 53 that
    // can't afford its vet-min replacement gets the same ladder (design §3).
    const { league, teamId } = pinFirstTeam('floor-midseason', {
      keep: 50,
      roomDollars: 300_000,
      phase: 'REGULAR_SEASON',
      makeContract: (pid, i) =>
        i === 0 ? megaDeal(pid, 26_000_000) : oneYearDeal(pid, 2_000_000, false),
    });

    const after = enforceRosterFloor(league, 200);
    const team = after.teams[teamId]!;
    expect(team.rosterIds.length).toBe(53);
    expect(teamCapUsage(team, after)).toBeLessThanOrEqual(after.salaryCap);
    expect(floorTxns(after, 'restructure').length).toBeGreaterThanOrEqual(1);
  });

  it('leaves a short-but-AFFORDABLE team alone (that is the weekly FA pass, not the floor)', () => {
    // 52 players with a full min salary of room — the floor must NOT engage
    // (it would sign an off-position body); the position-matched weekly FA
    // pass owns this fill.
    const { league, teamId, minSalary } = pinFirstTeam('floor-affordable', {
      keep: 52,
      roomDollars: 5_000_000, // >> one min salary
      phase: 'REGULAR_SEASON',
      makeContract: (pid) => oneYearDeal(pid, 2_000_000, false),
    });
    expect(5_000_000).toBeGreaterThan(minSalary); // sanity: genuinely affordable

    const after = enforceRosterFloor(league, 200);
    expect(after).toBe(league); // untouched — same reference
    expect(after.teams[teamId]!.rosterIds.length).toBe(52);
  });
});

describe('enforceRosterFloor — no-op identity', () => {
  it('returns the same league reference when every team is already at 53', () => {
    const league = createLeague({ seed: 'floor-noop' });
    for (const team of Object.values(league.teams)) {
      expect(team.rosterIds.length).toBe(53); // fresh leagues field full rosters
    }
    expect(enforceRosterFloor(league, league.tick)).toBe(league);
  });
});

describe('restructureContract — maxConvert (minimal footprint)', () => {
  it('converts only the capped amount, conserves future cap, books cash = converted', () => {
    const cap = 200_000_000;
    const old = megaDeal('P1' as PlayerId, 30_000_000);
    const yearOfDeal = old.realYears - old.yearsRemaining; // 1
    const minSalary = leagueMinimumSalary(cap);
    const fullConvertible = (old.baseSalaries[yearOfDeal] ?? 0) - minSalary;

    const result = restructureContract(old, 'PARTIAL', 100, cap, 4_000_000)!;
    expect(result).not.toBeNull();
    const next = result.contract;

    // Partial: less than the whole above-minimum base.
    expect(result.converted).toBeLessThan(fullConvertible);
    expect(result.converted).toBeGreaterThanOrEqual(2_000_000); // >= MIN_CONVERTIBLE
    expect(result.converted).toBeLessThanOrEqual(4_000_000 + 1); // clamp to maxConvert

    // Residual base = old base − converted (a FULL convert would leave the min).
    expect(next.baseSalaries[0]).toBe((old.baseSalaries[yearOfDeal] ?? 0) - result.converted);
    expect(next.baseSalaries[0]).toBeGreaterThan(minSalary);

    // Cash booked is only the converted base (cash-neutral: the player was
    // getting that base anyway).
    expect(next.signingBonusCashPaid).toBe(result.converted);

    // Conservation: future cap total preserved (only rounding drifts).
    const oldFuture =
      capHitForYear(old, yearOfDeal) +
      capHitForYear(old, yearOfDeal + 1) +
      capHitForYear(old, yearOfDeal + 2) +
      capHitForYear(old, yearOfDeal + 3);
    const newFuture =
      capHitForYear(next, 0) +
      capHitForYear(next, 1) +
      capHitForYear(next, 2) +
      capHitForYear(next, 3);
    expect(Math.abs(newFuture - oldFuture)).toBeLessThan(5_000);

    // Relief this year is real.
    expect(currentCapHit(old) - currentCapHit(next)).toBeGreaterThan(0);
  });

  it('omitting maxConvert is bit-identical to the pre-floor full conversion', () => {
    const old = megaDeal('P2' as PlayerId, 22_000_000);
    const a = restructureContract(old, 'X', 100, 200_000_000);
    const b = restructureContract(old, 'X', 100, 200_000_000, undefined);
    expect(a).toEqual(b);
    // Full conversion leaves exactly the league minimum in the current year.
    expect(a!.contract.baseSalaries[0]).toBe(leagueMinimumSalary(200_000_000));
  });
});

describe('selectFloorRestructure', () => {
  it('prefers the smallest sufficient convertible; falls back to largest', () => {
    // Two restructurable deals: a $30M mega (huge relief) and a $6M mid deal.
    // For a small need both are sufficient → pick the smaller convertible.
    const { league, teamId } = pinFirstTeam('floor-select', {
      keep: 48,
      roomDollars: 300_000,
      phase: 'OFFSEASON_TRANSACTIONS',
      makeContract: (pid, i) => {
        if (i === 0) return megaDeal(pid, 30_000_000);
        if (i === 1) return megaDeal(pid, 6_000_000);
        return oneYearDeal(pid, 2_000_000, false);
      },
    });
    const team = league.teams[teamId]!;
    const smallNeed = selectFloorRestructure(team, league, 1_000_000);
    expect(smallNeed).not.toBeNull();
    // The $6M deal's convertible is smaller than the $30M deal's → chosen.
    const chosen = league.players[smallNeed!.playerId]!;
    const chosenContract = league.contracts[chosen.contractId!]!;
    expect(chosenContract.baseSalaries[chosenContract.realYears - chosenContract.yearsRemaining]).toBe(
      6_000_000,
    );

    // A need bigger than the $6M deal can supply but within the $30M deal →
    // the mega deal (largest) carries it.
    const bigNeed = selectFloorRestructure(team, league, 8_000_000);
    const big = league.players[bigNeed!.playerId]!;
    const bigContract = league.contracts[big.contractId!]!;
    expect(bigContract.baseSalaries[bigContract.realYears - bigContract.yearsRemaining]).toBe(
      30_000_000,
    );
  });
});

describe('enforceRosterFloor — cash floor never breached', () => {
  it('floor fills only ADD cash (restructures are cash-neutral)', () => {
    const { league, teamId } = pinFirstTeam('floor-cash', {
      keep: 49,
      roomDollars: 300_000,
      phase: 'OFFSEASON_TRANSACTIONS',
      makeContract: (pid, i) =>
        i === 0 ? megaDeal(pid, 30_000_000) : oneYearDeal(pid, 3_000_000, false),
    });
    const cashBefore = teamSeasonCash(league.teams[teamId]!, league);
    const after = enforceRosterFloor(league, league.tick);
    const cashAfter = teamSeasonCash(after.teams[teamId]!, after);
    // Enforcement can only push a team TOWARD the cash floor (fills add cash),
    // never under it. Restructures book only cash the player was already owed.
    expect(cashAfter).toBeGreaterThanOrEqual(cashBefore);
  });
});

describe('advanceSeason — retire-trajectory season-8 ATL floor regression', () => {
  it('opens ATL (and every team) at exactly 53 through season 8', () => {
    // The original find: under Season Form D1, seed retire-trajectory strands
    // ATL at 48 (season 8) — a compliant-but-cap-strapped team with no room
    // for its 53rd body. INV-FLOOR makes this exact-53. (The 10-season
    // trajectory in retirement.test.ts asserts this every season; this pins
    // the named reproduction directly.)
    let league = createLeague({ seed: 'retire-trajectory' });
    for (let season = 1; season <= 8; season++) {
      league = simulateSeason(league);
      league = advanceSeason(league);
    }
    const atl = Object.values(league.teams).find((t) => t.identity.id === 'ATL')!;
    expect(atl.rosterIds.length).toBe(53);
    for (const team of Object.values(league.teams)) {
      expect(team.rosterIds.length, `${team.identity.id}`).toBe(53);
      expect(teamCapUsage(team, league)).toBeLessThanOrEqual(league.salaryCap);
    }
  });
});
