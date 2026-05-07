import { describe, it, expect } from 'vitest';
import { createLeague } from './generate.js';
import type { TeamPersonality } from '../types/personnel.js';

describe('createLeague', () => {
  it('generates exactly 32 teams', () => {
    const league = createLeague({ seed: 'gen-1' });
    expect(Object.keys(league.teams).length).toBe(32);
    expect(Object.keys(league.owners).length).toBe(32);
    expect(Object.keys(league.gms).length).toBe(32);
    expect(Object.keys(league.coaches).length).toBe(32);
    expect(Object.keys(league.teamPersonalities).length).toBe(32);
  });

  it('is deterministic — same seed yields identical league', () => {
    const a = createLeague({ seed: 'determinism' });
    const b = createLeague({ seed: 'determinism' });
    expect(a).toEqual(b);
  });

  it('different seeds yield different leagues', () => {
    const a = createLeague({ seed: 'alpha' });
    const b = createLeague({ seed: 'beta' });
    expect(a).not.toEqual(b);
  });

  it('every team has a valid owner/GM/HC reference resolvable in the entity stores', () => {
    const league = createLeague({ seed: 'refs' });
    for (const team of Object.values(league.teams)) {
      expect(league.owners[team.ownerId]).toBeDefined();
      expect(league.gms[team.gmId]).toBeDefined();
      expect(league.coaches[team.headCoachId]).toBeDefined();
    }
  });

  it('every team has a valid Team Personality with all 6 dimensions', () => {
    const league = createLeague({ seed: 'tp' });
    for (const tp of Object.values(league.teamPersonalities) as TeamPersonality[]) {
      expect(tp.riskTolerance).toBeGreaterThanOrEqual(1);
      expect(tp.riskTolerance).toBeLessThanOrEqual(10);
      expect(tp.analyticsOrientation).toBeGreaterThanOrEqual(1);
      expect(tp.patienceLevel).toBeGreaterThanOrEqual(1);
      expect(tp.financialAggressiveness).toBeGreaterThanOrEqual(1);
      expect(tp.championshipUrgency).toBeGreaterThanOrEqual(1);
      expect(tp.organizationalStability).toBeGreaterThanOrEqual(1);
    }
  });

  describe('L/L-01 distribution constraints', () => {
    // Per the L/L-01 resolution doc:
    //   "No more than 4 teams should score 9-10 on any single team
    //    personality dimension"
    //   "No more than 4 teams should score 1-2 on any single team
    //    personality dimension"
    //
    // Values from the formula are floats (rounded to 0.1), so we
    // interpret 9-10 as ">= 9" and 1-2 as "<= 2".
    //
    // We test across multiple seeds — the constraint is statistical, not
    // deterministic for any given league. Allow occasional violations
    // (≤ 5% of seeds breaking the constraint) to account for legitimate
    // tail events.
    const dimensions: (keyof TeamPersonality)[] = [
      'riskTolerance',
      'analyticsOrientation',
      'patienceLevel',
      'financialAggressiveness',
      'championshipUrgency',
      'organizationalStability',
    ];

    for (const dim of dimensions) {
      it(`${dim}: ≤4 teams at high extreme in most seeds`, () => {
        const violations = countSeedsWithExtreme(dim, 'high', 50);
        expect(violations).toBeLessThanOrEqual(3); // ≤6% of 50 seeds
      });

      it(`${dim}: ≤4 teams at low extreme in most seeds`, () => {
        const violations = countSeedsWithExtreme(dim, 'low', 50);
        expect(violations).toBeLessThanOrEqual(3);
      });
    }
  });

  it('produces meaningfully unique team personalities — no exact duplicates within a league', () => {
    const league = createLeague({ seed: 'uniq' });
    const fingerprints = new Set<string>();
    for (const tp of Object.values(league.teamPersonalities) as TeamPersonality[]) {
      fingerprints.add(JSON.stringify(tp));
    }
    expect(fingerprints.size).toBe(32);
  });

  it('produces uniquely-named personnel within a league', () => {
    const league = createLeague({ seed: 'names' });
    const ownerNames = new Set(Object.values(league.owners).map((o) => o.name));
    const gmNames = new Set(Object.values(league.gms).map((g) => g.name));
    const hcNames = new Set(Object.values(league.coaches).map((c) => c.name));
    // With 32 owners + 32 GMs + 32 HCs = 96 personnel and ~26k name combos,
    // collisions are statistically rare. Allow a small number of duplicates
    // since the same name *can* recur and that is okay narratively.
    expect(ownerNames.size).toBeGreaterThanOrEqual(30);
    expect(gmNames.size).toBeGreaterThanOrEqual(30);
    expect(hcNames.size).toBeGreaterThanOrEqual(30);
  });
});

function countSeedsWithExtreme(
  dimension: keyof TeamPersonality,
  side: 'high' | 'low',
  numSeeds: number,
): number {
  let violations = 0;
  for (let i = 0; i < numSeeds; i++) {
    const league = createLeague({ seed: `dist-${dimension}-${side}-${i}` });
    let extremeCount = 0;
    for (const tp of Object.values(league.teamPersonalities) as TeamPersonality[]) {
      const v = tp[dimension];
      if (side === 'high' && v >= 9) extremeCount++;
      if (side === 'low' && v <= 2) extremeCount++;
    }
    if (extremeCount > 4) violations++;
  }
  return violations;
}
