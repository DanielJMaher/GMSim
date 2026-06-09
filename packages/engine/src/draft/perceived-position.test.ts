import { describe, it, expect } from 'vitest';
import { Prng } from '../prng/index.js';
import { perceiveProjection, teamScoutSkill } from './perceived-position.js';
import { Position } from '../types/enums.js';
import type { CollegePlayer } from '../types/college.js';

/** Minimal prospect stub — perceiveProjection only reads these fields. */
function convert(): CollegePlayer {
  return {
    collegePosition: Position.EDGE,
    nflProjectedPosition: Position.OLB,
    archetype: 'true-olb',
    assumedArchetype: 'college-de',
    isConversionCandidate: true,
  } as unknown as CollegePlayer;
}

function nonConvert(): CollegePlayer {
  return {
    collegePosition: Position.WR,
    nflProjectedPosition: Position.WR,
    archetype: 'true-wr',
    assumedArchetype: 'true-wr',
    isConversionCandidate: false,
  } as unknown as CollegePlayer;
}

describe('perceiveProjection', () => {
  it('is omniscient with no voice channel (legacy behaviour)', () => {
    const p = perceiveProjection(convert(), { scoutSkill: 0.5 });
    expect(p.position).toBe(Position.OLB);
    expect(p.archetype).toBe('true-olb');
    expect(p.sawConversion).toBe(true);
    expect(p.kind).toBe('identified');
  });

  it('is deterministic for the same prng', () => {
    const a = perceiveProjection(convert(), { scoutSkill: 0.5, prng: new Prng('x') });
    const b = perceiveProjection(convert(), { scoutSkill: 0.5, prng: new Prng('x') });
    expect(a).toEqual(b);
  });

  it('a real conversion is sometimes identified and sometimes missed across the league', () => {
    const kinds = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const p = perceiveProjection(convert(), { scoutSkill: 0.5, prng: new Prng(`team-${i}`) });
      kinds.add(p.kind);
      if (p.kind === 'identified') {
        expect(p.position).toBe(Position.OLB);
        expect(p.archetype).toBe('true-olb');
      } else {
        // missed → valued at his college spot, as what he appears to be
        expect(p.kind).toBe('missed');
        expect(p.position).toBe(Position.EDGE);
        expect(p.archetype).toBe('college-de');
      }
    }
    expect(kinds.has('identified')).toBe(true);
    expect(kinds.has('missed')).toBe(true);
  });

  it('a non-converter with no need reads as natural (no invented move)', () => {
    const p = perceiveProjection(nonConvert(), { scoutSkill: 0.7, prng: new Prng('y') });
    expect(p.kind).toBe('natural');
    expect(p.position).toBe(Position.WR);
    expect(p.sawConversion).toBe(false);
  });

  it('better scouts identify real conversions more often', () => {
    const rate = (skill: number) => {
      let id = 0;
      for (let i = 0; i < 400; i++) {
        if (perceiveProjection(convert(), { scoutSkill: skill, prng: new Prng(`s-${i}`) }).kind === 'identified') id++;
      }
      return id / 400;
    };
    expect(rate(0.9)).toBeGreaterThan(rate(0.1));
  });
});

describe('teamScoutSkill', () => {
  it('averages trueAccuracy across scouts and groups', () => {
    const skill = teamScoutSkill([
      { trueAccuracy: { A: 0.4, B: 0.6 } },
      { trueAccuracy: { A: 0.8, B: 1.0 } },
    ]);
    expect(skill).toBeCloseTo(0.7, 5);
  });

  it('defaults to 0.5 with no scouts', () => {
    expect(teamScoutSkill([])).toBe(0.5);
  });
});
