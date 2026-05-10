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
import { ROSTER_BLUEPRINT_53 } from '../players/roster-blueprint.js';
import { teamCapUsage, currentCapHit } from '../contracts/cap.js';
import { LEAGUE_MINIMUM_SALARY } from '../contracts/constants.js';
import { schemeFitForPlayer } from '../scheme/fit.js';
import type { Transaction } from '../types/transaction.js';

/**
 * Run a single mid-season free-agent signing pass. Each team with fewer
 * than 53 active players + at least league-minimum cap room gets one
 * shot at signing the best-fit FA from the pool at any of its positional
 * deficits.
 *
 * Differences from the offseason FA market (`refillRosters`):
 *   - Single signing per team per call (matches poaching cadence).
 *   - Always 1-year league-minimum contract (the "vet-min" street signing).
 *   - Tier order doesn't matter — pool is whoever's left after offseason.
 *   - Position match required: scans only FAs at the team's deficit
 *     positions.
 *
 * Determinism: teams processed in sorted ID order; candidates scored
 * by `skillSummary × schemeFitForPlayer(...)` with ID-ascending tiebreaks.
 *
 * Pairs with `runWeeklyPoaching` — call after the poaching pass so PS
 * options are exhausted before falling through to street FAs.
 */
export function runWeeklyFreeAgentSignings(
  prng: Prng,
  league: LeagueState,
  signedOnTick: number,
): LeagueState {
  void prng; // reserved for future randomized tiebreaks

  const blueprintByPos = new Map<Position, number>();
  for (const slot of ROSTER_BLUEPRINT_53) blueprintByPos.set(slot.position, slot.count);

  const teamIds = (Object.keys(league.teams) as TeamId[]).sort();
  let working = league;
  let counter = 0;

  for (const teamId of teamIds) {
    const team = working.teams[teamId]!;
    if (team.rosterIds.length >= 53) continue;

    const capRoom = working.salaryCap - teamCapUsage(team, working);
    if (capRoom < LEAGUE_MINIMUM_SALARY) continue;

    const deficitPositions = positionsWithDeficit(team, working, blueprintByPos);
    if (deficitPositions.size === 0) continue;

    const candidate = findBestFreeAgent(working, teamId, deficitPositions);
    if (!candidate) continue;

    const idSuffix = `${team.identity.abbreviation}_FAmid${signedOnTick}_${counter++}`;
    working = applySigning(working, teamId, candidate.playerId, idSuffix, signedOnTick);
  }

  return working;
}

function positionsWithDeficit(
  team: TeamState,
  league: LeagueState,
  blueprintByPos: Map<Position, number>,
): Set<Position> {
  const have = new Map<Position, number>();
  for (const playerId of team.rosterIds) {
    const p = league.players[playerId];
    if (!p) continue;
    have.set(p.position, (have.get(p.position) ?? 0) + 1);
  }
  const deficits = new Set<Position>();
  for (const [pos, target] of blueprintByPos) {
    if (target - (have.get(pos) ?? 0) > 0) deficits.add(pos);
  }
  return deficits;
}

interface FreeAgentCandidate {
  playerId: PlayerId;
  score: number;
}

function findBestFreeAgent(
  league: LeagueState,
  teamId: TeamId,
  deficitPositions: Set<Position>,
): FreeAgentCandidate | null {
  const team = league.teams[teamId]!;
  const hc = league.coaches[team.headCoachId]!;

  let best: FreeAgentCandidate | null = null;
  for (const player of Object.values(league.players)) {
    if (player.teamId !== null) continue; // not a FA
    if (!deficitPositions.has(player.position)) continue;

    const fit = schemeFitForPlayer(player, {
      offensiveScheme: hc.offensiveScheme,
      defensiveScheme: hc.defensiveScheme,
    });
    const skill = skillSummary(player);
    const score = fit * skill;

    if (
      !best ||
      score > best.score ||
      (score === best.score && player.id < best.playerId)
    ) {
      best = { playerId: player.id, score };
    }
  }
  return best;
}

function skillSummary(player: Player): number {
  const s = player.current;
  return (
    s.technicalSkill +
    s.footballIq +
    s.speed +
    s.strength +
    s.decisionMaking
  );
}

function applySigning(
  league: LeagueState,
  teamId: TeamId,
  playerId: PlayerId,
  idSuffix: string,
  signedOnTick: number,
): LeagueState {
  const player = league.players[playerId]!;
  const team = league.teams[teamId]!;
  const contract: Contract = {
    id: ContractId(`C_${idSuffix}`),
    playerId: player.id,
    teamId,
    signedOnTick,
    realYears: 1,
    voidYears: 0,
    yearsRemaining: 1,
    baseSalaries: [LEAGUE_MINIMUM_SALARY],
    signingBonus: 0,
    rosterBonuses: [0],
    workoutBonuses: [0],
    guarantees: [{ baseGuaranteedPct: 0, type: 'NONE' }],
    incentives: [],
    noTradeClause: false,
  };
  const entry: Transaction = {
    kind: 'fa-sign',
    tick: signedOnTick,
    seasonNumber: league.seasonNumber,
    teamId,
    playerId,
    contractId: contract.id,
    yearOneCapHit: currentCapHit(contract),
    marketContract: false,
  };
  return {
    ...league,
    teams: {
      ...league.teams,
      [teamId]: { ...team, rosterIds: [...team.rosterIds, playerId] },
    } as Readonly<Record<TeamId, TeamState>>,
    players: {
      ...league.players,
      [playerId]: { ...player, teamId, contractId: contract.id },
    } as Readonly<Record<PlayerId, Player>>,
    contracts: {
      ...league.contracts,
      [contract.id]: contract,
    } as Readonly<Record<ContractIdType, Contract>>,
    transactionLog: [...league.transactionLog, entry],
  };
}
