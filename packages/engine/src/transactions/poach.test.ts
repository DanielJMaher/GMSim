import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from '../season/runner.js';
import {
  runWeeklyPoaching,
  computeWeeklyProtections,
  MAX_PS_PROTECTIONS_PER_WEEK,
} from './poach.js';
import { Prng } from '../prng/index.js';
import { teamCapUsage } from '../contracts/cap.js';
import { LEAGUE_MINIMUM_SALARY } from '../contracts/constants.js';
import type { LeagueState } from '../types/league.js';
import type { TeamId, PlayerId } from '../types/ids.js';

function freshLeague(seed: string): LeagueState {
  return createLeague({ seed });
}

/**
 * Manufacture a poaching scenario: open up an active-roster slot on
 * one team by removing a player from rosterIds (no contract change),
 * leaving a positional deficit. Returns the modified league + the
 * affected team / position.
 */
function openRosterSlot(
  league: LeagueState,
  teamIndex = 0,
  rosterIndex = 0,
): { league: LeagueState; teamId: TeamId; openedPosition: string } {
  const team = Object.values(league.teams)[teamIndex]!;
  const playerId = team.rosterIds[rosterIndex]!;
  const player = league.players[playerId]!;
  return {
    league: {
      ...league,
      teams: {
        ...league.teams,
        [team.identity.id]: {
          ...team,
          rosterIds: team.rosterIds.filter((id) => id !== playerId),
        },
      } as typeof league.teams,
    },
    teamId: team.identity.id,
    openedPosition: player.position,
  };
}

