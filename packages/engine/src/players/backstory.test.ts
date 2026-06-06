import { describe, it, expect } from 'vitest';
import {
  narrateBackstory,
  backstoryFromProspect,
  synthesizeBackstory,
  rollNotableOtherSport,
} from './backstory.js';
import { createLeague } from '../league/generate.js';
import { Prng } from '../prng/index.js';
import type { PlayerBackstory, Bloodline } from '../types/college.js';
import type { PlayerSkills } from '../types/player.js';

const NO_BLOODLINE: Bloodline = {
  hasNflFamily: false,
  relation: null,
  relativeName: null,
  relativeWasStar: false,
};

const FULL: PlayerBackstory = {
  recruitingStars: 5,
  background: 'PEDIGREE',
  hometown: { city: 'Aledo', state: 'TX' },
  transferred: true,
  redshirted: true,
  multiSport: true,
  notableOtherSport: 'a standout high-school point guard',
  bloodline: { hasNflFamily: true, relation: 'FATHER', relativeName: 'Earl Sims', relativeWasStar: true },
  wasCaptain: true,
};

const PLAIN: PlayerBackstory = {
  recruitingStars: 2,
  background: 'DEVELOPMENTAL',
  hometown: { city: 'Dayton', state: 'OH' },
  transferred: false,
  redshirted: false,
  multiSport: true, // played a second sport — but nothing notable, so no line
  notableOtherSport: null,
  bloodline: NO_BLOODLINE,
  wasCaptain: false,
};

describe('narrateBackstory', () => {
  it('is pure — identical facts read identically', () => {
    expect(narrateBackstory(FULL)).toBe(narrateBackstory(FULL));
  });

  it('weaves every present fact into the prose', () => {
    const s = narrateBackstory(FULL);
    expect(s).toContain('five-star');
    expect(s).toContain('Aledo, TX');
    expect(s).toContain('redshirted');
    expect(s).toContain('transferred');
    expect(s).toContain('standout high-school point guard'); // the notable sport (may be capitalized)
    expect(s).toContain('team captain');
    expect(s.toLowerCase()).toContain('family'); // bloodline sentence
    expect(s).toContain('Earl Sims');
  });

  it('does not narrate plain multi-sport — only a NOTABLE second sport earns a line', () => {
    const s = narrateBackstory(PLAIN);
    expect(s).toContain('Dayton, OH');
    expect(s).not.toContain('redshirt');
    expect(s).not.toContain('transferred');
    expect(s).not.toContain('multi-sport'); // baseline fact, never narrated
    expect(s).not.toContain('sport'); // no notable second sport on this one
    expect(s).not.toContain('captain');
    expect(s.toLowerCase()).not.toContain('family');
    // One sentence → exactly one period.
    expect((s.match(/\./g) ?? []).length).toBe(1);
  });

  it('frames a walk-on by his background, not his star count', () => {
    const s = narrateBackstory({ ...PLAIN, recruitingStars: 1, background: 'WALK_ON_STORY' });
    expect(s.toLowerCase()).toContain('walk-on');
  });

  it('never emits a rating number (qualitative bio only)', () => {
    expect(narrateBackstory(FULL)).not.toMatch(/\d/);
    expect(narrateBackstory(PLAIN)).not.toMatch(/\d/);
  });
});

describe('backstoryFromProspect', () => {
  it('distills the prospect facts faithfully', () => {
    const league = createLeague({ seed: 'backstory-extract' });
    const cp = league.collegePool[0]!;
    const b = backstoryFromProspect(cp);
    expect(b.recruitingStars).toBe(cp.recruiting.starRating);
    expect(b.background).toBe(cp.recruiting.background);
    expect(b.hometown).toEqual(cp.recruiting.hometown);
    expect(b.transferred).toBe(cp.transferred);
    expect(b.redshirted).toBe(cp.redshirted);
    expect(b.multiSport).toBe(cp.multiSportBackground);
    expect(b.wasCaptain).toBe(cp.characterFlags.includes('CAPTAIN'));
    // And it narrates without throwing.
    expect(narrateBackstory(b).length).toBeGreaterThan(0);
  });
});

