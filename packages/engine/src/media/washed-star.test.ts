import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import type { Player, PlayerSkills } from '../types/player.js';
import type { MediaReport } from '../types/media.js';
import { generateWashedStarTakes } from './washed-star.js';

/** A rostered STAR-tier veteran whose CURRENT skills have cratered — the sticky
 *  grade (reputation) now sits far above his current within-position standing. */
function leagueWithWashedStar(seed: string): { league: ReturnType<typeof createLeague>; victimId: string } {
  const league = createLeague({ seed });
  const victim = Object.values(league.players).find(
    (p) => p.teamId !== null && p.position === 'QB',
  )!;
  const crushed = Object.fromEntries(
    Object.keys(victim.current).map((k) => [k, 45]),
  ) as PlayerSkills;
  const washed: Player = {
    ...victim,
    talentGrade: 'STAR',
    tier: 'STAR',
    talentScore: 0.97,
    experienceYears: 6,
    current: crushed,
  };
  return {
    league: { ...league, players: { ...league.players, [victim.id]: washed } },
    victimId: victim.id,
  };
}

function textOf(r: MediaReport): string {
  const parts = [r.headline];
  if (r.kind === 'player-take' && r.scoutReport) {
    const b = r.scoutReport;
    parts.push(b.summary, b.concern, b.bottomLine, ...b.strengths);
    if (b.comp) parts.push(b.comp);
  }
  return parts.join(' ');
}

describe('generateWashedStarTakes', () => {
  it('files a WASHED (critical) + DEFEND (positive) pair for a faded star, from distinct outlets', () => {
    const { league, victimId } = leagueWithWashedStar('washed-1');
    const reports = generateWashedStarTakes(league, 'REGULAR_SEASON_WEEK', 10, 1000);
    const forVictim = reports.filter(
      (r) => r.kind === 'player-take' && r.subjectPlayerId === victimId,
    );
    expect(forVictim.length).toBe(2);
    const washed = forVictim.find((r) => r.tone === 'CRITICAL');
    const defend = forVictim.find((r) => r.tone === 'POSITIVE');
    expect(washed).toBeDefined();
    expect(defend).toBeDefined();
    expect(washed!.outletId).not.toBe(defend!.outletId);
  });

  it('never speaks a rating number (North Star — no digits)', () => {
    const { league } = leagueWithWashedStar('washed-2');
    const reports = generateWashedStarTakes(league, 'REGULAR_SEASON_WEEK', 10, 1000);
    expect(reports.length).toBeGreaterThan(0);
    for (const r of reports) {
      expect(textOf(r)).not.toMatch(/\d/);
    }
  });

  it('is deterministic for a given (seed, voiceSeed)', () => {
    const a = leagueWithWashedStar('washed-3');
    const b = leagueWithWashedStar('washed-3');
    const ra = generateWashedStarTakes(a.league, 'REGULAR_SEASON_WEEK', 10, 1000);
    const rb = generateWashedStarTakes(b.league, 'REGULAR_SEASON_WEEK', 10, 1000);
    expect(ra).toEqual(rb);
  });

  it('same world, different voiceSeed → same subjects, different words', () => {
    const base = leagueWithWashedStar('washed-4');
    const alt = { ...base.league, voiceSeed: 'a-different-voice' };
    const ra = generateWashedStarTakes(base.league, 'REGULAR_SEASON_WEEK', 10, 1000);
    const rb = generateWashedStarTakes(alt, 'REGULAR_SEASON_WEEK', 10, 1000);
    // Same subjects + outlets + tones (selection is world-state)…
    expect(rb.map((r) => (r.kind === 'player-take' ? r.subjectPlayerId : ''))).toEqual(
      ra.map((r) => (r.kind === 'player-take' ? r.subjectPlayerId : '')),
    );
    // …but the WORDS differ (headline + body all ride voiceSeed).
    expect(rb.map(textOf).join('|')).not.toEqual(ra.map(textOf).join('|'));
  });

  // A fresh (year-0) league's talentScore is the grade-seed band midpoint
  // (players/skills.ts GRADE_SEED_SCORE) until the first offseason
  // regradeLeagueTalent pass EWMA-tracks it toward real standing — comparing
  // it to the noisy generated current-skill percentile can rarely cross the
  // 0.2 gap threshold from pure generation variance, not real decline
  // (measured: ~1/571 STAR-tier players across 11 seeds, right at the
  // boundary — a single hardcoded seed asserting exactly zero is fragile to
  // any unrelated PRNG-ordering change; this checks the real invariant, a
  // near-zero RATE across many seeds, instead).
  it('rarely flags a washed star on a fresh (never-simulated) league', () => {
    const seeds = Array.from({ length: 15 }, (_, i) => `fresh-washed-rate-${i}`);
    let totalReports = 0;
    for (const seed of seeds) {
      const league = createLeague({ seed });
      totalReports += generateWashedStarTakes(league, 'REGULAR_SEASON_WEEK', 10, 1000).length;
    }
    // Each false-positive candidate files a 2-report (WASHED+DEFEND) pair;
    // the measured real rate is ~0.2% of STAR-tier players, so more than one
    // pair across 15 full leagues would indicate the gap threshold or
    // generation noise has shifted meaningfully, not just tail luck.
    expect(totalReports).toBeLessThanOrEqual(2);
  });
});
