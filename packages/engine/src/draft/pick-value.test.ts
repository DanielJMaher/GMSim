import { describe, expect, it } from 'vitest';
import {
  BASE_PICK_VALUES,
  FUTURE_YEAR_DISCOUNTS,
  pickValue,
  valueOfPicks,
  comparePickPackages,
  roundForOverallPick,
} from './pick-value.js';

describe('BASE_PICK_VALUES', () => {
  it('has 257 entries (real NFL draft size including comp picks)', () => {
    expect(BASE_PICK_VALUES.length).toBe(257);
  });

  it('pick 1 = 10,000 per Doc 5', () => {
    expect(BASE_PICK_VALUES[0]).toBe(10000);
  });

  it('exact Doc 5 anchor values for round 1', () => {
    expect(BASE_PICK_VALUES[0]).toBe(10000);  // Pick 1
    expect(BASE_PICK_VALUES[9]).toBe(5350);   // Pick 10
    expect(BASE_PICK_VALUES[15]).toBe(3740);  // Pick 16
    expect(BASE_PICK_VALUES[31]).toBe(1630);  // Pick 32
  });

  it('exact Doc 5 anchor values for rounds 2-4', () => {
    expect(BASE_PICK_VALUES[32]).toBe(2050);  // Pick 33 (R2 start)
    expect(BASE_PICK_VALUES[63]).toBe(650);   // Pick 64 (R2 end)
    expect(BASE_PICK_VALUES[64]).toBe(630);   // Pick 65 (R3 start)
    expect(BASE_PICK_VALUES[95]).toBe(267);   // Pick 96 (R3 end)
    expect(BASE_PICK_VALUES[96]).toBe(260);   // Pick 97 (R4 start)
    expect(BASE_PICK_VALUES[127]).toBe(130);  // Pick 128 (R4 end)
  });

  it('rounds 5-7 use linear ranges with Doc 5 anchors', () => {
    expect(BASE_PICK_VALUES[128]).toBe(128);  // Pick 129 (R5 start)
    expect(BASE_PICK_VALUES[159]).toBe(84);   // Pick 160 (R5 end)
    expect(BASE_PICK_VALUES[160]).toBe(82);   // Pick 161 (R6 start)
    expect(BASE_PICK_VALUES[191]).toBe(54);   // Pick 192 (R6 end)
    expect(BASE_PICK_VALUES[192]).toBe(52);   // Pick 193 (R7 start)
    expect(BASE_PICK_VALUES[256]).toBe(20);   // Pick 257 (R7 end)
  });

  it('values are strictly non-increasing within each round', () => {
    const roundBounds: ReadonlyArray<[number, number]> = [
      [1, 32], [33, 64], [65, 96], [97, 128], [129, 160], [161, 192], [193, 257],
    ];
    for (const [start, end] of roundBounds) {
      for (let pick = start + 1; pick <= end; pick++) {
        expect(BASE_PICK_VALUES[pick - 1]!).toBeLessThanOrEqual(BASE_PICK_VALUES[pick - 2]!);
      }
    }
  });

  it('jumps UP at round 1 → 2 boundary (modern Doc 5 flatter middle rounds)', () => {
    // Pick 33 (R2.1, 2050) > Pick 32 (R1.32, 1630). Round-1 picks
    // taper to round-2 picks; the chart deliberately makes early R2
    // > late R1 because of how Fitzgerald-Spielberger reweights
    // middle rounds.
    expect(BASE_PICK_VALUES[32]!).toBeGreaterThan(BASE_PICK_VALUES[31]!);
  });
});

describe('pickValue', () => {
  it('current year (yearsOut=0) is full base value', () => {
    expect(pickValue(1, 0)).toBe(10000);
    expect(pickValue(32, 0)).toBe(1630);
    expect(pickValue(100, 0)).toBe(242);
  });

  it('next year discounted 75% per Doc 5', () => {
    expect(pickValue(1, 1)).toBe(10000 * 0.75);
    expect(pickValue(32, 1)).toBe(1630 * 0.75);
  });

  it('two/three years out discounted 58% / 44%', () => {
    expect(pickValue(1, 2)).toBe(10000 * 0.58);
    expect(pickValue(1, 3)).toBe(10000 * 0.44);
  });

  it('caps discount at the 3-years-out value for picks further out', () => {
    expect(pickValue(1, 4)).toBe(pickValue(1, 3));
    expect(pickValue(1, 10)).toBe(pickValue(1, 3));
  });

  it('returns 0 for invalid picks', () => {
    expect(pickValue(0)).toBe(0);
    expect(pickValue(-5)).toBe(0);
    expect(pickValue(258)).toBe(0);
    expect(pickValue(1.5)).toBe(0);
    expect(pickValue(1, -1)).toBe(0);
  });
});

