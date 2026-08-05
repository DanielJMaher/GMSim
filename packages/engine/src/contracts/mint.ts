import type { LeagueState } from '../types/league.js';
import type { ContractId as ContractIdType, PlayerId, TeamId } from '../types/ids.js';
import { ContractId } from '../types/ids.js';
import type { Transaction } from '../types/transaction.js';

/**
 * Roster Floor §14 Fix 2 (Daniel-ruled 2026-08-05, `ROSTER_FLOOR.md` §14.9:
 * class-wide + log-and-continue). Every contract mint site in the engine
 * builds its id by hand-formatting a string (`C_${teamAbbr}_${kind}${tick-or-
 * season}_${counter}`) with no central allocator enforcing uniqueness — a
 * team engaging the same pass twice in one season (§14.2's root cause for
 * Bug B) can regenerate an id already in `league.contracts`, silently
 * aliasing two players onto one contract object. `applyFloorCut`/
 * `releasePlayer`-style delete-by-id then orphans whichever player didn't
 * get deleted, crashing far from the actual defect.
 *
 * `mintContractId` is the guard: resolve a requested id against the CURRENT
 * contracts map, deterministically uniquify (no PRNG — invariant 2) if
 * already taken, and report whether that happened. Every call site MUST use
 * the returned `.id` for BOTH the `contracts` map write and any
 * `Player.contractId` stamp — using the pre-guard id for one and the
 * resolved id for the other reproduces the exact aliasing this exists to
 * prevent (worse than not guarding at all).
 */
export interface MintedContractId {
  /** Final id — use this, not the originally requested one, everywhere. */
  id: ContractIdType;
  /** Present only when the requested id collided and was uniquified. */
  collision?: {
    attemptedId: ContractIdType;
    resolvedId: ContractIdType;
  };
}

export function mintContractId(
  contracts: LeagueState['contracts'],
  requestedId: ContractIdType,
): MintedContractId {
  if (!contracts[requestedId]) return { id: requestedId };
  let n = 1;
  let candidate: ContractIdType;
  do {
    candidate = ContractId(`${requestedId}_DUP${n}`);
    n++;
  } while (contracts[candidate]);
  return { id: candidate, collision: { attemptedId: requestedId, resolvedId: candidate } };
}

/**
 * Build the `contract-id-collision` transaction entry for a mint's
 * collision. Returns `undefined` when `minted` had no collision — callers
 * splice conditionally (`if (entry) push(entry)`), never unconditionally,
 * so the common (no-collision) case never grows the transaction log.
 */
export function contractIdCollisionEntry(
  minted: MintedContractId,
  ctx: { tick: number; seasonNumber: number; teamId: TeamId; playerId: PlayerId },
): Transaction | undefined {
  if (!minted.collision) return undefined;
  return {
    kind: 'contract-id-collision',
    tick: ctx.tick,
    seasonNumber: ctx.seasonNumber,
    teamId: ctx.teamId,
    playerId: ctx.playerId,
    attemptedId: minted.collision.attemptedId,
    resolvedId: minted.collision.resolvedId,
  };
}
