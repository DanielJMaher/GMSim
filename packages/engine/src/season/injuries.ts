import type { Player } from '../types/player.js';
import type { GameInjury } from '../types/game.js';
import type { PlayerId, TeamId } from '../types/ids.js';
import { applyInjuryScar } from '../players/aging-curves.js';

/**
 * Injury propagation + recovery — the weekly availability state machine.
 *
 * Extracted (Injury Realism Stage I, v0.188.0) from `lifecycle.ts` and
 * `playoffs.ts`, which previously each inlined an identical copy. Both callers
 * now share this ONE code path, and so does the B2 real-roster injury-layer
 * validation harness (`_rr_seed.mjs --inj`, INJURY_REALISM §10.2) — the harness
 * runs the SAME engine functions, never a reimplementation.
 *
 * Behaviour is byte-for-byte the pre-extraction logic:
 *   - `recoverInjuries` clears any injury whose estimated return tick has passed
 *     (offseason/week-start heal). Returns the same map reference when nothing
 *     recovered (identity-stable, as before).
 *   - `propagateGameInjuries` stamps `Player.injury` from a game's rolls, applies
 *     the permanent MAJOR body scar (`applyInjuryScar`), and reports the MAJOR
 *     IR moves for the caller to enact (regular season IRs; playoffs ignore the
 *     moves — the season ends and the offseason heal clears state).
 */

/** One MAJOR injury that opens a roster spot (regular season → IR move). */
export interface IrMove {
  playerId: PlayerId;
  teamId: TeamId;
  severity: 'MINOR' | 'MODERATE' | 'MAJOR';
  weeksOut: number;
}

export interface InjuryPropagationResult {
  /** Player map with this game's injuries stamped (new object iff any applied). */
  players: Record<string, Player>;
  /** MAJOR injuries that should move their player to IR (empty when none). */
  irMoves: IrMove[];
}

/**
 * Clear every injury whose `estimatedReturnTick <= currentTick`. Returns the
 * input map unchanged (same reference) when nothing recovered.
 */
export function recoverInjuries(
  players: Record<string, Player>,
  currentTick: number,
): Record<string, Player> {
  let out = players;
  let changed = false;
  for (const [pid, p] of Object.entries(players)) {
    if (p.injury && p.injury.estimatedReturnTick <= currentTick) {
      if (!changed) {
        out = { ...players };
        changed = true;
      }
      out[pid] = { ...p, injury: null };
    }
  }
  return out;
}

/**
 * Stamp a game's `GameInjury[]` onto `Player.injury`. MAJOR injuries scar the
 * body permanently (before the status flag) and are reported as IR moves.
 * Returns the input map unchanged when the game produced no (rostered) injuries.
 */
export function propagateGameInjuries(
  players: Record<string, Player>,
  injuries: readonly GameInjury[],
  occurredOnTick: number,
): InjuryPropagationResult {
  const updates: Record<string, Player> = {};
  const irMoves: IrMove[] = [];
  for (const inj of injuries) {
    const p = players[inj.playerId];
    if (!p) continue;
    // S5: MAJOR injuries permanently scar the body (durability + a coin-flip
    // step from each explosive trait) — applied at injury time, before the flag.
    const scarred = inj.severity === 'MAJOR' ? applyInjuryScar(p, occurredOnTick) : p;
    updates[inj.playerId] = {
      ...scarred,
      injury: {
        type: inj.type,
        severity: inj.severity,
        occurredOnTick,
        estimatedReturnTick: occurredOnTick + inj.weeksOut,
      },
    };
    if (inj.severity === 'MAJOR' && p.teamId) {
      irMoves.push({
        playerId: inj.playerId,
        teamId: p.teamId,
        severity: inj.severity,
        weeksOut: inj.weeksOut,
      });
    }
  }
  const nextPlayers =
    Object.keys(updates).length > 0 ? { ...players, ...updates } : players;
  return { players: nextPlayers, irMoves };
}
