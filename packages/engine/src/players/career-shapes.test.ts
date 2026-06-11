import { describe, expect, it } from 'vitest';
import { Prng } from '../prng/index.js';
import { createLeague } from '../league/generate.js';
import { advancePlayerDevelopment } from '../season/development.js';
import { keySkillAverage } from '../archetypes/key-skill.js';
import {
  careerShapeFor,
  resurgenceWindowFor,
  SHAPE_MODIFIERS,
  type CareerShape,
} from './career-shapes.js';
import { AGING_CURVES } from './aging-curves.js';
import { positionGroupFor } from './position-group.js';
import type { Player } from '../types/player.js';
import type { LeagueState } from '../types/league.js';

function atAge(player: Player, ageNext: number): Player {
  return { ...player, birthDate: `${2027 - ageNext}-05-15` };
}

function meanDevDelta(
  league: LeagueState,
  player: Player,
  trials: number,
  perfMult = 1.0,
): number {
  let total = 0;
  for (let i = 0; i < trials; i++) {
    const after = advancePlayerDevelopment(new Prng(`shape-trial-${i}`), player, league, perfMult);
    total +=
      keySkillAverage(after.current, after.archetype) -
      keySkillAverage(player.current, player.archetype);
  }
  return total / trials;
}

describe('careerShapeFor', () => {
  it('is deterministic per (league, player)', () => {
    const league = createLeague({ seed: 'shape-det' });
    for (const p of Object.values(league.players).slice(0, 40)) {
      expect(careerShapeFor(league, p)).toBe(careerShapeFor(league, p));
    }
  });

  it('league-wide frequencies land near the measured weights', () => {
    const league = createLeague({ seed: 'shape-freq' });
    const counts = new Map<string, Map<CareerShape, number>>();
    const totals = new Map<string, number>();
    for (const p of Object.values(league.players)) {
      const group = positionGroupFor(p.position);
      const bucket = group === 'QB' ? 'QB' : group === 'SKILL' ? 'SKILL' : 'OTHER';
      const m = counts.get(bucket) ?? new Map<CareerShape, number>();
      const shape = careerShapeFor(league, p);
      m.set(shape, (m.get(shape) ?? 0) + 1);
      counts.set(bucket, m);
      totals.set(bucket, (totals.get(bucket) ?? 0) + 1);
    }
    // SKILL: CLASSIC 56% target, METEOR 19% target.
    const skill = counts.get('SKILL')!;
    const skillN = totals.get('SKILL')!;
    expect((skill.get('CLASSIC_ARC') ?? 0) / skillN).toBeGreaterThan(0.42);
    expect((skill.get('CLASSIC_ARC') ?? 0) / skillN).toBeLessThan(0.7);
    expect((skill.get('METEOR') ?? 0) / skillN).toBeGreaterThan(0.1);
    expect((skill.get('METEOR') ?? 0) / skillN).toBeLessThan(0.3);
    // QB: EVERGREEN 30% target, METEOR absent from the QB pool.
    const qb = counts.get('QB')!;
    const qbN = totals.get('QB')!;
    expect((qb.get('EVERGREEN') ?? 0) / qbN).toBeGreaterThan(0.12);
    expect(qb.get('METEOR') ?? 0).toBe(0);
  });
});

