import { describe, it, expect } from 'vitest';
import { buildNflPlayerTake, generateNflPlayerTakes } from './nfl-takes.js';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from '../season/runner.js';
import { Prng } from '../prng/index.js';
import type { MediaOutlet } from '../types/media.js';
import type { Player } from '../types/player.js';
import type { TeamState } from '../types/team.js';
import type { GameHeadliner } from './headliners.js';
import type { PlayerId, TeamId } from '../types/ids.js';

const league = createLeague({ seed: 'nfl-takes-base' });
const teams = Object.values(league.teams);
const team = teams[0]!;
const opp = teams[1]!;
const outlet = Object.values(league.mediaOutlets).find((o) => o.focus !== 'COLLEGE')!;
const loud: MediaOutlet = { ...outlet, hypeSpectrum: 9 };

const players = Object.values(league.players);
const highPick = players.find((p) => p.draftRound !== null && p.draftRound <= 2)!;
const lowPick = players.find((p) => p.draftRound === null || p.draftRound >= 5)!;

function headliner(player: Player, kind: GameHeadliner['kind'], stat: number): GameHeadliner {
  return {
    playerId: player.id,
    playerLastName: player.lastName,
    playerPosition: player.position,
    teamId: player.teamId as TeamId,
    kind,
    stat,
    secondaryStat: 0,
  };
}

const baseArgs = (player: Player, o: MediaOutlet, h: GameHeadliner) => ({
  player,
  outlet: o,
  headliner: h,
  team: team as TeamState,
  opp: opp as TeamState,
  seasonNumber: 1,
  weekNumber: 4,
  lifecyclePhase: 'REGULAR_SEASON_WEEK' as const,
  filedOnTick: 10,
  idSuffix: 'x',
});

describe('buildNflPlayerTake', () => {
  it('builds an NFL (non-college) player-take with the player baked in', () => {
    const r = buildNflPlayerTake(new Prng('t'), baseArgs(highPick, outlet, headliner(highPick, 'wr-big-day', 130)));
    expect(r.kind).toBe('player-take');
    if (r.kind === 'player-take') {
      expect(r.subjectIsCollegeProspect).toBe(false);
      expect(r.subjectPlayerId).toBe(highPick.id);
      expect(r.scoutReport).toBeDefined();
    }
    expect(r.headline).toContain(highPick.lastName);
  });

  it('is deterministic for the same prng + args', () => {
    const a = buildNflPlayerTake(new Prng('z'), baseArgs(lowPick, loud, headliner(lowPick, 'rb-monster', 170)));
    const b = buildNflPlayerTake(new Prng('z'), baseArgs(lowPick, loud, headliner(lowPick, 'rb-monster', 170)));
    expect(a).toEqual(b);
  });

  it('frames a negative outing as a critical, struggling take', () => {
    const r = buildNflPlayerTake(new Prng('n'), baseArgs(highPick, outlet, headliner(highPick, 'qb-blame-loss', 4)));
    expect(r.tone).toBe('CRITICAL');
  });

  it('frames a positive outing as a positive take', () => {
    const r = buildNflPlayerTake(new Prng('p'), baseArgs(lowPick, outlet, headliner(lowPick, 'wr-big-day', 120)));
    expect(r.tone).toBe('POSITIVE');
  });

  it('keeps the scout-report body qualitative — no rating/stat numbers in the prose', () => {
    const r = buildNflPlayerTake(new Prng('q'), baseArgs(highPick, outlet, headliner(highPick, 'wr-big-day', 130)));
    if (r.kind === 'player-take' && r.scoutReport) {
      const body = [
        r.scoutReport.summary,
        ...r.scoutReport.strengths,
        r.scoutReport.concern,
        r.scoutReport.bottomLine,
      ].join(' ');
      expect(body).not.toMatch(/\d/);
    }
  });
});

describe('generateNflPlayerTakes', () => {
  const played = simulateSeason(createLeague({ seed: 'nfl-takes-sim' }));
  const week0 = played.schedule!.regularSeason[0]!;

  it('files Scribe-voiced takes for a played week, capped and de-duped', () => {
    const takes = generateNflPlayerTakes(
      played,
      week0,
      'REGULAR_SEASON_WEEK',
      1,
      5,
      6,
    );
    expect(takes.length).toBeGreaterThan(0);
    expect(takes.length).toBeLessThanOrEqual(6);
    const subjects = new Set<PlayerId>();
    for (const t of takes) {
      expect(t.kind).toBe('player-take');
      if (t.kind === 'player-take') {
        expect(t.subjectIsCollegeProspect).toBe(false);
        expect(t.scoutReport).toBeDefined();
        subjects.add(t.subjectPlayerId);
      }
      expect(league.mediaOutlets[t.outletId] ?? played.mediaOutlets[t.outletId]).toBeDefined();
    }
    // De-duped: at most one take per player.
    expect(subjects.size).toBe(takes.length);
  });

  it('is deterministic for the same league (same world + voice seed)', () => {
    const a = generateNflPlayerTakes(played, week0, 'REGULAR_SEASON_WEEK', 1, 5);
    const b = generateNflPlayerTakes(played, week0, 'REGULAR_SEASON_WEEK', 1, 5);
    expect(a).toEqual(b);
  });
});
