/**
 * `capView` — your own book (GAME_UI_FOUNDATION.md §8.3; the cuts and re-sign
 * screens read this).
 *
 * This is the one surface where the North Star's line is unusually generous,
 * and §8.3 draws it explicitly: **your own cap position, dead money and
 * commitments are your own book**, and real NFL contracts are public anyway.
 * So money crosses here in full — cap hits, dead money, guarantees, years
 * remaining, and what a release would actually cost.
 *
 * That last one is the reason this view exists rather than the screen doing its
 * own arithmetic. D9's ruling is that FA, cuts and re-signs are one coupled
 * loop, because to sign you need room and room comes from cuts. A cuts screen
 * that cannot show what a cut FREES — net of the dead money it accelerates — is
 * not a cap tool, it is a list. The engine already knows
 * (`deadMoneyOnPreJune1Release`), and it is the same number
 * `applyMinimalCapCasualties` reasons about, so the player and the NPC AI are
 * looking at the same board.
 *
 * ## What still does not cross
 *
 * Money is public; QUALITY is not. A cap table lists players, and a careless
 * join would put `current` and `talentScore` beside the dollars. Each row
 * carries name, position, age and service only — a screen that wants to know
 * whether a player is worth his money reads `rosterView`'s coach's card for
 * that, exposure-scaled like everything else.
 */

import type { PlayerId, TeamId } from '../types/ids.js';
import type { Position } from '../types/enums.js';
import type { LeagueState } from '../types/league.js';
import type { Contract } from '../types/contract.js';
import {
  currentCapHit,
  deadMoneyOnPreJune1Release,
  summarizeTeamCap,
  unamortizedSigningBonus,
} from '../contracts/cap.js';
import { ageOfPlayer } from '../season/development.js';
import { unwrapGameLeague, type GameLeague } from './game-session.js';

/** One contract on the books. Money in full; quality not at all. */
export interface CapRowView {
  playerId: PlayerId;
  firstName: string;
  lastName: string;
  position: Position;
  ageYears: number;
  experienceYears: number;

  /** This league year's charge against the cap. */
  capHit: number;
  /** Per-year base salary remaining, current year first. */
  baseSalaryThisYear: number;
  /** Signing-bonus dollars not yet charged — the accelerating part. */
  unamortizedBonus: number;
  yearsRemaining: number;
  /** Void years appended for proration. Real teams eat these when a deal lapses. */
  voidYears: number;

  /**
   * What releasing him RIGHT NOW costs against this year's cap. The honest
   * number: it is dead money, not savings.
   */
  deadMoneyIfReleased: number;
  /**
   * What releasing him actually FREES this year — `capHit` minus the dead
   * money. **Can be negative**, and that is not a display bug: cutting a
   * player whose bonus acceleration exceeds his cap hit costs you room. That
   * exact case is the defect class Roster Floor Fix A exists to stop the NPC AI
   * walking into, and a player-facing cuts screen must not hide it either.
   */
  capFreedIfReleased: number;
}

export interface CapView {
  teamId: TeamId;
  capCeiling: number;
  capUsed: number;
  capSpace: number;
  /** Dead money already on the books — money paid to players who are gone. */
  deadMoney: number;
  /** Active contracts, largest cap hit first. */
  rows: readonly CapRowView[];
}

function rowFor(league: LeagueState, contract: Contract): CapRowView | null {
  const player = league.players[contract.playerId];
  if (!player) return null;

  const capHit = currentCapHit(contract);
  const dead = deadMoneyOnPreJune1Release(contract);

  return {
    playerId: player.id,
    firstName: player.firstName,
    lastName: player.lastName,
    position: player.position,
    ageYears: ageOfPlayer(player, league.seasonNumber),
    experienceYears: player.experienceYears,
    capHit,
    baseSalaryThisYear:
      contract.baseSalaries[contract.realYears - contract.yearsRemaining] ?? 0,
    unamortizedBonus: unamortizedSigningBonus(contract),
    yearsRemaining: contract.yearsRemaining,
    voidYears: contract.voidYears,
    deadMoneyIfReleased: dead,
    capFreedIfReleased: capHit - dead,
  };
}

/**
 * One club's cap book. Only ever called for the player's own club by the game —
 * but the engine keeps no player-team privilege (invariant #4), so it takes any
 * team id and the UI decides whose book it is showing.
 */
export function capView(handle: GameLeague, teamId: TeamId): CapView | null {
  const league = unwrapGameLeague(handle);
  const team = league.teams[teamId];
  if (!team) return null;

  const summary = summarizeTeamCap(team, league);

  const rows: CapRowView[] = [];
  let deadMoney = 0;
  for (const contract of Object.values(league.contracts)) {
    if (contract.teamId !== teamId) continue;
    const onRoster =
      team.rosterIds.includes(contract.playerId) ||
      team.injuredReserveIds.includes(contract.playerId) ||
      team.practiceSquadIds.includes(contract.playerId);
    if (!onRoster) {
      // A contract still charging this club for a player who is gone.
      deadMoney += currentCapHit(contract);
      continue;
    }
    const row = rowFor(league, contract);
    if (row) rows.push(row);
  }

  rows.sort((a, b) => b.capHit - a.capHit);

  return {
    teamId,
    capCeiling: summary.capCeiling,
    capUsed: summary.capUsed,
    capSpace: summary.capSpace,
    deadMoney,
    rows,
  };
}
