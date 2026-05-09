import { ContractId } from '../types/ids.js';
import type { LeagueState } from '../types/league.js';
import type { Player } from '../types/player.js';
import type { Contract } from '../types/contract.js';
import type { TeamState, TeamSeasonRecord } from '../types/team.js';
import type { HeadCoach } from '../types/personnel.js';
import type { TeamId, PlayerId, CoachId, ContractId as ContractIdType } from '../types/ids.js';
import type { CareerSeasonStats } from '../types/stats.js';
import type { AwardKind } from '../types/awards.js';
import { Prng as PrngClass } from '../prng/index.js';
import { computeRecords, divisionStandings } from './standings.js';
import { advancePlayerDevelopment } from './development.js';
import { processRetirements } from './retirement.js';
import { seasonStatsForLeague } from './stats.js';
import { seasonAwards } from './awards.js';
import { CompetitiveWindow } from '../types/enums.js';
import { TIER_TEMPLATES } from '../contracts/tiers.js';
import { WEEKS_PER_LEAGUE_YEAR } from '../contracts/constants.js';

const SECONDS_PER_LEAGUE_YEAR = WEEKS_PER_LEAGUE_YEAR; // re-exported as ticks

/**
 * Advance a played-through league one full season. Returns a new
 * LeagueState representing the offseason just before the next regular
 * season:
 *
 *   1. Append a TeamSeasonRecord to each team's seasonHistory.
 *   2. Recompute competitive window from recent results.
 *   3. Advance every player's development (age + skills + tier).
 *   4. Recover injuries that have run their course.
 *   5. Decrement every contract's yearsRemaining; auto-renew expired
 *      ones at current tier (Phase 2 placeholder for free agency).
 *   6. Increment seasonNumber + tick; clear schedule for the new year.
 *
 * Caller is expected to have run simulateSeason on the input league
 * first — `league.schedule` should be fully played.
 */
