import { describe, expect, it } from 'vitest';
import {
  computeChartModifiers,
  pickValueForTeam,
  qbPremiumForGm,
  NEUTRAL_MODIFIERS,
  QB_CURRENT_PICK_PREMIUM,
  type ChartModifiers,
} from './chart-modifiers.js';
import type { TeamSeasonRecord } from '../types/team.js';
import type { Gm } from '../types/personnel.js';
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

function losingSeason(seasonNumber: number): TeamSeasonRecord {
  return {
    seasonNumber,
    wins: 5,
    losses: 12,
    ties: 0,
    divisionFinish: 4,
    madePlayoffs: false,
  };
}

function winningSeason(seasonNumber: number): TeamSeasonRecord {
  return {
    seasonNumber,
    wins: 11,
    losses: 6,
    ties: 0,
    divisionFinish: 1,
    madePlayoffs: true,
  };
}

function buildTeam(opts: {
  owner: Owner;
  gm: Gm;
  hc: HeadCoach;
  competitiveWindow: CompetitiveWindow;
  seasonHistory?: readonly TeamSeasonRecord[];
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
    seasonHistory: opts.seasonHistory ?? [],
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

describe('hot-seat HC modifier (v0.49)', () => {
  it('triggers from 3 consecutive sub-.500 seasons', () => {
    const owner = generateOwner(new Prng('hs-o'), 'TST');
    const gm = generateGm(new Prng('hs-g'), 'TST');
    const hc = generateHeadCoach(new Prng('hs-h'), 'TST');
    const losingHistory: TeamSeasonRecord[] = [1, 2, 3].map((n) => losingSeason(n));
    const noHistoryTeam = buildTeam({
      owner,
      gm,
      hc,
      competitiveWindow: CompetitiveWindow.EMERGING,
      seasonHistory: [],
    });
    const hotSeatTeam = buildTeam({
      owner,
      gm,
      hc,
      competitiveWindow: CompetitiveWindow.EMERGING,
      seasonHistory: losingHistory,
    });
    const baseline = computeChartModifiers(noHistoryTeam, records(owner), records(gm), records(hc));
    const hotSeat = computeChartModifiers(hotSeatTeam, records(owner), records(gm), records(hc));
    expect(hotSeat.currentMultiplier).toBeGreaterThan(baseline.currentMultiplier);
    expect(hotSeat.futureMultiplier).toBeLessThan(baseline.futureMultiplier);
  });

  it('does NOT trigger when last 3 seasons mix wins and losses', () => {
    const owner = generateOwner(new Prng('hs-mix-o'), 'TST');
    const gm = generateGm(new Prng('hs-mix-g'), 'TST');
    const hc = generateHeadCoach(new Prng('hs-mix-h'), 'TST');
    const mixed: TeamSeasonRecord[] = [losingSeason(1), winningSeason(2), losingSeason(3)];
    const team = buildTeam({
      owner,
      gm,
      hc,
      competitiveWindow: CompetitiveWindow.EMERGING,
      seasonHistory: mixed,
    });
    const noHistTeam = buildTeam({
      owner,
      gm,
      hc,
      competitiveWindow: CompetitiveWindow.EMERGING,
      seasonHistory: [],
    });
    const mixedMod = computeChartModifiers(team, records(owner), records(gm), records(hc));
    const baseline = computeChartModifiers(noHistTeam, records(owner), records(gm), records(hc));
    // Mixed history should NOT trigger hot-seat overlay — same modifiers as no history.
    expect(mixedMod.currentMultiplier).toBe(baseline.currentMultiplier);
    expect(mixedMod.futureMultiplier).toBe(baseline.futureMultiplier);
  });

  it('does NOT trigger with only 2 consecutive losing seasons', () => {
    const owner = generateOwner(new Prng('hs-2-o'), 'TST');
    const gm = generateGm(new Prng('hs-2-g'), 'TST');
    const hc = generateHeadCoach(new Prng('hs-2-h'), 'TST');
    const twoLosing: TeamSeasonRecord[] = [losingSeason(1), losingSeason(2)];
    const team = buildTeam({
      owner,
      gm,
      hc,
      competitiveWindow: CompetitiveWindow.EMERGING,
      seasonHistory: twoLosing,
    });
    const noHistTeam = buildTeam({
      owner,
      gm,
      hc,
      competitiveWindow: CompetitiveWindow.EMERGING,
      seasonHistory: [],
    });
    const twoMod = computeChartModifiers(team, records(owner), records(gm), records(hc));
    const baseline = computeChartModifiers(noHistTeam, records(owner), records(gm), records(hc));
    expect(twoMod.currentMultiplier).toBe(baseline.currentMultiplier);
    expect(twoMod.futureMultiplier).toBe(baseline.futureMultiplier);
  });
});

describe('qbPremiumForGm (v0.49)', () => {
  it('returns Doc 5 range (1.20-1.50) across patience spectrum', () => {
    const baseGm = generateGm(new Prng('qb-g'), 'TST');
    const desperate: Gm = {
      ...baseGm,
      spectrums: { ...baseGm.spectrums, patienceUnderPressure: 1 },
    };
    const patient: Gm = {
      ...baseGm,
      spectrums: { ...baseGm.spectrums, patienceUnderPressure: 10 },
    };
    const midPatient: Gm = {
      ...baseGm,
      spectrums: { ...baseGm.spectrums, patienceUnderPressure: 5 },
    };
    const pDes = qbPremiumForGm(desperate);
    const pMid = qbPremiumForGm(midPatient);
    const pPat = qbPremiumForGm(patient);
    expect(pDes).toBeCloseTo(1.5, 2);
    expect(pPat).toBeLessThan(pDes);
    expect(pMid).toBeGreaterThan(pPat);
    expect(pMid).toBeLessThan(pDes);
    // Whole range stays inside Doc 5's 25-50% band (1.20-1.50).
    expect(pPat).toBeGreaterThanOrEqual(1.2);
    expect(pDes).toBeLessThanOrEqual(1.5);
  });

  it('pickValueForTeam honors a per-team QB premium override', () => {
    const m: ChartModifiers = NEUTRAL_MODIFIERS;
    const base = 10000;
    const desperate = pickValueForTeam(base, m, 0, true, 1.5);
    const patient = pickValueForTeam(base, m, 0, true, 1.2);
    const flat = pickValueForTeam(base, m, 0, true);
    expect(desperate).toBe(base * 1.5);
    expect(patient).toBe(base * 1.2);
    expect(flat).toBe(base * QB_CURRENT_PICK_PREMIUM);
  });
});
