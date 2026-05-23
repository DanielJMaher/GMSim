/**
 * Calendar display layer for the `LifecyclePhase` cycle (v0.57+).
 *
 * Pure functions: given a phase (+ `currentWeek` for in-season ticks),
 * produce a short label and an approximate calendar date keyed to the
 * NFL calendar. The engine itself doesn't yet stamp a real date onto
 * `LeagueState` — those would advance per tick. This module is the
 * lightweight first layer: phase → string + `CalendarDate` for any UI
 * that wants to render "Week 5 · Oct 5" or "Mid-March · Free Agency
 * Opens" without holding date arithmetic itself.
 *
 * Trade-deadline urgency (v0.58) reads `currentWeek` directly — it
 * doesn't need this calendar layer to know `currentWeek === 7` is
 * the deadline tick. This module is display-only.
 */

import type { LifecyclePhase } from './lifecycle.js';

/**
 * Plain calendar date — year/month/day as integers. Avoids JS `Date`'s
 * timezone surprises while staying serializable.
 */
export interface CalendarDate {
  /** Absolute year, e.g., 2026. */
  year: number;
  /** 1..12 (January = 1). */
  month: number;
  /** 1..31. */
  day: number;
}

/**
 * The simulation's anchor year for season 1. Season N maps to calendar
 * year `SEASON_ONE_ANCHOR_YEAR + N - 1`. Matches the existing convention
 * in `draft/pool.ts` and `league/generate.ts` (both use `2026 +
 * (seasonNumber - 1)`).
 */
export const SEASON_ONE_ANCHOR_YEAR = 2026;

/**
 * Canonical NFL calendar anchors. Real dates shift a day or two
 * year-to-year; the simulation uses fixed anchors that read as "early
 * September" or "late April" without committing to literal historical
 * accuracy. These drive both the date emitted by `phaseCalendarDate`
 * and the calendar-relative labels in `phaseCalendarLabel`.
 *
 * Anchor year is the year-of-kickoff (Week 1). Offseason events that
 * happen after the Super Bowl land in `year + 1`.
 */
export const CALENDAR_ANCHORS = {
  /** Week 1 kickoff. Real NFL: Thursday after Labor Day, early Sept. */
  weekOneKickoff: { month: 9, day: 7 },
  /** Tuesday after Week 8 — the NFL trade deadline since 2022. */
  tradeDeadline: { month: 10, day: 27 },
  /** Wild Card weekend, mid-January of the year after kickoff. */
  wildCard: { month: 1, day: 13 },
  /** Divisional round, third weekend of January. */
  divisional: { month: 1, day: 20 },
  /** Conference championships, fourth weekend of January. */
  conference: { month: 1, day: 28 },
  /** Super Bowl, second Sunday of February. */
  superBowl: { month: 2, day: 11 },
  /** Combine — last week of February / first week of March. */
  combine: { month: 3, day: 1 },
  /** Legal tampering window opens two days before FA. */
  faLegalTampering: { month: 3, day: 11 },
  /** Free agency opens — new league year. */
  freeAgencyOpens: { month: 3, day: 13 },
  /** Pro days span all of March + early April; anchor is mid-March. */
  proDays: { month: 3, day: 20 },
  /** Draft Day 1 (Round 1) — last Thursday of April. */
  draftDayOne: { month: 4, day: 25 },
  /** Draft Day 3 (Rounds 4-7) — Saturday of draft weekend. */
  draftDayThree: { month: 4, day: 27 },
  /** UDFA signing window opens minutes after the draft ends. */
  udfaSigning: { month: 4, day: 28 },
  /** College Week 1 kickoff — Saturday after Labor Day, late August. */
  collegeWeekOneKickoff: { month: 8, day: 30 },
  /** Conference championship weekend — first Saturday of December. */
  collegeConferenceChampionships: { month: 12, day: 6 },
  /** Heisman Trophy ceremony — second Saturday of December. */
  heismanCeremony: { month: 12, day: 13 },
  /** Bowl season runs Dec 20 – Jan 1; anchor at the front. */
  collegeBowls: { month: 12, day: 20 },
  /** CFP First Round — third Saturday of December. */
  cfpFirstRound: { month: 12, day: 20 },
  /** CFP Quarterfinals — New Year's Day. */
  cfpQuarterfinals: { month: 1, day: 1 },
  /** CFP Semifinals — first weekend of January. */
  cfpSemifinals: { month: 1, day: 9 },
  /** CFP National Championship — third Monday of January. */
  cfpFinal: { month: 1, day: 19 },
} as const;

