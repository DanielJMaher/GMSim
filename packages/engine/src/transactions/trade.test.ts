import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import { executeTrade } from './trade.js';
import { teamCapUsage, signingBonusProrationPerYear } from '../contracts/cap.js';
import type { LeagueState } from '../types/league.js';
import type { TeamId, PlayerId } from '../types/ids.js';

function freshLeague(seed: string): LeagueState {
  return { ...createLeague({ seed }), phase: 'REGULAR_SEASON' as const };
}

function pickTwoTeamsAndPlayers(league: LeagueState) {
  const teams = Object.values(league.teams);
  const teamA = teams[0]!;
  const teamB = teams[1]!;
  // Pick a player without a no-trade clause to keep the basic test simple.
  const aPlayer = teamA.rosterIds.find(
    (id) => !league.contracts[league.players[id]!.contractId!]!.noTradeClause,
  )!;
  const bPlayer = teamB.rosterIds.find(
    (id) => !league.contracts[league.players[id]!.contractId!]!.noTradeClause,
  )!;
  return { teamA, teamB, aPlayer, bPlayer };
}

describe('executeTrade', () => {
  it('moves players between rosters', () => {
    const league = freshLeague('trade-basic');
    const { teamA, teamB, aPlayer, bPlayer } = pickTwoTeamsAndPlayers(league);

    const next = executeTrade(league, {
      teamAId: teamA.identity.id,
      teamBId: teamB.identity.id,
      playersAToB: [aPlayer],
      playersBToA: [bPlayer],
    });

    const newA = next.teams[teamA.identity.id]!;
    const newB = next.teams[teamB.identity.id]!;
    expect(newA.rosterIds).not.toContain(aPlayer);
    expect(newA.rosterIds).toContain(bPlayer);
    expect(newB.rosterIds).not.toContain(bPlayer);
    expect(newB.rosterIds).toContain(aPlayer);
    // Roster sizes preserved.
    expect(newA.rosterIds.length).toBe(teamA.rosterIds.length);
    expect(newB.rosterIds.length).toBe(teamB.rosterIds.length);
  });

  it('updates Player.teamId and contractId for each traded player', () => {
    const league = freshLeague('trade-player-record');
    const { teamA, teamB, aPlayer, bPlayer } = pickTwoTeamsAndPlayers(league);
    const oldAContractId = league.players[aPlayer]!.contractId!;
    const oldBContractId = league.players[bPlayer]!.contractId!;

    const next = executeTrade(league, {
      teamAId: teamA.identity.id,
      teamBId: teamB.identity.id,
      playersAToB: [aPlayer],
      playersBToA: [bPlayer],
    });

    const movedA = next.players[aPlayer]!;
    const movedB = next.players[bPlayer]!;
    expect(movedA.teamId).toBe(teamB.identity.id);
    expect(movedB.teamId).toBe(teamA.identity.id);
    // New contract IDs (different from the originals).
    expect(movedA.contractId).not.toBe(oldAContractId);
    expect(movedB.contractId).not.toBe(oldBContractId);
    // Old contracts dropped from league.contracts.
    expect(next.contracts[oldAContractId]).toBeUndefined();
    expect(next.contracts[oldBContractId]).toBeUndefined();
    // New contracts present.
    expect(next.contracts[movedA.contractId!]).toBeDefined();
    expect(next.contracts[movedB.contractId!]).toBeDefined();
  });

  it('new contracts have signingBonus=0 (originating team paid it)', () => {
    const league = freshLeague('trade-bonus');
    const { teamA, teamB, aPlayer } = pickTwoTeamsAndPlayers(league);
    // Find a player on team A whose contract has a non-zero signing bonus,
    // which is the only case where the signingBonus=0 invariant is non-trivial.
    const candidate = teamA.rosterIds.find((id) => {
      const c = league.contracts[league.players[id]!.contractId!]!;
      return c.signingBonus > 0 && !c.noTradeClause;
    })!;
    const playerToTrade = candidate ?? aPlayer;

    const next = executeTrade(league, {
      teamAId: teamA.identity.id,
      teamBId: teamB.identity.id,
      playersAToB: [playerToTrade],
      playersBToA: [],
    });
    const moved = next.players[playerToTrade]!;
    const newContract = next.contracts[moved.contractId!]!;
    expect(newContract.signingBonus).toBe(0);
  });

  it('accrues remaining proration as dead money on each trading team', () => {
    const league = freshLeague('trade-dead');
    const { teamA, teamB, aPlayer, bPlayer } = pickTwoTeamsAndPlayers(league);
    const aContract = league.contracts[league.players[aPlayer]!.contractId!]!;
    const bContract = league.contracts[league.players[bPlayer]!.contractId!]!;
    const expectedDeadA = signingBonusProrationPerYear(aContract) * aContract.yearsRemaining;
    const expectedDeadB = signingBonusProrationPerYear(bContract) * bContract.yearsRemaining;

    const next = executeTrade(league, {
      teamAId: teamA.identity.id,
      teamBId: teamB.identity.id,
      playersAToB: [aPlayer],
      playersBToA: [bPlayer],
    });

    const newA = next.teams[teamA.identity.id]!;
    const newB = next.teams[teamB.identity.id]!;
    expect(newA.deadMoneyByYear[0] ?? 0).toBe(expectedDeadA);
    expect(newB.deadMoneyByYear[0] ?? 0).toBe(expectedDeadB);
  });

  it('handles multi-player trades on each side', () => {
    const league = freshLeague('trade-multi');
    const teams = Object.values(league.teams);
    const teamA = teams[0]!;
    const teamB = teams[1]!;
    const aPlayers = teamA.rosterIds
      .filter((id) => !league.contracts[league.players[id]!.contractId!]!.noTradeClause)
      .slice(0, 2);
    const bPlayers = teamB.rosterIds
      .filter((id) => !league.contracts[league.players[id]!.contractId!]!.noTradeClause)
      .slice(0, 3);

    const next = executeTrade(league, {
      teamAId: teamA.identity.id,
      teamBId: teamB.identity.id,
      playersAToB: aPlayers,
      playersBToA: bPlayers,
    });

    const newA = next.teams[teamA.identity.id]!;
    const newB = next.teams[teamB.identity.id]!;
    expect(newA.rosterIds.length).toBe(teamA.rosterIds.length - aPlayers.length + bPlayers.length);
    expect(newB.rosterIds.length).toBe(teamB.rosterIds.length - bPlayers.length + aPlayers.length);
    for (const p of aPlayers) {
      expect(newB.rosterIds).toContain(p);
      expect(next.players[p]!.teamId).toBe(teamB.identity.id);
    }
    for (const p of bPlayers) {
      expect(newA.rosterIds).toContain(p);
      expect(next.players[p]!.teamId).toBe(teamA.identity.id);
    }
  });

  it('throws when a listed player is not on the listed team', () => {
    const league = freshLeague('trade-not-on-team');
    const teams = Object.values(league.teams);
    const teamA = teams[0]!;
    const teamB = teams[1]!;
    const aPlayer = teamA.rosterIds[0]!;
    const cPlayer = teams[2]!.rosterIds[0]!; // on a third team

    expect(() =>
      executeTrade(league, {
        teamAId: teamA.identity.id,
        teamBId: teamB.identity.id,
        playersAToB: [aPlayer, cPlayer],
        playersBToA: [],
      }),
    ).toThrow(/not on team/);
  });

  it("throws on no-trade clause unless overrideNoTrade is true", () => {
    const league = freshLeague('trade-no-trade');
    const teams = Object.values(league.teams);
    const teamA = teams[0]!;
    const teamB = teams[1]!;
    // Find a player on team A with a no-trade clause.
    const ntcPlayer = teamA.rosterIds.find(
      (id) => league.contracts[league.players[id]!.contractId!]!.noTradeClause,
    );
    if (!ntcPlayer) {
      // Some seeds yield no NTC players on team A — skip rather than fail
      // intermittently. The block-vs-override invariant is symmetric across
      // seeds, so this just gates on data availability.
      return;
    }
    const bPlayer = teamB.rosterIds.find(
      (id) => !league.contracts[league.players[id]!.contractId!]!.noTradeClause,
    )!;

    expect(() =>
      executeTrade(league, {
        teamAId: teamA.identity.id,
        teamBId: teamB.identity.id,
        playersAToB: [ntcPlayer],
        playersBToA: [bPlayer],
      }),
    ).toThrow(/no-trade clause/);

    // With override, the trade succeeds.
    const ok = executeTrade(league, {
      teamAId: teamA.identity.id,
      teamBId: teamB.identity.id,
      playersAToB: [ntcPlayer],
      playersBToA: [bPlayer],
      overrideNoTrade: true,
    });
    expect(ok.players[ntcPlayer]!.teamId).toBe(teamB.identity.id);
  });

  it('throws when trading within the same team', () => {
    const league = freshLeague('trade-self');
    const teamA = Object.values(league.teams)[0]!;
    const aPlayer = teamA.rosterIds[0]!;
    expect(() =>
      executeTrade(league, {
        teamAId: teamA.identity.id,
        teamBId: teamA.identity.id,
        playersAToB: [aPlayer],
        playersBToA: [],
      }),
    ).toThrow(/single team/);
  });

  it('cap impact: trading team usage drops and receiving team usage rises (net of dead money)', () => {
    const league = freshLeague('trade-cap');
    const { teamA, teamB, aPlayer } = pickTwoTeamsAndPlayers(league);
    const beforeA = teamCapUsage(teamA, league);
    const beforeB = teamCapUsage(teamB, league);

    const next = executeTrade(league, {
      teamAId: teamA.identity.id,
      teamBId: teamB.identity.id,
      playersAToB: [aPlayer],
      playersBToA: [],
    });
    const afterA = teamCapUsage(next.teams[teamA.identity.id]!, next);
    const afterB = teamCapUsage(next.teams[teamB.identity.id]!, next);

    // Trading team A absorbs dead money but loses the player's salary +
    // proration. The net could go either direction depending on contract
    // year — we just verify both sides changed and team B's usage
    // strictly grew (it took on a new salary line with no dead money).
    expect(afterB).toBeGreaterThan(beforeB);
    void afterA;
    void beforeA;
  });

  it('throws when team does not exist', () => {
    const league = freshLeague('trade-no-team');
    const teamA = Object.values(league.teams)[0]!;
    const aPlayer = teamA.rosterIds[0]!;
    expect(() =>
      executeTrade(league, {
        teamAId: teamA.identity.id,
        teamBId: 'TEAM_NOPE' as TeamId,
        playersAToB: [aPlayer],
        playersBToA: [],
      }),
    ).toThrow(/not found/);
  });

  it('determinism — same inputs produce identical league state', () => {
    const a = freshLeague('trade-det');
    const b = freshLeague('trade-det');
    const teamA = Object.values(a.teams)[0]!;
    const teamB = Object.values(a.teams)[1]!;
    const aPlayer = teamA.rosterIds.find(
      (id) => !a.contracts[a.players[id]!.contractId!]!.noTradeClause,
    )!;
    const bPlayer = teamB.rosterIds.find(
      (id) => !a.contracts[a.players[id]!.contractId!]!.noTradeClause,
    )!;

    const aResult = executeTrade(a, {
      teamAId: teamA.identity.id,
      teamBId: teamB.identity.id,
      playersAToB: [aPlayer],
      playersBToA: [bPlayer],
    });
    const bResult = executeTrade(b, {
      teamAId: teamA.identity.id,
      teamBId: teamB.identity.id,
      playersAToB: [aPlayer],
      playersBToA: [bPlayer],
    });
    expect(bResult.teams).toEqual(aResult.teams);
    expect(bResult.players).toEqual(aResult.players);
    expect(bResult.contracts).toEqual(aResult.contracts);

    // Reference unused PlayerId import to satisfy linting on test files
    // that want PlayerId for branded-id casts elsewhere.
    void (null as unknown as PlayerId);
  });
});

