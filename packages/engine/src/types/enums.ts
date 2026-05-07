// Enums used across the engine. Kept as string literals (not TS enums)
// so they serialize cleanly into save state and tree-shake well.

export const Conference = {
  AFC: 'AFC',
  NFC: 'NFC',
} as const;
export type Conference = (typeof Conference)[keyof typeof Conference];

export const Division = {
  AFC_EAST: 'AFC_EAST',
  AFC_NORTH: 'AFC_NORTH',
  AFC_SOUTH: 'AFC_SOUTH',
  AFC_WEST: 'AFC_WEST',
  NFC_EAST: 'NFC_EAST',
  NFC_NORTH: 'NFC_NORTH',
  NFC_SOUTH: 'NFC_SOUTH',
  NFC_WEST: 'NFC_WEST',
} as const;
export type Division = (typeof Division)[keyof typeof Division];

export const MarketSize = {
  LARGE: 'LARGE',
  MEDIUM: 'MEDIUM',
  SMALL: 'SMALL',
} as const;
export type MarketSize = (typeof MarketSize)[keyof typeof MarketSize];

// 22 starting positions + special teams. Position groups roll up many of these
// for archetype/scheme-fit logic. Stored as canonical position; group is derived.
export const Position = {
  QB: 'QB',
  RB: 'RB',
  FB: 'FB',
  WR: 'WR',
  TE: 'TE',
  LT: 'LT',
  LG: 'LG',
  C: 'C',
  RG: 'RG',
  RT: 'RT',
  EDGE: 'EDGE',
  DT: 'DT',
  NT: 'NT',
  ILB: 'ILB',
  OLB: 'OLB',
  CB: 'CB',
  S: 'S',
  NICKEL: 'NICKEL',
  K: 'K',
  P: 'P',
  LS: 'LS',
} as const;
export type Position = (typeof Position)[keyof typeof Position];

export const PositionGroup = {
  QB: 'QB',
  SKILL: 'SKILL', // RB, FB, WR, TE
  OL: 'OL',
  DL: 'DL',
  LB: 'LB',
  DB: 'DB',
  ST: 'ST',
} as const;
export type PositionGroup = (typeof PositionGroup)[keyof typeof PositionGroup];

// Franchise history archetype assigned at league generation per Personnel Generation doc.
export const FranchiseHistory = {
  SLEEPING_GIANT: 'SLEEPING_GIANT',
  RECENT_DYNASTY: 'RECENT_DYNASTY',
  LOVABLE_LOSER: 'LOVABLE_LOSER',
  CINDERELLA_STORY: 'CINDERELLA_STORY',
  REBUILD_IN_PROGRESS: 'REBUILD_IN_PROGRESS',
  CONTROVERSIAL_FRANCHISE: 'CONTROVERSIAL_FRANCHISE',
  NEW_IDENTITY: 'NEW_IDENTITY',
  PERENNIAL_CONTENDER: 'PERENNIAL_CONTENDER',
  CURSED_FRANCHISE: 'CURSED_FRANCHISE',
  SURPRISE_CHAMPION: 'SURPRISE_CHAMPION',
} as const;
export type FranchiseHistory = (typeof FranchiseHistory)[keyof typeof FranchiseHistory];

// Six competitive window states from the Dynasty/Rebuild Cycles doc.
// Names finalized when that doc is implemented in Phase 4; placeholder here.
export const CompetitiveWindow = {
  CHAMPIONSHIP: 'CHAMPIONSHIP',
  CONTENDER: 'CONTENDER',
  EMERGING: 'EMERGING',
  RETOOLING: 'RETOOLING',
  REBUILDING: 'REBUILDING',
  STAGNANT: 'STAGNANT',
} as const;
export type CompetitiveWindow = (typeof CompetitiveWindow)[keyof typeof CompetitiveWindow];
