import { describe, it, expect } from 'vitest';
import { Prng } from '../prng/index.js';
import { createLeague } from '../league/index.js';
import { simulateGameDrives, simulateGameWithDrives, type PlayerStatLine } from './drive-sim.js';
import { matchupFacets } from './strength.js';
import { simulateGame } from './outcome.js';
import { deriveGamePlayerStats } from './stats.js';

describe('drive sim (bottom-up)', () => {
  it('is deterministic for the facet-only path', () => {
    const league = createLeague({ seed: 'drive-test' });
    const ids = Object.keys(league.teams);
    const home = league.teams[ids[0]!]!;
    const away = league.teams[ids[1]!]!;
    const hf = matchupFacets(home, league);
    const af = matchupFacets(away, league);
    const a = simulateGameDrives(new Prng('g1'), hf, af);
    const b = simulateGameDrives(new Prng('g1'), hf, af);
    expect(a.homeScore).toBe(b.homeScore);
    expect(a.awayScore).toBe(b.awayScore);
    expect(a.driveLog.length).toBe(b.driveLog.length);
  });

  it('attributes emergent player stats with internally consistent totals', () => {
    const league = createLeague({ seed: 'drive-test' });
    const ids = Object.keys(league.teams);
    const home = league.teams[ids[0]!]!;
    const away = league.teams[ids[1]!]!;
    const res = simulateGameWithDrives(new Prng('attr1'), home, away, league);
    expect(res.playerStats).toBeDefined();
    const stats = res.playerStats!;
    expect(stats.size).toBeGreaterThan(0);

    // Partition the two rosters and check the per-team passing invariants:
    // a QB's passing yards == his receivers' receiving yards; attempts ==
    // targets; completions == receptions. These hold exactly because every
    // completed pass credits the QB and the targeted receiver the same gain.
    for (const team of [home, away]) {
      const roster = new Set(team.rosterIds);
      let qbYards = 0, qbAtt = 0, qbComp = 0, qbTds = 0;
      let recYards = 0, targets = 0, receptions = 0, recTds = 0;
      for (const [pid, l] of stats as Map<string, PlayerStatLine>) {
        if (!roster.has(pid)) continue;
        qbYards += l.passingYards; qbAtt += l.passAttempts; qbComp += l.passCompletions; qbTds += l.passingTds;
        recYards += l.receivingYards; targets += l.targets; receptions += l.receptions; recTds += l.receivingTds;
      }
      expect(qbYards).toBe(recYards);
      expect(qbAtt).toBe(targets);
      expect(qbComp).toBe(receptions);
      expect(qbTds).toBe(recTds);
    }
  });

  it('is deterministic for the attributed path', () => {
    const league = createLeague({ seed: 'drive-test' });
    const ids = Object.keys(league.teams);
    const home = league.teams[ids[0]!]!;
    const away = league.teams[ids[1]!]!;
    const a = simulateGameWithDrives(new Prng('attr2'), home, away, league);
    const b = simulateGameWithDrives(new Prng('attr2'), home, away, league);
    expect(a.homeScore).toBe(b.homeScore);
    const ay = [...a.playerStats!.values()].reduce((s, l) => s + l.receivingYards, 0);
    const by = [...b.playerStats!.values()].reduce((s, l) => s + l.receivingYards, 0);
    expect(ay).toBe(by);
  });

  it('credits tackles to defenders', () => {
    const league = createLeague({ seed: 'drive-test' });
    const ids = Object.keys(league.teams);
    const res = simulateGameWithDrives(new Prng('tk'), league.teams[ids[0]!]!, league.teams[ids[1]!]!, league);
    const totalTackles = [...res.playerStats!.values()].reduce((s, l) => s + l.tackles, 0);
    expect(totalTackles).toBeGreaterThan(20);
  });
});

describe('statEngine flag wiring', () => {
  it('topdown (default) stores no playerStats; bottomup stores emergent lines', () => {
    const legacy = createLeague({ seed: 'flag-test' });
    const ids = Object.keys(legacy.teams);
    const opts = (lg: typeof legacy) => ({
      homeTeam: lg.teams[ids[0]!]!,
      awayTeam: lg.teams[ids[1]!]!,
      league: lg,
      weekNumber: 1,
      kind: 'REGULAR' as const,
    });

    const topGame = simulateGame(new Prng('g'), opts(legacy));
    expect(topGame.result?.playerStats).toBeUndefined();
    // top-down still derives lines from the box score.
    expect(deriveGamePlayerStats(topGame, legacy).length).toBeGreaterThan(0);

    const bottom = createLeague({ seed: 'flag-test', statEngine: 'bottomup' });
    const botGame = simulateGame(new Prng('g'), opts(bottom));
    expect(botGame.result?.playerStats).toBeDefined();
    expect(botGame.result!.playerStats!.length).toBeGreaterThan(0);
    // deriveGamePlayerStats returns the stored emergent lines verbatim.
    expect(deriveGamePlayerStats(botGame, bottom)).toBe(botGame.result!.playerStats);
  });
});
