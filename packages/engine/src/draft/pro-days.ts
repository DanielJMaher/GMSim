import type { Prng } from '../prng/index.js';
import type { CollegePlayer, DraftBoardEntry, ProDayAttendanceRecord } from '../types/college.js';
import type { TeamState } from '../types/team.js';
import type { TeamId } from '../types/ids.js';

const TOP_BOARD_LOOKAHEAD = 30;

/**
 * Run the league's pro-day cycle. Mechanics per Doc 3:
 *
 *   "A full pro day schedule covers all relevant college programs.
 *    All 32 teams must make deployment decisions across the same
 *    schedule. Popular pro days may have 20+ NFL teams in attendance
 *    while smaller programs may host only 2-3 teams."
 *
 * Slice 4 model — attendance is decided per (team, school):
 *
 *   1. The schedule is every school with ≥1 draft-eligible prospect.
 *   2. For each (team, school), the team's interest score = number of
 *      that school's prospects in the team's draft board top 30.
 *   3. Attendance rolls:
 *        score ≥ 3 → AUTO   (always attend)
 *        score = 2 → INTERESTED with p = 0.80
 *        score = 1 → INTERESTED with p = 0.65
 *        score = 0 → FLYER  with p = 0.05  (random small-school look)
 *
 * Deterministic for a given (prng, draftBoards, pool). Returns the
 * full per-team schedule. Coverage-competition effects on subsequent
 * observation quality are deferred to a later slice.
 */
export function runProDays(
  prng: Prng,
  teams: Readonly<Record<TeamId, TeamState>>,
  collegePool: readonly CollegePlayer[],
  draftBoards: Readonly<Record<TeamId, readonly DraftBoardEntry[]>>,
): Record<TeamId, ProDayAttendanceRecord[]> {
  const eligibleSchoolIds = collectEligibleSchools(collegePool);

  const out: Record<TeamId, ProDayAttendanceRecord[]> = {} as Record<TeamId, ProDayAttendanceRecord[]>;

  for (const teamId of Object.keys(teams) as TeamId[]) {
    const board = draftBoards[teamId] ?? [];
    const topProspectIds = new Set(board.slice(0, TOP_BOARD_LOOKAHEAD).map((e) => e.collegePlayerId));
    const boardCountBySchool = countTopBoardBySchool(topProspectIds, collegePool);

    const records: ProDayAttendanceRecord[] = [];
    const teamPrng = prng.fork(`pd:${teamId}`);

    for (const schoolId of eligibleSchoolIds) {
      const boardCount = boardCountBySchool.get(schoolId) ?? 0;
      const schoolPrng = teamPrng.fork(`s:${schoolId}`);
      const decision = decideAttendance(schoolPrng, boardCount);
      records.push({
        schoolId,
        attended: decision.attended,
        reason: decision.reason,
        boardCount,
      });
    }
    out[teamId] = records;
  }

  return out;
}

interface AttendanceDecision {
  attended: boolean;
  reason: ProDayAttendanceRecord['reason'];
}

function decideAttendance(prng: Prng, boardCount: number): AttendanceDecision {
  if (boardCount >= 3) return { attended: true, reason: 'AUTO' };
  if (boardCount === 2) {
    return prng.next() < 0.80
      ? { attended: true, reason: 'INTERESTED' }
      : { attended: false, reason: 'SKIP' };
  }
  if (boardCount === 1) {
    return prng.next() < 0.65
      ? { attended: true, reason: 'INTERESTED' }
      : { attended: false, reason: 'SKIP' };
  }
  // No board interest — small chance of a flyer look.
  return prng.next() < 0.05
    ? { attended: true, reason: 'FLYER' }
    : { attended: false, reason: 'SKIP' };
}

function collectEligibleSchools(collegePool: readonly CollegePlayer[]): string[] {
  const set = new Set<string>();
  for (const cp of collegePool) {
    if (!cp.isDraftEligible) continue;
    set.add(cp.schoolId);
  }
  // Stable iteration order — sort alphabetically.
  return [...set].sort();
}

function countTopBoardBySchool(
  topProspectIds: ReadonlySet<string>,
  collegePool: readonly CollegePlayer[],
): Map<string, number> {
  const m = new Map<string, number>();
  for (const cp of collegePool) {
    if (!topProspectIds.has(cp.id)) continue;
    m.set(cp.schoolId, (m.get(cp.schoolId) ?? 0) + 1);
  }
  return m;
}
