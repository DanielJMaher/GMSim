import { describe, expect, it } from 'vitest';

import { createLeague } from '../league/generate.js';
import { keySkillAverage } from '../archetypes/key-skill.js';
import type { Player } from '../types/player.js';
import type { TeamId } from '../types/ids.js';
import { exposureOf, playerCard, rosterView, VETERAN_SERVICE_YEARS } from './roster-view.js';

/**
 * Ground-truth field names that must never reach the coach's card. Unlike
 * `leagueView`, this projection reads the player model directly, so the leak
 * risk is real rather than theoretical — a careless spread of `player` would
 * ship `current`, `ceiling`, and `talentScore` straight to a React prop.
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
  // The engine's own band vocabulary: the band picks the words, it is never
  // spoken (the rule `snapshot.ts` already established).
  'band',
  'overall',
  'perceivedOverall',
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

const LETTERS = ['A+', 'A', 'B+', 'B', 'C+', 'C', 'D', 'F'];

describe('knowledge/rosterView (the D2b coach’s card)', () => {
  const league = createLeague({ seed: 'knowledge-roster-view' });
  const teamIds = Object.keys(league.teams) as TeamId[];
  const ownTeamId = teamIds[0]!;
  const rivalTeamId = teamIds[1]!;

  it('projects the viewer’s own roster', () => {
    const view = rosterView(league, ownTeamId, ownTeamId);
    expect(view).not.toBeNull();
    expect(view!.isOwnRoster).toBe(true);
    expect(view!.players.length).toBeGreaterThan(40);
    for (const p of view!.players) {
      expect(LETTERS).toContain(p.grade);
      expect(['tentative', 'moderate', 'firm']).toContain(p.confidence);
      expect(p.sourceLabel).toBe('Coaching staff');
    }
  });

  it('projects a rival roster with a different byline', () => {
    const view = rosterView(league, ownTeamId, rivalTeamId);
    expect(view!.isOwnRoster).toBe(false);
    for (const p of view!.players) {
      expect(p.sourceLabel).toBe('Pro personnel department');
    }
  });

  it('returns null for a team that does not exist', () => {
    expect(rosterView(league, ownTeamId, 'no-such-team' as TeamId)).toBeNull();
  });

  it('leaks no ground-truth or numeric-rating fields — recursively', () => {
    const view = rosterView(league, ownTeamId, ownTeamId);
    const keys = new Set<string>();
    allKeysDeep(view, keys);
    for (const k of FORBIDDEN_KEYS) {
      expect(keys.has(k), `rosterView leaked forbidden key "${k}"`).toBe(false);
    }
  });

  it('speaks no rating numbers in its prose', () => {
    const view = rosterView(league, ownTeamId, ownTeamId);
    for (const p of view!.players) {
      for (const phrase of [...p.strengths, ...p.concerns]) {
        expect(phrase, `"${phrase}" contains a digit`).not.toMatch(/\d/);
      }
    }
  });

  /**
   * THE headline invariant of this file — Daniel's governing principle for
   * D2b, stated as a strict ordering:
   *
   *   your own veterans > your own young players
   *                     > other teams' veterans > other teams' young players
   *
   * Built from one real player so the only thing varying is roster membership
   * and service time.
   */
  it('orders exposure by D2b’s four tiers, strictly', () => {
    const base = Object.values(league.players).find((p) => p.teamId === ownTeamId)!;

    const withService = (teamId: TeamId | null, years: number): Player => ({
      ...base,
      teamId,
      experienceYears: years,
    });

    const ownVeteran = exposureOf(league, ownTeamId, withService(ownTeamId, 10));
    const ownYoung = exposureOf(league, ownTeamId, withService(ownTeamId, 0));
    const otherVeteran = exposureOf(league, ownTeamId, withService(rivalTeamId, 10));
    const otherYoung = exposureOf(league, ownTeamId, withService(rivalTeamId, 0));

    expect(ownVeteran).toBeGreaterThan(ownYoung);
    expect(ownYoung).toBeGreaterThan(otherVeteran);
    expect(otherVeteran).toBeGreaterThan(otherYoung);

    // And the scale stays inside its documented bounds.
    expect(ownVeteran).toBeLessThanOrEqual(1);
    expect(otherYoung).toBeGreaterThanOrEqual(0);
  });

  it('labels the exposure tier consistently with the service-year cut', () => {
    const view = rosterView(league, ownTeamId, ownTeamId);
    for (const p of view!.players) {
      const expected = p.experienceYears >= VETERAN_SERVICE_YEARS ? 'own-veteran' : 'own-young';
      expect(p.exposureTier).toBe(expected);
    }
    const rival = rosterView(league, ownTeamId, rivalTeamId);
    for (const p of rival!.players) {
      expect(p.exposureTier.startsWith('other-')).toBe(true);
    }
  });

  /**
   * D2b calls for "a STABLE qualitative card". If the perception error were
   * redrawn per call the card would flicker on every React render, so this
   * gates the determinism of the seeded-Prng approach.
   */
  it('returns a byte-identical card across repeated calls', () => {
    const a = rosterView(league, ownTeamId, rivalTeamId);
    const b = rosterView(league, ownTeamId, rivalTeamId);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  /**
   * Two clubs must hold genuinely different reads on the same rival player —
   * the information asymmetry the North Star is built around. If every club
   * perceived identically, the scouting layer would be decorative.
   */
  it('gives two different clubs different reads on the same players', () => {
    const third = teamIds[2]!;
    const fromOne = rosterView(league, ownTeamId, rivalTeamId)!.players;
    const fromTwo = rosterView(league, third, rivalTeamId)!.players;

    const differing = fromOne.filter((p, i) => p.grade !== fromTwo[i]!.grade).length;
    expect(differing).toBeGreaterThan(0);
  });

  /**
   * The calibration claim the whole exposure model rests on: a club reads its
   * own long-tenured veterans more accurately than rivals' unknowns. Measured
   * as mean absolute band error against ground truth across the population —
   * an inspector-style perceived-vs-real check, run in a test rather than
   * shown in a game UI.
   */
  it('reads its own veterans more accurately than rivals’ young players', () => {
    const letterIndex = (l: string): number => LETTERS.indexOf(l);
    const realLetterOf = (p: Player): number => {
      const overall = keySkillAverage(p.current, p.archetype);
      // Mirror gradeFromOverall's cuts.
      const cuts = [91, 85, 79, 73, 67, 61, 55];
      const idx = cuts.findIndex((c) => overall >= c);
      return idx === -1 ? 7 : idx;
    };

    const meanError = (viewer: TeamId, subject: TeamId, vet: boolean): number => {
      const players = (league.teams[subject]!.rosterIds as readonly string[])
        .map((id) => league.players[id]!)
        .filter((p) => (vet ? p.experienceYears >= 6 : p.experienceYears <= 1));
      if (players.length === 0) return NaN;
      const errors = players.map((p) =>
        Math.abs(letterIndex(playerCard(league, viewer, p).grade) - realLetterOf(p)),
      );
      return errors.reduce((s, e) => s + e, 0) / errors.length;
    };

    // Pool across several clubs so the comparison isn't one team's small-n noise.
    const ownVetErrors: number[] = [];
    const rivalYoungErrors: number[] = [];
    for (const t of teamIds.slice(0, 12)) {
      const own = meanError(t, t, true);
      if (!Number.isNaN(own)) ownVetErrors.push(own);
      const other = teamIds.find((x) => x !== t)!;
      const rival = meanError(t, other, false);
      if (!Number.isNaN(rival)) rivalYoungErrors.push(rival);
    }

    const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
    const ownVetError = mean(ownVetErrors);
    const rivalYoungError = mean(rivalYoungErrors);

    expect(ownVetError).toBeLessThan(rivalYoungError);
    // Own veterans should be essentially true-read: the only error left is the
    // letter banding itself, not perception noise.
    expect(ownVetError).toBeLessThan(0.5);
  });
});
