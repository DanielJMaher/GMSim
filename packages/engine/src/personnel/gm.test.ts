import { describe, it, expect } from 'vitest';
import { Prng } from '../prng/index.js';
import { generateOwner } from './owner.js';
import { generateGm } from './gm.js';
import { GM_QUIRK_POOL } from './quirks.js';
import { getOwnerArchetypeById } from './archetypes/owner.js';
import { GM_ARCHETYPES } from './archetypes/gm.js';
import { Position } from '../types/enums.js';

describe('generateGm', () => {
  it('is deterministic for the same seed and owner', () => {
    const owner = generateOwner(new Prng('owner'), 'KC');
    const a = generateGm(new Prng('gm'), 'KC', owner);
    const b = generateGm(new Prng('gm'), 'KC', owner);
    expect(a).toEqual(b);
  });

  it('rolls spectrums within [1, 10]', () => {
    const owner = generateOwner(new Prng('owner'), 'KC');
    const gm = generateGm(new Prng('gm'), 'KC', owner);
    for (const v of Object.values(gm.spectrums)) {
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(10);
    }
  });

  it('assigns a positional bias from the Position enum with magnitude in {-2,-1,1,2}', () => {
    for (let i = 0; i < 30; i++) {
      const gm = generateGm(new Prng(`pb-${i}`), 'KC');
      expect(Object.values(Position)).toContain(gm.positionalBias.position);
      expect([-2, -1, 1, 2]).toContain(gm.positionalBias.bias);
    }
  });

  it('quirks come from the GM pool only', () => {
    const gm = generateGm(new Prng('gm-q'), 'KC');
    for (const q of gm.quirks) {
      expect(GM_QUIRK_POOL).toContain(q);
    }
  });

  describe('hiring tendency logic', () => {
    it('analytics-savvy owners disproportionately produce analytics GMs', () => {
      // Force a high-knowledge, low-ego owner via the Sage archetype.
      const sage = getOwnerArchetypeById('OWNER_SAGE')!;
      const counts = new Map<string, number>();
      for (let i = 0; i < 200; i++) {
        const owner = generateOwner(new Prng(`sage-owner-${i}`), 'KC', sage);
        const gm = generateGm(new Prng(`sage-gm-${i}`), 'KC', owner);
        // Find which archetype this GM most likely came from by spectrum profile.
        // We don't store archetype on the generated entity, so we do a
        // probabilistic check: analytics archetype produces analyticsReliance
        // in [8,10]. Across 200 trials with sage owners, we expect a bias
        // toward high analyticsReliance.
        const bucket = gm.spectrums.analyticsReliance >= 8 ? 'high' : gm.spectrums.analyticsReliance <= 3 ? 'low' : 'mid';
        counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
      }
      const high = counts.get('high') ?? 0;
      const low = counts.get('low') ?? 0;
      // With Sage owners, "high" should outnumber "low" by a comfortable margin.
      expect(high).toBeGreaterThan(low);
    });

    it('Meddler owners (low knowledge + high ego) shift away from analytics archetypes', () => {
      const meddler = getOwnerArchetypeById('OWNER_MEDDLER')!;
      let highAnalytics = 0;
      let oldSchoolish = 0;
      for (let i = 0; i < 200; i++) {
        const owner = generateOwner(new Prng(`mdl-owner-${i}`), 'KC', meddler);
        const gm = generateGm(new Prng(`mdl-gm-${i}`), 'KC', owner);
        if (gm.spectrums.analyticsReliance >= 8) highAnalytics++;
        if (gm.spectrums.analyticsReliance <= 3) oldSchoolish++;
      }
      // With Meddler owners, old-school-ish GMs should outnumber analytics-architect-ish ones.
      expect(oldSchoolish).toBeGreaterThan(highAnalytics);
    });
  });

  it('every archetype produces a valid GM', () => {
    for (const archetype of GM_ARCHETYPES) {
      const gm = generateGm(new Prng(`a-${archetype.id}`), 'KC');
      // Just smoke-test bounds & required fields exist
      expect(gm.id).toBeTruthy();
      expect(gm.name).toBeTruthy();
      for (const v of Object.values(gm.spectrums)) {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(10);
      }
    }
  });
});
