/**
 * League lifecycle — finer-grained phase model than `LeaguePhase`.
 *
 * The original `simulateSeason + advanceSeason` two-stage loop bundled
 * everything between drafts into a single ~600-line call. That coarse
 * model made several inspector confusions hard to debug:
 *
 *   - "Which board am I looking at?" Boards regenerate post-advance
 *     for the NEXT draft, not the one that just fired.
 *   - "When did declarations roll?" Mid-advance, but not exposed.
 *   - "Why don't I see when X happened vs Y?" Transactions fire in
 *     batches inside advanceSeason with no per-event ordering.
 *
 * v0.54 splits the lifecycle into ordered phases. Each phase is a
 * pure function `(league, prng) => league` that applies a single
 * event chunk. `advanceSeason` becomes a loop over `tickPhase`;
 * inspector UI (future slice) can step through phases one at a time.
 *
 * Calendar dates (mid-March FA, late-April draft, etc.) come in a
 * follow-on slice once the phase decomposition has settled.
 *
 * In-season week-by-week granularity for `simulateSeason` is a
 * separate refactor — touched only conceptually here.
 */

import type { LeagueState } from '../types/league.js';
import type { Player } from '../types/player.js';
import type { Contract } from '../types/contract.js';
import type { TeamState, TeamSeasonRecord } from '../types/team.js';
import type { HeadCoach } from '../types/personnel.js';
import type { DraftBoardEntry } from '../types/college.js';
import type { TeamId, PlayerId, CoachId, ContractId as ContractIdType } from '../types/ids.js';
import type { CareerSeasonStats } from '../types/stats.js';
import type { AwardKind } from '../types/awards.js';
import type { ScheduledGame, SeasonSchedule, PlayoffsState } from '../types/game.js';
import type { Transaction } from '../types/transaction.js';
import { Prng as PrngClass } from '../prng/index.js';
import { computeRecords, divisionStandings } from './standings.js';
import { advancePlayerDevelopment, computePerformanceMultipliers } from './development.js';
import { processRetirements } from './retirement.js';
import { seasonStatsForLeague } from './stats.js';
import { seasonAwards } from './awards.js';
import { CompetitiveWindow } from '../types/enums.js';
import { WEEKS_PER_LEAGUE_YEAR } from '../contracts/constants.js';
import {
  applyContractExpirations,
  applyCapCuts,
  refillRosters,
} from '../transactions/offseason.js';
import { runProactiveTrades } from '../transactions/proactive-trades.js';
import { refillPracticeSquad } from '../transactions/practice-squad.js';
import { advanceScoutingCycle, regenerateWatchLists } from '../scouting/index.js';
import { advanceCollegePool } from '../draft/pool.js';
import { advanceCollegeScoutingCycle } from '../draft/college-cycle.js';
import { regenerateDraftBoardsForLeague } from '../draft/board.js';
import { runCombine } from '../draft/combine.js';
import { runProDays } from '../draft/pro-days.js';
import { rollJuniorDeclarations } from '../draft/declaration.js';
import { runDraft, applyDraftResult } from '../draft/event.js';
import { computeDraftOrder } from '../draft/draft-order.js';
import { runUdfaPromotion, applyUdfaResult } from '../draft/udfa.js';
import { runCoachVisits, applyCoachVisits } from '../draft/coach-visits.js';
import {
  picksForRoundInSlotOrder,
  buildSlotMap,
  advancePickHorizon,
} from '../draft/picks.js';
import { preseasonCuts } from '../transactions/preseason-cuts.js';
import { offseasonMoodDrift, weeklyMoodUpdate } from './mood.js';
import { generateSchedule } from './schedule.js';
import { simulateGame } from '../games/outcome.js';
import { runWeeklyPoaching } from '../transactions/poach.js';
import { runWeeklyFreeAgentSignings } from '../transactions/midseason-fa.js';
import { runWeeklyNpcTrades } from '../transactions/npc-trade.js';
import {
  playWildCardRound,
  playDivisionalRound,
  playConferenceRound,
  playSuperBowlRound,
} from './playoffs.js';
import {
  generateWeeklyMediaReports,
  generatePlayoffRoundMediaReports,
} from '../media/reports.js';
import {
  generateCollegeRegularSeason,
  bucketProspectsBySchool,
  collegeTeamStrength,
  simulateCollegeGame,
  deriveCollegeGamePlayerStats,
  computeCollegeRecords,
  buildConferenceChampionships,
  buildCfpBracket,
  buildCfpQuarterfinals,
  buildCfpSemifinals,
  buildCfpFinal,
  buildBowlSlate,
} from '../college-season/index.js';
import type {
  CollegeGame,
  CollegeSeasonSchedule,
  CollegePlayerGameStats,
  CfpBracket,
} from '../types/college-season.js';
import { COLLEGE_SCHOOLS } from '../data/colleges/index.js';
import type { CollegePlayer, CollegeSchool } from '../types/college.js';
import { buildSeasonTimeline, type TimelineStep } from './timeline.js';

const SECONDS_PER_LEAGUE_YEAR = WEEKS_PER_LEAGUE_YEAR;

/**
 * Where the league sits in its annual cycle. Set on every league
 * state; `tickPhase` advances it to the next ordered phase.
 *
 * v0.56 split the coarse `REGULAR_SEASON` into a week-grained
 * `REGULAR_SEASON_WEEK` (loops on itself via `currentWeek` until
 * all weeks are played) plus four playoff-round phases.
 *
 * `REGULAR_SEASON_WEEK` is special: `nextPhaseAfter` reports the
 * NEXT distinct phase (`WILD_CARD`), but `tickPhase` self-loops
 * on `REGULAR_SEASON_WEEK` while there are still weeks left to
 * play. The transition to `WILD_CARD` only happens on the tick
 * that plays the final regular-season week.
 */
export type LifecyclePhase =
  | 'REGULAR_SEASON_WEEK'
  | 'COLLEGE_WEEK'
  | 'COLLEGE_CONFERENCE_CHAMPIONSHIPS'
  | 'HEISMAN_CEREMONY'
  | 'COLLEGE_BOWL_GAMES'
  | 'CFP_FIRST_ROUND'
  | 'CFP_QUARTERFINALS'
  | 'CFP_SEMIFINALS'
  | 'CFP_FINAL'
  | 'WILD_CARD'
  | 'DIVISIONAL'
  | 'CONFERENCE'
  | 'SUPER_BOWL'
  | 'POST_SEASON_FINALIZE'
  | 'OFFSEASON_TRANSACTIONS'
  | 'PRE_DRAFT'
  | 'DRAFT'
  | 'POST_DRAFT_ROSTER'
  | 'COLLEGE_CYCLE'
  | 'READY_FOR_NEXT_SEASON';

