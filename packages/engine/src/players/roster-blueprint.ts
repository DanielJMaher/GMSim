import { Position } from '../types/enums.js';

/**
 * Static 53-man roster position blueprint. Each entry is "give the team
 * `count` players at this position." Total counts must sum to 53.
 *
 * This is a starting blueprint applied uniformly to all 32 teams.
 * Scheme-specific roster shapes (e.g., 3-4 teams carrying more NTs and
 * fewer 4-3 DTs) can be layered on later as a transform that swaps
 * counts before generation.
 */
export interface RosterPositionSlot {
  position: Position;
  count: number;
}

export const ROSTER_BLUEPRINT_53: readonly RosterPositionSlot[] = [
  // Skill positions (16)
  { position: Position.QB, count: 3 },
  { position: Position.RB, count: 3 },
  { position: Position.FB, count: 1 },
  { position: Position.WR, count: 6 },
  { position: Position.TE, count: 3 },
  // OL (10)
  { position: Position.LT, count: 2 },
  { position: Position.LG, count: 2 },
  { position: Position.C, count: 2 },
  { position: Position.RG, count: 2 },
  { position: Position.RT, count: 2 },
  // DL (8)
  { position: Position.EDGE, count: 4 },
  { position: Position.DT, count: 3 },
  { position: Position.NT, count: 1 },
  // LB (6)
  { position: Position.ILB, count: 3 },
  { position: Position.OLB, count: 3 },
  // DB (10)
  { position: Position.CB, count: 5 },
  { position: Position.S, count: 4 },
  { position: Position.NICKEL, count: 1 },
  // ST (3)
  { position: Position.K, count: 1 },
  { position: Position.P, count: 1 },
  { position: Position.LS, count: 1 },
] as const;

export const ROSTER_SIZE = ROSTER_BLUEPRINT_53.reduce((s, p) => s + p.count, 0);
