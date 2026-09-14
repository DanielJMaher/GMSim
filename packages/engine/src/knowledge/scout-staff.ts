/**
 * `scoutStaffView` + `assignScout` — the assignments screen
 * (SCOUTING_PROCESS.md §4; scoped back by Daniel, 2026-09-12).
 *
 * §4's framing: "light verb, heavy consequence". One screen, a handful of
 * choices, thirty seconds — and real teeth, because coverage follows assignment
 * and an unassigned scout follows his own nose.
 *
 * ## The scope-back, and what it deliberately keeps
 *
 * Daniel's ruling: *"just assign them to a position they will scout, not a
 * region. all scouts will be national for now, but keep it built in that they
 * can be subsetted by area."*
 *
 * So the player assigns a POSITION GROUP and nothing else. The region machinery
 * (`preferredRegion` on the scout, `sampleByRegion` in the sweep) is untouched
 * and still shapes who each scout happens to see — it is simply not something
 * the player directs yet. An area assignment can layer on later by adding a
 * second field, without rebuilding coverage.
 *
 * ## Why mis-assignment bites without a penalty being written
 *
 * The assignment redirects COVERAGE only. `generateCollegeObservation` still
 * reads `scout.trueAccuracy[...]` keyed on the scout's own `knownSpecialty`, so
 * pointing a DB specialist at interior OL genuinely produces generalist-quality
 * reads. §4 asks for exactly that, and it falls out of the split rather than
 * needing a bespoke penalty — which means it cannot drift out of calibration,
 * because there is no constant to drift.
 *
 * ## What the player can see about his own staff
 *
 * §6 is explicit for alpha: identity, known specialty and tenure. `trueAccuracy`
 * — how right each man actually tends to be — stays hidden, "learnable only by
 * tracking their calls". A staff screen that printed accuracy would replace the
 * entire judgement the scouting loop is about.
 */

import type { ScoutId, TeamId } from '../types/ids.js';
import type { PositionGroup } from '../types/enums.js';
import type { ScoutQuirk } from '../types/scout.js';
import { asGameLeague, unwrapGameLeague, type GameLeague } from './game-session.js';

/** One scout on your staff, as you may see him. */
export interface ScoutStaffRowView {
  scoutId: ScoutId;
  name: string;
  age: number;
  yearsExperience: number;
  /** What he is known for. NOT the same as how good he actually is. */
  knownSpecialty: PositionGroup;
  /** Visible quirks — flavour and a hint, never a number. */
  quirks: readonly ScoutQuirk[];
  /**
   * Where you have pointed him, or null if you have not — in which case he
   * follows his own nose, which is the neglect default and works about as well
   * as he is good.
   */
  assignedGroup: PositionGroup | null;
  /** True when he is working outside his known specialty. */
  offSpecialty: boolean;
}

export function scoutStaffView(handle: GameLeague, teamId: TeamId): readonly ScoutStaffRowView[] {
  const league = unwrapGameLeague(handle);
  const team = league.teams[teamId];
  if (!team) return [];

  const rows: ScoutStaffRowView[] = [];
  for (const scoutId of team.collegeScoutIds as readonly ScoutId[]) {
    const scout = league.collegeScouts[scoutId];
    if (!scout) continue;
    const assigned = league.scoutAssignments[scoutId] ?? null;
    rows.push({
      scoutId: scout.id,
      name: scout.name,
      age: scout.age,
      yearsExperience: scout.yearsExperience,
      knownSpecialty: scout.knownSpecialty,
      quirks: scout.quirks,
      assignedGroup: assigned,
      offSpecialty: assigned !== null && assigned !== scout.knownSpecialty,
    });
  }
  return rows;
}

/**
 * Point a scout at a position group, or clear his assignment with `null`.
 *
 * Returns a NEW handle — the game never mutates a league in place, it swaps
 * the handle, same as every other command.
 *
 * Note this takes any scout id and does not check whose staff he is on. That is
 * invariant #4 holding: the engine has no concept of a player team, so it has
 * no basis for refusing. The UI scopes the screen to your own staff; the engine
 * just records decisions.
 */
export function assignScout(
  handle: GameLeague,
  scoutId: ScoutId,
  group: PositionGroup | null,
): GameLeague {
  const league = unwrapGameLeague(handle);
  const next: Record<string, PositionGroup> = { ...league.scoutAssignments };
  if (group === null) {
    delete next[scoutId];
  } else {
    next[scoutId] = group;
  }
  return asGameLeague({
    ...league,
    scoutAssignments: next as Readonly<Record<ScoutId, PositionGroup>>,
  });
}
