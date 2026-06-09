import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from './runner.js';
import { advanceSeason } from './advance.js';
import { seasonStatsForLeague, playerSeasonStats } from './stats.js';
import { deriveGamePlayerStats } from '../games/stats.js';
import { Position } from '../types/enums.js';

describe('deriveGamePlayerStats', () => {
  it('returns empty for a game with no result', () => {
    const league = createLeague({ seed: 'pgs-empty' });
    const fakeGame = {
      id: 'fake' as never,
      weekNumber: 1,
      homeTeamId: Object.values(league.teams)[0]!.identity.id,
      awayTeamId: Object.values(league.teams)[1]!.identity.id,
      result: null,
      kind: 'REGULAR' as const,
    };
    expect(deriveGamePlayerStats(fakeGame, league)).toEqual([]);
  });

  it('per-team passing yards distributed across QBs sum to team total', () => {
    const league = simulateSeason(createLeague({ seed: 'pgs-reconcile-pass' }));
    const someGame = league.schedule!.regularSeason[0]![0]!;
    const lines = deriveGamePlayerStats(someGame, league);

    const home = league.teams[someGame.homeTeamId]!;
    const homeQbs = home.rosterIds
      .map((id) => league.players[id]!)
      .filter((p) => p.position === Position.QB);
    const homeQbIds = new Set(homeQbs.map((p) => p.id));

    const homeQbPassYards = lines
      .filter((l) => homeQbIds.has(l.playerId))
      .reduce((s, l) => s + l.passingYards, 0);
    expect(homeQbPassYards).toBe(someGame.result!.homeStats.passingYards);
  });

  it('per-team rushing yards distributed across RBs sum to team total', () => {
    // Reconcile against the WEEK-0 (pre-trade) roster: deadline trades can move
    // a player off the team mid-season, and `deriveGamePlayerStats` returns the
    // bottom-up lines as stored (no team tag), so the end-of-season roster would
    // wrongly exclude a traded contributor's week-0 yards.
    const base = createLeague({ seed: 'pgs-reconcile-rush' });
    const league = simulateSeason(base);
    const someGame = league.schedule!.regularSeason[0]![0]!;
    const lines = deriveGamePlayerStats(someGame, league);

    const home = base.teams[someGame.homeTeamId]!;
    const homeRunnerIds = new Set(
      home.rosterIds
        .map((id) => league.players[id]!)
        .filter((p) => p.position === Position.RB || p.position === Position.FB)
        .map((p) => p.id),
    );
    const homeRushYards = lines
      .filter((l) => homeRunnerIds.has(l.playerId))
      .reduce((s, l) => s + l.rushingYards, 0);
    expect(homeRushYards).toBe(someGame.result!.homeStats.rushingYards);
  });

  it('per-team receiving yards across pass-catchers sum to team passing yards', () => {
    // Week-0 roster — see the rushing reconcile above (trade-robustness).
    const base = createLeague({ seed: 'pgs-reconcile-recv' });
    const league = simulateSeason(base);
    const someGame = league.schedule!.regularSeason[0]![0]!;
    const lines = deriveGamePlayerStats(someGame, league);

    const home = base.teams[someGame.homeTeamId]!;
    const homeIds = new Set(home.rosterIds);
    const homeRecvYards = lines
      .filter((l) => homeIds.has(l.playerId))
      .reduce((s, l) => s + l.receivingYards, 0);
    expect(homeRecvYards).toBe(someGame.result!.homeStats.passingYards);
  });

  it('defensive sacks distributed across home D-line equal home team sacks', () => {
    // Week-0 roster — see the rushing reconcile above (trade-robustness).
    const base = createLeague({ seed: 'pgs-reconcile-sacks' });
    const league = simulateSeason(base);
    const someGame = league.schedule!.regularSeason[0]![0]!;
    const lines = deriveGamePlayerStats(someGame, league);

    const home = base.teams[someGame.homeTeamId]!;
    const homeIds = new Set(home.rosterIds);
    const homeSacks = lines
      .filter((l) => homeIds.has(l.playerId))
      .reduce((s, l) => s + l.sacks, 0);
    expect(homeSacks).toBe(someGame.result!.homeStats.sacks);
  });

  it('determinism — same seed produces identical per-game stat lines', () => {
    const a = simulateSeason(createLeague({ seed: 'pgs-det' }));
    const b = simulateSeason(createLeague({ seed: 'pgs-det' }));
    const ga = a.schedule!.regularSeason[5]![3]!;
    const gb = b.schedule!.regularSeason[5]![3]!;
    expect(deriveGamePlayerStats(ga, a)).toEqual(deriveGamePlayerStats(gb, b));
  });
});

