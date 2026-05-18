import { describe, expect, it } from 'vitest';
import { computeConsensusBoard, consensusRankIndex } from './consensus.js';
import { TeamId, PlayerId } from '../types/ids.js';
import type { DraftBoardEntry } from '../types/college.js';

const TEAM_A = TeamId('A');
const TEAM_B = TeamId('B');
const TEAM_C = TeamId('C');

function entry(id: string, priority: number): DraftBoardEntry {
  return {
    collegePlayerId: PlayerId(id),
    priority,
    reason: 'BLUE_CHIP',
    observedSkillScore: 80,
    schemeFit: 1,
    meanConfidence: 0.8,
    observationCount: 5,
    addedOnTick: 0,
  };
}

describe('computeConsensusBoard', () => {
  it('aggregates priority across teams that carry the prospect', () => {
    const boards = {
      [TEAM_A]: [entry('X', 200), entry('Y', 100)],
      [TEAM_B]: [entry('X', 180), entry('Z', 90)],
      [TEAM_C]: [entry('X', 220)],
    };
    const consensus = computeConsensusBoard(boards);
    const x = consensus.find((e) => e.collegePlayerId === PlayerId('X'))!;
    expect(x.appearances).toBe(3);
    expect(x.averagePriority).toBeCloseTo((200 + 180 + 220) / 3, 5);
  });

  it('treats absence as zero contribution (not as a literal 0)', () => {
    // Y only appears on team A's board, so its avg should be 100,
    // not 100/3 = 33.
    const boards = {
      [TEAM_A]: [entry('X', 200), entry('Y', 100)],
      [TEAM_B]: [entry('X', 180)],
      [TEAM_C]: [entry('X', 220)],
    };
    const consensus = computeConsensusBoard(boards);
    const y = consensus.find((e) => e.collegePlayerId === PlayerId('Y'))!;
    expect(y.appearances).toBe(1);
    expect(y.averagePriority).toBe(100);
  });

  it('sorts descending by totalPriority (appearance-weighted)', () => {
    // 'Pop' is on both boards at moderate priority — high total.
    // 'Niche' is on one board at extreme priority but low total.
    const boards = {
      [TEAM_A]: [entry('Pop', 150), entry('Niche', 300)],
      [TEAM_B]: [entry('Pop', 140)],
    };
    const consensus = computeConsensusBoard(boards);
    // Pop totals 290 across 2 appearances; Niche totals 300 on 1.
    // Niche edges Pop on total — but the v0.51 ranking with appearance
    // tiebreak should still favor Pop when totals are close.
    // Adjust scenario to make total ordering unambiguous.
    expect(consensus[0]!.totalPriority).toBe(300); // Niche by raw total
    // Switch scenario: high-appearance prospect should out-rank niche.
    const boards2 = {
      [TEAM_A]: [entry('BlueChip', 150)],
      [TEAM_B]: [entry('BlueChip', 140), entry('Niche', 200)],
      [TEAM_C]: [entry('BlueChip', 145)],
    };
    const consensus2 = computeConsensusBoard(boards2);
    // BlueChip total 435 (3 appearances) beats Niche 200 (1 appearance).
    expect(consensus2[0]!.collegePlayerId).toBe(PlayerId('BlueChip'));
    expect(consensus2[1]!.collegePlayerId).toBe(PlayerId('Niche'));
  });

  it('preserves averagePriority as an informational stat (not the ranking signal)', () => {
    const boards = {
      [TEAM_A]: [entry('X', 200), entry('Y', 100)],
    };
    const consensus = computeConsensusBoard(boards);
    const x = consensus.find((e) => e.collegePlayerId === PlayerId('X'))!;
    expect(x.averagePriority).toBe(200);
    expect(x.totalPriority).toBe(200);
    expect(x.appearances).toBe(1);
  });

  it('averages rank position across appearances', () => {
    // X at #1 on A, #3 on B → average rank 2.
    const boards = {
      [TEAM_A]: [entry('X', 200), entry('Y', 180), entry('Z', 160)],
      [TEAM_B]: [entry('Y', 190), entry('Z', 170), entry('X', 150)],
    };
    const consensus = computeConsensusBoard(boards);
    const x = consensus.find((e) => e.collegePlayerId === PlayerId('X'))!;
    expect(x.averageRank).toBe(2);
  });

  it('empty input returns empty output', () => {
    expect(computeConsensusBoard({})).toEqual([]);
  });
});

describe('consensusRankIndex', () => {
  it('returns 1-based rank by consensus order', () => {
    const boards = {
      [TEAM_A]: [entry('X', 200), entry('Y', 100)],
      [TEAM_B]: [entry('X', 220), entry('Z', 50)],
    };
    const consensus = computeConsensusBoard(boards);
    const index = consensusRankIndex(consensus);
    expect(index.get(PlayerId('X'))).toBe(1);
    expect(index.get(PlayerId('Y'))).toBeGreaterThan(1);
    expect(index.get(PlayerId('Z'))).toBeGreaterThan(1);
  });
});
