import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import { tickPhase } from '../season/lifecycle.js';
import { computeConsensusBoard, consensusRankIndex } from './consensus.js';
import type { LeagueState } from '../types/league.js';

/**
 * v0.87 — weekly in-season scouting moves the TEAM boards (not just the
 * media board), which was the cause of the media-vs-team divergence
 * Daniel flagged. These guard the mechanism + its funnel guardrail.
 */
describe('weekly in-season scouting (v0.87)', () => {
  const realOverall = (league: LeagueState, id: string): number => {
    const cp = league.collegePool.find((p) => p.id === id)!;
    const vals = Object.values(cp.current) as number[];
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };

  it('team boards move during the college season, gradually and without vaulting', () => {
    let league = createLeague({ seed: 'weekly-scout-move' });

    const top10Median = (board: ReturnType<typeof computeConsensusBoard>): number => {
      const reals = board
        .slice(0, 10)
        .map((e) => realOverall(league, e.collegePlayerId as string))
        .sort((a, b) => a - b);
      return reals[Math.floor(reals.length / 2)]!;
    };

    let firstRanks: Map<string, number> | null = null;
    let firstMedian = 0;
    let obsAtFirstWeek = 0;
    let weeksSeen = 0;

    for (let i = 0; i < 50; i++) {
      const next = tickPhase(league);
      if (next === league) break;
      league = next;
      if (league.lifecyclePhase !== 'COLLEGE_WEEK') continue;
      weeksSeen++;
      if (firstRanks === null) {
        const firstBoard = computeConsensusBoard(league.draftBoards);
        firstRanks = consensusRankIndex(firstBoard);
        firstMedian = top10Median(firstBoard);
        obsAtFirstWeek = league.collegeObservations.length;
      }
      if (weeksSeen >= 8) break;
    }

    expect(weeksSeen).toBeGreaterThanOrEqual(8);
    expect(firstRanks).not.toBeNull();

    // Mechanism: weekly scout reads were filed through the season (the
    // college tick is year-granular, so they share an observedOnTick — the
    // stream growing is the signal the weekly reads fired + boards regen'd).
    expect(league.collegeObservations.length).toBeGreaterThan(obsAtFirstWeek);

    // The team consensus actually MOVED — at least one prospect changed rank.
    const lastBoard = computeConsensusBoard(league.draftBoards);
    const lastRanks = consensusRankIndex(lastBoard);
    let moved = 0;
    for (const [id, rank] of lastRanks) {
      const prev = firstRanks!.get(id);
      if (prev !== undefined && prev !== rank) moved++;
    }
    expect(moved).toBeGreaterThan(0);

    // Guardrail (no vaulting): in-season scouting refines, it doesn't drag
    // low-skill compilers to the top. The top-10's skill level shouldn't
    // fall meaningfully over the season, and no prospect should rocket in
    // from deep obscurity (bounded read shift can't vault an unranked name).
    expect(top10Median(lastBoard)).toBeGreaterThanOrEqual(firstMedian - 6);
    for (const entry of lastBoard.slice(0, 10)) {
      const prevRank = firstRanks!.get(entry.collegePlayerId as string);
      expect(prevRank).toBeDefined(); // was already on the board week 1
      expect(prevRank!).toBeLessThanOrEqual(100); // no vault from obscurity
    }
  });
});
