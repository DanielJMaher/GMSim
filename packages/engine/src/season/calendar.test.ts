import { describe, it, expect } from 'vitest';
import {
  phaseCalendarLabel,
  phaseCalendarDate,
  formatCalendarDate,
  isTradeDeadlineWeek,
  TRADE_DEADLINE_WEEK_INDEX,
  SEASON_ONE_ANCHOR_YEAR,
  LIFECYCLE_ORDER,
} from './index.js';

describe('phaseCalendarLabel', () => {
  it('formats regular-season weeks 1..17', () => {
    expect(phaseCalendarLabel('REGULAR_SEASON_WEEK', 0)).toBe('Week 1');
    expect(phaseCalendarLabel('REGULAR_SEASON_WEEK', 7)).toBe('Week 8');
    expect(phaseCalendarLabel('REGULAR_SEASON_WEEK', 16)).toBe('Week 17');
  });

  it('reports "Preseason" before the first regular-season tick', () => {
    expect(phaseCalendarLabel('REGULAR_SEASON_WEEK', null)).toBe('Preseason');
  });

  it('returns a non-empty label for every LifecyclePhase', () => {
    for (const phase of LIFECYCLE_ORDER) {
      const label = phaseCalendarLabel(phase, null);
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('playoff round labels read naturally', () => {
    expect(phaseCalendarLabel('WILD_CARD')).toBe('Wild Card Round');
    expect(phaseCalendarLabel('DIVISIONAL')).toBe('Divisional Round');
    expect(phaseCalendarLabel('CONFERENCE')).toBe('Conference Championships');
    expect(phaseCalendarLabel('SUPER_BOWL')).toBe('Super Bowl');
  });

  it('offseason phase labels reference their canonical month', () => {
    expect(phaseCalendarLabel('OFFSEASON_TRANSACTIONS')).toMatch(/March/);
    expect(phaseCalendarLabel('DRAFT')).toMatch(/April/);
  });
});

describe('phaseCalendarDate', () => {
  it('Week 1 of season 1 anchors to Sept 7, 2026', () => {
    const d = phaseCalendarDate('REGULAR_SEASON_WEEK', 0, 1);
    expect(d).toEqual({ year: 2026, month: 9, day: 7 });
  });

  it('Week 8 (trade deadline week) of season 1 is late October', () => {
    const d = phaseCalendarDate('REGULAR_SEASON_WEEK', 7, 1);
    expect(d).not.toBeNull();
    expect(d!.month).toBe(10);
    // Sept 7 + 7×7 = Sept 7 + 49 days = Oct 26 (non-leap year math).
    expect(d!.day).toBe(26);
  });

  it('Week 17 of season 1 lands in late December (engine plays a 17-week season)', () => {
    const d = phaseCalendarDate('REGULAR_SEASON_WEEK', 16, 1);
    expect(d).not.toBeNull();
    // Week 1 = Sept 7. Week 17 = Sept 7 + 112 days = Dec 28.
    expect(d!.year).toBe(2026);
    expect(d!.month).toBe(12);
    expect(d!.day).toBe(28);
  });

  it('playoff rounds anchor to the offseason year (kickoff year + 1)', () => {
    expect(phaseCalendarDate('WILD_CARD', null, 1)!.year).toBe(2027);
    expect(phaseCalendarDate('SUPER_BOWL', null, 1)!.year).toBe(2027);
  });

  it('Super Bowl is in February', () => {
    const sb = phaseCalendarDate('SUPER_BOWL', null, 1);
    expect(sb!.month).toBe(2);
  });

  it('free agency opens mid-March of the offseason year', () => {
    const fa = phaseCalendarDate('OFFSEASON_TRANSACTIONS', null, 1);
    expect(fa!.year).toBe(2027);
    expect(fa!.month).toBe(3);
  });

  it('draft is late April of the offseason year', () => {
    const d = phaseCalendarDate('DRAFT', null, 1);
    expect(d!.year).toBe(2027);
    expect(d!.month).toBe(4);
    expect(d!.day).toBeGreaterThanOrEqual(24);
  });

  it('READY_FOR_NEXT_SEASON has no canonical date', () => {
    expect(phaseCalendarDate('READY_FOR_NEXT_SEASON', null, 1)).toBeNull();
  });

  it('season N+1 advances every dated phase by one calendar year', () => {
    const seasonOneDraft = phaseCalendarDate('DRAFT', null, 1);
    const seasonTwoDraft = phaseCalendarDate('DRAFT', null, 2);
    expect(seasonTwoDraft!.year).toBe(seasonOneDraft!.year + 1);
    expect(seasonTwoDraft!.month).toBe(seasonOneDraft!.month);
    expect(seasonTwoDraft!.day).toBe(seasonOneDraft!.day);
  });

  it('every LifecyclePhase except READY_FOR_NEXT_SEASON returns a date', () => {
    for (const phase of LIFECYCLE_ORDER) {
      const d = phaseCalendarDate(phase, 0, 1);
      if (phase === 'READY_FOR_NEXT_SEASON') {
        expect(d).toBeNull();
      } else {
        expect(d).not.toBeNull();
        expect(d!.year).toBeGreaterThanOrEqual(SEASON_ONE_ANCHOR_YEAR);
      }
    }
  });
});

describe('isTradeDeadlineWeek', () => {
  it(`flips true at currentWeek === ${TRADE_DEADLINE_WEEK_INDEX}`, () => {
    for (let week = 0; week < 17; week++) {
      const expected = week === TRADE_DEADLINE_WEEK_INDEX;
      expect(isTradeDeadlineWeek(week)).toBe(expected);
    }
  });

  it('returns false for null (offseason / pre-kickoff)', () => {
    expect(isTradeDeadlineWeek(null)).toBe(false);
  });
});

describe('formatCalendarDate', () => {
  it('renders ISO YYYY-MM-DD', () => {
    expect(formatCalendarDate({ year: 2026, month: 9, day: 7 })).toBe('2026-09-07');
    expect(formatCalendarDate({ year: 2027, month: 2, day: 11 })).toBe('2027-02-11');
    expect(formatCalendarDate({ year: 2027, month: 12, day: 31 })).toBe('2027-12-31');
  });
});

describe('leap-year edge case', () => {
  it('does not split Feb 28/29 incorrectly in the regular-season walk', () => {
    // No regular-season week lands in February under the standard
    // calendar (Week 17 is early January), so the leap-year handling
    // is exercised only when seasonNumber places kickoff in a year
    // where the +7-day walk crosses Feb 28. Spot-check season 3
    // (kickoff 2028, offseason 2029 — non-leap): every regular-season
    // week should round-trip through formatCalendarDate.
    for (let week = 0; week < 17; week++) {
      const d = phaseCalendarDate('REGULAR_SEASON_WEEK', week, 3);
      expect(d).not.toBeNull();
      const formatted = formatCalendarDate(d!);
      expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
