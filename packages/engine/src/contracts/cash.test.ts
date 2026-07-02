import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from '../season/runner.js';
import { advanceSeason } from '../season/advance.js';
import type { Contract } from '../types/contract.js';
import type { LeagueState } from '../types/league.js';
import type { TeamState } from '../types/team.js';
import { ContractId } from '../types/ids.js';
import {
  CASH_FLOOR_PCT,
  CASH_FLOOR_WINDOW,
  contractSeasonCash,
  teamCashFloorStatus,
} from './cash.js';
import { restructureContract } from '../transactions/restructures.js';

function makeContract(overrides: Partial<Contract> = {}): Contract {
  return {
    id: ContractId('C_CASH'),
    playerId: 'P1' as Contract['playerId'],
    teamId: 'T1' as Contract['teamId'],
    signedOnTick: 0,
    realYears: 3,
    voidYears: 0,
    yearsRemaining: 3,
    baseSalaries: [4_000_000, 6_000_000, 8_000_000],
    signingBonus: 9_000_000,
    rosterBonuses: [500_000, 0, 0],
    workoutBonuses: [0, 100_000, 0],
    guarantees: [
      { baseGuaranteedPct: 100, type: 'FULLY_GUARANTEED' },
      { baseGuaranteedPct: 0, type: 'NONE' },
      { baseGuaranteedPct: 0, type: 'NONE' },
    ],
    incentives: [],
    noTradeClause: false,
    ...overrides,
  };
}

describe('contractSeasonCash', () => {
  it('books the signing bonus as cash only in the first league year', () => {
    const fresh = makeContract(); // year 0 of 3
    expect(contractSeasonCash(fresh)).toBe(4_000_000 + 500_000 + 9_000_000);
    const yearTwo = makeContract({ yearsRemaining: 2 });
    expect(contractSeasonCash(yearTwo)).toBe(6_000_000 + 100_000);
    const expired = makeContract({ yearsRemaining: 0 });
    expect(contractSeasonCash(expired)).toBe(0);
  });

  it('books only the CONVERTED money for a restructure rebase, not the folded-in old proration', () => {
    const mid = makeContract({ yearsRemaining: 2 }); // $6M base year
    const rebased = restructureContract(mid, 'CASH_RST', 50)!.contract;
    // New cash this year = vet-min base + converted ($6M − min); the old
    // bonus's remaining proration inside the new signingBonus is NOT cash.
    const converted = 6_000_000 - 900_000;
    expect(rebased.signingBonusCashPaid).toBe(converted);
    expect(contractSeasonCash(rebased)).toBe(900_000 + converted + 100_000);
    // A restructure is cash-NEUTRAL: the player gets the same money this
    // year either way — only the cap schedule moves.
    expect(contractSeasonCash(rebased)).toBe(contractSeasonCash(mid));
  });
});

describe('teamCashFloorStatus', () => {
  const league = createLeague({ seed: 'cash-floor' });
  const team = Object.values(league.teams)[0]!;

  function withLedger(ledger: Record<number, number>): TeamState {
    return { ...team, cashSpentBySeason: ledger };
  }

  it('is trivially compliant with no booked history', () => {
    const status = teamCashFloorStatus(withLedger({}), league);
    expect(status.lagging).toBe(false);
    expect(status.seasons).toBe(0);
  });

  it('flags a team far under the floor pace and sizes the lag', () => {
    const low = 0.6 * league.salaryCap;
    const status = teamCashFloorStatus(withLedger({ 1: low, 2: low }), league);
    expect(status.seasons).toBe(2);
    expect(status.lagging).toBe(true);
    expect(status.lag).toBeCloseTo(2 * (CASH_FLOOR_PCT - 0.6) * league.salaryCap, -5);
  });

  it('passes a team at 90%+ pace and uses only the trailing window', () => {
    const high = 0.92 * league.salaryCap;
    const ledger: Record<number, number> = {};
    // Old bad seasons beyond the window must not count.
    for (let s = 1; s <= CASH_FLOOR_WINDOW + 2; s++) {
      ledger[s] = s <= 2 ? 0.3 * league.salaryCap : high;
    }
    const status = teamCashFloorStatus(withLedger(ledger), league);
    expect(status.seasons).toBe(CASH_FLOOR_WINDOW);
    expect(status.lagging).toBe(false);
  });
});

describe('cash ledger booking (integration)', () => {
  it('every team books positive season cash at the first advance', () => {
    let league: LeagueState = createLeague({ seed: 'cash-book' });
    league = simulateSeason(league);
    league = advanceSeason(league);
    for (const team of Object.values(league.teams)) {
      const booked = team.cashSpentBySeason[1];
      expect(booked).toBeGreaterThan(0.4 * league.salaryCap);
      expect(booked).toBeLessThan(1.6 * league.salaryCap);
    }
  });
});
