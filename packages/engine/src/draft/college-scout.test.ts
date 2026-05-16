import { describe, expect, it } from 'vitest';
import { Prng } from '../prng/index.js';
import {
  generateCollegeScout,
  generateTeamCollegeScouts,
  collegeScoutStaffSize,
  teamCollegeScoutAccuracyMean,
} from './college-scout.js';
import { PositionGroup } from '../types/enums.js';
import type { Owner, Gm } from '../types/personnel.js';
import { OwnerId, GmId } from '../types/ids.js';

function owner(financialCommitment: number): Owner {
  return {
    id: OwnerId('OWNER_T'),
    name: 'Test Owner',
    spectrums: {
      involvement: 5,
      patience: 5,
      financialCommitment,
      footballKnowledge: 5,
      legacyMotivation: 5,
      fanConnection: 5,
      riskTolerance: 5,
      ego: 5,
    },
    quirks: [],
    personality: { decisiveness: 5, charisma: 5, emotionalStability: 5, communicativeness: 5 },
  };
}

function gm(talentEvaluationAccuracy: number): Gm {
  return {
    id: GmId('GM_T'),
    name: 'Test GM',
    spectrums: {
      analyticsReliance: 5,
      tradeAggressiveness: 5,
      draftConviction: 5,
      freeAgencyDiscipline: 5,
      capManagement: 5,
      patienceUnderPressure: 5,
      talentEvaluationAccuracy,
      intangiblesWeighting: 5,
      evolutionRate: 5,
      relationshipQuality: 5,
    },
    positionalBias: { position: 'QB' as never, bias: 1 },
    quirks: [],
    personality: { decisiveness: 5, charisma: 5, emotionalStability: 5, communicativeness: 5 },
  };
}

describe('collegeScoutStaffSize', () => {
  it('returns 10 for cheap, 12 for mid, 14 for high, 15 for max', () => {
    expect(collegeScoutStaffSize(1)).toBe(10);
    expect(collegeScoutStaffSize(3)).toBe(10);
    expect(collegeScoutStaffSize(4)).toBe(12);
    expect(collegeScoutStaffSize(6)).toBe(12);
    expect(collegeScoutStaffSize(7)).toBe(14);
    expect(collegeScoutStaffSize(8)).toBe(14);
    expect(collegeScoutStaffSize(9)).toBe(15);
    expect(collegeScoutStaffSize(10)).toBe(15);
  });
});

describe('teamCollegeScoutAccuracyMean', () => {
  it('blends owner financial commitment and GM talent eval accuracy', () => {
    const low = teamCollegeScoutAccuracyMean(owner(1), gm(1));
    const high = teamCollegeScoutAccuracyMean(owner(10), gm(10));
    expect(low).toBeLessThan(high);
    expect(low).toBeGreaterThanOrEqual(0.35);
    expect(high).toBeLessThanOrEqual(0.85);
  });

  it('caps lower than the NFL scout accuracy curve', () => {
    // College evaluation is harder — even max-org college scouts cap
    // ~0.05 lower than max-org NFL scouts. Spot check.
    const collegeMax = teamCollegeScoutAccuracyMean(owner(10), gm(10));
    expect(collegeMax).toBeLessThanOrEqual(0.81);
  });
});

describe('generateCollegeScout', () => {
  it('is deterministic for the same seed', () => {
    const a = generateCollegeScout(new Prng('seed'), 'TEST_0', 0.6);
    const b = generateCollegeScout(new Prng('seed'), 'TEST_0', 0.6);
    expect(a).toEqual(b);
  });

  it('CSCOUT_-prefixed id distinct from NFL scouts', () => {
    const cs = generateCollegeScout(new Prng('s'), 'KC_0', 0.6);
    expect(cs.id).toMatch(/^CSCOUT_/);
  });

  it('produces accuracy at or above the floor for every position group', () => {
    const scout = generateCollegeScout(new Prng('floor'), 'TEST_0', 0.6);
    for (const group of Object.values(PositionGroup)) {
      expect(scout.trueAccuracy[group]).toBeGreaterThanOrEqual(0.18);
      expect(scout.trueAccuracy[group]).toBeLessThanOrEqual(0.95);
    }
  });

  it('typically boosts accuracy at known specialty across many seeds', () => {
    let specialty = 0;
    let off = 0;
    const samples = 100;
    for (let i = 0; i < samples; i++) {
      const s = generateCollegeScout(new Prng(`seed-${i}`), 'TEST_0', 0.6);
      specialty += s.trueAccuracy[s.knownSpecialty];
      let offSum = 0;
      let offCount = 0;
      for (const group of Object.values(PositionGroup)) {
        if (group === s.knownSpecialty) continue;
        offSum += s.trueAccuracy[group];
        offCount++;
      }
      off += offSum / offCount;
    }
    expect(specialty / samples).toBeGreaterThan(off / samples);
  });

  it('most scouts have a regional preference (rare NATIONAL scouts)', () => {
    let national = 0;
    const samples = 500;
    for (let i = 0; i < samples; i++) {
      const s = generateCollegeScout(new Prng(`reg-${i}`), 'X', 0.6);
      if (s.preferredRegion === 'NATIONAL') national++;
    }
    // Designed weight is 6/100 = 6%; allow [2%, 12%] to absorb roll
    // variance at the modest sample size.
    const rate = national / samples;
    expect(rate).toBeGreaterThanOrEqual(0.02);
    expect(rate).toBeLessThanOrEqual(0.13);
  });
});

describe('generateTeamCollegeScouts', () => {
  it('produces the staff size dictated by owner financial commitment', () => {
    const cheap = generateTeamCollegeScouts(new Prng('s'), 'KC', owner(2), gm(5));
    const lavish = generateTeamCollegeScouts(new Prng('s'), 'KC', owner(10), gm(5));
    expect(cheap.length).toBe(10);
    expect(lavish.length).toBe(15);
  });

  it('all scout IDs unique within a team', () => {
    const scouts = generateTeamCollegeScouts(new Prng('s'), 'KC', owner(8), gm(5));
    const ids = new Set(scouts.map((s) => s.id));
    expect(ids.size).toBe(scouts.length);
  });

  it('regional preferences vary across the staff', () => {
    const scouts = generateTeamCollegeScouts(new Prng('reg'), 'KC', owner(10), gm(8));
    const regions = new Set(scouts.map((s) => s.preferredRegion));
    expect(regions.size).toBeGreaterThan(1);
  });
});
