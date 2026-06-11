import { describe, expect, it } from 'vitest';

import { createLeague } from '../league/generate.js';
import { Position } from '../types/enums.js';
import type { TeamId } from '../types/ids.js';
import {
  BASE_STARTER_COUNTS,
  computeLeagueDepthCharts,
  computeTeamDepthChart,
  depthRank,
  depthScore,
  isProjectedStarter,
  roleStickinessBonus,
} from './depth-chart.js';

describe('depth chart (derived, slice 1)', () => {
  const league = createLeague({ seed: 'depth-chart' });
  const teamId = Object.keys(league.teams)[0]! as TeamId;
  const chart = computeTeamDepthChart(league, teamId)!;

  it('base lineup is 11 offense + 11 defense + 3 ST = 25 starters', () => {
    const total = Object.values(BASE_STARTER_COUNTS).reduce((s, n) => s + n, 0);
    expect(total).toBe(25);
    // The 53-man blueprint stocks every position, so a fresh roster fills
    // every starter slot.
    expect(chart.starterIds).toHaveLength(25);
  });

  it('every rostered player appears exactly once across the slots', () => {
    const seen = new Set<string>();
    for (const slot of Object.values(chart.slots)) {
      for (const id of slot.playerIds) {
        expect(seen.has(String(id))).toBe(false);
        seen.add(String(id));
      }
    }
    expect(seen.size).toBe(league.teams[teamId]!.rosterIds.length);
  });

  it('orders each position by the vet-adjusted composite, best first (S4 role stickiness)', () => {
    for (const slot of Object.values(chart.slots)) {
      for (let i = 1; i < slot.playerIds.length; i++) {
        const prev = league.players[slot.playerIds[i - 1]!]!;
        const cur = league.players[slot.playerIds[i]!]!;
        expect(depthScore(prev) + roleStickinessBonus(prev)).toBeGreaterThanOrEqual(
          depthScore(cur) + roleStickinessBonus(cur),
        );
      }
    }
  });

  it('the projected starter at a position is its top depth slot', () => {
    const qbSlot = chart.slots[Position.QB];
    expect(qbSlot.playerIds.length).toBeGreaterThan(0);
    const qb1 = qbSlot.playerIds[0]!;
    expect(isProjectedStarter(chart, qb1)).toBe(true);
    expect(depthRank(chart, qb1)).toBe(1);
    // The backup QB is NOT in the base lineup.
    if (qbSlot.playerIds.length > 1) {
      const qb2 = qbSlot.playerIds[1]!;
      expect(isProjectedStarter(chart, qb2)).toBe(false);
      expect(depthRank(chart, qb2)).toBe(2);
    }
  });

  it('a skill jump moves a backup up the chart (ranking responds to skills)', () => {
    const qbSlot = chart.slots[Position.QB];
    expect(qbSlot.playerIds.length).toBeGreaterThanOrEqual(2);
    const qb2Id = qbSlot.playerIds[1]!;
    const qb2 = league.players[qb2Id]!;
    const boosted = {
      ...league,
      players: {
        ...league.players,
        [qb2Id]: {
          ...qb2,
          current: Object.fromEntries(
            Object.entries(qb2.current).map(([k]) => [k, 99]),
          ) as typeof qb2.current,
        },
      },
    };
    const rechart = computeTeamDepthChart(boosted, teamId)!;
    expect(rechart.slots[Position.QB].playerIds[0]).toBe(qb2Id);
    expect(isProjectedStarter(rechart, qb2Id)).toBe(true);
  });

  it('is deterministic and covers all 32 teams', () => {
    const a = computeLeagueDepthCharts(league);
    const b = computeLeagueDepthCharts(league);
    expect(Object.keys(a)).toHaveLength(32);
    expect(a).toEqual(b);
    for (const c of Object.values(a)) expect(c.starterIds).toHaveLength(25);
  });

  it('returns null for an unknown team', () => {
    expect(computeTeamDepthChart(league, 'no-such-team' as TeamId)).toBeNull();
  });
});
