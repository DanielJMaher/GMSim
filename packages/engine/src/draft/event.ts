import type { Prng } from '../prng/index.js';
import type { LeagueState } from '../types/league.js';
import type { CollegePlayer, DraftPickRecord } from '../types/college.js';
import type { TeamId, PlayerId, ContractId } from '../types/ids.js';
import type { TeamState } from '../types/team.js';
import type { Player } from '../types/player.js';
import type { Contract } from '../types/contract.js';
import { promoteProspectToPlayer } from './promote.js';

export interface RunDraftOptions {
  /** Order in which teams pick. Length sets how many picks fire. */
  draftOrder: readonly TeamId[];
  /** Sim tick the draft executes on (rookie contracts sign on this tick). */
  pickedOnTick: number;
  /** Season number being drafted INTO (rookies join this season's rosters). */
  seasonNumber: number;
  /** Round number for the records produced. Slice 5a only fires round 1. */
  round?: number;
  /** Starting overall pick number (1 for round 1). */
  startingOverallPick?: number;
}

export interface DraftRunResult {
  /** New picks produced by this run, in pick order. */
  picks: readonly DraftPickRecord[];
  /** Player records to add to `LeagueState.players`. */
  newPlayers: readonly Player[];
  /** Contracts to add to `LeagueState.contracts`. */
  newContracts: readonly Contract[];
  /** Per-team roster additions (promoted players appended). */
  rosterAdditionsByTeam: Map<TeamId, readonly PlayerId[]>;
  /** Prospect ids removed from `LeagueState.collegePool`. */
  removedFromCollegePool: ReadonlySet<PlayerId>;
}

/**
 * Run a draft over the supplied order. Each team makes ONE pick in the
 * order given; if `draftOrder` has 32 entries, this fires 32 picks
 * (slice 5a's single round). Multi-round drafts will be modeled in
 * slice 5b by calling this repeatedly with re-ordered orders.
 *
 * Selection logic (slice 5a):
 *   - Picking team consults its `draftBoards[teamId]` entries.
 *   - Walks the board top→bottom and picks the highest-priority
 *     entry whose prospect is still available (eligible + declared +
 *     not yet picked).
 *   - If the entire board is exhausted of available prospects, the
 *     team falls back to "BPA across the full pool" — picking the
 *     highest-tier eligible declared prospect not yet selected. This
 *     is a degenerate case for round 1 (boards are 50-deep, only 32
 *     picks fire) but matters when multi-round drafts arrive.
 *
 * Deterministic for a given (prng, league, options) tuple.
 */
