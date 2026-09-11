/**
 * `leagueView` — the game-safe projection of standings, schedule, and results
 * (GAME_UI_FOUNDATION.md D1; the season hub reads this and nothing else).
 *
 * This surface is almost entirely **public world facts** in the sense
 * GAME_UI_FOUNDATION.md §2 draws the line: standings, schedules, scores, team
 * box scores, injury reports, and who won the Super Bowl are things anybody in
 * the world can read in a newspaper. Public facts pass through verbatim — the
 * knowledge layer's job is not to obscure them, it is to make sure nothing
 * ELSE rides along.
 *
 * Two things are deliberately dropped on the way through:
 *
 *   - `GameResult.variance` ('controlled' | 'moderate' | 'pure'). This is an
 *     engine-internal description of how much the dice mattered, not a fact
 *     about the football world. No one in the league knows a game was decided
 *     by "pure" variance; surfacing it would let a player read the simulation
 *     instead of the sport, which is precisely the failure the North Star
 *     exists to prevent.
 *   - `TeamState` itself. The view carries team IDENTITY (name, abbreviation,
 *     conference, division) and nothing else off the team record — identity is
 *     public, and everything else on `TeamState` is ground truth by CLAUDE.md's
 *     own annotation of that type.
 *
 * There are no ratings, potentials, or grades anywhere in this file's output
 * by construction: it reads `season/standings.ts` (pure win/loss arithmetic)
 * and `ScheduledGame` (scores and box scores), neither of which touches the
 * player-ratings model at all.
 */

import type { LeagueState } from '../types/league.js';
import type { TeamId, GameId, PlayerId } from '../types/ids.js';
import type { Conference, Division } from '../types/enums.js';
import type { GameKind, ScheduledGame, TeamGameStats, GameInjury } from '../types/game.js';
import type { PlayerGameStats } from '../types/stats.js';
import { computeRecords, divisionStandings, playoffSeeds, winPct } from '../season/standings.js';

/** Public identity of a club — the part of `TeamState` anyone may see. */
export interface TeamIdentityView {
  teamId: TeamId;
  abbreviation: string;
  location: string;
  nickname: string;
  fullName: string;
  conference: Conference;
  division: Division;
}

/** A club's public record. Every field is newspaper-standings material. */
export interface TeamRecordView extends TeamIdentityView {
  wins: number;
  losses: number;
  ties: number;
  /** Ties count as half a win, the way the league does it. */
  winPct: number;
  pointsFor: number;
  pointsAgainst: number;
  divisionWins: number;
  divisionLosses: number;
  conferenceWins: number;
  conferenceLosses: number;
}

export interface DivisionStandingsView {
  division: Division;
  /** Sorted by the engine's tiebreaker order. */
  teams: readonly TeamRecordView[];
}

export interface ConferenceSeedsView {
  conference: Conference;
  /** Seeds 1-7 in order; empty until enough games have been played. */
  seeds: readonly TeamRecordView[];
}

/** A completed game's public result. Note the absent `variance`. */
export interface GameResultView {
  homeScore: number;
  awayScore: number;
  homeStats: TeamGameStats;
  awayStats: TeamGameStats;
  injuries: readonly GameInjury[];
  /** Present for bottom-up games; the emergent box score. */
  playerStats?: readonly PlayerGameStats[];
  /** Clubs that had to start a non-QB. Visible to anyone watching. */
  emergencyQb?: { home?: PlayerId; away?: PlayerId };
}

export interface ScheduledGameView {
  gameId: GameId;
  weekNumber: number;
  kind: GameKind;
  home: TeamIdentityView;
  away: TeamIdentityView;
  /** Null until the game is played. */
  result: GameResultView | null;
}

export interface PlayoffBracketView {
  wildCard: readonly ScheduledGameView[];
  divisional: readonly ScheduledGameView[];
  conference: readonly ScheduledGameView[];
  superBowl: readonly ScheduledGameView[];
  champion: TeamIdentityView | null;
}

