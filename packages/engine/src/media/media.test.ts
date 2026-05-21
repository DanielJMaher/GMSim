import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from '../season/runner.js';
import { tickPhase } from '../season/lifecycle.js';
import type { LeagueState } from '../types/league.js';

describe('media outlet generation (v0.62)', () => {
  it('generates the canonical outlet count at league creation', () => {
    const league = createLeague({ seed: 'media-gen-1' });
    const outletCount = Object.keys(league.mediaOutlets).length;
    // 10 national NFL + 5 college-focused + 32 team-locals = 47
    expect(outletCount).toBeGreaterThanOrEqual(40);
    expect(outletCount).toBeLessThanOrEqual(55);
  });

  it('every NFL team has at least one local outlet attached', () => {
    const league = createLeague({ seed: 'media-gen-locals' });
    const teamIds = Object.keys(league.teams);
    for (const teamId of teamIds) {
      const localCount = Object.values(league.mediaOutlets).filter(
        (o) => typeof o.market === 'object' && 'localTo' in o.market && o.market.localTo === teamId,
      ).length;
      expect(localCount).toBeGreaterThanOrEqual(1);
    }
  });

  it('outlet spectrums all lie in [1,10]', () => {
    const league = createLeague({ seed: 'media-spectrum-range' });
    for (const o of Object.values(league.mediaOutlets)) {
      expect(o.accuracySpectrum).toBeGreaterThanOrEqual(1);
      expect(o.accuracySpectrum).toBeLessThanOrEqual(10);
      expect(o.hypeSpectrum).toBeGreaterThanOrEqual(1);
      expect(o.hypeSpectrum).toBeLessThanOrEqual(10);
    }
  });

  it('outlet tiers span the full range (INSIDER through BLOG)', () => {
    const league = createLeague({ seed: 'media-tier-mix' });
    const tiers = new Set(Object.values(league.mediaOutlets).map((o) => o.tier));
    // All five tiers should be represented somewhere in a fresh league.
    expect(tiers.has('INSIDER')).toBe(true);
    expect(tiers.has('BEAT')).toBe(true);
    expect(tiers.has('COLUMNIST')).toBe(true);
    expect(tiers.has('RADIO')).toBe(true);
    expect(tiers.has('BLOG')).toBe(true);
  });

  it('college-focused outlets exist on day 1 (reserved for college-season slice)', () => {
    const league = createLeague({ seed: 'media-college-exists' });
    const collegeOutlets = Object.values(league.mediaOutlets).filter(
      (o) => o.focus === 'COLLEGE',
    );
    expect(collegeOutlets.length).toBeGreaterThanOrEqual(3);
  });

  it('deterministic — same seed produces same outlet ids and names', () => {
    const a = createLeague({ seed: 'media-determinism' });
    const b = createLeague({ seed: 'media-determinism' });
    expect(Object.keys(a.mediaOutlets).sort()).toEqual(Object.keys(b.mediaOutlets).sort());
    for (const id of Object.keys(a.mediaOutlets)) {
      const oa = a.mediaOutlets[id as keyof typeof a.mediaOutlets]!;
      const ob = b.mediaOutlets[id as keyof typeof b.mediaOutlets]!;
      expect(oa.name).toBe(ob.name);
      expect(oa.accuracySpectrum).toBe(ob.accuracySpectrum);
      expect(oa.hypeSpectrum).toBe(ob.hypeSpectrum);
    }
  });
});

describe('weekly media reports (v0.62)', () => {
  it('fires reports during regular-season ticks', () => {
    let league: LeagueState = createLeague({ seed: 'media-weekly-fires' });
    expect(league.mediaReports.length).toBe(0);
    // First REGULAR_SEASON_WEEK tick plays week 1.
    league = tickPhase(league);
    expect(league.mediaReports.length).toBeGreaterThan(0);
    // All week-1 reports should be from REGULAR_SEASON_WEEK phase
    // with weekNumber === 1.
    for (const r of league.mediaReports) {
      expect(r.lifecyclePhase).toBe('REGULAR_SEASON_WEEK');
      expect(r.weekNumber).toBe(1);
    }
  });

  it('grows monotonically across the regular season', () => {
    let league: LeagueState = createLeague({ seed: 'media-weekly-growth' });
    let prevCount = 0;
    for (let i = 0; i < 5; i++) {
      league = tickPhase(league);
      expect(league.mediaReports.length).toBeGreaterThan(prevCount);
      prevCount = league.mediaReports.length;
    }
  });

  it('reports reference real outlet ids that exist in mediaOutlets', () => {
    let league: LeagueState = createLeague({ seed: 'media-outlet-fk' });
    league = tickPhase(league);
    for (const r of league.mediaReports) {
      expect(league.mediaOutlets[r.outletId]).toBeDefined();
    }
  });

  it('reports headlines reference real team identities', () => {
    let league: LeagueState = createLeague({ seed: 'media-headline-real' });
    league = tickPhase(league);
    const teamLabels = new Set<string>();
    for (const t of Object.values(league.teams)) {
      teamLabels.add(t.identity.location);
      teamLabels.add(t.identity.abbreviation);
      teamLabels.add(t.identity.nickname);
    }
    // Each headline should mention at least one of: location, abbr,
    // or nickname for a real team in the league.
    for (const r of league.mediaReports) {
      const mentionsTeam = [...teamLabels].some((label) => r.headline.includes(label));
      expect(mentionsTeam).toBe(true);
    }
  });

  it('every report kind in v0.62 is team-week-report', () => {
    let league: LeagueState = createLeague({ seed: 'media-kind-v062' });
    league = tickPhase(league);
    for (const r of league.mediaReports) {
      expect(r.kind).toBe('team-week-report');
    }
  });

  it('playoff round ticks generate reports under their phase label', () => {
    const league = simulateSeason(createLeague({ seed: 'media-playoffs' }));
    // simulateSeason walks through all regular season + playoff rounds.
    const phases = new Set(league.mediaReports.map((r) => r.lifecyclePhase));
    expect(phases.has('REGULAR_SEASON_WEEK')).toBe(true);
    expect(phases.has('WILD_CARD')).toBe(true);
    expect(phases.has('DIVISIONAL')).toBe(true);
    expect(phases.has('CONFERENCE')).toBe(true);
    expect(phases.has('SUPER_BOWL')).toBe(true);
  });

  it('determinism — same seed produces identical media stream', () => {
    const a = simulateSeason(createLeague({ seed: 'media-deterministic-stream' }));
    const b = simulateSeason(createLeague({ seed: 'media-deterministic-stream' }));
    expect(a.mediaReports.length).toBe(b.mediaReports.length);
    for (let i = 0; i < a.mediaReports.length; i++) {
      expect(a.mediaReports[i]!.headline).toBe(b.mediaReports[i]!.headline);
      expect(a.mediaReports[i]!.outletId).toBe(b.mediaReports[i]!.outletId);
      expect(a.mediaReports[i]!.tone).toBe(b.mediaReports[i]!.tone);
    }
  });

  it('Super Bowl report fires with the championship phase + championship-toned headline', () => {
    const league = simulateSeason(createLeague({ seed: 'media-super-bowl' }));
    const sbReports = league.mediaReports.filter((r) => r.lifecyclePhase === 'SUPER_BOWL');
    expect(sbReports.length).toBeGreaterThan(0);
    // At least one Super Bowl report should mention "Super Bowl" or
    // "champions" or "title".
    const sbHeadlines = sbReports.map((r) => r.headline).join('\n').toLowerCase();
    expect(/super bowl|champion|title/.test(sbHeadlines)).toBe(true);
  });
});
