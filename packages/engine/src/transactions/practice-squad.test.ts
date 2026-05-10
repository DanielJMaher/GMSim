import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from '../season/runner.js';
import { advanceSeason } from '../season/advance.js';
import { teamCapUsage } from '../contracts/cap.js';
import {
  PRACTICE_SQUAD_SIZE,
  PRACTICE_SQUAD_SALARY,
} from '../contracts/constants.js';

describe('practice squad — bootstrap', () => {
  it('every team starts with PRACTICE_SQUAD_SIZE practice-squad players', () => {
    const league = createLeague({ seed: 'ps-init' });
    for (const team of Object.values(league.teams)) {
      expect(team.practiceSquadIds.length).toBe(PRACTICE_SQUAD_SIZE);
    }
  });

  it('PS players have the team set as teamId and a contract record', () => {
    const league = createLeague({ seed: 'ps-refs' });
    for (const team of Object.values(league.teams)) {
      for (const playerId of team.practiceSquadIds) {
        const player = league.players[playerId]!;
        expect(player.teamId).toBe(team.identity.id);
        expect(player.contractId).not.toBeNull();
        const contract = league.contracts[player.contractId!]!;
        expect(contract.realYears).toBe(1);
        expect(contract.baseSalaries[0]).toBe(PRACTICE_SQUAD_SALARY);
      }
    }
  });

  it('PS contracts are not counted toward teamCapUsage', () => {
    const league = createLeague({ seed: 'ps-cap' });
    for (const team of Object.values(league.teams)) {
      const used = teamCapUsage(team, league);
      // Active roster cap usage is independent of PS contract count.
      // Removing all PS players + contracts from the league shouldn't
      // change a team's reported cap usage. Verify by deleting them
      // from a clone and recomputing.
      const playersClone = { ...league.players };
      const contractsClone = { ...league.contracts };
      for (const psId of team.practiceSquadIds) {
        const c = playersClone[psId]?.contractId;
        delete playersClone[psId];
        if (c) delete contractsClone[c];
      }
      const cloneLeague = { ...league, players: playersClone, contracts: contractsClone };
      const usedAfter = teamCapUsage(team, cloneLeague);
      expect(usedAfter).toBe(used);
    }
  });

  it('total league.players includes both active rosters and practice squads', () => {
    const league = createLeague({ seed: 'ps-total' });
    expect(Object.keys(league.players).length).toBe(32 * (53 + PRACTICE_SQUAD_SIZE));
  });
});

describe('practice squad — offseason lifecycle', () => {
  it('PS contracts expire each offseason and PS list is replaced with fresh rookies', () => {
    let league = createLeague({ seed: 'ps-cycle' });
    const psBeforeBySeason: Record<number, Set<string>> = {};
    for (const team of Object.values(league.teams)) {
      psBeforeBySeason[1] ??= new Set();
      for (const id of team.practiceSquadIds) psBeforeBySeason[1]!.add(id);
    }

    league = simulateSeason(league);
    league = advanceSeason(league);

    // After advance, every team is back to PS size, and the new PS players
    // are *different* from the prior season's batch (those whose contracts
    // expired either signed elsewhere as FAs or remain in the FA pool).
    for (const team of Object.values(league.teams)) {
      expect(team.practiceSquadIds.length).toBe(PRACTICE_SQUAD_SIZE);
      for (const id of team.practiceSquadIds) {
        expect(psBeforeBySeason[1]!.has(id)).toBe(false);
      }
    }
  });

  it('PS lifecycle stays stable across multiple seasons', () => {
    let league = createLeague({ seed: 'ps-multi' });
    for (let i = 0; i < 5; i++) {
      league = simulateSeason(league);
      league = advanceSeason(league);
      let active = 0;
      let ps = 0;
      for (const team of Object.values(league.teams)) {
        active += team.rosterIds.length;
        ps += team.practiceSquadIds.length;
      }
      // PS always refills to 16 per team; active rosters fill to 53 in
      // typical seasons but can dip a few slots short league-wide if a
      // team's cap pinches against the fill-up threshold. Allow a small
      // shortfall (< 1% of total) to keep the test stable.
      expect(active).toBeGreaterThanOrEqual(32 * 53 - 16);
      expect(ps).toBe(32 * PRACTICE_SQUAD_SIZE);
    }
  });

  it('determinism — same seed produces identical PS state', () => {
    const a = createLeague({ seed: 'ps-det' });
    const b = createLeague({ seed: 'ps-det' });
    for (const teamId of Object.keys(a.teams)) {
      expect(b.teams[teamId as keyof typeof b.teams]!.practiceSquadIds).toEqual(
        a.teams[teamId as keyof typeof a.teams]!.practiceSquadIds,
      );
    }
  });
});