/**
 * Short label for the league's current position. Designed for badge
 * or chip display ("Week 5", "Wild Card Round", "Mid-March — Free
 * Agency Opens"). `currentWeek` is only consulted for
 * `REGULAR_SEASON_WEEK`; pass `null` (or omit) for other phases.
 *
 * `REGULAR_SEASON_WEEK` returns "Preseason" when `currentWeek === null`
 * — that's the brief window between schedule generation and the first
 * week's tick.
 */
export function phaseCalendarLabel(
  phase: LifecyclePhase,
  currentWeek: number | null = null,
  collegeCurrentWeek: number | null = null,
): string {
  switch (phase) {
    case 'REGULAR_SEASON_WEEK':
      if (currentWeek === null) return 'Preseason';
      // currentWeek is 0-indexed; display as 1-indexed.
      return `Week ${currentWeek + 1}`;
    case 'COLLEGE_WEEK':
      if (collegeCurrentWeek === null) return '🎓 College Week 1';
      return `🎓 College Week ${collegeCurrentWeek + 1}`;
    case 'COLLEGE_CONFERENCE_CHAMPIONSHIPS':
      return '🎓 Early December · Conference Championships';
    case 'HEISMAN_CEREMONY':
      return '🎓 Mid-December · Heisman Ceremony';
    case 'COLLEGE_BOWL_GAMES':
      return '🎓 Late December · Bowl Season';
    case 'CFP_FIRST_ROUND':
      return '🎓 Late December · CFP First Round';
    case 'CFP_QUARTERFINALS':
      return '🎓 New Year’s Day · CFP Quarterfinals';
    case 'CFP_SEMIFINALS':
      return '🎓 Early January · CFP Semifinals';
    case 'CFP_FINAL':
      return '🎓 Mid-January · CFP National Championship';
    case 'WILD_CARD':
      return 'Wild Card Round';
    case 'DIVISIONAL':
      return 'Divisional Round';
    case 'CONFERENCE':
      return 'Conference Championships';
    case 'SUPER_BOWL':
      return 'Super Bowl';
    case 'POST_SEASON_FINALIZE':
      return 'Awards · Retirements · Offseason Roster Reset';
    case 'OFFSEASON_TRANSACTIONS':
      return 'Mid-March · Free Agency';
    case 'PRE_DRAFT':
      return 'Late April · Junior Declarations';
    case 'DRAFT':
      return 'Late April · NFL Draft';
    case 'POST_DRAFT_ROSTER':
      return 'Late April · UDFA · Preseason Cuts';
    case 'COLLEGE_CYCLE':
      return 'May–August · College Cycle';
    case 'READY_FOR_NEXT_SEASON':
      return 'Late August · Ready for Kickoff';
  }
}

/**
 * Approximate calendar date for the given phase, anchored to season N's
 * kickoff year (`SEASON_ONE_ANCHOR_YEAR + seasonNumber - 1`). Returns
 * `null` for `READY_FOR_NEXT_SEASON` (it's the moment-before-kickoff
 * marker — Week 1's date is the right anchor for that, but the marker
 * itself doesn't have a unique date).
 *
 * For `REGULAR_SEASON_WEEK` with `currentWeek === null` (pre-kickoff),
 * returns Week 1's date. For each subsequent week, advances by 7 days.
 *
 * Year crosses February 28 (no leap-year handling beyond raw integer
 * arithmetic — the +7 day rollover handles month boundaries via a
 * minimal day-table lookup). This is approximation-quality output for
 * UI display, not a wall-clock date library.
 */
