import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from '../season/runner.js';
import { migrateLeagueForward } from '../season/migrations.js';
import { generateNflPlayerTakes } from './nfl-takes.js';
import { deriveVoiceSeed, voicePrng } from './voice.js';
import type { LeagueState } from '../types/league.js';

describe('deriveVoiceSeed', () => {
  it('derives a stable, decoupled default from the world seed', () => {
    expect(deriveVoiceSeed('abc')).toBe('abc::voice');
    expect(deriveVoiceSeed('abc')).toBe(deriveVoiceSeed('abc'));
    expect(deriveVoiceSeed('abc')).not.toBe(deriveVoiceSeed('abd'));
  });
});

describe('voicePrng', () => {
  it('is deterministic for the same voiceSeed + context', () => {
    expect(voicePrng('vs', 1, 'x').next()).toBe(voicePrng('vs', 1, 'x').next());
  });

  it('varies with the voiceSeed and with the context', () => {
    const base = voicePrng('vs', 1, 'x').next();
    expect(voicePrng('vs2', 1, 'x').next()).not.toBe(base); // different voice
    expect(voicePrng('vs', 2, 'x').next()).not.toBe(base); // different context
  });
});

describe('createLeague + voiceSeed', () => {
  it('defaults voiceSeed to the derived value when omitted (engine stays deterministic)', () => {
    expect(createLeague({ seed: 'world-1' }).voiceSeed).toBe(deriveVoiceSeed('world-1'));
  });

  it('reproduces a league exactly given the same (seed, voiceSeed)', () => {
    const a = createLeague({ seed: 'world-1', voiceSeed: 'voice-A' });
    const b = createLeague({ seed: 'world-1', voiceSeed: 'voice-A' });
    expect(b).toEqual(a);
  });

  it('same seed + different voiceSeed → identical ground truth (players, ratings, measurables)', () => {
    const a = createLeague({ seed: 'world-1', voiceSeed: 'voice-A' });
    const b = createLeague({ seed: 'world-1', voiceSeed: 'voice-B' });
    // The voice seed must NOT leak into true WORLD state (players, ratings,
    // measurables) — those are world-seeded and identical.
    expect(b.players).toEqual(a.players);
    expect(b.collegePool).toEqual(a.collegePool);
    expect(b.combineResults).toEqual(a.combineResults);
    expect(b.voiceSeed).not.toBe(a.voiceSeed);
    // Draft boards ARE a perception layer (v0.127: voiceSeed drives which teams
    // identify position conversions), so they legitimately diverge by voiceSeed.
    expect(b.draftBoards).not.toEqual(a.draftBoards);
  });
});

describe('Living Voice split — same world, different voice', () => {
  // Same world seed, two different voice seeds. The world (players + every game
  // result) must be byte-identical; the WORDS of the media takes must differ.
  const a = simulateSeason(createLeague({ seed: 'voice-split', voiceSeed: 'voice-A' }));
  const b = simulateSeason(createLeague({ seed: 'voice-split', voiceSeed: 'voice-B' }));

  it('keeps the world identical (players + game results)', () => {
    expect(b.players).toEqual(a.players);
    const scores = (lg: LeagueState) => lg.schedule!.regularSeason.flat().map((g) => g.result);
    expect(scores(b)).toEqual(scores(a));
  });

  it('selects the same standouts (selection is world-seeded) but says different words', () => {
    const weekA = a.schedule!.regularSeason[0]!;
    const weekB = b.schedule!.regularSeason[0]!;
    const takesA = generateNflPlayerTakes(a, weekA, 'REGULAR_SEASON_WEEK', 1, 5);
    const takesB = generateNflPlayerTakes(b, weekB, 'REGULAR_SEASON_WEEK', 1, 5);

    expect(takesA.length).toBeGreaterThan(0);
    // Same subjects, same order → selection did not move with the voice seed.
    expect(takesB.map((t) => t.subjectPlayerId)).toEqual(takesA.map((t) => t.subjectPlayerId));
    // Different voice → at least one headline reads differently.
    expect(takesB.map((t) => t.headline)).not.toEqual(takesA.map((t) => t.headline));
  });
});

describe('migrateLeagueForward — voiceSeed backfill', () => {
  it('backfills a missing voiceSeed to the derived default (pre-v0.124 saves)', () => {
    const fresh = createLeague({ seed: 'migrate-1' });
    const stripped = { ...fresh } as Record<string, unknown>;
    delete stripped.voiceSeed;
    const migrated = migrateLeagueForward(stripped as unknown as LeagueState);
    expect(migrated.voiceSeed).toBe(deriveVoiceSeed('migrate-1'));
  });
});
