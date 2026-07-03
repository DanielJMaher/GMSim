import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import type { Contract } from '../types/contract.js';
import type { LeagueState } from '../types/league.js';
import { teamCapUsage } from '../contracts/cap.js';
import { LEAGUE_MINIMUM_SALARY } from '../contracts/constants.js';
import { applyCapFloorExtensions, CAP_EXTENSION_CEIL, CAP_FLOOR_TARGET } from './extensions.js';
import { ageOfPlayer } from '../season/development.js';
import { RESIGN_QB_BAD_TEAM_WINS } from './re-sign.js';

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

  it('losing teams never extend a non-STAR QB; winning teams do (v0.175 record-aware carve-out)', () => {
    // Post-finalize shape: seasonNumber already rolled to the upcoming
    // season, history entry dated to the just-played one (seasonNumber - 1).
    const withRecords = (l: LeagueState, wins: number): LeagueState => {
      const teams: Record<string, (typeof l.teams)[keyof typeof l.teams]> = {};
      for (const [tid, team] of Object.entries(l.teams)) {
        teams[tid] = {
          ...team,
          seasonHistory: [
            { seasonNumber: 1, wins, losses: 17 - wins, ties: 0, divisionFinish: 4, madePlayoffs: false },
          ],
        };
      }
      return { ...l, seasonNumber: 2, teams: teams as LeagueState['teams'] };
    };
    const nonStarQbExtensions = (l: LeagueState) =>
      l.transactionLog.filter((t) => {
        if (t.kind !== 're-sign') return false;
        const p = l.players[t.playerId];
        return p?.position === 'QB' && p.tier !== 'STAR';
      }).length;
    const anyExtensions = (l: LeagueState) =>
      l.transactionLog.filter((t) => t.kind === 're-sign').length;

    const base = cheapenAll(createLeague({ seed: 'ext-qbgate' }));

    // Every team coming off a losing season: floor pressure flows to every
    // position EXCEPT the middling QB — he's left to expire and be replaced
    // through the draft.
    const losing = applyCapFloorExtensions(withRecords(base, RESIGN_QB_BAD_TEAM_WINS), 1000);
    expect(nonStarQbExtensions(losing)).toBe(0);
    expect(anyExtensions(losing)).toBeGreaterThan(20);

    // Control: the same league off winning seasons extends its underpaid QBs.
    const winning = applyCapFloorExtensions(withRecords(base, 10), 1000);
    expect(nonStarQbExtensions(winning)).toBeGreaterThan(0);
  });

  it('the raised cash-lag floor pulls in a team the base floor would skip (Slice 3)', () => {
    // Build a team sitting BETWEEN the base floor (0.88) and the raised
    // cash-lag floor (0.93), with exactly one underpaid prime STARTER:
    // cheapen his deal on a rich team so post-cheapen usage lands in the
    // gap. The base floor then skips the team; the raised floor extends
    // him. A STARTER-sized market deal fits under the 0.95 ceiling from
    // ~0.90 usage — a STAR-sized one would trip the ceiling skip — and
    // league-total assertions can't discriminate the branch at all (the
    // candidate pool exhausts below any floor).
    const raw = createLeague({ seed: 'ext-cashlag' });
    let fixture: { league: LeagueState; teamId: string; playerId: string } | null = null;
    for (const team of Object.values(raw.teams)) {
      for (const pid of team.rosterIds) {
        const player = raw.players[pid];
        if (!player || !player.contractId || player.tier !== 'STARTER') continue;
        if (player.position === 'QB') continue; // keep the age gate simple
        if (ageOfPlayer(player, raw.seasonNumber) > 28) continue;
        const c = raw.contracts[player.contractId];
        if (!c) continue;
        const cheapened: Contract = {
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
        const league: LeagueState = {
          ...raw,
          contracts: { ...raw.contracts, [c.id]: cheapened } as LeagueState['contracts'],
        };
        const frac = teamCapUsage(team, league) / league.salaryCap;
        if (frac >= 0.885 && frac <= 0.915) {
          fixture = { league, teamId: team.identity.id, playerId: pid };
          break;
        }
      }
      if (fixture) break;
    }
    expect(fixture).not.toBeNull();
    const { league, teamId } = fixture!;

    const withLedger = (perSeason: number): LeagueState => {
      const team = league.teams[teamId as keyof typeof league.teams]!;
      return {
        ...league,
        teams: {
          ...league.teams,
          [teamId]: { ...team, cashSpentBySeason: { 1: perSeason, 2: perSeason } },
        } as LeagueState['teams'],
      };
    };

    const teamResigns = (l: LeagueState) =>
      l.transactionLog.filter((t) => t.kind === 're-sign' && t.teamId === teamId).length;

    // Compliant: usage ≥ base floor → the pass skips the team entirely.
    const compliant = applyCapFloorExtensions(withLedger(0.92 * league.salaryCap), 1000);
    expect(teamResigns(compliant)).toBe(teamResigns(league));

    // Cash-lagging: the raised floor binds → the team extends (which
    // players go first depends on the lag premium's re-pricing; the spec
    // here is the team-level floor choice, so assert at team level).
    const lagging = applyCapFloorExtensions(withLedger(0.5 * league.salaryCap), 1000);
    expect(teamResigns(lagging)).toBeGreaterThan(teamResigns(league));
    expect(
      teamCapUsage(lagging.teams[teamId as keyof typeof lagging.teams]!, lagging),
    ).toBeGreaterThan(teamCapUsage(compliant.teams[teamId as keyof typeof compliant.teams]!, compliant));
  });
});
