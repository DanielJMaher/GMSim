import { describe, expect, it } from 'vitest';
import { Prng } from '../prng/index.js';
import { createLeague } from '../league/generate.js';
import { advancePlayerDevelopment } from '../season/development.js';
import { keySkillAverage } from '../archetypes/key-skill.js';
import {
  AGING_CURVES,
  agingBucketFor,
  curveForPosition,
  declineMultiplierFor,
  declineFor,
  cliffHazard,
} from './aging-curves.js';
import { Position } from '../types/enums.js';
import type { Player } from '../types/player.js';
import type { LeagueState } from '../types/league.js';

/** Clone a player with a birthdate that makes them `ageNext` on next-season
 *  advance (seasonNumber 1 → next sim year 2027). */
function atAge(player: Player, ageNext: number): Player {
  return { ...player, birthDate: `${2027 - ageNext}-05-15` };
}

function findByPosition(league: LeagueState, position: Position): Player {
  const p = Object.values(league.players).find((pl) => pl.position === position);
  expect(p).toBeDefined();
  return p!;
}

/** Mean keySkillAverage delta across many independent dev rolls. */
function meanDevDelta(league: LeagueState, player: Player, trials: number): number {
  let total = 0;
  for (let i = 0; i < trials; i++) {
    const after = advancePlayerDevelopment(new Prng(`aging-trial-${i}`), player, league);
    total +=
      keySkillAverage(after.current, after.archetype) -
      keySkillAverage(player.current, player.archetype);
  }
  return total / trials;
}

describe('aging buckets', () => {
  it('maps every engine position to a curve', () => {
    for (const pos of Object.values(Position)) {
      expect(AGING_CURVES[agingBucketFor(pos)]).toBeDefined();
    }
  });

  it('spot-checks the non-obvious mappings', () => {
    expect(agingBucketFor('NICKEL')).toBe('CB');
    expect(agingBucketFor('FB')).toBe('RB');
    expect(agingBucketFor('OLB')).toBe('LB');
    expect(agingBucketFor('NT')).toBe('IDL');
    expect(agingBucketFor('K')).toBe('ST');
    expect(agingBucketFor('LG')).toBe('OL');
  });
});

describe('declineFor', () => {
  it('is zero before the category onset and positive after', () => {
    const rb = AGING_CURVES.RB;
    expect(declineFor(rb, 'physical', rb.physicalDeclineOnset - 1)).toBe(0);
    expect(declineFor(rb, 'physical', rb.physicalDeclineOnset)).toBeGreaterThan(0);
    expect(declineFor(rb, 'technical', rb.techniqueDeclineOnset - 1)).toBe(0);
    expect(declineFor(rb, 'technical', rb.techniqueDeclineOnset)).toBeGreaterThan(0);
  });

  it('technique declines post-peak — the v0.134 fix (old model never declined technique)', () => {
    for (const curve of Object.values(AGING_CURVES)) {
      expect(declineFor(curve, 'technical', curve.techniqueDeclineOnset + 2)).toBeGreaterThan(0);
    }
  });

  it('ramps with years past onset', () => {
    const rb = AGING_CURVES.RB;
    const at26 = declineFor(rb, 'physical', 26);
    const at30 = declineFor(rb, 'physical', 30);
    expect(at30).toBeGreaterThan(at26);
  });

  it('stable traits never decline', () => {
    for (const curve of Object.values(AGING_CURVES)) {
      expect(declineFor(curve, 'stable', 40)).toBe(0);
    }
  });

  it('positions differ: an RB declines at 26, a QB does not', () => {
    expect(declineFor(AGING_CURVES.RB, 'physical', 26)).toBeGreaterThan(0);
    expect(declineFor(AGING_CURVES.QB, 'physical', 26)).toBe(0);
  });
});

describe('cliffHazard', () => {
  it('is zero before onset, positive after, and capped', () => {
    for (const curve of Object.values(AGING_CURVES)) {
      expect(cliffHazard(curve, curve.cliffOnset - 1)).toBe(0);
      expect(cliffHazard(curve, curve.cliffOnset)).toBeGreaterThan(0);
      expect(cliffHazard(curve, 45)).toBeLessThanOrEqual(0.4);
    }
  });
});

