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
import { teamCapUsage } from '../contracts/cap.js';
import { LEAGUE_MINIMUM_SALARY } from '../contracts/constants.js';
import { schemeFitForPlayer } from '../scheme/fit.js';
import type { Transaction } from '../types/transaction.js';

/**
 * Run a single mid-season practice-squad poaching pass. Each team with
 * fewer than 53 active players gets one shot at promoting a PS player
 * (own or another team's) into their biggest positional deficit.
 *
 * Scoring: PS candidates ranked by skill summary × scheme fit at the
 * poaching team. Determinism: teams processed in sorted ID order;
 * within a team, candidates compared by (score desc, originTeamId asc,
 * playerId asc).
 *
 * Protections: each team protects up to 4 PS players per week,
 * deterministically picked as the top-4 by skill × scheme fit at the
 * team itself. Protected players cannot be poached by *other* teams,
 * but the team owning them can still promote them (real NFL: protection
 * blocks external claims, not internal promotions).
 *
 * Promotion mechanics:
 *   - PS contract dropped.
 *   - New 1-year league-minimum active contract signed.
 *   - Player removed from origin team's `practiceSquadIds`, added to
 *     poaching team's `rosterIds`.
 *   - Player.teamId updated to the poaching team.
 */
export function runWeeklyPoaching(
  prng: Prng,
  league: LeagueState,
  signedOnTick: number,
): LeagueState {
  void prng; // reserved for future randomized tiebreaks
  const blueprintByPos = new Map<Position, number>();
  for (const slot of ROSTER_BLUEPRINT_53) blueprintByPos.set(slot.position, slot.count);

  const protections = computeWeeklyProtections(league);
  const teamIds = (Object.keys(league.teams) as TeamId[]).sort();
  let working = league;
  let counter = 0;

  for (const teamId of teamIds) {
    const team = working.teams[teamId]!;
    if (team.rosterIds.length >= 53) continue;

    const capRoom = working.salaryCap - teamCapUsage(team, working);
    if (capRoom < LEAGUE_MINIMUM_SALARY) continue;

    const deficitPos = biggestDeficitPosition(team, working, blueprintByPos);
    if (!deficitPos) continue;

    const candidate = findBestPsCandidate(working, teamId, deficitPos, protections);
    if (!candidate) continue;

    const idSuffix = `${team.identity.abbreviation}_POACH${signedOnTick}_${counter++}`;
    working = applyPoach(
      working,
      candidate.originTeamId,
      candidate.playerId,
      teamId,
      idSuffix,
      signedOnTick,
    );
  }

  return working;
}

/** Maximum PS players a team can protect from external poaching per week. */
export const MAX_PS_PROTECTIONS_PER_WEEK = 4;

/**
 * For each team, pick the top MAX_PS_PROTECTIONS_PER_WEEK PS players to
 * shield from external poaching. Ranking: skill summary × scheme fit at
 * the team itself; ties broken by player id ascending. If a team has
 * fewer PS players than the protection limit, all are protected.
 */
export function computeWeeklyProtections(
  league: LeagueState,
): Map<TeamId, Set<PlayerId>> {
  const result = new Map<TeamId, Set<PlayerId>>();
  for (const team of Object.values(league.teams)) {
    const hc = league.coaches[team.headCoachId]!;
    const ranked = team.practiceSquadIds
      .map((id) => league.players[id])
      .filter((p): p is Player => Boolean(p))
      .map((p) => ({
        id: p.id,
        score:
          skillSummary(p) *
          schemeFitForPlayer(p, {
            offensiveScheme: hc.offensiveScheme,
            defensiveScheme: hc.defensiveScheme,
          }),
      }))
      .sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        return a.id < b.id ? -1 : 1;
      })
      .slice(0, MAX_PS_PROTECTIONS_PER_WEEK)
      .map((entry) => entry.id);
    result.set(team.identity.id, new Set(ranked));
  }
  return result;
}

