import { NFL_TEAMS } from '../data/team-base/index.js';
import type { Prng } from '../prng/index.js';
import { Prng as PrngClass } from '../prng/index.js';
import type {
  TeamId,
  PlayerId,
  OwnerId,
  GmId,
  CoachId,
  ScoutId,
} from '../types/ids.js';
import type { TeamState } from '../types/team.js';
import type {
  Owner,
  Gm,
  HeadCoach,
  TeamPersonality,
} from '../types/personnel.js';
import type { Scout } from '../types/scout.js';
import type { Player } from '../types/player.js';
import type { Contract } from '../types/contract.js';
import type { LeagueState } from '../types/league.js';
import { FranchiseHistory, CompetitiveWindow } from '../types/enums.js';
import { generateTeamPersonnel } from '../personnel/generate-team-personnel.js';
import { generateRoster } from '../players/roster.js';
import { generateContract } from '../contracts/generate.js';
import { ContractId } from '../types/ids.js';
import type { ContractId as ContractIdType } from '../types/ids.js';
import { refillPracticeSquad } from '../transactions/practice-squad.js';
import { generateTeamScouts, generateInitialObservations, generateInitialWatchLists } from '../scouting/index.js';

export interface CreateLeagueOptions {
  /** Root seed; everything downstream is deterministic from this. */
  seed: string;
  /** Starting salary cap. Defaults to $255M (rough 2024 figure). */
  salaryCap?: number;
}

/**
 * Generate a fresh 32-team league from a seed. The produced LeagueState
 * is fully populated with personnel + 53-man rosters per team and is
 * **deterministic** w.r.t. the seed. Two calls with the same seed
 * produce structurally identical output (same names, same spectrums,
 * same archetypes, same Team Personality scores, same player ratings).
 *
 * What's not yet here (deferred to later Phase 1+ slices):
 *   - Contracts (cap accounting)
 *   - Practice squad / IR / reserve lists
 *   - Free agent pool
 *   - College draft class
 */