/**
 * Ordered phase sequence. `tickPhase` consults this to know what
 * comes after a given phase. `READY_FOR_NEXT_SEASON` wraps back to
 * `REGULAR_SEASON_WEEK` for the next year's schedule generation.
 *
 * NOTE (v0.63.1): this array is no longer the dispatch order. It's
 * kept as a stable *enumeration* of every phase (used by the calendar
 * display layer + tests). The actual tick order is the date-sorted
 * `buildSeasonTimeline` (see `season/timeline.ts` and
 * `decideTickTarget`): NFL and college weeks interleave by real
 * calendar date, and the college postseason rounds are spread across
 * late-December NFL weeks and the NFL playoff window rather than
 * firing as one contiguous block.
 */
export const LIFECYCLE_ORDER: readonly LifecyclePhase[] = [
  'REGULAR_SEASON_WEEK',
  'COLLEGE_WEEK',
  'COLLEGE_CONFERENCE_CHAMPIONSHIPS',
  'HEISMAN_CEREMONY',
  'COLLEGE_BOWL_GAMES',
  'CFP_FIRST_ROUND',
  'CFP_QUARTERFINALS',
  'CFP_SEMIFINALS',
  'CFP_FINAL',
  'WILD_CARD',
  'DIVISIONAL',
  'CONFERENCE',
  'SUPER_BOWL',
  'POST_SEASON_FINALIZE',
  'OFFSEASON_TRANSACTIONS',
  'PRE_DRAFT',
  'DRAFT',
  'POST_DRAFT_ROSTER',
  'COLLEGE_CYCLE',
  'READY_FOR_NEXT_SEASON',
];

/**
 * Phase that fires when current is `phase`. `READY_FOR_NEXT_SEASON`
 * wraps to `REGULAR_SEASON_WEEK` so the inspector can step
 * continuously through year boundaries.
 */
export function nextPhaseAfter(phase: LifecyclePhase): LifecyclePhase {
  if (phase === 'READY_FOR_NEXT_SEASON') return 'REGULAR_SEASON_WEEK';
  const idx = LIFECYCLE_ORDER.indexOf(phase);
  if (idx < 0 || idx >= LIFECYCLE_ORDER.length - 1) {
    return 'REGULAR_SEASON_WEEK';
  }
  return LIFECYCLE_ORDER[idx + 1]!;
}

/**
 * Advance the league by exactly one lifecycle event. Reads
 * `league.lifecyclePhase`, applies one chunk of work, returns a new
 * league state with `lifecyclePhase` (and, for in-season ticks,
 * `currentWeek`) advanced.
 *
 * Most phases transition directly to the next phase in
 * `LIFECYCLE_ORDER`. `REGULAR_SEASON_WEEK` self-loops: each tick
 * plays one regular-season week. The transition to `WILD_CARD` only
 * fires on the tick after the final regular-season week.
 *
 * `READY_FOR_NEXT_SEASON` wraps forward to `REGULAR_SEASON_WEEK` so
 * the inspector can step continuously through year boundaries.
 *
 * The prng is derived from the league's seed + current state so
 * repeated `tickPhase` calls are deterministic.
 */
export function tickPhase(league: LeagueState): LeagueState {
  const target = decideTickTarget(league);

  // PRNG namespace: REGULAR_SEASON_WEEK derives from the season root
  // (same as runner.ts pre-v0.56) so per-week / per-game streams stay
  // byte-for-byte identical across the refactor. Other phases use the
  // v0.54 per-phase namespace.
  if (target === 'REGULAR_SEASON_WEEK') {
    return applyRegularSeasonWeek(league);
  }
  if (target === 'WILD_CARD' || target === 'DIVISIONAL' || target === 'CONFERENCE' || target === 'SUPER_BOWL') {
    const seasonPrng = new PrngClass(`${league.seed}::season-${league.seasonNumber}`);
    const playoffsPrng = seasonPrng.fork('playoffs');
    switch (target) {
      case 'WILD_CARD':
        return applyWildCard(league, playoffsPrng);
      case 'DIVISIONAL':
        return applyDivisional(league, playoffsPrng);
      case 'CONFERENCE':
        return applyConference(league, playoffsPrng);
      case 'SUPER_BOWL':
        return applySuperBowl(league, playoffsPrng);
    }
  }
  const phasePrng = new PrngClass(`${league.seed}::lifecycle::${league.seasonNumber}::${target}`);
  switch (target) {
    case 'COLLEGE_WEEK':
      return applyCollegeWeek(league, phasePrng);
    case 'COLLEGE_CONFERENCE_CHAMPIONSHIPS':
      return applyCollegeConferenceChampionships(league, phasePrng);
    case 'HEISMAN_CEREMONY':
      return applyHeismanCeremony(league);
    case 'COLLEGE_BOWL_GAMES':
      return applyCollegeBowls(league, phasePrng);
    case 'CFP_FIRST_ROUND':
      return applyCfpFirstRound(league, phasePrng);
    case 'CFP_QUARTERFINALS':
      return applyCfpQuarterfinals(league, phasePrng);
    case 'CFP_SEMIFINALS':
      return applyCfpSemifinals(league, phasePrng);
    case 'CFP_FINAL':
      return applyCfpFinal(league, phasePrng);
    case 'POST_SEASON_FINALIZE':
      return applyPostSeasonFinalize(league, phasePrng);
    case 'OFFSEASON_TRANSACTIONS':
      return applyOffseasonTransactions(league, phasePrng);
    case 'PRE_DRAFT':
      return applyPreDraft(league, phasePrng);
    case 'DRAFT':
      return applyDraft(league, phasePrng);
    case 'POST_DRAFT_ROSTER':
      return applyPostDraftRoster(league, phasePrng);
    case 'COLLEGE_CYCLE':
      return applyCollegeCycle(league, phasePrng);
    case 'READY_FOR_NEXT_SEASON':
      return { ...league, lifecyclePhase: 'READY_FOR_NEXT_SEASON' };
  }
}

/**
 * Decide what phase to apply on this tick by walking the unified,
 * date-ordered season timeline (`buildSeasonTimeline`).
 *
 * The timeline lists every phase as a dated step, sorted by calendar
 * date. We locate the league's *most-recently-completed* step from its
 * current `lifecyclePhase` + week counters, then return the phase of
 * the next step. This is what makes NFL and college weeks interleave
 * in true calendar order (College Week 1 on Aug 30 before NFL Week 1
 * on Sept 7) and spreads the college postseason across the late NFL
 * regular season + playoff window.
 *
 *   - A fresh season (`REGULAR_SEASON_WEEK`, `currentWeek === null`,
 *     nothing played) has no completed step → fire the earliest step,
 *     which is College Week 1.
 *   - Past the final step → `READY_FOR_NEXT_SEASON` (the wrap marker;
 *     it has no calendar date so it isn't in the timeline itself).
 *   - `READY_FOR_NEXT_SEASON` wraps to the first step of the next
 *     season's timeline.
 *
 * The apply functions still derive their own week index from
 * `currentWeek` / `collegeCurrentWeek` (+1 each tick); the timeline
 * only decides *which* phase fires next, never re-deriving the week.
 */
