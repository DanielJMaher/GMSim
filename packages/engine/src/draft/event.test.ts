import { describe, expect, it } from 'vitest';
import { Prng } from '../prng/index.js';
import { runDraft, applyDraftResult } from './event.js';
import { rollJuniorDeclarations } from './declaration.js';
import { computeDraftOrder } from './draft-order.js';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from '../season/runner.js';
import { advanceSeason } from '../season/advance.js';
import { computeRecords } from '../season/standings.js';
import { positionGroupFor } from '../players/position-group.js';
import type { TeamId } from '../types/ids.js';

describe('runDraft (slice 5a)', () => {
  it('fires one pick per team in draft order', () => {
    const baseLeague = createLeague({ seed: 'draft1' });
    // Declare juniors so the pool has enough eligible prospects.
    const league = {
      ...baseLeague,
      collegePool: rollJuniorDeclarations(new Prng('d'), baseLeague.collegePool),
    };
    const draftOrder = Object.keys(league.teams).slice(0, 32) as TeamId[];
    const result = runDraft(new Prng('r'), league, {
      draftOrder,
      pickedOnTick: 100,
      seasonNumber: 2,
    });
    expect(result.picks.length).toBe(32);
    for (let i = 0; i < 32; i++) {
      expect(result.picks[i]!.overallPick).toBe(i + 1);
      expect(result.picks[i]!.teamId).toBe(draftOrder[i]);
      expect(result.picks[i]!.round).toBe(1);
    }
  });

  it('every drafted prospect is removed from the pool exactly once', () => {
    const baseLeague = createLeague({ seed: 'draft-unique' });
    const league = {
      ...baseLeague,
      collegePool: rollJuniorDeclarations(new Prng('d'), baseLeague.collegePool),
    };
    const draftOrder = Object.keys(league.teams) as TeamId[];
    const result = runDraft(new Prng('r'), league, {
      draftOrder,
      pickedOnTick: 0,
      seasonNumber: 2,
    });
    const ids = new Set(result.picks.map((p) => p.collegePlayerId));
    expect(ids.size).toBe(result.picks.length);
    expect(result.removedFromCollegePool.size).toBe(result.picks.length);
  });

  it('picks come from the team\'s own draft board when available', () => {
    const baseLeague = createLeague({ seed: 'draft-board' });
    const league = {
      ...baseLeague,
      collegePool: rollJuniorDeclarations(new Prng('d'), baseLeague.collegePool),
    };
    const draftOrder = Object.keys(league.teams) as TeamId[];
    const result = runDraft(new Prng('r'), league, {
      draftOrder,
      pickedOnTick: 0,
      seasonNumber: 2,
    });
    let onBoardCount = 0;
    for (const pick of result.picks) {
      if (pick.boardRankAtPick !== null) onBoardCount++;
    }
    // Boards are 50-deep, only 32 picks fire — most picks should be
    // from-the-board.
    expect(onBoardCount).toBeGreaterThanOrEqual(28);
  });

  it('produces a promoted Player at the prospect\'s NFL projected position', () => {
    const baseLeague = createLeague({ seed: 'draft-promote' });
    const league = {
      ...baseLeague,
      collegePool: rollJuniorDeclarations(new Prng('d'), baseLeague.collegePool),
    };
    const draftOrder = Object.keys(league.teams).slice(0, 5) as TeamId[];
    const result = runDraft(new Prng('r'), league, {
      draftOrder,
      pickedOnTick: 0,
      seasonNumber: 2,
    });
    const poolById = new Map(league.collegePool.map((cp) => [cp.id, cp]));
    for (const player of result.newPlayers) {
      const cp = poolById.get(player.id);
      expect(cp).toBeDefined();
      expect(player.position).toBe(cp!.nflProjectedPosition);
      expect(player.positionGroup).toBe(positionGroupFor(cp!.nflProjectedPosition));
      expect(player.experienceYears).toBe(0);
      expect(player.contractId).not.toBeNull();
    }
  });

  it('is deterministic', () => {
    const baseLeague = createLeague({ seed: 'draft-det' });
    const league = {
      ...baseLeague,
      collegePool: rollJuniorDeclarations(new Prng('d'), baseLeague.collegePool),
    };
    const draftOrder = Object.keys(league.teams) as TeamId[];
    const a = runDraft(new Prng('r'), league, { draftOrder, pickedOnTick: 0, seasonNumber: 2 });
    const b = runDraft(new Prng('r'), league, { draftOrder, pickedOnTick: 0, seasonNumber: 2 });
    expect(a.picks.length).toBe(b.picks.length);
    for (let i = 0; i < a.picks.length; i++) {
      expect(a.picks[i]!.collegePlayerId).toBe(b.picks[i]!.collegePlayerId);
    }
  });
});

