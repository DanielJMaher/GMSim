import { describe, expect, it } from 'vitest';

import { createLeague } from '../league/generate.js';
import { simulateSeason } from '../season/runner.js';
import { boxScoreView, findScheduledGame } from './box-score-view.js';
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

describe('knowledge/boxScoreView', () => {
  const league = simulateSeason(createLeague({ seed: 'knowledge-box-score' }));
  const playedGames = league.schedule!.regularSeason.flat().filter((g) => g.result !== null);
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
