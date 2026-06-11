import { describe, it, expect } from 'vitest';
import { Prng } from '../prng/index.js';
import {
  advancePlayerDevelopment,
  computePerformanceMultipliers,
} from './development.js';
import { createLeague } from '../league/generate.js';
import type { Player } from '../types/player.js';
import type { LeagueState } from '../types/league.js';
import type { PlayerSeasonStats } from '../types/stats.js';
import { PlayerId } from '../types/ids.js';
import { Position, PositionGroup } from '../types/enums.js';

describe('computePerformanceMultipliers', () => {
  function statsFor(playerId: string, overrides: Partial<PlayerSeasonStats> = {}): PlayerSeasonStats {
    return {
      playerId: PlayerId(playerId),
      gamesPlayed: 17,
      passAttempts: 0,
      passCompletions: 0,
      passingYards: 0,
      passingTds: 0,
      interceptionsThrown: 0,
      rushingAttempts: 0,
      rushingYards: 0,
      rushingTds: 0,
      targets: 0,
      receptions: 0,
      receivingYards: 0,
      receivingTds: 0,
      tackles: 0,
      sacks: 0,
      interceptions: 0,
      ...overrides,
    };
  }

  it('great-season player gets the 1.30 multiplier', () => {
    // Build a synthetic league with a small set of stat-recording players,
    // one of whom dominates their position group.
    const league = createLeague({ seed: 'perf-mult-great' });
    const allPlayers = Object.values(league.players);
    const wrs = allPlayers.filter((p) => p.position === Position.WR);
    expect(wrs.length).toBeGreaterThan(5); // sanity

    const stats = new Map<ReturnType<typeof PlayerId>, PlayerSeasonStats>();
    // Average WR season: ~600 yards, 3 TDs.
    for (let i = 0; i < 5; i++) {
      stats.set(
        wrs[i]!.id,
        statsFor(wrs[i]!.id, { receivingYards: 600, receivingTds: 3 }),
      );
    }
    // Standout: 1500 yards, 12 TDs. Score = 1500 + 600 = 2100; median = 600 + 150 = 750.
    const standoutId = wrs[5]!.id;
    stats.set(standoutId, statsFor(standoutId, { receivingYards: 1500, receivingTds: 12 }));

    const multipliers = computePerformanceMultipliers(league, stats);
    expect(multipliers.get(standoutId)).toBe(1.3);
  });

  it('average-season player lands at the 1.0 multiplier', () => {
    const league = createLeague({ seed: 'perf-mult-avg' });
    const wrs = Object.values(league.players).filter((p) => p.position === Position.WR);
    const stats = new Map<ReturnType<typeof PlayerId>, PlayerSeasonStats>();
    for (const wr of wrs.slice(0, 10)) {
      stats.set(wr.id, statsFor(wr.id, { receivingYards: 700, receivingTds: 4 }));
    }
    const multipliers = computePerformanceMultipliers(league, stats);
    // Every WR is at the median — all neutral.
    for (const wr of wrs.slice(0, 10)) {
      expect(multipliers.get(wr.id)).toBe(1.0);
    }
  });

  it('collapse-season player gets the 0.85 multiplier (S4 extended range)', () => {
    const league = createLeague({ seed: 'perf-mult-poor' });
    const wrs = Object.values(league.players).filter((p) => p.position === Position.WR);
    const stats = new Map<ReturnType<typeof PlayerId>, PlayerSeasonStats>();
    // Five solid WRs and one struggler (far below the band).
    for (let i = 0; i < 5; i++) {
      stats.set(wrs[i]!.id, statsFor(wrs[i]!.id, { receivingYards: 800, receivingTds: 5 }));
    }
    const strugglerId = wrs[5]!.id;
    stats.set(strugglerId, statsFor(strugglerId, { receivingYards: 100, receivingTds: 0 }));
    const multipliers = computePerformanceMultipliers(league, stats);
    expect(multipliers.get(strugglerId)).toBe(0.85);
  });

  it('S4 residual: expectation is set by same-rating peers, not the whole group', () => {
    // At league scale (hundreds of SKILL players with stats), a low-rated
    // player producing modestly should be judged against his own band —
    // give every SKILL player a stat line proportional to rating, then one
    // bottom-band player a line 2x his band's: he reads as a breakout even
    // though he's below the GROUP median.
    const league = createLeague({ seed: 'perf-band' });
    const skills = Object.values(league.players)
      .filter((p) => p.positionGroup === PositionGroup.SKILL && p.teamId !== null)
      .sort(
        (a, b) =>
          a.current.technicalSkill - b.current.technicalSkill || String(a.id).localeCompare(String(b.id)),
      );
    const stats = new Map<ReturnType<typeof PlayerId>, PlayerSeasonStats>();
    for (const p of skills) {
      stats.set(p.id, statsFor(p.id, { receivingYards: 200 + p.current.technicalSkill * 8 }));
    }
    // One bottom-band player doubles his expected production.
    const sleeper = skills[5]!;
    stats.set(
      sleeper.id,
      statsFor(sleeper.id, { receivingYards: (200 + sleeper.current.technicalSkill * 8) * 2.2 }),
    );
    const multipliers = computePerformanceMultipliers(league, stats);
    expect(multipliers.get(sleeper.id)!).toBeGreaterThanOrEqual(1.12);
  });

  it('OL and ST players are not in the multiplier map (will fall back to neutral 1.0)', () => {
    const league = createLeague({ seed: 'perf-mult-noindiv' });
    const ols = Object.values(league.players).filter(
      (p) => p.positionGroup === PositionGroup.OL,
    );
    const sts = Object.values(league.players).filter(
      (p) => p.positionGroup === PositionGroup.ST,
    );
    expect(ols.length).toBeGreaterThan(0);
    expect(sts.length).toBeGreaterThan(0);
    // OL/ST players still emit zero stats from sim; passing the empty
    // map is the closest equivalent of "no individual stats".
    const multipliers = computePerformanceMultipliers(league, new Map());
    for (const p of [...ols, ...sts]) {
      expect(multipliers.has(p.id)).toBe(false);
    }
  });

  it('determinism — same league + same stats yields identical multipliers', () => {
    const league = createLeague({ seed: 'perf-mult-det' });
    const wrs = Object.values(league.players).filter((p) => p.position === Position.WR);
    const buildStats = () => {
      const m = new Map<ReturnType<typeof PlayerId>, PlayerSeasonStats>();
      for (let i = 0; i < 8; i++) {
        m.set(
          wrs[i]!.id,
          statsFor(wrs[i]!.id, { receivingYards: 500 + i * 80, receivingTds: i }),
        );
      }
      return m;
    };
    const a = computePerformanceMultipliers(league, buildStats());
    const b = computePerformanceMultipliers(league, buildStats());
    for (const [id, mult] of a) {
      expect(b.get(id)).toBe(mult);
    }
  });
});