function decideTickTarget(league: LeagueState): LifecyclePhase {
  const timeline = buildSeasonTimeline(league.seasonNumber);

  if (league.lifecyclePhase === 'READY_FOR_NEXT_SEASON') {
    // Wrap forward into the next season (seasonNumber already advanced
    // in POST_SEASON_FINALIZE) — fire its earliest dated step.
    return timeline[0]!.phase;
  }

  const idx = currentTimelineIndex(league, timeline);
  if (idx < 0) return timeline[0]!.phase;
  if (idx >= timeline.length - 1) return 'READY_FOR_NEXT_SEASON';
  return timeline[idx + 1]!.phase;
}

/**
 * Index into `timeline` of the league's most-recently-completed step.
 * Returns -1 when nothing has been played yet (fresh season).
 *
 * Week-grained phases match on their week counter; single-shot phases
 * match on the phase name alone (each appears exactly once).
 */
function currentTimelineIndex(
  league: LeagueState,
  timeline: readonly TimelineStep[],
): number {
  const phase = league.lifecyclePhase;
  if (phase === 'REGULAR_SEASON_WEEK') {
    if (league.currentWeek === null) return -1;
    return timeline.findIndex(
      (s) => s.phase === 'REGULAR_SEASON_WEEK' && s.weekIndex === league.currentWeek,
    );
  }
  if (phase === 'COLLEGE_WEEK') {
    if (league.collegeCurrentWeek === null) return -1;
    return timeline.findIndex(
      (s) => s.phase === 'COLLEGE_WEEK' && s.weekIndex === league.collegeCurrentWeek,
    );
  }
  return timeline.findIndex((s) => s.phase === phase);
}

// ─── Phase 0: REGULAR_SEASON_WEEK ───────────────────────────────────────
//
// Plays one regular-season week. The first tick of a season
// (`currentWeek === null`) also generates the schedule. Each tick
// runs the same per-week subsystems as the pre-v0.56 monolithic
// `simulateSeason` loop body:
//   recover injuries → play games → poach → mid-season FA → mood →
//   NPC trades → proactive trades
//
// PRNG namespacing matches the pre-v0.56 runner.ts exactly:
//   seasonPrng = ${seed}::season-${N}
//   fork labels: 'schedule', 'week-K', 'poach-K', 'fa-K', 'mood-K',
//                'npc-trade-K', 'proactive-trade-K'
// so the refactor is deterministic byte-for-byte with the monolith.

