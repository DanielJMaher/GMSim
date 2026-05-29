import { describe, expect, it } from 'vitest';
import { synthesizeDraftProvenance, provenanceFromOverallPick } from './draft-provenance.js';
import { Prng } from '../prng/index.js';
import { Position } from '../types/enums.js';

describe('synthesizeDraftProvenance', () => {
  it('produces valid rounds/picks or a clean UDFA', () => {
    const prng = new Prng('prov-valid');
    for (let i = 0; i < 200; i++) {
      const p = synthesizeDraftProvenance(prng.fork(`p${i}`), 'STARTER', Position.WR);
      if (p.round === null) {
        expect(p.overallPick).toBeNull();
      } else {
        expect(p.round).toBeGreaterThanOrEqual(1);
        expect(p.round).toBeLessThanOrEqual(7);
        expect(p.overallPick).toBeGreaterThanOrEqual(1);
        expect(p.overallPick).toBeLessThanOrEqual(7 * 32);
        // pick is consistent with round
        expect(Math.ceil(p.overallPick! / 32)).toBe(p.round);
      }
    }
  });

  it('is deterministic for the same prng seed', () => {
    const a = synthesizeDraftProvenance(new Prng('x'), 'STAR', Position.QB);
    const b = synthesizeDraftProvenance(new Prng('x'), 'STAR', Position.QB);
    expect(a).toEqual(b);
  });

  it('stars skew much earlier than fringe players', () => {
    const prng = new Prng('prov-skew');
    const meanRound = (tier: 'STAR' | 'FRINGE') => {
      let sum = 0;
      let n = 0;
      for (let i = 0; i < 400; i++) {
        const p = synthesizeDraftProvenance(prng.fork(`${tier}${i}`), tier, Position.WR);
        // Treat UDFA as round 8 for the comparison.
        sum += p.round ?? 8;
        n += 1;
      }
      return sum / n;
    };
    expect(meanRound('STAR')).toBeLessThan(meanRound('FRINGE') - 1.5);
  });

  it('produces gems and busts in the spread (stars sometimes slide, fringe sometimes early)', () => {
    const prng = new Prng('prov-spread');
    let lateStar = 0;
    for (let i = 0; i < 500; i++) {
      const p = synthesizeDraftProvenance(prng.fork(`s${i}`), 'STAR', Position.RB);
      if (p.round === null || p.round >= 4) lateStar += 1;
    }
    // Some stars slid to day 3 / undrafted — the gem stories.
    expect(lateStar).toBeGreaterThan(0);
  });

  it('premium positions skew earlier than cheap ones for the same tier', () => {
    const prng = new Prng('prov-pos');
    const meanRound = (pos: Position) => {
      let sum = 0;
      for (let i = 0; i < 400; i++) {
        const p = synthesizeDraftProvenance(prng.fork(`${pos}${i}`), 'STARTER', pos);
        sum += p.round ?? 8;
      }
      return sum / 400;
    };
    expect(meanRound(Position.QB)).toBeLessThan(meanRound(Position.RB));
  });
});

describe('provenanceFromOverallPick', () => {
  it('maps overall picks to the right round', () => {
    expect(provenanceFromOverallPick(1)).toEqual({ round: 1, overallPick: 1 });
    expect(provenanceFromOverallPick(32)).toEqual({ round: 1, overallPick: 32 });
    expect(provenanceFromOverallPick(33)).toEqual({ round: 2, overallPick: 33 });
    expect(provenanceFromOverallPick(224)).toEqual({ round: 7, overallPick: 224 });
  });

  it('treats null / non-positive as undrafted', () => {
    expect(provenanceFromOverallPick(null)).toEqual({ round: null, overallPick: null });
    expect(provenanceFromOverallPick(0)).toEqual({ round: null, overallPick: null });
  });
});
