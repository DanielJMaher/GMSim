import { describe, expect, it } from 'vitest';
import { createLeague } from '../league/generate.js';
import { skillAdjustedShares } from './stats.js';
import { roleStickinessBonus, computeTeamDepthChart, depthScore } from '../players/index.js';
import type { Player } from '../types/player.js';

/** Clone a player with every archetype-relevant skill scaled to ~target. */
function atSkill(base: Player, target: number): Player {
  const current = { ...base.current };
  for (const k of Object.keys(current) as (keyof Player['current'])[]) {
    current[k] = Math.max(1, Math.min(99, Math.round(target)));
  }
  return { ...base, current };
}

describe('skillAdjustedShares — continuous production coupling (S4)', () => {
  it('equal ratings reproduce the ladder exactly', () => {
    const league = createLeague({ seed: 'shares-eq' });
    const rb = Object.values(league.players).find((p) => p.position === 'RB')!;
    const trio = [atSkill(rb, 80), atSkill(rb, 80), atSkill(rb, 80)];
    const shares = skillAdjustedShares(trio, [0.62, 0.25, 0.13]);
    expect(shares[0]).toBeCloseTo(0.62, 5);
    expect(shares[1]).toBeCloseTo(0.25, 5);
    expect(shares[2]).toBeCloseTo(0.13, 5);
  });

  it('a declining RB1 loses share continuously while still ranked first', () => {
    const league = createLeague({ seed: 'shares-decline' });
    const rb = Object.values(league.players).find((p) => p.position === 'RB')!;
    const ladder = [0.7, 0.3];
    const healthy = skillAdjustedShares([atSkill(rb, 85), atSkill(rb, 78)], ladder);
    const faded = skillAdjustedShares([atSkill(rb, 74), atSkill(rb, 78)], ladder);
    expect(faded[0]!).toBeLessThan(healthy[0]!);
    expect(faded[0]! + faded[1]!).toBeCloseTo(1.0, 5); // team totals preserved
  });
});

describe('roleStickinessBonus — vets hold jobs until clearly passed (S4)', () => {
  it('caps at +4 and scales with experience', () => {
    const league = createLeague({ seed: 'sticky-cap' });
    const p = Object.values(league.players)[0]!;
    expect(roleStickinessBonus({ ...p, experienceYears: 0 })).toBe(0);
    expect(roleStickinessBonus({ ...p, experienceYears: 2 })).toBeCloseTo(1.6, 5);
    expect(roleStickinessBonus({ ...p, experienceYears: 10 })).toBe(4);
  });

  it('depth chart keeps the incumbent over a marginally better youngster, not a clearly better one', () => {
    const league = createLeague({ seed: 'sticky-chart' });
    // Find a team with 2+ RBs and synthesize the matchup on the chart's input.
    const team = Object.values(league.teams).find(
      (t) => t.rosterIds.filter((id) => league.players[id]?.position === 'RB').length >= 2,
    )!;
    const rbIds = team.rosterIds.filter((id) => league.players[id]?.position === 'RB');
    const vetBase = league.players[rbIds[0]!]!;
    const kidBase = league.players[rbIds[1]!]!;
    const vet = { ...atSkill(vetBase, 78), experienceYears: 8 };
    const marginalKid = { ...atSkill(kidBase, 80), experienceYears: 0 };
    const clearlyBetterKid = { ...atSkill(kidBase, 86), experienceYears: 0 };

    const withMarginal = {
      ...league,
      players: { ...league.players, [vet.id]: vet, [marginalKid.id]: marginalKid },
    };
    const chart1 = computeTeamDepthChart(withMarginal, team.identity.id)!;
    expect(chart1.slots.RB.playerIds[0]).toBe(vet.id); // +4 incumbency holds the job

    const withClearlyBetter = {
      ...league,
      players: { ...league.players, [vet.id]: vet, [clearlyBetterKid.id]: clearlyBetterKid },
    };
    const chart2 = computeTeamDepthChart(withClearlyBetter, team.identity.id)!;
    expect(chart2.slots.RB.playerIds[0]).toBe(clearlyBetterKid.id); // clearly passed
    expect(depthScore(vet)).toBeLessThan(depthScore(clearlyBetterKid)); // sanity
  });
});