function applyRegularSeasonWeek(league: LeagueState): LeagueState {
  const seasonPrng = new PrngClass(`${league.seed}::season-${league.seasonNumber}`);

  // First tick of the season: generate the schedule (empty results).
  let schedule: SeasonSchedule;
  if (league.schedule === null) {
    const teams = Object.values(league.teams);
    schedule = generateSchedule(seasonPrng.fork('schedule'), teams, league.seasonNumber);
  } else {
    schedule = league.schedule;
  }

  const weekIdx = league.currentWeek === null ? 0 : league.currentWeek + 1;
  const currentTick = league.tick + weekIdx;

  let playersDuringSeason: Record<string, Player> = league.players as Record<string, Player>;
  let teamsDuringSeason: Record<string, TeamState> = league.teams as Record<string, TeamState>;
  let contractsDuringSeason: Record<string, Contract> = league.contracts as Record<string, Contract>;
  let logDuringSeason: readonly Transaction[] = league.transactionLog;

  // Recover any injuries whose return tick has passed.
  const recovered: Record<string, Player> = {};
  for (const [pid, p] of Object.entries(playersDuringSeason)) {
    if (p.injury && p.injury.estimatedReturnTick <= currentTick) {
      recovered[pid] = { ...p, injury: null };
    }
  }
  if (Object.keys(recovered).length > 0) {
    playersDuringSeason = { ...playersDuringSeason, ...recovered };
  }

  // Play this week's games. Injuries propagate onto Player.injury so
  // the next game in the same week sees the up-to-date state. MAJOR
  // injuries trigger IR moves.
  const week = schedule.regularSeason[weekIdx]!;
  const weekPrng = seasonPrng.fork(`week-${weekIdx + 1}`);
  const playedWeek: ScheduledGame[] = [];
  for (const pendingGame of week) {
    const weekLeague: LeagueState = {
      ...league,
      players: playersDuringSeason as typeof league.players,
      teams: teamsDuringSeason as Readonly<Record<TeamId, TeamState>>,
      contracts: contractsDuringSeason as Readonly<Record<ContractIdType, Contract>>,
      // Force REGULAR_SEASON during play so cap math uses the all-53
      // rule rather than the offseason top-51.
      phase: 'REGULAR_SEASON',
    };
    const home = weekLeague.teams[pendingGame.homeTeamId]!;
    const away = weekLeague.teams[pendingGame.awayTeamId]!;
    const played = simulateGame(weekPrng.fork(pendingGame.id), {
      homeTeam: home,
      awayTeam: away,
      league: weekLeague,
      weekNumber: pendingGame.weekNumber,
      kind: 'REGULAR',
    });
    playedWeek.push(played);

    if (played.result?.injuries.length) {
      const updates: Record<string, Player> = {};
      const irMoves: { playerId: PlayerId; teamId: TeamId }[] = [];
      for (const inj of played.result.injuries) {
        const p = playersDuringSeason[inj.playerId];
        if (!p) continue;
        updates[inj.playerId] = {
          ...p,
          injury: {
            type: inj.type,
            severity: inj.severity,
            occurredOnTick: currentTick,
            estimatedReturnTick: currentTick + inj.weeksOut,
          },
        };
        if (inj.severity === 'MAJOR' && p.teamId) {
          irMoves.push({ playerId: inj.playerId, teamId: p.teamId });
          logDuringSeason = [
            ...logDuringSeason,
            {
              kind: 'ir-move',
              tick: currentTick,
              seasonNumber: league.seasonNumber,
              teamId: p.teamId,
              playerId: inj.playerId,
              injurySeverity: inj.severity,
              weeksOut: inj.weeksOut,
            },
          ];
        }
      }
      if (Object.keys(updates).length > 0) {
        playersDuringSeason = { ...playersDuringSeason, ...updates };
      }
      if (irMoves.length > 0) {
        teamsDuringSeason = applyIrMoves(teamsDuringSeason, irMoves);
      }
    }
  }

  // We've played the full week — push it into the schedule.
  const updatedRegularSeason = schedule.regularSeason.map((w, i) =>
    i === weekIdx ? playedWeek : w,
  );

  // Poach: any team below 53 active gets one shot at promoting a PS
  // player to fill their biggest positional deficit.
  const poachLeague: LeagueState = {
    ...league,
    players: playersDuringSeason as typeof league.players,
    teams: teamsDuringSeason as Readonly<Record<TeamId, TeamState>>,
    contracts: contractsDuringSeason as Readonly<Record<ContractIdType, Contract>>,
    phase: 'REGULAR_SEASON',
    transactionLog: logDuringSeason,
  };
  const poachResult = runWeeklyPoaching(
    seasonPrng.fork(`poach-${weekIdx + 1}`),
    poachLeague,
    currentTick + 1,
  );
  playersDuringSeason = poachResult.players as Record<string, Player>;
  teamsDuringSeason = poachResult.teams as Record<string, TeamState>;
  contractsDuringSeason = poachResult.contracts as Record<string, Contract>;
  logDuringSeason = poachResult.transactionLog;

  // Mid-season FA signings.
  const faLeague: LeagueState = {
    ...league,
    players: playersDuringSeason as typeof league.players,
    teams: teamsDuringSeason as Readonly<Record<TeamId, TeamState>>,
    contracts: contractsDuringSeason as Readonly<Record<ContractIdType, Contract>>,
    phase: 'REGULAR_SEASON',
    transactionLog: logDuringSeason,
  };
  const faResult = runWeeklyFreeAgentSignings(
    seasonPrng.fork(`fa-${weekIdx + 1}`),
    faLeague,
    currentTick + 1,
  );
  playersDuringSeason = faResult.players as Record<string, Player>;
  teamsDuringSeason = faResult.teams as Record<string, TeamState>;
  contractsDuringSeason = faResult.contracts as Record<string, Contract>;
  logDuringSeason = faResult.transactionLog;

  // Mood update: feed the full played-weeks history so streak detection
  // sees the just-played week.
  const moodLeague: LeagueState = {
    ...league,
    players: playersDuringSeason as typeof league.players,
    teams: teamsDuringSeason as Readonly<Record<TeamId, TeamState>>,
    contracts: contractsDuringSeason as Readonly<Record<ContractIdType, Contract>>,
    phase: 'REGULAR_SEASON',
    transactionLog: logDuringSeason,
  };
  const playedSoFar: ScheduledGame[][] = updatedRegularSeason
    .slice(0, weekIdx + 1)
    .map((w) => [...w]);
  const moodResult = weeklyMoodUpdate({
    league: moodLeague,
    playedWeeks: playedSoFar,
    tick: currentTick,
    prng: seasonPrng.fork(`mood-${weekIdx + 1}`),
  });
  playersDuringSeason = moodResult.players as Record<string, Player>;
  logDuringSeason = moodResult.transactionLog;

  // NPC trade-finder + proactive trades.
  const tradeLeague: LeagueState = {
    ...league,
    players: playersDuringSeason as typeof league.players,
    teams: teamsDuringSeason as Readonly<Record<TeamId, TeamState>>,
    contracts: contractsDuringSeason as Readonly<Record<ContractIdType, Contract>>,
    phase: 'REGULAR_SEASON',
    transactionLog: logDuringSeason,
    tick: currentTick,
  };
  const tradeResult = runWeeklyNpcTrades(
    seasonPrng.fork(`npc-trade-${weekIdx + 1}`),
    tradeLeague,
    currentTick,
  );
  const proactiveLeague: LeagueState = {
    ...tradeResult,
    tick: currentTick,
    // Stamp the in-progress week so trade evaluators downstream see
    // `currentWeek === weekIdx` while THIS tick's trades are valued.
    // `isTradeDeadlineWeek` (v0.58) keys off this — without the stamp
    // `league.currentWeek` would still be the prior tick's value and
    // the deadline overlay would land one week late.
    currentWeek: weekIdx,
  };
  const proactiveResult = runProactiveTrades(
    seasonPrng.fork(`proactive-trade-${weekIdx + 1}`),
    proactiveLeague,
    currentTick,
  );
  playersDuringSeason = proactiveResult.players as Record<string, Player>;
  teamsDuringSeason = proactiveResult.teams as Record<string, TeamState>;
  contractsDuringSeason = proactiveResult.contracts as Record<string, Contract>;
  logDuringSeason = proactiveResult.transactionLog;

  const isLastRegSeasonWeek = weekIdx >= schedule.regularSeason.length - 1;

  const nextLeagueBase: LeagueState = {
    ...league,
    players: playersDuringSeason as typeof league.players,
    teams: teamsDuringSeason as Readonly<Record<TeamId, TeamState>>,
    contracts: contractsDuringSeason as Readonly<Record<ContractIdType, Contract>>,
    transactionLog: logDuringSeason,
    schedule: {
      seasonNumber: schedule.seasonNumber,
      regularSeason: updatedRegularSeason,
      // Playoffs populate during the four playoff-round phases.
      playoffs: schedule.playoffs ?? null,
    },
    currentWeek: weekIdx,
    // Coarse-grained legacy LeaguePhase: flip to PLAYOFFS on the
    // final regular-season week so cap math + UI see the transition
    // immediately. Lifecycle phase stays REGULAR_SEASON_WEEK until
    // the next tick fires WILD_CARD.
    phase: isLastRegSeasonWeek ? 'PLAYOFFS' : 'REGULAR_SEASON',
    lifecyclePhase: 'REGULAR_SEASON_WEEK',
  };

  // v0.62 media reports — fire AFTER all per-week subsystems so the
  // streak detector + headline templates see the just-played game's
  // result against the rest of the season.
  const mediaReports = generateWeeklyMediaReports(
    seasonPrng.fork(`media-week-${weekIdx + 1}`),
    nextLeagueBase,
    weekIdx,
    currentTick,
  );
  return {
    ...nextLeagueBase,
    mediaReports: [...nextLeagueBase.mediaReports, ...mediaReports],
  };
}

// ─── Phases 1–4: Playoff rounds ─────────────────────────────────────────
//
// Each round is one tick. The bracket state lives in
// `league.schedule.playoffs`; each handler reads prior rounds from
// there to assemble its matchups. PRNG comes from
// `seasonPrng.fork('playoffs')` — same root the pre-v0.56 monolith
// used, so per-game fork labels resolve to identical streams.

function applyWildCard(league: LeagueState, prng: PrngClass): LeagueState {
  if (!league.schedule) {
    throw new Error('applyWildCard requires a populated league.schedule');
  }
  const r = playWildCardRound(prng, league);
  const playoffs: PlayoffsState = {
    wildCard: r.games,
    divisional: [],
    conference: [],
    superBowl: [],
    championId: null,
  };
  const next: LeagueState = {
    ...league,
    players: r.players as typeof league.players,
    schedule: { ...league.schedule, playoffs },
    currentWeek: null,
    phase: 'PLAYOFFS',
    lifecyclePhase: 'WILD_CARD',
  };
  return appendMediaReports(next, mediaPrngForPlayoffs(league).fork('wild-card'), r.games, 'WILD_CARD');
}

