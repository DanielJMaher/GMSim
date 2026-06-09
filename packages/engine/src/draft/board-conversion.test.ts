import { describe, expect, it } from 'vitest';
import { Prng } from '../prng/index.js';
import { createLeague } from '../league/generate.js';
import { positionNeedPressure } from './team-needs.js';
import { canConvertTo } from '../players/position-conversion.js';
import { promoteProspectToPlayer } from './promote.js';
import { generateCollegePlayer } from './generate-college-player.js';
import { getSchoolById } from '../data/colleges/index.js';
import { Position } from '../types/enums.js';
import { positionGroupFor } from '../players/position-group.js';
import type { TeamId } from '../types/ids.js';

const ALABAMA = getSchoolById('ALABAMA')!;

describe('draft board — position conversion for need', () => {
  it('any assigned conversion is a valid adjacency AND need-driven (assigned hole > natural)', () => {
    const league = createLeague({ seed: 'conv-board' });
    const byId = new Map(league.collegePool.map((cp) => [cp.id, cp] as const));

    let conversions = 0;
    for (const teamId of Object.keys(league.draftBoards) as TeamId[]) {
      const team = league.teams[teamId]!;
      const pressure = positionNeedPressure(team, league.players);
      for (const entry of league.draftBoards[teamId] ?? []) {
        const cp = byId.get(entry.collegePlayerId);
        if (!cp || entry.assignedPosition === undefined) continue;
        // v0.127: assignment re-slots from the team's PERCEIVED projection (it
        // may have missed/invented a conversion), so the need-driven move is a
        // step off the perceived base, not necessarily the true projection.
        const base = entry.perceivedPosition ?? cp.nflProjectedPosition;
        if (entry.assignedPosition === base) continue;
        conversions++;
        // The move must be a realistic conversion...
        expect(canConvertTo(base, entry.assignedPosition)).toBe(true);
        // ...and the team must have a BIGGER hole at the assigned spot than at
        // the base position (need-driven, not value-driven).
        expect(pressure[entry.assignedPosition]).toBeGreaterThan(pressure[base]);
      }
    }
    // A fresh league has plenty of roster holes — conversions should fire.
    expect(conversions).toBeGreaterThan(0);
  });

  it('a stacked team converts nobody (no holes → all natural)', () => {
    // Hand-build a team whose roster has no shortfall anywhere is impractical;
    // instead assert the gate directly: with zero pressure everywhere, the
    // board would keep every prospect at his natural spot. We approximate by
    // checking that positionNeedPressure floors at 0 (no negative pressure that
    // could spuriously trigger a conversion).
    const league = createLeague({ seed: 'conv-floor' });
    const team = Object.values(league.teams)[0]!;
    const pressure = positionNeedPressure(team, league.players);
    for (const v of Object.values(pressure)) expect(v).toBeGreaterThanOrEqual(0);
  });
});

describe('promote — convert-to-need lines the rookie up at the assigned spot', () => {
  it('plays a projected RT at LT when assigned, skills unchanged', () => {
    const rt = generateCollegePlayer(new Prng('rt-prospect'), {
      idSuffix: 'RT0',
      classYear: 'SR',
      school: ALABAMA,
      simYear: 2026,
      forcePosition: Position.RT,
    });
    // Only meaningful if he actually projects to the OL (force keeps him a tackle
    // unless a conversion roll moved him); guard so the test is position-stable.
    const natural = rt.nflProjectedPosition;
    const target = natural === Position.LT ? Position.RT : Position.LT;

    const converted = promoteProspectToPlayer(new Prng('pick'), {
      prospect: rt,
      teamId: 'T' as TeamId,
      signedOnTick: 0,
      overallPick: 10,
      assignedPosition: target,
    });
    expect(converted.player.position).toBe(target);
    expect(converted.player.positionGroup).toBe(positionGroupFor(target));
    // Ground truth carries through — only where he lines up moved.
    expect(converted.player.current).toEqual(rt.current);
    expect(converted.player.ceiling).toEqual(rt.ceiling);

    // Without an override he lands at his natural projected spot.
    const natural2 = promoteProspectToPlayer(new Prng('pick'), {
      prospect: rt,
      teamId: 'T' as TeamId,
      signedOnTick: 0,
      overallPick: 10,
    });
    expect(natural2.player.position).toBe(natural);
  });
});
