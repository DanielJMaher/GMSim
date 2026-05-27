import { describe, it } from 'vitest';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from './runner.js';
import { seasonStatsForLeague } from './stats.js';
import { tickPhase } from './lifecycle.js';
import type { CollegePlayerGameStats } from '../types/college-season.js';

/**
 * Instrument (not a guard) for the v0.83 stats rebalance. Prints the
 * current per-game / per-season output so we can compare to real
 * benchmarks before tuning. Skip in normal runs.
 *
 * Real benchmarks:
 *   NFL  — INT rate ~2.0-2.3% of attempts; ~0.7 INT/team/game; season
 *          INT leader ~15-18; typical starter ~8-12.
 *   CFB  — single-game records: 23 receptions, 405 rec yds; realistic
 *          top game ~8-12 catches / 120-180 yds; top tackler ~10-15/game;
 *          big sack game ~3.
 */
describe.skip('stats realism diagnostic', () => {
  it('NFL interception + passing output', () => {
    const league = simulateSeason(createLeague({ seed: 'stats-diag-nfl' }));
    const stats = seasonStatsForLeague(league);
    let totalInt = 0;
    let totalAtt = 0;
    const starterInts: number[] = [];
    for (const s of stats.values()) {
      if (s.passAttempts >= 150) {
        starterInts.push(s.interceptionsThrown);
        totalInt += s.interceptionsThrown;
        totalAtt += s.passAttempts;
      }
    }
    starterInts.sort((a, b) => b - a);
    const games = league.schedule!.regularSeason.flat().filter((g) => g.result).length;
    // Defensive side: who CATCHES the picks + sacks.
    const defInts: number[] = [];
    const sacks: number[] = [];
    let totalDefInt = 0;
    for (const s of stats.values()) {
      if (s.interceptions > 0) defInts.push(s.interceptions);
      if (s.sacks > 0) sacks.push(s.sacks);
      totalDefInt += s.interceptions;
    }
    defInts.sort((a, b) => b - a);
    sacks.sort((a, b) => b - a);
    /* eslint-disable no-console */
    console.log('=== NFL passing/INT diagnostic ===');
    console.log(`games played: ${games}`);
    console.log(`starter QBs (>=150 att): ${starterInts.length}`);
    console.log(`league INT% thrown (starters): ${((100 * totalInt) / totalAtt).toFixed(2)}%`);
    console.log(`mean starter season INT thrown: ${(totalInt / starterInts.length).toFixed(1)}`);
    console.log(`top 12 season INT thrown: ${starterInts.slice(0, 12).join(', ')}`);
    console.log('--- DEFENSIVE interceptions (the NFL "INT leader" stat) ---');
    console.log(`league total def INT: ${totalDefInt}`);
    console.log(`top 15 season def INT (real 2025 leader = 7): ${defInts.slice(0, 15).join(', ')}`);
    console.log(`top 10 season sacks (real leader ~16-22): ${sacks.slice(0, 10).join(', ')}`);
    /* eslint-enable no-console */
  });

  it('college single-game stat maxes', () => {
    let league = createLeague({ seed: 'stats-diag-cfb' });
    for (let i = 0; i < 55; i++) {
      const next = tickPhase(league);
      if (next === league) break;
      league = next;
    }
    const gs = league.collegeGameStats;
    const cpById = new Map(league.collegePool.map((cp) => [cp.id as string, cp]));
    const topBy = (
      label: string,
      val: (s: CollegePlayerGameStats) => number,
    ) => {
      const sorted = [...gs].sort((a, b) => val(b) - val(a)).slice(0, 5);
      /* eslint-disable no-console */
      console.log(`-- top ${label} --`);
      for (const s of sorted) {
        const cp = cpById.get(s.playerId);
        const name = cp ? `${cp.firstName} ${cp.lastName} (${cp.collegePosition})` : s.playerId;
        console.log(
          `  ${val(s)}  ${name} wk${s.weekNumber}  [rec ${s.receptions}/${s.targets} ${s.receivingYards}yd, rush ${s.rushingAttempts}/${s.rushingYards}, pass ${s.passCompletions}/${s.passAttempts} ${s.passingYards}yd ${s.passingTds}td ${s.interceptionsThrown}int, ${s.tackles}tkl ${s.sacks}sk ${s.interceptions}int]`,
        );
      }
      /* eslint-enable no-console */
    };
    /* eslint-disable no-console */
    console.log('=== CFB single-game maxes ===');
    console.log(`game stat lines: ${gs.length}`);
    /* eslint-enable no-console */
    topBy('receptions', (s) => s.receptions);
    topBy('receiving yards', (s) => s.receivingYards);
    topBy('rushing yards', (s) => s.rushingYards);
    topBy('passing yards', (s) => s.passingYards);
    topBy('tackles', (s) => s.tackles);
    topBy('sacks', (s) => s.sacks);
  });
});
