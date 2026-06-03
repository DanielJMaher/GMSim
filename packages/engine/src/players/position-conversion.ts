import { Position } from '../types/enums.js';

/**
 * Position convertibility (2026-06-03, Daniel-directed).
 *
 * NFL teams routinely draft a prospect at one position and play him at an
 * ADJACENT one to fill a need — the classic case is a team that needs a left
 * tackle drafting a college/projected RIGHT tackle and kicking him to the left
 * side. The prospect never played the spot, but the traits transfer.
 *
 * This map encodes which NFL positions a prospect can realistically be
 * CONVERTED to play. It is the adjacency the draft board uses to let a team
 * value a convertible prospect at a *needed* position (see board.ts
 * `assignedPositionFor`). It is deliberately conservative — only genuinely
 * interchangeable spots (tackle↔tackle, the interior OL, edge↔off-ball-LB,
 * interior DL, slot/safety/corner in the secondary). Skill positions
 * (QB/RB/WR/TE) and specialists don't cross.
 *
 * NOTE: conversion is gated on NEED + the prospect's grade at the board level;
 * this map only says "is the move physically plausible." Tune freely.
 */
const POSITION_CONVERSIONS: Partial<Record<Position, readonly Position[]>> = {
  // Offensive line — tackles swap sides or kick inside to guard; interior is
  // fully interchangeable.
  [Position.LT]: [Position.RT, Position.LG],
  [Position.RT]: [Position.LT, Position.RG],
  [Position.LG]: [Position.RG, Position.C, Position.LT],
  [Position.RG]: [Position.LG, Position.C, Position.RT],
  [Position.C]: [Position.LG, Position.RG],
  // Front seven — edge ↔ off-ball linebacker (3-4/4-3 scheme swing), interior DL.
  [Position.EDGE]: [Position.OLB],
  [Position.OLB]: [Position.EDGE, Position.ILB],
  [Position.ILB]: [Position.OLB],
  [Position.DT]: [Position.NT],
  [Position.NT]: [Position.DT],
  // Secondary — outside corner ↔ slot ↔ safety.
  [Position.CB]: [Position.NICKEL, Position.S],
  [Position.S]: [Position.NICKEL, Position.CB],
  [Position.NICKEL]: [Position.CB, Position.S],
};

/**
 * The positions a prospect at `position` can play — his natural spot first,
 * then the realistic conversions. Always includes the natural position.
 */
export function convertiblePositions(position: Position): readonly Position[] {
  const conv = POSITION_CONVERSIONS[position];
  return conv ? [position, ...conv] : [position];
}

/** True if `to` is the natural position or a realistic conversion of `from`. */
export function canConvertTo(from: Position, to: Position): boolean {
  if (from === to) return true;
  return (POSITION_CONVERSIONS[from] ?? []).includes(to);
}
