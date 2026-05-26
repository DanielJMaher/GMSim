import { describe, it, expect } from 'vitest';
import { buildProspectSleeperTake } from './prospect-takes.js';
import { advanceCollegeScoutingCycle } from '../draft/college-cycle.js';
import { createLeague } from '../league/generate.js';
import { Prng } from '../prng/index.js';

const league = createLeague({ seed: 'takes-base' });
const outlet = Object.values(league.mediaOutlets).find((o) => o.focus === 'COLLEGE')!;
const prospect = league.collegePool.find((cp) => cp.isDraftEligible && cp.hasDeclared)!;

const baseArgs = {
  outlet,
  prospect,
  channel: 'TAPE' as const,
  filedOnTick: 5,
  seasonNumber: 1,
  lifecyclePhase: 'TOP_30_VISITS' as const,
};

describe('buildProspectSleeperTake', () => {
  it('builds a college player-take with the prospect baked into the headline', () => {
    const r = buildProspectSleeperTake(new Prng('t1'), baseArgs);
    expect(r.kind).toBe('player-take');
    if (r.kind === 'player-take') {
      expect(r.subjectIsCollegeProspect).toBe(true);
      expect(r.subjectPlayerId).toBe(prospect.id);
    }
    expect(r.headline).toContain(prospect.firstName);
    expect(r.headline).toContain(prospect.lastName);
    expect(r.outletId).toBe(outlet.id);
    expect(r.filedOnTick).toBe(5);
    expect(r.weekNumber).toBeNull();
  });

  it('is deterministic for the same prng', () => {
    const a = buildProspectSleeperTake(new Prng('z'), baseArgs);
    const b = buildProspectSleeperTake(new Prng('z'), baseArgs);
    expect(a).toEqual(b);
  });

  it('produces a non-empty headline for the measurables channel too', () => {
    const r = buildProspectSleeperTake(new Prng('m'), { ...baseArgs, channel: 'MEASURABLES' });
    expect(r.headline.length).toBeGreaterThan(0);
    expect(r.headline).toContain(prospect.lastName);
  });
});

describe('media takes wiring', () => {
  it('the scouting cycle emits college sleeper-alert takes into mediaReports', () => {
    const fresh = createLeague({ seed: 'takes-wire' });
    const before = fresh.mediaReports.length;
    const after = advanceCollegeScoutingCycle(new Prng('cyc'), fresh, 10);
    const collegeTakes = after.mediaReports.filter(
      (r) => r.kind === 'player-take' && r.subjectIsCollegeProspect,
    );
    expect(after.mediaReports.length).toBeGreaterThan(before);
    expect(collegeTakes.length).toBeGreaterThan(0);
    // Every college outlet that filed references a real outlet.
    for (const t of collegeTakes) {
      expect(fresh.mediaOutlets[t.outletId]).toBeDefined();
    }
  });
});
