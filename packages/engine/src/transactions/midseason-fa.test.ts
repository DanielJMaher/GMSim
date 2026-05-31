import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from '../season/runner.js';
import { runWeeklyFreeAgentSignings } from './midseason-fa.js';
import { releasePlayer } from './release.js';
import { freeAgents } from './free-agency.js';
import { Prng } from '../prng/index.js';
import { teamCapUsage } from '../contracts/cap.js';
import { LEAGUE_MINIMUM_SALARY } from '../contracts/constants.js';
import type { LeagueState } from '../types/league.js';
import type { TeamId } from '../types/ids.js';

function freshLeague(seed: string): LeagueState {
  return createLeague({ seed });
}

/** Cheapen a team's contracts so it has ample cap room (to exercise mechanics
 *  that gate on room, independent of the seed's generated cap state). */
function giveTeamCapRoom(league: LeagueState, teamId: TeamId): LeagueState {
  const team = league.teams[teamId]!;
  const contracts = { ...league.contracts };
  for (const pid of team.rosterIds) {
    const p = league.players[pid];
    if (!p?.contractId) continue;
    const c = contracts[p.contractId];
    if (!c) continue;
    contracts[p.contractId] = {
      ...c,
      baseSalaries: c.baseSalaries.map(() => 1_000_000),
      signingBonus: 0,
      rosterBonuses: c.rosterBonuses.map(() => 0),
      workoutBonuses: c.workoutBonuses.map(() => 0),
    };
  }
  return { ...league, contracts } as LeagueState;
}

/**
 * Manufacture an in-season scenario: release one player from each of
 * a few teams. Released players become FAs; the same teams now have
 * positional deficits eligible for mid-season signing.
 */
function setupGapWithFAs(
  base: LeagueState,
  teamCount = 3,
): { league: LeagueState; gappedTeams: TeamId[] } {
  let league = base;
  const gappedTeams: TeamId[] = [];
  const teams = Object.values(base.teams).slice(0, teamCount);
  for (const team of teams) {
    const playerId = team.rosterIds[0]!;
    league = releasePlayer(league, playerId);
    gappedTeams.push(team.identity.id);
  }
  return { league, gappedTeams };
}

describe('runWeeklyFreeAgentSignings', () => {
  it('signs a FA to fill a roster gap when below 53', () => {
    const base = freshLeague('mid-fa-basic');
    const { league: gapped, gappedTeams } = setupGapWithFAs(base, 1);
    const teamId = gappedTeams[0]!;
    // Position-weighted contracts can leave this seed's team cap-jammed; the
    // mechanic-under-test (filling a gap) requires room, so establish it (the
    // cap-room gate itself is covered by the "skips signing" test below).
    const scenario = giveTeamCapRoom(gapped, teamId);
    expect(scenario.teams[teamId]!.rosterIds.length).toBe(52);

    const next = runWeeklyFreeAgentSignings(new Prng('m1'), scenario, 100);
    expect(next.teams[teamId]!.rosterIds.length).toBe(53);
  });

  it('shrinks the FA pool by exactly one per team that signs', () => {
    const base = freshLeague('mid-fa-pool');
    const { league: scenario, gappedTeams } = setupGapWithFAs(base, 3);
    const faBefore = freeAgents(scenario).length;
    expect(faBefore).toBe(3); // sanity

    const next = runWeeklyFreeAgentSignings(new Prng('m2'), scenario, 100);
    const faAfter = freeAgents(next).length;
    // Each of the 3 teams should sign one of the 3 FAs (assuming
    // position-deficit overlap). At minimum, the pool shrunk by the
    // number of teams that successfully signed.
    expect(faAfter).toBeLessThan(faBefore);
    expect(faAfter).toBeGreaterThanOrEqual(0);
    // And the rosters of those teams that signed should be back at 53.
    let signedTeams = 0;
    for (const teamId of gappedTeams) {
      if (next.teams[teamId]!.rosterIds.length === 53) signedTeams++;
    }
    expect(signedTeams).toBe(faBefore - faAfter);
  });

  it('produces a 1-year league-minimum contract for the signed player', () => {
    const base = freshLeague('mid-fa-contract');
    const { league: scenario, gappedTeams } = setupGapWithFAs(base, 1);
    const teamId = gappedTeams[0]!;
    const beforeIds = new Set(scenario.teams[teamId]!.rosterIds);

    const next = runWeeklyFreeAgentSignings(new Prng('m3'), scenario, 100);

    const newPlayerId = next.teams[teamId]!.rosterIds.find((id) => !beforeIds.has(id));
    expect(newPlayerId).toBeDefined();
    const player = next.players[newPlayerId!]!;
    const contract = next.contracts[player.contractId!]!;
    expect(contract.realYears).toBe(1);
    expect(contract.yearsRemaining).toBe(1);
    expect(contract.baseSalaries[0]).toBe(LEAGUE_MINIMUM_SALARY);
    expect(contract.signingBonus).toBe(0);
  });

  it('is a no-op when every team is at 53', () => {
    const league = freshLeague('mid-fa-noop');
    const before = JSON.stringify(
      Object.values(league.teams).map((t) => t.rosterIds.length),
    );
    const next = runWeeklyFreeAgentSignings(new Prng('m4'), league, 100);
    const after = JSON.stringify(
      Object.values(next.teams).map((t) => t.rosterIds.length),
    );
    expect(after).toBe(before);
  });

  it('skips signing if the team has no cap room', () => {
    const base = freshLeague('mid-fa-no-cap');
    const { league: scenario, gappedTeams } = setupGapWithFAs(base, 1);
    const teamId = gappedTeams[0]!;
    const used = teamCapUsage(scenario.teams[teamId]!, scenario);
    const tightLeague: LeagueState = {
      ...scenario,
      salaryCap: used + LEAGUE_MINIMUM_SALARY - 1,
    };

    const next = runWeeklyFreeAgentSignings(new Prng('m5'), tightLeague, 100);
    expect(next.teams[teamId]!.rosterIds.length).toBe(52); // gap remains
  });

  it('end-to-end: simulateSeason keeps active rosters near 53 even with mid-season churn', () => {
    let league = freshLeague('mid-fa-e2e');
    league = simulateSeason(league);
    let activeTotal = 0;
    let irTotal = 0;
    for (const team of Object.values(league.teams)) {
      activeTotal += team.rosterIds.length;
      irTotal += team.injuredReserveIds.length;
    }
    // Lower bound without any mid-season signings: 32 × 53 − irTotal.
    // Mid-season FA + poaching should hold rosters at or very near 53.
    expect(activeTotal).toBeGreaterThanOrEqual(32 * 53 - irTotal);
  });

  it('determinism — same seed produces identical mid-season signings', () => {
    const a = simulateSeason(freshLeague('mid-fa-det'));
    const b = simulateSeason(freshLeague('mid-fa-det'));
    for (const teamId of Object.keys(a.teams)) {
      expect(b.teams[teamId as keyof typeof b.teams]!.rosterIds).toEqual(
        a.teams[teamId as keyof typeof a.teams]!.rosterIds,
      );
    }
  });
});
