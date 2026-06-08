import { describe, it, expect } from 'vitest';
import { Prng } from '../prng/index.js';
import {
  bandOf,
  bandPolarity,
  describeSkill,
  REPORT_SKILLS_BY_BUCKET,
} from './skill-vocabulary.js';

describe('bandOf', () => {
  it('maps observed values to the right band', () => {
    expect(bandOf(92)).toBe('elite');
    expect(bandOf(85)).toBe('elite');
    expect(bandOf(78)).toBe('good');
    expect(bandOf(60)).toBe('average');
    expect(bandOf(48)).toBe('below');
    expect(bandOf(30)).toBe('poor');
  });
});

describe('bandPolarity', () => {
  it('treats elite/good as positive and below/poor as negative', () => {
    expect(bandPolarity('elite')).toBe('positive');
    expect(bandPolarity('good')).toBe('positive');
    expect(bandPolarity('average')).toBe('neutral');
    expect(bandPolarity('below')).toBe('negative');
    expect(bandPolarity('poor')).toBe('negative');
  });
});

describe('describeSkill', () => {
  it('returns a positive phrase for a high band and null for average', () => {
    expect(describeSkill('speed', 'elite', 'RB', new Prng('a'))).toBeTruthy();
    expect(describeSkill('speed', 'average', 'RB', new Prng('a'))).toBeNull();
  });

  it('gives the QB technicalSkill its position-specific words (arm talent, not generic)', () => {
    // QB override pool mentions "arm"; the generic technical fallback does not.
    const phrases = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const p = describeSkill('technicalSkill', 'elite', 'QB', new Prng(`q${i}`));
      if (p) phrases.add(p);
    }
    expect([...phrases].some((p) => /arm|velocity|accuracy/i.test(p))).toBe(true);
  });

  it('produces different wording for different PRNG streams (voice channel)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const p = describeSkill('passRushTechnique', 'elite', 'EDGE', new Prng(`e${i}`));
      if (p) seen.add(p);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('keeps every report-skill list non-empty and position-relevant', () => {
    for (const [bucket, keys] of Object.entries(REPORT_SKILLS_BY_BUCKET)) {
      expect(keys.length).toBeGreaterThan(0);
      // QB report should not grade pass-rush; EDGE should not grade coverage of a CB.
      if (bucket === 'QB') expect(keys).not.toContain('passRushTechnique');
      if (bucket === 'EDGE') expect(keys).not.toContain('coverageTechnique');
    }
  });
});
