import { describe, it, expect } from 'vitest';
import { Prng } from '../prng/index.js';
import { simulateCollegeGame } from './outcome.js';
import { GameId } from '../types/ids.js';
import type { CollegeGame } from '../types/college-season.js';

function makeGame(id: string, home: string, away: string): CollegeGame {
  return {
    id: GameId(id),
    weekNumber: 1,
    homeSchoolId: home,
    awaySchoolId: away,
    bowlName: null,
    result: null,
    kind: 'REGULAR',
  };
}

describe('simulateCollegeGame', () => {
  it('produces a populated result with a clear winner', () => {
    const game = makeGame('G1', 'ALABAMA', 'AKRON');
    const played = simulateCollegeGame(new Prng('test'), {
      game,
      homeStrength: 85,
      awayStrength: 50,
    });
    expect(played.result).not.toBeNull();
    expect(played.result!.homeScore).not.toBe(played.result!.awayScore);
  });

  it('is deterministic for a given prng + inputs', () => {
    const game = makeGame('G2', 'OHIO_STATE', 'PURDUE');
    const a = simulateCollegeGame(new Prng('det'), {
      game,
      homeStrength: 80,
      awayStrength: 65,
    });
    const b = simulateCollegeGame(new Prng('det'), {
      game,
      homeStrength: 80,
      awayStrength: 65,
    });
    expect(a.result).toEqual(b.result);
  });

  it('home team wins most evenly-matched games (HFA visible across N rolls)', () => {
    let homeWins = 0;
    for (let i = 0; i < 200; i++) {
      const game = makeGame(`G_${i}`, 'GEORGIA', 'TENNESSEE');
      const played = simulateCollegeGame(new Prng(`hfa-${i}`), {
        game,
        homeStrength: 75,
        awayStrength: 75,
      });
      if (played.result!.homeScore > played.result!.awayScore) homeWins++;
    }
    // Home field advantage of 4 points → expect home to win 55-65%.
    expect(homeWins / 200).toBeGreaterThan(0.50);
    expect(homeWins / 200).toBeLessThan(0.75);
  });

  it('mismatched games go to the favorite the vast majority of the time', () => {
    let topWins = 0;
    for (let i = 0; i < 200; i++) {
      const game = makeGame(`G_${i}`, 'ALABAMA', 'SMALL_NE');
      const played = simulateCollegeGame(new Prng(`mismatch-${i}`), {
        game,
        homeStrength: 90,
        awayStrength: 40,
      });
      if (played.result!.homeScore > played.result!.awayScore) topWins++;
    }
    // 50-point strength gap should produce ~97%+ favorite wins.
    expect(topWins / 200).toBeGreaterThan(0.92);
  });

  it('scores are in plausible college ranges', () => {
    for (let i = 0; i < 100; i++) {
      const game = makeGame(`G_${i}`, 'LSU', 'OLE_MISS');
      const played = simulateCollegeGame(new Prng(`scores-${i}`), {
        game,
        homeStrength: 78,
        awayStrength: 72,
      });
      const total = played.result!.homeScore + played.result!.awayScore;
      expect(total).toBeGreaterThanOrEqual(7);
      expect(total).toBeLessThanOrEqual(140);
    }
  });
});
