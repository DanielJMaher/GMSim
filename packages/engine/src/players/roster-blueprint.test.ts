import { describe, it, expect } from 'vitest';
import { Position } from '../types/enums.js';
import {
  ROSTER_BLUEPRINT_53,
  ROSTER_SIZE,
  QUALITY_DEPTH_TARGET,
} from './roster-blueprint.js';

describe('ROSTER_BLUEPRINT_53', () => {
  it('sums to 53', () => {
    expect(ROSTER_SIZE).toBe(53);
  });
});

/**
 * Madden-corpus position groups. Deliberately NOT `positionGroupFor` — the
 * engine's own `PositionGroup` lumps RB/FB/WR/TE into one SKILL bucket, while
 * the real bars below were measured against the Madden corpus's finer
 * `posGroup` taxonomy (`_qbroom_d2_allocation.mjs` and the derivation in
 * `docs/design-docs/TALENT_ALLOCATION.md` §3-4). The test has to speak the
 * same language as the bar it is checking.
 */
const MADDEN_GROUP: Readonly<Record<Position, string>> = {
  [Position.QB]: 'qb',
  [Position.RB]: 'rb',
  [Position.FB]: 'rb',
  [Position.WR]: 'wr',
  [Position.TE]: 'te',
  [Position.LT]: 'ol',
  [Position.LG]: 'ol',
  [Position.C]: 'ol',
  [Position.RG]: 'ol',
  [Position.RT]: 'ol',
  [Position.EDGE]: 'dl',
  [Position.DT]: 'dl',
  [Position.NT]: 'dl',
  [Position.ILB]: 'lb',
  [Position.OLB]: 'lb',
  [Position.CB]: 'db',
  [Position.S]: 'db',
  [Position.NICKEL]: 'db',
  [Position.K]: 'st',
  [Position.P]: 'st',
  [Position.LS]: 'st',
};

/**
 * Starter-calibre players per team, measured from the Madden corpus 2018-2024
 * at top-40% selectivity (= the engine's own STAR/STARTER tier rate). This is
 * the real bar `QUALITY_DEPTH_TARGET` is calibrated against; the group SUM is
 * what carries the measurement, not the within-group split.
 */
const REAL_STARTER_CALIBRE_PER_TEAM: Readonly<Record<string, number>> = {
  qb: 1.15,
  rb: 2.24,
  wr: 3.37,
  te: 1.74,
  ol: 4.67,
  dl: 4.4,
  lb: 3.32,
  db: 5.54,
  st: 1.25,
};

describe('QUALITY_DEPTH_TARGET', () => {
  it('covers every position in the blueprint', () => {
    for (const slot of ROSTER_BLUEPRINT_53) {
      expect(QUALITY_DEPTH_TARGET[slot.position]).toBeTypeOf('number');
    }
  });

  it('never exceeds roster shape — you cannot want more starters than bodies', () => {
    for (const slot of ROSTER_BLUEPRINT_53) {
      expect(QUALITY_DEPTH_TARGET[slot.position]).toBeLessThanOrEqual(slot.count);
    }
  });

  it('matches the real per-group bar within 0.6 at every group', () => {
    const sums = new Map<string, number>();
    for (const [pos, target] of Object.entries(QUALITY_DEPTH_TARGET)) {
      const group = MADDEN_GROUP[pos as Position];
      sums.set(group, (sums.get(group) ?? 0) + target);
    }
    for (const [group, real] of Object.entries(REAL_STARTER_CALIBRE_PER_TEAM)) {
      const got = sums.get(group) ?? 0;
      expect(
        Math.abs(got - real),
        `group ${group}: target sum ${got} vs real bar ${real}`,
      ).toBeLessThanOrEqual(0.6);
    }
  });

  it('errs UNDER the real league-wide total, never over', () => {
    // The defect this lever corrects is OVER-demand (the 53-man blueprint was
    // standing in as the quality target, 1.7-2.6x the real number at every
    // position). Erring low is the safe direction: an under-demanding NPC
    // trades less than it should, an over-demanding one hoards starters and
    // flattens every depth chart in the league.
    const total = Object.values(QUALITY_DEPTH_TARGET).reduce((s, n) => s + n, 0);
    const realTotal = Object.values(REAL_STARTER_CALIBRE_PER_TEAM).reduce((s, n) => s + n, 0);
    expect(total).toBeLessThan(realTotal);
    expect(total).toBeGreaterThan(realTotal - 3);
  });

  it('holds QB at exactly 1 — the sharpest real bar in the table', () => {
    // Real teams carry 1.15 starter-calibre QBs and 95.3% of real QB rooms
    // hold at most one (vs 19.2% under random assignment). QB is also the
    // position with the most downstream gates (Goatinator dual-gate, the
    // QB1-QB2 facet bar), so it is pinned rather than left to drift with the
    // rest of the table.
    expect(QUALITY_DEPTH_TARGET[Position.QB]).toBe(1);
  });
});
