/**
 * NPC AI — the canonical surface for NPC team decisions (CLAUDE.md invariant
 * #6, docs/LIVING_LEAGUE.md "NPC AI is its own module").
 *
 * Historically the decision logic grew inside the feature modules it serves
 * (draft, transactions, scouting), which is exactly the dispersal Living
 * League warns makes "the NPCs feel generic" undebuggable. This module is the
 * re-centralization seam: every entry point where an NPC front office DECIDES
 * something is re-exported here, so the whole NPC decision surface is
 * auditable in one place.
 *
 * Rules from here forward:
 *   1. NEW NPC decision behavior lands in (or is re-exported through) this
 *      module in the same slice that creates it.
 *   2. When an existing decision module gets a substantial rework, move it
 *      under `npc-ai/` as part of that slice (opportunistic migration, not a
 *      big-bang move).
 *   3. The lifecycle (`season/lifecycle.ts`) and other engine drivers may keep
 *      their existing import paths — this surface exists for auditability and
 *      for new callers; it adds no second code path.
 *
 * The decision surface, by domain:
 *
 *   Draft day      — board construction + the pick itself
 *   Trades         — weekly NPC trades, deadline fire-sales/proactive moves
 *   Free agency    — the offseason auction, weekly street signings, poaching
 *   Roster         — UDFA promotion (post-draft scramble)
 *
 * Hire/fire (GM + coaching carousel) has no engine path yet — when it lands,
 * it lands HERE.
 */

// Draft day — each team's board (scheme/need/media-trust shaped) and the
// 32-team pick loop (trade-ups, QB-need reaches, conversions).
export { regenerateDraftBoards, regenerateDraftBoardsForLeague } from '../draft/board.js';
export { runDraft } from '../draft/event.js';

// Trades — in-season weekly trade matching + the deadline/proactive lane
// (fire-sales, contender consolidation).
export { runWeeklyNpcTrades } from '../transactions/npc-trade.js';
export { runProactiveTrades } from '../transactions/proactive-trades.js';

// Free agency — the offseason auction (bids shaped by GM personality, cap
// room, rookie-pool reserve), weekly mid-season gap-fills, and poaching
// other teams' practice squads.
export { auctionFreeAgent, computeTeamCashBid, computePlayerPreference } from '../transactions/fa-bidding.js';
export { runWeeklyFreeAgentSignings } from '../transactions/midseason-fa.js';
export { runWeeklyPoaching } from '../transactions/poach.js';

// Roster — the post-draft UDFA scramble.
export { runUdfaPromotion } from '../draft/udfa.js';