describe('synthesizeBackstory', () => {
  it('is deterministic for the same prng + inputs', () => {
    const a = synthesizeBackstory(new Prng('s'), 'STAR', 'QB');
    const b = synthesizeBackstory(new Prng('s'), 'STAR', 'QB');
    expect(a).toEqual(b);
  });

  it('produces a valid, narratable backstory', () => {
    const b = synthesizeBackstory(new Prng('v'), 'BACKUP', 'CB');
    expect(b.recruitingStars).toBeGreaterThanOrEqual(1);
    expect(b.recruitingStars).toBeLessThanOrEqual(5);
    expect(typeof b.transferred).toBe('boolean');
    expect(b.hometown.city.length).toBeGreaterThan(0);
    expect(b.notableOtherSport === null || typeof b.notableOtherSport === 'string').toBe(true);
    expect(narrateBackstory(b).length).toBeGreaterThan(0);
  });

  it('a notable second sport, when present, implies the multi-sport fact', () => {
    for (let i = 0; i < 200; i++) {
      const b = synthesizeBackstory(new Prng(`m-${i}`), 'STARTER', 'WR', {
        skills: skills({ speed: 92, acceleration: 90 }),
        weightLbs: 200,
      });
      if (b.notableOtherSport) expect(b.multiSport).toBe(true);
    }
  });
});

/** A PlayerSkills with the athletic keys the notable-sport read uses, base 60,
 *  overridable. The function only reads these keys; the cast covers the rest. */
function skills(over: Partial<Record<string, number>> = {}): PlayerSkills {
  const base: Record<string, number> = {
    speed: 60, acceleration: 60, agility: 60, changeOfDirection: 60, jumping: 60,
    strength: 60, throwPower: 60, composure: 60, accuracyDeep: 60, catching: 60,
  };
  return { ...base, ...over } as unknown as PlayerSkills;
}

function sweep(input: Parameters<typeof rollNotableOtherSport>[1], n = 300): {
  hits: number;
  seen: Set<string>;
} {
  let hits = 0;
  const seen = new Set<string>();
  for (let i = 0; i < n; i++) {
    const s = rollNotableOtherSport(new Prng(`s-${i}`), input);
    if (s) {
      hits++;
      seen.add(s);
    }
  }
  return { hits, seen };
}

describe('rollNotableOtherSport (attribute-coded)', () => {
  it('returns null when no athletic attribute is genuinely standout', () => {
    const { hits } = sweep({ skills: skills(), weightLbs: 200, position: 'WR' });
    expect(hits).toBe(0); // nothing elite → no tell, ever
  });

  it('is deterministic for the same prng + input', () => {
    const input = { skills: skills({ speed: 95 }), weightLbs: 195, position: 'WR' as const };
    expect(rollNotableOtherSport(new Prng('d'), input)).toBe(
      rollNotableOtherSport(new Prng('d'), input),
    );
  });

  it('elite speed reads as a track / sprint tell', () => {
    const { hits, seen } = sweep({ skills: skills({ speed: 95 }), weightLbs: 190, position: 'WR' });
    expect(hits).toBeGreaterThan(0);
    for (const s of seen) expect(/sprint|track|relay/.test(s)).toBe(true);
  });

  it('heavy AND fast reads as the surprising-for-his-frame tell (Metcalf)', () => {
    const { seen } = sweep({ skills: skills({ speed: 95 }), weightLbs: 250, position: 'TE' });
    expect(seen.size).toBeGreaterThan(0);
    for (const s of seen) expect(/frame|size|line|relay/.test(s)).toBe(true);
  });

  it('elite agility (not speed) reads as a hoops / quick-feet tell', () => {
    const { seen } = sweep({
      skills: skills({ agility: 93, changeOfDirection: 92 }),
      weightLbs: 195,
      position: 'CB',
    });
    expect(seen.size).toBeGreaterThan(0);
    for (const s of seen) expect(/guard|basketball|forward|soccer|winger/.test(s)).toBe(true);
  });

  it('a QB with elite touch/composure reads as tennis or golf (the Rosen tell)', () => {
    const { seen } = sweep({
      skills: skills({ composure: 94, accuracyDeep: 92, speed: 60, throwPower: 60 }),
      weightLbs: 220,
      position: 'QB',
    });
    expect(seen.size).toBeGreaterThan(0);
    for (const s of seen) expect(/tennis|golf/.test(s)).toBe(true);
  });

  it('never speaks a number (stats are hidden)', () => {
    const { seen } = sweep({ skills: skills({ speed: 95, agility: 95, jumping: 95 }), weightLbs: 240, position: 'WR' });
    for (const s of seen) expect(s).not.toMatch(/\d/);
  });
});
