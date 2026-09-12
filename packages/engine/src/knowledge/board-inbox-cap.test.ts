import { describe, expect, it } from 'vitest';

import { createLeague } from '../league/generate.js';
import { simulateSeason } from '../season/runner.js';
import { asGameLeague } from './game-session.js';
import { departmentBoard, mediaBoard } from './board-view.js';
import { scoutingInbox } from './scouting-inbox.js';
import { capView } from './cap-view.js';
import type { TeamId } from '../types/ids.js';

/**
 * Shared leak gate for the three remaining W4 step-2 projections.
 *
 * They have different risks and one common one. The Board must not ship
 * `priority` / `observedSkillScore` / `schemeFit` (the last is computed FROM
 * the true archetype, so it is a channel out of ground truth however it looks).
 * The inbox must not ship an observation's raw `skills` map. The cap view is
 * allowed money — §8.3 rules your own book public — but not quality, because a
 * cap table is a list of players and a careless join puts `current` beside the
 * dollars.
 */
const FORBIDDEN_KEYS = [
  // Board internals.
  'priority',
  'observedSkillScore',
  'meanConfidence',
  // Raw observation payloads.
  'skills',
  // Scout ground truth — reliability is learned by watching (§6).
  'trueAccuracy',
  // Player ground truth, everywhere.
  'current',
  'ceiling',
  'talentScore',
  'talentGrade',
  'tier',
  'developmentArchetype',
  'moodProfile',
  'mood',
  'conditioning',
];

/**
 * Banned ONLY when the value is numeric.
 *
 * `schemeFit` is two different things under one name: a numeric multiplier on
 * `DraftBoardEntry` computed FROM the true archetype (a real channel out of
 * ground truth), and a one-line qualitative STRING on `ProspectSnapshot` that
 * snapshot.ts deliberately publishes and snapshot.test.ts already gates.
 *
 * Same collision class as `tier`/`outletTier` in news-view, but resolved the
 * other way: there, the offending field was mine and I renamed it to keep the
 * scan blunt. Here the string is pre-existing shipped API, so the SCANNER gets
 * smarter instead. Numeric-valued is the precise test, because the number is
 * what leaks.
 */
const FORBIDDEN_NUMERIC_KEYS = ['schemeFit'];

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

function numericKeysDeep(value: unknown, found: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) numericKeysDeep(v, found);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'number') found.add(k);
      numericKeysDeep(v, found);
    }
  }
}

function scan(label: string, value: unknown): void {
  const keys = new Set<string>();
  allKeysDeep(value, keys);
  for (const k of FORBIDDEN_KEYS) {
    expect(keys.has(k), `${label} leaked forbidden key "${k}"`).toBe(false);
  }
  const numeric = new Set<string>();
  numericKeysDeep(value, numeric);
  for (const k of FORBIDDEN_NUMERIC_KEYS) {
    expect(numeric.has(k), `${label} leaked forbidden NUMERIC key "${k}"`).toBe(false);
  }
}

// simulateSeason, not createLeague: media college observations are produced by
// the college season, so a fresh league has an EMPTY media consensus board.
const handle = asGameLeague(simulateSeason(createLeague({ seed: 'knowledge-board-inbox-cap' })));
const teamId = Object.keys((handle as never as { teams: object }).teams)[0] as TeamId;

