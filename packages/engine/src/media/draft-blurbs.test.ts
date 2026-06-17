import { describe, it, expect } from 'vitest';
import { createLeague } from '../index.js';
import { buildDraftBlurbs, type DraftBlurbArgs } from './draft-blurbs.js';
import type { DraftProspectProfile } from '../types/college.js';
import type { Position } from '../types/enums.js';

// Real GM/HC off a deterministic league — avoids hand-building ~40 personnel
// fields, and keeps the assertions structural (length, determinism, distinctness).
const league = createLeague({ seed: 'blurb-test' });
const team = Object.values(league.teams)[0]!;
const gm = league.gms[team.gmId]!;
const hc = league.coaches[team.headCoachId]!;

function prof(pos: Position = 'EDGE'): DraftProspectProfile {
  return {
    nflProjectedPosition: pos,
    collegePosition: pos,
    schoolId: 'unknown-school',
    classYear: 'SR',
    tier: 'STARTER',
    // archetype / assumedArchetype / collegeStats are not read by the generator.
    archetype: 'GENERIC' as DraftProspectProfile['archetype'],
    assumedArchetype: 'GENERIC' as DraftProspectProfile['archetype'],
    isConversionCandidate: false,
    measurables: {
      heightInches: 75,
      weightLbs: 260,
      armLengthInches: 34,
      handSizeInches: 10,
      fortyYardSeconds: 4.6,
      benchPress225Reps: 22,
      verticalInches: 34,
      broadJumpInches: 120,
      threeConeSeconds: 7.0,
      shuttleSeconds: 4.3,
    },
    collegeStats: [],
  };
}

function args(overrides: Partial<DraftBlurbArgs> = {}): DraftBlurbArgs {
  return {
    gm,
    hc,
    profile: prof(),
    playerName: 'Test Player',
    round: 1,
    overallPick: 1,
    boardReason: 'BLUE_CHIP',
    needs: [],
    qbDesperate: false,
    consensusRank: null,
    seasonNumber: 1,
    voiceSeed: 'voice-test',
    ...overrides,
  };
}

// Count sentences: split on whitespace that follows a period. The lookbehind
// ignores decimals (4.60) and arm lengths (34.0") since those have no space
// after the dot.
function sentences(s: string): number {
  return s.split(/(?<=\.)\s+/).filter(Boolean).length;
}

describe('buildDraftBlurbs', () => {
  it('is deterministic for identical inputs', () => {
    expect(buildDraftBlurbs(args())).toEqual(buildDraftBlurbs(args()));
  });

  it('varies words with the voice seed', () => {
    const a = buildDraftBlurbs(args({ voiceSeed: 'voice-a' }));
    const b = buildDraftBlurbs(args({ voiceSeed: 'voice-b' }));
    // Same world facts, different voice → at least one of the two blurbs differs.
    expect(a.gm !== b.gm || a.hc !== b.hc).toBe(true);
  });

  it('gives the GM and the HC distinct write-ups', () => {
    const b = buildDraftBlurbs(args());
    expect(b.gm).not.toEqual(b.hc);
    expect(b.gm.length).toBeGreaterThan(0);
    expect(b.hc.length).toBeGreaterThan(0);
  });

  it('scales length with the round (R1 longer than R7)', () => {
    const r1 = buildDraftBlurbs(args({ round: 1, overallPick: 1 }));
    const r7 = buildDraftBlurbs(args({ round: 7, overallPick: 230 }));
    expect(sentences(r1.gm)).toBeGreaterThan(sentences(r7.gm));
    expect(sentences(r1.hc)).toBeGreaterThan(sentences(r7.hc));
    // A 7th-round pick is terse (the steal bump aside, ~1 sentence).
    expect(sentences(r7.gm)).toBeLessThanOrEqual(2);
  });

  it('a steal buys extra sentences and a value angle', () => {
    const base = buildDraftBlurbs(args({ round: 5, overallPick: 150, consensusRank: 150 }));
    const steal = buildDraftBlurbs(args({ round: 5, overallPick: 150, consensusRank: 20 }));
    expect(sentences(steal.gm)).toBeGreaterThan(sentences(base.gm));
  });

  it('does not throw across positions and always produces text', () => {
    const positions: Position[] = ['QB', 'RB', 'WR', 'TE', 'LT', 'C', 'EDGE', 'CB', 'S', 'K'];
    for (const pos of positions) {
      const b = buildDraftBlurbs(args({ profile: prof(pos) }));
      expect(b.gm.length).toBeGreaterThan(0);
      expect(b.hc.length).toBeGreaterThan(0);
    }
  });
});