describe('declineMultiplierFor', () => {
  it('is deterministic and bounded', () => {
    const league = createLeague({ seed: 'aging-mult' });
    for (const p of Object.values(league.players).slice(0, 50)) {
      const a = declineMultiplierFor(league, p);
      const b = declineMultiplierFor(league, p);
      expect(a).toBe(b);
      expect(a).toBeGreaterThanOrEqual(0.5);
      expect(a).toBeLessThanOrEqual(1.8);
    }
  });

  it('varies across players', () => {
    const league = createLeague({ seed: 'aging-mult-var' });
    const values = Object.values(league.players)
      .slice(0, 100)
      .map((p) => declineMultiplierFor(league, p));
    expect(new Set(values.map((v) => v.toFixed(3))).size).toBeGreaterThan(20);
  });

  it('brittle (low-durability) players age faster than durable ones', () => {
    const league = createLeague({ seed: 'aging-mult-dur' });
    const p = Object.values(league.players)[0]!;
    const brittle = { ...p, current: { ...p.current, durability: 30 } };
    const durable = { ...p, current: { ...p.current, durability: 85 } };
    expect(declineMultiplierFor(league, brittle)).toBeGreaterThan(
      declineMultiplierFor(league, durable),
    );
  });
});

describe('advancePlayerDevelopment with aging curves', () => {
  it('a 28-year-old RB regresses while a 28-year-old QB roughly holds', () => {
    const league = createLeague({ seed: 'aging-rb-qb' });
    const rb = atAge(findByPosition(league, 'RB'), 28);
    const qb = atAge(findByPosition(league, 'QB'), 28);
    const rbDelta = meanDevDelta(league, rb, 30);
    const qbDelta = meanDevDelta(league, qb, 30);
    expect(rbDelta).toBeLessThan(0);
    expect(qbDelta).toBeGreaterThan(rbDelta);
    expect(qbDelta).toBeGreaterThan(-0.5);
  });

  it('a 23-year-old still grows at every position', () => {
    const league = createLeague({ seed: 'aging-young' });
    for (const pos of ['RB', 'WR', 'CB', 'QB'] as const) {
      const young = atAge(findByPosition(league, pos), 23);
      expect(meanDevDelta(league, young, 30)).toBeGreaterThan(0);
    }
  });

  it('a 35-year-old declines at every position', () => {
    const league = createLeague({ seed: 'aging-old' });
    for (const pos of ['RB', 'WR', 'CB', 'QB', 'EDGE', 'LT'] as const) {
      const old = atAge(findByPosition(league, pos), 35);
      expect(meanDevDelta(league, old, 30)).toBeLessThan(0);
    }
  });

  it('skills stay within 1-99 through heavy late-career decline', () => {
    const league = createLeague({ seed: 'aging-bounds' });
    let player = atAge(findByPosition(league, 'RB'), 36);
    for (let year = 0; year < 6; year++) {
      player = advancePlayerDevelopment(new Prng(`bounds-${year}`), player, league);
      for (const v of Object.values(player.current)) {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(99);
      }
    }
  });

  it('cliff seasons occur for aged players at roughly the hazard rate', () => {
    const league = createLeague({ seed: 'aging-cliff' });
    const curve = curveForPosition('RB');
    const rb = atAge(findByPosition(league, 'RB'), 31);
    // At 31 an RB is 3 years past cliff onset. A cliff year adds a large
    // extra hit on top of baseline decline; count trials whose key-skill
    // drop exceeds baseline + half the min magnitude.
    const hazard = cliffHazard(curve, 31);
    expect(hazard).toBeCloseTo(
      Math.min(0.4, curve.cliffHazardBase + 3 * curve.cliffHazardPerYear),
      5,
    );
    const trials = 300;
    let bigDrops = 0;
    const before = keySkillAverage(rb.current, rb.archetype);
    for (let i = 0; i < trials; i++) {
      const after = advancePlayerDevelopment(new Prng(`cliff-${i}`), rb, league);
      const drop = before - keySkillAverage(after.current, after.archetype);
      if (drop >= curve.cliffMagnitudeMin * 0.6 + 2.5) bigDrops++;
    }
    const rate = bigDrops / trials;
    expect(rate).toBeGreaterThan(hazard * 0.4);
    expect(rate).toBeLessThan(hazard * 2.2);
  });
});
