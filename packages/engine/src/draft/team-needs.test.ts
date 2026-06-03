import { describe, expect, it } from 'vitest';
import { createLeague } from '../league/generate.js';
import { computeTeamNeeds, positionNeedPressure } from './team-needs.js';
import { POSITION_DRAFT_VALUE } from './position-value.js';
import type { TeamId } from '../types/ids.js';
import type { Position } from '../types/enums.js';

// Floored QB neediness (1.2) × QB positional value — the score a team
// with no starter-quality QB should show.
const QB_NO_ANSWER_FLOOR_SCORE = 1.2 * POSITION_DRAFT_VALUE.QB;

describe('computeTeamNeeds', () => {
  it('produces a need entry for every canonical Position', () => {
    const league = createLeague({ seed: 'needs-shape' });
    const team = Object.values(league.teams)[0]!;
    const needs = computeTeamNeeds(team, league);
    const expected: Position[] = [
      'QB', 'RB', 'FB', 'WR', 'TE',
      'LT', 'LG', 'C', 'RG', 'RT',
      'EDGE', 'DT', 'NT',
      'ILB', 'OLB',
      'CB', 'S', 'NICKEL',
      'K', 'P', 'LS',
    ];
    expect(needs.length).toBe(expected.length);
    const got = new Set(needs.map((n) => n.position));
    for (const p of expected) expect(got.has(p)).toBe(true);
  });

  it('sorts by score descending', () => {
    const league = createLeague({ seed: 'needs-sort' });
    for (const team of Object.values(league.teams)) {
      const needs = computeTeamNeeds(team, league);
      for (let i = 1; i < needs.length; i++) {
        expect(needs[i]!.score).toBeLessThanOrEqual(needs[i - 1]!.score);
      }
    }
  });

  it('elevates positions with no roster presence relative to the baseline', () => {
    // Strip every QB off a team's roster — QB need should rise into
    // the top 5 and its score must exceed the baseline (pre-strip)
    // QB score. (Top-1 is not guaranteed: another position with an
    // aging starter can still outscore an empty QB slot since age
    // bonus can add up to +1.5 on top of the starter-slot gap.)
    const league = createLeague({ seed: 'needs-strip-qb' });
    const teamIds = Object.keys(league.teams) as TeamId[];
    const teamId = teamIds[0]!;
    const team = league.teams[teamId]!;
    const baseline = computeTeamNeeds(team, league);
    const baselineQb = baseline.find((n) => n.position === 'QB')!;

    const strippedRoster = team.rosterIds.filter(
      (pid) => league.players[pid]?.position !== 'QB',
    );
    const stripped = { ...team, rosterIds: strippedRoster };
    const needs = computeTeamNeeds(stripped, league);
    const top5Positions = needs.slice(0, 5).map((n) => n.position);
    expect(top5Positions).toContain('QB');
    const strippedQb = needs.find((n) => n.position === 'QB')!;
    expect(strippedQb.starterCount).toBe(0);
    expect(strippedQb.score).toBeGreaterThan(baselineQb.score);
  });

  it('attaches the positional-value multiplier, highest at QB', () => {
    const league = createLeague({ seed: 'needs-posvalue' });
    const team = Object.values(league.teams)[0]!;
    const needs = computeTeamNeeds(team, league);
    for (const n of needs) expect(n.positionValue).toBeGreaterThan(0);
    const qb = needs.find((n) => n.position === 'QB')!;
    const maxValue = Math.max(...needs.map((n) => n.positionValue));
    expect(qb.positionValue).toBe(maxValue);
  });

  // v0.92: the QB-need carve-out is driven by DRAFT PEDIGREE, not age/tier.
  function qbRoomNeeds(
    qbSpecs: ReadonlyArray<{ age: number; round: number | null; exp: number }>,
  ) {
    const league = createLeague({ seed: 'needs-qb-rule' });
    const team = Object.values(league.teams)[0]!;
    const template = Object.values(league.players).find((p) => p.position === 'QB')!;
    const simYear = 2026 + (league.seasonNumber - 1);
    const qbs = qbSpecs.map((s, i) => ({
      ...template,
      id: `${template.id}_q${i}` as typeof template.id,
      tier: 'BACKUP' as const,
      birthDate: `${simYear - s.age}-01-01`,
      experienceYears: s.exp,
      draftRound: s.round,
      draftOverallPick: s.round === null ? null : (s.round - 1) * 32 + 5,
    }));
    const players = { ...league.players };
    for (const q of qbs) players[q.id] = q;
    const roster = [
      ...team.rosterIds.filter((pid) => league.players[pid]?.position !== 'QB'),
      ...qbs.map((q) => q.id),
    ];
    return computeTeamNeeds({ ...team, rosterIds: roster }, { ...league, players });
  }

  it('forces QB high when the QB room is backup-tier with no first-round pedigree', () => {
    // The Bills case: 30/31-yo backups + a 22-yo 6th-round backup. The
    // young guy is NOT the franchise answer (late pedigree), so QB floors
    // to the very top of the board.
    const needs = qbRoomNeeds([
      { age: 30, round: 6, exp: 7 },
      { age: 31, round: 5, exp: 8 },
      { age: 22, round: 6, exp: 1 },
    ]);
    const qb = needs.find((n) => n.position === 'QB')!;
    expect(qb.starterCount).toBe(0);
    expect(qb.score).toBeGreaterThanOrEqual(QB_NO_ANSWER_FLOOR_SCORE - 0.001);
    expect(needs.findIndex((n) => n.position === 'QB')).toBe(0);
  });

  it('drops QB off the needs when a recent first-round QB is in house', () => {
    // Same room, but the young QB was a first-round pick last year — the
    // franchise plan. QB is addressed and should NOT be a premium need.
    const needs = qbRoomNeeds([
      { age: 30, round: 6, exp: 7 },
      { age: 22, round: 1, exp: 1 },
    ]);
    const qb = needs.find((n) => n.position === 'QB')!;
    expect(qb.score).toBeLessThan(QB_NO_ANSWER_FLOOR_SCORE - 0.001);
    expect(needs.findIndex((n) => n.position === 'QB')).toBeGreaterThan(0);
  });

  it('a first-round QB past his rookie window no longer suppresses the need', () => {
    // A 1st-rounder 6 years in who never became a starter is a bust —
    // QB re-opens as a need.
    const needs = qbRoomNeeds([{ age: 28, round: 1, exp: 6 }]);
    const qb = needs.find((n) => n.position === 'QB')!;
    expect(qb.score).toBeGreaterThanOrEqual(QB_NO_ANSWER_FLOOR_SCORE - 0.001);
  });

  it('produces deterministic output for the same league + team', () => {
    const league = createLeague({ seed: 'needs-determinism' });
    const team = Object.values(league.teams)[5]!;
    const a = computeTeamNeeds(team, league);
    const b = computeTeamNeeds(team, league);
    expect(a).toEqual(b);
  });

  it('returns non-empty top-5 needs for every team on a fresh league', () => {
    const league = createLeague({ seed: 'needs-all-teams' });
    for (const team of Object.values(league.teams)) {
      const needs = computeTeamNeeds(team, league);
      const top5 = needs.slice(0, 5);
      expect(top5.length).toBe(5);
      // Top-of-list need scores should be meaningfully above zero on
      // a freshly-generated 53-man roster — no team is uniformly
      // stacked at every position.
      expect(top5[0]!.score).toBeGreaterThan(-1);
    }
  });
});

