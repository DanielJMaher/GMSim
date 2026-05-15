import { describe, expect, it } from 'vitest';
import { Prng } from '../prng/index.js';
import { generateScout, generateTeamScouts, scoutStaffSize, teamScoutAccuracyMean } from './scout.js';
import type { Owner, Gm } from '../types/personnel.js';
import { OwnerId, GmId } from '../types/ids.js';
import { PositionGroup } from '../types/enums.js';

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

describe('scoutStaffSize', () => {
  it('returns 3 for low financial commitment, 4 for mid, 5 for high', () => {
    expect(scoutStaffSize(1)).toBe(3);
    expect(scoutStaffSize(3)).toBe(3);
    expect(scoutStaffSize(4)).toBe(4);
    expect(scoutStaffSize(7)).toBe(4);
    expect(scoutStaffSize(8)).toBe(5);
    expect(scoutStaffSize(10)).toBe(5);
  });
});

describe('teamScoutAccuracyMean', () => {
  it('blends owner financial commitment and GM talent eval accuracy', () => {
    const low = teamScoutAccuracyMean(owner(1), gm(1));
    const high = teamScoutAccuracyMean(owner(10), gm(10));
    const mid = teamScoutAccuracyMean(owner(5), gm(5));
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
    expect(low).toBeGreaterThanOrEqual(0.4);
    expect(high).toBeLessThanOrEqual(0.86);
  });
});

describe('generateScout', () => {
  it('is deterministic for the same seed', () => {
    const a = generateScout(new Prng('seed'), 'TEST_0', 0.6);
    const b = generateScout(new Prng('seed'), 'TEST_0', 0.6);
    expect(a).toEqual(b);
  });

  it('produces accuracy at or above the floor for every position group', () => {
    const scout = generateScout(new Prng('acc-floor'), 'TEST_0', 0.6);
    for (const group of Object.values(PositionGroup)) {
      expect(scout.trueAccuracy[group]).toBeGreaterThanOrEqual(0.2);
      expect(scout.trueAccuracy[group]).toBeLessThanOrEqual(0.95);
    }
  });

  it('typically boosts accuracy at the known specialty', () => {
    // Across many seeds, the specialty accuracy should average higher
    // than off-specialty accuracy. ("Often higher" per doc — not always.)
    let specialty = 0;
    let offSpecialty = 0;
    const samples = 100;
    for (let i = 0; i < samples; i++) {
      const s = generateScout(new Prng(`seed-${i}`), 'TEST_0', 0.6);
      specialty += s.trueAccuracy[s.knownSpecialty];
      let offSum = 0;
      let offCount = 0;
      for (const group of Object.values(PositionGroup)) {
        if (group === s.knownSpecialty) continue;
        offSum += s.trueAccuracy[group];
        offCount++;
      }
      offSpecialty += offSum / offCount;
    }
    expect(specialty / samples).toBeGreaterThan(offSpecialty / samples);
  });

  it('rolls 1–2 quirks', () => {
    for (let i = 0; i < 50; i++) {
      const s = generateScout(new Prng(`quirks-${i}`), 'TEST_0', 0.6);
      expect(s.quirks.length).toBeGreaterThanOrEqual(1);
      expect(s.quirks.length).toBeLessThanOrEqual(2);
    }
  });
});

describe('generateTeamScouts', () => {
  it('returns the staff size dictated by owner financial commitment', () => {
    const cheap = generateTeamScouts(new Prng('s'), 'KC', owner(2), gm(5));
    const lavish = generateTeamScouts(new Prng('s'), 'KC', owner(9), gm(5));
    expect(cheap.length).toBe(3);
    expect(lavish.length).toBe(5);
  });

  it('produces distinct scout IDs within a team', () => {
    const scouts = generateTeamScouts(new Prng('s'), 'KC', owner(8), gm(5));
    const ids = new Set(scouts.map((s) => s.id));
    expect(ids.size).toBe(scouts.length);
  });

  it('teams with stronger orgs produce higher mean accuracy', () => {
    const weak = generateTeamScouts(new Prng('weak'), 'WK', owner(1), gm(1));
    const strong = generateTeamScouts(new Prng('strong'), 'ST', owner(10), gm(10));
    const meanAcc = (scouts: ReturnType<typeof generateTeamScouts>) => {
      let sum = 0;
      let count = 0;
      for (const s of scouts) {
        for (const group of Object.values(PositionGroup)) {
          sum += s.trueAccuracy[group];
          count++;
        }
      }
      return sum / count;
    };
    expect(meanAcc(strong)).toBeGreaterThan(meanAcc(weak));
  });
});
