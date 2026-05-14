import type { LeagueState } from '../types/league.js';
import type { ScheduledGame, SeasonSchedule } from '../types/game.js';
import type { Player } from '../types/player.js';
import type { TeamState } from '../types/team.js';
import type { Contract } from '../types/contract.js';
import type { Transaction } from '../types/transaction.js';
import type { TeamId, PlayerId, ContractId } from '../types/ids.js';
import { Prng as PrngClass } from '../prng/index.js';
import { generateSchedule } from './schedule.js';
import { runPlayoffs } from './playoffs.js';
import { simulateGame } from '../games/outcome.js';
import { runWeeklyPoaching } from '../transactions/poach.js';
import { runWeeklyFreeAgentSignings } from '../transactions/midseason-fa.js';
import { runWeeklyNpcTrades } from '../transactions/npc-trade.js';
import { runProactiveTrades } from '../transactions/proactive-trades.js';
import { weeklyMoodUpdate } from './mood.js';
import { migrateLeagueForward } from './migrations.js';

export interface SimulateSeasonOptions {
  /** Override the regular-season PRNG seed. Defaults to league.seed + season number. */
  seed?: string;
}

/**
 * Run an entire season top to bottom: schedule → 18 weeks of regular
 * season → playoffs. Returns a new LeagueState with `schedule` populated
 * and every game's `result` set.
 *
 * Determinism: same input league + same options → identical output.
 */
