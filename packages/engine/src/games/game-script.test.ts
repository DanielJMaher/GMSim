import { describe, expect, it } from 'vitest';
import { Prng } from '../prng/index.js';
import { createLeague } from '../league/generate.js';
import {
  gameScriptShift,
  SCRIPT_TRAIL_BASE,
  SCRIPT_TRAIL_SLOPE,
  SCRIPT_LEAD_BASE,
  SCRIPT_LEAD_SLOPE,
  simulateGameWithDrives,
} from './drive-sim.js';

/**
 * Game-script play-calling (v0.149 — the Scorekeeper's W-L pass-delta
 * finding). Real winners out-pass losers by only ~+9.5 yds/game because
 * trailing teams throw and leading teams run the clock out; a score-blind
 * pass rate made GMSim winners out-pass losers by ~+96 yds.
 */

describe('gameScriptShift', () => {
  it('matches the measured real table: Q4 step, lead-heavy, H1 silent', () => {
    // First half: no script regardless of score (real H1 variation is the
    // two-minute drill, uniform across score states).
    expect(gameScriptShift(-14, 0)).toBeCloseTo(0, 9);
    expect(gameScriptShift(-14, 0.49)).toBeCloseTo(0, 9);
    expect(gameScriptShift(0, 1)).toBeCloseTo(0, 9);

    // Q4 trail side: down 14+ → +0.20 (real 57→79); down ~3 → ~+0.11
    // (real 57→69 within tolerance).
    expect(gameScriptShift(-14, 1)).toBeCloseTo(SCRIPT_TRAIL_BASE + SCRIPT_TRAIL_SLOPE, 5);
    expect(gameScriptShift(-28, 1)).toBeCloseTo(SCRIPT_TRAIL_BASE + SCRIPT_TRAIL_SLOPE, 5);
    expect(gameScriptShift(-3, 1)).toBeGreaterThan(0.09);
    expect(gameScriptShift(-3, 1)).toBeLessThan(0.13);

    // Q4 lead side is HEAVIER than the trail side (real: up 14+ → 30% pass,
    // a −0.29 swing vs the trailer's +0.22) and kicks in at ANY lead.
    expect(gameScriptShift(14, 1)).toBeCloseTo(-(SCRIPT_LEAD_BASE + SCRIPT_LEAD_SLOPE), 5);
    expect(Math.abs(gameScriptShift(14, 1))).toBeGreaterThan(gameScriptShift(-14, 1));
    expect(gameScriptShift(3, 1)).toBeLessThan(-0.12); // real up-1..6 Q4 = −14pp

    // Q3: partial strength, trail side stronger than lead side.
    expect(gameScriptShift(-14, 0.6)).toBeCloseTo(0.45 * (SCRIPT_TRAIL_BASE + SCRIPT_TRAIL_SLOPE), 5);
    expect(gameScriptShift(14, 0.6)).toBeCloseTo(-0.2 * (SCRIPT_LEAD_BASE + SCRIPT_LEAD_SLOPE), 5);
  });
});

describe('game script in simulated games', () => {
  it('losers pass at a higher RATE than winners (the garbage-time signature)', () => {
    // Rate, not volume: winners sustain drives and so take more total
    // snaps — raw attempt counts confound the script with drive success.
    const league = createLeague({ seed: 'script-behavior' });
    const teams = Object.values(league.teams);
    let winnerPass = 0;
    let winnerRush = 0;
    let loserPass = 0;
    let loserRush = 0;
    let games = 0;

    for (let i = 0; i < 24; i++) {
      const home = teams[(i * 2) % teams.length]!;
      const away = teams[(i * 2 + 1) % teams.length]!;
      const res = simulateGameWithDrives(new Prng(`script:${i}`), home, away, league);
      if (res.homeScore === res.awayScore || !res.playerStats) continue;

      const homeIds = new Set<string>(home.rosterIds);
      let hp = 0;
      let hr = 0;
      let ap = 0;
      let ar = 0;
      for (const [pid, l] of res.playerStats) {
        if (homeIds.has(pid)) {
          hp += l.passAttempts;
          hr += l.rushingAttempts;
        } else {
          ap += l.passAttempts;
          ar += l.rushingAttempts;
        }
      }
      const homeWon = res.homeScore > res.awayScore;
      winnerPass += homeWon ? hp : ap;
      winnerRush += homeWon ? hr : ar;
      loserPass += homeWon ? ap : hp;
      loserRush += homeWon ? ar : hr;
      games++;
    }

    expect(games).toBeGreaterThan(15);
    const winnerShare = winnerPass / (winnerPass + winnerRush);
    const loserShare = loserPass / (loserPass + loserRush);
    // Real: losers ~0.62-0.65 pass share vs winners ~0.52-0.55. Direction +
    // a real gap is the invariant; magnitude is the Scorekeeper's job.
    expect(loserShare).toBeGreaterThan(winnerShare + 0.02);
  });
});
