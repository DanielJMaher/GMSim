import { describe, it, expect } from 'vitest';
import {
  buildScoutReport,
  STRENGTH_LEADS_MEASURED,
  STRENGTH_LEADS_LOUD,
} from './scout-report.js';
import { scoutTraitsFor, scoutConcernFor } from './scout-vocabulary.js';
import { createLeague } from '../league/generate.js';
import { Prng } from '../prng/index.js';
import type { MediaOutlet, ScoutReportBody } from '../types/media.js';

const league = createLeague({ seed: 'scout-report-base' });
const baseOutlet = Object.values(league.mediaOutlets).find((o) => o.focus === 'COLLEGE')!;
const loudOutlet: MediaOutlet = { ...baseOutlet, hypeSpectrum: 9 };
const measuredOutlet: MediaOutlet = { ...baseOutlet, hypeSpectrum: 2 };

const qb = league.collegePool.find((cp) => cp.nflProjectedPosition === 'QB')!;
const edge = league.collegePool.find((cp) => cp.nflProjectedPosition === 'EDGE')!;

function allText(r: ScoutReportBody): string {
  return [r.summary, ...r.strengths, r.concern, r.bottomLine, r.comp ?? ''].join(' ');
}

/** Does `strength` begin with one of `leads` (case-insensitive, after the
 *  generator capitalizes the first letter)? */
function startsWithLead(strength: string, leads: readonly string[]): boolean {
  return leads.some((l) => strength.toLowerCase().startsWith(l));
}

describe('buildScoutReport', () => {
  it('is deterministic for the same prng + args', () => {
    const a = buildScoutReport(new Prng('z'), { prospect: qb, outlet: loudOutlet });
    const b = buildScoutReport(new Prng('z'), { prospect: qb, outlet: loudOutlet });
    expect(a).toEqual(b);
  });

  it('always carries a summary, at least one strength, a concern, and a bottom line', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const r = buildScoutReport(new Prng(seed), { prospect: edge, outlet: measuredOutlet });
      expect(r.summary.length).toBeGreaterThan(0);
      expect(r.strengths.length).toBeGreaterThanOrEqual(1);
      expect(r.strengths.length).toBeLessThanOrEqual(2);
      expect(r.concern.length).toBeGreaterThan(0);
      expect(r.bottomLine.length).toBeGreaterThan(0);
    }
  });

  it('never leaks a ground-truth number (qualitative prose only)', () => {
    for (const seed of ['n1', 'n2', 'n3', 'n4']) {
      const loud = buildScoutReport(new Prng(seed), { prospect: qb, outlet: loudOutlet });
      const meas = buildScoutReport(new Prng(seed), { prospect: qb, outlet: measuredOutlet });
      expect(allText(loud)).not.toMatch(/\d/);
      expect(allText(meas)).not.toMatch(/\d/);
    }
  });

  it('reaches for the hype register only when the outlet is loud', () => {
    for (const seed of ['v1', 'v2', 'v3', 'v4', 'v5']) {
      const loud = buildScoutReport(new Prng(seed), { prospect: edge, outlet: loudOutlet });
      const meas = buildScoutReport(new Prng(seed), { prospect: edge, outlet: measuredOutlet });
      // Every loud strength uses a loud lead; every measured strength a measured one.
      for (const s of loud.strengths) expect(startsWithLead(s, STRENGTH_LEADS_LOUD)).toBe(true);
      for (const s of meas.strengths) expect(startsWithLead(s, STRENGTH_LEADS_MEASURED)).toBe(true);
    }
  });

  it('is position-aware — a QB report and an EDGE report cite different traits', () => {
    const qbReport = buildScoutReport(new Prng('p'), { prospect: qb, outlet: measuredOutlet });
    const edgeReport = buildScoutReport(new Prng('p'), { prospect: edge, outlet: measuredOutlet });
    expect(qbReport.strengths).not.toEqual(edgeReport.strengths);
  });

  it('concern names a position-specific failure mode (the weakness pole)', () => {
    // The QB-specific failure mode appears in a QB report's concern across seeds.
    const qbConcerns = ['c1', 'c2', 'c3', 'c4', 'c5'].map(
      (s) => buildScoutReport(new Prng(s), { prospect: qb, outlet: measuredOutlet }).concern,
    );
    // Every weakness phrase for QB is a possible substring; at least one of the
    // distinctly-QB ones should turn up, and never an EDGE-only failure mode.
    expect(qbConcerns.some((c) => /read|pocket|throw|placement|footwork/.test(c))).toBe(true);
    expect(qbConcerns.some((c) => /edge|pass-rush|against the run/.test(c))).toBe(false);
  });

  it('formats an archetype-style comp when one is present (no real names, no numbers)', () => {
    // Sweep seeds until a comp surfaces, then assert its shape.
    let withComp: ScoutReportBody | undefined;
    for (let i = 0; i < 50 && !withComp; i++) {
      const r = buildScoutReport(new Prng(`comp-${i}`), { prospect: qb, outlet: loudOutlet });
      if (r.comp) withComp = r;
    }
    expect(withComp).toBeDefined();
    expect(withComp!.comp).toMatch(/^In the mold of a /);
    expect(withComp!.comp).toMatch(/\.$/);
  });
});

describe('scoutTraitsFor', () => {
  it('returns n distinct traits', () => {
    const traits = scoutTraitsFor(new Prng('t'), 'WR', 3);
    expect(traits).toHaveLength(3);
    expect(new Set(traits).size).toBe(3);
  });

  it('draws from disjoint per-position pools', () => {
    const qbTraits = new Set(scoutTraitsFor(new Prng('q'), 'QB', 3));
    const edgeTraits = new Set(scoutTraitsFor(new Prng('q'), 'EDGE', 3));
    for (const t of qbTraits) expect(edgeTraits.has(t)).toBe(false);
  });
});

describe('scoutConcernFor', () => {
  it('returns a position-appropriate weakness phrase, deterministically', () => {
    expect(scoutConcernFor(new Prng('w'), 'QB')).toBe(scoutConcernFor(new Prng('w'), 'QB'));
    expect(scoutConcernFor(new Prng('w'), 'QB').length).toBeGreaterThan(0);
  });

  it('weakness vocab is position-specific (QB failure modes differ from EDGE)', () => {
    const qbWeak = new Set(['w1', 'w2', 'w3', 'w4', 'w5'].map((s) => scoutConcernFor(new Prng(s), 'QB')));
    const edgeWeak = new Set(['w1', 'w2', 'w3', 'w4', 'w5'].map((s) => scoutConcernFor(new Prng(s), 'EDGE')));
    for (const w of qbWeak) expect(edgeWeak.has(w)).toBe(false);
  });
});
