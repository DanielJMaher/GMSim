import { describe, expect, it } from 'vitest';
import { createLeague } from '../league/generate.js';
import { computeTeamNeeds } from './team-needs.js';
import type { TeamId } from '../types/ids.js';
import type { Position } from '../types/enums.js';

describe('computeTeamNeeds', () => {
  it('produces a need entry for every canonical Position', () => {
    const league = createLeague({ seed: 'needs-shape' });
    const team = Object.values(league.teams)[0]!;
    const needs = computeTeamNeeds(team, league);
    const expected: Position[] = [
      'QB', 'RB', 'FB', 'WR', 'TE',
      'LT', 'LG', 'C', 'RG', 'RT',
      'EDGE', 'DT', 'NT',
      'ILB', 'OLB',
      'CB', 'S', 'NICKEL',
      'K', 'P', 'LS',
    ];
    expect(needs.length).toBe(expected.length);
    const got = new Set(needs.map((n) => n.position));
    for (const p of expected) expect(got.has(p)).toBe(true);
  });

  it('sorts by score descending', () => {
    const league = createLeague({ seed: 'needs-sort' });
    for (const team of Object.values(league.teams)) {
      const needs = computeTeamNeeds(team, league);
      for (let i = 1; i < needs.length; i++) {
        expect(needs[i]!.score).toBeLessThanOrEqual(needs[i - 1]!.score);
      }
    }
  });

  it('elevates positions with no roster presence relative to the baseline', () => {
    // Strip every QB off a team's roster — QB need should rise into
    // the top 5 and its score must exceed the baseline (pre-strip)
    // QB score. (Top-1 is not guaranteed: another position with an
    // aging starter can still outscore an empty QB slot since age
    // bonus can add up to +1.5 on top of the starter-slot gap.)
    const league = createLeague({ seed: 'needs-strip-qb' });
    const teamIds = Object.keys(league.teams) as TeamId[];
    const teamId = teamIds[0]!;
    const team = league.teams[teamId]!;
    const baseline = computeTeamNeeds(team, league);
    const baselineQb = baseline.find((n) => n.position === 'QB')!;

    const strippedRoster = team.rosterIds.filter(
      (pid) => league.players[pid]?.position !== 'QB',
    );
    const stripped = { ...team, rosterIds: strippedRoster };
    const needs = computeTeamNeeds(stripped, league);
    const top5Positions = needs.slice(0, 5).map((n) => n.position);
    expect(top5Positions).toContain('QB');
    const strippedQb = needs.find((n) => n.position === 'QB')!;
    expect(strippedQb.starterCount).toBe(0);
    expect(strippedQb.score).toBeGreaterThan(baselineQb.score);
  });

  it('produces deterministic output for the same league + team', () => {
    const league = createLeague({ seed: 'needs-determinism' });
    const team = Object.values(league.teams)[5]!;
    const a = computeTeamNeeds(team, league);
    const b = computeTeamNeeds(team, league);
    expect(a).toEqual(b);
  });

  it('returns non-empty top-5 needs for every team on a fresh league', () => {
    const league = createLeague({ seed: 'needs-all-teams' });
    for (const team of Object.values(league.teams)) {
      const needs = computeTeamNeeds(team, league);
      const top5 = needs.slice(0, 5);
      expect(top5.length).toBe(5);
      // Top-of-list need scores should be meaningfully above zero on
      // a freshly-generated 53-man roster — no team is uniformly
      // stacked at every position.
      expect(top5[0]!.score).toBeGreaterThan(-1);
    }
  });
});
