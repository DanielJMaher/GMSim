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
  it('PS refills each offseason by signing real unsigned young FAs, not inventing players', () => {
    let league = createLeague({ seed: 'ps-cycle' });
    const knownIds = new Set(Object.keys(league.players));

    league = simulateSeason(league);
    league = advanceSeason(league);

    // After advance, every team is back to PS size, every PS player has a
    // valid PS deal, and most slots were filled from the existing player
    // pool (UDFAs + young fringe FAs + re-signed PS guys — Living Careers
    // S2; before, ALL 512 slots/yr were invented 21-22-year-olds). Year 1
    // is the worst case (no UDFA inflow yet, refillRosters absorbs part of
    // the bootstrap supply), so allow up to 40% emergency fill here; the
    // Actuary's entry-age gate polices the aggregate. Emergency fill is
    // generated at DEVELOPING age (23-24, experience >= 1), so it never
    // masquerades as a draft-class rookie.
    let invented = 0;
    let total = 0;
    for (const team of Object.values(league.teams)) {
      expect(team.practiceSquadIds.length).toBe(PRACTICE_SQUAD_SIZE);
      for (const id of team.practiceSquadIds) {
        const player = league.players[id]!;
        expect(player.teamId).toBe(team.identity.id);
        expect(player.contractId).not.toBeNull();
        total++;
        if (!knownIds.has(id) && id.includes('_PS')) {
          invented++;
          expect(player.experienceYears).toBeGreaterThanOrEqual(1);
        }
      }
    }
    expect(invented / total).toBeLessThan(0.4);
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