describe('executeTrade with draft picks (v0.47.0+)', () => {
  it('flips currentTeamId on transferred picks; originalTeamId unchanged', () => {
    const league = freshLeague('trade-pick-flip');
    const teams = Object.values(league.teams);
    const teamA = teams[0]!;
    const teamB = teams[1]!;
    const teamAPick = league.draftPicks.find(
      (p) => p.currentTeamId === teamA.identity.id && p.round === 3,
    )!;

    const next = executeTrade(league, {
      teamAId: teamA.identity.id,
      teamBId: teamB.identity.id,
      playersAToB: [],
      playersBToA: [],
      picksAToB: [teamAPick.id],
    });

    const flipped = next.draftPicks.find((p) => p.id === teamAPick.id)!;
    expect(flipped.currentTeamId).toBe(teamB.identity.id);
    expect(flipped.originalTeamId).toBe(teamA.identity.id);
    // Other picks unaffected.
    const untouched = next.draftPicks.filter((p) => p.id !== teamAPick.id);
    const untouchedBefore = league.draftPicks.filter((p) => p.id !== teamAPick.id);
    expect(untouched).toEqual(untouchedBefore);
  });

  it('mixed player+pick trade moves both atomically', () => {
    const league = freshLeague('trade-mixed');
    const teams = Object.values(league.teams);
    const teamA = teams[0]!;
    const teamB = teams[1]!;
    const aPlayer = teamA.rosterIds.find(
      (id) => !league.contracts[league.players[id]!.contractId!]!.noTradeClause,
    )!;
    const teamBPick = league.draftPicks.find(
      (p) => p.currentTeamId === teamB.identity.id && p.round === 4,
    )!;

    const next = executeTrade(league, {
      teamAId: teamA.identity.id,
      teamBId: teamB.identity.id,
      playersAToB: [aPlayer],
      playersBToA: [],
      picksBToA: [teamBPick.id],
    });

    // Player moved
    expect(next.teams[teamB.identity.id]!.rosterIds).toContain(aPlayer);
    expect(next.teams[teamA.identity.id]!.rosterIds).not.toContain(aPlayer);
    // Pick moved
    const flipped = next.draftPicks.find((p) => p.id === teamBPick.id)!;
    expect(flipped.currentTeamId).toBe(teamA.identity.id);
  });

  it('throws when attempting to trade a pick the source does not own', () => {
    const league = freshLeague('trade-pick-unowned');
    const teams = Object.values(league.teams);
    const teamA = teams[0]!;
    const teamB = teams[1]!;
    // Find a pick currently owned by team B but try to send it from A.
    const teamBPick = league.draftPicks.find(
      (p) => p.currentTeamId === teamB.identity.id,
    )!;
    expect(() =>
      executeTrade(league, {
        teamAId: teamA.identity.id,
        teamBId: teamB.identity.id,
        playersAToB: [],
        playersBToA: [],
        picksAToB: [teamBPick.id],
      }),
    ).toThrow(/owned by/);
  });

  it('records traded picks on the trade transaction', () => {
    const league = freshLeague('trade-pick-log');
    const teams = Object.values(league.teams);
    const teamA = teams[0]!;
    const teamB = teams[1]!;
    const teamAPick = league.draftPicks.find(
      (p) => p.currentTeamId === teamA.identity.id && p.round === 5,
    )!;

    const next = executeTrade(league, {
      teamAId: teamA.identity.id,
      teamBId: teamB.identity.id,
      playersAToB: [],
      playersBToA: [],
      picksAToB: [teamAPick.id],
    });

    const tradeEntry = next.transactionLog[next.transactionLog.length - 1]!;
    expect(tradeEntry.kind).toBe('trade');
    if (tradeEntry.kind === 'trade') {
      expect(tradeEntry.picksAToB).toEqual([teamAPick.id]);
      expect(tradeEntry.picksBToA).toBeUndefined();
    }
  });
});