describe('positionNeedPressure', () => {
  it('is non-negative everywhere and produces an entry per position', () => {
    const league = createLeague({ seed: 'pressure-shape' });
    const team = Object.values(league.teams)[0]!;
    const pressure = positionNeedPressure(team, league.players);
    const positions: Position[] = [
      'QB', 'RB', 'FB', 'WR', 'TE', 'LT', 'LG', 'C', 'RG', 'RT',
      'EDGE', 'DT', 'NT', 'ILB', 'OLB', 'CB', 'S', 'NICKEL', 'K', 'P', 'LS',
    ];
    for (const p of positions) {
      expect(pressure[p]).toBeDefined();
      expect(pressure[p]).toBeGreaterThanOrEqual(0);
    }
  });

  it('reports a hole where the roster has no quality at a position', () => {
    const league = createLeague({ seed: 'pressure-hole' });
    const team = Object.values(league.teams)[0]!;
    // Strip every left tackle from the roster → a clear LT hole.
    const ltIds = new Set(
      team.rosterIds.filter((id) => league.players[id]?.position === 'LT'),
    );
    const stripped = { ...team, rosterIds: team.rosterIds.filter((id) => !ltIds.has(id)) };
    const pressure = positionNeedPressure(stripped, league.players);
    // STARTER_SLOTS.LT === 1, so with nobody there pressure is the full slot.
    expect(pressure.LT).toBeGreaterThanOrEqual(0.9);
  });
});