describe('advancePlayerDevelopment — performance multiplier', () => {
  it('strong-season multiplier produces faster technical/mental growth than weak-season', () => {
    // Compare two identical players (same seeded prng inputs) with
    // different multipliers. The 1.30× version should end with strictly
    // higher technical/mental skills than the 0.95× version.
    const league = createLeague({ seed: 'dev-mult-compare' });
    // Pick a young player with growth headroom.
    const subject = Object.values(league.players).find(
      (p) => isYoungEnough(league, p) && hasGrowthRoom(p),
    );
    expect(subject).toBeDefined();

    // Run dev a few times with each multiplier and average to dampen
    // per-call PRNG noise; the population mean should clearly favor
    // the higher multiplier.
    let strongTotal = 0;
    let weakTotal = 0;
    const trials = 20;
    for (let i = 0; i < trials; i++) {
      const strong = advancePlayerDevelopment(
        new Prng(`dev-strong-${i}`),
        subject!,
        league,
        1.3,
      );
      const weak = advancePlayerDevelopment(
        new Prng(`dev-weak-${i}`),
        subject!,
        league,
        0.95,
      );
      strongTotal += sumTechMental(strong);
      weakTotal += sumTechMental(weak);
    }
    expect(strongTotal).toBeGreaterThan(weakTotal);
  });

  it('default multiplier of 1.0 matches passing 1.0 explicitly', () => {
    const league = createLeague({ seed: 'dev-mult-default' });
    const subject = Object.values(league.players)[0]!;
    const a = advancePlayerDevelopment(new Prng('x'), subject, league);
    const b = advancePlayerDevelopment(new Prng('x'), subject, league, 1.0);
    expect(a.current).toEqual(b.current);
  });

  it('S4: a collapse season accelerates a post-peak player\'s decline', () => {
    const league = createLeague({ seed: 'dev-decline-mod' });
    const rb = Object.values(league.players).find((p) => p.position === Position.RB)!;
    const old: Player = { ...rb, birthDate: '1997-05-15' }; // ageNext 30
    const sumKeys = (pl: Player) => {
      let t = 0;
      for (const k of ['speed', 'acceleration', 'agility', 'elusiveness'] as const) t += pl.current[k];
      return t;
    };
    let badTotal = 0;
    let goodTotal = 0;
    for (let i = 0; i < 25; i++) {
      badTotal += sumKeys(advancePlayerDevelopment(new Prng(`dm-${i}`), old, league, 0.85));
      goodTotal += sumKeys(advancePlayerDevelopment(new Prng(`dm-${i}`), old, league, 1.12));
    }
    expect(badTotal).toBeLessThan(goodTotal);
  });

  it('S4: ADVERSITY_DRIVEN young players grow MORE after a bad season than peers do', () => {
    const league = createLeague({ seed: 'dev-adversity' });
    const base = Object.values(league.players).find(
      (p) => p.position === Position.WR && p.ceiling.technicalSkill - p.current.technicalSkill > 8,
    )!;
    const young = { ...base, birthDate: '2004-05-15' }; // ageNext 23
    const adversity: Player = { ...young, developmentArchetype: 'ADVERSITY_DRIVEN' };
    const steady: Player = { ...young, developmentArchetype: 'SLOW_STEADY' };
    let advTotal = 0;
    let steadyTotal = 0;
    for (let i = 0; i < 25; i++) {
      advTotal += advancePlayerDevelopment(new Prng(`adv-${i}`), adversity, league, 0.92).current
        .technicalSkill;
      steadyTotal += advancePlayerDevelopment(new Prng(`adv-${i}`), steady, league, 0.92).current
        .technicalSkill;
    }
    expect(advTotal).toBeGreaterThan(steadyTotal);
  });
});

function isYoungEnough(league: LeagueState, player: Player): boolean {
  const birthYear = Number(player.birthDate.slice(0, 4));
  const simYear = 2026 + (league.seasonNumber - 1);
  return simYear - birthYear <= 24;
}

function hasGrowthRoom(player: Player): boolean {
  const techKeys: (keyof Player['current'])[] = [
    'technicalSkill',
    'footballIq',
    'decisionMaking',
    'handsBallSkills',
  ];
  let totalGap = 0;
  for (const key of techKeys) totalGap += player.ceiling[key] - player.current[key];
  return totalGap > 8;
}

function sumTechMental(player: Player): number {
  const keys: (keyof Player['current'])[] = [
    'technicalSkill',
    'footballIq',
    'decisionMaking',
    'handsBallSkills',
    'blockingTechnique',
    'passRushTechnique',
    'coverageTechnique',
    'tacklingTechnique',
  ];
  let total = 0;
  for (const k of keys) total += player.current[k];
  return total;
}
