import { describe, expect, it } from 'vitest';

import { createLeague } from '../league/generate.js';
import { Prng } from '../prng/index.js';
import { generateInitialCollegeObservations } from '../draft/college-observation.js';
import { positionGroupFor } from '../players/position-group.js';
import { asGameLeague, unwrapGameLeague } from './game-session.js';
import { scoutStaffView, assignScout } from './scout-staff.js';
import type { ScoutId, TeamId } from '../types/ids.js';
import type { PositionGroup } from '../types/enums.js';
import type { CollegeScout } from '../types/college.js';

/**
 * The assignments screen (SCOUTING_PROCESS §4), scoped back to position-only.
 *
 * Two properties carry the design and both are gated here: coverage FOLLOWS the
 * assignment, and accuracy does NOT — which is what makes mis-assignment bite
 * without a bespoke penalty existing to drift.
 */
const FORBIDDEN_KEYS = ['trueAccuracy', 'preferredRegion', 'current', 'ceiling', 'talentScore'];

function allKeysDeep(value: unknown, found: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) allKeysDeep(v, found);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      found.add(k);
      allKeysDeep(v, found);
    }
  }
}

const base = asGameLeague(createLeague({ seed: 'knowledge-scout-staff' }));
const teamId = Object.keys((base as never as { teams: object }).teams)[0] as TeamId;

describe('knowledge/scoutStaffView', () => {
  it('lists the club’s college scouts with identity and specialty', () => {
    const staff = scoutStaffView(base, teamId);
    expect(staff.length).toBeGreaterThan(0);
    for (const s of staff) {
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.knownSpecialty.length).toBeGreaterThan(0);
      expect(s.yearsExperience).toBeGreaterThanOrEqual(0);
      // Nobody is assigned at genesis — the neglect default.
      expect(s.assignedGroup).toBeNull();
      expect(s.offSpecialty).toBe(false);
    }
  });

  it('never shows how good a scout actually is', () => {
    const keys = new Set<string>();
    allKeysDeep(scoutStaffView(base, teamId), keys);
    for (const k of FORBIDDEN_KEYS) {
      expect(keys.has(k), `scoutStaffView leaked forbidden key "${k}"`).toBe(false);
    }
  });

  it('records an assignment and flags it when off-specialty', () => {
    const staff = scoutStaffView(base, teamId);
    const scout = staff[0]!;
    const other: PositionGroup = scout.knownSpecialty === 'DB' ? 'OL' : 'DB';

    const next = assignScout(base, scout.scoutId, other);
    const updated = scoutStaffView(next, teamId).find((s) => s.scoutId === scout.scoutId)!;
    expect(updated.assignedGroup).toBe(other);
    expect(updated.offSpecialty).toBe(true);

    // And his KNOWN specialty is unchanged — the assignment moves where he
    // looks, not who he is.
    expect(updated.knownSpecialty).toBe(scout.knownSpecialty);
  });

  it('clears an assignment back to the neglect default', () => {
    const assigned = assignScout(base, scoutStaffView(base, teamId)[0]!.scoutId, 'LB');
    const cleared = assignScout(assigned, scoutStaffView(base, teamId)[0]!.scoutId, null);
    expect(scoutStaffView(cleared, teamId)[0]!.assignedGroup).toBeNull();
  });

  it('does not mutate the league it was given', () => {
    const before = scoutStaffView(base, teamId)[0]!.assignedGroup;
    assignScout(base, scoutStaffView(base, teamId)[0]!.scoutId, 'LB');
    expect(scoutStaffView(base, teamId)[0]!.assignedGroup).toBe(before);
  });
});

describe('scout assignment actually redirects coverage', () => {
  const league = unwrapGameLeague(base);
  const scouts = (league.teams[teamId]!.collegeScoutIds as readonly ScoutId[])
    .map((id) => league.collegeScouts[id])
    .filter((s): s is CollegeScout => s !== undefined);
  const scout = scouts[0]!;
  const target: PositionGroup = scout.knownSpecialty === 'DB' ? 'OL' : 'DB';
  const staffOfOne = { [teamId]: [scout] } as Readonly<Record<TeamId, readonly CollegeScout[]>>;

  const groupsOf = (assignments: Readonly<Record<string, PositionGroup>>): Set<string> => {
    const obs = generateInitialCollegeObservations(
      new Prng('coverage-probe'),
      staffOfOne,
      league.collegePool,
      league.tick,
      0,
      assignments,
    );
    const groups = new Set<string>();
    for (const o of obs) {
      const cp = league.collegePool.find((c) => c.id === o.collegePlayerId);
      if (cp) groups.add(positionGroupFor(cp.nflProjectedPosition));
    }
    return groups;
  };

  /**
   * The load-bearing behaviour. Without this the assignments screen is a
   * preference panel that changes nothing.
   */
  it('scouts his own specialty when unassigned, and the assigned group when assigned', () => {
    const unassigned = groupsOf({});
    expect(unassigned.has(scout.knownSpecialty)).toBe(true);

    const reassigned = groupsOf({ [String(scout.id)]: target });
    expect(reassigned.has(target)).toBe(true);
    expect(reassigned.has(scout.knownSpecialty)).toBe(false);
  });

  /**
   * §4's "mis-assignment bites", asserted structurally rather than as a tuned
   * number: the specialty bonus is attached to the scout, so it does NOT follow
   * him to a new group. A DB specialist pointed at OL reads OL with his
   * OFF-specialty accuracy.
   */
  it('does not carry the specialty accuracy bonus to the new group', () => {
    // The assignment changes coverage only; the accuracy map is untouched by
    // it, so a reassigned scout reads his new group at whatever accuracy he
    // already had there. THAT is the structural guarantee.
    const after = unwrapGameLeague(assignScout(base, scout.id, target));
    expect(after.collegeScouts[scout.id]!.trueAccuracy).toEqual(scout.trueAccuracy);
    expect(after.collegeScouts[scout.id]!.knownSpecialty).toBe(scout.knownSpecialty);
  });

  /**
   * The specialty bonus, asserted at the POPULATION level — which is the level
   * at which it is actually promised.
   *
   * A first version of this test asserted per-scout that
   * `trueAccuracy[knownSpecialty] > trueAccuracy[anyOtherGroup]`, and it
   * FAILED (0.603 vs 0.620). That was my assumption, not the engine's promise:
   * `generateCollegeScout` randomises accuracy per group and THEN adds the
   * specialty bonus, so the bonus need not overcome the random spread for any
   * individual man. Some scouts really are better outside their reputation —
   * which is good, because §6's whole premise is that reputation and reliability
   * are different things the player has to learn apart.
   */
  it('gives scouts a specialty edge on average across the staff', () => {
    const league2 = unwrapGameLeague(base);
    let atSpecialty = 0;
    let offSpecialty = 0;
    let n = 0;
    for (const s of Object.values(league2.collegeScouts)) {
      const groups = Object.keys(s.trueAccuracy) as PositionGroup[];
      const off = groups.filter((g) => g !== s.knownSpecialty);
      if (off.length === 0) continue;
      atSpecialty += s.trueAccuracy[s.knownSpecialty];
      offSpecialty += off.reduce((sum, g) => sum + s.trueAccuracy[g], 0) / off.length;
      n++;
    }
    expect(n).toBeGreaterThan(50);
    expect(atSpecialty / n).toBeGreaterThan(offSpecialty / n);
  });
});
