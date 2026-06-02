import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import { regenerateDraftBoardsForLeague } from './board.js';
import type { LeagueState } from '../types/league.js';
import type { CollegePlayerObservation, DraftBoardEntry } from '../types/college.js';
import type { Gm } from '../types/personnel.js';
import type { MediaOutlet } from '../types/media.js';
import type { PlayerSkills } from '../types/player.js';
import { ScoutId, type TeamId, type GmId, type MediaOutletId } from '../types/ids.js';
import type { PositionGroup } from '../types/enums.js';
import { positionGroupFor } from '../players/position-group.js';

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

  it('an outlet a GM PERCEIVES as sharp moves the board more than one it reads as junk (#5 slice 2)', () => {
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
    const outletId = (Object.keys(league.mediaOutlets) as MediaOutletId[])[0]!;
    const mediaObs: CollegePlayerObservation[] = [
      { scoutId: ScoutId(`${outletId}::e0`), collegePlayerId: pid, observedOnTick: league.tick, skills, confidence },
    ];

    // Slice 2: weighting follows the GM's PERCEIVED reliability of the outlet,
    // not the outlet's ground truth. Override this GM's belief about the outlet
    // (all groups) to elite vs junk; keep mediaTrust high so the blend is live.
    const groups = Object.keys(league.mediaOutlets[outletId]!.accuracyByGroup) as PositionGroup[];
    const withPerceived = (acc: number): Record<GmId, Gm> => {
      const gm = league.gms[gmId]!;
      const perGroup = Object.fromEntries(groups.map((g) => [g, acc])) as Record<PositionGroup, number>;
      return {
        ...league.gms,
        [gmId]: {
          ...gm,
          spectrums: { ...gm.spectrums, mediaTrust: 10 },
          perceivedOutletReliability: { ...gm.perceivedOutletReliability, [outletId]: perGroup },
        },
      };
    };

    const scoreFor = (gms: Record<GmId, Gm>): number =>
      regen(league, gms, mediaObs, league.mediaOutlets)[teamId]!.find((e) => e.collegePlayerId === pid)!
        .observedSkillScore;

    const sharp = scoreFor(withPerceived(10));
    const junk = scoreFor(withPerceived(2));
    expect(sharp).toBeGreaterThan(junk + 0.5);
  });

  it('two GMs with EQUAL mediaTrust but different perceptions read the same outlet differently (#5 slice 2)', () => {
    // The omniscience fix: pre-Slice-2 these two GMs would have been identical
    // (both weight by the outlet's true accuracy). Now the believer is pulled
    // and the doubter is not.
    const league = createLeague({ seed: 'media-perceive-divergence' });
    const teamId = (Object.keys(league.teams) as TeamId[])[0]!;
    const gmId = league.teams[teamId]!.gmId;

    const baseBoard = regen(league, league.gms, [])[teamId]!;
    const entry = baseBoard.find((e) => e.observedSkillScore < 85) ?? baseBoard[0]!;
    const pid = entry.collegePlayerId;
    const prospect = league.collegePool.find((p) => p.id === pid)!;
    const baseScore = entry.observedSkillScore;

    const skills: Partial<Record<keyof PlayerSkills, number>> = {};
    const confidence: Partial<Record<keyof PlayerSkills, number>> = {};
    for (const k of Object.keys(prospect.current) as (keyof PlayerSkills)[]) {
      skills[k] = 99;
      confidence[k] = 0.95;
    }
    const outletId = (Object.keys(league.mediaOutlets) as MediaOutletId[])[0]!;
    const grp = positionGroupFor(prospect.nflProjectedPosition);
    const mediaObs: CollegePlayerObservation[] = [
      { scoutId: ScoutId(`${outletId}::e0`), collegePlayerId: pid, observedOnTick: league.tick, skills, confidence },
    ];

    const gmWith = (acc: number): Record<GmId, Gm> => {
      const gm = league.gms[gmId]!;
      const existing = gm.perceivedOutletReliability?.[outletId];
      return {
        ...league.gms,
        [gmId]: {
          ...gm,
          spectrums: { ...gm.spectrums, mediaTrust: 8 }, // EQUAL trust for both
          perceivedOutletReliability: {
            ...gm.perceivedOutletReliability,
            [outletId]: { ...(existing as Record<PositionGroup, number>), [grp]: acc },
          },
        },
      };
    };
    const scoreFor = (gms: Record<GmId, Gm>): number =>
      regen(league, gms, mediaObs, league.mediaOutlets)[teamId]!.find((e) => e.collegePlayerId === pid)!
        .observedSkillScore;

    const believer = scoreFor(gmWith(10));
    const doubter = scoreFor(gmWith(1));
    expect(believer).toBeGreaterThan(doubter);
    expect(believer).toBeGreaterThan(baseScore);
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
