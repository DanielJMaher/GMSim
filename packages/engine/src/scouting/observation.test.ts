import { describe, expect, it } from 'vitest';
import { Prng } from '../prng/index.js';
import { generateInitialObservations } from './observation.js';
import { composedQuirkEffect } from './quirks.js';
import type { Scout } from '../types/scout.js';
import type { Player, PlayerSkills } from '../types/player.js';
import type { TeamState } from '../types/team.js';
import { ScoutId, PlayerId, TeamId, OwnerId, GmId, CoachId } from '../types/ids.js';
import { PositionGroup, Position, Conference, Division, MarketSize, FranchiseHistory, CompetitiveWindow } from '../types/enums.js';
import { createLeague } from '../league/generate.js';

function makeScout(overrides: Partial<Scout> = {}): Scout {
  return {
    id: ScoutId('SCOUT_T'),
    name: 'Test Scout',
    age: 40,
    yearsExperience: 12,
    knownSpecialty: PositionGroup.SKILL,
    trueAccuracy: {
      QB: 0.6,
      SKILL: 0.6,
      OL: 0.6,
      DL: 0.6,
      LB: 0.6,
      DB: 0.6,
      ST: 0.6,
    },
    quirks: [],
    ...overrides,
  };
}

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: PlayerId('P_T'),
    firstName: 'Test',
    lastName: 'Player',
    position: Position.WR,
    positionGroup: PositionGroup.SKILL,
    experienceYears: 4,
    birthDate: '1998-01-01',
    teamId: TeamId('OTHER'),
    contractId: null,
    current: filledSkills(70),
    ceiling: filledSkills(80),
    developmentArchetype: 'FAST_LEARNER',
    tier: 'STARTER',
    archetype: 'WR_POSSESSION',
    injury: null,
    conditioning: 80,
    tradeRequestedOnTick: null,
    moodProfile: { archetype: 'normal', setPoint: 70, volatility: 3, resilience: 0.5 },
    mood: 70,
    careerStats: [],
    careerAwards: [],
    draftRound: 3,
    draftOverallPick: 80,
    heightInches: 73,
    weightLbs: 210,
    armLengthInches: 32,
    handSizeInches: 9.5,
    ...overrides,
  };
}

function filledSkills(v: number): PlayerSkills {
  return {
    speed: v,
    acceleration: v,
    agility: v,
    strength: v,
    durability: v,
    technicalSkill: v,
    footballIq: v,
    decisionMaking: v,
    handsBallSkills: v,
    blockingTechnique: v,
    passRushTechnique: v,
    coverageTechnique: v,
    tacklingTechnique: v,
    leadership: v,
    competitiveness: v,
    workEthic: v,
    coachability: v,
    composure: v,
  };
}

function makeTeam(id: string, rosterIds: readonly string[]): TeamState {
  return {
    identity: {
      id: TeamId(id),
      abbreviation: id,
      location: 'Test',
      nickname: 'Squad',
      fullName: `Test ${id}`,
      conference: Conference.AFC,
      division: Division.AFC_EAST,
      marketSize: MarketSize.MEDIUM,
    },
    ownerId: OwnerId(`O_${id}`),
    gmId: GmId(`GM_${id}`),
    headCoachId: CoachId(`HC_${id}`),
    scoutIds: [],
    rosterIds: rosterIds.map((p) => PlayerId(p)),
    injuredReserveIds: [],
    practiceSquadIds: [],
    deadMoneyByYear: [],
    franchiseHistory: FranchiseHistory.SLEEPING_GIANT,
    fanBase: {
      patience: 5,
      expectations: 5,
      marketRelationship: 5,
      culturalDepth: 5,
      mediaMarketScale: 5,
    },
    competitiveWindow: CompetitiveWindow.STAGNANT,
    seasonHistory: [],
  };
}

