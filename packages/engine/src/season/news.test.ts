import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from './runner.js';
import { deriveNewsFeed } from './news.js';
import type { LeagueState } from '../types/league.js';
import type { Player } from '../types/player.js';
import type { Transaction } from '../types/transaction.js';
import type { TeamId, PlayerId } from '../types/ids.js';

describe('deriveNewsFeed', () => {
  it('returns an empty feed for a fresh league with no transactions', () => {
    const league = createLeague({ seed: 'news-empty' });
    const feed = deriveNewsFeed(league);
    expect(feed).toHaveLength(0);
  });

  it('surfaces leaked locker-room incidents and ignores non-leaked ones', () => {
    const base = createLeague({ seed: 'news-incident-leak' });
    const team = Object.values(base.teams)[0]!;
    const player = base.players[team.rosterIds[0]!]!;
    const leaked: Transaction = {
      kind: 'locker-room-incident',
      tick: base.tick,
      seasonNumber: base.seasonNumber,
      teamId: team.identity.id,
      playerId: player.id,
      flavor: 'media_blowup',
      mediaLeak: true,
      moodDelta: -8.4,
    };
    const quiet: Transaction = {
      kind: 'locker-room-incident',
      tick: base.tick,
      seasonNumber: base.seasonNumber,
      teamId: team.identity.id,
      playerId: player.id,
      flavor: 'practice_conflict',
      mediaLeak: false,
      moodDelta: -5.2,
    };
    const league: LeagueState = {
      ...base,
      transactionLog: [...base.transactionLog, leaked, quiet],
    };
    const feed = deriveNewsFeed(league);
    expect(feed).toHaveLength(1);
    expect(feed[0]!.sourceKind).toBe('locker-room-incident');
    expect(feed[0]!.source).toBe('anonymous_source');
  });

  it('attributes social_media_post incidents to the social_media source', () => {
    const base = createLeague({ seed: 'news-social' });
    const team = Object.values(base.teams)[0]!;
    const player = base.players[team.rosterIds[0]!]!;
    const txn: Transaction = {
      kind: 'locker-room-incident',
      tick: base.tick,
      seasonNumber: base.seasonNumber,
      teamId: team.identity.id,
      playerId: player.id,
      flavor: 'social_media_post',
      mediaLeak: true,
      moodDelta: -3.1,
    };
    const league: LeagueState = {
      ...base,
      transactionLog: [...base.transactionLog, txn],
    };
    const feed = deriveNewsFeed(league);
    expect(feed[0]!.source).toBe('social_media');
  });

  it('flags STAR trade requests as severity 5 with national-insider attribution', () => {
    const base = createLeague({ seed: 'news-star-tr' });
    const team = Object.values(base.teams)[0]!;
    const playerId = team.rosterIds[0]!;
    const txn: Transaction = {
      kind: 'trade-request',
      tick: base.tick,
      seasonNumber: base.seasonNumber,
      teamId: team.identity.id,
      playerId,
      state: 'requested',
      mood: 12,
      tier: 'STAR',
    };
    const league: LeagueState = {
      ...base,
      transactionLog: [...base.transactionLog, txn],
    };
    const feed = deriveNewsFeed(league);
    expect(feed).toHaveLength(1);
    expect(feed[0]!.severity).toBe(5);
    expect(feed[0]!.source).toBe('national_insider');
    expect(feed[0]!.headline).toContain('demands trade');
  });

  it('flags STARTER trade requests as severity 3 with anonymous-source attribution', () => {
    const base = createLeague({ seed: 'news-starter-tr' });
    const team = Object.values(base.teams)[0]!;
    const playerId = team.rosterIds[0]!;
    const txn: Transaction = {
      kind: 'trade-request',
      tick: base.tick,
      seasonNumber: base.seasonNumber,
      teamId: team.identity.id,
      playerId,
      state: 'requested',
      mood: 14,
      tier: 'STARTER',
    };
    const league: LeagueState = {
      ...base,
      transactionLog: [...base.transactionLog, txn],
    };
    const feed = deriveNewsFeed(league);
    expect(feed[0]!.severity).toBe(3);
    expect(feed[0]!.source).toBe('anonymous_source');
  });

  it('surfaces trades with severity matching the highest-tier player involved', () => {
    const base = createLeague({ seed: 'news-trade' });
    const teams = Object.values(base.teams);
    const teamA = teams[0]!;
    const teamB = teams[1]!;
    // Force the first traded player to STAR tier so the severity-5
    // path is exercised deterministically.
    const starId = teamA.rosterIds[0]!;
    const starPlayer = base.players[starId]!;
    const playersNext = {
      ...base.players,
      [starId]: { ...starPlayer, tier: 'STAR' as const },
    };
    const txn: Transaction = {
      kind: 'trade',
      tick: base.tick,
      seasonNumber: base.seasonNumber,
      teamAId: teamA.identity.id,
      teamBId: teamB.identity.id,
      playersAToB: [starId],
      playersBToA: [teamB.rosterIds[0]!],
      deadMoneyTeamA: 0,
      deadMoneyTeamB: 0,
    };
    const league: LeagueState = {
      ...base,
      players: playersNext,
      transactionLog: [...base.transactionLog, txn],
    };
    const feed = deriveNewsFeed(league);
    expect(feed).toHaveLength(1);
    expect(feed[0]!.severity).toBe(5);
    expect(feed[0]!.source).toBe('national_insider');
    expect(feed[0]!.teamIds).toEqual([teamA.identity.id, teamB.identity.id]);
  });

  it('ignores releases of BACKUP and FRINGE players (not newsworthy)', () => {
    const base = createLeague({ seed: 'news-release-tier' });
    const team = Object.values(base.teams)[0]!;
    // Find one BACKUP and one STAR on the team.
    const backupId = team.rosterIds.find(
      (id) => base.players[id]?.tier === 'BACKUP',
    );
    const starId = team.rosterIds.find(
      (id) => base.players[id]?.tier === 'STAR',
    );
    if (!backupId || !starId) return;
    const backupRelease: Transaction = {
      kind: 'release',
      tick: base.tick,
      seasonNumber: base.seasonNumber,
      teamId: team.identity.id,
      playerId: backupId,
      contractId: base.players[backupId]!.contractId!,
      deadMoney: 0,
    };
    const starRelease: Transaction = {
      kind: 'release',
      tick: base.tick,
      seasonNumber: base.seasonNumber,
      teamId: team.identity.id,
      playerId: starId,
      contractId: base.players[starId]!.contractId!,
      deadMoney: 8_000_000,
    };
    const league: LeagueState = {
      ...base,
      transactionLog: [...base.transactionLog, backupRelease, starRelease],
    };
    const feed = deriveNewsFeed(league);
    expect(feed).toHaveLength(1);
    expect(feed[0]!.playerIds[0]).toBe(starId);
    expect(feed[0]!.severity).toBe(4);
  });

  it('skips mid-season vet-min FA signings (marketContract=false)', () => {
    const base = createLeague({ seed: 'news-vetmin' });
    const team = Object.values(base.teams)[0]!;
    const starId = team.rosterIds.find(
      (id) => base.players[id]?.tier === 'STAR',
    );
    if (!starId) return;
    const vetMin: Transaction = {
      kind: 'fa-sign',
      tick: base.tick,
      seasonNumber: base.seasonNumber,
      teamId: team.identity.id,
      playerId: starId,
      contractId: base.players[starId]!.contractId!,
      yearOneCapHit: 1_200_000,
      marketContract: false,
    };
    const market: Transaction = {
      kind: 'fa-sign',
      tick: base.tick,
      seasonNumber: base.seasonNumber,
      teamId: team.identity.id,
      playerId: starId,
      contractId: base.players[starId]!.contractId!,
      yearOneCapHit: 18_000_000,
      marketContract: true,
    };
    const league: LeagueState = {
      ...base,
      transactionLog: [...base.transactionLog, vetMin, market],
    };
    const feed = deriveNewsFeed(league);
    expect(feed).toHaveLength(1);
    expect(feed[0]!.sourceKind).toBe('fa-sign');
  });

  it('ignores routine bookkeeping kinds (ir-move, ps-promotion, contract-expiration, mood-shift)', () => {
    const base = createLeague({ seed: 'news-routine' });
    const team = Object.values(base.teams)[0]!;
    const playerId = team.rosterIds[0]!;
    const contractId = base.players[playerId]!.contractId!;
    const noise: readonly Transaction[] = [
      {
        kind: 'ir-move',
        tick: base.tick,
        seasonNumber: base.seasonNumber,
        teamId: team.identity.id,
        playerId,
        injurySeverity: 'MAJOR',
        weeksOut: 8,
      },
      {
        kind: 'ps-promotion',
        tick: base.tick,
        seasonNumber: base.seasonNumber,
        originTeamId: team.identity.id,
        signingTeamId: team.identity.id,
        playerId,
        ownPromotion: true,
        contractId,
      },
      {
        kind: 'contract-expiration',
        tick: base.tick,
        seasonNumber: base.seasonNumber,
        teamId: team.identity.id,
        playerId,
        contractId,
        fromActiveRoster: true,
      },
      {
        kind: 'mood-shift',
        tick: base.tick,
        seasonNumber: base.seasonNumber,
        teamId: team.identity.id,
        playerId,
        fromBucket: 'content',
        toBucket: 'unsettled',
        mood: 55,
      },
    ];
    const league: LeagueState = {
      ...base,
      transactionLog: [...base.transactionLog, ...noise],
    };
    const feed = deriveNewsFeed(league);
    expect(feed).toHaveLength(0);
  });

  it('orders the feed newest-first', () => {
    const base = createLeague({ seed: 'news-order' });
    const team = Object.values(base.teams)[0]!;
    const starId = team.rosterIds.find(
      (id) => base.players[id]?.tier === 'STAR',
    );
    if (!starId) return;
    const early: Transaction = {
      kind: 'trade-request',
      tick: 10,
      seasonNumber: 1,
      teamId: team.identity.id,
      playerId: starId,
      state: 'requested',
      mood: 12,
      tier: 'STAR',
    };
    const late: Transaction = {
      kind: 'trade-request',
      tick: 25,
      seasonNumber: 1,
      teamId: team.identity.id,
      playerId: starId,
      state: 'resolved',
      mood: 45,
      tier: 'STAR',
    };
    const league: LeagueState = {
      ...base,
      transactionLog: [...base.transactionLog, early, late],
    };
    const feed = deriveNewsFeed(league);
    expect(feed[0]!.tick).toBe(25);
    expect(feed[1]!.tick).toBe(10);
  });

  it('respects the sinceTick, teamId, and limit filters', () => {
    const base = createLeague({ seed: 'news-filters' });
    const teams = Object.values(base.teams);
    const teamA = teams[0]!;
    const teamB = teams[1]!;
    const a = teamA.rosterIds.find((id) => base.players[id]?.tier === 'STAR');
    const b = teamB.rosterIds.find((id) => base.players[id]?.tier === 'STAR');
    if (!a || !b) return;
    const early: Transaction = {
      kind: 'trade-request',
      tick: 5,
      seasonNumber: 1,
      teamId: teamA.identity.id,
      playerId: a,
      state: 'requested',
      mood: 10,
      tier: 'STAR',
    };
    const mid: Transaction = {
      kind: 'trade-request',
      tick: 15,
      seasonNumber: 1,
      teamId: teamB.identity.id,
      playerId: b,
      state: 'requested',
      mood: 11,
      tier: 'STAR',
    };
    const late: Transaction = {
      kind: 'trade-request',
      tick: 20,
      seasonNumber: 1,
      teamId: teamA.identity.id,
      playerId: a,
      state: 'resolved',
      mood: 45,
      tier: 'STAR',
    };
    const league: LeagueState = {
      ...base,
      transactionLog: [...base.transactionLog, early, mid, late],
    };

    expect(deriveNewsFeed(league, { sinceTick: 10 }).map((n) => n.tick)).toEqual([20, 15]);
    expect(
      deriveNewsFeed(league, { teamId: teamA.identity.id }).every((n) =>
        n.teamIds.includes(teamA.identity.id),
      ),
    ).toBe(true);
    expect(deriveNewsFeed(league, { limit: 2 })).toHaveLength(2);
  });

  it('is deterministic — same league produces the same feed', () => {
    const a = simulateSeason(createLeague({ seed: 'news-det' }));
    const b = simulateSeason(createLeague({ seed: 'news-det' }));
    const feedA = deriveNewsFeed(a);
    const feedB = deriveNewsFeed(b);
    expect(feedA.map((n) => `${n.tick}|${n.sourceKind}|${n.headline}`)).toEqual(
      feedB.map((n) => `${n.tick}|${n.sourceKind}|${n.headline}`),
    );
  });

  it('produces a non-empty feed after a season of full sim', () => {
    const after = simulateSeason(createLeague({ seed: 'news-fullsim' }));
    const feed = deriveNewsFeed(after);
    // A 17-week season generates incidents, trade requests, and FA
    // signings — at least *some* should reach the news threshold.
    expect(feed.length).toBeGreaterThan(0);
  });
});
