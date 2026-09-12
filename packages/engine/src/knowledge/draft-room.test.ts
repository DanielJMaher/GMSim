import { describe, expect, it } from 'vitest';

import { createLeague } from '../league/generate.js';
import { Prng } from '../prng/index.js';
import { rollJuniorDeclarations } from '../draft/declaration.js';
import { asGameLeague } from './game-session.js';
import {
  openDraftRoom,
  stepDraftRoom,
  makeDraftPick,
  autoDraftPick,
  draftRoomView,
  closeDraftRoom,
} from './draft-room.js';
import type { TeamId } from '../types/ids.js';

/**
 * The leak gate for the draft room.
 *
 * The headline risk is `prospectProfile.tier` — the prospect's REAL quality
 * band, sitting right on `DraftPickRecord`. Surfacing it would hand the player
 * a perfect draft grade the moment a name came off the board and retire the
 * read-to-learn loop the whole scouting design rests on. `boardPriorityAtPick`
 * (a raw board score) and `qbDesperateAtPick` (a rival's internal decision
 * model) are the other two.
 */
const FORBIDDEN_KEYS = [
  'tier',
  'boardPriorityAtPick',
  'qbDesperateAtPick',
  'boardReasonAtPick',
  'archetype',
  'assumedArchetype',
  'current',
  'ceiling',
  'talentScore',
  'talentGrade',
  'trueAccuracy',
  'perceivedGrade',
  'realGrade',
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

function makeHandle(seed: string) {
  const base = createLeague({ seed });
  return asGameLeague({
    ...base,
    collegePool: rollJuniorDeclarations(new Prng('d'), base.collegePool),
  });
}

describe('knowledge/draftRoom (the facade the boundary requires)', () => {
  const handle = makeHandle('knowledge-draft-room');
  const viewerTeamId = Object.keys((handle as never as { teams: object }).teams)[0] as TeamId;

  it('stops at the viewer’s slot instead of picking for them', () => {
    const room = openDraftRoom(handle, { viewerTeamId });
    let step = stepDraftRoom(room);
    let guard = 0;
    while (step.kind !== 'on-the-clock' && step.kind !== 'complete' && guard++ < 80) {
      step = stepDraftRoom(room);
    }
    expect(step.kind).toBe('on-the-clock');
  });

  it('shows the viewer a board with their own scouting read attached', () => {
    const room = openDraftRoom(handle, { viewerTeamId });
    const view = draftRoomView(room);
    expect(view.board.length).toBeGreaterThan(0);
    for (const row of view.board.slice(0, 10)) {
      expect(row.rank).toBeGreaterThan(0);
      expect(row.firstName.length).toBeGreaterThan(0);
      expect(row.available).toBe(true);
    }
    // At least some rows carry an attributed snapshot rather than nothing.
    expect(view.board.some((r) => r.snapshot !== null)).toBe(true);
  });

  it('marks a prospect unavailable once he is taken', () => {
    const room = openDraftRoom(handle, { viewerTeamId });
    let step = stepDraftRoom(room);
    let guard = 0;
    while (step.kind !== 'pick' && guard++ < 20) step = stepDraftRoom(room);
    if (step.kind !== 'pick') return;

    const view = draftRoomView(room);
    const row = view.board.find((r) => r.prospectId === step.pick.prospectId);
    if (row) expect(row.available).toBe(false);
  });

  it('accepts a supplied pick and records its board rank', () => {
    const room = openDraftRoom(handle, { viewerTeamId });
    let step = stepDraftRoom(room);
    let guard = 0;
    while (step.kind !== 'on-the-clock' && guard++ < 80) step = stepDraftRoom(room);
    expect(step.kind).toBe('on-the-clock');

    const available = draftRoomView(room).board.filter((r) => r.available);
    expect(available.length).toBeGreaterThan(0);
    const pick = makeDraftPick(room, available[0]!.prospectId);

    expect(pick.prospectId).toBe(available[0]!.prospectId);
    expect(pick.team.teamId).toBe(viewerTeamId);
    expect(draftRoomView(room).onTheClock).toBeNull();
  });

  it('can hand the pick back to the war room', () => {
    const room = openDraftRoom(handle, { viewerTeamId });
    let step = stepDraftRoom(room);
    let guard = 0;
    while (step.kind !== 'on-the-clock' && guard++ < 80) step = stepDraftRoom(room);
    const pick = autoDraftPick(room);
    expect(pick).not.toBeNull();
    expect(pick!.team.teamId).toBe(viewerTeamId);
  });

  it('leaks no prospect ground truth — recursively, across a full round', () => {
    const room = openDraftRoom(handle, { viewerTeamId });
    let guard = 0;
    for (;;) {
      const step = stepDraftRoom(room);
      if (step.kind === 'complete') break;
      if (step.kind === 'on-the-clock') autoDraftPick(room);
      if (guard++ > 400) break;
    }

    const view = draftRoomView(room);
    expect(view.picks.length).toBeGreaterThan(0);

    const keys = new Set<string>();
    allKeysDeep(view, keys);
    for (const k of FORBIDDEN_KEYS) {
      expect(keys.has(k), `draftRoomView leaked forbidden key "${k}"`).toBe(false);
    }
  });

  it('closes back into a league handle the game can keep using', () => {
    const room = openDraftRoom(handle, { viewerTeamId });
    let guard = 0;
    for (;;) {
      const step = stepDraftRoom(room);
      if (step.kind === 'complete') break;
      if (step.kind === 'on-the-clock') autoDraftPick(room);
      if (guard++ > 400) break;
    }
    const next = closeDraftRoom(room);
    expect(next).toBeDefined();
    // The drafted rookies landed on real rosters.
    const asLeague = next as never as { players: Record<string, unknown> };
    expect(Object.keys(asLeague.players).length).toBeGreaterThan(0);
  });
});