export function createLeague(options: CreateLeagueOptions): LeagueState {
  const { seed, salaryCap = 255_000_000 } = options;
  const rootPrng = new PrngClass(seed);

  const teams: Record<string, TeamState> = {};
  const owners: Record<string, Owner> = {};
  const gms: Record<string, Gm> = {};
  const coaches: Record<string, HeadCoach> = {};
  const scouts: Record<string, Scout> = {};
  const teamPersonalities: Record<string, TeamPersonality> = {};
  const players: Record<string, Player> = {};
  const contracts: Record<string, Contract> = {};

  // Scout staffs per team, kept alongside `scouts` directory so the
  // observation sweep below can look up each team's scouts without
  // re-bucketing the flat map.
  const scoutsByTeam: Record<string, readonly Scout[]> = {};

  const initialTick = 0;

  for (const identity of NFL_TEAMS) {
    const teamPrng = rootPrng.fork(`team:${identity.abbreviation}`);
    const franchiseHistory = rollFranchiseHistory(teamPrng.fork('franchise-history'));
    const bundle = generateTeamPersonnel(teamPrng, identity, franchiseHistory);

    // Roster generation forked separately so refining the roster
    // pipeline later doesn't shift personnel rolls.
    const roster = generateRoster(teamPrng.fork('roster'), {
      teamId: identity.id,
      idPrefix: identity.abbreviation,
      offensiveScheme: bundle.headCoach.offensiveScheme,
      defensiveScheme: bundle.headCoach.defensiveScheme,
    });
    const rosterIds: typeof roster[number]['id'][] = [];
    const contractsPrng = teamPrng.fork('contracts');
    for (const rawPlayer of roster) {
      const contract = generateContract(contractsPrng.fork(rawPlayer.id), {
        player: rawPlayer,
        idSuffix: String(rawPlayer.id),
        currentTick: initialTick,
      });
      contracts[contract.id] = contract;
      const player: Player = { ...rawPlayer, contractId: ContractId(contract.id) };
      players[player.id] = player;
      rosterIds.push(player.id);
    }

    const teamScouts = generateTeamScouts(
      teamPrng.fork('scouts'),
      identity.abbreviation,
      bundle.owner,
      bundle.gm,
    );
    const scoutIds: ScoutId[] = [];
    for (const scout of teamScouts) {
      scouts[scout.id] = scout;
      scoutIds.push(scout.id);
    }
    scoutsByTeam[identity.id] = teamScouts;

    const team: TeamState = {
      identity,
      ownerId: bundle.owner.id,
      gmId: bundle.gm.id,
      headCoachId: bundle.headCoach.id,
      scoutIds,
      rosterIds,
      injuredReserveIds: [],
      practiceSquadIds: [],
      deadMoneyByYear: [],
      franchiseHistory,
      fanBase: bundle.fanBase,
      competitiveWindow: pickStartingWindow(franchiseHistory),
      seasonHistory: [],
    };

    teams[identity.id] = team;
    owners[bundle.owner.id] = bundle.owner;
    gms[bundle.gm.id] = bundle.gm;
    coaches[bundle.headCoach.id] = bundle.headCoach;
    teamPersonalities[identity.id] = bundle.teamPersonality;
  }

  // Initial scouting sweep — every scout produces observations on
  // ~8 players in their known-specialty group across other teams.
  // Forked from the root so future tweaks to per-team generation
  // don't shift the seed-dependent observation outputs.
  const observations = generateInitialObservations(
    rootPrng.fork('initial-observations'),
    teams as Readonly<Record<TeamId, TeamState>>,
    scoutsByTeam as Readonly<Record<TeamId, readonly Scout[]>>,
    players,
    initialTick,
  );

  // Each team builds its initial watch list from its own observations.
  // Deterministic — no PRNG needed; pure scoring + sort.
  const watchLists = generateInitialWatchLists(
    teams as Readonly<Record<TeamId, TeamState>>,
    scouts as Readonly<Record<ScoutId, Scout>>,
    coaches,
    players,
    observations,
    initialTick,
  );

  const baseLeague: LeagueState = {
    seed,
    tick: initialTick,
    seasonNumber: 1,
    phase: 'OFFSEASON_PRE_FA',
    salaryCap,
    teams: teams as Readonly<Record<TeamId, TeamState>>,
    players: players as Readonly<Record<PlayerId, Player>>,
    owners: owners as Readonly<Record<OwnerId, Owner>>,
    gms: gms as Readonly<Record<GmId, Gm>>,
    coaches: coaches as Readonly<Record<CoachId, HeadCoach>>,
    scouts: scouts as Readonly<Record<ScoutId, Scout>>,
    contracts: contracts as Readonly<Record<ContractIdType, Contract>>,
    teamPersonalities: teamPersonalities as Readonly<Record<TeamId, TeamPersonality>>,
    schedule: null, // populated when simulateSeason runs
    transactionLog: [],
    observations,
    watchLists,
  };

  // Bootstrap practice squads — 16 rookies per team on PS-minimum 1-year deals.
  return refillPracticeSquad(rootPrng.fork('ps-bootstrap'), baseLeague, initialTick, 1);
}

/**
 * Sample a franchise history archetype. The L/L-01 doc says "one
 * archetype per team, no duplicates" but the archetype pool (10) is
 * smaller than the team count (32), so repeats are unavoidable in
 * the current implementation. Pool can be expanded later.
 */
function rollFranchiseHistory(prng: Prng): FranchiseHistory {
  const all = Object.values(FranchiseHistory);
  return prng.pick(all);
}

/**
 * Map franchise history → starting competitive window heuristic.
 *
 * This is an interim mapping. Phase 4's Dynasty/Rebuild Cycles module
 * will compute competitive windows from actual roster strength + recent
 * results. For now we seed plausibly so league-state inspection looks
 * varied.
 */
function pickStartingWindow(history: FranchiseHistory): CompetitiveWindow {
  switch (history) {
    case FranchiseHistory.RECENT_DYNASTY:
    case FranchiseHistory.PERENNIAL_CONTENDER:
      return CompetitiveWindow.CONTENDER;
    case FranchiseHistory.SURPRISE_CHAMPION:
      return CompetitiveWindow.RETOOLING;
    case FranchiseHistory.SLEEPING_GIANT:
    case FranchiseHistory.LOVABLE_LOSER:
    case FranchiseHistory.CURSED_FRANCHISE:
      return CompetitiveWindow.STAGNANT;
    case FranchiseHistory.CINDERELLA_STORY:
    case FranchiseHistory.NEW_IDENTITY:
      return CompetitiveWindow.EMERGING;
    case FranchiseHistory.REBUILD_IN_PROGRESS:
      return CompetitiveWindow.REBUILDING;
    case FranchiseHistory.CONTROVERSIAL_FRANCHISE:
      return CompetitiveWindow.RETOOLING;
    default:
      return CompetitiveWindow.STAGNANT;
  }
}
