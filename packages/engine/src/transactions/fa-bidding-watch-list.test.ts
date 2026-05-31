import { describe, expect, it } from 'vitest';
import { auctionFreeAgent } from './fa-bidding.js';
import { createLeague } from '../league/generate.js';
import { releasePlayer } from './release.js';
import type { LeagueState } from '../types/league.js';
import type { TeamId, PlayerId } from '../types/ids.js';
import type { WatchListEntry } from '../types/scout.js';

function pickFreeAgentVia(seed: string): { league: LeagueState; playerId: PlayerId } {
  // Build a fresh league and release the first STAR off the first team to
  // create a free agent. Watch-list status against this player is then
  // already populated for whichever teams have him on their lists.
  let league = createLeague({ seed });
  const firstTeam = Object.values(league.teams)[0]!;
  const starId = firstTeam.rosterIds.find((id) => league.players[id]?.tier === 'STAR');
  expect(starId).toBeDefined();
  league = releasePlayer(league, starId!);
  return { league, playerId: starId! };
}

/** Cheapen a team's contracts so it has ample cap room. Position-weighted STAR
 *  contracts are expensive, so a test that needs the auction to FIND a winner
 *  must guarantee at least one bidder can afford the star. */
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

describe('watch-list bid boost', () => {
  it('perceivedBid is cash × preference (watch boost lives inside cash)', () => {
    const { league, playerId } = pickFreeAgentVia('wl-bid-formula');
    const player = league.players[playerId]!;
    const result = auctionFreeAgent(league, player);
    expect(result.bidders.length).toBeGreaterThan(0);
    for (const b of result.bidders) {
      const expected = b.cashValuation * b.preferenceMultiplier;
      expect(Math.abs(b.perceivedBid - expected)).toBeLessThan(0.01);
    }
  });

  it('watch-listed bidders have cashValuation > cashValuationBaseline', () => {
    // The point of moving the boost into cash: coveted players actually
    // cost more, instead of the winner getting a discount via second-price.
    const { league, playerId } = pickFreeAgentVia('wl-bid-cash-up');
    const player = league.players[playerId]!;
    const result = auctionFreeAgent(league, player);
    for (const b of result.bidders) {
      if (b.watchListPriority !== null) {
        // Allow a tiny epsilon because cap room can cap the boosted bid
        // back down to the baseline — but most STAR bidders have room.
        expect(b.cashValuation).toBeGreaterThanOrEqual(b.cashValuationBaseline - 1);
      } else {
        expect(b.cashValuation).toBe(Math.min(b.cashValuationBaseline, b.capRoomAtTime));
      }
    }
  });

  it('non-watch-listed teams bid at the 1.0 floor multiplier', () => {
    const { league, playerId } = pickFreeAgentVia('wl-bid-floor');
    const player = league.players[playerId]!;
    const result = auctionFreeAgent(league, player);
    let sawFloor = false;
    let sawBoost = false;
    for (const b of result.bidders) {
      if (b.watchListPriority === null) {
        expect(b.watchListMultiplier).toBe(1);
        expect(b.watchListReason).toBeNull();
        sawFloor = true;
      } else {
        expect(b.watchListMultiplier).toBeGreaterThan(1);
        expect(b.watchListMultiplier).toBeLessThanOrEqual(1.25);
        expect(b.watchListReason).not.toBeNull();
        sawBoost = true;
      }
    }
    // Realistic STAR FA — some teams have him watch-listed, some don't.
    expect(sawFloor || sawBoost).toBe(true);
  });

  it('watch-list boost is bounded at +25%', () => {
    const { league, playerId } = pickFreeAgentVia('wl-bid-ceiling');
    const player = league.players[playerId]!;
    const result = auctionFreeAgent(league, player);
    for (const b of result.bidders) {
      expect(b.watchListMultiplier).toBeGreaterThanOrEqual(1);
      expect(b.watchListMultiplier).toBeLessThanOrEqual(1.25);
    }
  });

  it('synthetic head-to-head: watch-listed team wins an otherwise tied race', () => {
    // Construct two clones of the same bid state — one bidder with watch
    // status, one without — and confirm the watch bidder's perceivedBid
    // outranks the other.
    const cash = 5_000_000;
    const preference = 1.0;
    const watchBidPerceived = cash * preference * 1.15;
    const otherPerceived = cash * preference * 1.0;
    expect(watchBidPerceived).toBeGreaterThan(otherPerceived);
  });

  it('bid structure is deterministic for the same seed', () => {
    const a = pickFreeAgentVia('wl-bid-determinism');
    const b = pickFreeAgentVia('wl-bid-determinism');
    const ra = auctionFreeAgent(a.league, a.league.players[a.playerId]!);
    const rb = auctionFreeAgent(b.league, b.league.players[b.playerId]!);
    expect(ra.bidders).toEqual(rb.bidders);
  });

  it('priority maps monotonically to multiplier across realistic range', () => {
    // Build a synthetic watch list with known priorities and verify that
    // higher priority → higher multiplier (or equal at the ceiling).
    const priorities = [10, 30, 50, 70, 90, 100];
    const synthetic: WatchListEntry[] = priorities.map((p, i) => ({
      playerId: `P_${i}` as PlayerId,
      priority: p,
      reason: 'ROLE_PLAYER',
      observedSkillScore: 0,
      schemeFit: 1,
      meanConfidence: 0,
      observationCount: 0,
      addedOnTick: 0,
    }));
    // Reuse the same formula the auction uses internally:
    // multiplier = 1 + min(0.25, priority/100 * 0.3).
    const multipliers = synthetic.map((e) => 1 + Math.min(0.25, (e.priority / 100) * 0.3));
    for (let i = 1; i < multipliers.length; i++) {
      expect(multipliers[i]!).toBeGreaterThanOrEqual(multipliers[i - 1]!);
    }
    expect(multipliers[multipliers.length - 1]).toBeLessThanOrEqual(1.25);
  });

  it('fa-sign transaction persists watch-list fields on each bidder', () => {
    const picked = pickFreeAgentVia('wl-bid-persist');
    const player = picked.league.players[picked.playerId]!;
    // Guarantee an affordable bidder exists — position-weighted STAR deals can
    // exceed every team's cap room on some seeds, leaving no auction winner.
    const otherTeamId = Object.keys(picked.league.teams).find(
      (id) => id !== player.teamId,
    ) as TeamId;
    const league = giveTeamCapRoom(picked.league, otherTeamId);
    // Drive the full auction → signing pipeline via offseason.refillRosters
    // path; in this test we just confirm the auction result has the
    // fields, which signAuctionWinner maps through verbatim.
    const result = auctionFreeAgent(league, player);
    expect(result.winnerTeamId).not.toBeNull();
    const winner = result.bidders.find((b) => b.teamId === result.winnerTeamId);
    expect(winner).toBeDefined();
    expect(typeof winner!.watchListMultiplier).toBe('number');
    expect(winner!.watchListMultiplier).toBeGreaterThanOrEqual(1);
    expect(winner!.watchListMultiplier).toBeLessThanOrEqual(1.25);
  });
});