function biggestDeficitPosition(
  team: TeamState,
  league: LeagueState,
  blueprintByPos: Map<Position, number>,
): Position | null {
  const have = new Map<Position, number>();
  for (const playerId of team.rosterIds) {
    const p = league.players[playerId];
    if (!p) continue;
    have.set(p.position, (have.get(p.position) ?? 0) + 1);
  }

  let bestPos: Position | null = null;
  let bestDeficit = 0;
  for (const [pos, target] of blueprintByPos) {
    const deficit = target - (have.get(pos) ?? 0);
    if (deficit <= 0) continue;
    if (deficit > bestDeficit || (deficit === bestDeficit && (bestPos === null || pos < bestPos))) {
      bestDeficit = deficit;
      bestPos = pos;
    }
  }
  return bestPos;
}

interface PoachCandidate {
  originTeamId: TeamId;
  playerId: PlayerId;
  score: number;
}

function findBestPsCandidate(
  league: LeagueState,
  poachingTeamId: TeamId,
  position: Position,
  protections: Map<TeamId, Set<PlayerId>>,
): PoachCandidate | null {
  const poacher = league.teams[poachingTeamId]!;
  const hc = league.coaches[poacher.headCoachId]!;

  let best: PoachCandidate | null = null;
  for (const team of Object.values(league.teams)) {
    const isOwnPs = team.identity.id === poachingTeamId;
    const teamProtections = protections.get(team.identity.id);
    for (const psId of team.practiceSquadIds) {
      const player = league.players[psId];
      if (!player) continue;
      if (player.position !== position) continue;
      // External teams can't poach a protected PS player. The owning
      // team is free to promote their own protected players.
      if (!isOwnPs && teamProtections?.has(psId)) continue;

      const fit = schemeFitForPlayer(player, {
        offensiveScheme: hc.offensiveScheme,
        defensiveScheme: hc.defensiveScheme,
      });
      const skill = skillSummary(player);
      const score = fit * skill;

      if (
        !best ||
        score > best.score ||
        (score === best.score && team.identity.id < best.originTeamId) ||
        (score === best.score && team.identity.id === best.originTeamId && psId < best.playerId)
      ) {
        best = { originTeamId: team.identity.id, playerId: psId, score };
      }
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

/**
 * Apply a single poach: drop the PS contract, sign a new league-minimum
 * 1-year active contract, swap the player from origin's practiceSquadIds
 * onto poacher's rosterIds, and update Player.teamId / contractId.
 */
function applyPoach(
  league: LeagueState,
  originTeamId: TeamId,
  playerId: PlayerId,
  poachingTeamId: TeamId,
  idSuffix: string,
  signedOnTick: number,
): LeagueState {
  const player = league.players[playerId]!;
  const oldContractId = player.contractId;
  const origin = league.teams[originTeamId]!;
  const poacher = league.teams[poachingTeamId]!;

  const newContract: Contract = {
    id: ContractId(`C_${idSuffix}`),
    playerId: player.id,
    teamId: poachingTeamId,
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

  const teamsNext = {
    ...league.teams,
    [originTeamId]: {
      ...origin,
      practiceSquadIds: origin.practiceSquadIds.filter((id) => id !== playerId),
    },
    [poachingTeamId]: {
      ...poacher,
      rosterIds: [...poacher.rosterIds, playerId],
    },
  } as Readonly<Record<TeamId, TeamState>>;

  const playersNext = {
    ...league.players,
    [playerId]: { ...player, teamId: poachingTeamId, contractId: newContract.id },
  } as Readonly<Record<PlayerId, Player>>;

  const contractsNext: Record<string, Contract> = { ...league.contracts };
  if (oldContractId) delete contractsNext[oldContractId];
  contractsNext[newContract.id] = newContract;

  const entry: Transaction = {
    kind: 'ps-promotion',
    tick: signedOnTick,
    seasonNumber: league.seasonNumber,
    originTeamId,
    signingTeamId: poachingTeamId,
    playerId,
    ownPromotion: originTeamId === poachingTeamId,
    contractId: newContract.id,
  };

  return {
    ...league,
    teams: teamsNext,
    players: playersNext,
    contracts: contractsNext as Readonly<Record<ContractIdType, Contract>>,
    transactionLog: [...league.transactionLog, entry],
  };
}
