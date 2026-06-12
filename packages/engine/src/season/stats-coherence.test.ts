import { describe, it, expect, beforeAll } from 'vitest';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from './runner.js';
import { seasonStatsForLeague, seasonStatsForTeam } from './stats.js';
import { deriveGamePlayerStats } from '../games/stats.js';
import { Position } from '../types/enums.js';
import type { LeagueState } from '../types/league.js';
import type { ScheduledGame } from '../types/game.js';
import type { TeamId } from '../types/ids.js';

/**
 * Box-score coherence invariants (slice 1 of the Scorekeeper plan).
 *
 * The sim attributes passer AND receiver on the same play, so a team-game's
 * passing yards must equal its receiving yards — double-entry accounting.
 * Real NFL team-week data holds this in 7,837 of 7,838 rows (2011-2025).
 *
 * Stats also OUTLIVE roster membership: a QB who leaves in FA keeps his
 * yards attached to the team he threw them for (line.teamId, stamped at sim
 * time). The "650-yard QB room" defect was the inspector joining season
 * stats through current rosterIds — these tests lock the engine-side truth
 * that makes the correct join possible.
 */

let league: LeagueState;
let games: ScheduledGame[];

beforeAll(() => {
  league = simulateSeason(createLeague({ seed: 'stats-coherence' }));
  games = [
    ...league.schedule!.regularSeason.flat(),
    ...(league.schedule!.playoffs?.wildCard ?? []),
    ...(league.schedule!.playoffs?.divisional ?? []),
    ...(league.schedule!.playoffs?.conference ?? []),
    ...(league.schedule!.playoffs?.superBowl ?? []),
  ].filter((g) => g.result);
});

describe('per-game box-score coherence', () => {
  it('every stat line carries the teamId of one of the two teams in the game', () => {
    for (const game of games) {
      for (const line of deriveGamePlayerStats(game, league)) {
        expect(
          line.teamId === game.homeTeamId || line.teamId === game.awayTeamId,
          `line for ${line.playerId} in ${game.id} has teamId ${String(line.teamId)}`,
        ).toBe(true);
      }
    }
  });

  it('double-entry holds per team-game: passing == receiving, completions == receptions, attempts == targets', () => {
    for (const game of games) {
      const byTeam = new Map<string, { pass: number; recv: number; comp: number; rec: number; att: number; tgt: number }>();
      for (const line of deriveGamePlayerStats(game, league)) {
        const t = byTeam.get(line.teamId!) ?? { pass: 0, recv: 0, comp: 0, rec: 0, att: 0, tgt: 0 };
        t.pass += line.passingYards;
        t.recv += line.receivingYards;
        t.comp += line.passCompletions;
        t.rec += line.receptions;
        t.att += line.passAttempts;
        t.tgt += line.targets;
        byTeam.set(line.teamId!, t);
      }
      for (const [tid, t] of byTeam) {
        expect(t.pass, `${game.id} ${tid} passing vs receiving`).toBe(t.recv);
        expect(t.comp, `${game.id} ${tid} completions vs receptions`).toBe(t.rec);
        expect(t.att, `${game.id} ${tid} attempts vs targets`).toBe(t.tgt);
      }
    }
  });
});

describe('seasonStatsForTeam', () => {
  it('season-level double-entry holds for every team', () => {
    for (const tid of Object.keys(league.teams)) {
      const stats = seasonStatsForTeam(league, tid as TeamId);
      let pass = 0;
      let recv = 0;
      for (const s of stats.values()) {
        pass += s.passingYards;
        recv += s.receivingYards;
      }
      expect(pass, `team ${tid} season passing vs receiving`).toBe(recv);
      expect(pass).toBeGreaterThan(0);
    }
  });

  it('keeps a departed passer\'s yards with the team he threw them for (the 650-yard-QB-room regression)', () => {
    // Find a team and its leading passer.
    const someTeam = Object.values(league.teams)[0]!;
    const tid = someTeam.identity.id;
    const before = seasonStatsForTeam(league, tid);
    const leadPasser = [...before.values()].sort((a, b) => b.passingYards - a.passingYards)[0]!;
    expect(leadPasser.passingYards).toBeGreaterThan(1000);

    // Simulate his departure: drop him from the current roster (FA/cut/trade).
    const churned: LeagueState = {
      ...league,
      teams: {
        ...league.teams,
        [tid]: {
          ...someTeam,
          rosterIds: someTeam.rosterIds.filter((id) => id !== leadPasser.playerId),
        },
      },
    };

    // The accrual join keeps his yards with the team…
    const after = seasonStatsForTeam(churned, tid);
    expect(after.get(leadPasser.playerId)?.passingYards).toBe(leadPasser.passingYards);

    // …while the naive current-roster join (the old inspector behavior)
    // silently loses them — the defect this slice fixes.
    const naive = seasonStatsForLeague(churned);
    const currentRosterPass = churned.teams[tid]!.rosterIds.reduce(
      (sum, pid) => sum + (naive.get(pid)?.passingYards ?? 0),
      0,
    );
    expect(currentRosterPass).toBeLessThan(leadPasser.passingYards);
  });

  it('league-wide season totals still cover every line (no stats lost by the team filter)', () => {
    const leagueWide = seasonStatsForLeague(league);
    let teamSum = 0;
    for (const tid of Object.keys(league.teams)) {
      for (const s of seasonStatsForTeam(league, tid as TeamId).values()) {
        teamSum += s.passingYards;
      }
    }
    let leagueSum = 0;
    for (const s of leagueWide.values()) leagueSum += s.passingYards;
    expect(teamSum).toBe(leagueSum);
  });

  it('QB-room passing for a stable roster is the lion\'s share of team passing', () => {
    // Sanity: on rosters with no churn, the current QBs really did the throwing
    // (catches mis-stamped teamIds that would scatter passing across teams).
    let teamsChecked = 0;
    for (const team of Object.values(league.teams)) {
      const stats = seasonStatsForTeam(league, team.identity.id);
      const qbIds = new Set(
        team.rosterIds.filter((id) => league.players[id]?.position === Position.QB),
      );
      let qbPass = 0;
      let teamPass = 0;
      let rosteredAll = true;
      for (const [pid, s] of stats) {
        teamPass += s.passingYards;
        if (qbIds.has(pid)) qbPass += s.passingYards;
        if (s.passingYards > 0 && !team.rosterIds.includes(pid)) rosteredAll = false;
      }
      if (!rosteredAll || teamPass === 0) continue; // midseason churn — covered above
      teamsChecked++;
      expect(qbPass / teamPass, `team ${team.identity.id} QB share`).toBeGreaterThan(0.8);
    }
    expect(teamsChecked).toBeGreaterThan(20);
  });
});
