import { describe, expect, it } from 'vitest';
import { Prng } from '../prng/index.js';
import {
  generateCollegeObservation,
  generateInitialCollegeObservations,
} from './college-observation.js';
import { generateCollegePlayer } from './generate-college-player.js';
import { generateInitialCollegePool } from './pool.js';
import { generateCollegeScout, generateTeamCollegeScouts } from './college-scout.js';
import { advanceCollegeScoutingCycle } from './college-cycle.js';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from '../season/runner.js';
import { advanceSeason } from '../season/advance.js';
import { getSchoolById } from '../data/colleges/index.js';
import type { Owner, Gm } from '../types/personnel.js';
import type { CollegeScout } from '../types/college.js';
import { OwnerId, GmId, TeamId } from '../types/ids.js';
import { PositionGroup, Position } from '../types/enums.js';
import { positionGroupFor } from '../players/position-group.js';

const ALABAMA = getSchoolById('ALABAMA')!;

function owner(financialCommitment: number): Owner {
  return {
    id: OwnerId('OWNER_T'),
    name: 'Test',
    spectrums: {
      involvement: 5, patience: 5, financialCommitment, footballKnowledge: 5,
      legacyMotivation: 5, fanConnection: 5, riskTolerance: 5, ego: 5,
    },
    quirks: [],
    personality: { decisiveness: 5, charisma: 5, emotionalStability: 5, communicativeness: 5 },
  };
}

function gm(): Gm {
  return {
    id: GmId('GM_T'),
    name: 'Test',
    spectrums: {
      analyticsReliance: 5, tradeAggressiveness: 5, draftConviction: 5,
      freeAgencyDiscipline: 5, capManagement: 5, patienceUnderPressure: 5,
      talentEvaluationAccuracy: 5, intangiblesWeighting: 5, evolutionRate: 5,
      relationshipQuality: 5,
    },
    positionalBias: { position: 'QB' as never, bias: 1 },
    quirks: [],
    personality: { decisiveness: 5, charisma: 5, emotionalStability: 5, communicativeness: 5 },
  };
}

