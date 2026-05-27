import { describe, it, expect } from 'vitest';
import { computeProspectFormBias, productionScore, FORM_PER_GAME_CAP } from './prospect-form.js';
import { Position } from '../types/enums.js';
import { PlayerId, GameId } from '../types/ids.js';
import type { CollegePlayer } from '../types/college.js';
import type { CollegeGame, CollegePlayerGameStats } from '../types/college-season.js';
import { emptyCollegePlayerGameStats } from '../types/college-season.js';
import type { PlayerSkills } from '../types/player.js';

// ── Lightweight fixtures ────────────────────────────────────────────────
// computeProspectFormBias only reads id / collegePosition / current off a
// prospect, so a cast keeps the fixtures focused.
function uniformSkills(v: number): PlayerSkills {
  return {
    speed: v, acceleration: v, agility: v, strength: v, durability: v,
    technicalSkill: v, footballIq: v, decisionMaking: v, handsBallSkills: v,
    blockingTechnique: v, passRushTechnique: v, coverageTechnique: v,
    tacklingTechnique: v, leadership: v, competitiveness: v, workEthic: v,
    coachability: v, composure: v,
  } as PlayerSkills;
}

function cp(id: string, position: Position, skill: number): CollegePlayer {
  return {
    id: PlayerId(id),
    collegePosition: position,
    current: uniformSkills(skill),
  } as unknown as CollegePlayer;
}

function game(id: string, home: string, away: string): CollegeGame {
  return { id: GameId(id), homeSchoolId: home, awaySchoolId: away } as unknown as CollegeGame;
}

/** A game stat line for `playerId` on `schoolId` in `gameId`, with overrides. */
function line(
  playerId: string,
  schoolId: string,
  gameId: string,
  over: Partial<CollegePlayerGameStats>,
): CollegePlayerGameStats {
  return {
    ...emptyCollegePlayerGameStats(PlayerId(playerId), schoolId, GameId(gameId), 100, 1, 'REGULAR'),
    ...over,
  };
}

const AVG = 70; // matches AVG_OPPONENT_STRENGTH

describe('productionScore', () => {
  it('rewards yards + TDs and penalizes a QB interception', () => {
    const clean = line('p', 'A', 'g', { passingYards: 300, passingTds: 3 });
    const picks = line('p', 'A', 'g', { passingYards: 300, passingTds: 3, interceptionsThrown: 3 });
    expect(productionScore(clean, Position.QB)).toBeGreaterThan(
      productionScore(picks, Position.QB),
    );
  });

  it('is 0 for positions with no box-score production (OL)', () => {
    const l = line('p', 'A', 'g', { tackles: 10 }); // bogus for an OT, ignored
    expect(productionScore(l, Position.LT)).toBe(0);
  });
});

describe('computeProspectFormBias', () => {
  it('lifts a prospect who beats expectation and drops one who lays an egg', () => {
    const stud = cp('CP_stud', Position.WR, 72);
    const dud = cp('CP_dud', Position.WR, 72);
    const games = new Map([[GameId('g1'), game('g1', 'A', 'B')]]);
    const strength = new Map([['A', AVG], ['B', AVG]]);

    const bias = computeProspectFormBias({
      eligible: [stud, dud],
      gameStats: [
        line('CP_stud', 'A', 'g1', { receivingYards: 180, receivingTds: 2, receptions: 9 }),
        line('CP_dud', 'A', 'g1', { receivingYards: 15, receptions: 2 }),
      ],
      gamesById: games,
      strengthBySchool: strength,
    });

    expect(bias.get(PlayerId('CP_stud'))!).toBeGreaterThan(0);
    expect(bias.get(PlayerId('CP_dud'))!).toBeLessThan(0);
  });

  it('values the same big game more against a strong opponent than a cupcake', () => {
    const vsPower = cp('CP_a', Position.RB, 72);
    const vsCupcake = cp('CP_b', Position.RB, 72);
    const big = { rushingYards: 170, rushingTds: 2 };

    const bias = computeProspectFormBias({
      eligible: [vsPower, vsCupcake],
      gameStats: [
        line('CP_a', 'POW', 'g1', big),
        line('CP_b', 'CUP', 'g2', big),
      ],
      gamesById: new Map([
        [GameId('g1'), game('g1', 'POW', 'BAMA')], // opponent BAMA = strong
        [GameId('g2'), game('g2', 'CUP', 'FCSU')], // opponent FCSU = weak
      ]),
      strengthBySchool: new Map([
        ['POW', AVG], ['BAMA', 92],
        ['CUP', AVG], ['FCSU', 45],
      ]),
    });

    expect(bias.get(PlayerId('CP_a'))!).toBeGreaterThan(bias.get(PlayerId('CP_b'))!);
  });

  it('caps a single game but lets the season total exceed the per-game cap', () => {
    const monster = cp('CP_m', Position.RB, 72);
    const absurd = { rushingYards: 400, rushingTds: 6 };
    const one = computeProspectFormBias({
      eligible: [monster],
      gameStats: [line('CP_m', 'A', 'g1', absurd)],
      gamesById: new Map([[GameId('g1'), game('g1', 'A', 'B')]]),
      strengthBySchool: new Map([['A', AVG], ['B', AVG]]),
    });
    expect(one.get(PlayerId('CP_m'))!).toBeLessThanOrEqual(FORM_PER_GAME_CAP + 1e-9);

    const two = computeProspectFormBias({
      eligible: [monster],
      gameStats: [
        line('CP_m', 'A', 'g1', absurd),
        line('CP_m', 'A', 'g2', absurd),
      ],
      gamesById: new Map([
        [GameId('g1'), game('g1', 'A', 'B')],
        [GameId('g2'), game('g2', 'A', 'C')],
      ]),
      strengthBySchool: new Map([['A', AVG], ['B', AVG], ['C', AVG]]),
    });
    expect(two.get(PlayerId('CP_m'))!).toBeGreaterThan(FORM_PER_GAME_CAP);
  });

  it('gives an offensive lineman no box-score form bias', () => {
    const ot = cp('CP_ot', Position.LT, 72);
    const bias = computeProspectFormBias({
      eligible: [ot],
      gameStats: [line('CP_ot', 'A', 'g1', { tackles: 5 })],
      gamesById: new Map([[GameId('g1'), game('g1', 'A', 'B')]]),
      strengthBySchool: new Map([['A', AVG], ['B', AVG]]),
    });
    expect(bias.get(PlayerId('CP_ot'))!).toBe(0);
  });

  it('rewards a lower-rated prospect more than a stud for the identical line', () => {
    const noName = cp('CP_low', Position.WR, 58);
    const stud = cp('CP_high', Position.WR, 88);
    const identical = { receivingYards: 150, receivingTds: 2, receptions: 8 };

    const bias = computeProspectFormBias({
      eligible: [noName, stud],
      gameStats: [
        line('CP_low', 'A', 'g1', identical),
        line('CP_high', 'A', 'g1', identical),
      ],
      gamesById: new Map([[GameId('g1'), game('g1', 'A', 'B')]]),
      strengthBySchool: new Map([['A', AVG], ['B', AVG]]),
    });

    // The stud was expected to produce; the no-name exceeded his station.
    expect(bias.get(PlayerId('CP_low'))!).toBeGreaterThan(bias.get(PlayerId('CP_high'))!);
  });
});