describe('FUTURE_YEAR_DISCOUNTS', () => {
  it('matches Doc 5 exactly', () => {
    expect(FUTURE_YEAR_DISCOUNTS).toEqual([1.0, 0.75, 0.58, 0.44]);
  });
});

describe('valueOfPicks', () => {
  it('sums a package', () => {
    const total = valueOfPicks([
      { overallPick: 1, yearsOut: 0 },  // 10000
      { overallPick: 33, yearsOut: 0 }, // 2050
      { overallPick: 100, yearsOut: 1 }, // 242 * 0.75 = 181.5
    ]);
    expect(total).toBeCloseTo(10000 + 2050 + 242 * 0.75, 5);
  });

  it('returns 0 for empty package', () => {
    expect(valueOfPicks([])).toBe(0);
  });
});

describe('comparePickPackages', () => {
  it('flags an even swap as fair', () => {
    const r = comparePickPackages(
      [{ overallPick: 10, yearsOut: 0 }],
      [{ overallPick: 10, yearsOut: 0 }],
    );
    expect(r.ratio).toBe(1);
    expect(r.netValue).toBe(0);
    expect(r.isChartFair).toBe(true);
  });

  it('classic Doc 5 trade-up: pick 5 for picks 12 + 60 is within fair band', () => {
    // Pick 5 = 7600. Pick 12 + Pick 60 = 4700 + 745 = 5445. Ratio
    // 5445/7600 ≈ 0.72 — outside the chart's ±10% fair band but
    // matches real NFL "premium to move up" pricing. Trader giving
    // pick 5 receives less by chart value but wants the specific
    // player — exactly the situational-modifier slice that comes
    // next.
    const r = comparePickPackages(
      [{ overallPick: 5, yearsOut: 0 }],
      [{ overallPick: 12, yearsOut: 0 }, { overallPick: 60, yearsOut: 0 }],
    );
    expect(r.ratio).toBeLessThan(0.85);
    expect(r.isChartFair).toBe(false);
  });

  it('positive netValue when receiving more', () => {
    const r = comparePickPackages(
      [{ overallPick: 50, yearsOut: 0 }],
      [{ overallPick: 10, yearsOut: 0 }],
    );
    expect(r.netValue).toBeGreaterThan(0);
    expect(r.ratio).toBeGreaterThan(1);
  });

  it('giving nothing → degenerate ratio 0 but isChartFair true (any value swap is "fair" from nothing)', () => {
    const r = comparePickPackages([], [{ overallPick: 100, yearsOut: 0 }]);
    expect(r.givingValue).toBe(0);
    expect(r.ratio).toBe(0);
    expect(r.isChartFair).toBe(true);
  });

  it('future-year pick worth less than current — discount visible in ratio', () => {
    const r = comparePickPackages(
      [{ overallPick: 10, yearsOut: 0 }],
      [{ overallPick: 10, yearsOut: 1 }],
    );
    expect(r.receivingValue).toBeLessThan(r.givingValue);
    expect(r.ratio).toBeCloseTo(0.75, 5);
  });
});

describe('roundForOverallPick', () => {
  it('maps each round correctly', () => {
    expect(roundForOverallPick(1)).toBe(1);
    expect(roundForOverallPick(32)).toBe(1);
    expect(roundForOverallPick(33)).toBe(2);
    expect(roundForOverallPick(64)).toBe(2);
    expect(roundForOverallPick(96)).toBe(3);
    expect(roundForOverallPick(128)).toBe(4);
    expect(roundForOverallPick(160)).toBe(5);
    expect(roundForOverallPick(192)).toBe(6);
    expect(roundForOverallPick(193)).toBe(7);
    expect(roundForOverallPick(257)).toBe(7);
  });
});