describe('applyDraftResult', () => {
  it('appends rookies to team rosters', () => {
    const baseLeague = createLeague({ seed: 'apply' });
    const league = {
      ...baseLeague,
      collegePool: rollJuniorDeclarations(new Prng('d'), baseLeague.collegePool),
    };
    const draftOrder = Object.keys(league.teams) as TeamId[];
    const result = runDraft(new Prng('r'), league, { draftOrder, pickedOnTick: 0, seasonNumber: 2 });
    const applied = applyDraftResult(league, result);
    for (const teamId of draftOrder) {
      const team = applied.teams[teamId]!;
      const baseTeam = league.teams[teamId]!;
      expect(team.rosterIds.length).toBe(baseTeam.rosterIds.length + 1);
    }
  });

  it('removes drafted prospects from the college pool', () => {
    const baseLeague = createLeague({ seed: 'apply-remove' });
    const league = {
      ...baseLeague,
      collegePool: rollJuniorDeclarations(new Prng('d'), baseLeague.collegePool),
    };
    const draftOrder = Object.keys(league.teams) as TeamId[];
    const result = runDraft(new Prng('r'), league, { draftOrder, pickedOnTick: 0, seasonNumber: 2 });
    const applied = applyDraftResult(league, result);
    const remainingIds = new Set(applied.collegePool.map((cp) => cp.id));
    for (const pid of result.removedFromCollegePool) {
      expect(remainingIds.has(pid)).toBe(false);
    }
    expect(applied.collegePool.length).toBe(league.collegePool.length - result.picks.length);
  });

  it('appends pick records to draftHistory', () => {
    const baseLeague = createLeague({ seed: 'apply-hist' });
    const league = {
      ...baseLeague,
      collegePool: rollJuniorDeclarations(new Prng('d'), baseLeague.collegePool),
    };
    const draftOrder = Object.keys(league.teams) as TeamId[];
    const before = league.draftHistory.length;
    const result = runDraft(new Prng('r'), league, { draftOrder, pickedOnTick: 0, seasonNumber: 2 });
    const applied = applyDraftResult(league, result);
    expect(applied.draftHistory.length).toBe(before + result.picks.length);
  });

  it('promoted player\'s contract is rostered to the right team', () => {
    const baseLeague = createLeague({ seed: 'apply-contract' });
    const league = {
      ...baseLeague,
      collegePool: rollJuniorDeclarations(new Prng('d'), baseLeague.collegePool),
    };
    const draftOrder = Object.keys(league.teams) as TeamId[];
    const result = runDraft(new Prng('r'), league, { draftOrder, pickedOnTick: 0, seasonNumber: 2 });
    const applied = applyDraftResult(league, result);
    for (const pick of result.picks) {
      const player = applied.players[pick.promotedPlayerId];
      const contract = applied.contracts[pick.contractId];
      expect(player).toBeDefined();
      expect(contract).toBeDefined();
      expect(player!.teamId).toBe(pick.teamId);
      expect(contract!.teamId).toBe(pick.teamId);
      expect(contract!.playerId).toBe(pick.promotedPlayerId);
    }
  });
});

describe('draft integration in advanceSeason', () => {
  it('advanceSeason fires a 7-round draft each year (up to 224 picks)', () => {
    const league = createLeague({ seed: 'adv-draft' });
    const played = simulateSeason(league);
    const after = advanceSeason(played);
    // 7 rounds × 32 picks = 224 maximum. Late rounds can run short
    // when declared-prospect supply runs out (rare; depends on
    // junior declaration rate this year), so allow [200, 224].
    expect(after.draftHistory.length).toBeGreaterThanOrEqual(200);
    expect(after.draftHistory.length).toBeLessThanOrEqual(224);
    expect(after.draftHistory[0]!.round).toBe(1);
    expect(after.draftHistory[0]!.overallPick).toBe(1);
    expect(after.draftHistory[31]!.overallPick).toBe(32);
    expect(after.draftHistory[31]!.round).toBe(1);
    // Last pick should be in round 7 (or last round actually fired).
    const lastPick = after.draftHistory[after.draftHistory.length - 1]!;
    expect(lastPick.round).toBeGreaterThanOrEqual(6);
    expect(lastPick.round).toBeLessThanOrEqual(7);
  });

  it('multi-year drafts accumulate in draftHistory', () => {
    let league = createLeague({ seed: 'adv-multi' });
    league = simulateSeason(league);
    league = advanceSeason(league);
    const firstYearCount = league.draftHistory.length;
    league = simulateSeason(league);
    league = advanceSeason(league);
    // Two years of drafts, each 200-224 picks.
    expect(league.draftHistory.length).toBeGreaterThanOrEqual(firstYearCount + 200);
    expect(league.draftHistory.length).toBeLessThanOrEqual(firstYearCount + 224);
    expect(league.draftHistory[0]!.seasonNumber).toBe(2);
    expect(league.draftHistory[league.draftHistory.length - 1]!.seasonNumber).toBe(3);
  });

  it('draft order matches inverse standings (worst team picks first)', () => {
    const league = createLeague({ seed: 'adv-order' });
    const played = simulateSeason(league);
    const records = computeRecords(played);
    const order = computeDraftOrder(records);
    const after = advanceSeason(played);
    expect(after.draftHistory[0]!.teamId).toBe(order[0]);
    expect(after.draftHistory[31]!.teamId).toBe(order[31]);
  });

  it('drafted prospects exit the college pool', () => {
    const league = createLeague({ seed: 'adv-pool' });
    const played = simulateSeason(league);
    const after = advanceSeason(played);
    const draftedIds = new Set(after.draftHistory.map((p) => p.collegePlayerId));
    for (const cp of after.collegePool) {
      expect(draftedIds.has(cp.id)).toBe(false);
    }
  });

  it('drafted rookies appear on team rosters as NFL players', () => {
    const league = createLeague({ seed: 'adv-roster' });
    const played = simulateSeason(league);
    const after = advanceSeason(played);
    for (const pick of after.draftHistory) {
      const team = after.teams[pick.teamId]!;
      expect(team.rosterIds).toContain(pick.promotedPlayerId);
      expect(after.players[pick.promotedPlayerId]).toBeDefined();
    }
  });

  it('migration backfills draftHistory on a save without it', () => {
    const league = createLeague({ seed: 'adv-mig' });
    const stripped = { ...league } as typeof league & {
      draftHistory?: typeof league.draftHistory;
    };
    delete stripped.draftHistory;
    const played = simulateSeason(stripped as typeof league);
    expect(played.draftHistory).toEqual([]);
  });
});
