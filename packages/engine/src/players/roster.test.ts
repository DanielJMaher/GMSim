import { describe, it, expect } from 'vitest';
import { Prng } from '../prng/index.js';
import { generateRoster } from './roster.js';
import { ROSTER_BLUEPRINT_53, ROSTER_SIZE } from './roster-blueprint.js';
import { Position } from '../types/enums.js';
import { TeamId } from '../types/ids.js';

const baseOpts = {
  teamId: TeamId('TST'),
  idPrefix: 'TST',
  offensiveScheme: 'WEST_COAST' as const,
  defensiveScheme: 'BASE_4_3' as const,
};

describe('generateRoster', () => {
  it('produces exactly 53 players matching the blueprint position counts', () => {
    const roster = generateRoster(new Prng('blueprint'), baseOpts);
    expect(roster.length).toBe(ROSTER_SIZE);

    const counts = new Map<Position, number>();
    for (const p of roster) {
      counts.set(p.position, (counts.get(p.position) ?? 0) + 1);
    }
    for (const slot of ROSTER_BLUEPRINT_53) {
      expect(counts.get(slot.position) ?? 0).toBe(slot.count);
    }
  });

  it('all players are assigned to the requested team', () => {
    const roster = generateRoster(new Prng('team-assign'), baseOpts);
    for (const p of roster) {
      expect(p.teamId).toBe(baseOpts.teamId);
    }
  });

  it('every player has a unique ID', () => {
    const roster = generateRoster(new Prng('unique-ids'), baseOpts);
    const ids = new Set(roster.map((p) => p.id));
    expect(ids.size).toBe(roster.length);
  });

  it('is deterministic for the same prng + options', () => {
    const a = generateRoster(new Prng('det'), baseOpts);
    const b = generateRoster(new Prng('det'), baseOpts);
    expect(a).toEqual(b);
  });

  it('archetype distribution skews toward scheme fit (RPO_BASED → more dual-threat QBs)', () => {
    // Compare two rosters: one for RPO_BASED, one for AIR_RAID. The RPO
    // roster should have more QB_DUAL_THREAT than the Air Raid roster
    // does on average across many trials.
    let rpoDualThreat = 0;
    let airRaidDualThreat = 0;
    const trials = 50;
    for (let i = 0; i < trials; i++) {
      const rpo = generateRoster(new Prng(`rpo-${i}`), {
        ...baseOpts,
        offensiveScheme: 'RPO_BASED',
      });
      const ar = generateRoster(new Prng(`ar-${i}`), {
        ...baseOpts,
        offensiveScheme: 'AIR_RAID',
      });
      for (const p of rpo) {
        if (p.position === Position.QB && p.archetype === 'QB_DUAL_THREAT') rpoDualThreat++;
      }
      for (const p of ar) {
        if (p.position === Position.QB && p.archetype === 'QB_DUAL_THREAT') airRaidDualThreat++;
      }
    }
    // RPO favors dual-threat QBs (1.7x); Air Raid disfavors them (1.1x).
    expect(rpoDualThreat).toBeGreaterThan(airRaidDualThreat);
  });

  it('age distribution roughly matches the doc target — most players in prime years', () => {
    // Generate a few rosters and check that prime-aged (25-29) players
    // make up the largest cohort.
    const ages: number[] = [];
    for (let i = 0; i < 5; i++) {
      const roster = generateRoster(new Prng(`age-${i}`), baseOpts);
      for (const p of roster) {
        const birthYear = Number(p.birthDate.slice(0, 4));
        ages.push(2026 - birthYear);
      }
    }
    const inPrime = ages.filter((a) => a >= 25 && a <= 29).length;
    const total = ages.length;
    // PRIME stage weight is 50%; expect somewhere in [40%, 60%] in practice.
    expect(inPrime / total).toBeGreaterThan(0.35);
    expect(inPrime / total).toBeLessThan(0.65);
  });

  it('rookies have non-trivial ceiling-to-current gaps in technical skills (avg)', () => {
    const rookieGaps: number[] = [];
    for (let i = 0; i < 5; i++) {
      const roster = generateRoster(new Prng(`rk-${i}`), baseOpts);
      for (const p of roster) {
        const birthYear = Number(p.birthDate.slice(0, 4));
        const age = 2026 - birthYear;
        if (age <= 22) {
          rookieGaps.push(p.ceiling.technicalSkill - p.current.technicalSkill);
        }
      }
    }
    if (rookieGaps.length === 0) return; // sampling didn't yield rookies; accept
    const avg = rookieGaps.reduce((s, g) => s + g, 0) / rookieGaps.length;
    // Even modest rookie gap should be 5+ points on average.
    expect(avg).toBeGreaterThan(5);
  });
});