export interface LeagueView {
  seasonNumber: number;
  /** Where the league year currently sits. */
  lifecyclePhase: string;
  /** In-season week, or null outside the regular season. */
  currentWeek: number | null;
  standings: readonly DivisionStandingsView[];
  playoffSeeds: readonly ConferenceSeedsView[];
  /** Regular season by week; index 0 is week 1. */
  weeks: readonly (readonly ScheduledGameView[])[];
  playoffs: PlayoffBracketView | null;
}

function identityView(league: LeagueState, teamId: TeamId): TeamIdentityView | null {
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

/**
 * Project one game. `variance` is dropped here — see the file header; this is
 * the single place that stripping happens, so it cannot be forgotten by a
 * caller assembling a box score later.
 */
function gameView(league: LeagueState, game: ScheduledGame): ScheduledGameView | null {
  const home = identityView(league, game.homeTeamId);
  const away = identityView(league, game.awayTeamId);
  if (!home || !away) return null;

  let result: GameResultView | null = null;
  if (game.result) {
    const r = game.result;
    result = {
      homeScore: r.homeScore,
      awayScore: r.awayScore,
      homeStats: r.homeStats,
      awayStats: r.awayStats,
      injuries: r.injuries,
      ...(r.playerStats ? { playerStats: r.playerStats } : {}),
      ...(r.emergencyQb ? { emergencyQb: r.emergencyQb } : {}),
    };
  }

  return {
    gameId: game.id,
    weekNumber: game.weekNumber,
    kind: game.kind,
    home,
    away,
    result,
  };
}

/**
 * The whole league as a game UI may see it: standings, the bracket picture,
 * and every scheduled/played game. Cheap enough to recompute per render at
 * 32-team scale (`computeRecords` walks completed games and is itself
 * documented as uncached-by-design).
 */
export function leagueView(league: LeagueState): LeagueView {
  const records = computeRecords(league);

  const toRecordView = (teamId: TeamId): TeamRecordView | null => {
    const identity = identityView(league, teamId);
    const r = records.get(teamId);
    if (!identity || !r) return null;
    return {
      ...identity,
      wins: r.wins,
      losses: r.losses,
      ties: r.ties,
      winPct: winPct(r),
      pointsFor: r.pointsFor,
      pointsAgainst: r.pointsAgainst,
      divisionWins: r.divisionWins,
      divisionLosses: r.divisionLosses,
      conferenceWins: r.conferenceWins,
      conferenceLosses: r.conferenceLosses,
    };
  };

  const standings: DivisionStandingsView[] = [];
  for (const [division, recs] of divisionStandings(league, records)) {
    standings.push({
      division,
      teams: recs.map((r) => toRecordView(r.teamId)).filter((v): v is TeamRecordView => v !== null),
    });
  }

  const seedsByConference = playoffSeeds(league, records);
  const seedViews: ConferenceSeedsView[] = Object.entries(seedsByConference).map(
    ([conference, recs]) => ({
      conference: conference as Conference,
      seeds: recs.map((r) => toRecordView(r.teamId)).filter((v): v is TeamRecordView => v !== null),
    }),
  );

  const project = (games: readonly ScheduledGame[]): ScheduledGameView[] =>
    games.map((g) => gameView(league, g)).filter((v): v is ScheduledGameView => v !== null);

  const weeks = (league.schedule?.regularSeason ?? []).map(project);

  let playoffs: PlayoffBracketView | null = null;
  const p = league.schedule?.playoffs;
  if (p) {
    playoffs = {
      wildCard: project(p.wildCard),
      divisional: project(p.divisional),
      conference: project(p.conference),
      superBowl: project(p.superBowl),
      champion: p.championId ? identityView(league, p.championId) : null,
    };
  }

  return {
    seasonNumber: league.seasonNumber,
    lifecyclePhase: league.lifecyclePhase,
    currentWeek: league.currentWeek,
    standings,
    playoffSeeds: seedViews,
    weeks,
    playoffs,
  };
}
