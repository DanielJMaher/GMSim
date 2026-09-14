import { describe, expect, it } from 'vitest';

import { createLeague } from '../league/generate.js';
import { simulateSeason } from '../season/runner.js';
import { boxScoreView, driveLogView, findScheduledGame } from './box-score-view.js';
import type { GameId } from '../types/ids.js';

/**
 * The leak gate for the box score.
 *
 * A box score is public by nature, so the risk is not the stats — it is the
 * JOIN. Turning a `playerId` into a readable line means touching `Player`, and
 * a careless spread there ships `current`, `ceiling` and `talentScore` straight
 * into a React prop.
 */
const FORBIDDEN_KEYS = [
  'current',
  'ceiling',
  'skills',
  'talentScore',
  'talentGrade',
  'tier',
  'developmentArchetype',
  'archetype',
  'moodProfile',
  'mood',
  'conditioning',
  'abilities',
  'contractId',
  'birthDate',
  // Engine-internal sim knob, stripped in league-view for the same reason.
  'variance',
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

// Hoisted so both describes share ONE simulated season — the box score and the
// drive chart are two views of the same games, and simulating twice would
// double a ~20s cost for no added coverage.
const league = simulateSeason(createLeague({ seed: 'knowledge-box-score' }));
const playedGames = league.schedule!.regularSeason.flat().filter((g) => g.result !== null);

describe('knowledge/boxScoreView', () => {
  const sample = playedGames[Math.floor(playedGames.length / 2)]!;
  const view = boxScoreView(league, sample.id);

  it('projects a played game', () => {
    expect(view).not.toBeNull();
    expect(view!.homeScore).toBe(sample.result!.homeScore);
    expect(view!.awayScore).toBe(sample.result!.awayScore);
    expect(view!.home.abbreviation.length).toBeGreaterThan(0);
    expect(view!.away.abbreviation.length).toBeGreaterThan(0);
  });

  it('produces player lines for both clubs', () => {
    expect(view!.homeLines.length).toBeGreaterThan(0);
    expect(view!.awayLines.length).toBeGreaterThan(0);
    for (const l of [...view!.homeLines, ...view!.awayLines]) {
      expect(l.firstName.length).toBeGreaterThan(0);
      expect(l.position.length).toBeGreaterThan(0);
    }
  });

  it('omits stat groups a player did not record', () => {
    // The point of optional groups: a defensive back should not carry an empty
    // passing row, and the agate column should not be a wall of zeroes.
    const all = [...view!.homeLines, ...view!.awayLines];
    const someoneWithoutPassing = all.find((l) => l.passing === undefined);
    expect(someoneWithoutPassing).toBeDefined();
    for (const l of all) {
      if (l.passing) expect(l.passing.attempts + l.passing.yards).not.toBe(0);
    }
  });

  it('separates the two clubs correctly', () => {
    for (const l of view!.homeLines) expect(l.teamId).toBe(sample.homeTeamId);
    for (const l of view!.awayLines) expect(l.teamId).toBe(sample.awayTeamId);
  });

  it('leaks no ground-truth player fields — recursively', () => {
    const keys = new Set<string>();
    allKeysDeep(view, keys);
    for (const k of FORBIDDEN_KEYS) {
      expect(keys.has(k), `boxScoreView leaked forbidden key "${k}"`).toBe(false);
    }
  });

  it('returns null for an unplayed or unknown game', () => {
    expect(boxScoreView(league, 'no-such-game' as GameId)).toBeNull();
  });

  it('finds playoff games too, not just the regular season', () => {
    const sb = league.schedule?.playoffs?.superBowl[0];
    if (!sb) return;
    expect(findScheduledGame(league, sb.id)).not.toBeNull();
    if (sb.result) expect(boxScoreView(league, sb.id)).not.toBeNull();
  });
});

describe('knowledge/driveLogView (persisted, not replayed)', () => {
  const played = league;
  const sample2 = playedGames[3]!;

  it('returns the game’s actual drives', () => {
    const chart = driveLogView(played, sample2.id);
    expect(chart).not.toBeNull();
    expect(chart!.gameId).toBe(sample2.id);
    expect(chart!.drives.length).toBeGreaterThan(0);
    for (const d of chart!.drives) {
      expect(['home', 'away']).toContain(d.offense);
      expect(d.start).toBeGreaterThanOrEqual(0);
      expect(d.start).toBeLessThanOrEqual(100);
      expect(d.plays).toBeGreaterThanOrEqual(0);
    }
  });

  /**
   * The property the persistence exists to provide, and the one the replay
   * could not: EVERY played game has a chart, not 0.7% of them.
   */
  it('covers every played game, not a lucky handful', () => {
    const withChart = playedGames.filter((g) => driveLogView(played, g.id) !== null);
    expect(withChart.length).toBe(playedGames.length);
  });

  it('agrees with the box score it sits under', () => {
    // A chart that contradicted the score above it was the exact failure the
    // replay approach risked. Scoring drives must account for the points.
    for (const g of playedGames.slice(0, 20)) {
      const chart = driveLogView(played, g.id)!;
      const scoring = chart.drives.filter((d) => d.result === 'TD' || d.result === 'FG');
      const anyPoints = g.result!.homeScore + g.result!.awayScore > 0;
      if (anyPoints) expect(scoring.length).toBeGreaterThan(0);
    }
  });

  it('returns null for a game with no log rather than an empty chart', () => {
    expect(driveLogView(played, 'no-such-game' as GameId)).toBeNull();
  });

  /**
   * The cost, MEASURED rather than estimated. I told Daniel "~240KB/season"
   * before building it; this prints the real figure so the claim is checkable
   * and a future size regression is visible.
   */
  it('INSTRUMENT: prints the serialized cost of the drive logs', () => {
    const all = played.schedule!.regularSeason.flat().filter((g) => g.result?.driveLog);
    const bytes = all.reduce(
      (sum, g) => sum + JSON.stringify(g.result!.driveLog).length,
      0,
    );
    // eslint-disable-next-line no-console
    console.log(
      `[drive-log cost] ${all.length} games, ${Math.round(bytes / 1024)} KB serialized ` +
        `(${Math.round(bytes / all.length)} bytes/game)`,
    );
    // Not a tight bar — a guard against an order-of-magnitude regression.
    expect(bytes).toBeLessThan(2_000_000);
  });
});