export function simulateSeason(
  leagueIn: LeagueState,
  options: SimulateSeasonOptions = {},
): LeagueState {
  const league = migrateLeagueForward(leagueIn);
  const seed = options.seed ?? `${league.seed}::season-${league.seasonNumber}`;
  const seasonPrng = new PrngClass(seed);

  const teams = Object.values(league.teams);
  const schedule = generateSchedule(seasonPrng.fork('schedule'), teams, league.seasonNumber);

  // Play each week's games, propagating injuries into Player.injury so
  // they affect subsequent weeks (and survive into the offseason for
  // inspection). Injury recovery sweeps run at the start of each week
  // before games are played. MAJOR injuries trigger an IR move — the
  // player drops off `rosterIds` and onto `injuredReserveIds`, taking
  // them out of subsequent game-sim strength and re-injury rolls.
  let playersDuringSeason: Record<string, Player> = league.players as Record<string, Player>;
  let teamsDuringSeason: Record<string, TeamState> = league.teams as Record<string, TeamState>;
  let contractsDuringSeason: Record<string, Contract> = league.contracts as Record<string, Contract>;
  let logDuringSeason: readonly Transaction[] = league.transactionLog;
  const playedWeeks: ScheduledGame[][] = [];
  for (let weekIdx = 0; weekIdx < schedule.regularSeason.length; weekIdx++) {
    const currentTick = league.tick + weekIdx;

    // Recover any injuries whose return tick is now in the past.
    const recovered: Record<string, Player> = {};
    for (const [pid, p] of Object.entries(playersDuringSeason)) {
      if (p.injury && p.injury.estimatedReturnTick <= currentTick) {
        recovered[pid] = { ...p, injury: null };
      }
    }
    if (Object.keys(recovered).length > 0) {
      playersDuringSeason = { ...playersDuringSeason, ...recovered };
    }

    const week = schedule.regularSeason[weekIdx]!;
    const weekPrng = seasonPrng.fork(`week-${weekIdx + 1}`);
    const playedWeek: ScheduledGame[] = [];
    for (const pendingGame of week) {
      const weekLeague: LeagueState = {
        ...league,
        players: playersDuringSeason,
        teams: teamsDuringSeason as Readonly<Record<TeamId, TeamState>>,
        contracts: contractsDuringSeason as Readonly<Record<ContractId, Contract>>,
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

      // Propagate this game's injuries into Player.injury so the next
      // week's recovery sweep + game sim see the up-to-date state.
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
    playedWeeks.push(playedWeek);

    // After this week's games + IR moves: any team now below 53 active
    // gets one shot at promoting a PS player to fill their biggest
    // positional deficit. Cap-aware. PS contract is dropped, replaced
    // with a 1-year league-minimum active deal.
    const poachLeague: LeagueState = {
      ...league,
      players: playersDuringSeason,
      teams: teamsDuringSeason as Readonly<Record<TeamId, TeamState>>,
      contracts: contractsDuringSeason as Readonly<Record<ContractId, Contract>>,
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

    // Mid-season FA signings: any team still below 53 with cap room
    // signs the best-fit FA from the pool to a 1-year league-min deal.
    const faLeague: LeagueState = {
      ...league,
      players: playersDuringSeason,
      teams: teamsDuringSeason as Readonly<Record<TeamId, TeamState>>,
      contracts: contractsDuringSeason as Readonly<Record<ContractId, Contract>>,
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

    // Mood update: apply after all roster churn for the week so the
    // depth-chart check sees post-promotion / post-FA-sign state. The
    // function is pure (no PRNG) — feeding the just-played weeks lets
    // it detect streaks for the streak amplifier.
    const moodLeague: LeagueState = {
      ...league,
      players: playersDuringSeason,
      teams: teamsDuringSeason as Readonly<Record<TeamId, TeamState>>,
      contracts: contractsDuringSeason as Readonly<Record<ContractId, Contract>>,
      phase: 'REGULAR_SEASON',
      transactionLog: logDuringSeason,
    };
    const moodResult = weeklyMoodUpdate({
      league: moodLeague,
      playedWeeks: playedWeeks,
      tick: currentTick,
      prng: seasonPrng.fork(`mood-${weekIdx + 1}`),
    });
    playersDuringSeason = moodResult.players as Record<string, Player>;
    logDuringSeason = moodResult.transactionLog;

    // NPC trade-finder: match any open trade requests to interested
    // buyers. Runs after the mood pass so this tick's freshly-fired
    // trade-request transactions get a chance to resolve in the same
    // week they're filed.
    const tradeLeague: LeagueState = {
      ...league,
      players: playersDuringSeason,
      teams: teamsDuringSeason as Readonly<Record<TeamId, TeamState>>,
      contracts: contractsDuringSeason as Readonly<Record<ContractId, Contract>>,
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
  }

  const regularSeasonComplete: SeasonSchedule = {
    seasonNumber: league.seasonNumber,
    regularSeason: playedWeeks,
    playoffs: null,
  };

  const leagueAfterRegSeason: LeagueState = {
    ...league,
    players: playersDuringSeason as typeof league.players,
    teams: teamsDuringSeason as Readonly<Record<TeamId, TeamState>>,
    contracts: contractsDuringSeason as Readonly<Record<ContractId, Contract>>,
    transactionLog: logDuringSeason,
    schedule: regularSeasonComplete,
    // Playoff games use the all-53 cap rule too.
    phase: 'PLAYOFFS',
  };

  // Run playoffs. Playoff games propagate injuries onto Player.injury so
  // the inspector and offseason heal both see them. IR moves during the
  // playoffs are skipped (the season ends immediately after, so on-roster
  // vs IR doesn't change anything before the offseason heal clears state).
  const playoffResult = runPlayoffs(seasonPrng.fork('playoffs'), leagueAfterRegSeason);

  return {
    ...leagueAfterRegSeason,
    players: playoffResult.players as typeof league.players,
    schedule: { ...regularSeasonComplete, playoffs: playoffResult.playoffs },
  };
}

/**
 * Apply a batch of mid-season IR moves to the teams map. Each move
 * removes the player from `rosterIds` and appends them to
 * `injuredReserveIds`. Players already on IR or no longer on the
 * given team's roster are skipped (defensive — shouldn't happen
 * under normal flow but keeps the helper resilient).
 */
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

