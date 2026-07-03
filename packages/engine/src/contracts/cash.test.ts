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
  teamSeasonCash,
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

  it('flags a team far under the floor pace and sizes the lag (booked + season in progress)', () => {
    const low = 0.6 * league.salaryCap;
    const fixture = withLedger({ 1: low, 2: low });
    const status = teamCashFloorStatus(fixture, league);
    // v0.176: the window counts the 2 booked seasons PLUS the season underway
    // (its committed roster cash vs the current cap).
    expect(status.seasons).toBe(3);
    expect(status.lagging).toBe(true);
    const current = teamSeasonCash(fixture, league);
    expect(status.lag).toBeCloseTo(
      3 * CASH_FLOOR_PCT * league.salaryCap - (2 * low + current),
      -5,
    );
  });

  it('drops booked seasons beyond the window and counts the season in progress', () => {
    const high = 0.92 * league.salaryCap;
    const ledger: Record<number, number> = {};
    // Old bad seasons beyond the window must not count.
    for (let s = 1; s <= CASH_FLOOR_WINDOW + 2; s++) {
      ledger[s] = s <= 2 ? 0.3 * league.salaryCap : high;
    }
    const fixture = withLedger(ledger);
    const status = teamCashFloorStatus(fixture, league);
    // WINDOW-1 most recent booked seasons + the season in progress.
    expect(status.seasons).toBe(CASH_FLOOR_WINDOW);
    // The 0.3-cap seasons fell outside the window: booked contribution is
    // exactly the three high seasons; the rest is the live roster's cash.
    expect(status.cashSpent).toBeCloseTo(
      (CASH_FLOOR_WINDOW - 1) * high + teamSeasonCash(fixture, league),
      -5,
    );
    expect(status.floorTarget).toBeCloseTo(
      CASH_FLOOR_PCT * CASH_FLOOR_WINDOW * league.salaryCap,
      -5,
    );
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
