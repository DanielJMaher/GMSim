import { describe, expect, it } from 'vitest';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from '../season/runner.js';
import { advanceSeason } from '../season/advance.js';
import { regenerateDraftBoardsForLeague } from './board.js';
import type { TeamId } from '../types/ids.js';

describe('regenerateDraftBoardsForLeague (slice 3)', () => {
  it('createLeague populates draftBoards for all 32 teams', () => {
    const league = createLeague({ seed: 'boards-init' });
    expect(Object.keys(league.draftBoards).length).toBe(32);
    for (const teamId of Object.keys(league.draftBoards) as TeamId[]) {
      const board = league.draftBoards[teamId];
      expect(board).toBeDefined();
      expect(board!.length).toBeGreaterThan(0);
      expect(board!.length).toBeLessThanOrEqual(50);
    }
  });

  it('boards are sorted by priority desc', () => {
    const league = createLeague({ seed: 'boards-sort' });
    for (const board of Object.values(league.draftBoards)) {
      for (let i = 1; i < board.length; i++) {
        expect(board[i]!.priority).toBeLessThanOrEqual(board[i - 1]!.priority);
      }
    }
  });

  it('every entry has all derived fields populated', () => {
    const league = createLeague({ seed: 'boards-fields' });
    const someBoard = Object.values(league.draftBoards)[0]!;
    for (const entry of someBoard) {
      expect(entry.collegePlayerId).toMatch(/^CP_/);
      expect(entry.priority).toBeGreaterThanOrEqual(0);
      expect(entry.observedSkillScore).toBeGreaterThanOrEqual(0);
      expect(entry.schemeFit).toBeGreaterThan(0);
      expect(entry.meanConfidence).toBeGreaterThan(0);
      expect(entry.meanConfidence).toBeLessThanOrEqual(1);
      expect(entry.observationCount).toBeGreaterThan(0);
      expect(['BLUE_CHIP', 'SCHEME_FIT', 'POSITIONAL_NEED', 'CONVERSION_PROJECTION', 'DEVELOPMENTAL']).toContain(entry.reason);
    }
  });

  it('different teams produce meaningfully different boards', () => {
    const league = createLeague({ seed: 'boards-variance' });
    const teamIds = Object.keys(league.draftBoards) as TeamId[];
    const a = league.draftBoards[teamIds[0]!]!;
    const b = league.draftBoards[teamIds[1]!]!;
    // Compute Jaccard similarity of top-25 prospect IDs.
    const aTop = new Set(a.slice(0, 25).map((e) => e.collegePlayerId));
    const bTop = new Set(b.slice(0, 25).map((e) => e.collegePlayerId));
    let intersect = 0;
    for (const id of aTop) if (bTop.has(id)) intersect++;
    const union = new Set([...aTop, ...bTop]).size;
    const jaccard = intersect / union;
    // Some overlap is expected (BLUE_CHIPS appear on most boards) but
    // boards should not be identical. Loose bound — allow 0.10..0.85.
    expect(jaccard).toBeLessThan(0.85);
  });

  it('CONVERSION_PROJECTION reason fires for at least some prospects', () => {
    const league = createLeague({ seed: 'boards-conv' });
    let count = 0;
    for (const board of Object.values(league.draftBoards)) {
      for (const entry of board) {
        if (entry.reason === 'CONVERSION_PROJECTION') count++;
      }
    }
    expect(count).toBeGreaterThan(0);
  });

  it('is deterministic for the same league seed', () => {
    const a = createLeague({ seed: 'det-boards' });
    const b = createLeague({ seed: 'det-boards' });
    const teamIds = Object.keys(a.draftBoards) as TeamId[];
    for (const teamId of teamIds) {
      expect(a.draftBoards[teamId]).toEqual(b.draftBoards[teamId]);
    }
  });

  it('advanceSeason regenerates boards with the new tick', () => {
    const league = createLeague({ seed: 'boards-cycle' });
    const initialTick = Object.values(league.draftBoards)[0]![0]!.addedOnTick;
    const played = simulateSeason(league);
    const after = advanceSeason(played);
    const newTick = Object.values(after.draftBoards)[0]![0]!.addedOnTick;
    expect(newTick).toBeGreaterThan(initialTick);
    // All entries on every board carry the new tick.
    for (const board of Object.values(after.draftBoards)) {
      for (const entry of board) {
        expect(entry.addedOnTick).toBe(newTick);
      }
    }
  });

  it('migration backfills draftBoards on a save without them', () => {
    const league = createLeague({ seed: 'mig-boards' });
    const stripped = { ...league } as typeof league & {
      draftBoards?: typeof league.draftBoards;
    };
    delete stripped.draftBoards;
    const played = simulateSeason(stripped as typeof league);
    expect(Object.keys(played.draftBoards).length).toBe(32);
  });

  it('pure-function shim returns the same boards as the createLeague wiring', () => {
    const league = createLeague({ seed: 'pure-shim' });
    const recomputed = regenerateDraftBoardsForLeague({
      teams: league.teams,
      collegeScouts: league.collegeScouts,
      coaches: league.coaches,
      players: league.players,
      collegePool: league.collegePool,
      observations: league.collegeObservations,
      addedOnTick: 0,
    });
    const teamIds = Object.keys(league.draftBoards) as TeamId[];
    for (const teamId of teamIds) {
      const a = league.draftBoards[teamId]!;
      const b = recomputed[teamId]!;
      expect(b.length).toBe(a.length);
      for (let i = 0; i < a.length; i++) {
        expect(b[i]!.collegePlayerId).toBe(a[i]!.collegePlayerId);
        expect(b[i]!.priority).toBe(a[i]!.priority);
      }
    }
  });
});