describe('seasonStatsForLeague', () => {
  it('returns empty map when the league has no schedule', () => {
    const league = createLeague({ seed: 'season-empty' });
    expect(seasonStatsForLeague(league).size).toBe(0);
  });

  it('returns empty map after advanceSeason clears the schedule', () => {
    const played = simulateSeason(createLeague({ seed: 'season-cleared' }));
    const after = advanceSeason(played);
    expect(seasonStatsForLeague(after).size).toBe(0);
  });

  it('top QB on every team has non-zero passing output', () => {
    const league = simulateSeason(createLeague({ seed: 'season-qbs' }));
    const stats = seasonStatsForLeague(league);
    for (const team of Object.values(league.teams)) {
      const qbs = team.rosterIds
        .map((id) => league.players[id]!)
        .filter((p) => p.position === Position.QB)
        .sort((a, b) => tierVal(b.tier) - tierVal(a.tier));
      const topQb = qbs[0]!;
      const line = stats.get(topQb.id);
      expect(line).toBeDefined();
      expect(line!.passAttempts).toBeGreaterThan(0);
      expect(line!.passingYards).toBeGreaterThan(0);
    }
  });

  it('league-wide passing leader posts an NFL-realistic top-5 number', () => {
    const league = simulateSeason(createLeague({ seed: 'season-leader' }));
    const stats = seasonStatsForLeague(league);
    const passers = [...stats.values()]
      .filter((s) => s.passAttempts > 0)
      .sort((a, b) => b.passingYards - a.passingYards);
    const top = passers[0]!;
    // Real NFL passing leaders sit at ~4500-5500 yards in a 17-game
    // season. Allow a wide band for placeholder noise.
    expect(top.passingYards).toBeGreaterThan(2500);
    expect(top.passingYards).toBeLessThan(7000);
  });

  it('gamesPlayed for the top QB is in the realistic range', () => {
    const league = simulateSeason(createLeague({ seed: 'season-gp' }));
    const stats = seasonStatsForLeague(league);
    const qbs = [...stats.values()]
      .filter((s) => s.passAttempts > 0)
      .sort((a, b) => b.passAttempts - a.passAttempts);
    // Top QB plays the regular season + maybe playoffs. Expect 17-22.
    expect(qbs[0]!.gamesPlayed).toBeGreaterThanOrEqual(17);
    expect(qbs[0]!.gamesPlayed).toBeLessThanOrEqual(22);
  });

  it('league-wide passing yards equals league-wide receiving yards', () => {
    const league = simulateSeason(createLeague({ seed: 'season-recv-pass' }));
    const stats = seasonStatsForLeague(league);
    const totalPass = [...stats.values()].reduce((s, x) => s + x.passingYards, 0);
    const totalRecv = [...stats.values()].reduce((s, x) => s + x.receivingYards, 0);
    expect(totalPass).toBe(totalRecv);
  });

  it('determinism — same seed produces identical aggregate stats', () => {
    const a = seasonStatsForLeague(simulateSeason(createLeague({ seed: 'season-det' })));
    const b = seasonStatsForLeague(simulateSeason(createLeague({ seed: 'season-det' })));
    expect(a.size).toBe(b.size);
    for (const [id, sa] of a) {
      expect(b.get(id)).toEqual(sa);
    }
  });
});

describe('playerSeasonStats', () => {
  it('returns null for a player with no recorded output', () => {
    const league = simulateSeason(createLeague({ seed: 'pss-null' }));
    // A long snapper should have nothing — no stat surface tracks ST snaps.
    const ls = Object.values(league.players).find((p) => p.position === Position.LS)!;
    expect(playerSeasonStats(league, ls.id)).toBeNull();
  });

  it('returns a stat line for a player who recorded output', () => {
    const league = simulateSeason(createLeague({ seed: 'pss-line' }));
    const stats = seasonStatsForLeague(league);
    const someActiveId = [...stats.keys()][0]!;
    expect(playerSeasonStats(league, someActiveId)).not.toBeNull();
  });
});

function tierVal(t: string): number {
  switch (t) {
    case 'STAR':
      return 4;
    case 'STARTER':
      return 3;
    case 'BACKUP':
      return 2;
    default:
      return 1;
  }
}
