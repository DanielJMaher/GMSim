import { describe, expect, it } from 'vitest';
import {
  computeChartModifiers,
  pickValueForTeam,
  NEUTRAL_MODIFIERS,
  QB_CURRENT_PICK_PREMIUM,
  type ChartModifiers,
} from './chart-modifiers.js';
import { Prng } from '../prng/index.js';
import { generateOwner } from '../personnel/owner.js';
import { generateGm } from '../personnel/gm.js';
import { generateHeadCoach } from '../personnel/hc.js';
import { generateFanBase } from '../personnel/fan-base.js';
import {
  CompetitiveWindow,
  MarketSize,
  FranchiseHistory,
  Conference,
  Division,
} from '../types/enums.js';
import type { TeamState } from '../types/team.js';
import type { Owner, Gm, HeadCoach } from '../types/personnel.js';
import { TeamId, OwnerId, GmId, CoachId } from '../types/ids.js';

function buildTeam(opts: {
  owner: Owner;
  gm: Gm;
  hc: HeadCoach;
  competitiveWindow: CompetitiveWindow;
}): TeamState {
  const fans = generateFanBase(
    new Prng('fan-seed'),
    MarketSize.MEDIUM,
    FranchiseHistory.PERENNIAL_CONTENDER,
  );
  return {
    identity: {
      id: TeamId('TEST'),
      name: 'Test',
      abbreviation: 'TST',
      city: 'Test City',
      conference: Conference.AFC,
      division: Division.AFC_EAST,
      marketSize: MarketSize.MEDIUM,
    },
    ownerId: opts.owner.id,
    gmId: opts.gm.id,
    headCoachId: opts.hc.id,
    scoutIds: [],
    collegeScoutIds: [],
    rosterIds: [],
    injuredReserveIds: [],
    practiceSquadIds: [],
    deadMoneyByYear: [],
    franchiseHistory: FranchiseHistory.PERENNIAL_CONTENDER,
    fanBase: fans,
    competitiveWindow: opts.competitiveWindow,
    seasonHistory: [],
  };
}

function records<T extends { id: { toString(): string } }>(...items: T[]) {
  return Object.fromEntries(items.map((x) => [x.id, x]));
}

describe('pickValueForTeam', () => {
  it('reproduces the base chart value at neutral modifiers', () => {
    expect(pickValueForTeam(10000, NEUTRAL_MODIFIERS, 0, false)).toBe(10000);
    expect(pickValueForTeam(5000, NEUTRAL_MODIFIERS, 1, false)).toBe(5000);
  });

  it('inflates current-pick value when target is a QB', () => {
    const v = pickValueForTeam(10000, NEUTRAL_MODIFIERS, 0, true);
    expect(v).toBe(10000 * QB_CURRENT_PICK_PREMIUM);
  });

  it('does NOT apply the QB premium to future picks (sweetener)', () => {
    const v = pickValueForTeam(5000, NEUTRAL_MODIFIERS, 1, true);
    // No QB premium for future picks — they're compensation, not the
    // asset that lands the QB.
    expect(v).toBe(5000);
  });

  it('scales current and future picks independently', () => {
    const m: ChartModifiers = { currentMultiplier: 1.2, futureMultiplier: 0.6 };
    expect(pickValueForTeam(1000, m, 0, false)).toBeCloseTo(1200);
    expect(pickValueForTeam(1000, m, 1, false)).toBeCloseTo(600);
  });
});

