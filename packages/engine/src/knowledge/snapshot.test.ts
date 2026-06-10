import { describe, expect, it } from 'vitest';

import { createLeague } from '../league/generate.js';
import { assembleProspectDossier } from '../draft/dossier.js';
import { confidenceLabel, prospectSnapshot, type ProspectSnapshot } from './snapshot.js';

/**
 * The knowledge boundary's contract: nothing ground-truth, numeric-rating, or
 * band-shaped crosses into `ProspectSnapshot`. These are the field names the
 * dossier uses for its dev-only lens — if a refactor renames them, extend the
 * list (the recursive scan below is the real net).
 */
const FORBIDDEN_KEYS = [
  'realGrade',
  'realValue',
  'realProjectedPosition',
  'perceivedGrade',
  'observedValue',
  'band',
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

describe('knowledge/prospectSnapshot (the North Star boundary)', () => {
  const league = createLeague({ seed: 'knowledge-snapshot' });
  const teamId = Object.keys(league.teams)[0]!;
  const viewer = { kind: 'team', teamId } as const;

  // A prospect the team has actually scouted, so the snapshot has remarks.
  const scoutedId = (() => {
    const scoutIds = new Set(
      (league.teams[teamId]!.collegeScoutIds as readonly string[]).map(String),
    );
    const counts = new Map<string, number>();
    for (const o of league.collegeObservations) {
      if (scoutIds.has(String(o.scoutId))) {
        counts.set(String(o.collegePlayerId), (counts.get(String(o.collegePlayerId)) ?? 0) + 1);
      }
    }
    let best: string | null = null;
    let bestN = 0;
    for (const [id, n] of counts) {
      if (n > bestN) {
        best = id;
        bestN = n;
      }
    }
    return best!;
  })();

  it('returns a populated snapshot for a scouted prospect', () => {
    const snap = prospectSnapshot(league, viewer, scoutedId as ProspectSnapshot['prospectId']);
    expect(snap).not.toBeNull();
    expect(snap!.observationCount).toBeGreaterThan(0);
    expect(snap!.writeup.length).toBeGreaterThan(0);
    expect(snap!.viewerLabel.length).toBeGreaterThan(0);
    // Every remark is attributed and qualitatively hedged.
    for (const r of [...snap!.strengths, ...snap!.concerns]) {
      expect(r.sourceId.length).toBeGreaterThan(0);
      expect(r.sourceName.length).toBeGreaterThan(0);
      expect(['tentative', 'moderate', 'firm']).toContain(r.confidence);
      expect(r.text.length).toBeGreaterThan(0);
      // The phrase never speaks a rating number or band range.
      expect(r.text).not.toMatch(/\d/);
    }
  });

  it('leaks no ground-truth, numeric-rating, or band fields — recursively', () => {
    const snap = prospectSnapshot(league, viewer, scoutedId as ProspectSnapshot['prospectId']);
    const keys = new Set<string>();
    allKeysDeep(snap, keys);
    for (const k of FORBIDDEN_KEYS) {
      expect(keys.has(k), `snapshot leaked forbidden key "${k}"`).toBe(false);
    }
  });

  it('carries the same attribution the dossier holds (same assembly, projected)', () => {
    const d = assembleProspectDossier(league, viewer, scoutedId as ProspectSnapshot['prospectId']);
    const snap = prospectSnapshot(league, viewer, scoutedId as ProspectSnapshot['prospectId']);
    expect(snap!.strengths.map((r) => r.sourceId)).toEqual(d!.pros.map((p) => p.sourceId));
    expect(snap!.concerns.map((r) => r.sourceId)).toEqual(d!.cons.map((p) => p.sourceId));
    expect(snap!.writeup).toBe(d!.writeup);
    expect(snap!.projectedPosition).toBe(d!.projectedPosition);
  });

  it('returns the public-record card for an unscouted prospect', () => {
    // A prospect with zero reads from this team's scouts.
    const scoutIds = new Set(
      (league.teams[teamId]!.collegeScoutIds as readonly string[]).map(String),
    );
    const seen = new Set<string>();
    for (const o of league.collegeObservations) {
      if (scoutIds.has(String(o.scoutId))) seen.add(String(o.collegePlayerId));
    }
    const unscouted = league.collegePool.find((cp) => !seen.has(String(cp.id)));
    if (!unscouted) return; // fully-scouted seed — nothing to assert
    const snap = prospectSnapshot(league, viewer, unscouted.id);
    expect(snap).not.toBeNull();
    expect(snap!.strengths).toHaveLength(0);
    expect(snap!.concerns).toHaveLength(0);
    expect(snap!.writeup).toContain('no report on file');
  });

  it('returns null for a nonexistent prospect or viewer', () => {
    expect(
      prospectSnapshot(league, viewer, 'no-such-prospect' as ProspectSnapshot['prospectId']),
    ).toBeNull();
    expect(
      prospectSnapshot(
        league,
        { kind: 'outlet', outletId: 'no-such-outlet' as never },
        scoutedId as ProspectSnapshot['prospectId'],
      ),
    ).toBeNull();
  });

  it('maps numeric confidence to qualitative labels at the documented edges', () => {
    expect(confidenceLabel(0.2)).toBe('tentative');
    expect(confidenceLabel(0.5)).toBe('moderate');
    expect(confidenceLabel(0.9)).toBe('firm');
  });
});
