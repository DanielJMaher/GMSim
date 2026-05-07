import { Position, PositionGroup } from '../types/enums.js';

/**
 * Map a Position to its PositionGroup. Stable lookup; never changes
 * over the lifetime of the league.
 */
export function positionGroupFor(position: Position): PositionGroup {
  switch (position) {
    case Position.QB:
      return PositionGroup.QB;
    case Position.RB:
    case Position.FB:
    case Position.WR:
    case Position.TE:
      return PositionGroup.SKILL;
    case Position.LT:
    case Position.LG:
    case Position.C:
    case Position.RG:
    case Position.RT:
      return PositionGroup.OL;
    case Position.EDGE:
    case Position.DT:
    case Position.NT:
      return PositionGroup.DL;
    case Position.ILB:
    case Position.OLB:
      return PositionGroup.LB;
    case Position.CB:
    case Position.S:
    case Position.NICKEL:
      return PositionGroup.DB;
    case Position.K:
    case Position.P:
    case Position.LS:
      return PositionGroup.ST;
    default: {
      const _exhaustive: never = position;
      throw new Error(`Unknown position: ${String(_exhaustive)}`);
    }
  }
}
