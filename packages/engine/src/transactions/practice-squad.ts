import type { LeagueState } from '../types/league.js';
import type { Player } from '../types/player.js';
import type { Contract } from '../types/contract.js';
import type { TeamState } from '../types/team.js';
import type {
  PlayerId,
  TeamId,
  ContractId as ContractIdType,
} from '../types/ids.js';
import { ContractId } from '../types/ids.js';
import type { Position } from '../types/enums.js';
import type { Prng } from '../prng/index.js';
import { generatePlayer } from '../players/generate.js';
import { positionGroupFor } from '../players/position-group.js';
import { ROSTER_BLUEPRINT_53 } from '../players/roster-blueprint.js';
import { PositionGroup } from '../types/enums.js';
import {
  PRACTICE_SQUAD_SALARY,
  PRACTICE_SQUAD_SIZE,
} from '../contracts/constants.js';

/**
 * Top each team's practice squad up to PRACTICE_SQUAD_SIZE with freshly
 * generated rookies on 1-year PS-minimum contracts. Existing PS members
 * are preserved.
 *
 * Position selection is weighted by ROSTER_BLUEPRINT_53 so PS allocation
 * mirrors active-roster shape. Each new player gets a rookie-aged profile,
 * a position-appropriate archetype, and a deterministic ID.
 *
 * Determinism: a single Prng is forked per (team, slot) so adding teams
 * later in the season without changing earlier ones produces stable IDs.
 */
export function refillPracticeSquad(
  prng: Prng,
  league: LeagueState,
  signedOnTick: number,
  seasonNumber: number,
): LeagueState {
  const positionPool = buildWeightedPositionPool();

  const playersNext: Record<string, Player> = { ...league.players };
  const contractsNext: Record<string, Contract> = { ...league.contracts };
  const teamsNext: Record<string, TeamState> = { ...league.teams };
  let counter = 0;

  for (const team of Object.values(league.teams)) {
    const need = PRACTICE_SQUAD_SIZE - team.practiceSquadIds.length;
    if (need <= 0) continue;

    const teamPrng = prng.fork(`team:${team.identity.id}`);
    const newPsIds: PlayerId[] = [];

    for (let slot = 0; slot < need; slot++) {
      const slotPrng = teamPrng.fork(`slot:${slot}`);
      const position = slotPrng.pick(positionPool);
      const idSuffix = `${team.identity.abbreviation}_PS${seasonNumber}_${counter++}`;
      const generated = generatePlayer(slotPrng.fork('gen'), {
        position,
        idSuffix,
        forceAgeStage: 'ROOKIE',
        simYear: 2026 + (seasonNumber - 1),
        schemeContext: schemeContextFor(team, league, position),
      });
      const player: Player = {
        ...generated,
        teamId: team.identity.id,
      };
      const contract = makePracticeSquadContract(
        player,
        team.identity.id,
        idSuffix,
        signedOnTick,
      );
      const finalPlayer: Player = { ...player, contractId: contract.id };

      playersNext[finalPlayer.id] = finalPlayer;
      contractsNext[contract.id] = contract;
      newPsIds.push(finalPlayer.id);
    }

    teamsNext[team.identity.id] = {
      ...team,
      practiceSquadIds: [...team.practiceSquadIds, ...newPsIds],
    };
  }

  return {
    ...league,
    teams: teamsNext as Readonly<Record<TeamId, TeamState>>,
    players: playersNext as Readonly<Record<PlayerId, Player>>,
    contracts: contractsNext as Readonly<Record<ContractIdType, Contract>>,
  };
}

/**
 * Build a weighted position list from ROSTER_BLUEPRINT_53. Each entry
 * appears proportional to its blueprint count; `prng.pick` then samples
 * uniformly across the array, yielding the desired weighted distribution.
 */
function buildWeightedPositionPool(): readonly Position[] {
  const pool: Position[] = [];
  for (const slot of ROSTER_BLUEPRINT_53) {
    for (let i = 0; i < slot.count; i++) pool.push(slot.position);
  }
  return pool;
}

function schemeContextFor(team: TeamState, league: LeagueState, position: Position) {
  const hc = league.coaches[team.headCoachId]!;
  const group = positionGroupFor(position);
  let side: 'OFFENSE' | 'DEFENSE' | 'SPECIAL_TEAMS';
  switch (group) {
    case PositionGroup.QB:
    case PositionGroup.SKILL:
    case PositionGroup.OL:
      side = 'OFFENSE';
      break;
    case PositionGroup.DL:
    case PositionGroup.LB:
    case PositionGroup.DB:
      side = 'DEFENSE';
      break;
    case PositionGroup.ST:
      side = 'SPECIAL_TEAMS';
      break;
  }
  return {
    side,
    offensiveScheme: hc.offensiveScheme,
    defensiveScheme: hc.defensiveScheme,
  };
}

/**
 * Build a 1-year practice-squad contract at PRACTICE_SQUAD_SALARY. No
 * signing bonus, no guarantees, no clauses — the simplest possible deal.
 * PS contracts sit in `league.contracts` like any other contract but are
 * not counted toward `teamCapUsage` (which iterates `rosterIds`).
 */
export function makePracticeSquadContract(
  player: Player,
  teamId: TeamId,
  idSuffix: string,
  signedOnTick: number,
): Contract {
  return {
    id: ContractId(`C_${idSuffix}`),
    playerId: player.id,
    teamId,
    signedOnTick,
    realYears: 1,
    voidYears: 0,
    yearsRemaining: 1,
    baseSalaries: [PRACTICE_SQUAD_SALARY],
    signingBonus: 0,
    rosterBonuses: [0],
    workoutBonuses: [0],
    guarantees: [{ baseGuaranteedPct: 0, type: 'NONE' }],
    incentives: [],
    noTradeClause: false,
  };
}
