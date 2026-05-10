import { describe, it, expect } from 'vitest';
import {
  signingBonusProrationPerYear,
  capHitForYear,
  currentCapHit,
  teamCapUsage,
  deadMoneyOnPreJune1Release,
} from './cap.js';
import type { Contract } from '../types/contract.js';
import { ContractId, PlayerId, TeamId } from '../types/ids.js';
import { createLeague } from '../league/generate.js';

function makeContract(overrides: Partial<Contract> = {}): Contract {
  return {
    id: ContractId('C_TEST'),
    playerId: PlayerId('P_TEST'),
    teamId: TeamId('TST'),
    signedOnTick: 0,
    realYears: 4,
    voidYears: 0,
    yearsRemaining: 4,
    baseSalaries: [1_000_000, 5_000_000, 8_000_000, 10_000_000],
    signingBonus: 20_000_000,
    rosterBonuses: [0, 0, 0, 0],
    workoutBonuses: [0, 0, 0, 0],
    guarantees: [
      { baseGuaranteedPct: 100, type: 'FULLY_GUARANTEED' },
      { baseGuaranteedPct: 100, type: 'FULLY_GUARANTEED' },
      { baseGuaranteedPct: 0, type: 'NONE' },
      { baseGuaranteedPct: 0, type: 'NONE' },
    ],
    incentives: [],
    noTradeClause: false,
    ...overrides,
  };
}

describe('signingBonusProrationPerYear', () => {
  it('divides bonus evenly across realYears (≤5 cap)', () => {
    const c = makeContract({ signingBonus: 20_000_000, realYears: 4 });
    expect(signingBonusProrationPerYear(c)).toBe(5_000_000);
  });

  it('caps proration at 5 years even for longer contracts', () => {
    const c = makeContract({ signingBonus: 30_000_000, realYears: 6 });
    expect(signingBonusProrationPerYear(c)).toBe(6_000_000); // 30M / 5
  });

  it('respects void years for proration extension', () => {
    const c = makeContract({ signingBonus: 30_000_000, realYears: 3, voidYears: 2 });
    expect(signingBonusProrationPerYear(c)).toBe(6_000_000); // 30M / 5
  });

  it('returns 0 for a zero-year shell', () => {
    const c = makeContract({ signingBonus: 5_000_000, realYears: 0, voidYears: 0 });
    expect(signingBonusProrationPerYear(c)).toBe(0);
  });
});

describe('capHitForYear', () => {
  it('combines base salary, bonuses, and prorated signing bonus', () => {
    const c = makeContract();
    // year 0: base 1M + bonus 0 + workout 0 + proration 5M = 6M
    expect(capHitForYear(c, 0)).toBe(6_000_000);
    // year 1: 5M + 5M = 10M
    expect(capHitForYear(c, 1)).toBe(10_000_000);
    // year 3: 10M + 5M = 15M
    expect(capHitForYear(c, 3)).toBe(15_000_000);
  });

  it('returns 0 for years past contract length', () => {
    const c = makeContract();
    expect(capHitForYear(c, 4)).toBe(0);
    expect(capHitForYear(c, -1)).toBe(0);
  });
});

describe('currentCapHit', () => {
  it('uses (realYears - yearsRemaining) as year-of-deal index', () => {
    const c = makeContract({ yearsRemaining: 2 }); // year 2 of 4 → index 2
    expect(currentCapHit(c)).toBe(13_000_000); // 8M + 5M
  });

  it('handles a freshly-signed deal (yearsRemaining = realYears)', () => {
    const c = makeContract({ yearsRemaining: 4 });
    expect(currentCapHit(c)).toBe(6_000_000); // 1M + 5M
  });
});

describe('teamCapUsage — top-51 vs all-53', () => {
  it('offseason phases use top-51; regular season uses all-53', () => {
    const offseason = createLeague({ seed: 'top51-offseason' });
    expect(offseason.phase).toBe('OFFSEASON_PRE_FA');
    const team = Object.values(offseason.teams)[0]!;

    const offseasonCap = teamCapUsage(team, offseason);
    const regSeasonCap = teamCapUsage(team, { ...offseason, phase: 'REGULAR_SEASON' });

    // All-53 must include at least as much as top-51 (the bottom-2 cap
    // hits get included in regular-season accounting).
    expect(team.rosterIds.length).toBe(53);
    expect(regSeasonCap).toBeGreaterThan(offseasonCap);
  });

  it('top-51 excludes exactly the two cheapest contracts', () => {
    const offseason = createLeague({ seed: 'top51-bottom2' });
    const team = Object.values(offseason.teams)[0]!;
    const allHits: number[] = [];
    for (const playerId of team.rosterIds) {
      const player = offseason.players[playerId]!;
      const contract = offseason.contracts[player.contractId!]!;
      allHits.push(currentCapHit(contract));
    }
    allHits.sort((a, b) => a - b);
    const bottom2 = allHits[0]! + allHits[1]!;
    const allSum = allHits.reduce((s, h) => s + h, 0);

    const offseasonCap = teamCapUsage(team, offseason);
    const regSeasonCap = teamCapUsage(team, { ...offseason, phase: 'REGULAR_SEASON' });

    expect(regSeasonCap).toBe(allSum);
    expect(offseasonCap).toBe(allSum - bottom2);
  });

  it('dead money is always counted regardless of phase', () => {
    const base = createLeague({ seed: 'top51-dead' });
    const team = Object.values(base.teams)[0]!;
    const teamWithDead = { ...team, deadMoneyByYear: [5_000_000] };
    const leagueOffseason = {
      ...base,
      teams: { ...base.teams, [team.identity.id]: teamWithDead } as typeof base.teams,
    };
    const leagueRegSeason = { ...leagueOffseason, phase: 'REGULAR_SEASON' as const };

    const baseOffseason = teamCapUsage(team, base);
    const baseRegSeason = teamCapUsage(team, { ...base, phase: 'REGULAR_SEASON' });

    expect(teamCapUsage(teamWithDead, leagueOffseason)).toBe(baseOffseason + 5_000_000);
    expect(teamCapUsage(teamWithDead, leagueRegSeason)).toBe(baseRegSeason + 5_000_000);
  });
});

describe('deadMoneyOnPreJune1Release', () => {
  it('accelerates remaining proration to current cap', () => {
    const c = makeContract({ yearsRemaining: 4 });
    // 4 years × 5M proration = 20M (the full signing bonus accelerates).
    // Plus year-0 + year-1 fully-guaranteed bases (1M + 5M = 6M).
    expect(deadMoneyOnPreJune1Release(c)).toBe(20_000_000 + 6_000_000);
  });

  it('decreases as the contract progresses (less remaining proration)', () => {
    const earlier = makeContract({ yearsRemaining: 4 });
    const later = makeContract({ yearsRemaining: 2 });
    expect(deadMoneyOnPreJune1Release(earlier)).toBeGreaterThan(
      deadMoneyOnPreJune1Release(later),
    );
  });
});