describe('generateInitialObservations', () => {
  it('does not produce observations of the scout\'s own team players', () => {
    const player = makePlayer({ id: PlayerId('OWN_1'), teamId: TeamId('OWN') });
    const otherPlayer = makePlayer({ id: PlayerId('OTHER_1'), teamId: TeamId('OTHER') });
    const teams = {
      [TeamId('OWN')]: makeTeam('OWN', ['OWN_1']),
      [TeamId('OTHER')]: makeTeam('OTHER', ['OTHER_1']),
    } as Readonly<Record<TeamId, TeamState>>;
    const scout = makeScout({ id: ScoutId('S1') });
    const scoutsByTeam = {
      [TeamId('OWN')]: [scout],
      [TeamId('OTHER')]: [],
    } as Readonly<Record<TeamId, readonly Scout[]>>;

    const obs = generateInitialObservations(
      new Prng('seed'),
      teams,
      scoutsByTeam,
      { OWN_1: player, OTHER_1: otherPlayer },
      0,
    );

    for (const o of obs) {
      expect(o.playerId).not.toBe(player.id);
    }
  });

  it('noise stdev shrinks as accuracy approaches 1', () => {
    // Build a synthetic 2-team league: scout on team A, players on
    // team B with known ratings. Then compare observation MAD between
    // a low-accuracy scout and a high-accuracy scout.
    const players: Record<string, Player> = {};
    const teamBRoster: string[] = [];
    for (let i = 0; i < 30; i++) {
      const id = `B_${i}`;
      players[id] = makePlayer({ id: PlayerId(id), teamId: TeamId('B') });
      teamBRoster.push(id);
    }
    const teams = {
      [TeamId('A')]: makeTeam('A', []),
      [TeamId('B')]: makeTeam('B', teamBRoster),
    } as Readonly<Record<TeamId, TeamState>>;

    const lowAcc = makeScout({
      id: ScoutId('LOW'),
      trueAccuracy: { QB: 0.2, SKILL: 0.2, OL: 0.2, DL: 0.2, LB: 0.2, DB: 0.2, ST: 0.2 },
    });
    const highAcc = makeScout({
      id: ScoutId('HIGH'),
      trueAccuracy: { QB: 0.9, SKILL: 0.9, OL: 0.9, DL: 0.9, LB: 0.9, DB: 0.9, ST: 0.9 },
    });

    const lowMad = mad(
      generateInitialObservations(
        new Prng('low'),
        teams,
        {
          [TeamId('A')]: [lowAcc],
          [TeamId('B')]: [],
        } as Readonly<Record<TeamId, readonly Scout[]>>,
        players,
        0,
      ),
      players,
    );
    const highMad = mad(
      generateInitialObservations(
        new Prng('high'),
        teams,
        {
          [TeamId('A')]: [highAcc],
          [TeamId('B')]: [],
        } as Readonly<Record<TeamId, readonly Scout[]>>,
        players,
        0,
      ),
      players,
    );

    expect(highMad).toBeLessThan(lowMad);
  });

  it('is deterministic for the same seed', () => {
    const player = makePlayer({ id: PlayerId('B_1'), teamId: TeamId('B') });
    const teams = {
      [TeamId('A')]: makeTeam('A', []),
      [TeamId('B')]: makeTeam('B', ['B_1']),
    } as Readonly<Record<TeamId, TeamState>>;
    const scout = makeScout({ id: ScoutId('S1') });
    const scoutsByTeam = {
      [TeamId('A')]: [scout],
      [TeamId('B')]: [],
    } as Readonly<Record<TeamId, readonly Scout[]>>;

    const a = generateInitialObservations(new Prng('seed'), teams, scoutsByTeam, { B_1: player }, 0);
    const b = generateInitialObservations(new Prng('seed'), teams, scoutsByTeam, { B_1: player }, 0);
    expect(a).toEqual(b);
  });
});

