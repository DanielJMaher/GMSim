import type { Prng } from '../prng/index.js';
import type { LeagueState } from '../types/league.js';
import type { Player } from '../types/player.js';
import type { PlayerId } from '../types/ids.js';
import { promoteProspectToFreeAgent } from './promote.js';

export interface RunUdfaPromotionOptions {
  /** Ids of prospects who were drafted this cycle — they're skipped. */
  draftedIds: ReadonlySet<PlayerId>;
}

export interface UdfaPromotionResult {
  /** New `Player` records for every undrafted-declared prospect. */
  newPlayers: readonly Player[];
  /** Prospect ids removed from `LeagueState.collegePool`. */
  removedFromCollegePool: ReadonlySet<PlayerId>;
}

/**
 * Run the undrafted-rookie-FA pipeline. Walks the college pool for
 * declared draft-eligible prospects who were NOT drafted this cycle
 * and promotes each one to an NFL `Player` record with `teamId: null`
 * and `contractId: null`. The promoted players join the FA pool;
 * `refillRosters` next offseason will sign the best of them.
 *
 * Per Doc 3: every declared prospect deserves a path into the NFL —
 * before slice 5c they'd silently expire when the pool advanced.
 * Now they enter the league as the late-round/UDFA talent layer
 * (Kurt Warner / Antonio Gates / Tony Romo archetypes).
 *
 * Pure: returns the result; caller applies via `applyUdfaResult`.
 */
export function runUdfaPromotion(
  prng: Prng,
  league: LeagueState,
  options: RunUdfaPromotionOptions,
): UdfaPromotionResult {
  const newPlayers: Player[] = [];
  const removed = new Set<PlayerId>();
  for (const cp of league.collegePool) {
    if (!cp.isDraftEligible) continue;
    if (!cp.hasDeclared) continue;
    if (options.draftedIds.has(cp.id)) continue;
    const player = promoteProspectToFreeAgent(prng.fork(`udfa:${cp.id}`), cp);
    newPlayers.push(player);
    removed.add(cp.id);
  }
  return { newPlayers, removedFromCollegePool: removed };
}

/**
 * Apply a `UdfaPromotionResult` to a `LeagueState`. Adds the new
 * `Player` records to `players` and removes the promoted prospects
 * from `collegePool`. Pure — returns a new `LeagueState`.
 */
export function applyUdfaResult(
  league: LeagueState,
  result: UdfaPromotionResult,
): LeagueState {
  if (result.newPlayers.length === 0) return league;
  const players: Record<string, Player> = { ...league.players };
  for (const p of result.newPlayers) players[p.id] = p;
  const collegePool = league.collegePool.filter(
    (cp) => !result.removedFromCollegePool.has(cp.id),
  );
  return {
    ...league,
    players: players as typeof league.players,
    collegePool,
  };
}
