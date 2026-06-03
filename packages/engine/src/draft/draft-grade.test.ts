import { describe, it, expect } from 'vitest';
import {
  DRAFT_GRADE_BANDS,
  DRAFT_GRADE_FLOOR,
  draftGradeFromOverall,
  draftGradeLabel,
  formatDraftGrade,
  prospectProjectedOverall,
  prospectRealDraftGrade,
  type ProjectableProspect,
} from './draft-grade.js';
import type { PlayerSkills } from '../types/player.js';

describe('draftGradeFromOverall', () => {
  it('returns null for null / NaN input (No grade)', () => {
    expect(draftGradeFromOverall(null)).toBeNull();
    expect(draftGradeFromOverall(Number.NaN)).toBeNull();
  });

  it('is monotonically non-decreasing in projected overall', () => {
    let prev = -Infinity;
    for (let p = 60; p <= 95; p += 0.5) {
      const g = draftGradeFromOverall(p)!;
      expect(g).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = g;
    }
  });

  it('only ever emits grades inside a defined band (never in a scale gap)', () => {
    for (let p = 70; p <= 95; p += 0.25) {
      const g = draftGradeFromOverall(p)!;
      if (g <= DRAFT_GRADE_FLOOR) continue;
      const inBand = DRAFT_GRADE_BANDS.some(
        (b) => g >= b.gradeLo - 1e-9 && g <= b.gradeHi + 1e-9,
      );
      expect(inBand, `grade ${g} from P=${p} fell in a scale gap`).toBe(true);
    }
  });

  it('maps the calibrated anchors to the right tiers', () => {
    // Top of class (~84.8) → Perennial All-Pro band.
    expect(draftGradeLabel(draftGradeFromOverall(84.8))).toBe('Perennial All-Pro');
    // ~82.5 → Pro Bowl talent.
    expect(draftGradeLabel(draftGradeFromOverall(82.5))).toBe('Pro Bowl talent');
    // ~81 → Year 1 starter.
    expect(draftGradeLabel(draftGradeFromOverall(81))).toBe('Year 1 starter');
    // ~74.5 (≈ last drafted) → Average backup or special-teamer.
    expect(draftGradeLabel(draftGradeFromOverall(74.5))).toBe('Average backup or special-teamer');
    // ~71 → Priority undrafted free agent.
    expect(draftGradeLabel(draftGradeFromOverall(71))).toBe('Priority undrafted free agent');
  });

  it('caps at 8.0 and floors at 5.5', () => {
    expect(draftGradeFromOverall(120)).toBe(8.0);
    expect(draftGradeFromOverall(40)).toBe(DRAFT_GRADE_FLOOR);
  });

  it('band edges interpolate to gradeLo at pLo and gradeHi at pHi', () => {
    for (const b of DRAFT_GRADE_BANDS) {
      if (b.pHi >= 999) continue; // open-ended top band
      expect(draftGradeFromOverall(b.pLo)).toBeCloseTo(b.gradeLo, 2);
      // Just below pHi reads near gradeHi (pHi belongs to the next band up).
      expect(draftGradeFromOverall(b.pHi - 1e-6)).toBeCloseTo(b.gradeHi, 2);
    }
  });
});

describe('draftGradeLabel / formatDraftGrade', () => {
  it('labels "No grade" for null', () => {
    expect(draftGradeLabel(null)).toBe('Grade not yet available');
    expect(formatDraftGrade(null)).toBe('—');
  });

  it('formats a grade to two decimals', () => {
    expect(formatDraftGrade(6.3)).toBe('6.30');
    expect(formatDraftGrade(7.0)).toBe('7.00');
  });
});

describe('prospectProjectedOverall / prospectRealDraftGrade', () => {
  // A bare skills object — only the key skills the test archetype reads matter;
  // the rest can be a low constant. We pick a real archetype id at runtime.
  function skillsAll(value: number): PlayerSkills {
    // Build via a Proxy-free plain object: spread a base then we only rely on
    // the keys the archetype reads. Unread keys default to `value`.
    return new Proxy({} as PlayerSkills, {
      get: () => value,
      has: () => true,
    });
  }

  it('blends current toward ceiling by the projection fraction', () => {
    const prospect: ProjectableProspect = {
      // current 60, ceiling 90 on every skill → projected = 60 + 0.75*30 = 82.5
      current: skillsAll(60),
      ceiling: skillsAll(90),
      archetype: 'QB_POCKET_PASSER',
    };
    const p = prospectProjectedOverall(prospect);
    expect(p).toBeCloseTo(82.5, 1);
    // 82.5 → Pro Bowl talent band.
    expect(draftGradeLabel(prospectRealDraftGrade(prospect))).toBe('Pro Bowl talent');
  });

  it('a flat low prospect floors at 5.5', () => {
    const prospect: ProjectableProspect = {
      current: skillsAll(45),
      ceiling: skillsAll(50),
      archetype: 'QB_POCKET_PASSER',
    };
    expect(prospectRealDraftGrade(prospect)).toBe(DRAFT_GRADE_FLOOR);
  });
});