export function runDraft(
  prng: Prng,
  league: LeagueState,
  options: RunDraftOptions,
): DraftRunResult {
  const round = options.round ?? 1;
  const startingOverallPick = options.startingOverallPick ?? 1;

  // Pool of available prospects — declared + draft-eligible. Indexed
  // by id for O(1) lookup; we'll remove ids as picks fire.
  const availableById = new Map<PlayerId, CollegePlayer>();
  for (const cp of league.collegePool) {
    if (cp.isDraftEligible && cp.hasDeclared) {
      availableById.set(cp.id, cp);
    }
  }

  const picks: DraftPickRecord[] = [];
  const newPlayers: Player[] = [];
  const newContracts: Contract[] = [];
  const rosterAdditions = new Map<TeamId, PlayerId[]>();
  const removed = new Set<PlayerId>();

  for (let i = 0; i < options.draftOrder.length; i++) {
    const teamId = options.draftOrder[i]!;
    const team = league.teams[teamId];
    if (!team) continue;

    const overallPick = startingOverallPick + i;
    const board = league.draftBoards[teamId] ?? [];

    // Walk the team's own board for the highest-priority available pick.
    let chosen: CollegePlayer | null = null;
    let boardRank: number | null = null;
    let boardEntry: (typeof board)[number] | null = null;
    for (let r = 0; r < board.length; r++) {
      const entry = board[r]!;
      const cp = availableById.get(entry.collegePlayerId);
      if (cp) {
        chosen = cp;
        boardRank = r + 1;
        boardEntry = entry;
        break;
      }
    }

    // Fallback: BPA across the full available pool — pick the best
    // available by tier then composite skill proxy.
    if (!chosen) {
      chosen = pickBestAvailable(availableById);
    }
    if (!chosen) break; // pool exhausted — abort the draft

    const promoted = promoteProspectToPlayer(prng.fork(`pick:${overallPick}`), {
      prospect: chosen,
      teamId,
      signedOnTick: options.pickedOnTick,
    });
    newPlayers.push(promoted.player);
    newContracts.push(promoted.contract);
    appendRosterAddition(rosterAdditions, teamId, promoted.player.id);
    availableById.delete(chosen.id);
    removed.add(chosen.id);

    picks.push({
      seasonNumber: options.seasonNumber,
      round,
      overallPick,
      teamId,
      collegePlayerId: chosen.id,
      promotedPlayerId: promoted.player.id,
      contractId: promoted.contract.id satisfies ContractId,
      pickedOnTick: options.pickedOnTick,
      boardRankAtPick: boardRank,
      boardPriorityAtPick: boardEntry?.priority ?? null,
      boardReasonAtPick: boardEntry?.reason ?? null,
    });

    void team;
  }

  return {
    picks,
    newPlayers,
    newContracts,
    rosterAdditionsByTeam: rosterAdditions,
    removedFromCollegePool: removed,
  };
}

/**
 * Apply a `DraftRunResult` to a `LeagueState`. Folds new players +
 * contracts into the maps, appends rookies to team rosters, removes
 * drafted prospects from the college pool, and appends pick records
 * to `draftHistory`.
 */
export function applyDraftResult(
  league: LeagueState,
  result: DraftRunResult,
): LeagueState {
  // Players + contracts
  const players: Record<string, Player> = { ...league.players };
  for (const p of result.newPlayers) players[p.id] = p;
  const contracts: Record<string, Contract> = { ...league.contracts };
  for (const c of result.newContracts) contracts[c.id] = c;

  // Teams: append rookies to rosterIds
  const teams: Record<string, TeamState> = { ...league.teams };
  for (const [teamId, rookieIds] of result.rosterAdditionsByTeam) {
    const team = teams[teamId];
    if (!team) continue;
    teams[teamId] = { ...team, rosterIds: [...team.rosterIds, ...rookieIds] };
  }

  // College pool: filter out drafted prospects
  const collegePool = league.collegePool.filter(
    (cp) => !result.removedFromCollegePool.has(cp.id),
  );

  return {
    ...league,
    players: players as typeof league.players,
    contracts: contracts as typeof league.contracts,
    teams: teams as typeof league.teams,
    collegePool,
    draftHistory: [...league.draftHistory, ...result.picks],
  };
}

function pickBestAvailable(available: Map<PlayerId, CollegePlayer>): CollegePlayer | null {
  let best: CollegePlayer | null = null;
  let bestScore = -Infinity;
  const tierScore = { STAR: 4, STARTER: 3, BACKUP: 2, FRINGE: 1 } as const;
  for (const cp of available.values()) {
    const ceilAvg =
      (cp.ceiling.speed + cp.ceiling.acceleration + cp.ceiling.strength +
        cp.ceiling.technicalSkill + cp.ceiling.footballIq) / 5;
    const score = tierScore[cp.tier] * 100 + ceilAvg;
    if (score > bestScore) {
      bestScore = score;
      best = cp;
    }
  }
  return best;
}

function appendRosterAddition(
  map: Map<TeamId, PlayerId[]>,
  teamId: TeamId,
  playerId: PlayerId,
): void {
  let list = map.get(teamId);
  if (!list) {
    list = [];
    map.set(teamId, list);
  }
  list.push(playerId);
}
