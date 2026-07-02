import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import type { Contract } from '../types/contract.js';
import type { LeagueState } from '../types/league.js';
import { teamCapUsage } from '../contracts/cap.js';
import { LEAGUE_MINIMUM_SALARY } from '../contracts/constants.js';
import { applyCapFloorExtensions, CAP_EXTENSION_CEIL, CAP_FLOOR_TARGET } from './extensions.js';

/** Replace every contract on every roster with a 1-year vet-minimum deal, so
 *  each team is far below the spend floor with underpaid prime players to extend. */
function cheapenAll(league: LeagueState): LeagueState {
  const contracts: Record<string, Contract> = { ...league.contracts };
  for (const player of Object.values(league.players)) {
    if (!player.contractId) continue;
    const c = contracts[player.contractId];
    if (!c) continue;
    contracts[player.contractId] = {
      ...c,
      realYears: 1,
      voidYears: 0,
      yearsRemaining: 1,
      baseSalaries: [LEAGUE_MINIMUM_SALARY],
      signingBonus: 0,
      rosterBonuses: [0],
      workoutBonuses: [0],
      guarantees: [{ baseGuaranteedPct: 0, type: 'NONE' }],
    };
  }
  return { ...league, contracts: contracts as LeagueState['contracts'] };
}

describe('applyCapFloorExtensions', () => {
  it('lifts below-floor teams toward the floor without breaching the ceiling', () => {
    const league = cheapenAll(createLeague({ seed: 'ext-lift' }));
    const before = Object.values(league.teams).map((t) => teamCapUsage(t, league));
    const after = applyCapFloorExtensions(league, 1000);
    let lifted = 0;
    for (const team of Object.values(after.teams)) {
      const beforeUsage = teamCapUsage(league.teams[team.identity.id]!, league);
      const afterUsage = teamCapUsage(team, after);
      expect(afterUsage).toBeGreaterThanOrEqual(beforeUsage); // never sheds
      expect(afterUsage).toBeLessThanOrEqual(CAP_EXTENSION_CEIL * league.salaryCap + 1);
      if (afterUsage > beforeUsage) lifted++;
    }
    // The whole league started at vet-minimum, so many teams get lifted.
    expect(lifted).toBeGreaterThan(20);
    // League-wide spend rose substantially.
    const beforeTotal = before.reduce((s, v) => s + v, 0);
    const afterTotal = Object.values(after.teams).reduce((s, t) => s + teamCapUsage(t, after), 0);
    expect(afterTotal).toBeGreaterThan(beforeTotal * 1.5);
  });

  it('leaves an at-floor team untouched', () => {
    // A freshly-generated league already spends ~89%, above the floor.
    const league = createLeague({ seed: 'ext-atfloor' });
    const atFloor = Object.values(league.teams).find(
      (t) => teamCapUsage(t, league) >= CAP_FLOOR_TARGET * league.salaryCap,
    );
    expect(atFloor).toBeDefined();
    const after = applyCapFloorExtensions(league, 1000);
    expect(teamCapUsage(after.teams[atFloor!.identity.id]!, after)).toBe(
      teamCapUsage(atFloor!, league),
    );
  });

  it('is deterministic', () => {
    const a = applyCapFloorExtensions(cheapenAll(createLeague({ seed: 'ext-det' })), 1000);
    const b = applyCapFloorExtensions(cheapenAll(createLeague({ seed: 'ext-det' })), 1000);
    expect(a.contracts).toEqual(b.contracts);
    expect(a.players).toEqual(b.players);
  });
});