function applyDivisional(league: LeagueState, prng: PrngClass): LeagueState {
  if (!league.schedule || !league.schedule.playoffs) {
    throw new Error('applyDivisional requires wild card to have fired');
  }
  const r = playDivisionalRound(prng, league);
  const playoffs: PlayoffsState = { ...league.schedule.playoffs, divisional: r.games };
  const next: LeagueState = {
    ...league,
    players: r.players as typeof league.players,
    schedule: { ...league.schedule, playoffs },
    lifecyclePhase: 'DIVISIONAL',
  };
  return appendMediaReports(next, mediaPrngForPlayoffs(league).fork('divisional'), r.games, 'DIVISIONAL');
}

function applyConference(league: LeagueState, prng: PrngClass): LeagueState {
  if (!league.schedule || !league.schedule.playoffs) {
    throw new Error('applyConference requires divisional to have fired');
  }
  const r = playConferenceRound(prng, league);
  const playoffs: PlayoffsState = { ...league.schedule.playoffs, conference: r.games };
  const next: LeagueState = {
    ...league,
    players: r.players as typeof league.players,
    schedule: { ...league.schedule, playoffs },
    lifecyclePhase: 'CONFERENCE',
  };
  return appendMediaReports(next, mediaPrngForPlayoffs(league).fork('conference'), r.games, 'CONFERENCE');
}

function applySuperBowl(league: LeagueState, prng: PrngClass): LeagueState {
  if (!league.schedule || !league.schedule.playoffs) {
    throw new Error('applySuperBowl requires conference round to have fired');
  }
  const r = playSuperBowlRound(prng, league);
  const playoffs: PlayoffsState = {
    ...league.schedule.playoffs,
    superBowl: r.games,
    championId: r.championId,
  };
  const next: LeagueState = {
    ...league,
    players: r.players as typeof league.players,
    schedule: { ...league.schedule, playoffs },
    lifecyclePhase: 'SUPER_BOWL',
  };
  return appendMediaReports(next, mediaPrngForPlayoffs(league).fork('super-bowl'), r.games, 'SUPER_BOWL');
}

function mediaPrngForPlayoffs(league: LeagueState): PrngClass {
  return new PrngClass(`${league.seed}::season-${league.seasonNumber}::media-playoffs`);
}

function appendMediaReports(
  league: LeagueState,
  prng: PrngClass,
  games: readonly import('../types/game.js').ScheduledGame[],
  phase: LifecyclePhase,
): LeagueState {
  const reports = generatePlayoffRoundMediaReports(prng, league, phase, games, league.tick);
  return { ...league, mediaReports: [...league.mediaReports, ...reports] };
}

function applyIrMoves(
  teams: Record<string, TeamState>,
  moves: readonly { playerId: PlayerId; teamId: TeamId }[],
): Record<string, TeamState> {
  const next: Record<string, TeamState> = { ...teams };
  for (const { playerId, teamId } of moves) {
    const team = next[teamId];
    if (!team) continue;
    if (!team.rosterIds.includes(playerId)) continue;
    if (team.injuredReserveIds.includes(playerId)) continue;
    next[teamId] = {
      ...team,
      rosterIds: team.rosterIds.filter((id) => id !== playerId),
      injuredReserveIds: [...team.injuredReserveIds, playerId],
    };
  }
  return next;
}

// ─── Phase 1: POST_SEASON_FINALIZE ──────────────────────────────────────
//
// Closes out the played season. Awards, player development, retirement,
// contract decrement, season history, IR activation. Transitions the
// league into next season's tick + seasonNumber.

