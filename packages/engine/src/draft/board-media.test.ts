import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import { regenerateDraftBoardsForLeague } from './board.js';
import type { LeagueState } from '../types/league.js';
import type { CollegePlayerObservation, DraftBoardEntry } from '../types/college.js';
import type { Gm } from '../types/personnel.js';
import type { MediaOutlet } from '../types/media.js';
import type { PlayerSkills } from '../types/player.js';
import { ScoutId, type TeamId, type GmId, type MediaOutletId } from '../types/ids.js';

function regen(
  league: LeagueState,
  gms: Readonly<Record<GmId, Gm>>,
  mediaObs: readonly CollegePlayerObservation[],
  mediaOutlets?: Readonly<Record<MediaOutletId, MediaOutlet>>,
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
    mediaOutlets,
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

  it('a sharp outlet moves the board more than a junk outlet (#5 slice 2a)', () => {
    const league = createLeague({ seed: 'media-outlet-weight' });
    const teamId = (Object.keys(league.teams) as TeamId[])[0]!;
    const gmId = league.teams[teamId]!.gmId;

    const baseBoard = regen(league, league.gms, [])[teamId]!;
    const entry = baseBoard.find((e) => e.observedSkillScore < 85) ?? baseBoard[0]!;
    const pid = entry.collegePlayerId;
    const prospect = league.collegePool.find((p) => p.id === pid)!;

    const skills: Partial<Record<keyof PlayerSkills, number>> = {};
    const confidence: Partial<Record<keyof PlayerSkills, number>> = {};
    for (const k of Object.keys(prospect.current) as (keyof PlayerSkills)[]) {
      skills[k] = 99;
      confidence[k] = 0.95;
    }
    // One outlet, one evaluator — identical read; only the outlet's accuracy differs.
    const outletId = (Object.keys(league.mediaOutlets) as MediaOutletId[])[0]!;
    const baseOutlet = league.mediaOutlets[outletId]!;
    const mediaObs: CollegePlayerObservation[] = [
      { scoutId: ScoutId(`${outletId}::e0`), collegePlayerId: pid, observedOnTick: league.tick, skills, confidence },
    ];
    const withAccuracy = (acc: number): Record<MediaOutletId, MediaOutlet> => {
      const byGroup = Object.fromEntries(
        Object.keys(baseOutlet.accuracyByGroup).map((g) => [g, acc]),
      ) as MediaOutlet['accuracyByGroup'];
      return { [outletId]: { ...baseOutlet, accuracySpectrum: acc, accuracyByGroup: byGroup } } as Record<
        MediaOutletId,
        MediaOutlet
      >;
    };

    const gms = withTrust(league, gmId, 10);
    const scoreFor = (outlets: Record<MediaOutletId, MediaOutlet>): number =>
      regen(league, gms, mediaObs, outlets)[teamId]!.find((e) => e.collegePlayerId === pid)!.observedSkillScore;

    const sharp = scoreFor(withAccuracy(10));
    const junk = scoreFor(withAccuracy(2));
    expect(sharp).toBeGreaterThan(junk + 0.5);
  });

  it('a media riser climbs a trusting GM’s board RANK → gets drafted higher (#5 slice 2b)', () => {
    // The draft picks top-of-board and trade-ups target highest-board-priority,
    // so a higher RANK directly means picked/traded-for higher. We prove media
    // moves rank, which is how picks inherit media consumption.
    const league = createLeague({ seed: 'media-pick-rank' });
    const teamId = (Object.keys(league.teams) as TeamId[])[0]!;
    const gmId = league.teams[teamId]!.gmId;

    const baseBoard = regen(league, league.gms, [])[teamId]!;
    // Pick a mid-board prospect (room to climb), not already a top pick.
    const target = baseBoard[Math.floor(baseBoard.length / 2)]!;
    const pid = target.collegePlayerId;
    const baseRank = baseBoard.findIndex((e) => e.collegePlayerId === pid);

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

    const trustingBoard = regen(league, withTrust(league, gmId, 10), mediaObs)[teamId]!;
    const newRank = trustingBoard.findIndex((e) => e.collegePlayerId === pid);

    // Lower index = higher on the board = picked/traded-for sooner.
    expect(newRank).toBeLessThan(baseRank);
  });

  it('GM mediaTrust spectrum is populated for every generated GM', () => {
    const league = createLeague({ seed: 'media-trust-gen' });
    for (const gm of Object.values(league.gms)) {
      expect(gm.spectrums.mediaTrust).toBeGreaterThanOrEqual(1);
      expect(gm.spectrums.mediaTrust).toBeLessThanOrEqual(10);
    }
  });
});
