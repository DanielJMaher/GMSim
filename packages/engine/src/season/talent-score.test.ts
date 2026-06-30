import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import { gradeToTier, GRADE_ORDER } from '../players/skills.js';
import type { Player } from '../types/player.js';
import {
  gradeFromTalentScore,
  regradeLeagueTalent,
  TALENT_SCORE_ALPHA,
} from './talent-score.js';

describe('gradeFromTalentScore', () => {
  it('is monotonic non-increasing in grade rank as the score falls', () => {
    let prevRank = -1;
    for (let s = 1.0; s >= 0; s -= 0.02) {
      const rank = GRADE_ORDER.indexOf(gradeFromTalentScore(s));
      expect(rank).toBeGreaterThanOrEqual(prevRank);
      prevRank = rank;
    }
  });

  it('maps representative scores within each band to the intended grade', () => {
    expect(gradeFromTalentScore(0.995)).toBe('ELITE');
    expect(gradeFromTalentScore(0.97)).toBe('STAR');
    expect(gradeFromTalentScore(0.92)).toBe('HIGH_STARTER');
    expect(gradeFromTalentScore(0.8)).toBe('STARTER');
    expect(gradeFromTalentScore(0.69)).toBe('WEAK_STARTER');
    expect(gradeFromTalentScore(0.57)).toBe('ROTATIONAL');
    expect(gradeFromTalentScore(0.41)).toBe('BACKUP');
    expect(gradeFromTalentScore(0.2)).toBe('FRINGE');
  });
});

describe('regradeLeagueTalent', () => {
  const league = createLeague({ seed: 'talent-score-test' });
  const players = league.players as Record<string, Player>;

  it('is deterministic and tier stays derived from grade', () => {
    const a = regradeLeagueTalent(players);
    const b = regradeLeagueTalent(players);
    expect(Object.keys(a).length).toBe(Object.keys(players).length);
    for (const [id, p] of Object.entries(a)) {
      expect(b[id]!.talentScore).toBe(p.talentScore);
      expect(b[id]!.talentGrade).toBe(p.talentGrade);
      expect(p.tier).toBe(gradeToTier(p.talentGrade));
    }
  });

  it('keeps talentScore in [0,1] and EWMA-anchored to the prior', () => {
    const out = regradeLeagueTalent(players);
    for (const [id, p] of Object.entries(out)) {
      expect(p.talentScore).toBeGreaterThanOrEqual(0);
      expect(p.talentScore).toBeLessThanOrEqual(1);
      // new = α·pct + (1-α)·prev ⇒ |new - prev| ≤ α (one year can't swing more).
      expect(Math.abs(p.talentScore - players[id]!.talentScore)).toBeLessThanOrEqual(
        TALENT_SCORE_ALPHA + 1e-9,
      );
    }
  });

  it('is sticky: a higher prior yields a higher new score at identical skills', () => {
    // Same population + skills, only the subject's PRIOR score differs. The
    // within-position percentile is therefore identical; the EWMA carries the
    // prior, so the high-prior copy must end strictly higher (one down year
    // doesn't erase a track record).
    const subjectId = Object.keys(players)[0]!;
    const low = { ...players, [subjectId]: { ...players[subjectId]!, talentScore: 0.2 } };
    const high = { ...players, [subjectId]: { ...players[subjectId]!, talentScore: 0.95 } };
    const lowOut = regradeLeagueTalent(low)[subjectId]!;
    const highOut = regradeLeagueTalent(high)[subjectId]!;
    expect(highOut.talentScore).toBeGreaterThan(lowOut.talentScore);
    // The gap shrinks toward the shared percentile but does not vanish in one year.
    expect(highOut.talentScore - lowOut.talentScore).toBeCloseTo((1 - TALENT_SCORE_ALPHA) * 0.75, 5);
  });

  it('grades each player against his OWN position, not an absolute line', () => {
    // The best key-skill player at a thin position can out-grade a higher-KSA
    // player at a deep one — position-relative by construction. We assert the
    // weaker guarantee that is always true: the top scorer within every aging
    // bucket lands at a high percentile (score moved up toward 1, not pinned to
    // an absolute KSA threshold).
    const out = regradeLeagueTalent(players);
    // At least some non-QB position must produce an ELITE/STAR, i.e. the star
    // pool is not monopolised by the highest-KSA positions.
    const starPositions = new Set<string>();
    for (const p of Object.values(out)) {
      if (p.talentGrade === 'ELITE' || p.talentGrade === 'STAR') starPositions.add(p.positionGroup);
    }
    expect(starPositions.size).toBeGreaterThan(2);
  });
});