describe('computeChartModifiers', () => {
  it('returns NEUTRAL when an organizational reference is missing', () => {
    const owner = generateOwner(new Prng('o'), 'TST');
    const gm = generateGm(new Prng('g'), 'TST');
    const hc = generateHeadCoach(new Prng('h'), 'TST');
    const team = buildTeam({ owner, gm, hc, competitiveWindow: CompetitiveWindow.EMERGING });
    const result = computeChartModifiers(team, {}, records(gm), records(hc));
    expect(result).toBe(NEUTRAL_MODIFIERS);
  });

  it('CHAMPIONSHIP window inflates current and deflates future', () => {
    const owner = generateOwner(new Prng('champ-o'), 'TST');
    const gm = generateGm(new Prng('champ-g'), 'TST');
    const hc = generateHeadCoach(new Prng('champ-h'), 'TST');
    const team = buildTeam({
      owner,
      gm,
      hc,
      competitiveWindow: CompetitiveWindow.CHAMPIONSHIP,
    });
    const m = computeChartModifiers(team, records(owner), records(gm), records(hc));
    expect(m.currentMultiplier).toBeGreaterThan(1.0);
    expect(m.futureMultiplier).toBeLessThan(0.85);
  });

  it('REBUILDING window inflates future and deflates current', () => {
    const owner = generateOwner(new Prng('reb-o'), 'TST');
    const gm = generateGm(new Prng('reb-g'), 'TST');
    const hc = generateHeadCoach(new Prng('reb-h'), 'TST');
    const team = buildTeam({
      owner,
      gm,
      hc,
      competitiveWindow: CompetitiveWindow.REBUILDING,
    });
    const m = computeChartModifiers(team, records(owner), records(gm), records(hc));
    expect(m.futureMultiplier).toBeGreaterThan(1.1);
    expect(m.currentMultiplier).toBeLessThan(1.0);
  });

  it('RING_CHASER + high legacyMotivation amplifies future-pick deflation', () => {
    // Build two owners identical except quirks + legacyMotivation.
    const baseOwner = generateOwner(new Prng('base-o'), 'TST');
    const ringChaser: Owner = {
      ...baseOwner,
      quirks: ['RING_CHASER'],
      spectrums: { ...baseOwner.spectrums, legacyMotivation: 10 },
    };
    const tepid: Owner = {
      ...baseOwner,
      quirks: [],
      spectrums: { ...baseOwner.spectrums, legacyMotivation: 5 },
    };
    const gm = generateGm(new Prng('rc-g'), 'TST');
    const hc = generateHeadCoach(new Prng('rc-h'), 'TST');
    const ringChaserTeam = buildTeam({
      owner: ringChaser,
      gm,
      hc,
      competitiveWindow: CompetitiveWindow.EMERGING,
    });
    const tepidTeam = buildTeam({
      owner: tepid,
      gm,
      hc,
      competitiveWindow: CompetitiveWindow.EMERGING,
    });
    const mRing = computeChartModifiers(
      ringChaserTeam,
      records(ringChaser),
      records(gm),
      records(hc),
    );
    const mTepid = computeChartModifiers(
      tepidTeam,
      records(tepid),
      records(gm),
      records(hc),
    );
    expect(mRing.futureMultiplier).toBeLessThan(mTepid.futureMultiplier);
    expect(mRing.currentMultiplier).toBeGreaterThan(mTepid.currentMultiplier);
  });

  it('REBUILDING + patient owner stack into a strong future premium', () => {
    const baseOwner = generateOwner(new Prng('pat-o'), 'TST');
    const patientOwner: Owner = {
      ...baseOwner,
      spectrums: { ...baseOwner.spectrums, patience: 10, legacyMotivation: 3 },
    };
    const gm = generateGm(new Prng('pat-g'), 'TST');
    const hc = generateHeadCoach(new Prng('pat-h'), 'TST');
    const team = buildTeam({
      owner: patientOwner,
      gm,
      hc,
      competitiveWindow: CompetitiveWindow.REBUILDING,
    });
    const m = computeChartModifiers(
      team,
      records(patientOwner),
      records(gm),
      records(hc),
    );
    // Patient-rebuilder is the strongest "future picks premium" configuration
    // available in slice 1. Should be meaningfully > REBUILDING alone (~1.25).
    expect(m.futureMultiplier).toBeGreaterThan(1.25);
  });

  it('produces wide spread across CompetitiveWindow values for same personnel', () => {
    const owner = generateOwner(new Prng('spread-o'), 'TST');
    const gm = generateGm(new Prng('spread-g'), 'TST');
    const hc = generateHeadCoach(new Prng('spread-h'), 'TST');
    const make = (cw: CompetitiveWindow) =>
      computeChartModifiers(
        buildTeam({ owner, gm, hc, competitiveWindow: cw }),
        records(owner),
        records(gm),
        records(hc),
      );
    const champ = make(CompetitiveWindow.CHAMPIONSHIP);
    const reb = make(CompetitiveWindow.REBUILDING);
    // Championship vs Rebuilding should produce a meaningful current-pick
    // multiplier delta — exploitability of the asymmetry is the point.
    expect(champ.currentMultiplier - reb.currentMultiplier).toBeGreaterThan(0.2);
    expect(reb.futureMultiplier - champ.futureMultiplier).toBeGreaterThan(0.4);
  });
});
