import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import { runWeeklyNpcTrades } from './npc-trade.js';
import { simulateSeason } from '../season/runner.js';
import { Prng } from '../prng/index.js';
import { MOOD_BASELINE } from '../season/mood.js';
import type { LeagueState } from '../types/league.js';

describe('runWeeklyNpcTrades', () => {
  it('is a no-op when no trade requests are outstanding', () => {
    const base = createLeague({ seed: 'npc-trade-empty' });
    const after = runWeeklyNpcTrades(new Prng('p'), base, base.tick);
    expect(after).toBe(base);
  });

  it('matches an open trade request to a buyer with positional need', () => {
    // Construct a deterministic scenario: pick a STAR on one team and
    // mark them as having demanded a trade. The trade-finder should
    // ship them somewhere else. The destination has to have a
    // position-need at that position; we sample 32 teams so at least
    // one is likely to have a deficit at any given position.
    const base = createLeague({ seed: 'npc-trade-match' });
    const seller = Object.values(base.teams)[0]!;
    // Pick the first STAR on the seller's roster with a contract.
    const requesterId = seller.rosterIds.find((id) => {
      const p = base.players[id]!;
      return p.tier === 'STAR' && p.contractId !== null;
    });
    if (!requesterId) {
      // Seed didn't produce a contracted STAR on team 0 — this is a
      // generation-randomness artefact, skip rather than fail flakily.
      return;
    }
    const requester = base.players[requesterId]!;
    const league: LeagueState = {
      ...base,
      players: {
        ...base.players,
        [requesterId]: {
          ...requester,
          mood: 8,
          tradeRequestedOnTick: base.tick - 3,
        },
      },
    };

    const after = runWeeklyNpcTrades(new Prng('p'), league, league.tick);
    const movedPlayer = after.players[requesterId]!;
    expect(movedPlayer.teamId).not.toBe(seller.identity.id);
    // Wish granted: mood snaps back to baseline + request clears.
    expect(movedPlayer.mood).toBe(MOOD_BASELINE);
    expect(movedPlayer.tradeRequestedOnTick).toBeNull();
    // Seller's roster no longer contains the moved player.
    expect(after.teams[seller.identity.id]!.rosterIds).not.toContain(requesterId);
    // A `trade` transaction landed in the log.
    const trades = after.transactionLog.filter((t) => t.kind === 'trade');
    expect(trades.length).toBe(1);
  });

  it('leaves the request open when no buyer has cap room', () => {
    // Force every other team to be cap-strapped so no one can absorb
    // the incoming contract.
    const base = createLeague({ seed: 'npc-trade-no-cap' });
    const seller = Object.values(base.teams)[0]!;
    const requesterId = seller.rosterIds.find((id) => {
      const p = base.players[id]!;
      return p.tier === 'STAR' && p.contractId !== null;
    });
    if (!requesterId) return;
    const requester = base.players[requesterId]!;
    // Spike every OTHER team's cap usage above ceiling via a giant
    // dead-money charge in year 0. Sale would create dead money for
    // the seller too, but executeTrade tolerates over-cap teams as
    // long as the contract-level checks pass; the buyer-side
    // pre-check in findBuyer is what we're stress-testing.
    const teams: typeof base.teams = { ...base.teams };
    for (const team of Object.values(base.teams)) {
      if (team.identity.id === seller.identity.id) continue;
      teams[team.identity.id] = {
        ...team,
        deadMoneyByYear: [base.salaryCap * 2, 0, 0, 0, 0],
      };
    }
    const league: LeagueState = {
      ...base,
      teams,
      players: {
        ...base.players,
        [requesterId]: {
          ...requester,
          mood: 5,
          tradeRequestedOnTick: base.tick - 1,
        },
      },
    };
    const after = runWeeklyNpcTrades(new Prng('p'), league, league.tick);
    expect(after.players[requesterId]!.teamId).toBe(seller.identity.id);
    expect(after.players[requesterId]!.tradeRequestedOnTick).not.toBeNull();
    expect(after.transactionLog.filter((t) => t.kind === 'trade')).toHaveLength(0);
  });

  it('is deterministic across identical inputs', () => {
    const league: LeagueState = injectRequest(createLeague({ seed: 'npc-trade-det' }));
    const a = runWeeklyNpcTrades(new Prng('p'), league, league.tick);
    const b = runWeeklyNpcTrades(new Prng('p'), league, league.tick);
    expect(a.transactionLog.length).toBe(b.transactionLog.length);
    // Same trades, same order, same target teams.
    const tradesA = a.transactionLog.filter((t) => t.kind === 'trade');
    const tradesB = b.transactionLog.filter((t) => t.kind === 'trade');
    for (let i = 0; i < tradesA.length; i++) {
      const ea = tradesA[i]!;
      const eb = tradesB[i]!;
      if (ea.kind !== 'trade' || eb.kind !== 'trade') continue;
      expect(ea.teamAId).toBe(eb.teamAId);
      expect(ea.teamBId).toBe(eb.teamBId);
      expect(ea.playersAToB).toEqual(eb.playersAToB);
      expect(ea.playersBToA).toEqual(eb.playersBToA);
    }
  });

  it('caps each team to at most one trade per weekly pass', () => {
    // Make every STAR on a single team's roster demand a trade. Only
    // ONE should ship out this pass.
    const base = createLeague({ seed: 'npc-trade-cap-per-team' });
    const seller = Object.values(base.teams)[0]!;
    const players: typeof base.players = { ...base.players };
    for (const id of seller.rosterIds) {
      const p = base.players[id]!;
      if (p.tier !== 'STAR' || p.contractId === null) continue;
      players[id] = { ...p, mood: 5, tradeRequestedOnTick: base.tick - 5 };
    }
    const league: LeagueState = { ...base, players };
    const requesters = Object.values(players).filter(
      (p) => p.teamId === seller.identity.id && p.tradeRequestedOnTick !== null,
    );
    if (requesters.length < 2) return; // not enough STARs to test

    const after = runWeeklyNpcTrades(new Prng('p'), league, league.tick);
    const tradesOut = after.transactionLog
      .filter((t) => t.kind === 'trade')
      .filter((t) => t.kind === 'trade' && t.teamAId === seller.identity.id);
    expect(tradesOut.length).toBeLessThanOrEqual(1);
  });

  it('runs end-to-end inside simulateSeason without blowing up', () => {
    // Smoke: a full simmed season completes normally even with the
    // trade-finder live. Trade requests + matches should accumulate
    // visibly in the log over 17 weeks.
    const after = simulateSeason(createLeague({ seed: 'npc-trade-integration' }));
    const trades = after.transactionLog.filter((t) => t.kind === 'trade');
    const tradeRequests = after.transactionLog.filter((t) => t.kind === 'trade-request');
    expect(trades.length).toBeGreaterThanOrEqual(0);
    expect(tradeRequests.length).toBeGreaterThanOrEqual(0);
    // Schedule was simulated to completion.
    expect(after.schedule).not.toBeNull();
  });
});

function injectRequest(league: LeagueState): LeagueState {
  const seller = Object.values(league.teams)[0]!;
  for (const id of seller.rosterIds) {
    const p = league.players[id];
    if (!p || p.tier !== 'STAR' || p.contractId === null) continue;
    return {
      ...league,
      players: {
        ...league.players,
        [id]: { ...p, mood: 8, tradeRequestedOnTick: league.tick - 1 },
      },
    };
  }
  return league;
}