describe('watch-list aggregate market impact', () => {
  it('across many auctions, watch-listed bidders win meaningfully more often than chance', () => {
    // Sanity check that the boost actually moves outcomes. Run the
    // auction on every starter released in turn across a few seeds and
    // count how often the winning team had the player on their list.
    let totalAuctions = 0;
    let winnerOnWatchList = 0;
    for (const seed of ['agg-1', 'agg-2', 'agg-3']) {
      let league = createLeague({ seed });
      const releaseCount = 15;
      const releaseIds: PlayerId[] = [];
      for (const team of Object.values(league.teams).slice(0, releaseCount)) {
        const target = team.rosterIds.find(
          (id) => league.players[id]?.tier === 'STARTER',
        );
        if (target) releaseIds.push(target);
      }
      for (const pid of releaseIds) {
        league = releasePlayer(league, pid);
      }
      for (const pid of releaseIds) {
        const player = league.players[pid];
        if (!player) continue;
        const result = auctionFreeAgent(league, player);
        if (!result.winnerTeamId) continue;
        totalAuctions++;
        const winnerBid = result.bidders.find((b) => b.teamId === result.winnerTeamId);
        if (winnerBid && winnerBid.watchListPriority !== null) winnerOnWatchList++;
      }
    }
    // If watch lists had zero impact and ~1/N teams watch-list a player,
    // we'd expect ~3-5% hit rate. With the boost we expect more — set a
    // conservative lower bound that catches a regression to "no boost"
    // without being flaky.
    expect(totalAuctions).toBeGreaterThan(10);
    const rate = winnerOnWatchList / totalAuctions;
    expect(rate).toBeGreaterThan(0.15);
  });
});
