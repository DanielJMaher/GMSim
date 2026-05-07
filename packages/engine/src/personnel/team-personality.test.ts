import { describe, it, expect } from 'vitest';
import { Prng } from '../prng/index.js';
import { generateOwner } from './owner.js';
import { generateGm } from './gm.js';
import { generateHeadCoach } from './hc.js';
import { generateFanBase } from './fan-base.js';
import { computeTeamPersonality } from './team-personality.js';
import { MarketSize, FranchiseHistory } from '../types/enums.js';

describe('computeTeamPersonality', () => {
  it('always produces values in [1, 10] for every dimension', () => {
    for (let i = 0; i < 50; i++) {
      const seed = `tp-${i}`;
      const owner = generateOwner(new Prng(`${seed}-o`), 'TST');
      const gm = generateGm(new Prng(`${seed}-g`), 'TST', owner);
      const hc = generateHeadCoach(new Prng(`${seed}-h`), 'TST', owner, gm);
      const fans = generateFanBase(new Prng(`${seed}-f`), MarketSize.MEDIUM, FranchiseHistory.PERENNIAL_CONTENDER);
      const tp = computeTeamPersonality(owner, gm, hc, fans);
      for (const v of Object.values(tp)) {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(10);
      }
    }
  });

  it('weights the owner at 50% — owner extreme dominates the result', () => {
    // Construct identical synthetic spectrums except owner is maxed/minned
    // on a single dimension. Verify the output reflects the dominance.
    const baseOwner = generateOwner(new Prng('base'), 'TST');
    const lowPatienceOwner = {
      ...baseOwner,
      spectrums: { ...baseOwner.spectrums, patience: 1 },
    };
    const highPatienceOwner = {
      ...baseOwner,
      spectrums: { ...baseOwner.spectrums, patience: 10 },
    };
    const gm = generateGm(new Prng('gm'), 'TST');
    const hc = generateHeadCoach(new Prng('hc'), 'TST');
    const fans = generateFanBase(new Prng('f'), MarketSize.MEDIUM, FranchiseHistory.PERENNIAL_CONTENDER);

    const tpLow = computeTeamPersonality(lowPatienceOwner, gm, hc, fans);
    const tpHigh = computeTeamPersonality(highPatienceOwner, gm, hc, fans);

    // High-patience owner pushes team patience up; low pulls it down.
    expect(tpHigh.patienceLevel).toBeGreaterThan(tpLow.patienceLevel);
    // Owner contributes 50%; a 9-point spectrum delta at 50% weight
    // should produce at least a 4.5-point team-personality delta.
    expect(tpHigh.patienceLevel - tpLow.patienceLevel).toBeGreaterThan(4);
  });

  it('owner involvement and ego both reduce organizational stability', () => {
    const baseOwner = generateOwner(new Prng('base'), 'TST');
    const stableOwner = {
      ...baseOwner,
      spectrums: { ...baseOwner.spectrums, involvement: 1, ego: 1, patience: 10 },
    };
    const unstableOwner = {
      ...baseOwner,
      spectrums: { ...baseOwner.spectrums, involvement: 10, ego: 10, patience: 1 },
    };
    const gm = generateGm(new Prng('gm'), 'TST');
    const hc = generateHeadCoach(new Prng('hc'), 'TST');
    const fans = generateFanBase(new Prng('f'), MarketSize.MEDIUM, FranchiseHistory.PERENNIAL_CONTENDER);

    const tpStable = computeTeamPersonality(stableOwner, gm, hc, fans);
    const tpUnstable = computeTeamPersonality(unstableOwner, gm, hc, fans);

    expect(tpStable.organizationalStability).toBeGreaterThan(tpUnstable.organizationalStability);
  });
});
