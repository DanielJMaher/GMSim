import { describe, it, expect } from 'vitest';
import { buildSeasonTimeline } from './timeline.js';
import { formatCalendarDate } from './calendar.js';
import type { LifecyclePhase } from './lifecycle.js';

describe('buildSeasonTimeline', () => {
  const timeline = buildSeasonTimeline(1);

  it('is sorted in non-decreasing calendar-date order', () => {
    for (let i = 1; i < timeline.length; i++) {
      const prev = timeline[i - 1]!.date;
      const cur = timeline[i]!.date;
      const prevKey = prev.year * 10000 + prev.month * 100 + prev.day;
      const curKey = cur.year * 10000 + cur.month * 100 + cur.day;
      expect(curKey).toBeGreaterThanOrEqual(prevKey);
    }
  });

  it('opens with Preseason (Aug 20), then College Week 1 (Aug 30) before NFL Week 1 (Sept 7)', () => {
    const first = timeline[0]!;
    expect(first.phase).toBe('PRESEASON');
    expect(formatCalendarDate(first.date)).toBe('2026-08-20');
  });

  it('orders the opening as Preseason, CFB W1, CFB W2, NFL W1 (v0.63 bug + v0.64 preseason)', () => {
    const firstFour = timeline.slice(0, 4).map((s) => ({
      phase: s.phase,
      weekIndex: s.weekIndex,
      date: formatCalendarDate(s.date),
    }));
    expect(firstFour).toEqual([
      { phase: 'PRESEASON', weekIndex: null, date: '2026-08-20' },
      { phase: 'COLLEGE_WEEK', weekIndex: 0, date: '2026-08-30' },
      { phase: 'COLLEGE_WEEK', weekIndex: 1, date: '2026-09-06' },
      { phase: 'REGULAR_SEASON_WEEK', weekIndex: 0, date: '2026-09-07' },
    ]);
  });

  it('places the pre-draft scouting beats in order: Combine, Pro Days, Top-30, Draft', () => {
    const idxOf = (p: LifecyclePhase) => timeline.findIndex((s) => s.phase === p);
    expect(idxOf('COMBINE')).toBeGreaterThan(idxOf('SUPER_BOWL'));
    expect(idxOf('COMBINE')).toBeLessThan(idxOf('OFFSEASON_TRANSACTIONS'));
    expect(idxOf('OFFSEASON_TRANSACTIONS')).toBeLessThan(idxOf('PRO_DAYS'));
    expect(idxOf('PRO_DAYS')).toBeLessThan(idxOf('TOP_30_VISITS'));
    expect(idxOf('TOP_30_VISITS')).toBeLessThan(idxOf('DRAFT'));
  });

  it('places the trade deadline (late Oct) among the regular-season weeks', () => {
    const td = timeline.findIndex((s) => s.phase === 'TRADE_DEADLINE');
    expect(td).toBeGreaterThanOrEqual(0);
    expect(formatCalendarDate(timeline[td]!.date)).toBe('2026-10-27');
    // It should sit between some NFL weeks, not in the postseason block.
    expect(td).toBeLessThan(timeline.findIndex((s) => s.phase === 'WILD_CARD'));
  });

  it('contains every week + single-shot phase exactly the expected number of times', () => {
    const counts = new Map<LifecyclePhase, number>();
    for (const s of timeline) {
      counts.set(s.phase, (counts.get(s.phase) ?? 0) + 1);
    }
    expect(counts.get('REGULAR_SEASON_WEEK')).toBe(17);
    expect(counts.get('COLLEGE_WEEK')).toBe(12);
    // Each postseason / offseason / marker phase appears once.
    for (const p of [
      'PRESEASON',
      'TRADE_DEADLINE',
      'COLLEGE_CONFERENCE_CHAMPIONSHIPS',
      'HEISMAN_CEREMONY',
      'COLLEGE_BOWL_GAMES',
      'CFP_FIRST_ROUND',
      'CFP_QUARTERFINALS',
      'CFP_SEMIFINALS',
      'CFP_FINAL',
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
    ] as LifecyclePhase[]) {
      expect(counts.get(p)).toBe(1);
    }
    // READY_FOR_NEXT_SEASON is the wrap marker — not a dated step.
    expect(counts.get('READY_FOR_NEXT_SEASON')).toBeUndefined();
    // 17 NFL weeks + 12 college weeks + 22 single-shot phases.
    expect(timeline.length).toBe(17 + 12 + 22);
  });

  it('breaks the Dec-20 tie with bowls before the CFP first round', () => {
    const bowls = timeline.findIndex((s) => s.phase === 'COLLEGE_BOWL_GAMES');
    const cfpR1 = timeline.findIndex((s) => s.phase === 'CFP_FIRST_ROUND');
    expect(bowls).toBeGreaterThanOrEqual(0);
    expect(formatCalendarDate(timeline[bowls]!.date)).toBe('2026-12-20');
    expect(formatCalendarDate(timeline[cfpR1]!.date)).toBe('2026-12-20');
    expect(bowls).toBeLessThan(cfpR1);
  });

  it('spreads the college postseason across the late NFL season + playoffs', () => {
    const idxOf = (p: LifecyclePhase) => timeline.findIndex((s) => s.phase === p);
    const nflW17 = timeline.reduce(
      (acc, s, i) => (s.phase === 'REGULAR_SEASON_WEEK' ? i : acc),
      -1,
    );
    // Conference championships (Dec 6) fall before the final NFL
    // regular-season week (Dec 28) — not after the whole NFL season.
    expect(idxOf('COLLEGE_CONFERENCE_CHAMPIONSHIPS')).toBeLessThan(nflW17);
    // CFP quarters (Jan 1) + semis (Jan 9) fire after NFL Week 17 but
    // before the NFL Wild Card (Jan 13).
    expect(idxOf('CFP_QUARTERFINALS')).toBeGreaterThan(nflW17);
    expect(idxOf('CFP_SEMIFINALS')).toBeGreaterThan(nflW17);
    expect(idxOf('CFP_QUARTERFINALS')).toBeLessThan(idxOf('WILD_CARD'));
    expect(idxOf('CFP_SEMIFINALS')).toBeLessThan(idxOf('WILD_CARD'));
    // The CFP National Championship (Jan 19) sits between the NFL
    // Wild Card (Jan 13) and Divisional (Jan 20) rounds.
    expect(idxOf('CFP_FINAL')).toBeGreaterThan(idxOf('WILD_CARD'));
    expect(idxOf('CFP_FINAL')).toBeLessThan(idxOf('DIVISIONAL'));
  });

  it('ends with the offseason chain in date order, COLLEGE_CYCLE last', () => {
    const last = timeline[timeline.length - 1]!;
    expect(last.phase).toBe('COLLEGE_CYCLE');
  });

  it('advances every dated step by one year for season N+1', () => {
    const s1 = buildSeasonTimeline(1);
    const s2 = buildSeasonTimeline(2);
    expect(s2.length).toBe(s1.length);
    for (let i = 0; i < s1.length; i++) {
      expect(s2[i]!.phase).toBe(s1[i]!.phase);
      expect(s2[i]!.date.year).toBe(s1[i]!.date.year + 1);
    }
  });
});