describe('knowledge/departmentBoard + mediaBoard', () => {
  const board = departmentBoard(handle, teamId);
  const media = mediaBoard(handle);

  it('produces a ranked department board', () => {
    expect(board.length).toBeGreaterThan(0);
    board.forEach((row, i) => {
      expect(row.rank).toBe(i + 1);
      expect(row.firstName.length).toBeGreaterThan(0);
      expect(['tentative', 'moderate', 'firm']).toContain(row.confidence);
      expect(row.reason.length).toBeGreaterThan(0);
    });
  });

  it('produces a ranked media consensus', () => {
    expect(media.length).toBeGreaterThan(0);
    media.forEach((row, i) => {
      expect(row.rank).toBeGreaterThan(0);
      if (i > 0) expect(row.rank).toBeGreaterThanOrEqual(media[i - 1]!.rank);
    });
  });

  /**
   * The divergence gutter is the read-to-learn payoff (§3). If the department
   * board and the media consensus agreed on every name, there would be nothing
   * to learn by trusting your own scouts.
   */
  it('diverges from the media consensus on some names', () => {
    const ranked = board.filter((r) => r.mediaRank !== null);
    expect(ranked.length).toBeGreaterThan(0);
    const differing = ranked.filter((r) => r.mediaRank !== r.rank);
    expect(differing.length).toBeGreaterThan(0);
  });

  it('leaks no board internals', () => {
    scan('departmentBoard', board);
    scan('mediaBoard', media);
  });

  it('returns an empty board for an unknown club rather than throwing', () => {
    expect(departmentBoard(handle, 'no-such-team' as TeamId)).toEqual([]);
  });
});

describe('knowledge/scoutingInbox', () => {
  const inbox = scoutingInbox(handle, teamId);

  it('delivers attributed reports', () => {
    expect(inbox.length).toBeGreaterThan(0);
    for (const item of inbox.slice(0, 15)) {
      expect(item.reportCount).toBeGreaterThan(0);
      expect(item.snapshot).not.toBeNull();
      for (const byline of item.bylines) {
        expect(byline.name.length).toBeGreaterThan(0);
        expect(byline.knownSpecialty.length).toBeGreaterThan(0);
      }
    }
  });

  it('is newest first and honours the limit', () => {
    const capped = scoutingInbox(handle, teamId, { limit: 6 });
    expect(capped.length).toBeLessThanOrEqual(6);
    for (let i = 1; i < capped.length; i++) {
      expect(capped[i - 1]!.filedOnTick).toBeGreaterThanOrEqual(capped[i]!.filedOnTick);
    }
  });

  it('reads only this club’s own scouts', () => {
    const team = (handle as never as { teams: Record<string, { collegeScoutIds: string[] }> }).teams[
      teamId
    ]!;
    const ours = new Set(team.collegeScoutIds.map(String));
    for (const item of inbox) {
      for (const byline of item.bylines) {
        expect(ours.has(String(byline.scoutId))).toBe(true);
      }
    }
  });

  it('leaks no raw observations or scout accuracy', () => {
    scan('scoutingInbox', inbox);
  });

  it('returns empty for an unknown club', () => {
    expect(scoutingInbox(handle, 'no-such-team' as TeamId)).toEqual([]);
  });
});

describe('knowledge/capView', () => {
  const cap = capView(handle, teamId);

  it('reports the club’s book', () => {
    expect(cap).not.toBeNull();
    expect(cap!.capCeiling).toBeGreaterThan(0);
    expect(cap!.rows.length).toBeGreaterThan(0);
    // capSpace is the stated identity, not an independent number.
    expect(cap!.capSpace).toBe(cap!.capCeiling - cap!.capUsed);
  });

  it('sorts by cap hit, largest first', () => {
    for (let i = 1; i < cap!.rows.length; i++) {
      expect(cap!.rows[i - 1]!.capHit).toBeGreaterThanOrEqual(cap!.rows[i]!.capHit);
    }
  });

  /**
   * The number the cuts screen exists to show. `capFreedIfReleased` is allowed
   * to be negative — cutting a player whose bonus acceleration exceeds his cap
   * hit COSTS room, which is the exact defect class Roster Floor Fix A guards
   * the NPC AI against. The identity must hold either way.
   */
  it('states release economics honestly, including when a cut costs room', () => {
    for (const row of cap!.rows) {
      expect(row.capFreedIfReleased).toBe(row.capHit - row.deadMoneyIfReleased);
      expect(row.deadMoneyIfReleased).toBeGreaterThanOrEqual(0);
    }
  });

  it('leaks no player quality alongside the money', () => {
    scan('capView', cap);
  });

  it('returns null for an unknown club', () => {
    expect(capView(handle, 'no-such-team' as TeamId)).toBeNull();
  });
});
