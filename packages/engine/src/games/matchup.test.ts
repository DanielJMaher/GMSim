import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import { matchupFacets } from './strength.js';
import { simulateGame } from './outcome.js';
import { Prng } from '../prng/index.js';
import { Position } from '../types/enums.js';
import type { LeagueState } from '../types/league.js';
import type { PlayerSkills } from '../types/player.js';

const RUSH_KEYS: (keyof PlayerSkills)[] = [
  'getOff', 'bend', 'handTechnique', 'bullRush', 'longArm', 'pushPull',
  'swimMove', 'ripMove', 'spinRush', 'crossChop', 'ghostMove',
];
const PROTECT_KEYS: (keyof PlayerSkills)[] = ['passBlockPower', 'passBlockFinesse', 'handTechnique'];

/** Set `keys` to `value` on a team's players at the given positions. */
function setSkills(
  league: LeagueState,
  teamId: string,
  positions: readonly Position[],
  keys: readonly (keyof PlayerSkills)[],
  value: number,
): LeagueState {
  const team = league.teams[teamId as keyof typeof league.teams]!;
  const players = { ...league.players };
  const posSet = new Set<string>(positions);
  for (const id of team.rosterIds) {
    const p = players[id];
    if (!p || !posSet.has(p.position)) continue;
    const current = { ...p.current };
    for (const k of keys) current[k] = value;
    players[id] = { ...p, current };
  }
  return { ...league, players } as LeagueState;
}

describe('granular matchup facets (Stage 5 / sub-slice A)', () => {
  it('passRush facet rises when edge/interior rush skills are boosted, others unchanged', () => {
    const base = createLeague({ seed: 'mf-a' });
    const teamId = Object.keys(base.teams)[0]!;
    const f0 = matchupFacets(base.teams[teamId as keyof typeof base.teams]!, base);
    const boosted = setSkills(
      base,
      teamId,
      [Position.EDGE, Position.DT, Position.NT, Position.OLB],
      RUSH_KEYS,
      96,
    );
    const f1 = matchupFacets(boosted.teams[teamId as keyof typeof boosted.teams]!, boosted);
    expect(f1.passRush).toBeGreaterThan(f0.passRush + 8);
    // Coverage reads different players/skills — should be ~untouched.
    expect(Math.abs(f1.coverage - f0.coverage)).toBeLessThan(1);
  });

  it('passProtection facet rises when OL pass-block skills are boosted', () => {
    const base = createLeague({ seed: 'mf-b' });
    const teamId = Object.keys(base.teams)[0]!;
    const f0 = matchupFacets(base.teams[teamId as keyof typeof base.teams]!, base);
    const boosted = setSkills(
      base,
      teamId,
      [Position.LT, Position.LG, Position.C, Position.RG, Position.RT],
      PROTECT_KEYS,
      96,
    );
    const f1 = matchupFacets(boosted.teams[teamId as keyof typeof boosted.teams]!, boosted);
    expect(f1.passProtection).toBeGreaterThan(f0.passProtection + 8);
  });
});

const POWER_MOVE_KEYS: (keyof PlayerSkills)[] = ['bullRush', 'longArm', 'pushPull', 'getOff', 'handTechnique'];
const OL_POS_ALL: Position[] = [Position.LT, Position.LG, Position.C, Position.RG, Position.RT];

describe('dimensional pass-rush matchup (item 3 — OL parity)', () => {
  it('a power rush beats a weak anchor even when the OL mirrors well', () => {
    let league = createLeague({ seed: 'dim-rush' });
    const ids = Object.keys(league.teams);
    const A = ids[0]!;
    const B = ids[1]!;
    // A: elite POWER rush.
    league = setSkills(league, A, [Position.EDGE, Position.DT, Position.NT], POWER_MOVE_KEYS, 95);
    // B's OL: great mirror (pass-block finesse) but a turnstile anchor.
    league = setSkills(league, B, OL_POS_ALL, ['passBlockFinesse'], 95);
    const weakAnchor = setSkills(league, B, OL_POS_ALL, ['passBlockPower'], 32);
    const strongAnchor = setSkills(league, B, OL_POS_ALL, ['passBlockPower'], 92);

    const sacksVs = (lg: typeof league): number => {
      let s = 0;
      const teamA = lg.teams[A as keyof typeof lg.teams]!;
      const teamB = lg.teams[B as keyof typeof lg.teams]!;
      for (let i = 0; i < 50; i++) {
        const g = simulateGame(new Prng(`d${i}`), {
          homeTeam: teamA, awayTeam: teamB, league: lg, weekNumber: 1, kind: 'REGULAR',
        });
        s += g.result!.homeStats.sacks;
      }
      return s / 50;
    };
    // The power rush exploits the weak anchor despite the good mirror.
    expect(sacksVs(weakAnchor)).toBeGreaterThan(sacksVs(strongAnchor));
  });
});

describe('matchup drives the box score (Stage 5 / sub-slice B)', () => {
  it('a dominant pass rush vs a weak pass-protection makes more sacks', () => {
    let league = createLeague({ seed: 'mf-sacks' });
    const ids = Object.keys(league.teams);
    const A = ids[0]!;
    const B = ids[1]!;
    // A: elite rush. B: porous protection.
    league = setSkills(league, A, [Position.EDGE, Position.DT, Position.NT, Position.OLB], RUSH_KEYS, 96);
    league = setSkills(league, B, [Position.LT, Position.LG, Position.C, Position.RG, Position.RT], PROTECT_KEYS, 32);

    const teamA = league.teams[A as keyof typeof league.teams]!;
    const teamB = league.teams[B as keyof typeof league.teams]!;
    let sacks = 0;
    const n = 60;
    for (let i = 0; i < n; i++) {
      const g = simulateGame(new Prng(`g${i}`), {
        homeTeam: teamA,
        awayTeam: teamB,
        league,
        weekNumber: 1,
        kind: 'REGULAR',
      });
      // homeStats.sacks = A's defense's sacks (vs B's protection).
      sacks += g.result!.homeStats.sacks;
    }
    // Comfortably above the league-average ~2.4 sacks/game.
    expect(sacks / n).toBeGreaterThan(3.2);
  });
});
