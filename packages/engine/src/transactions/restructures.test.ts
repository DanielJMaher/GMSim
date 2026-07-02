import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import type { Contract } from '../types/contract.js';
import type { LeagueState } from '../types/league.js';
import type { TeamState } from '../types/team.js';
import { ContractId } from '../types/ids.js';
import { CompetitiveWindow } from '../types/enums.js';
import { capHitForYear, currentCapHit, teamCapUsage } from '../contracts/cap.js';
import { LEAGUE_MINIMUM_SALARY } from '../contracts/constants.js';
import {
  applyCapRestructures,
  restructureContract,
  RESTRUCTURE_ROOM_TARGET,
} from './restructures.js';

function makeContract(overrides: Partial<Contract> = {}): Contract {
  return {
    id: ContractId('C_TEST'),
    playerId: 'P1' as Contract['playerId'],
    teamId: 'T1' as Contract['teamId'],
    signedOnTick: 0,
    realYears: 4,
    voidYears: 0,
    yearsRemaining: 3,
    baseSalaries: [8_000_000, 12_000_000, 14_000_000, 16_000_000],
    signingBonus: 20_000_000,
    rosterBonuses: [0, 500_000, 500_000, 500_000],
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

describe('restructureContract', () => {
  it('conserves total future cap dollars while shifting them out of the current year', () => {
    const old = makeContract(); // in year 1 of 4 (3 remaining), base $12M
    const result = restructureContract(old, 'RST_A', 100);
    expect(result).not.toBeNull();
    const next = result!.contract;

    const oldFuture =
      capHitForYear(old, 1) + capHitForYear(old, 2) + capHitForYear(old, 3);
    const newFuture =
      capHitForYear(next, 0) + capHitForYear(next, 1) + capHitForYear(next, 2);
    // $1k rounding per proration split is the only tolerated drift.
    expect(Math.abs(newFuture - oldFuture)).toBeLessThan(3_000);

    // Current-year relief = converted × (r−1)/r, converted = $12M − vet min.
    const converted = 12_000_000 - LEAGUE_MINIMUM_SALARY;
    const relief = currentCapHit(old) - currentCapHit(next);
    expect(relief).toBeCloseTo((converted * 2) / 3, -4);
    expect(result!.converted).toBe(converted);

    // Later years now carry MORE than they did — the room wasn't free.
    expect(capHitForYear(next, 1)).toBeGreaterThan(capHitForYear(old, 2));
    expect(capHitForYear(next, 2)).toBeGreaterThan(capHitForYear(old, 3));
  });

  it('declines contracts with fewer than 2 years remaining or nothing to convert', () => {
    expect(restructureContract(makeContract({ yearsRemaining: 1 }), 'X', 0)).toBeNull();
    const minDeal = makeContract({
      baseSalaries: [8_000_000, LEAGUE_MINIMUM_SALARY + 500_000, 14_000_000, 16_000_000],
    });
    expect(restructureContract(minDeal, 'X', 0)).toBeNull();
  });

  it('grows the dead-money bomb: post-restructure release costs more', () => {
    const old = makeContract();
    const next = restructureContract(old, 'RST_B', 100)!.contract;
    // Remaining proration accelerates on release; the converted money now
    // lives in the bonus so the acceleration is strictly larger.
    const oldAccel = (old.signingBonus / 4) * old.yearsRemaining;
    const newAccel = (next.signingBonus / 3) * next.yearsRemaining;
    expect(newAccel).toBeGreaterThan(oldAccel);
  });
});

/** Pin every team to a window and push one team over the cap. */
function withWindow(league: LeagueState, window: CompetitiveWindow): LeagueState {
  const teams: Record<string, TeamState> = {};
  for (const [id, t] of Object.entries(league.teams)) {
    teams[id] = { ...t, competitiveWindow: window };
  }
  return { ...league, teams: teams as LeagueState['teams'] };
}

describe('applyCapRestructures', () => {
  it('win-now teams near the cap open room toward the war-chest target', () => {
    const league = withWindow(createLeague({ seed: 'rst-warchest' }), CompetitiveWindow.CONTENDER);
    const targetUsage = (1 - RESTRUCTURE_ROOM_TARGET) * league.salaryCap;
    const pinned = Object.values(league.teams).filter(
      (t) => teamCapUsage(t, league) > targetUsage,
    );
    expect(pinned.length).toBeGreaterThan(0); // fresh leagues generate near-cap teams

    const after = applyCapRestructures(league, 500);
    const restructures = after.transactionLog.filter((t) => t.kind === 'restructure');
    expect(restructures.length).toBeGreaterThan(0);

    let improved = 0;
    for (const t of pinned) {
      const before = teamCapUsage(t, league);
      const now = teamCapUsage(after.teams[t.identity.id]!, after);
      expect(now).toBeLessThanOrEqual(before);
      if (now < before) improved++;
    }
    expect(improved).toBeGreaterThan(0);
    // Roster untouched — restructures never shed players.
    for (const t of Object.values(after.teams)) {
      expect(t.rosterIds.length).toBe(league.teams[t.identity.id]!.rosterIds.length);
    }
  });

  it('rebuild-window teams never restructure', () => {
    const league = withWindow(createLeague({ seed: 'rst-rebuild' }), CompetitiveWindow.REBUILDING);
    const after = applyCapRestructures(league, 500);
    expect(after).toBe(league); // untouched — no log entries, same reference
  });

  it('is deterministic', () => {
    const mk = () =>
      applyCapRestructures(
        withWindow(createLeague({ seed: 'rst-det' }), CompetitiveWindow.CHAMPIONSHIP),
        500,
      );
    const a = mk();
    const b = mk();
    expect(a.contracts).toEqual(b.contracts);
    expect(a.transactionLog).toEqual(b.transactionLog);
  });
});