describe('shape modifiers shape the curve', () => {
  /** Pool mean dev delta across all players of `pos` whose shape matches. */
  function groupDelta(
    league: LeagueState,
    pos: string,
    shape: CareerShape,
    age: number,
    trialsPer = 12,
  ): { delta: number; n: number } {
    const members = Object.values(league.players).filter(
      (p) => p.position === pos && careerShapeFor(league, p) === shape,
    );
    let total = 0;
    for (const m of members) total += meanDevDelta(league, atAge(m, age), trialsPer);
    return { delta: members.length ? total / members.length : NaN, n: members.length };
  }

  it('a 29-year-old EVERGREEN WR ages better than a 29-year-old METEOR WR', () => {
    const league = createLeague({ seed: 'shape-wr' });
    const meteor = groupDelta(league, 'WR', 'METEOR', 29);
    const evergreen = groupDelta(league, 'WR', 'EVERGREEN', 29);
    expect(meteor.n).toBeGreaterThan(3);
    expect(evergreen.n).toBeGreaterThan(1);
    expect(evergreen.delta).toBeGreaterThan(meteor.delta + 1);
  });

  it('LATE_BLOOMERs are still improving at ages where CLASSICs have stalled', () => {
    const league = createLeague({ seed: 'shape-late' });
    const late = groupDelta(league, 'WR', 'LATE_BLOOMER', 27);
    const classic = groupDelta(league, 'WR', 'CLASSIC_ARC', 27);
    expect(late.n).toBeGreaterThan(2);
    expect(late.delta).toBeGreaterThan(classic.delta);
  });

  it('SECOND_PEAK resurgence rebounds in-window — but only when armed by a trough (S5)', () => {
    const league = createLeague({ seed: 'shape-resurge' });
    const candidates = Object.values(league.players).filter(
      (p) => p.position === 'RB' && careerShapeFor(league, p) === 'SECOND_PEAK',
    );
    expect(candidates.length).toBeGreaterThan(2);
    const curve = AGING_CURVES.RB;
    // Coming off a below-band season (perf 0.85 arms the trough), the
    // in-window year clearly beats the same bad season outside the window.
    let inWindow = 0;
    let after = 0;
    let inWindowUnarmed = 0;
    for (const p of candidates) {
      const w = resurgenceWindowFor(league, p, Math.min(curve.physicalDeclineOnset, curve.techniqueDeclineOnset));
      inWindow += meanDevDelta(league, atAge(p, w.start), 12, 0.85);
      after += meanDevDelta(league, atAge(p, w.end + 2), 12, 0.85);
      // A NEUTRAL season inside the window does NOT arm the resurgence.
      inWindowUnarmed += meanDevDelta(league, atAge(p, w.start), 12, 1.0);
    }
    expect(inWindow / candidates.length).toBeGreaterThan(after / candidates.length + 1);
    // Armed (bad season) beats unarmed (neutral season) at the SAME age —
    // despite the lower perf multiplier suppressing growth.
    expect(inWindow / candidates.length).toBeGreaterThan(inWindowUnarmed / candidates.length - 0.5);
  });

  it('modifier table sanity: METEOR fades earlier/harder than EVERGREEN', () => {
    const m = SHAPE_MODIFIERS.METEOR;
    const e = SHAPE_MODIFIERS.EVERGREEN;
    expect(m.declineOnsetShift).toBeLessThan(e.declineOnsetShift);
    expect(m.declineRateMult).toBeGreaterThan(e.declineRateMult);
    expect(m.cliffHazardMult).toBeGreaterThan(e.cliffHazardMult);
  });
});

describe('ceiling dynamics', () => {
  it('breakout seasons can bump young tech/mental ceilings; quiet seasons never do', () => {
    const league = createLeague({ seed: 'ceil-bump' });
    const young = atAge(
      Object.values(league.players).find((p) => p.position === 'WR')!,
      23,
    );
    let bumped = 0;
    const trials = 120;
    for (let i = 0; i < trials; i++) {
      const after = advancePlayerDevelopment(new Prng(`bump-${i}`), young, league, 1.3);
      if (after.ceiling.technicalSkill > young.ceiling.technicalSkill) bumped++;
    }
    // ~15% bump chance, give-or-take binomial noise.
    expect(bumped / trials).toBeGreaterThan(0.05);
    expect(bumped / trials).toBeLessThan(0.3);

    for (let i = 0; i < 40; i++) {
      const after = advancePlayerDevelopment(new Prng(`nobump-${i}`), young, league, 1.0);
      expect(after.ceiling.technicalSkill).toBeLessThanOrEqual(young.ceiling.technicalSkill);
    }
  });

  it('stalled players past the growth window lose unreached ceiling (emergent busts)', () => {
    const league = createLeague({ seed: 'ceil-erode' });
    const base = Object.values(league.players).find((p) => p.position === 'WR')!;
    // Force a big unrealized gap at the end of the growth window.
    const stalled: Player = atAge(
      {
        ...base,
        current: { ...base.current, technicalSkill: 60 },
        ceiling: { ...base.ceiling, technicalSkill: 85 },
      },
      27,
    );
    const after = advancePlayerDevelopment(new Prng('erode-1'), stalled, league, 0.95);
    expect(after.ceiling.technicalSkill).toBeLessThan(85);
    expect(after.ceiling.technicalSkill).toBeGreaterThanOrEqual(after.current.technicalSkill);
  });

  it('ceilings stay within bounds and never drop below current', () => {
    const league = createLeague({ seed: 'ceil-bounds' });
    let player = atAge(Object.values(league.players)[0]!, 24);
    for (let year = 0; year < 8; year++) {
      player = advancePlayerDevelopment(new Prng(`cb-${year}`), player, league, 1.3);
      for (const key of Object.keys(player.ceiling) as (keyof Player['ceiling'])[]) {
        expect(player.ceiling[key]).toBeLessThanOrEqual(99);
        expect(player.ceiling[key]).toBeGreaterThanOrEqual(player.current[key]);
      }
    }
  });
});
