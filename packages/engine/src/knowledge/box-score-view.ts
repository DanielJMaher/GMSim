/**
 * `boxScoreView` — the broadsheet page (GAME_UI_FOUNDATION.md D1).
 *
 * A box score is the most purely PUBLIC artefact in the sport: it is printed in
 * the paper the next morning. Everything here passes through verbatim. The only
 * work the boundary does is the join — `PlayerGameStats` carries a `playerId`,
 * and turning that into a readable line means touching `Player`, which is
 * ground truth. So the join projects **name and position only**; nothing else
 * off the player record is copied, and the leak gate scans for the rest.
 *
 * ## There is no `driveLogView`, and the reason is measured
 *
 * Drive logs are NOT persisted: `GameResult` stores scores, team stats,
 * injuries and per-player lines, while the drive-by-drive log lives only on
 * `DriveGameResult`, the sim's return value, which is discarded. The Game Lab
 * shows drives by re-simulating, but it is a LAB — it sims hypothetical
 * matchups against current rosters and never claims to replay a game that
 * happened.
 *
 * A replay's SEED is derivable (`${seed}::season-${N}` forked by `week-${W}`
 * then the game id). The league STATE at kickoff is not: injuries propagate,
 * players move to IR, rosters change. So a replay runs the right dice against
 * the wrong personnel.
 *
 * A self-verifying version was built and measured before being removed — replay
 * the game, compare the replayed score to the recorded score, and return a
 * chart only on a match. Across a full simulated season it reproduced
 * **2 of 272 games (0.7%)**, and score equality is weak evidence besides: two
 * different games can land on the same final score, so even those two are more
 * likely coincidences than faithful replays. A chart that appears almost never
 * and may be wrong when it does is worse than no chart.
 *
 * This also corrects `GAME_UI_FOUNDATION.md` §5, which assumes game results are
 * re-simmable from (matchup id × seed) and builds the alpha triage flow on it.
 * Measured: they are not.
 *
 * A real drive chart therefore requires persisting the drive log on
 * `GameResult` (~240KB per season) — a save-format change, and a deliberate
 * decision rather than something to slip in behind a view.
 */

import type { LeagueState } from '../types/league.js';
import type { GameId, PlayerId, TeamId } from '../types/ids.js';
import type { Position } from '../types/enums.js';
import type { GameKind, ScheduledGame, TeamGameStats, GameInjury } from '../types/game.js';
import type { PlayerGameStats } from '../types/stats.js';
import type { TeamIdentityView } from './league-view.js';

/** One player's line, with only the stat groups he actually recorded. */
export interface BoxScoreLineView {
  playerId: PlayerId;
  firstName: string;
  lastName: string;
  position: Position;
  /** The club he accrued this line with — stats outlive roster membership. */
  teamId: TeamId | null;
  passing?: {
    attempts: number;
    completions: number;
    yards: number;
    touchdowns: number;
    interceptions: number;
    explosiveCompletions: number;
  };
  rushing?: { attempts: number; yards: number; touchdowns: number };
  receiving?: { targets: number; receptions: number; yards: number; touchdowns: number };
  defense?: { tackles: number; sacks: number; interceptions: number; fumblesLost: number };
  kicking?: {
    fieldGoalsMade: number;
    fieldGoalsAttempted: number;
    extraPointsMade: number;
    punts: number;
    puntYards: number;
    returnYards: number;
  };
}

export interface BoxScoreView {
  gameId: GameId;
  weekNumber: number;
  kind: GameKind;
  home: TeamIdentityView;
  away: TeamIdentityView;
  homeScore: number;
  awayScore: number;
  homeStats: TeamGameStats;
  awayStats: TeamGameStats;
  injuries: readonly GameInjury[];
  /** Player lines, home club first, each club ordered by involvement. */
  homeLines: readonly BoxScoreLineView[];
  awayLines: readonly BoxScoreLineView[];
  /** Clubs that had to start a non-QB. Visible to anyone watching. */
  emergencyQb?: { home?: PlayerId; away?: PlayerId };
}

function identityOf(league: LeagueState, teamId: TeamId): TeamIdentityView | null {
  const team = league.teams[teamId];
  if (!team) return null;
  const id = team.identity;
  return {
    teamId: id.id,
    abbreviation: id.abbreviation,
    location: id.location,
    nickname: id.nickname,
    fullName: id.fullName,
    conference: id.conference,
    division: id.division,
  };
}

