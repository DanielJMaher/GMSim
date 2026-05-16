import { describe, expect, it } from 'vitest';
import { Prng } from '../prng/index.js';
import { rollJuniorDeclarations } from './declaration.js';
import { generateInitialCollegePool } from './pool.js';
import type { CollegePlayer } from '../types/college.js';

describe('rollJuniorDeclarations', () => {
  it('seniors and RS_SRs auto-declare', () => {
    const pool = generateInitialCollegePool(new Prng('p'));
    const after = rollJuniorDeclarations(new Prng('d'), pool);
    for (const cp of after) {
      if (cp.classYear === 'SR' || cp.classYear === 'RS_SR') {
        expect(cp.hasDeclared).toBe(true);
      }
    }
  });

  it('pre-JR classes never declare', () => {
    const pool = generateInitialCollegePool(new Prng('p'));
    const after = rollJuniorDeclarations(new Prng('d'), pool);
    for (const cp of after) {
      if (cp.classYear === 'TRUE_FR' || cp.classYear === 'RS_FR' || cp.classYear === 'SO') {
        expect(cp.hasDeclared).toBe(false);
      }
    }
  });

  it('JR declaration rate is tier-weighted across a large sample', () => {
    const pool = generateInitialCollegePool(new Prng('p'));
    const after = rollJuniorDeclarations(new Prng('d'), pool);
    const counts: Record<string, { declared: number; total: number }> = {
      STAR: { declared: 0, total: 0 },
      STARTER: { declared: 0, total: 0 },
      BACKUP: { declared: 0, total: 0 },
      FRINGE: { declared: 0, total: 0 },
    };
    for (const cp of after) {
      if (cp.classYear !== 'JR') continue;
      counts[cp.tier]!.total++;
      if (cp.hasDeclared) counts[cp.tier]!.declared++;
    }
    const rate = (t: string) =>
      counts[t]!.total === 0 ? 0 : counts[t]!.declared / counts[t]!.total;
    expect(rate('STAR')).toBeGreaterThan(rate('STARTER'));
    expect(rate('STARTER')).toBeGreaterThan(rate('BACKUP'));
    expect(rate('BACKUP')).toBeGreaterThan(rate('FRINGE'));
  });

  it('is deterministic', () => {
    const pool = generateInitialCollegePool(new Prng('p'));
    const a = rollJuniorDeclarations(new Prng('d'), pool);
    const b = rollJuniorDeclarations(new Prng('d'), pool);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]!.hasDeclared).toBe(b[i]!.hasDeclared);
    }
  });

  it('does not flip a prospect from declared back to undeclared', () => {
    const pool = generateInitialCollegePool(new Prng('p'));
    const prePoolWithSomeDeclared: readonly CollegePlayer[] = pool.map((cp, i) =>
      i % 7 === 0 ? { ...cp, hasDeclared: true } : cp,
    );
    const after = rollJuniorDeclarations(new Prng('d'), prePoolWithSomeDeclared);
    for (let i = 0; i < pool.length; i++) {
      if (prePoolWithSomeDeclared[i]!.hasDeclared) {
        expect(after[i]!.hasDeclared).toBe(true);
      }
    }
  });
});
