import { NFL_TEAMS } from '../data/team-base/index.js';
import type { Prng } from '../prng/index.js';
import { Prng as PrngClass } from '../prng/index.js';
import type {
  TeamId,
  PlayerId,
  OwnerId,
  GmId,
  CoachId,
  ContractId,
} from '../types/ids.js';
import type { TeamState } from '../types/team.js';
import type {
  Owner,
  Gm,
  HeadCoach,
  TeamPersonality,
} from '../types/personnel.js';
import type { Player } from '../types/player.js';
import type { Contract } from '../types/contract.js';
import type { LeagueState } from '../types/league.js';
import { FranchiseHistory, CompetitiveWindow } from '../types/enums.js';
import { generateTeamPersonnel } from '../personnel/generate-team-personnel.js';

export interface CreateLeagueOptions {
  /** Root seed; everything downstream is deterministic from this. */
  seed: string;
  /** Starting salary cap. Defaults to $255M (rough 2024 figure). */
  salaryCap?: number;
}

/**
 * Generate a fresh 32-team league from a seed. Phase 1 deliverable —
 * personnel only. Players/contracts will land in a subsequent slice.
 *
 * The produced LeagueState is **deterministic** w.r.t. the seed. Two
 * calls with the same seed produce structurally identical output
 * (same names, same spectrums, same archetypes, same Team Personality
 * scores).
 */
export function createLeague(options: CreateLeagueOptions): LeagueState {
  const { seed, salaryCap = 255_000_000 } = options;
  const rootPrng = new PrngClass(seed);

  const teams: Record<string, TeamState> = {};
  const owners: Record<string, Owner> = {};
  const gms: Record<string, Gm> = {};
  const coaches: Record<string, HeadCoach> = {};
  const teamPersonalities: Record<string, TeamPersonality> = {};

  for (const identity of NFL_TEAMS) {
    const teamPrng = rootPrng.fork(`team:${identity.abbreviation}`);
    const franchiseHistory = rollFranchiseHistory(teamPrng.fork('franchise-history'));
    const bundle = generateTeamPersonnel(teamPrng, identity, franchiseHistory);

    const team: TeamState = {
      identity,
      ownerId: bundle.owner.id,
      gmId: bundle.gm.id,
      headCoachId: bundle.headCoach.id,
      rosterIds: [], // players land in a later slice
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

  return {
    seed,
    tick: 0,
    seasonNumber: 1,
    phase: 'OFFSEASON_PRE_FA',
    salaryCap,
    teams: teams as Readonly<Record<TeamId, TeamState>>,
    players: {} as Readonly<Record<PlayerId, Player>>,
    owners: owners as Readonly<Record<OwnerId, Owner>>,
    gms: gms as Readonly<Record<GmId, Gm>>,
    coaches: coaches as Readonly<Record<CoachId, HeadCoach>>,
    contracts: {} as Readonly<Record<ContractId, Contract>>,
    teamPersonalities: teamPersonalities as Readonly<Record<TeamId, TeamPersonality>>,
  };
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