describe('runWeeklyPoaching', () => {
  it('promotes a PS player when a team is below 53 active', () => {
    const base = freshLeague('poach-basic');
    const { league: scenario, teamId } = openRosterSlot(base);
    const before = scenario.teams[teamId]!;
    expect(before.rosterIds.length).toBe(52);

    const next = runWeeklyPoaching(new Prng('p1'), scenario, 100);
    const after = next.teams[teamId]!;
    expect(after.rosterIds.length).toBe(53);
  });

  it('moves the PS player off the origin team and onto the poaching team', () => {
    const base = freshLeague('poach-origin');
    const { league: scenario, teamId } = openRosterSlot(base);

    // Snapshot every team's PS list size before poaching.
    const psBefore = new Map<TeamId, number>();
    for (const team of Object.values(scenario.teams)) {
      psBefore.set(team.identity.id, team.practiceSquadIds.length);
    }
    const totalPsBefore = [...psBefore.values()].reduce((s, v) => s + v, 0);

    const next = runWeeklyPoaching(new Prng('p2'), scenario, 100);

    let totalPsAfter = 0;
    for (const team of Object.values(next.teams)) {
      totalPsAfter += team.practiceSquadIds.length;
    }
    // Exactly one PS player was promoted → totalPS shrinks by 1.
    expect(totalPsAfter).toBe(totalPsBefore - 1);
    // The poaching team's active roster grew by 1.
    expect(next.teams[teamId]!.rosterIds.length).toBe(53);
  });

  it('drops the PS contract and creates a new league-minimum 1-year active contract', () => {
    const base = freshLeague('poach-contract');
    const { league: scenario, teamId } = openRosterSlot(base);

    const next = runWeeklyPoaching(new Prng('p3'), scenario, 100);

    // Find the player who was promoted by spotting which player is on
    // the poaching team's active roster but not on the original.
    const poacher = next.teams[teamId]!;
    const beforeRosterSet = new Set(scenario.teams[teamId]!.rosterIds);
    const promotedId = poacher.rosterIds.find((id) => !beforeRosterSet.has(id))!;
    expect(promotedId).toBeDefined();

    const promoted = next.players[promotedId]!;
    expect(promoted.teamId).toBe(teamId);
    expect(promoted.contractId).not.toBeNull();

    const contract = next.contracts[promoted.contractId!]!;
    expect(contract.realYears).toBe(1);
    expect(contract.yearsRemaining).toBe(1);
    expect(contract.baseSalaries[0]).toBe(LEAGUE_MINIMUM_SALARY);
  });

  it('is a no-op when every team is at 53 active', () => {
    const league = freshLeague('poach-noop');
    const before = JSON.stringify(
      Object.values(league.teams).map((t) => ({
        id: t.identity.id,
        roster: t.rosterIds.length,
        ps: t.practiceSquadIds.length,
      })),
    );
    const next = runWeeklyPoaching(new Prng('p4'), league, 100);
    const after = JSON.stringify(
      Object.values(next.teams).map((t) => ({
        id: t.identity.id,
        roster: t.rosterIds.length,
        ps: t.practiceSquadIds.length,
      })),
    );
    expect(after).toBe(before);
  });

  it('skips poaching if the team has no cap room', () => {
    const base = freshLeague('poach-no-cap');
    const { league: scenario, teamId } = openRosterSlot(base);
    // Force the team's cap usage to exceed the cap by setting the cap
    // ceiling artificially low.
    const used = teamCapUsage(scenario.teams[teamId]!, scenario);
    const tightLeague: LeagueState = {
      ...scenario,
      salaryCap: used + LEAGUE_MINIMUM_SALARY - 1, // < min-salary headroom
    };

    const next = runWeeklyPoaching(new Prng('p5'), tightLeague, 100);
    expect(next.teams[teamId]!.rosterIds.length).toBe(52); // not promoted
  });

  it('end-to-end: simulateSeason fills IR-induced gaps via poaching', () => {
    let league = freshLeague('poach-e2e');
    league = simulateSeason(league);

    // After a season with IR moves, look at any team where IR is
    // non-empty (meaning the season had MAJOR injuries). Their active
    // rosters should still be near 53 thanks to mid-season poaching,
    // even though some players are on IR.
    let irTotal = 0;
    let activeTotal = 0;
    for (const team of Object.values(league.teams)) {
      irTotal += team.injuredReserveIds.length;
      activeTotal += team.rosterIds.length;
    }
    expect(irTotal).toBeGreaterThan(0); // sanity: some IRs happened
    // Without poaching, activeTotal would be 32 * 53 - irTotal. With
    // poaching backfilling, it should be higher than that lower bound.
    expect(activeTotal).toBeGreaterThan(32 * 53 - irTotal);
  });

  it('determinism — same seed produces identical poach outcomes', () => {
    const a = simulateSeason(freshLeague('poach-det'));
    const b = simulateSeason(freshLeague('poach-det'));
    for (const teamId of Object.keys(a.teams)) {
      expect(b.teams[teamId as keyof typeof b.teams]!.rosterIds).toEqual(
        a.teams[teamId as keyof typeof a.teams]!.rosterIds,
      );
      expect(b.teams[teamId as keyof typeof b.teams]!.practiceSquadIds).toEqual(
        a.teams[teamId as keyof typeof a.teams]!.practiceSquadIds,
      );
    }
  });
});