export function phaseCalendarDate(
  phase: LifecyclePhase,
  currentWeek: number | null,
  seasonNumber: number,
  collegeCurrentWeek: number | null = null,
): CalendarDate | null {
  const kickoffYear = SEASON_ONE_ANCHOR_YEAR + seasonNumber - 1;
  const offseasonYear = kickoffYear + 1;

  switch (phase) {
    case 'REGULAR_SEASON_WEEK': {
      const weekIdx = currentWeek ?? 0;
      const base: CalendarDate = {
        year: kickoffYear,
        month: CALENDAR_ANCHORS.weekOneKickoff.month,
        day: CALENDAR_ANCHORS.weekOneKickoff.day,
      };
      return addDays(base, weekIdx * 7);
    }
    case 'COLLEGE_WEEK': {
      const weekIdx = collegeCurrentWeek ?? 0;
      const base: CalendarDate = {
        year: kickoffYear,
        month: CALENDAR_ANCHORS.collegeWeekOneKickoff.month,
        day: CALENDAR_ANCHORS.collegeWeekOneKickoff.day,
      };
      return addDays(base, weekIdx * 7);
    }
    case 'COLLEGE_CONFERENCE_CHAMPIONSHIPS':
      return { year: kickoffYear, ...CALENDAR_ANCHORS.collegeConferenceChampionships };
    case 'HEISMAN_CEREMONY':
      return { year: kickoffYear, ...CALENDAR_ANCHORS.heismanCeremony };
    case 'COLLEGE_BOWL_GAMES':
      return { year: kickoffYear, ...CALENDAR_ANCHORS.collegeBowls };
    case 'CFP_FIRST_ROUND':
      return { year: kickoffYear, ...CALENDAR_ANCHORS.cfpFirstRound };
    case 'CFP_QUARTERFINALS':
      return { year: offseasonYear, ...CALENDAR_ANCHORS.cfpQuarterfinals };
    case 'CFP_SEMIFINALS':
      return { year: offseasonYear, ...CALENDAR_ANCHORS.cfpSemifinals };
    case 'CFP_FINAL':
      return { year: offseasonYear, ...CALENDAR_ANCHORS.cfpFinal };
    case 'WILD_CARD':
      return { year: offseasonYear, ...CALENDAR_ANCHORS.wildCard };
    case 'DIVISIONAL':
      return { year: offseasonYear, ...CALENDAR_ANCHORS.divisional };
    case 'CONFERENCE':
      return { year: offseasonYear, ...CALENDAR_ANCHORS.conference };
    case 'SUPER_BOWL':
      return { year: offseasonYear, ...CALENDAR_ANCHORS.superBowl };
    case 'POST_SEASON_FINALIZE':
      // Day-after Super Bowl in practice; use Feb 12.
      return { year: offseasonYear, month: 2, day: 12 };
    case 'OFFSEASON_TRANSACTIONS':
      return { year: offseasonYear, ...CALENDAR_ANCHORS.freeAgencyOpens };
    case 'PRE_DRAFT':
      // Day before draft.
      return {
        year: offseasonYear,
        month: CALENDAR_ANCHORS.draftDayOne.month,
        day: CALENDAR_ANCHORS.draftDayOne.day - 1,
      };
    case 'DRAFT':
      return { year: offseasonYear, ...CALENDAR_ANCHORS.draftDayOne };
    case 'POST_DRAFT_ROSTER':
      return { year: offseasonYear, ...CALENDAR_ANCHORS.udfaSigning };
    case 'COLLEGE_CYCLE':
      // Anchor at mid-July; college cycle spans May-August.
      return { year: offseasonYear, month: 7, day: 15 };
    case 'READY_FOR_NEXT_SEASON':
      return null;
  }
}

/**
 * Is this regular-season week the NFL trade deadline tick? The deadline
 * lands the Tuesday after Week 8 — meaning the deadline-pressure week
 * IS Week 8 itself (the week leading up to the cutoff). In 0-indexed
 * `currentWeek`, that's `7`.
 *
 * v0.58's trade-deadline urgency modifier flips on for exactly this
 * one tick.
 */
export const TRADE_DEADLINE_WEEK_INDEX = 7;

export function isTradeDeadlineWeek(currentWeek: number | null): boolean {
  return currentWeek === TRADE_DEADLINE_WEEK_INDEX;
}

/**
 * Format a CalendarDate as ISO-style `YYYY-MM-DD`. Convenience for tests
 * + display where consumers prefer a string.
 */
export function formatCalendarDate(date: CalendarDate): string {
  const m = String(date.month).padStart(2, '0');
  const d = String(date.day).padStart(2, '0');
  return `${date.year}-${m}-${d}`;
}

// ─── Internal date arithmetic ───────────────────────────────────────────

const DAYS_IN_MONTH: readonly number[] = [
  31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
];

function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return DAYS_IN_MONTH[month - 1]!;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function addDays(date: CalendarDate, days: number): CalendarDate {
  let { year, month, day } = date;
  day += days;
  while (day > daysInMonth(year, month)) {
    day -= daysInMonth(year, month);
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  return { year, month, day };
}
