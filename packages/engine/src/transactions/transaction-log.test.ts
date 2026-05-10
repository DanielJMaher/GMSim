import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from '../season/runner.js';
import { advanceSeason } from '../season/advance.js';
import { releasePlayer } from './release.js';
import { executeTrade } from './trade.js';
import { signFreeAgent } from './free-agency.js';
import type { Transaction } from '../types/transaction.js';
import type { LeagueState } from '../types/league.js';

function freshLeague(seed: string): LeagueState {
  return { ...createLeague({ seed }), phase: 'REGULAR_SEASON' as const };
}

describe('transactionLog', () => {
  it('createLeague initializes an empty log', () => {
    const league = createLeague({ seed: 'log-init' });
    expect(league.transactionLog).toEqual([]);
  });

  it('releasePlayer appends a release entry', () => {
    const league = freshLeague('log-release');
    const team = Object.values(league.teams)[0]!;
    const playerId = team.rosterIds[0]!;
    const next = releasePlayer(league, playerId);
    expect(next.transactionLog.length).toBe(1);
    const entry = next.transactionLog[0]!;
    expect(entry.kind).toBe('release');
    if (entry.kind === 'release') {
      expect(entry.teamId).toBe(team.identity.id);
      expect(entry.playerId).toBe(playerId);
      expect(entry.deadMoney).toBeGreaterThanOrEqual(0);
    }
  });

  it('executeTrade appends a trade entry with both sides', () => {
    const league = freshLeague('log-trade');
    const teams = Object.values(league.teams);
    const teamA = teams[0]!;
    const teamB = teams[1]!;
    const aPlayer = teamA.rosterIds.find(
      (id) => !league.contracts[league.players[id]!.contractId!]!.noTradeClause,
    )!;
    const bPlayer = teamB.rosterIds.find(
      (id) => !league.contracts[league.players[id]!.contractId!]!.noTradeClause,
    )!;
    const next = executeTrade(league, {
      teamAId: teamA.identity.id,
      teamBId: teamB.identity.id,
      playersAToB: [aPlayer],
      playersBToA: [bPlayer],
    });
    expect(next.transactionLog.length).toBe(1);
    const entry = next.transactionLog[0]!;
    expect(entry.kind).toBe('trade');
    if (entry.kind === 'trade') {
      expect(entry.playersAToB).toEqual([aPlayer]);
      expect(entry.playersBToA).toEqual([bPlayer]);
    }
  });

  it('signFreeAgent appends a fa-sign entry', () => {
    const base = freshLeague('log-fa-sign');
    // First release a player to create a FA, then sign them on a different team.
    const team = Object.values(base.teams)[0]!;
    const otherTeam = Object.values(base.teams)[1]!;
    const playerId = team.rosterIds[0]!;
    const released = releasePlayer(base, playerId);
    const signed = signFreeAgent(released, otherTeam.identity.id, playerId, {
      idSuffix: 'TEST',
      signedOnTick: 100,
    });
    expect(signed.transactionLog.length).toBe(2);
    expect(signed.transactionLog[0]!.kind).toBe('release');
    expect(signed.transactionLog[1]!.kind).toBe('fa-sign');
  });

  it('preserves prior log entries on subsequent transactions', () => {
    const base = freshLeague('log-chain');
    const team = Object.values(base.teams)[0]!;
    const a = releasePlayer(base, team.rosterIds[0]!);
    const b = releasePlayer(a, a.teams[team.identity.id]!.rosterIds[0]!);
    expect(b.transactionLog.length).toBe(2);
    expect(b.transactionLog[0]!.kind).toBe('release');
    expect(b.transactionLog[1]!.kind).toBe('release');
  });

  it('end-to-end: simulateSeason + advanceSeason logs in-season + offseason kinds', () => {
    let league = createLeague({ seed: 'log-e2e' });
    league = simulateSeason(league);
    league = advanceSeason(league);

    const kinds = new Set<Transaction['kind']>();
    for (const entry of league.transactionLog) kinds.add(entry.kind);

    // In-season produces ir-move + (sometimes) ps-promotion + (sometimes) fa-sign.
    // Offseason produces contract-expiration + fa-sign + (sometimes) cap-cut.
    expect(kinds.has('ir-move')).toBe(true);
    expect(kinds.has('contract-expiration')).toBe(true);
    expect(kinds.has('fa-sign')).toBe(true);
    expect(league.transactionLog.length).toBeGreaterThan(50);
  });

  it('determinism — same seed produces identical transaction logs', () => {
    const a = createLeague({ seed: 'log-det' });
    const b = createLeague({ seed: 'log-det' });
    const aRun = advanceSeason(simulateSeason(a));
    const bRun = advanceSeason(simulateSeason(b));
    expect(bRun.transactionLog).toEqual(aRun.transactionLog);
  });
});
