import { describe, expect, it } from 'vitest';
import { Position } from '../types/enums.js';
import { convertiblePositions, canConvertTo } from './position-conversion.js';

describe('convertiblePositions', () => {
  it('always includes the natural position first', () => {
    for (const pos of Object.values(Position)) {
      expect(convertiblePositions(pos)[0]).toBe(pos);
    }
  });

  it('lets a tackle kick to the other tackle or inside to guard', () => {
    const lt = convertiblePositions(Position.LT);
    expect(lt).toContain(Position.RT);
    expect(lt).toContain(Position.LG);
    const rt = convertiblePositions(Position.RT);
    expect(rt).toContain(Position.LT);
    expect(rt).toContain(Position.RG);
  });

  it('does not convert skill positions or specialists', () => {
    for (const pos of [Position.QB, Position.RB, Position.WR, Position.TE, Position.K, Position.P, Position.LS]) {
      expect(convertiblePositions(pos)).toEqual([pos]);
    }
  });
});

describe('canConvertTo', () => {
  it('is true for the identity and for listed conversions', () => {
    expect(canConvertTo(Position.RT, Position.RT)).toBe(true);
    expect(canConvertTo(Position.RT, Position.LT)).toBe(true); // Daniel's case
    expect(canConvertTo(Position.EDGE, Position.OLB)).toBe(true);
    expect(canConvertTo(Position.CB, Position.NICKEL)).toBe(true);
  });

  it('is false across unrelated positions', () => {
    expect(canConvertTo(Position.RT, Position.WR)).toBe(false);
    expect(canConvertTo(Position.QB, Position.RB)).toBe(false);
    expect(canConvertTo(Position.CB, Position.LT)).toBe(false);
  });
});
