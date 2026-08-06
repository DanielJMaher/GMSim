import { NFL_TEAMS } from '../data/team-base/index.js';
import type { Prng } from '../prng/index.js';
import { Prng as PrngClass } from '../prng/index.js';
import type {
  TeamId,
  PlayerId,
  OwnerId,
  GmId,
  CoachId,
  CoordinatorId,
  ScoutId,
} from '../types/ids.js';
import type { TeamState } from '../types/team.js';
import type {
  Owner,
  Gm,
  HeadCoach,
  Coordinator,
  TeamPersonality,
} from '../types/personnel.js';
import { generateCoordinator } from '../personnel/coordinator.js';
import { startCareerStint } from '../npc-ai/front-office.js';
import type { Scout } from '../types/scout.js';
import type { Player } from '../types/player.js';
import type { Contract } from '../types/contract.js';
import type { LeagueState } from '../types/league.js';
import { FranchiseHistory, CompetitiveWindow } from '../types/enums.js';
import { generateTeamPersonnel } from '../personnel/generate-team-personnel.js';
import { seedPerceivedReliabilityForGms } from '../personnel/perceived-outlet-trust.js';
import { generateRoster } from '../players/roster.js';
import { generateContract } from '../contracts/generate.js';
import { ContractId } from '../types/ids.js';
import type { ContractId as ContractIdType } from '../types/ids.js';
import { mintContractId, contractIdCollisionEntry } from '../contracts/mint.js';
import type { Transaction } from '../types/transaction.js';
import { refillPracticeSquad } from '../transactions/practice-squad.js';
import { teamCapUsage } from '../contracts/cap.js';
import { leagueMinimumSalary } from '../contracts/constants.js';
import { generateTeamScouts, generateInitialObservations, regenerateWatchLists } from '../scouting/index.js';
import { generateInitialCollegePool } from '../draft/pool.js';
import { generateTeamCollegeScouts } from '../draft/college-scout.js';
import { generateInitialCollegeObservations } from '../draft/college-observation.js';
import { regenerateDraftBoardsForLeague } from '../draft/board.js';
import { runCombine } from '../draft/combine.js';
import { runProDays } from '../draft/pro-days.js';
import { runCoachVisits } from '../draft/coach-visits.js';
import { generateInitialDraftPicks } from '../draft/picks.js';
import { generateMediaOutlets } from '../media/generate.js';
import { deriveVoiceSeed } from '../media/voice.js';
import type {
  CollegeScout,
  CollegePlayerObservation,
  DraftBoardEntry,
  CombineMeasurables,
  ProDayAttendanceRecord,
} from '../types/college.js';

export interface CreateLeagueOptions {
  /** Root seed; everything downstream is deterministic from this. */
  seed: string;
  /**
   * Living Voice seed (v0.124+). Drives only the WORDS scouts/outlets say, not
   * the world. Omit → derived `${seed}::voice` (deterministic; engine/tests stay
   * reproducible). The app passes a random one (entropy at the UI boundary) so
   * the same world sounds different per playthrough. See `media/voice.ts`.
   */
  voiceSeed?: string;
  /** Starting salary cap. Defaults to $255M (rough 2024 figure). */
  salaryCap?: number;
  /**
   * Game-stat engine. **Defaults to `'bottomup'`** (the matchup-driven drive
   * sim — player stats emerge from individual matchups; default since v0.106).
   * Pass `'topdown'` to opt into the legacy box-score path. Persisted on
   * `LeagueState.statEngine`.
   */
  statEngine?: 'topdown' | 'bottomup';
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
  const { seed, voiceSeed = deriveVoiceSeed(seed), salaryCap = 255_000_000, statEngine } = options;
  const rootPrng = new PrngClass(seed);

  const teams: Record<string, TeamState> = {};
  const owners: Record<string, Owner> = {};
  const gms: Record<string, Gm> = {};
  const coaches: Record<string, HeadCoach> = {};
  const coordinators: Record<string, Coordinator> = {};
  const scouts: Record<string, Scout> = {};
  const teamPersonalities: Record<string, TeamPersonality> = {};
  const players: Record<string, Player> = {};
  const contracts: Record<string, Contract> = {};
  // Roster Floor §14 Fix 2: safe by construction here (idSuffix is each
  // player's own globally-unique id, minted exactly once per player), but
  // class-wide means every mint site carries the guard (Daniel, §14.9 —
  // "don't trust it not to sneak back in").
  const contractCollisions: Transaction[] = [];

