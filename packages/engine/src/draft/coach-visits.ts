import type { Prng } from '../prng/index.js';
import type { LeagueState } from '../types/league.js';
import type { HeadCoach } from '../types/personnel.js';
import type { CoachVisitObservation, CollegePlayer, DraftBoardEntry } from '../types/college.js';
import type { PlayerSkills } from '../types/player.js';
import type { PlayerId, CoachId } from '../types/ids.js';

/** Per-team coach-visit budget (real NFL bye-week math: 3 games). */
const VISITS_PER_TEAM = 3;

/**
 * Dimensions a head coach reports on a college prospect. Coaches grade
 * what they can read live from the sideline / film room: mental +
 * scheme-fit. Physical measurables come from scouts + combine and are
 * NOT touched by coach visits — the narrowness is the point.
 *
 * Per Doc 3: "Coach visits are primary strength on intangibles" and
 * scheme-fit projection — significantly more accurate than scout
 * reports on these dimensions.
 */
const COACH_OBSERVED_KEYS: readonly (keyof PlayerSkills)[] = [
  'leadership',
  'competitiveness',
  'workEthic',
  'coachability',
  'composure',
  'footballIq',
  'decisionMaking',
  'technicalSkill', // scheme-fit proxy
];

/**
 * Base noise stdev (skill points) for a coach observation. Half the
 * scout noise floor (~18) — coaches see prospects directly and grade
 * dimensions that don't require advanced metrics. Scaled by
 * `(1 - coachAccuracy)` so a max-quality coach is very tight, a
 * floor-quality coach approaches scout-level noise.
 */
const COACH_BASE_NOISE = 9;

/**
 * Per-coach accuracy on player-grading visits. Derived from HC
 * spectrums: blends staff-development (player-eval depth), experience
 * (seen more prospects), adaptability (open to grading prospects on
 * their merits). Range ~0.50..0.95 — distinctly higher than the
 * scout floor (0.35..0.80).
 */
export function coachVisitAccuracy(coach: HeadCoach): number {
  const staff = coach.spectrums.staffDevelopment / 10;
  const exp = coach.spectrums.experience / 10;
  const adapt = coach.spectrums.adaptability / 10;
  const raw = staff * 0.45 + exp * 0.30 + adapt * 0.25;
  return clamp(0.50 + raw * 0.45, 0.50, 0.95);
}

export interface RunCoachVisitsOptions {
  /** Sim tick the visits are stamped with. */
  observedOnTick: number;
  /** Per-team budget. Defaults to `VISITS_PER_TEAM`. */
  visitsPerTeam?: number;
}

/**
 * Run one cycle of head-coach visits. For each team:
 *   - Walk the team's draft board top → bottom
 *   - Visit the top `visitsPerTeam` prospects (default 3)
 *   - File one `CoachVisitObservation` per visited prospect
 *
 * The board-driven selection is the coach equivalent of scout
 * deployment — coaches don't have time for everyone, so they focus
 * on the prospects their org is most interested in. (Later slices
 * can add coverage-competition for marquee games + "I saw your guys
 * on tape" cross-attendance signal.)
 *
 * Pure: returns observations; caller folds into LeagueState.
 */
export function runCoachVisits(
  prng: Prng,
  league: LeagueState,
  options: RunCoachVisitsOptions,
): CoachVisitObservation[] {
  const out: CoachVisitObservation[] = [];
  const visitsPerTeam = options.visitsPerTeam ?? VISITS_PER_TEAM;
  const prospectById = new Map<PlayerId, CollegePlayer>();
  for (const cp of league.collegePool) prospectById.set(cp.id, cp);

  for (const team of Object.values(league.teams)) {
    const coach = league.coaches[team.headCoachId];
    if (!coach) continue;
    const board = league.draftBoards[team.identity.id] ?? [];
    const targets = pickVisitTargets(board, prospectById, visitsPerTeam);
    if (targets.length === 0) continue;

    const accuracy = coachVisitAccuracy(coach);
    const teamPrng = prng.fork(`cv:${team.identity.id}`);
    for (const prospect of targets) {
      out.push(
        generateCoachVisit(
          teamPrng.fork(`p:${prospect.id}`),
          coach,
          prospect,
          accuracy,
          options.observedOnTick,
        ),
      );
    }
    void team;
  }
  return out;
}

/**
 * Apply a coach-visit cycle's observations to a league. Append-only.
 */
export function applyCoachVisits(
  league: LeagueState,
  newVisits: readonly CoachVisitObservation[],
): LeagueState {
  if (newVisits.length === 0) return league;
  return {
    ...league,
    coachVisitObservations: [...league.coachVisitObservations, ...newVisits],
  };
}

function pickVisitTargets(
  board: readonly DraftBoardEntry[],
  prospectById: Map<PlayerId, CollegePlayer>,
  k: number,
): CollegePlayer[] {
  const out: CollegePlayer[] = [];
  for (const entry of board) {
    const cp = prospectById.get(entry.collegePlayerId);
    if (!cp) continue;
    if (!cp.isDraftEligible) continue;
    out.push(cp);
    if (out.length >= k) break;
  }
  return out;
}

function generateCoachVisit(
  prng: Prng,
  coach: HeadCoach,
  prospect: CollegePlayer,
  accuracy: number,
  observedOnTick: number,
): CoachVisitObservation {
  const skills: Partial<Record<keyof PlayerSkills, number>> = {};
  const confidence: Partial<Record<keyof PlayerSkills, number>> = {};
  for (const key of COACH_OBSERVED_KEYS) {
    const trueValue = prospect.current[key];
    const noiseStdev = COACH_BASE_NOISE * (1 - accuracy);
    const observed = clampSkill(trueValue + prng.normal(0, noiseStdev));
    skills[key] = Math.round(observed);
    confidence[key] = Number(accuracy.toFixed(2));
  }
  return {
    coachId: coach.id satisfies CoachId,
    collegePlayerId: prospect.id,
    observedOnTick,
    skills,
    confidence,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function clampSkill(v: number): number {
  return Math.max(0, Math.min(100, v));
}
