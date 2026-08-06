import { describe, it, expect } from 'vitest';
import { Prng } from '../prng/index.js';
import { createLeague } from '../league/index.js';
import {
  simulateGameDrives,
  simulateGameWithDrives,
  seasonForm,
  buildTeamPersonnel,
  type PlayerStatLine,
} from './drive-sim.js';
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

  // ── Season Form latent ε (v3 D1) ──
  it('season form ε is zero-mean (recentered), non-degenerate, and deterministic', () => {
    const league = createLeague({ seed: 'sf-test' });
    const form = seasonForm(league);
    const eps = [...form.values()];
    expect(eps.length).toBe(Object.keys(league.teams).length);
    // recentered to exactly zero league-mean (so the fumble expression is mean-neutral)
    const sum = eps.reduce((s, e) => s + e, 0);
    expect(Math.abs(sum)).toBeLessThan(1e-9);
    // non-degenerate spread
    expect(eps.some((e) => Math.abs(e) > 0.25)).toBe(true);
    // deterministic: a fresh identical league recomputes the identical ε
    const again = seasonForm(createLeague({ seed: 'sf-test' }));
    for (const [id, e] of form) expect(again.get(id)).toBe(e);
    // quality-orthogonal by construction: ε is a pure function of (seed, season,
    // team order), never of roster/record/strength — a different world seed gives
    // a different ε vector. (Roster-independence at fixed seed is structural: the
    // function body reads only league.seed/seasonNumber/team keys.)
    const other = [...seasonForm(createLeague({ seed: 'sf-test-2' })).values()];
    expect(eps.some((e, i) => e !== other[i])).toBe(true);
  });

  it('live path with season form is deterministic', () => {
    const league = createLeague({ seed: 'sf-det' });
    const ids = Object.keys(league.teams);
    const home = league.teams[ids[0]!]!;
    const away = league.teams[ids[1]!]!;
    const a = simulateGameWithDrives(new Prng('sfg'), home, away, league);
    const b = simulateGameWithDrives(new Prng('sfg'), home, away, league);
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
  it('default (bottomup) stores emergent lines; topdown opt-out does not', () => {
    const opts = (lg: ReturnType<typeof createLeague>) => {
      const ids = Object.keys(lg.teams);
      return {
        homeTeam: lg.teams[ids[0]!]!,
        awayTeam: lg.teams[ids[1]!]!,
        league: lg,
        weekNumber: 1,
        kind: 'REGULAR' as const,
      };
    };

    // Default league (no statEngine) is now bottom-up.
    const bottom = createLeague({ seed: 'flag-test' });
    const botGame = simulateGame(new Prng('g'), opts(bottom));
    expect(botGame.result?.playerStats).toBeDefined();
    expect(botGame.result!.playerStats!.length).toBeGreaterThan(0);
    // deriveGamePlayerStats returns the stored emergent lines verbatim.
    expect(deriveGamePlayerStats(botGame, bottom)).toBe(botGame.result!.playerStats);

    // Explicit topdown opt-out stores no playerStats and derives top-down.
    const legacy = createLeague({ seed: 'flag-test', statEngine: 'topdown' });
    const topGame = simulateGame(new Prng('g'), opts(legacy));
    expect(topGame.result?.playerStats).toBeUndefined();
    expect(deriveGamePlayerStats(topGame, legacy).length).toBeGreaterThan(0);
  });
});

describe('buildTeamPersonnel — emergency passer (Roster Viability §4.1)', () => {
  it('designates a non-null emergency passer when the roster has no QB', () => {
    const league = createLeague({ seed: 'no-qb-personnel' });
    const teamId = Object.keys(league.teams)[0]!;
    const team = league.teams[teamId as keyof typeof league.teams]!;
    const withQb = team.rosterIds.map((id) => league.players[id]!);
    const noQb = withQb.filter((p) => p.position !== 'QB');
    expect(noQb.some((p) => p.position === 'QB')).toBe(false); // sanity

    const pers = buildTeamPersonnel(noQb);
    // The regression this guards: before this fix, `qb` was `null` here,
    // and drive-sim.ts credited a receiver's TARGET on every dropback while
    // crediting NO passer an ATTEMPT — the exact box-score defect
    // stats-coherence.test.ts caught (att=0, tgt=33, one real game).
    expect(pers.qb).not.toBeNull();
    expect(pers.emergencyQbId).not.toBeNull();
    expect(pers.emergencyQbId).toBe(pers.qb);
    expect(pers.qb2).toBeNull(); // no second option in the emergency case

    const chosen = noQb.find((p) => p.id === pers.qb);
    expect(chosen).toBeDefined();
    expect(['WR', 'RB', 'TE']).toContain(chosen!.position);
    // He must not also appear in his own receiver pool (can't target himself).
    expect(pers.receivers.some((r) => r.id === pers.qb)).toBe(false);
  });

  it('leaves emergencyQbId null and behavior unchanged when a real QB is present', () => {
    const league = createLeague({ seed: 'has-qb-personnel' });
    const teamId = Object.keys(league.teams)[0]!;
    const players = league.teams[teamId as keyof typeof league.teams]!.rosterIds.map(
      (id) => league.players[id]!,
    );
    const pers = buildTeamPersonnel(players);
    expect(pers.emergencyQbId).toBeNull();
    const chosen = players.find((p) => p.id === pers.qb);
    expect(chosen?.position).toBe('QB');
  });
});
