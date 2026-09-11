import { describe, expect, it } from 'vitest';

import { createLeague } from '../league/generate.js';
import { simulateSeason } from '../season/runner.js';
import { leagueView } from './league-view.js';

/**
 * The leak gate for `leagueView`, in the shape `snapshot.test.ts` established.
 *
 * `leagueView` is mostly public facts, so the risk here is not that it hides
 * too little — it is that a lazy projection passes a whole `TeamState` or a
 * whole `GameResult` through and drags ground truth along behind the parts
 * that were meant to be public. The recursive scan below is the real net.
 */
const FORBIDDEN_KEYS = [
  // Engine-internal sim knob, not a fact about the football world.
  'variance',
  // Ground-truth player model.
  'current',
  'ceiling',
  'talentScore',
  'talentGrade',
  'tier',
  'developmentArchetype',
  'moodProfile',
  'conditioning',
  // Ground-truth team model.
  'rosterIds',
  'scheme',
  'teamPersonality',
  'chemistry',
];

function allKeysDeep(value: unknown, found: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) allKeysDeep(v, found);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      found.add(k);
      allKeysDeep(v, found);
    }
  }
}

describe('knowledge/leagueView (public world facts, nothing riding along)', () => {
  const league = simulateSeason(createLeague({ seed: 'knowledge-league-view' }));
  const view = leagueView(league);

  it('projects all 32 teams across 8 divisions', () => {
    expect(view.standings).toHaveLength(8);
    const teamIds = new Set(view.standings.flatMap((d) => d.teams.map((t) => t.teamId)));
    expect(teamIds.size).toBe(32);
  });

  it('carries the season position and a played schedule', () => {
    expect(view.seasonNumber).toBe(league.seasonNumber);
    expect(view.weeks.length).toBeGreaterThan(0);
    const played = view.weeks.flat().filter((g) => g.result !== null);
    expect(played.length).toBeGreaterThan(0);
  });

  it('leaks no ground-truth or engine-internal fields — recursively', () => {
    const keys = new Set<string>();
    allKeysDeep(view, keys);
    for (const k of FORBIDDEN_KEYS) {
      expect(keys.has(k), `leagueView leaked forbidden key "${k}"`).toBe(false);
    }
  });

  it('strips GameResult.variance even though the source game carries it', () => {
    // Prove the source really does have the field, so the assertion above is
    // testing a strip and not an absence that was never there.
    const sourceWithVariance = league
      .schedule!.regularSeason.flat()
      .find((g) => g.result !== null);
    expect(sourceWithVariance?.result?.variance).toBeDefined();

    const projected = view.weeks.flat().find((g) => g.gameId === sourceWithVariance!.id);
    expect(projected?.result).not.toBeNull();
    expect(projected!.result as unknown as Record<string, unknown>).not.toHaveProperty('variance');
  });

  it('reports scores that match the underlying schedule exactly', () => {
    // Public facts pass through verbatim — the boundary must not distort them.
    const source = league.schedule!.regularSeason.flat().filter((g) => g.result !== null);
    const byId = new Map(view.weeks.flat().map((g) => [String(g.gameId), g]));
    for (const g of source.slice(0, 25)) {
      const v = byId.get(String(g.id));
      expect(v?.result?.homeScore).toBe(g.result!.homeScore);
      expect(v?.result?.awayScore).toBe(g.result!.awayScore);
    }
  });

  it('records sum to a consistent league-wide win/loss total', () => {
    const all = view.standings.flatMap((d) => d.teams);
    const wins = all.reduce((s, t) => s + t.wins, 0);
    const losses = all.reduce((s, t) => s + t.losses, 0);
    // Every game produces exactly one win and one loss (or two ties).
    expect(wins).toBe(losses);
  });
});
