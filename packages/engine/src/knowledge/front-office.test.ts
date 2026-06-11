import { describe, expect, it } from 'vitest';

import { createLeague } from '../league/generate.js';
import { Prng } from '../prng/index.js';
import { generateHotSeatReports } from '../media/hot-seat.js';
import { hotSeatKnowledge } from './front-office.js';
import type { LeagueState } from '../types/league.js';
import type { TeamState } from '../types/team.js';
import type { HotSeatReport } from '../types/media.js';

/**
 * The knowledge boundary's contract for the front-office surface: no
 * seat-pressure numbers cross — neither the engine's real value nor the
 * outlet's numeric read. The game sees attribution + heat bands only.
 */
const FORBIDDEN_KEYS = ['perceivedSeat', 'seatPressure', 'realPreview', 'realSeat'];

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

/** A league with two chairs heated enough to draw preseason coverage. */
function heatedLeague(seed: string, voiceSeed?: string): LeagueState {
  const league = createLeague(voiceSeed ? { seed, voiceSeed } : { seed });
  const teams = Object.values(league.teams);
  const hot = teams[0]!;
  const warm = teams[1]!;
  const heat = (team: TeamState, hc: number, gm: number): TeamState => ({
    ...team,
    frontOffice: { ...team.frontOffice, seatPressure: { hc, gm } },
  });
  return {
    ...league,
    teams: {
      ...league.teams,
      [hot.identity.id]: heat(hot, 80, 55),
      [warm.identity.id]: heat(warm, 50, 40),
    },
  };
}

describe('hot-seat media + knowledge surface (S3)', () => {
  const league = heatedLeague('hot-seat-knowledge');
  const reports = generateHotSeatReports(new Prng('hs-world'), league, null, 0, 'PRESEASON');
  const withReports: LeagueState = {
    ...league,
    mediaReports: [...league.mediaReports, ...reports],
  };

  it('emits attributed hot-seat reports for heated chairs', () => {
    expect(reports.length).toBeGreaterThan(0);
    for (const r of reports) {
      expect(r.kind).toBe('hot-seat');
      const hs = r as HotSeatReport;
      expect(['warm', 'hot', 'inferno']).toContain(hs.heat);
      expect(hs.subjectName.length).toBeGreaterThan(0);
      expect(hs.perceivedSeat).toBeGreaterThanOrEqual(45);
    }
  });

  it('the knowledge surface carries no seat-pressure numbers (leak gate)', () => {
    const items = hotSeatKnowledge(withReports);
    expect(items.length).toBe(reports.length);
    const keys = new Set<string>();
    allKeysDeep(items, keys);
    for (const forbidden of FORBIDDEN_KEYS) {
      expect(keys.has(forbidden)).toBe(false);
    }
    for (const item of items) {
      expect(item.outletName.length).toBeGreaterThan(0);
      expect(['warm', 'hot', 'inferno']).toContain(item.heat);
    }
  });

  it('filters by team and limits', () => {
    const first = hotSeatKnowledge(withReports)[0]!;
    const scoped = hotSeatKnowledge(withReports, { teamId: first.teamId, limit: 1 });
    expect(scoped.length).toBe(1);
    expect(scoped[0]!.teamId).toBe(first.teamId);
  });

  it('Living Voice split: a different voiceSeed changes words, not facts', () => {
    const other = heatedLeague('hot-seat-knowledge', 'a-different-voice');
    const otherReports = generateHotSeatReports(
      new Prng('hs-world'),
      other,
      null,
      0,
      'PRESEASON',
    ) as readonly HotSeatReport[];
    const base = reports as readonly HotSeatReport[];

    // World facts identical: same subjects, same perceived reads.
    expect(otherReports.map((r) => `${r.subjectTeamId}:${r.chair}:${r.perceivedSeat}`)).toEqual(
      base.map((r) => `${r.subjectTeamId}:${r.chair}:${r.perceivedSeat}`),
    );
    // Voice differs: at least one headline reads differently.
    expect(otherReports.some((r, i) => r.headline !== base[i]!.headline)).toBe(true);
  });

  it('says nothing when nobody is in trouble (fresh league)', () => {
    const calm = createLeague({ seed: 'hot-seat-calm' });
    const calmReports = generateHotSeatReports(new Prng('hs-world'), calm, null, 0, 'PRESEASON');
    expect(calmReports.length).toBe(0);
  });
});
