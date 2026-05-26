/**
 * Unified season calendar (v0.63.1).
 *
 * v0.63 interleaved the NFL and college lifecycles by *alternating*
 * phases — which produced a chronologically wrong tick order. NFL
 * Week 1 (Sept 7) fired before College Week 1 (Aug 30), and the two
 * leagues ping-ponged regardless of their real calendar dates. The
 * college postseason was also forced to run as one contiguous block
 * even though, in reality, its rounds are spread across late-December
 * NFL regular-season weeks and into the NFL playoff window (the CFP
 * National Championship falls between the NFL Wild Card and Divisional
 * rounds).
 *
 * This module replaces the ad-hoc interleave logic with a single
 * date-ordered timeline: every lifecycle phase becomes a dated step,
 * the steps are sorted by calendar date, and `tickPhase` walks them in
 * order (see `decideTickTarget` in lifecycle.ts). One list, sorted
 * once — the engine then dispatches each tick to the phase whose date
 * comes next.
 *
 * The dates come from `phaseCalendarDate` (the existing display layer),
 * so the timeline and the inspector's per-tick date labels agree by
 * construction.
 *
 * Determinism note: each phase's PRNG stream is namespaced by phase +
 * season + week-index, never by tick *order*, so reordering when a
 * phase fires does not change any game result — only the sequence in
 * which identical results are produced. See lifecycle.ts.
 */

import type { LifecyclePhase } from './lifecycle.js';
import { phaseCalendarDate, type CalendarDate } from './calendar.js';
import { REGULAR_SEASON_WEEKS } from './schedule.js';
import { COLLEGE_REGULAR_SEASON_WEEKS } from '../college-season/index.js';

/**
 * One dated step in a season's lifecycle. `tickPhase` fires exactly one
 * step per tick, in `date` order.
 */
export interface TimelineStep {
  phase: LifecyclePhase;
  /**
   * 0-indexed week for the two week-grained phases
   * (`REGULAR_SEASON_WEEK`, `COLLEGE_WEEK`). `null` for the single-shot
   * postseason / offseason phases.
   */
  weekIndex: number | null;
  /** Calendar date this step is anchored to. */
  date: CalendarDate;
}

/**
 * The single-shot phases (everything that isn't a repeating weekly
 * tick), listed in their canonical same-date tiebreak order. Only
 * matters when two phases share a date — e.g. the non-CFP bowl slate
 * and the CFP first round both anchor to Dec 20, and bowls should be
 * listed first. `READY_FOR_NEXT_SEASON` is deliberately excluded: it's
 * the wrap marker (no calendar date), handled directly by the dispatch.
 */
const SINGLE_SHOT_PHASES: readonly LifecyclePhase[] = [
  'PRESEASON',
  'TRADE_DEADLINE',
  'COLLEGE_CONFERENCE_CHAMPIONSHIPS',
  'HEISMAN_CEREMONY',
  'COLLEGE_BOWL_GAMES',
  'CFP_FIRST_ROUND',
  'CFP_QUARTERFINALS',
  'CFP_SEMIFINALS',
  'CFP_FINAL',
  'DRAFT_DECLARATION',
  'SHRINE_BOWL',
  'SENIOR_BOWL',
  'WILD_CARD',
  'DIVISIONAL',
  'CONFERENCE',
  'SUPER_BOWL',
  'POST_SEASON_FINALIZE',
  'COMBINE',
  'OFFSEASON_TRANSACTIONS',
  'PRO_DAYS',
  'TOP_30_VISITS',
  'PRE_DRAFT',
  'DRAFT',
  'POST_DRAFT_ROSTER',
  'COLLEGE_CYCLE',
];

/**
 * Build the full date-ordered timeline for `seasonNumber`: all NFL
 * regular-season weeks, all college regular-season weeks, and every
 * single-shot postseason / offseason phase, sorted by calendar date.
 *
 * Sort is total and deterministic: by date, then by canonical
 * tiebreak rank for same-date phases, then by week index. The only
 * real same-date collision in the standard calendar is bowls vs. the
 * CFP first round (both Dec 20); the rank keeps bowls first.
 */
export function buildSeasonTimeline(seasonNumber: number): TimelineStep[] {
  const steps: TimelineStep[] = [];

  for (let w = 0; w < REGULAR_SEASON_WEEKS; w++) {
    steps.push({
      phase: 'REGULAR_SEASON_WEEK',
      weekIndex: w,
      date: phaseCalendarDate('REGULAR_SEASON_WEEK', w, seasonNumber)!,
    });
  }

  for (let w = 0; w < COLLEGE_REGULAR_SEASON_WEEKS; w++) {
    steps.push({
      phase: 'COLLEGE_WEEK',
      weekIndex: w,
      date: phaseCalendarDate('COLLEGE_WEEK', null, seasonNumber, w)!,
    });
  }

  for (const phase of SINGLE_SHOT_PHASES) {
    steps.push({
      phase,
      weekIndex: null,
      date: phaseCalendarDate(phase, null, seasonNumber)!,
    });
  }

  steps.sort((a, b) => {
    const byDate = compareDates(a.date, b.date);
    if (byDate !== 0) return byDate;
    const byRank = tiebreakRank(a) - tiebreakRank(b);
    if (byRank !== 0) return byRank;
    return (a.weekIndex ?? 0) - (b.weekIndex ?? 0);
  });

  return steps;
}

/**
 * Same-date tiebreak rank. Single-shot phases sort by their position
 * in `SINGLE_SHOT_PHASES`; week phases get -1 (they never collide on a
 * date with a single-shot phase under the standard calendar, so the
 * value only needs to be stable).
 */
function tiebreakRank(step: TimelineStep): number {
  const idx = SINGLE_SHOT_PHASES.indexOf(step.phase);
  return idx === -1 ? -1 : idx;
}

function compareDates(a: CalendarDate, b: CalendarDate): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}