  // Scout staffs per team, kept alongside `scouts` directory so the
  // observation sweep below can look up each team's scouts without
  // re-bucketing the flat map.
  const scoutsByTeam: Record<string, readonly Scout[]> = {};
  const collegeScouts: Record<string, CollegeScout> = {};
  const collegeScoutsByTeam: Record<string, readonly CollegeScout[]> = {};

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
      const rawContract = generateContract(contractsPrng.fork(rawPlayer.id), {
        player: rawPlayer,
        idSuffix: String(rawPlayer.id),
        currentTick: initialTick,
      });
      const minted = mintContractId(contracts, rawContract.id);
      const contract: Contract =
        minted.collision === undefined ? rawContract : { ...rawContract, id: minted.id };
      contracts[contract.id] = contract;
      if (minted.collision) {
        const entry = contractIdCollisionEntry(minted, {
          tick: initialTick,
          seasonNumber: 1,
          teamId: identity.id,
          playerId: rawPlayer.id,
        });
        if (entry) contractCollisions.push(entry);
      }
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

    const teamCollegeScouts = generateTeamCollegeScouts(
      teamPrng.fork('college-scouts'),
      identity.abbreviation,
      bundle.owner,
      bundle.gm,
    );
    const collegeScoutIds: ScoutId[] = [];
    for (const cs of teamCollegeScouts) {
      collegeScouts[cs.id] = cs;
      collegeScoutIds.push(cs.id);
    }
    collegeScoutsByTeam[identity.id] = teamCollegeScouts;

    // S4 (v0.140): the founding coordinator staff. Roster Viability Appendix
    // A: open their stint at birth (season 1) — without this a founding
    // coordinator poached to HC before season 1's finalize carried no OC/DC
    // history (the same latent defect `fillCoordinatorSeat` had).
    const ocGen = generateCoordinator(teamPrng.fork('oc'), identity.abbreviation, 'OC');
    const dcGen = generateCoordinator(teamPrng.fork('dc'), identity.abbreviation, 'DC');
    const oc: Coordinator = {
      ...ocGen,
      careerStints: startCareerStint(ocGen.careerStints, identity.id, 'OC', 1),
    };
    const dc: Coordinator = {
      ...dcGen,
      careerStints: startCareerStint(dcGen.careerStints, identity.id, 'DC', 1),
    };
    coordinators[oc.id] = oc;
    coordinators[dc.id] = dc;

