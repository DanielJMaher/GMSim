import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import { assembleProspectDossier, type DossierViewer, type ProspectDossier } from './dossier.js';
import { bandPolarity } from '../media/skill-vocabulary.js';
import type { LeagueState } from '../types/league.js';
import type { TeamId, PlayerId } from '../types/ids.js';

const league = createLeague({ seed: 'dossier-base' });

/** The team whose college-scout staff includes `scoutId`. */
function teamOfScout(lg: LeagueState, scoutId: string): TeamId | null {
  for (const t of Object.values(lg.teams)) {
    if ((t.collegeScoutIds as unknown as string[]).includes(scoutId)) return t.identity.id;
  }
  return null;
}

/** Pick an (team, prospect) pair the initial sweep produced pros+cons for. */
function pickRichTarget(lg: LeagueState): { teamId: TeamId; prospectId: PlayerId; dossier: ProspectDossier } {
  let best: { teamId: TeamId; prospectId: PlayerId; dossier: ProspectDossier; score: number } | null = null;
  const seen = new Set<string>();
  for (const o of lg.collegeObservations) {
    const key = `${o.scoutId}:${o.collegePlayerId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const teamId = teamOfScout(lg, o.scoutId as string);
    if (!teamId) continue;
    const d = assembleProspectDossier(lg, { kind: 'team', teamId }, o.collegePlayerId);
    if (!d) continue;
    const score = d.pros.length + d.cons.length;
    if (!best || score > best.score) best = { teamId, prospectId: o.collegePlayerId, dossier: d, score };
    if (best.score >= 4) break;
  }
  if (!best) throw new Error('no observed prospect found');
  return best;
}

describe('assembleProspectDossier — team viewer', () => {
  const { teamId, dossier } = pickRichTarget(league);
  const viewer: DossierViewer = { kind: 'team', teamId };

  it('returns a populated dossier with reads on the prospect', () => {
    expect(dossier.observationCount).toBeGreaterThan(0);
    expect(dossier.perceivedGrade).not.toBeNull();
    expect(dossier.realGrade).not.toBeNull();
    expect(dossier.pros.length + dossier.cons.length).toBeGreaterThan(0);
  });

  it('attributes every pro/con to a real scout (or coach) on that team', () => {
    const team = league.teams[teamId]!;
    const scoutIds = new Set<string>(team.collegeScoutIds as unknown as string[]);
    scoutIds.add(team.headCoachId as unknown as string);
    for (const p of [...dossier.pros, ...dossier.cons]) {
      expect(scoutIds.has(p.sourceId)).toBe(true);
      expect(p.sourceName.length).toBeGreaterThan(0);
    }
  });

  it('pros come from positive bands and cons from negative bands', () => {
    for (const p of dossier.pros) expect(bandPolarity(p.band)).toBe('positive');
    for (const c of dossier.cons) expect(bandPolarity(c.band)).toBe('negative');
  });

  it('never speaks a number in any pro/con/scheme/writeup text (North Star)', () => {
    const prose = [
      ...dossier.pros.map((p) => p.text),
      ...dossier.cons.map((c) => c.text),
      dossier.schemeFit,
      dossier.writeup,
    ].join(' ');
    expect(prose).not.toMatch(/\d/);
  });

  it('returns null for an unknown prospect', () => {
    expect(assembleProspectDossier(league, viewer, 'NOPE' as PlayerId)).toBeNull();
  });
});

describe('assembleProspectDossier — outlet viewer (no media reads yet at creation)', () => {
  it('returns an identity card with empty pros/cons and a no-report writeup', () => {
    const outlet = Object.values(league.mediaOutlets)[0]!;
    const someProspect = league.collegePool[0]!;
    const d = assembleProspectDossier(league, { kind: 'outlet', outletId: outlet.id }, someProspect.id);
    expect(d).not.toBeNull();
    expect(d!.observationCount).toBe(0);
    expect(d!.pros.length).toBe(0);
    expect(d!.writeup).toContain('no report on file');
    expect(d!.viewerLabel).toBe(outlet.name);
  });
});

describe('Living Voice — same world, different voice', () => {
  it('keeps the bands/attributes identical but changes the wording', () => {
    const a = createLeague({ seed: 'dossier-base', voiceSeed: 'voice-A' });
    const b = createLeague({ seed: 'dossier-base', voiceSeed: 'voice-B' });
    const { teamId, prospectId } = pickRichTarget(a);
    const viewer: DossierViewer = { kind: 'team', teamId };
    const da = assembleProspectDossier(a, viewer, prospectId)!;
    const db = assembleProspectDossier(b, viewer, prospectId)!;

    // Structure (which attributes, which bands, which scout) is world-seeded.
    expect(db.pros.map((p) => `${p.skillKey}:${p.band}:${p.sourceId}`)).toEqual(
      da.pros.map((p) => `${p.skillKey}:${p.band}:${p.sourceId}`),
    );
    expect(db.perceivedGrade).toBe(da.perceivedGrade);
    // Words differ.
    const wordsA = [...da.pros, ...da.cons].map((p) => p.text).join('|') + da.writeup;
    const wordsB = [...db.pros, ...db.cons].map((p) => p.text).join('|') + db.writeup;
    expect(wordsB).not.toBe(wordsA);
  });
});
