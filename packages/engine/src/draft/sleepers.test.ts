import { describe, it, expect } from 'vitest';
import { buildSleeperProfiles, selectScoutSleepers } from './sleepers.js';
import type { SleeperProfile } from './sleepers.js';
import { createLeague } from '../league/generate.js';
import { Prng } from '../prng/index.js';
import { PlayerId } from '../types/ids.js';
import type { CollegeScout } from '../types/college.js';

const scout = (specialty: string) => ({ knownSpecialty: specialty } as CollegeScout);

function profile(id: string, worthiness: number, group = 'WR'): SleeperProfile {
  return {
    prospectId: PlayerId(id),
    channel: 'TAPE',
    worthiness,
    love: 8,
    positionGroup: group,
  };
}

describe('selectScoutSleepers', () => {
  const profiles = new Map<ReturnType<typeof PlayerId>, SleeperProfile>([
    [PlayerId('p1'), profile('p1', 0.9)],
    [PlayerId('p2'), profile('p2', 0.5)],
    [PlayerId('p3'), profile('p3', 0.4)],
    [PlayerId('p4'), profile('p4', 0.3)],
    [PlayerId('p5'), profile('p5', 0.25)],
    [PlayerId('p6'), profile('p6', 0.2)],
  ]);

  it('rolls 3–5 distinct sleepers', () => {
    const picks = selectScoutSleepers(new Prng('sl-1'), scout('QB'), profiles);
    expect(picks.length).toBeGreaterThanOrEqual(3);
    expect(picks.length).toBeLessThanOrEqual(5);
    expect(new Set(picks.map((p) => p.prospectId)).size).toBe(picks.length);
  });

  it('only picks prospects from the profile set', () => {
    const picks = selectScoutSleepers(new Prng('sl-2'), scout('QB'), profiles);
    for (const pick of picks) expect(profiles.has(pick.prospectId)).toBe(true);
  });

  it('is deterministic for the same prng + scout', () => {
    const a = selectScoutSleepers(new Prng('sl-3'), scout('QB'), profiles);
    const b = selectScoutSleepers(new Prng('sl-3'), scout('QB'), profiles);
    expect(a).toEqual(b);
  });

  it('favors higher-worthiness prospects across many scouts', () => {
    let p1Hits = 0;
    let p6Hits = 0;
    for (let i = 0; i < 200; i++) {
      const picks = selectScoutSleepers(new Prng(`many-${i}`), scout('QB'), profiles);
      const ids = new Set(picks.map((p) => p.prospectId));
      if (ids.has(PlayerId('p1'))) p1Hits++;
      if (ids.has(PlayerId('p6'))) p6Hits++;
    }
    // The 0.9-worthiness prospect should be picked far more than the 0.2 one.
    expect(p1Hits).toBeGreaterThan(p6Hits);
  });

  it('returns everything when the pool is smaller than the minimum', () => {
    const tiny = new Map([[PlayerId('x'), profile('x', 0.9)]]);
    const picks = selectScoutSleepers(new Prng('sl-4'), scout('QB'), tiny);
    expect(picks).toHaveLength(1);
  });
});

describe('buildSleeperProfiles', () => {
  it('builds believable profiles from a fresh league (bounded love, above floor)', () => {
    const league = createLeague({ seed: 'sleeper-build' });
    const profiles = buildSleeperProfiles(
      league.collegePool,
      league.combineResults,
      [], // no season played yet → production 0; talent + measurables still drive it
    );
    expect(profiles.size).toBeGreaterThan(0);
    for (const p of profiles.values()) {
      // Love is bounded to the believable band (LOVE_MIN..LOVE_MAX).
      expect(p.love).toBeGreaterThanOrEqual(5);
      expect(p.love).toBeLessThanOrEqual(14);
      expect(p.worthiness).toBeGreaterThanOrEqual(0.18); // floor
      expect(p.channel === 'TAPE' || p.channel === 'MEASURABLES').toBe(true);
    }
  });

  it('only includes declared, draft-eligible prospects', () => {
    const league = createLeague({ seed: 'sleeper-elig' });
    const eligibleIds = new Set(
      league.collegePool.filter((cp) => cp.isDraftEligible && cp.hasDeclared).map((cp) => cp.id),
    );
    const profiles = buildSleeperProfiles(league.collegePool, league.combineResults, []);
    for (const id of profiles.keys()) expect(eligibleIds.has(id)).toBe(true);
  });

  it('is deterministic', () => {
    const league = createLeague({ seed: 'sleeper-det' });
    const a = buildSleeperProfiles(league.collegePool, league.combineResults, []);
    const b = buildSleeperProfiles(league.collegePool, league.combineResults, []);
    expect(a.size).toBe(b.size);
    for (const [id, pa] of a) {
      expect(b.get(id)).toEqual(pa);
    }
  });
});
