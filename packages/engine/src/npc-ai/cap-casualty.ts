import type { LeagueState } from '../types/league.js';
import type { Player } from '../types/player.js';
import type { PlayerId, ContractId, TeamId } from '../types/ids.js';
import {
  currentCapHit,
  deadMoneyOnPreJune1Release,
  isOffseasonPhase,
  splitDeadMoney,
} from '../contracts/cap.js';
import { positionScaledStandardY1, BID_MULTIPLIER_CEIL } from '../transactions/fa-bidding.js';
import { applyCapCutRelease } from '../transactions/offseason.js';

/**
 * THE CAP CASUALTY — the value-driven cut (`CAP_CASUALTY.md`, LIQUIDATOR
 * Fix 3a; `LIQUIDATOR_DEAD_MONEY.md` §18.7.4).
 *
 * This is NPC decision logic, so it lands HERE per CLAUDE.md invariant #6.
 * It writes the decision `LIQUIDATOR_DEAD_MONEY.md` §18.7.3 found the engine
 * completely lacking:
 *
 *   "GMSim contains no decision anywhere that compares a player's cap hit to
 *    his value. The real NFL's signature March event — eat the dead money to
 *    escape a contract that no longer earns its number — is not modelled. It
 *    is not mis-tuned; it is absent."
 *
 * Real bars this targets: R2 (43 eight-figure dead-money charges league-wide,
 * mean $18.74M) and R5 (19 of 32 teams carry ≥1, median 1 per team).
 *
 * **The law-3 trap this refuses:** every OTHER cut path in the engine
 * (`applyCapCuts`, `applyCapRestructures`) is gated on cap PRESSURE, and
 * GMSim teams sit ~10% under the cap on average — those gates essentially
 * never fire. This pass reads `league.salaryCap` only as a scale factor; it
 * NEVER reads team cap usage. A team $50M under the cap still correctly cuts
 * a player whose deal stopped earning its number — that is the entire point,
 * not a bug to fix later.
 *
 * **The value-vs-dollars wall this avoids:** `FRANCHISE_TAG.md` §13.1 hit
 * this exact comparison ("is he worth his number?") and correctly refused to
 * invent a value→dollars conversion constant. This design never compares
 * against `evaluatePlayerValue` — it compares two figures that are ALREADY
 * dollars: the contract's `currentCapHit`, and `positionScaledStandardY1`,
 * the open-market APY the engine's own FA auction would price this player at
 * TODAY, at his CURRENT tier and position. Zero new tunables; every term is
 * already derived from real OTC data or already calibrated against it
 * (`CAP_CASUALTY.md` §4.2).
 *
 * NOT TO BE CONFUSED with `transactions/offseason.ts`'s
 * `applyMinimalCapCasualties` — that is a cap-PRESSURE compliance backstop
 * (always cap-gated); this is a VALUE decision (never cap-gated). See that
 * function's own doc comment for the mirror-image note.
 */

/** Per-player evaluation. See `evaluateCapCasualty`. */
export interface CapCasualtyEvaluation {
  playerId: PlayerId;
  contractId: ContractId;
  /** This year's cap hit on the contract being escaped. */
  capHit: number;
  /** Open-market APY for a player at his CURRENT tier + position, today's cap. */
  marketValue: number;
  /** Dead money charged to THIS year's cap (post-June-1 aware). */
  deadMoney: number;
  /** Dead money deferred to next year's cap; 0 for any offseason cut. */
  deadMoneyDeferred: number;
  /** `capHit − deadMoney`. */
  capSaving: number;
  /** `capSaving − marketValue` — the ordering key (descending). */
  surplus: number;
}

/**
 * Pure per-player decision — deliberately takes no `TeamState` (invariant 4
 * in its strongest form: the alpha player's own offseason UI,
 * `GAME_UI_FOUNDATION.md` §8.5, calls this identical function).
 *
 * Three conditions, all in dollars, all derived, zero new constants
 * (`CAP_CASUALTY.md` §4.1):
 *
 *   C1 — `capHit > market × BID_MULTIPLIER_CEIL`: the contract costs more
 *        than the TOP of what today's auction would pay for a replacement.
 *   C2 — `saving > 0`: escaping it actually frees cap this year. A contract
 *        whose money is already sunk is not a cut candidate.
 *   C3 — `dead >= market`: this is a CASUALTY, not a roster move — getting
 *        out costs at least a full year of the replacement's price. This is
 *        a scope boundary (§4.3), not GM psychology: cheap releases below
 *        this line are already `releaseSurplusStarters`' / `preseasonCuts`'
 *        territory, and routing them through this mechanic would
 *        double-count behaviour the engine already has.
 *
 * Returns `null` when the player is not a cap casualty.
 */
export function evaluateCapCasualty(
  league: LeagueState,
  player: Player,
): CapCasualtyEvaluation | null {
  if (!player.teamId || !player.contractId) return null;
  const contract = league.contracts[player.contractId];
  if (!contract) return null;
  if (contract.yearsRemaining <= 0) return null;

  const capHit = currentCapHit(contract);
  const market = positionScaledStandardY1(player, league);
  if (market <= 0) return null; // defensive

  if (!(capHit > market * BID_MULTIPLIER_CEIL)) return null; // C1

  const postJune1 = !isOffseasonPhase(league.phase);
  const split = splitDeadMoney(contract, deadMoneyOnPreJune1Release(contract), postJune1);
  const saving = capHit - split.currentYear;
  if (!(saving > 0)) return null; // C2
  if (!(split.currentYear >= market)) return null; // C3

  return {
    playerId: player.id,
    contractId: contract.id,
    capHit,
    marketValue: market,
    deadMoney: split.currentYear,
    deadMoneyDeferred: split.nextYear,
    capSaving: saving,
    surplus: saving - market,
  };
}

/**
 * League-shaped pass: cuts every cap casualty on every team. Runs FIRST in
 * `applyOffseasonTransactions` (`season/lifecycle.ts`), ahead of
 * `applyCapRestructures` — see the call-site comment there for why
 * (restructure-then-cut accelerates an artificially enlarged bonus, and the
 * money this pass frees funds the team's own re-signs/tag/market budget,
 * matching the real February/March order).
 *
 * Deterministic: teams in `Object.keys(league.teams)` order (matching
 * `applyCapCuts`), candidates within a team ordered by descending `surplus`
 * then ascending `playerId`. Pure function of contracts/players/teams/cap/
 * phase with no team-level state read, so the candidate set does not shift
 * as cuts execute — a single pass is exactly equivalent to sequential
 * re-evaluation (`CAP_CASUALTY.md` §4.5).
 */
export function applyCapCasualties(league: LeagueState): LeagueState {
  let working = league;

  for (const teamId of Object.keys(league.teams) as TeamId[]) {
    const team = league.teams[teamId];
    if (!team) continue;

    const candidates: CapCasualtyEvaluation[] = [];
    for (const playerId of team.rosterIds) {
      const player = working.players[playerId];
      if (!player) continue;
      const evaluation = evaluateCapCasualty(working, player);
      if (evaluation) candidates.push(evaluation);
    }
    candidates.sort((a, b) => {
      if (a.surplus !== b.surplus) return b.surplus - a.surplus;
      return a.playerId < b.playerId ? -1 : 1;
    });

    for (const candidate of candidates) {
      working = applyCapCutRelease(
        working,
        teamId,
        candidate.playerId,
        candidate.deadMoney,
        candidate.deadMoneyDeferred,
        candidate.capSaving,
        { capCasualty: true },
      );
    }
  }

  return working;
}
