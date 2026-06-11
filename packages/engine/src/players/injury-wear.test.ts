import { describe, expect, it } from 'vitest';
import { Prng } from '../prng/index.js';
import { createLeague } from '../league/generate.js';
import { advancePlayerDevelopment } from '../season/development.js';
import { retirementProbability, retirementProbabilityForAge } from '../season/retirement.js';
import { keySkillAverage } from '../archetypes/key-skill.js';
import { injuryAgeMultiplier, applyInjuryScar } from './aging-curves.js';
import type { Player } from '../types/player.js';
import type { CareerSeasonStats } from '../types/stats.js';
import type { LeagueState } from '../types/league.js';

function atAge(player: Player, ageNext: number): Player {
  return { ...player, birthDate: `${2027 - ageNext}-05-15` };
}

describe('injuryAgeMultiplier (S5)', () => {
  it('is flat through 26 and rises with age (real bar: 17% → 32% injury-shortened)', () => {
    const league = createLeague({ seed: 'inj-mult' });
    const p = Object.values(league.players)[0]!;
    const at = (age: number) =>
      injuryAgeMultiplier({ ...p, birthDate: `${2026 - age}-05-15` }, league.seasonNumber);
    expect(at(24)).toBeCloseTo(at(26), 5);
    expect(at(30)).toBeGreaterThan(at(26));
    expect(at(34)).toBeGreaterThan(at(30));
    expect(at(34) / at(26)).toBeGreaterThan(1.4);
  });

  it('brittle players are more injury-prone than durable ones at the same age', () => {
    const league = createLeague({ seed: 'inj-dur' });
    const p = Object.values(league.players)[0]!;
    const brittle = { ...p, current: { ...p.current, durability: 30 } };
    const durable = { ...p, current: { ...p.current, durability: 85 } };
    expect(injuryAgeMultiplier(brittle, league.seasonNumber)).toBeGreaterThan(
      injuryAgeMultiplier(durable, league.seasonNumber),
    );
  });
});

describe('applyInjuryScar (S5)', () => {
  it('permanently reduces durability, is deterministic, and respects bounds', () => {
    const league = createLeague({ seed: 'inj-scar' });
    const p = Object.values(league.players)[0]!;
    const a = applyInjuryScar(p, 1234);
    const b = applyInjuryScar(p, 1234);
    expect(a.current).toEqual(b.current);
    expect(a.current.durability).toBeLessThan(p.current.durability);
    expect(a.current.durability).toBeGreaterThanOrEqual(1);
    // Different injuries scar differently.
    const c = applyInjuryScar(p, 5678);
    expect(JSON.stringify(c.current)).not.toBe(JSON.stringify(a.current));
  });
});

describe('RB touch odometer (S5)', () => {
  function withTouches(p: Player, perSeason: number, seasons: number): Player {
    const careerStats: CareerSeasonStats[] = [];
    for (let s = 1; s <= seasons; s++) {
      careerStats.push({
        playerId: p.id,
        seasonNumber: s,
        gamesPlayed: 16,
        passAttempts: 0,
        passCompletions: 0,
        passingYards: 0,
        passingTds: 0,
        interceptionsThrown: 0,
        rushingAttempts: perSeason,
        rushingYards: perSeason * 4,
        rushingTds: 5,
        targets: 0,
        receptions: 0,
        receivingYards: 0,
        receivingTds: 0,
        tackles: 0,
        sacks: 0,
        interceptions: 0,
      });
    }
    return { ...p, careerStats };
  }

  it('a high-mileage 27-year-old RB declines harder than a fresh-legged one', () => {
    const league = createLeague({ seed: 'odometer' });
    const rb = Object.values(league.players).find((p) => p.position === 'RB')!;
    const heavy = atAge(withTouches(rb, 340, 6), 27); // ~2040 career touches
    const light = atAge(withTouches(rb, 80, 6), 27);
    const delta = (player: Player) => {
      let total = 0;
      for (let i = 0; i < 25; i++) {
        const after = advancePlayerDevelopment(new Prng(`odo-${i}`), player, league);
        total +=
          keySkillAverage(after.current, after.archetype) -
          keySkillAverage(player.current, player.archetype);
      }
      return total / 25;
    };
    expect(delta(heavy)).toBeLessThan(delta(light));
  });
});

describe('decline-aware retirement (S5)', () => {
  it('fringe/backup vets retire earlier than the age table alone', () => {
    const league: LeagueState = createLeague({ seed: 'retire-decline' });
    const p = Object.values(league.players)[0]!;
    const fringe = { ...p, tier: 'FRINGE' as const };
    const starter = { ...p, tier: 'STARTER' as const };
    expect(retirementProbability(30, fringe)).toBeGreaterThan(retirementProbabilityForAge(30));
    expect(retirementProbability(33, fringe)).toBeGreaterThan(retirementProbability(33, starter));
    // Young fringe players are untouched — washout handles them.
    expect(retirementProbability(25, fringe)).toBe(retirementProbabilityForAge(25));
    expect(retirementProbability(40, fringe)).toBeLessThanOrEqual(1);
  });
});
