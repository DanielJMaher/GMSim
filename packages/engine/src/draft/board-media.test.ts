import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import { regenerateDraftBoardsForLeague } from './board.js';
import type { LeagueState } from '../types/league.js';
import type { CollegePlayerObservation, DraftBoardEntry } from '../types/college.js';
import type { Gm } from '../types/personnel.js';
import type { PlayerSkills } from '../types/player.js';
import { ScoutId, type TeamId, type GmId } from '../types/ids.js';

function regen(
  league: LeagueState,
  gms: Readonly<Record<GmId, Gm>>,
  mediaObs: readonly CollegePlayerObservation[],
): Record<TeamId, DraftBoardEntry[]> {
  return regenerateDraftBoardsForLeague({
    teams: league.teams,
    collegeScouts: league.collegeScouts,
    coaches: league.coaches,
    players: league.players,
    collegePool: league.collegePool,
    observations: league.collegeObservations,
    addedOnTick: league.tick,
    combineResults: league.combineResults,
    mediaObservations: mediaObs,
    gms,
  });
}

function withTrust(league: LeagueState, gmId: GmId, mediaTrust: number): Record<GmId, Gm> {
  const gm = league.gms[gmId]!;
  return { ...league.gms, [gmId]: { ...gm, spectrums: { ...gm.spectrums, mediaTrust } } };
}

describe('GMs consume the media (#5)', () => {
  it('a media-trusting GM is pulled toward a strong media read; a skeptic is not', () => {
    const league = createLeague({ seed: 'media-consume' });
    const teamId = (Object.keys(league.teams) as TeamId[])[0]!;
    const gmId = league.teams[teamId]!.gmId;

    // Baseline board with no media.
    const baseBoard = regen(league, league.gms, [])[teamId]!;
    const entry = baseBoard.find((e) => e.observedSkillScore < 85) ?? baseBoard[0]!;
    const pid = entry.collegePlayerId;
    const baseScore = entry.observedSkillScore;

    // Craft a strong, high-confidence media read for that prospect (all skills 99).
    const prospect = league.collegePool.find((p) => p.id === pid)!;
    const skills: Partial<Record<keyof PlayerSkills, number>> = {};
    const confidence: Partial<Record<keyof PlayerSkills, number>> = {};
    for (const k of Object.keys(prospect.current) as (keyof PlayerSkills)[]) {
      skills[k] = 99;
      confidence[k] = 0.95;
    }
    const mediaObs: CollegePlayerObservation[] = [0, 1, 2].map((i) => ({
      scoutId: ScoutId(`MEDIA_OUTLET_${i}`),
      collegePlayerId: pid,
      observedOnTick: league.tick,
      skills,
      confidence,
    }));

    const scoreFor = (gms: Record<GmId, Gm>): number =>
      regen(league, gms, mediaObs)[teamId]!.find((e) => e.collegePlayerId === pid)!.observedSkillScore;

    const highScore = scoreFor(withTrust(league, gmId, 10));
    const lowScore = scoreFor(withTrust(league, gmId, 1));

    // The media-driven GM's talent read on the prospect is pulled up toward
    // the (high) media consensus; the skeptic (trust 1 → zero weight) is not.
    expect(highScore).toBeGreaterThan(baseScore + 1);
    expect(lowScore).toBeCloseTo(baseScore, 5);
    expect(highScore).toBeGreaterThan(lowScore + 1);
  });

  it('GM mediaTrust spectrum is populated for every generated GM', () => {
    const league = createLeague({ seed: 'media-trust-gen' });
    for (const gm of Object.values(league.gms)) {
      expect(gm.spectrums.mediaTrust).toBeGreaterThanOrEqual(1);
      expect(gm.spectrums.mediaTrust).toBeLessThanOrEqual(10);
    }
  });
});
