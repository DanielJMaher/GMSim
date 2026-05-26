import { describe, it, expect } from 'vitest';
import { computeOutletMockBoard, computeMediaConsensusBoard } from './mock-boards.js';
import { generateMediaCollegeObservations } from './prospect-evaluators.js';
import { createLeague } from '../league/generate.js';
import { Prng } from '../prng/index.js';

const league = createLeague({ seed: 'mock-base' });
const mediaObs = generateMediaCollegeObservations(
  new Prng('mock-obs'),
  league.mediaOutlets,
  league.collegePool,
  0,
);
const collegeOutlets = Object.values(league.mediaOutlets).filter((o) => o.focus === 'COLLEGE');

describe('computeMediaConsensusBoard', () => {
  it('produces a depth-capped board of sequential projected picks', () => {
    const board = computeMediaConsensusBoard(mediaObs, 25);
    expect(board.length).toBeGreaterThan(0);
    expect(board.length).toBeLessThanOrEqual(25);
    board.forEach((e, i) => expect(e.projectedOverallPick).toBe(i + 1));
    // Grades are non-increasing down the board.
    for (let i = 1; i < board.length; i++) {
      expect(board[i - 1]!.grade).toBeGreaterThanOrEqual(board[i]!.grade);
    }
  });

  it('is deterministic', () => {
    expect(computeMediaConsensusBoard(mediaObs, 25)).toEqual(computeMediaConsensusBoard(mediaObs, 25));
  });

  it('all-equal outlet weights match the unweighted consensus', () => {
    const weights = new Map<string, number>();
    for (const o of collegeOutlets) weights.set(o.id, 1);
    expect(computeMediaConsensusBoard(mediaObs, 25, weights)).toEqual(
      computeMediaConsensusBoard(mediaObs, 25),
    );
  });
});

describe('computeOutletMockBoard', () => {
  it('only ranks prospects the outlet observed', () => {
    const outlet = collegeOutlets[0]!;
    const board = computeOutletMockBoard(mediaObs, outlet.id, 50);
    expect(board.length).toBeGreaterThan(0);
    const outletProspectIds = new Set(
      mediaObs
        .filter((o) => o.scoutId.startsWith(`${outlet.id}::`))
        .map((o) => o.collegePlayerId),
    );
    for (const e of board) expect(outletProspectIds.has(e.prospectId)).toBe(true);
  });

  it('outlets diverge — boards are not identical across the slate', () => {
    if (collegeOutlets.length < 2) return;
    const a = computeOutletMockBoard(mediaObs, collegeOutlets[0]!.id, 20).map((e) => e.prospectId);
    // Find an outlet whose top-20 order differs from outlet A.
    const differs = collegeOutlets
      .slice(1)
      .some((o) => {
        const b = computeOutletMockBoard(mediaObs, o.id, 20).map((e) => e.prospectId);
        return JSON.stringify(a) !== JSON.stringify(b);
      });
    expect(differs).toBe(true);
  });
});
