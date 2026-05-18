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

  it('sorts descending by averagePriority', () => {
    const boards = {
      [TEAM_A]: [entry('Hi', 250), entry('Lo', 50)],
      [TEAM_B]: [entry('Mid', 150), entry('Hi', 240)],
    };
    const consensus = computeConsensusBoard(boards);
    expect(consensus.map((e) => e.collegePlayerId)).toEqual([
      PlayerId('Hi'),
      PlayerId('Mid'),
      PlayerId('Lo'),
    ]);
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