export function advanceSeason(league: LeagueState): LeagueState {
  if (!league.schedule) {
    throw new Error('advanceSeason requires a played schedule on the league');
  }

  const advancePrng = new PrngClass(`${league.seed}::advance-${league.seasonNumber}`);
  const records = computeRecords(league);
  const standings = divisionStandings(league, records);
  const nextSeasonNumber = league.seasonNumber + 1;
  const nextTick = league.tick + SECONDS_PER_LEAGUE_YEAR;

  // ─── Update team season history + competitive window ────────────────
  const teamsNext: Record<string, TeamState> = {};
  for (const team of Object.values(league.teams)) {
    const record = records.get(team.identity.id)!;
    const seasonRecord = buildSeasonRecord(team, record, standings, league);
    const newWindow = updateCompetitiveWindow(team, record);
    teamsNext[team.identity.id] = {
      ...team,
      seasonHistory: [...team.seasonHistory, seasonRecord],
      competitiveWindow: newWindow,
    };
  }

  // ─── Snapshot per-player stats + awards for the just-played season ──
  // Stats and awards are computed once before the player loop so every
  // player gets a chance at a careerStats / careerAwards entry.
  const seasonStats = seasonStatsForLeague(league);
  const awards = seasonAwards(league);
  const playerAwardMap = buildPlayerAwardMap(awards);

  // ─── Advance every player ──────────────────────────────────────────
  // Offseason heals: any lingering Player.injury is cleared. The actual
  // weeks-of-recovery model (active rehab, prolonged absences) is a
  // medical-staff system in a later phase.
  const playersAfterDev: Record<string, Player> = {};
  for (const player of Object.values(league.players)) {
    const playerPrng = advancePrng.fork(`player:${player.id}`);
    let advanced = advancePlayerDevelopment(playerPrng.fork('dev'), player, league);

    const thisSeasonStats = seasonStats.get(player.id);
    if (thisSeasonStats) {
      const careerEntry: CareerSeasonStats = {
        ...thisSeasonStats,
        seasonNumber: league.seasonNumber,
      };
      advanced = {
        ...advanced,
        careerStats: [...advanced.careerStats, careerEntry],
      };
    }

    const wonKinds = playerAwardMap.get(player.id);
    if (wonKinds && wonKinds.length > 0) {
      advanced = {
        ...advanced,
        careerAwards: [
          ...advanced.careerAwards,
          ...wonKinds.map((kind) => ({ kind, seasonNumber: league.seasonNumber })),
        ],
      };
    }

    playersAfterDev[player.id] = advanced.injury ? { ...advanced, injury: null } : advanced;
  }

  // ─── Snapshot Coach-of-the-Year onto the winning HC ─────────────────
  const coachesNext: Record<string, HeadCoach> = { ...league.coaches };
  if (awards.coy) {
    const coach = coachesNext[awards.coy.coachId];
    if (coach) {
      coachesNext[awards.coy.coachId] = {
        ...coach,
        careerAwards: [
          ...coach.careerAwards,
          { kind: 'COY', seasonNumber: league.seasonNumber },
        ],
      };
    }
  }

  // ─── Advance every contract ────────────────────────────────────────
  const contractsAfterAdvance: Record<string, Contract> = {};
  for (const contract of Object.values(league.contracts)) {
    const player = playersAfterDev[contract.playerId];
    if (!player) continue;
    const contractPrng = advancePrng.fork(`contract:${contract.id}`);
    contractsAfterAdvance[contract.id] = advanceOrRenewContract(contractPrng, contract, player);
  }

  // ─── Retirement + rookie replacement ───────────────────────────────
  // Phase 2 placeholder: age-based retirement, slot-for-slot rookie
  // backfill. Real retirement + draft replenishment lands in Phase 3.
  const retirement = processRetirements(
    advancePrng.fork('retirement'),
    league,
    nextSeasonNumber,
    nextTick,
  );

  const playersNext: Record<string, Player> = {};
  const retiredSet = new Set<PlayerId>(retirement.retiredPlayerIds);
  for (const [id, player] of Object.entries(playersAfterDev)) {
    if (retiredSet.has(id as PlayerId)) continue;
    playersNext[id] = player;
  }
  Object.assign(playersNext, retirement.newPlayers);

  const contractsNext: Record<string, Contract> = {};
  const droppedSet = new Set<ContractIdType>(retirement.dropContractIds);
  for (const [id, contract] of Object.entries(contractsAfterAdvance)) {
    if (droppedSet.has(id as ContractIdType)) continue;
    contractsNext[id] = contract;
  }
  Object.assign(contractsNext, retirement.newContracts);

  // Splice updated rosterIds (with retiree → rookie swaps) into teams.
  for (const teamId of Object.keys(teamsNext)) {
    const newRoster = retirement.rosterIdsByTeam.get(teamId);
    if (newRoster) {
      teamsNext[teamId] = { ...teamsNext[teamId]!, rosterIds: newRoster };
    }
  }

  return {
    ...league,
    teams: teamsNext as Readonly<Record<TeamId, TeamState>>,
    players: playersNext as typeof league.players,
    coaches: coachesNext as Readonly<Record<CoachId, HeadCoach>>,
    contracts: contractsNext as Readonly<Record<ContractIdType, Contract>>,
    seasonNumber: nextSeasonNumber,
    tick: nextTick,
    phase: 'OFFSEASON_PRE_FA',
    schedule: null,
  };
}

/**
 * Invert the seasonAwards struct into a player-id → kinds map so the
 * player-loop can do an O(1) lookup per player. COY is excluded — it's
 * snapshotted on the coach record separately.
 */
function buildPlayerAwardMap(awards: ReturnType<typeof seasonAwards>): Map<PlayerId, AwardKind[]> {
  const map = new Map<PlayerId, AwardKind[]>();
  const entries: ReadonlyArray<[Exclude<AwardKind, 'COY'>, { playerId: PlayerId } | null]> = [
    ['MVP', awards.mvp],
    ['OPOY', awards.opoy],
    ['DPOY', awards.dpoy],
    ['OROY', awards.oroy],
    ['DROY', awards.droy],
  ];
  for (const [kind, award] of entries) {
    if (!award) continue;
    const arr = map.get(award.playerId) ?? [];
    arr.push(kind);
    map.set(award.playerId, arr);
  }
  return map;
}