describe('generateCollegeObservation', () => {
  it('is deterministic for the same seed', () => {
    const scout = generateCollegeScout(new Prng('scout'), 'X', 0.6);
    const prospect = generateCollegePlayer(new Prng('prospect'), {
      idSuffix: 'P', classYear: 'JR', school: ALABAMA, simYear: 2026,
    });
    const a = generateCollegeObservation(new Prng('obs'), scout, prospect, 0);
    const b = generateCollegeObservation(new Prng('obs'), scout, prospect, 0);
    expect(a).toEqual(b);
  });

  it('attributes the observation to scout + prospect + tick', () => {
    const scout = generateCollegeScout(new Prng('s'), 'X', 0.6);
    const prospect = generateCollegePlayer(new Prng('p'), {
      idSuffix: 'P', classYear: 'JR', school: ALABAMA, simYear: 2026,
    });
    const obs = generateCollegeObservation(new Prng('o'), scout, prospect, 42);
    expect(obs.scoutId).toBe(scout.id);
    expect(obs.collegePlayerId).toBe(prospect.id);
    expect(obs.observedOnTick).toBe(42);
  });

  it('per-skill confidence is 0..1 and skills are 0..100', () => {
    const scout = generateCollegeScout(new Prng('s'), 'X', 0.6);
    const prospect = generateCollegePlayer(new Prng('p'), {
      idSuffix: 'P', classYear: 'JR', school: ALABAMA, simYear: 2026,
    });
    const obs = generateCollegeObservation(new Prng('o'), scout, prospect, 0);
    for (const v of Object.values(obs.skills)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    for (const c of Object.values(obs.confidence)) {
      expect(c as number).toBeGreaterThanOrEqual(0);
      expect(c as number).toBeLessThanOrEqual(1);
    }
  });

  it('higher accuracy → tighter observation distribution around truth', () => {
    // Run many observations from a low-accuracy and high-accuracy scout
    // on the same prospect, measure mean error against truth on a single
    // skill.
    const prospect = generateCollegePlayer(new Prng('truth'), {
      idSuffix: 'T', classYear: 'JR', school: ALABAMA, simYear: 2026,
    });
    const truth = prospect.current.speed;
    let lowErr = 0, highErr = 0;
    const SAMPLES = 80;
    for (let i = 0; i < SAMPLES; i++) {
      const lowScout: CollegeScout = {
        ...generateCollegeScout(new Prng(`l-${i}`), 'L', 0.5),
        trueAccuracy: makeAccuracy(0.30),
      };
      const highScout: CollegeScout = {
        ...generateCollegeScout(new Prng(`h-${i}`), 'H', 0.95),
        trueAccuracy: makeAccuracy(0.95),
      };
      const lo = generateCollegeObservation(new Prng(`lo-${i}`), lowScout, prospect, 0);
      const hi = generateCollegeObservation(new Prng(`ho-${i}`), highScout, prospect, 0);
      lowErr += Math.abs((lo.skills.speed ?? 0) - truth);
      highErr += Math.abs((hi.skills.speed ?? 0) - truth);
    }
    expect(highErr / SAMPLES).toBeLessThan(lowErr / SAMPLES);
  });
});

function makeAccuracy(value: number): Readonly<Record<PositionGroup, number>> {
  const acc: Record<PositionGroup, number> = {} as Record<PositionGroup, number>;
  for (const g of Object.values(PositionGroup)) acc[g] = value;
  return acc;
}

describe('generateInitialCollegeObservations', () => {
  it('produces observations distributed across teams', () => {
    const teamA = generateTeamCollegeScouts(new Prng('A'), 'A', owner(8), gm());
    const teamB = generateTeamCollegeScouts(new Prng('B'), 'B', owner(8), gm());
    const pool = generateInitialCollegePool(new Prng('pool'));
    const observations = generateInitialCollegeObservations(
      new Prng('obs'),
      { ['A_TEAM' as TeamId]: teamA, ['B_TEAM' as TeamId]: teamB } as Readonly<Record<TeamId, readonly CollegeScout[]>>,
      pool,
      0,
    );
    expect(observations.length).toBeGreaterThan(0);
    const scoutIds = new Set(observations.map((o) => o.scoutId));
    expect(scoutIds.size).toBeGreaterThanOrEqual(teamA.length); // at least every team A scout filed something
  });

  it('scouts evaluate prospects in their projected NFL position group', () => {
    const teamA = generateTeamCollegeScouts(new Prng('A'), 'A', owner(8), gm());
    const pool = generateInitialCollegePool(new Prng('pool'));
    const observations = generateInitialCollegeObservations(
      new Prng('obs-pg'),
      { ['A_TEAM' as TeamId]: teamA } as Readonly<Record<TeamId, readonly CollegeScout[]>>,
      pool,
      0,
    );
    const scoutById = new Map(teamA.map((s) => [s.id, s]));
    const prospectById = new Map(pool.map((p) => [p.id, p]));
    for (const obs of observations) {
      const scout = scoutById.get(obs.scoutId);
      const prospect = prospectById.get(obs.collegePlayerId);
      if (!scout || !prospect) continue;
      const projGroup = positionGroupFor(prospect.nflProjectedPosition);
      expect(projGroup).toBe(scout.knownSpecialty);
    }
  });

  it('regional bias — most observations are in scout preferred region', () => {
    // Build a single SOUTHEAST-only scout staff and check that it
    // disproportionately observes prospects from SE states.
    const seScout: CollegeScout = {
      ...generateCollegeScout(new Prng('se'), 'SE', 0.7),
      preferredRegion: 'SOUTHEAST',
      knownSpecialty: PositionGroup.SKILL,
    };
    const pool = generateInitialCollegePool(new Prng('pool'));
    const obs = generateInitialCollegeObservations(
      new Prng('o'),
      { ['T' as TeamId]: [seScout] } as Readonly<Record<TeamId, readonly CollegeScout[]>>,
      pool,
      0,
    );
    let inRegion = 0, total = 0;
    const SE_STATES = new Set(['AL', 'FL', 'GA', 'MS', 'NC', 'SC', 'TN', 'VA', 'WV']);
    for (const o of obs) {
      total++;
      const cp = pool.find((p) => p.id === o.collegePlayerId);
      if (!cp) continue;
      const homeIn = SE_STATES.has(cp.recruiting.hometown.state);
      const schoolIn = SE_STATES.has(getSchoolById(cp.schoolId)?.state ?? '');
      if (homeIn || schoolIn) inRegion++;
    }
    if (total === 0) return;
    expect(inRegion / total).toBeGreaterThan(0.5);
  });
});

describe('advanceCollegeScoutingCycle (integration)', () => {
  it('advanceSeason produces additional college observations each cycle', () => {
    const league = createLeague({ seed: 'cycle-int' });
    const initialObsCount = league.collegeObservations.length;
    expect(initialObsCount).toBeGreaterThan(0);

    const played = simulateSeason(league);
    const after = advanceSeason(played);

    expect(after.collegeObservations.length).toBeGreaterThan(initialObsCount);
  });

  it('createLeague populates collegeScouts and collegeObservations', () => {
    const league = createLeague({ seed: 'init-int' });
    const scoutCount = Object.keys(league.collegeScouts).length;
    expect(scoutCount).toBeGreaterThanOrEqual(32 * 10);
    expect(scoutCount).toBeLessThanOrEqual(32 * 15);
    expect(league.collegeObservations.length).toBeGreaterThan(0);
    // Each team has between 10 and 15 college scout IDs on the team record.
    for (const team of Object.values(league.teams)) {
      expect(team.collegeScoutIds.length).toBeGreaterThanOrEqual(10);
      expect(team.collegeScoutIds.length).toBeLessThanOrEqual(15);
    }
  });

  it('migration backfills collegeScouts on a save without them', () => {
    const league = createLeague({ seed: 'mig' });
    const stripped = { ...league } as typeof league & {
      collegeScouts?: typeof league.collegeScouts;
      collegeObservations?: typeof league.collegeObservations;
    };
    delete stripped.collegeScouts;
    delete stripped.collegeObservations;
    const played = simulateSeason(stripped as typeof league);
    expect(Object.keys(played.collegeScouts).length).toBeGreaterThan(0);
    expect(played.collegeObservations.length).toBeGreaterThan(0);
  });

  it('CSCOUT_ ids do not collide with NFL SCOUT_ ids', () => {
    const league = createLeague({ seed: 'no-collide' });
    const overlap = Object.keys(league.collegeScouts).find((id) =>
      league.scouts[id as keyof typeof league.scouts] !== undefined,
    );
    expect(overlap).toBeUndefined();
  });
});

void Position; // imported for parity but not directly asserted on here