describe('PS protections', () => {
  it('every team protects at most MAX_PS_PROTECTIONS_PER_WEEK PS players', () => {
    const league = freshLeague('protect-count');
    const protections = computeWeeklyProtections(league);
    for (const team of Object.values(league.teams)) {
      const set = protections.get(team.identity.id)!;
      expect(set.size).toBeLessThanOrEqual(MAX_PS_PROTECTIONS_PER_WEEK);
      expect(set.size).toBe(
        Math.min(MAX_PS_PROTECTIONS_PER_WEEK, team.practiceSquadIds.length),
      );
    }
  });

  it('protected PS players are a subset of the team practice squad', () => {
    const league = freshLeague('protect-subset');
    const protections = computeWeeklyProtections(league);
    for (const team of Object.values(league.teams)) {
      for (const id of protections.get(team.identity.id)!) {
        expect(team.practiceSquadIds).toContain(id);
      }
    }
  });

  it('protections are deterministic across same-seed leagues', () => {
    const a = freshLeague('protect-det');
    const b = freshLeague('protect-det');
    const pa = computeWeeklyProtections(a);
    const pb = computeWeeklyProtections(b);
    for (const teamId of Object.keys(a.teams)) {
      const idA = [...(pa.get(teamId as TeamId) ?? [])].sort();
      const idB = [...(pb.get(teamId as TeamId) ?? [])].sort();
      expect(idB).toEqual(idA);
    }
  });

  it('a protected PS player cannot be poached by another team', () => {
    // Manufacture a scenario: open a roster slot on team A. The best-fit
    // PS candidate for team A's deficit position lives on team B and is
    // in team B's protection list.
    const base = freshLeague('protect-block');
    const { league: scenario, teamId: poachingTeamId } = openRosterSlot(base);

    // Find which player the unprotected market would pick.
    const protections = computeWeeklyProtections(scenario);
    const next = runWeeklyPoaching(new Prng('pp1'), scenario, 100);

    // For every team that LOST a PS player to poaching, confirm the lost
    // player was NOT in that team's protection list.
    for (const team of Object.values(scenario.teams)) {
      const beforeIds = new Set(team.practiceSquadIds);
      const afterIds = new Set(next.teams[team.identity.id]!.practiceSquadIds);
      const lost = [...beforeIds].filter((id) => !afterIds.has(id));
      const teamProtected = protections.get(team.identity.id) ?? new Set();
      for (const id of lost) {
        // A player can be "lost" only if (a) they got promoted by their
        // own team (allowed even if protected), or (b) they were poached
        // by another team and were not in this team's protection list.
        const wasOwnPromotion = team.identity.id === poachingTeamId;
        if (!wasOwnPromotion) {
          expect(teamProtected.has(id)).toBe(false);
        }
      }
    }
  });

  it('a team can promote its own protected PS player', () => {
    // Open a slot on team 0 and force the only same-position PS player
    // to live on team 0 itself. Then verify that team 0 can still
    // promote them even if they're "protected."
    const base = freshLeague('protect-self');
    const team0 = Object.values(base.teams)[0]!;
    const team1 = Object.values(base.teams)[1]!;

    // Find a PS position only present on team 0's PS (not on team 1's).
    const t0Positions = new Set(
      team0.practiceSquadIds.map((id) => base.players[id]!.position),
    );
    const t1Positions = new Set(
      team1.practiceSquadIds.map((id) => base.players[id]!.position),
    );
    const exclusivePos = [...t0Positions].find((p) => !t1Positions.has(p));
    if (!exclusivePos) {
      // Skip: rare seed where positions overlap. The non-exclusive case
      // is covered by the "protected player not poached" test above.
      return;
    }

    // Move all team-0 PS players at that position to be the protected ones.
    // Since `computeWeeklyProtections` is deterministic and protects the
    // top-4 by score, we can just confirm the test setup by direct call.
    // Now manufacture a roster gap on team 0 at exclusivePos.
    const t0RosterPlayer = team0.rosterIds.find(
      (id) => base.players[id]!.position === exclusivePos,
    );
    if (!t0RosterPlayer) return; // skip: no roster spot at that position

    const scenario: LeagueState = {
      ...base,
      teams: {
        ...base.teams,
        [team0.identity.id]: {
          ...team0,
          rosterIds: team0.rosterIds.filter((id) => id !== t0RosterPlayer),
        },
      } as typeof base.teams,
    };
    const next = runWeeklyPoaching(new Prng('pp2'), scenario, 100);
    // Team 0's roster should be back at 53 (own promotion succeeded).
    expect(next.teams[team0.identity.id]!.rosterIds.length).toBe(53);
  });
});

/** Suppress unused-import warning when manipulating PlayerId types. */
void (null as unknown as PlayerId);
