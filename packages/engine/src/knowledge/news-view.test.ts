import { describe, expect, it } from 'vitest';

import { createLeague } from '../league/generate.js';
import { simulateSeason } from '../season/runner.js';
import {
  newsView,
  isPubliclyReportable,
  KNOWN_UNSAFE_TRANSACTION_KINDS,
} from './news-view.js';
import type { TeamId } from '../types/ids.js';

/**
 * The leak gate for `newsView`.
 *
 * The specific risk here is not a rating — it is **outlet reliability**.
 * `accuracySpectrum` and `hypeSpectrum` are the engine's ground truth about
 * who is worth believing, and the North Star says the player earns that read by
 * watching. A number on a byline replaces the whole loop.
 *
 * The second risk is engine diagnostics reaching a player-facing feed, which is
 * why the transaction filter is an allow-list. That property is gated directly
 * below rather than left to review.
 */
const FORBIDDEN_KEYS = [
  // Outlet ground truth — the read-to-learn payload.
  'accuracySpectrum',
  'hypeSpectrum',
  // Player ground truth, in case a summary ever starts embedding records.
  'current',
  'ceiling',
  'talentScore',
  'talentGrade',
  'tier',
  'mood',
  'moodProfile',
];

/**
 * Transaction kinds that must never surface: internals and diagnostics.
 *
 * `locker-room-incident` is deliberately NOT here. It reaches the feed only
 * when `txn.mediaLeak` is true — the incident actually reached the press — and
 * renders prose with an anonymous-source byline, never a mood value. A leaked
 * incident is exactly what beat writers report.
 */
const MUST_NEVER_APPEAR = [
  'mood-shift',
  'roster-floor-violation',
  'contract-id-collision',
  'cap-compliance-unclearable',
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

describe('knowledge/newsView (the feed, without the outlet cheat sheet)', () => {
  const league = simulateSeason(createLeague({ seed: 'knowledge-news-view' }));
  const feed = newsView(league, { limit: 500 });

  it('produces a populated feed after a season', () => {
    expect(feed.length).toBeGreaterThan(0);
    expect(feed.some((i) => i.kind === 'media')).toBe(true);
    for (const item of feed) {
      expect(item.headline.length).toBeGreaterThan(0);
    }
  });

  it('leaks no outlet-reliability or player ground-truth fields — recursively', () => {
    const keys = new Set<string>();
    allKeysDeep(feed, keys);
    for (const k of FORBIDDEN_KEYS) {
      expect(keys.has(k), `newsView leaked forbidden key "${k}"`).toBe(false);
    }
  });

  it('carries the outlet byline while withholding its reliability', () => {
    const media = feed.filter((i) => i.kind === 'media' && i.source !== null);
    expect(media.length).toBeGreaterThan(0);
    // Prove the source outlet really does carry a spectrum, so the assertion
    // above is testing a strip rather than an absence that was never there.
    const anyOutlet = Object.values(league.mediaOutlets)[0]!;
    expect(anyOutlet.accuracySpectrum).toBeGreaterThan(0);

    for (const item of media) {
      expect(item.source!.name.length).toBeGreaterThan(0);
      expect(item.source!.outletTier.length).toBeGreaterThan(0);
      expect(item.source as unknown as Record<string, unknown>).not.toHaveProperty(
        'accuracySpectrum',
      );
      expect(item.source as unknown as Record<string, unknown>).not.toHaveProperty('hypeSpectrum');
    }
  });

  /**
   * The barrier, asserted DIRECTLY rather than through feed output.
   *
   * The first version of this test inspected the feed for banned kinds and
   * passed — but it passed for the wrong reason: `deriveNewsFeed` already drops
   * every one of them, so the assertion held whether or not this module's
   * allow-list existed. Verifying it by temporarily ADMITTING the banned kinds
   * changed nothing, which is what exposed the hole. A barrier that cannot be
   * observed failing is not a gate; test the predicate itself.
   */
  it('refuses every known-unsafe transaction kind', () => {
    expect(KNOWN_UNSAFE_TRANSACTION_KINDS.length).toBeGreaterThan(0);
    for (const kind of KNOWN_UNSAFE_TRANSACTION_KINDS) {
      expect(
        isPubliclyReportable(kind),
        `"${kind}" is publishable to a player-facing feed — it is engine ` +
          'internals or ground truth and must never be.',
      ).toBe(false);
    }
  });

  it('admits the ordinary public roster moves', () => {
    // The complement of the check above: a barrier that refuses everything
    // would also pass it.
    for (const kind of ['release', 'fa-sign', 'trade', 'franchise-tag'] as const) {
      expect(isPubliclyReportable(kind)).toBe(true);
    }
  });

  it('carries no banned kind in the rendered feed either', () => {
    const wireKinds = feed
      .filter((i) => i.kind === 'wire')
      .map((i) => i.id.split(':')[1] ?? '');
    for (const banned of MUST_NEVER_APPEAR) {
      expect(wireKinds, `wire feed included "${banned}"`).not.toContain(banned);
    }
  });

  it('filters to one club when asked', () => {
    const teamId = Object.keys(league.teams)[0] as TeamId;
    const mine = newsView(league, { teamId, limit: 500 });
    expect(mine.length).toBeGreaterThan(0);
    for (const item of mine) {
      expect(item.teamIds).toContain(teamId);
    }
    expect(mine.length).toBeLessThan(feed.length);
  });

  it('returns newest first and honours the limit', () => {
    const capped = newsView(league, { limit: 5 });
    expect(capped.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < capped.length; i++) {
      expect(capped[i - 1]!.tick).toBeGreaterThanOrEqual(capped[i]!.tick);
    }
  });

  it('honours sinceTick', () => {
    const all = newsView(league, { limit: 500 });
    const midTick = all[Math.floor(all.length / 2)]!.tick;
    const recent = newsView(league, { sinceTick: midTick, limit: 500 });
    for (const item of recent) {
      expect(item.tick).toBeGreaterThanOrEqual(midTick);
    }
  });
});