/** Find a scheduled game anywhere in the season — regular season or playoffs. */
export function findScheduledGame(league: LeagueState, gameId: GameId): ScheduledGame | null {
  const schedule = league.schedule;
  if (!schedule) return null;
  for (const week of schedule.regularSeason) {
    for (const g of week) if (g.id === gameId) return g;
  }
  const p = schedule.playoffs;
  if (p) {
    for (const round of [p.wildCard, p.divisional, p.conference, p.superBowl]) {
      for (const g of round) if (g.id === gameId) return g;
    }
  }
  return null;
}

const hasAny = (...ns: number[]): boolean => ns.some((n) => n !== 0);

/**
 * Project one stat line. Name and position are joined from `Player`; nothing
 * else off that record crosses. Stat groups are omitted entirely when the
 * player recorded nothing in them, so a UI can render only the rows that exist
 * rather than a wall of zeroes.
 */
function lineView(league: LeagueState, s: PlayerGameStats): BoxScoreLineView | null {
  const player = league.players[s.playerId];
  if (!player) return null;

  const line: BoxScoreLineView = {
    playerId: s.playerId,
    firstName: player.firstName,
    lastName: player.lastName,
    position: player.position,
    teamId: s.teamId ?? null,
  };

  if (hasAny(s.passAttempts, s.passingYards, s.passingTds, s.interceptionsThrown)) {
    line.passing = {
      attempts: s.passAttempts,
      completions: s.passCompletions,
      yards: s.passingYards,
      touchdowns: s.passingTds,
      interceptions: s.interceptionsThrown,
      explosiveCompletions: s.explosiveCompletions,
    };
  }
  if (hasAny(s.rushingAttempts, s.rushingYards, s.rushingTds)) {
    line.rushing = {
      attempts: s.rushingAttempts,
      yards: s.rushingYards,
      touchdowns: s.rushingTds,
    };
  }
  if (hasAny(s.targets, s.receptions, s.receivingYards, s.receivingTds)) {
    line.receiving = {
      targets: s.targets,
      receptions: s.receptions,
      yards: s.receivingYards,
      touchdowns: s.receivingTds,
    };
  }
  if (hasAny(s.tackles, s.sacks, s.interceptions, s.fumblesLost)) {
    line.defense = {
      tackles: s.tackles,
      sacks: s.sacks,
      interceptions: s.interceptions,
      fumblesLost: s.fumblesLost,
    };
  }
  if (
    hasAny(
      s.fieldGoalsAttempted,
      s.fieldGoalsMade,
      s.extraPointsMade,
      s.punts,
      s.puntYards,
      s.returnYards,
    )
  ) {
    line.kicking = {
      fieldGoalsMade: s.fieldGoalsMade,
      fieldGoalsAttempted: s.fieldGoalsAttempted,
      extraPointsMade: s.extraPointsMade,
      punts: s.punts,
      puntYards: s.puntYards,
      returnYards: s.returnYards,
    };
  }
  return line;
}

/** Rough involvement score, so the biggest contributors head the agate column. */
function involvement(l: BoxScoreLineView): number {
  return (
    (l.passing?.yards ?? 0) +
    (l.rushing?.yards ?? 0) * 2 +
    (l.receiving?.yards ?? 0) * 2 +
    (l.defense?.tackles ?? 0) * 10 +
    (l.defense?.sacks ?? 0) * 25 +
    (l.kicking?.fieldGoalsMade ?? 0) * 20
  );
}

/** The published box score for one played game, or null if it hasn't been played. */
export function boxScoreView(league: LeagueState, gameId: GameId): BoxScoreView | null {
  const game = findScheduledGame(league, gameId);
  if (!game || !game.result) return null;

  const home = identityOf(league, game.homeTeamId);
  const away = identityOf(league, game.awayTeamId);
  if (!home || !away) return null;

  const lines = (game.result.playerStats ?? [])
    .map((s) => lineView(league, s))
    .filter((l): l is BoxScoreLineView => l !== null);

  const byTeam = (teamId: TeamId): BoxScoreLineView[] =>
    lines.filter((l) => l.teamId === teamId).sort((a, b) => involvement(b) - involvement(a));

  const view: BoxScoreView = {
    gameId: game.id,
    weekNumber: game.weekNumber,
    kind: game.kind,
    home,
    away,
    homeScore: game.result.homeScore,
    awayScore: game.result.awayScore,
    homeStats: game.result.homeStats,
    awayStats: game.result.awayStats,
    injuries: game.result.injuries,
    homeLines: byTeam(game.homeTeamId),
    awayLines: byTeam(game.awayTeamId),
  };
  if (game.result.emergencyQb) view.emergencyQb = game.result.emergencyQb;
  return view;
}
