import { describe, it, expect } from 'vitest';
import { generateMediaCollegeObservations, mediaCoverageForLevel } from './prospect-evaluators.js';
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

  it('coverage intensity rises with level, and reads scale the volume', () => {
    const low = mediaCoverageForLevel(0);
    const high = mediaCoverageForLevel(1);
    expect(high.readsPerEvaluator!).toBeGreaterThan(low.readsPerEvaluator!);
    expect(high.accuracyBoost!).toBeGreaterThan(low.accuracyBoost!);

    const league2 = createLeague({ seed: 'media-reads' });
    const few = generateMediaCollegeObservations(new Prng('r'), league2.mediaOutlets, league2.collegePool, 0, { readsPerEvaluator: 10 });
    const many = generateMediaCollegeObservations(new Prng('r'), league2.mediaOutlets, league2.collegePool, 0, { readsPerEvaluator: 40 });
    expect(many.length).toBeGreaterThan(few.length);
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

  it('outlets disagree MORE on uncertain (low-ceiling) prospects than on blue-chips', () => {
    // The Ombudsman gradient (2026-06-03): real media locks on blue-chips and
    // scatters down-board. Verify the cross-outlet rank spread is larger for
    // low-ceiling prospects than for high-ceiling locks.
    const league = createLeague({ seed: 'media-spread-gradient' });
    const obs = generateMediaCollegeObservations(
      new Prng('spread'),
      league.mediaOutlets,
      league.collegePool,
      0,
      { readsPerEvaluator: 60 },
    );

    // Each outlet ranks its covered prospects by mean observed grade.
    const byOutlet = new Map<string, Map<string, { sum: number; n: number }>>();
    for (const o of obs) {
      const oid = outletIdOf(o.scoutId);
      let per = byOutlet.get(oid);
      if (!per) { per = new Map(); byOutlet.set(oid, per); }
      const cur = per.get(o.collegePlayerId) ?? { sum: 0, n: 0 };
      cur.sum += meanObserved(o.skills as Record<string, number | undefined>);
      cur.n += 1;
      per.set(o.collegePlayerId, cur);
    }
    const ranksByProspect = new Map<string, number[]>();
    for (const per of byOutlet.values()) {
      const ranked = [...per.entries()]
        .map(([pid, g]) => ({ pid, grade: g.sum / g.n }))
        .sort((a, b) => b.grade - a.grade);
      ranked.forEach((r, i) => {
        const arr = ranksByProspect.get(r.pid) ?? [];
        arr.push(i + 1);
        ranksByProspect.set(r.pid, arr);
      });
    }

    const meanCeil = (id: string): number => {
      const cp = league.collegePool.find((c) => c.id === id);
      if (!cp) return 0;
      const vals = Object.values(cp.ceiling) as number[];
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    };
    const stdev = (xs: number[]): number => {
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
    };

    // Covered by enough outlets to have a meaningful spread, sorted by ceiling.
    const covered = [...ranksByProspect.entries()]
      .filter(([, ranks]) => ranks.length >= 4)
      .map(([id, ranks]) => ({ id, ceil: meanCeil(id), spread: stdev(ranks) }))
      .sort((a, b) => b.ceil - a.ceil);
    expect(covered.length).toBeGreaterThan(20);

    const topQuartile = covered.slice(0, Math.floor(covered.length / 4));
    const bottomQuartile = covered.slice(-Math.floor(covered.length / 4));
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const topSpread = mean(topQuartile.map((p) => p.spread));
    const bottomSpread = mean(bottomQuartile.map((p) => p.spread));
    // Low-ceiling prospects are more contested → bigger cross-outlet rank spread.
    expect(bottomSpread).toBeGreaterThan(topSpread);
  });

  // ── Combine reactivity (v0.76) ─────────────────────────────────────
  function meanByOutlet(obs: ReturnType<typeof generateMediaCollegeObservations>) {
    const sum = new Map<string, { sum: number; n: number }>();
    for (const o of obs) {
      const oid = outletIdOf(o.scoutId);
      const cur = sum.get(oid) ?? { sum: 0, n: 0 };
      cur.sum += meanObserved(o.skills as Record<string, number | undefined>);
      cur.n += 1;
      sum.set(oid, cur);
    }
    return sum;
  }

  it('combine data changes the read, but is a no-op with no combine results', () => {
    const league = createLeague({ seed: 'media-combine-1' });
    // No combine data → identical to the default (5-arg) call.
    const baseline = generateMediaCollegeObservations(
      new Prng('c'),
      league.mediaOutlets,
      league.collegePool,
      0,
    );
    const empty = generateMediaCollegeObservations(
      new Prng('c'),
      league.mediaOutlets,
      league.collegePool,
      0,
      {},
      {},
    );
    expect(empty).toEqual(baseline);

    // With the class's combine results, the read shifts (coverage + bias).
    const reactive = generateMediaCollegeObservations(
      new Prng('c'),
      league.mediaOutlets,
      league.collegePool,
      0,
      {},
      league.combineResults,
    );
    expect(reactive).not.toEqual(baseline);
  });

  it('combine reactivity widens the hype gap — loud on hype boards, quiet on honest ones', () => {
    const league = createLeague({ seed: 'media-combine-2' });
    const collegeOutlets = Object.values(league.mediaOutlets).filter((o) => o.focus === 'COLLEGE');
    const highest = collegeOutlets.reduce((a, b) => (b.hypeSpectrum > a.hypeSpectrum ? b : a));
    const lowest = collegeOutlets.reduce((a, b) => (b.hypeSpectrum < a.hypeSpectrum ? b : a));
    // Only meaningful when hype actually differs across the slate.
    if (highest.hypeSpectrum <= lowest.hypeSpectrum) return;

    const gapOf = (combine: typeof league.combineResults | Record<string, never>) => {
      const obs = generateMediaCollegeObservations(
        new Prng('g'),
        league.mediaOutlets,
        league.collegePool,
        0,
        {},
        combine,
      );
      const means = meanByOutlet(obs);
      const hi = means.get(highest.id as string)!;
      const lo = means.get(lowest.id as string)!;
      return hi.sum / hi.n - lo.sum / lo.n;
    };

    // The combine gives the hype outlet a new thing to overreact to (the
    // workout warrior), so the high-vs-low-hype grade gap grows.
    expect(gapOf(league.combineResults)).toBeGreaterThan(gapOf({}));
  });
});
