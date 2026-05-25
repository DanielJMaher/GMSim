import { describe, it, expect } from 'vitest';
import { generateMediaCollegeObservations } from './prospect-evaluators.js';
import { createLeague } from '../league/generate.js';
import { Prng } from '../prng/index.js';

function outletIdOf(scoutId: string): string {
  return scoutId.split('::')[0]!;
}

function meanObserved(skills: Record<string, number | undefined>): number {
  const vals = Object.values(skills).filter((v): v is number => typeof v === 'number');
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

describe('generateMediaCollegeObservations', () => {
  it('produces observations only from college outlets, on declared eligibles', () => {
    const league = createLeague({ seed: 'media-eval-1' });
    const obs = generateMediaCollegeObservations(
      new Prng('m1'),
      league.mediaOutlets,
      league.collegePool,
      0,
    );
    expect(obs.length).toBeGreaterThan(0);

    const collegeOutletIds = new Set(
      Object.values(league.mediaOutlets)
        .filter((o) => o.focus === 'COLLEGE')
        .map((o) => o.id as string),
    );
    const eligibleIds = new Set(
      league.collegePool.filter((cp) => cp.isDraftEligible && cp.hasDeclared).map((cp) => cp.id),
    );
    for (const o of obs) {
      expect(collegeOutletIds.has(outletIdOf(o.scoutId))).toBe(true);
      expect(eligibleIds.has(o.collegePlayerId)).toBe(true);
    }
  });

  it('is deterministic for the same prng', () => {
    const league = createLeague({ seed: 'media-eval-2' });
    const a = generateMediaCollegeObservations(new Prng('x'), league.mediaOutlets, league.collegePool, 0);
    const b = generateMediaCollegeObservations(new Prng('x'), league.mediaOutlets, league.collegePool, 0);
    expect(a.length).toBe(b.length);
    expect(a).toEqual(b);
  });

  it('high-hype outlets inflate prospects more than low-hype outlets', () => {
    const league = createLeague({ seed: 'media-eval-hype' });
    const obs = generateMediaCollegeObservations(
      new Prng('hype'),
      league.mediaOutlets,
      league.collegePool,
      0,
    );

    // Mean observed grade per outlet.
    const sumByOutlet = new Map<string, { sum: number; n: number }>();
    for (const o of obs) {
      const oid = outletIdOf(o.scoutId);
      const cur = sumByOutlet.get(oid) ?? { sum: 0, n: 0 };
      cur.sum += meanObserved(o.skills as Record<string, number | undefined>);
      cur.n += 1;
      sumByOutlet.set(oid, cur);
    }

    const collegeOutlets = Object.values(league.mediaOutlets).filter((o) => o.focus === 'COLLEGE');
    const highest = collegeOutlets.reduce((a, b) => (b.hypeSpectrum > a.hypeSpectrum ? b : a));
    const lowest = collegeOutlets.reduce((a, b) => (b.hypeSpectrum < a.hypeSpectrum ? b : a));
    // Only meaningful if hype actually differs across the college slate.
    if (highest.hypeSpectrum > lowest.hypeSpectrum) {
      const hi = sumByOutlet.get(highest.id as string)!;
      const lo = sumByOutlet.get(lowest.id as string)!;
      expect(hi.sum / hi.n).toBeGreaterThan(lo.sum / lo.n);
    }
  });
});