function buildSeasonRecord(
  team: TeamState,
  record: ReturnType<typeof computeRecords>['get'] extends (id: TeamId) => infer R ? R : never,
  standings: Map<ReturnType<typeof divisionStandings>['keys'] extends () => IterableIterator<infer K> ? K : never, readonly { teamId: TeamId }[]>,
  league: LeagueState,
): TeamSeasonRecord {
  const r = record!;
  const divisionTeams = standings.get(team.identity.division)!;
  const finishIndex = divisionTeams.findIndex((rec) => rec.teamId === team.identity.id);
  const divisionFinish = finishIndex >= 0 ? finishIndex + 1 : 4;

  // Determine playoff outcome from the playoff bracket.
  const playoffs = league.schedule?.playoffs;
  let madePlayoffs = false;
  let championshipResult: TeamSeasonRecord['championshipResult'] | undefined;
  if (playoffs) {
    const allPlayoffGames = [
      ...playoffs.wildCard,
      ...playoffs.divisional,
      ...playoffs.conference,
      ...playoffs.superBowl,
    ];
    const teamGames = allPlayoffGames.filter(
      (g) => g.homeTeamId === team.identity.id || g.awayTeamId === team.identity.id,
    );
    if (teamGames.length > 0) madePlayoffs = true;

    if (playoffs.championId === team.identity.id) {
      championshipResult = 'won_super_bowl';
    } else {
      // Find the deepest round this team played, and whether they lost
      // there.
      const lastGame = teamGames[teamGames.length - 1];
      if (lastGame && lastGame.result) {
        const wonLast =
          (lastGame.homeTeamId === team.identity.id &&
            lastGame.result.homeScore > lastGame.result.awayScore) ||
          (lastGame.awayTeamId === team.identity.id &&
            lastGame.result.awayScore > lastGame.result.homeScore);
        if (!wonLast) {
          switch (lastGame.kind) {
            case 'WILD_CARD':
              championshipResult = 'lost_wildcard';
              break;
            case 'DIVISIONAL':
              championshipResult = 'lost_divisional';
              break;
            case 'CONFERENCE':
              championshipResult = 'lost_conference';
              break;
            case 'SUPER_BOWL':
              championshipResult = 'lost_super_bowl';
              break;
          }
        }
      }
    }
  }

  return {
    seasonNumber: team.seasonHistory.length + 1,
    wins: r.wins,
    losses: r.losses,
    ties: r.ties,
    divisionFinish,
    madePlayoffs,
    ...(championshipResult ? { championshipResult } : {}),
  };
}

/**
 * Update a team's competitive window based on the season just played.
 * Phase 2 heuristic — refine in Phase 4 with the Dynasty/Rebuild Cycles
 * module.
 */
function updateCompetitiveWindow(
  _team: TeamState,
  record: { wins: number; losses: number; ties: number },
): TeamState['competitiveWindow'] {
  const total = record.wins + record.losses + record.ties;
  const winPct = total > 0 ? record.wins / total : 0;

  if (winPct >= 0.75) return CompetitiveWindow.CHAMPIONSHIP;
  if (winPct >= 0.6) return CompetitiveWindow.CONTENDER;
  if (winPct >= 0.5) return CompetitiveWindow.EMERGING;
  if (winPct >= 0.4) return CompetitiveWindow.RETOOLING;
  if (winPct >= 0.25) return CompetitiveWindow.STAGNANT;
  return CompetitiveWindow.REBUILDING;
}

/**
 * Decrement contract years; if expired, auto-renew at the player's
 * current tier baseline as a Phase 2 placeholder for real free agency.
 *
 * Renewals reuse the same ContractId so no Player.contractId update is
 * needed. Renewed contracts are 1-2 years at the lower bound of the
 * tier's salary range.
 */
function advanceOrRenewContract(
  prng: typeof PrngClass.prototype,
  contract: Contract,
  player: Player,
): Contract {
  const next = contract.yearsRemaining - 1;
  if (next > 0) {
    return { ...contract, yearsRemaining: next };
  }
  // Expired — generate a renewal at current tier.
  const template = TIER_TEMPLATES[player.tier];
  const realYears = prng.nextRange(1, Math.min(2, template.yearsRange[1]) + 1);
  const baseSalaries: number[] = [];
  for (let i = 0; i < realYears; i++) {
    baseSalaries.push(
      Math.round(
        prng.nextRange(template.baseSalaryPerYearRange[0], template.baseSalaryPerYearRange[1] + 1) /
          1000,
      ) * 1000,
    );
  }
  const signingBonus =
    Math.round(
      prng.nextRange(0, template.signingBonusRange[1] + 1) / 1000,
    ) * 1000;
  return {
    ...contract,
    id: ContractId(contract.id), // keep same ID
    realYears,
    voidYears: 0,
    yearsRemaining: realYears,
    baseSalaries,
    signingBonus,
    rosterBonuses: new Array(realYears).fill(0),
    workoutBonuses: new Array(realYears).fill(0),
    guarantees: new Array(realYears).fill({ baseGuaranteedPct: 0, type: 'NONE' }),
    incentives: [],
    noTradeClause: false,
    signedOnTick: contract.signedOnTick, // not strictly accurate but harmless for Phase 2
  };
}

void SECONDS_PER_LEAGUE_YEAR;