    const team: TeamState = {
      identity,
      ownerId: bundle.owner.id,
      gmId: bundle.gm.id,
      headCoachId: bundle.headCoach.id,
      ocId: oc.id,
      dcId: dc.id,
      scoutIds,
      collegeScoutIds,
      rosterIds,
      injuredReserveIds: [],
      practiceSquadIds: [],
      deadMoneyByYear: [],
      cashSpentBySeason: {},
      franchiseHistory,
      fanBase: bundle.fanBase,
      competitiveWindow: pickStartingWindow(franchiseHistory),
      seasonHistory: [],
      // Front-office lifecycle (v0.138): founding regimes arrive
      // together, so the HC counts as the GM's own hire.
      frontOffice: {
        gmHiredSeason: 1,
        hcHiredSeason: 1,
        hcHiredByGmId: bundle.gm.id,
        gmCoachFiringsSurvived: 0,
        gmLameDuck: false,
        gmVacant: false,
        hcVacant: false,
        hcInterim: false,
        hcContractYearsRemaining: 4,
        seatPressure: { gm: 0, hc: 0 },
      },
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
  const watchLists = regenerateWatchLists(
    teams as Readonly<Record<TeamId, TeamState>>,
    scouts as Readonly<Record<ScoutId, Scout>>,
    coaches,
    players,
    observations,
    initialTick,
  );

  // Initial college pool — ~1100 prospects spread across TRUE_FR
  // through RS_SR. Forked from the root with a stable label so future
  // changes to NFL-side generation don't shift college-prospect rolls.
  const collegePool = generateInitialCollegePool(rootPrng.fork('college-pool'), {
    simYear: 2026,
    idPrefix: 'C0',
  });

  // Initial college-scouting sweep — every college scout files
  // observations on prospects in their specialty group with a
  // regional bias toward their preferred region.
  const collegeObservations: CollegePlayerObservation[] = generateInitialCollegeObservations(
    rootPrng.fork('initial-college-observations'),
    collegeScoutsByTeam as Readonly<Record<TeamId, readonly CollegeScout[]>>,
    collegePool,
    initialTick,
  );

  const baseLeague: LeagueState = {
    seed,
    voiceSeed,
    ...(statEngine ? { statEngine } : {}),
    tick: initialTick,
    seasonNumber: 1,
    phase: 'OFFSEASON_PRE_FA',
    salaryCap,
    salaryCapBySeason: { 1: salaryCap },
    teams: teams as Readonly<Record<TeamId, TeamState>>,
    players: players as Readonly<Record<PlayerId, Player>>,
    owners: owners as Readonly<Record<OwnerId, Owner>>,
    gms: gms as Readonly<Record<GmId, Gm>>,
    coaches: coaches as Readonly<Record<CoachId, HeadCoach>>,
    coordinators: coordinators as Readonly<Record<CoordinatorId, Coordinator>>,
    scouts: scouts as Readonly<Record<ScoutId, Scout>>,
    contracts: contracts as Readonly<Record<ContractIdType, Contract>>,
    teamPersonalities: teamPersonalities as Readonly<Record<TeamId, TeamPersonality>>,
    schedule: null, // populated when simulateSeason runs
    transactionLog: contractCollisions,
    observations,
    watchLists,
    collegePool,
    collegeScouts: collegeScouts as Readonly<Record<ScoutId, CollegeScout>>,
    collegeObservations,
    mediaCollegeObservations: [],
    // Initial draft boards — pure derivation from teams + college
    // scouts' observations + scheme + roster need. Built inline so
    // the assembled league is self-consistent before
    // refillPracticeSquad runs.
    draftBoards: {} as Readonly<Record<TeamId, readonly DraftBoardEntry[]>>,
    combineResults: {} as Readonly<Record<PlayerId, CombineMeasurables>>,
    proDayAttendance: {} as Readonly<Record<TeamId, readonly ProDayAttendanceRecord[]>>,
    draftHistory: [],
    coachVisitObservations: [],
    // Initial draft picks — each team owns its own picks for the
    // next 3 league years. League starts at season 1; the first draft
    // fires for season 2 during advanceSeason. Generate picks for
    // seasons 2..4.
    draftPicks: generateInitialDraftPicks(
      NFL_TEAMS.map((t) => t.id),
      2,
    ),
    draftBoardSnapshots: {},
    tradeUpHistory: [],
    lifecyclePhase: 'REGULAR_SEASON_WEEK' as const,
    currentWeek: null,
    // v0.62 media ecosystem — outlets generated at creation, stream
    // populates on each lifecycle tick that has news.
    mediaOutlets: generateMediaOutlets(rootPrng.fork('media-outlets'), Object.values(teams)),
    mediaReports: [],
    // v0.63 college football season — schedule generated on the first
    // COLLEGE_WEEK tick of each season.
    collegeSchedule: null,
    collegeCurrentWeek: null,
    collegeGameStats: [],
    allStarGames: [],
    heismanHistory: [],
  };

  // Hard-cap compliance at birth (Salary Cap doc: "active roster must remain
  // under cap limit at all times"). Contract generation prices tier-by-tier
  // with no team-total constraint (see tiers.ts — dampening only bounds the
  // worst case to "a compliable overage"), so a few teams roll over the cap
  // and, pre-fix, played their ENTIRE first season over it. A born-over
  // book is a GENERATOR pricing error, not simulated history — so correct
  // it at the generator: proportionally trim the over-cap team's
  // non-guaranteed year-0 bases (floored at the vet minimum and at the
  // guaranteed portion) until the team fits under REGULAR_SEASON all-53
  // accounting, the strictest count it will face. No cuts, no roster holes,
  // no dead money, no fake day-one transactions — every birth invariant
  // (53-man rosters, contracts = players, empty FA pool, empty log) holds.
  // Deterministic, no PRNG. (Simulated compliance via restructures/cuts +
  // waiver scramble was tried first and rejected: market gates strand teams
  // short-rostered and prune unsigned casualties from the league.)
  Object.assign(baseLeague, { contracts: trimContractsToCapAtBirth(baseLeague) });

  // Seed each GM's *perceived* media-outlet reliability now that both GMs
  // and outlets exist (Slice 2 — GMs consume the media). Boards blend a
  // media read by this belief, not by the outlet's ground-truth accuracy.
  baseLeague.gms = seedPerceivedReliabilityForGms(
    rootPrng.fork('perceived-outlet-trust'),
    baseLeague.gms,
    baseLeague.mediaOutlets,
  ) as Readonly<Record<GmId, Gm>>;

  // Initial boards first (we need them so pro-day attendance can
  // score schools by board interest).
  const initialBoards = regenerateDraftBoardsForLeague({
    teams: baseLeague.teams,
    collegeScouts: baseLeague.collegeScouts,
    coaches: baseLeague.coaches,
    players: baseLeague.players,
    collegePool: baseLeague.collegePool,
    observations: baseLeague.collegeObservations,
    addedOnTick: initialTick,
    mediaObservations: baseLeague.mediaCollegeObservations,
    gms: baseLeague.gms,
    mediaOutlets: baseLeague.mediaOutlets,
    voiceSeed: baseLeague.voiceSeed,
  });
  // Combine — universal physical reveal.
  const initialCombine = runCombine(
    rootPrng.fork('initial-combine'),
    collegePool,
    initialTick,
  );
  // Pro days — per-team attendance scored by board interest.
  const initialProDays = runProDays(
    rootPrng.fork('initial-pro-days'),
    baseLeague.teams,
    collegePool,
    initialBoards,
  );
  // Fold the three derived fields back into baseLeague. Object.assign
  // is safe here because we control the original literal above.
  Object.assign(baseLeague, {
    draftBoards: initialBoards as Readonly<Record<TeamId, readonly DraftBoardEntry[]>>,
    combineResults: initialCombine as Readonly<Record<PlayerId, CombineMeasurables>>,
    proDayAttendance: initialProDays as Readonly<Record<TeamId, readonly ProDayAttendanceRecord[]>>,
  });

  // Initial coach visits — head coaches file observations on the top
  // 3 prospects from each team's draft board. Boards must exist
  // first (done above) so visit targeting works.
  const initialCoachVisits = runCoachVisits(
    rootPrng.fork('initial-coach-visits'),
    baseLeague,
    { observedOnTick: initialTick },
  );
  Object.assign(baseLeague, {
    coachVisitObservations: initialCoachVisits,
  });

  // Bootstrap practice squads — 16 rookies per team on PS-minimum 1-year deals.
  return refillPracticeSquad(rootPrng.fork('ps-bootstrap'), baseLeague, initialTick, 1);
}

/**
 * Generator-level hard-cap correction (see call site). For each team whose
 * all-53 usage exceeds the cap, shave the overage proportionally off its
 * contracts' year-0 base salaries. Per-contract floor = max(vet minimum,
 * year-0 guaranteed base), so guarantees stay honest. Later contract years
 * are untouched — any resulting future overage flows through the normal
 * offseason compliance machinery like every other cap crunch.
 */
function trimContractsToCapAtBirth(league: LeagueState): LeagueState['contracts'] {
  const allFiftyThree: LeagueState = { ...league, phase: 'REGULAR_SEASON' };
  const contracts: Record<string, Contract> = { ...league.contracts };
  for (const team of Object.values(league.teams)) {
    const usage = teamCapUsage(team, {
      ...allFiftyThree,
      contracts: contracts as LeagueState['contracts'],
    });
    const overage = usage - league.salaryCap;
    if (overage <= 0) continue;

    const trimmable: { contract: Contract; slack: number }[] = [];
    for (const pid of team.rosterIds) {
      const player = league.players[pid];
      if (!player?.contractId) continue;
      const contract = contracts[player.contractId];
      if (!contract) continue;
      // Trim the CURRENT contract year — seed deals are mid-stream (a 4-year
      // deal in year 2 charges baseSalaries[2]), so index 0 is often not
      // what the cap reads. Floor is the vet minimum only: guarantees are
      // generator fiction like the base itself — they're a PERCENTAGE of
      // base, so a trimmed base keeps the guarantee structure (and
      // dead-money math) consistent while the guaranteed dollars re-price
      // with it.
      const yearOfDeal = contract.realYears - contract.yearsRemaining;
      const slack = (contract.baseSalaries[yearOfDeal] ?? 0) - leagueMinimumSalary(league.salaryCap);
      if (slack > 0) trimmable.push({ contract, slack });
    }
    const totalSlack = trimmable.reduce((s, t) => s + t.slack, 0);
    if (totalSlack <= 0) continue; // nothing legally trimmable — leave for offseason machinery
    const ratio = Math.min(1, overage / totalSlack);
    for (const { contract, slack } of trimmable) {
      const cut = Math.ceil(slack * ratio); // ceil per contract → clears the overage
      const yearOfDeal = contract.realYears - contract.yearsRemaining;
      const baseSalaries = [...contract.baseSalaries];
      baseSalaries[yearOfDeal] = (baseSalaries[yearOfDeal] ?? 0) - cut;
      contracts[contract.id] = { ...contract, baseSalaries };
    }
  }
  return contracts as LeagueState['contracts'];
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