function applyPostSeasonFinalize(
  league: LeagueState,
  prng: PrngClass,
): LeagueState {
  if (!league.schedule) {
    throw new Error('applyPostSeasonFinalize requires a played schedule');
  }
  const records = computeRecords(league);
  const standings = divisionStandings(league, records);
  const nextSeasonNumber = league.seasonNumber + 1;
  const nextTick = league.tick + SECONDS_PER_LEAGUE_YEAR;

  const teamsNext: Record<string, TeamState> = {};
  for (const team of Object.values(league.teams)) {
    const record = records.get(team.identity.id)!;
    const seasonRecord = buildSeasonRecord(team, record, standings, league);
    const newWindow = updateCompetitiveWindow(team, record);
    teamsNext[team.identity.id] = {
      ...team,
      seasonHistory: [...team.seasonHistory, seasonRecord],
      competitiveWindow: newWindow,
      deadMoneyByYear: team.deadMoneyByYear.slice(1),
    };
  }

  const seasonStats = seasonStatsForLeague(league);
  const awards = seasonAwards(league);
  const playerAwardMap = buildPlayerAwardMap(awards);
  const performanceMultipliers = computePerformanceMultipliers(league, seasonStats);

  const playersAfterDev: Record<string, Player> = {};
  for (const player of Object.values(league.players)) {
    const playerPrng = prng.fork(`player:${player.id}`);
    const multiplier = performanceMultipliers.get(player.id) ?? 1.0;
    let advanced = advancePlayerDevelopment(playerPrng.fork('dev'), player, league, multiplier);

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

  const contractsAfterAdvance: Record<string, Contract> = {};
  for (const contract of Object.values(league.contracts)) {
    const player = playersAfterDev[contract.playerId];
    if (!player) continue;
    contractsAfterAdvance[contract.id] = {
      ...contract,
      yearsRemaining: contract.yearsRemaining - 1,
    };
  }

  const retirement = processRetirements(
    prng.fork('retirement'),
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

  const contractsNext: Record<string, Contract> = {};
  const droppedSet = new Set<ContractIdType>(retirement.dropContractIds);
  for (const [id, contract] of Object.entries(contractsAfterAdvance)) {
    if (droppedSet.has(id as ContractIdType)) continue;
    contractsNext[id] = contract;
  }

  for (const teamId of Object.keys(teamsNext)) {
    const team = teamsNext[teamId]!;
    const postRetirementRoster = retirement.rosterIdsByTeam.get(teamId) ?? team.rosterIds;
    const restoredIr = team.injuredReserveIds.filter((id) => !retiredSet.has(id));
    teamsNext[teamId] = {
      ...team,
      rosterIds: [...postRetirementRoster, ...restoredIr],
      injuredReserveIds: [],
      practiceSquadIds: team.practiceSquadIds.filter((id) => !retiredSet.has(id)),
    };
  }

  // NOTE: `schedule` stays populated until COLLEGE_CYCLE — the DRAFT
  // phase needs it to compute slot order from the just-played
  // season's records. The pre-v0.54 monolith cleared it here; the
  // refactor pushed the cleanup to the end of the cycle.
  return {
    ...league,
    teams: teamsNext as Readonly<Record<TeamId, TeamState>>,
    players: playersNext as typeof league.players,
    coaches: coachesNext as Readonly<Record<CoachId, HeadCoach>>,
    contracts: contractsNext as Readonly<Record<ContractIdType, Contract>>,
    seasonNumber: nextSeasonNumber,
    tick: nextTick,
    phase: 'OFFSEASON_PRE_FA',
    lifecyclePhase: 'POST_SEASON_FINALIZE',
  };
}

// ─── Phase 2: OFFSEASON_TRANSACTIONS ────────────────────────────────────
//
// Contract expirations → cap cuts → proactive trades → NFL scouting
// cycle → FA refill → practice squad → mood drift → final watch lists.

function applyOffseasonTransactions(
  league: LeagueState,
  prng: PrngClass,
): LeagueState {
  let offseason = applyContractExpirations(league);
  offseason = applyCapCuts(offseason);
  offseason = runProactiveTrades(
    prng.fork('proactive-trade-offseason'),
    offseason,
    league.tick,
  );
  offseason = advanceScoutingCycle(
    prng.fork('scouting-cycle'),
    offseason,
    league.tick,
  );
  offseason = refillRosters(offseason, league.tick);
  offseason = refillPracticeSquad(
    prng.fork('practice-squad'),
    offseason,
    league.tick,
    league.seasonNumber,
  );
  offseason = offseasonMoodDrift(offseason);
  offseason = {
    ...offseason,
    watchLists: regenerateWatchLists(
      offseason.teams,
      offseason.scouts,
      offseason.coaches,
      offseason.players,
      offseason.observations,
      league.tick,
    ),
    lifecyclePhase: 'OFFSEASON_TRANSACTIONS',
  };
  return offseason;
}

// ─── Phase 3: PRE_DRAFT ────────────────────────────────────────────────
//
// JR declarations roll; draftBoards filter out returning JRs; snapshot
// the board state for the upcoming draft.

function applyPreDraft(league: LeagueState, prng: PrngClass): LeagueState {
  let offseason: LeagueState = {
    ...league,
    collegePool: rollJuniorDeclarations(
      prng.fork('jr-declarations'),
      league.collegePool,
    ),
  };

  const returningIds = new Set<PlayerId>();
  for (const cp of offseason.collegePool) {
    if (cp.hasReturnedToSchool) returningIds.add(cp.id);
  }
  const draftCandidateBoards: Record<string, readonly DraftBoardEntry[]> = {};
  for (const teamId of Object.keys(offseason.draftBoards)) {
    const board = offseason.draftBoards[teamId as keyof typeof offseason.draftBoards] ?? [];
    draftCandidateBoards[teamId] = board.filter(
      (e) => !returningIds.has(e.collegePlayerId),
    );
  }
  offseason = {
    ...offseason,
    draftBoards: draftCandidateBoards as typeof offseason.draftBoards,
    draftBoardSnapshots: {
      ...offseason.draftBoardSnapshots,
      [offseason.seasonNumber]: draftCandidateBoards as typeof offseason.draftBoards,
    },
    lifecyclePhase: 'PRE_DRAFT',
  };
  return offseason;
}

// ─── Phase 4: DRAFT ────────────────────────────────────────────────────
//
// 7 rounds × 32 picks. Each round's slot order is computed from the
// just-finished season's standings (derived from team season history
// at this point, since `schedule` was cleared in POST_SEASON_FINALIZE).
// Trade-ups fire per pick (v0.45+).

function applyDraft(league: LeagueState, prng: PrngClass): LeagueState {
  // Slot order = inverse standings from the just-played season.
  // `league.schedule` is still populated at this phase (cleared in
  // COLLEGE_CYCLE), so we can compute the full records map.
  if (!league.schedule) {
    throw new Error('applyDraft requires league.schedule to compute slot order');
  }
  const records = computeRecords(league);
  const draftSlotOrder = computeDraftOrder(records);
  const slotMap = buildSlotMap(draftSlotOrder);
  const DRAFT_ROUNDS = 7;
  const PICKS_PER_ROUND = draftSlotOrder.length;

  let offseason = league;
  for (let round = 1; round <= DRAFT_ROUNDS; round++) {
    const startingOverallPick = (round - 1) * PICKS_PER_ROUND + 1;
    const roundAssets = picksForRoundInSlotOrder(
      offseason.draftPicks,
      offseason.seasonNumber,
      round,
      slotMap,
    );
    const roundDraftOrder = roundAssets.map((a) => a.currentTeamId);
    const roundResult = runDraft(prng.fork(`draft-round-${round}`), offseason, {
      draftOrder: roundDraftOrder,
      pickedOnTick: offseason.tick,
      seasonNumber: offseason.seasonNumber,
      round,
      startingOverallPick,
      pickAssets: roundAssets,
    });
    offseason = applyDraftResult(offseason, roundResult);
    if (roundResult.picks.length < roundDraftOrder.length) {
      break;
    }
  }

  return { ...offseason, lifecyclePhase: 'DRAFT' };
}

// ─── Phase 5: POST_DRAFT_ROSTER ────────────────────────────────────────
//
// Preseason cuts (anyone above 53, rookies protected) + UDFA pipeline.

function applyPostDraftRoster(
  league: LeagueState,
  prng: PrngClass,
): LeagueState {
  const justDraftedRookieIds = new Set<PlayerId>();
  for (const pick of league.draftHistory) {
    if (pick.seasonNumber === league.seasonNumber) {
      justDraftedRookieIds.add(pick.promotedPlayerId);
    }
  }
  let offseason = preseasonCuts(league, {
    protectedPlayerIds: justDraftedRookieIds,
  });
  const udfaResult = runUdfaPromotion(prng.fork('udfa'), offseason, {
    draftedIds: justDraftedRookieIds,
  });
  offseason = applyUdfaResult(offseason, udfaResult);
  return { ...offseason, lifecyclePhase: 'POST_DRAFT_ROSTER' };
}

// ─── Phase 6: COLLEGE_CYCLE ────────────────────────────────────────────
//
// College pool advance → college scouting → board regen → combine →
// pro days → coach visits → pick horizon roll. Leaves the league
// ready for the next regular season's `simulateSeason` call.

function applyCollegeCycle(league: LeagueState, prng: PrngClass): LeagueState {
  const collegeAdvance = advanceCollegePool(
    prng.fork('college-pool'),
    league.collegePool,
    {
      simYear: 2026 + (league.seasonNumber - 1),
      freshmanIdPrefix: `S${league.seasonNumber}`,
    },
  );
  let offseason: LeagueState = {
    ...league,
    collegePool: collegeAdvance.nextPool,
  };

  offseason = advanceCollegeScoutingCycle(
    prng.fork('college-scouting-cycle'),
    offseason,
    offseason.tick,
  );

  const refreshedBoards = regenerateDraftBoardsForLeague({
    teams: offseason.teams,
    collegeScouts: offseason.collegeScouts,
    coaches: offseason.coaches,
    players: offseason.players,
    collegePool: offseason.collegePool,
    observations: offseason.collegeObservations,
    addedOnTick: offseason.tick,
  });

  const combineResults = runCombine(
    prng.fork('combine'),
    offseason.collegePool,
    offseason.tick,
  );
  const proDayAttendance = runProDays(
    prng.fork('pro-days'),
    offseason.teams,
    offseason.collegePool,
    refreshedBoards,
  );

  offseason = {
    ...offseason,
    draftBoards: refreshedBoards,
    combineResults,
    proDayAttendance,
  };

  const coachVisits = runCoachVisits(prng.fork('coach-visits'), offseason, {
    observedOnTick: offseason.tick,
  });
  offseason = applyCoachVisits(offseason, coachVisits);

  const teamIds = Object.values(offseason.teams).map((t) => t.identity.id);
  offseason = {
    ...offseason,
    draftPicks: advancePickHorizon(offseason.draftPicks, offseason.seasonNumber, teamIds),
    // Clear the played schedule at the end of the cycle (DRAFT
    // needed it for slot-order records; nothing further does).
    schedule: null,
    // v0.63: clear the college-season schedule too so the next year
    // generates a fresh one on its first COLLEGE_WEEK tick. Stats
    // stream is intentionally preserved — it's append-only across
    // all seasons.
    collegeSchedule: null,
    collegeCurrentWeek: null,
    // v0.59: stamp this phase's own name (was 'READY_FOR_NEXT_SEASON'
    // pre-v0.59, which made COLLEGE_CYCLE invisible in step-through —
    // the inspector skipped past it directly to the terminal marker).
    // The next tickPhase advances to READY_FOR_NEXT_SEASON via the
    // dispatch table.
    lifecyclePhase: 'COLLEGE_CYCLE',
  };
  return offseason;
}

// ─── Helpers (private; were inline in advance.ts pre-v0.54) ─────────────

function buildPlayerAwardMap(
  awards: ReturnType<typeof seasonAwards>,
): Map<PlayerId, AwardKind[]> {
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

// ─── College Football Season phases (v0.63) ─────────────────────────────
//
// COLLEGE_WEEK plays one regular-season college week. The first
// college tick of a season also generates the schedule. All
// downstream postseason phases (conf champs, bowls, CFP rounds)
// reuse the same `collegeSchedule` slot.

const COLLEGE_TIER_BY_SCHOOL = new Map<string, CollegeSchool['tier']>(
  COLLEGE_SCHOOLS.map((s) => [s.id, s.tier] as const),
);

function applyCollegeWeek(league: LeagueState, prng: PrngClass): LeagueState {
  // First tick of the season: generate the schedule (regular only;
  // postseason rounds populate during their own phases).
  let schedule: CollegeSeasonSchedule;
  if (league.collegeSchedule === null) {
    const reg = generateCollegeRegularSeason(
      prng.fork('schedule'),
      league.seasonNumber,
    );
    schedule = {
      seasonNumber: league.seasonNumber,
      regularSeason: reg,
      conferenceChampionships: [],
      bowls: [],
      cfp: null,
    };
  } else {
    schedule = league.collegeSchedule;
  }

  const weekIdx = league.collegeCurrentWeek === null ? 0 : league.collegeCurrentWeek + 1;
  const week = schedule.regularSeason[weekIdx] ?? [];
  const weekPrng = prng.fork(`week-${weekIdx + 1}`);

  const bucketed = bucketProspectsBySchool(league.collegePool);
  const playedGames = playCollegeWeek(weekPrng, week, bucketed);
  const newStats = collectCollegeStats(playedGames, bucketed, league.tick);

  const updatedRegularSeason = schedule.regularSeason.map((w, i) =>
    i === weekIdx ? playedGames : w,
  );
  const nextSchedule: CollegeSeasonSchedule = {
    ...schedule,
    regularSeason: updatedRegularSeason,
  };

  return {
    ...league,
    collegeSchedule: nextSchedule,
    collegeCurrentWeek: weekIdx,
    collegeGameStats: [...league.collegeGameStats, ...newStats],
    lifecyclePhase: 'COLLEGE_WEEK',
  };
}

function applyCollegeConferenceChampionships(
  league: LeagueState,
  prng: PrngClass,
): LeagueState {
  if (!league.collegeSchedule) {
    throw new Error('applyCollegeConferenceChampionships requires a generated schedule');
  }
  const records = computeCollegeRecords(league.collegeSchedule.regularSeason);
  const matchups = buildConferenceChampionships(records, league.seasonNumber);
  const bucketed = bucketProspectsBySchool(league.collegePool);
  const played = playCollegeGames(prng.fork('conf-champs'), matchups, bucketed, true);
  const newStats = collectCollegeStats(played, bucketed, league.tick);

  return {
    ...league,
    collegeSchedule: {
      ...league.collegeSchedule,
      conferenceChampionships: played,
    },
    collegeGameStats: [...league.collegeGameStats, ...newStats],
    lifecyclePhase: 'COLLEGE_CONFERENCE_CHAMPIONSHIPS',
  };
}

/**
 * Heisman ceremony — Slice 1 placeholder. The lifecycle phase
 * exists so future media + Heisman-race slices can hook in here.
 * For now the phase is a tick marker that just records the
 * advancement; the actual winner selection lands when stat
 * aggregators + media buzz tracking are wired up.
 */
function applyHeismanCeremony(league: LeagueState): LeagueState {
  return { ...league, lifecyclePhase: 'HEISMAN_CEREMONY' };
}

function applyCollegeBowls(league: LeagueState, prng: PrngClass): LeagueState {
  if (!league.collegeSchedule) {
    throw new Error('applyCollegeBowls requires a generated schedule');
  }
  const records = computeCollegeRecords(league.collegeSchedule.regularSeason);
  // Build CFP bracket first so we know which schools are excluded
  // from the bowl pool. The CFP bracket itself is built in CFP_FIRST_ROUND;
  // here we only need to know which schools would be IN the bracket.
  const cfpBracket = buildCfpBracket(
    records,
    league.collegeSchedule.conferenceChampionships,
    league.seasonNumber,
  );
  const cfpSchools = new Set(cfpBracket.seeds);
  const bowlMatchups = buildBowlSlate(records, cfpSchools, league.seasonNumber);

  const bucketed = bucketProspectsBySchool(league.collegePool);
  const played = playCollegeGames(prng.fork('bowls'), bowlMatchups, bucketed, true);
  const newStats = collectCollegeStats(played, bucketed, league.tick);

  return {
    ...league,
    collegeSchedule: {
      ...league.collegeSchedule,
      bowls: played,
    },
    collegeGameStats: [...league.collegeGameStats, ...newStats],
    lifecyclePhase: 'COLLEGE_BOWL_GAMES',
  };
}

function applyCfpFirstRound(league: LeagueState, prng: PrngClass): LeagueState {
  if (!league.collegeSchedule) {
    throw new Error('applyCfpFirstRound requires a generated schedule');
  }
  const records = computeCollegeRecords(league.collegeSchedule.regularSeason);
  const bracket = buildCfpBracket(
    records,
    league.collegeSchedule.conferenceChampionships,
    league.seasonNumber,
  );
  const bucketed = bucketProspectsBySchool(league.collegePool);
  // Higher seeds host first-round games (real CFP rule) → not
  // neutral-site, so HFA applies.
  const playedFirstRound = playCollegeGames(
    prng.fork('cfp-r1'),
    bracket.firstRound,
    bucketed,
    false,
  );
  const newStats = collectCollegeStats(playedFirstRound, bucketed, league.tick);
  const nextBracket: CfpBracket = { ...bracket, firstRound: playedFirstRound };

  return {
    ...league,
    collegeSchedule: {
      ...league.collegeSchedule,
      cfp: nextBracket,
    },
    collegeGameStats: [...league.collegeGameStats, ...newStats],
    lifecyclePhase: 'CFP_FIRST_ROUND',
  };
}

function applyCfpQuarterfinals(league: LeagueState, prng: PrngClass): LeagueState {
  if (!league.collegeSchedule || !league.collegeSchedule.cfp) {
    throw new Error('applyCfpQuarterfinals requires CFP first round to be populated');
  }
  const matchups = buildCfpQuarterfinals(league.collegeSchedule.cfp, league.seasonNumber);
  const bucketed = bucketProspectsBySchool(league.collegePool);
  // Quarterfinals are bowl-site games — neutral, no HFA.
  const played = playCollegeGames(prng.fork('cfp-qf'), matchups, bucketed, true);
  const newStats = collectCollegeStats(played, bucketed, league.tick);

  return {
    ...league,
    collegeSchedule: {
      ...league.collegeSchedule,
      cfp: { ...league.collegeSchedule.cfp, quarterfinals: played },
    },
    collegeGameStats: [...league.collegeGameStats, ...newStats],
    lifecyclePhase: 'CFP_QUARTERFINALS',
  };
}

function applyCfpSemifinals(league: LeagueState, prng: PrngClass): LeagueState {
  if (!league.collegeSchedule || !league.collegeSchedule.cfp) {
    throw new Error('applyCfpSemifinals requires CFP quarterfinals to be populated');
  }
  const matchups = buildCfpSemifinals(league.collegeSchedule.cfp, league.seasonNumber);
  const bucketed = bucketProspectsBySchool(league.collegePool);
  const played = playCollegeGames(prng.fork('cfp-sf'), matchups, bucketed, true);
  const newStats = collectCollegeStats(played, bucketed, league.tick);

  return {
    ...league,
    collegeSchedule: {
      ...league.collegeSchedule,
      cfp: { ...league.collegeSchedule.cfp, semifinals: played },
    },
    collegeGameStats: [...league.collegeGameStats, ...newStats],
    lifecyclePhase: 'CFP_SEMIFINALS',
  };
}

function applyCfpFinal(league: LeagueState, prng: PrngClass): LeagueState {
  if (!league.collegeSchedule || !league.collegeSchedule.cfp) {
    throw new Error('applyCfpFinal requires CFP semifinals to be populated');
  }
  const matchups = buildCfpFinal(league.collegeSchedule.cfp, league.seasonNumber);
  const bucketed = bucketProspectsBySchool(league.collegePool);
  const played = playCollegeGames(prng.fork('cfp-final'), matchups, bucketed, true);
  const newStats = collectCollegeStats(played, bucketed, league.tick);
  const champion =
    played[0]?.result
      ? played[0].result.homeScore > played[0].result.awayScore
        ? played[0].homeSchoolId
        : played[0].awaySchoolId
      : null;

  return {
    ...league,
    collegeSchedule: {
      ...league.collegeSchedule,
      cfp: { ...league.collegeSchedule.cfp, final: played, championSchoolId: champion },
    },
    collegeGameStats: [...league.collegeGameStats, ...newStats],
    lifecyclePhase: 'CFP_FINAL',
  };
}

/**
 * Play every game in `games` against the current college pool.
 * Per-game PRNGs are forked off the round's prng using the game id
 * so a single round's games stay deterministic and order-independent.
 */
function playCollegeGames(
  prng: PrngClass,
  games: readonly CollegeGame[],
  bucketed: ReadonlyMap<string, readonly CollegePlayer[]>,
  neutralSite: boolean,
): CollegeGame[] {
  const played: CollegeGame[] = [];
  for (const game of games) {
    played.push(simulateCollegeGameWithStrengths(prng.fork(game.id), game, bucketed, neutralSite));
  }
  return played;
}

function playCollegeWeek(
  weekPrng: PrngClass,
  games: readonly CollegeGame[],
  bucketed: ReadonlyMap<string, readonly CollegePlayer[]>,
): CollegeGame[] {
  const played: CollegeGame[] = [];
  for (const game of games) {
    played.push(simulateCollegeGameWithStrengths(weekPrng.fork(game.id), game, bucketed, false));
  }
  return played;
}

function simulateCollegeGameWithStrengths(
  prng: PrngClass,
  game: CollegeGame,
  bucketed: ReadonlyMap<string, readonly CollegePlayer[]>,
  neutralSite: boolean,
): CollegeGame {
  const homeTier = COLLEGE_TIER_BY_SCHOOL.get(game.homeSchoolId) ?? 'GROUP_OF_5';
  const awayTier = COLLEGE_TIER_BY_SCHOOL.get(game.awaySchoolId) ?? 'GROUP_OF_5';
  const homeStrength = collegeTeamStrength(game.homeSchoolId, homeTier, bucketed);
  const awayStrength = collegeTeamStrength(game.awaySchoolId, awayTier, bucketed);
  return simulateCollegeGame(prng, {
    game,
    homeStrength,
    awayStrength,
    neutralSite,
  });
}

function collectCollegeStats(
  games: readonly CollegeGame[],
  bucketed: ReadonlyMap<string, readonly CollegePlayer[]>,
  playedOnTick: number,
): CollegePlayerGameStats[] {
  const stats: CollegePlayerGameStats[] = [];
  for (const game of games) {
    if (!game.result) continue;
    stats.push(...deriveCollegeGamePlayerStats(game, bucketed, playedOnTick));
  }
  return stats;
}