function mad(observations: ReturnType<typeof generateInitialObservations>, players: Record<string, Player>): number {
  let sum = 0;
  let count = 0;
  for (const o of observations) {
    const p = players[o.playerId];
    if (!p) continue;
    for (const [skill, value] of Object.entries(o.skills) as [keyof PlayerSkills, number][]) {
      sum += Math.abs(value - p.current[skill]);
      count++;
    }
  }
  return count === 0 ? 0 : sum / count;
}

describe('composedQuirkEffect', () => {
  it('OVERVALUES_NAME_RECOGNITION biases upward for award-winners', () => {
    const award = makePlayer({
      careerAwards: [{ kind: 'MVP', seasonNumber: 1 }],
    });
    const noAward = makePlayer({ careerAwards: [] });
    const eAward = composedQuirkEffect(['OVERVALUES_NAME_RECOGNITION'], award, 'speed');
    const eNoAward = composedQuirkEffect(['OVERVALUES_NAME_RECOGNITION'], noAward, 'speed');
    expect(eAward.bias).toBeGreaterThan(0);
    expect(eNoAward.bias).toBe(0);
  });

  it('SHARP_ON_ROLE_PLAYERS sharpens estimates on backups, blurs on stars', () => {
    const backup = makePlayer({ tier: 'BACKUP' });
    const star = makePlayer({ tier: 'STAR' });
    const eBackup = composedQuirkEffect(['SHARP_ON_ROLE_PLAYERS'], backup, 'speed');
    const eStar = composedQuirkEffect(['SHARP_ON_ROLE_PLAYERS'], star, 'speed');
    expect(eBackup.noiseMultiplier).toBeLessThan(1);
    expect(eStar.noiseMultiplier).toBeGreaterThan(1);
  });

  it('MISSES_SCHEME_FIT only blurs technique skills', () => {
    const player = makePlayer();
    const technique = composedQuirkEffect(['MISSES_SCHEME_FIT'], player, 'blockingTechnique');
    const nonTechnique = composedQuirkEffect(['MISSES_SCHEME_FIT'], player, 'speed');
    expect(technique.noiseMultiplier).toBeGreaterThan(1);
    expect(nonTechnique.noiseMultiplier).toBe(1);
  });
});

describe('createLeague — scouting integration', () => {
  it('populates scouts and observations deterministically', () => {
    const a = createLeague({ seed: 'scout-smoke' });
    const b = createLeague({ seed: 'scout-smoke' });

    const scoutsA = Object.values(a.scouts);
    expect(scoutsA.length).toBeGreaterThanOrEqual(32 * 3);
    expect(scoutsA.length).toBeLessThanOrEqual(32 * 5);

    expect(a.observations.length).toBeGreaterThan(0);
    expect(a.observations.length).toBe(b.observations.length);
    // Determinism — same seed → identical observation values for the
    // first record (snapshot via toEqual on the array head).
    expect(a.observations[0]).toEqual(b.observations[0]);

    // Each team has 3-5 scoutIds, sourced from the league directory.
    for (const team of Object.values(a.teams)) {
      expect(team.scoutIds.length).toBeGreaterThanOrEqual(3);
      expect(team.scoutIds.length).toBeLessThanOrEqual(5);
      for (const sid of team.scoutIds) {
        expect(a.scouts[sid]).toBeDefined();
      }
    }
  });

  it('scouts do not observe players on their own team', () => {
    const league = createLeague({ seed: 'no-self' });
    const scoutTeam = new Map<string, string>();
    for (const team of Object.values(league.teams)) {
      for (const sid of team.scoutIds) scoutTeam.set(sid, team.identity.id);
    }
    for (const obs of league.observations) {
      const observedPlayer = league.players[obs.playerId];
      const scoutOwnerTeam = scoutTeam.get(obs.scoutId);
      if (!observedPlayer || !scoutOwnerTeam) continue;
      expect(observedPlayer.teamId).not.toBe(scoutOwnerTeam);
    }
  });
});
