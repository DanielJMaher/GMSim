import type { LeagueState } from '../types/league.js';
import type { ScheduledGame, PlayoffsState } from '../types/game.js';
import type { Player } from '../types/player.js';
import type { TeamId } from '../types/ids.js';
import type { Prng } from '../prng/index.js';
import { simulateGame } from '../games/outcome.js';
import { applyInjuryScar } from '../players/aging-curves.js';
import { computeRecords, playoffSeeds } from './standings.js';
import { Conference } from '../types/enums.js';
import type { TeamRecord } from './standings.js';

/** First playoff week is one tick after the 17-week regular season. */
const PLAYOFF_TICK_OFFSET: Partial<Record<ScheduledGame['kind'], number>> = {
  WILD_CARD: 17,
  DIVISIONAL: 18,
  CONFERENCE: 19,
  SUPER_BOWL: 20,
};

export interface RunPlayoffsResult {
  /** The played-through playoff bracket. */
  playoffs: PlayoffsState;
  /** Updated player map with playoff-game injuries propagated onto Player.injury. */
  players: Record<string, Player>;
}

export interface PlayRoundResult {
  /** Games played this round. */
  games: readonly ScheduledGame[];
  /** Player map with this round's injuries propagated. */
  players: Record<string, Player>;
}

export interface PlaySuperBowlResult extends PlayRoundResult {
  /** Champion's team id, or null if the Super Bowl didn't fire (insufficient seeds). */
  championId: TeamId | null;
}

/**
 * Play the wild card round: seeds 2v7, 3v6, 4v5 in each conference.
 * Seed 1 has a bye.
 *
 * `prng` is the per-round PRNG (typically `seasonPrng.fork('playoffs')`
 * — same root used by every round so v0.55 fork labels still resolve
 * to the same streams).
 */
export function playWildCardRound(prng: Prng, league: LeagueState): PlayRoundResult {
  const records = computeRecords(league);
  const seeds = playoffSeeds(league, records);
  let players: Record<string, Player> = league.players as Record<string, Player>;
  const games: ScheduledGame[] = [];

  for (const conf of Object.values(Conference)) {
    const confSeeds = seeds[conf];
    if (confSeeds.length < 7) continue;
    const matchups: Array<[TeamRecord, TeamRecord, string]> = [
      [confSeeds[1]!, confSeeds[6]!, `wc-${conf}-2v7`],
      [confSeeds[2]!, confSeeds[5]!, `wc-${conf}-3v6`],
      [confSeeds[3]!, confSeeds[4]!, `wc-${conf}-4v5`],
    ];
    for (const [higher, lower, label] of matchups) {
      const r = playMatchup(prng, league, players, higher, lower, 'WILD_CARD', false, label);
      games.push(r.game);
      players = r.players;
    }
  }

  return { games, players };
}

/**
 * Play the divisional round. Reads wild-card winners from
 * `league.schedule.playoffs.wildCard` to assemble the bracket. Seed 1
 * hosts the lowest remaining seed; other two remaining seeds play.
 */
export function playDivisionalRound(prng: Prng, league: LeagueState): PlayRoundResult {
  const wildCard = league.schedule?.playoffs?.wildCard ?? [];
  const records = computeRecords(league);
  const seeds = playoffSeeds(league, records);
  let players: Record<string, Player> = league.players as Record<string, Player>;
  const games: ScheduledGame[] = [];

  for (const conf of Object.values(Conference)) {
    const confSeeds = seeds[conf];
    if (confSeeds.length < 7) continue;
    const wcWinners = wildCardWinners(wildCard, conf, league);
    const remaining = [confSeeds[0]!, ...wcWinners];
    const remainingBySeed = remaining
      .map((r) => ({ r, seed: confSeeds.indexOf(r) }))
      .sort((a, b) => a.seed - b.seed)
      .map((x) => x.r);
    if (remainingBySeed.length < 4) continue;
    const matchups: Array<[TeamRecord, TeamRecord, string]> = [
      [remainingBySeed[0]!, remainingBySeed[remainingBySeed.length - 1]!, `div-${conf}-1vlow`],
      [remainingBySeed[1]!, remainingBySeed[2]!, `div-${conf}-mid`],
    ];
    for (const [higher, lower, label] of matchups) {
      const r = playMatchup(prng, league, players, higher, lower, 'DIVISIONAL', false, label);
      games.push(r.game);
      players = r.players;
    }
  }

  return { games, players };
}

/**
 * Play the conference championships. Reads divisional winners from
 * `league.schedule.playoffs.divisional`.
 */
export function playConferenceRound(prng: Prng, league: LeagueState): PlayRoundResult {
  const divisional = league.schedule?.playoffs?.divisional ?? [];
  const records = computeRecords(league);
  const seeds = playoffSeeds(league, records);
  let players: Record<string, Player> = league.players as Record<string, Player>;
  const games: ScheduledGame[] = [];

  for (const conf of Object.values(Conference)) {
    const confDivisional = divisional.filter((g) => isConferenceGame(g, conf, league));
    const winners = confDivisional
      .map((g) => winnerRecord(g, records))
      .filter((r): r is TeamRecord => r !== null);
    if (winners.length < 2) continue;
    const sortedWinners = winners.sort((a, b) => seeds[conf].indexOf(a) - seeds[conf].indexOf(b));
    const r = playMatchup(prng, league, players, sortedWinners[0]!, sortedWinners[1]!, 'CONFERENCE', false, `conf-${conf}`);
    games.push(r.game);
    players = r.players;
  }

  return { games, players };
}

/**
 * Play the Super Bowl. Reads conference winners from
 * `league.schedule.playoffs.conference`. Neutral site. Returns the
 * champion id, or null if the bracket was incomplete (e.g., a
 * conference produced fewer than 2 divisional winners).
 */
export function playSuperBowlRound(prng: Prng, league: LeagueState): PlaySuperBowlResult {
  const conferenceGames = league.schedule?.playoffs?.conference ?? [];
  const records = computeRecords(league);
  let players: Record<string, Player> = league.players as Record<string, Player>;
  const games: ScheduledGame[] = [];
  let championId: TeamId | null = null;

  const conferenceWinners = conferenceGames
    .map((g) => winnerRecord(g, records))
    .filter((r): r is TeamRecord => r !== null);
  if (conferenceWinners.length === 2) {
    const r = playMatchup(
      prng,
      league,
      players,
      conferenceWinners[0]!,
      conferenceWinners[1]!,
      'SUPER_BOWL',
      true,
      'sb',
    );
    games.push(r.game);
    players = r.players;
    if (r.game.result) {
      championId =
        r.game.result.homeScore > r.game.result.awayScore
          ? r.game.homeTeamId
          : r.game.awayTeamId;
    }
  }

  return { games, players, championId };
}

/**
 * Run the full playoff bracket: Wild Card → Divisional → Conference →
 * Super Bowl. Higher seed hosts; Super Bowl is at a neutral site.
 *
 * Returns the played bracket plus an updated player map. Per-game
 * injuries are propagated onto `Player.injury` so the inspector and
 * the offseason heal both see playoff outcomes consistently.
 *
 * v0.56+ this is a thin wrapper that chains the four per-round
 * helpers. The v0.56 lifecycle splits each round into its own
 * `tickPhase` so the inspector can step through rounds individually.
 */
export function runPlayoffs(prng: Prng, league: LeagueState): RunPlayoffsResult {
  let players: Record<string, Player> = league.players as Record<string, Player>;
  let playoffs: PlayoffsState = {
    wildCard: [],
    divisional: [],
    conference: [],
    superBowl: [],
    championId: null,
  };

  const wc = playWildCardRound(prng, league);
  players = wc.players;
  playoffs = { ...playoffs, wildCard: wc.games };

  const div = playDivisionalRound(prng, withSchedulePlayoffs(league, players, playoffs));
  players = div.players;
  playoffs = { ...playoffs, divisional: div.games };

  const conf = playConferenceRound(prng, withSchedulePlayoffs(league, players, playoffs));
  players = conf.players;
  playoffs = { ...playoffs, conference: conf.games };

  const sb = playSuperBowlRound(prng, withSchedulePlayoffs(league, players, playoffs));
  players = sb.players;
  playoffs = { ...playoffs, superBowl: sb.games, championId: sb.championId };

  return { playoffs, players };
}

function withSchedulePlayoffs(
  league: LeagueState,
  players: Record<string, Player>,
  playoffs: PlayoffsState,
): LeagueState {
  if (!league.schedule) {
    throw new Error('runPlayoffs: league.schedule must be populated');
  }
  return {
    ...league,
    players: players as typeof league.players,
    schedule: { ...league.schedule, playoffs },
  };
}

function playMatchup(
  prng: Prng,
  league: LeagueState,
  players: Record<string, Player>,
  higherSeed: TeamRecord,
  lowerSeed: TeamRecord,
  kind: ScheduledGame['kind'],
  neutralSite: boolean,
  forkLabel: string,
): { game: ScheduledGame; players: Record<string, Player> } {
  const leagueWithLatestPlayers: LeagueState = {
    ...league,
    players: players as typeof league.players,
  };
  const game = playGame(
    prng.fork(forkLabel),
    leagueWithLatestPlayers,
    higherSeed,
    lowerSeed,
    kind,
    neutralSite,
  );
  let nextPlayers = players;
  if (game.result?.injuries.length) {
    const occurredOnTick = league.tick + (PLAYOFF_TICK_OFFSET[kind] ?? 17);
    const updates: Record<string, Player> = {};
    for (const inj of game.result.injuries) {
      const p = players[inj.playerId];
      if (!p) continue;
      // S5: MAJOR injuries permanently scar the body (see applyInjuryScar).
      const scarred = inj.severity === 'MAJOR' ? applyInjuryScar(p, occurredOnTick) : p;
      updates[inj.playerId] = {
        ...scarred,
        injury: {
          type: inj.type,
          severity: inj.severity,
          occurredOnTick,
          estimatedReturnTick: occurredOnTick + inj.weeksOut,
        },
      };
    }
    if (Object.keys(updates).length > 0) {
      nextPlayers = { ...players, ...updates };
    }
  }
  return { game, players: nextPlayers };
}

function playGame(
  prng: Prng,
  league: LeagueState,
  higherSeed: TeamRecord,
  lowerSeed: TeamRecord,
  kind: ScheduledGame['kind'],
  neutralSite = false,
): ScheduledGame {
  const home = league.teams[higherSeed.teamId]!;
  const away = league.teams[lowerSeed.teamId]!;
  return simulateGame(prng, {
    homeTeam: home,
    awayTeam: away,
    league,
    weekNumber: weekForKind(kind),
    kind,
    neutralSite,
  });
}

function weekForKind(kind: ScheduledGame['kind']): number {
  switch (kind) {
    case 'WILD_CARD':
      return 19;
    case 'DIVISIONAL':
      return 20;
    case 'CONFERENCE':
      return 21;
    case 'SUPER_BOWL':
      return 22;
    default:
      return 0;
  }
}

function wildCardWinners(
  wcGames: readonly ScheduledGame[],
  conference: Conference,
  league: LeagueState,
): TeamRecord[] {
  const records = computeRecords(league);
  return wcGames
    .filter((g) => isConferenceGame(g, conference, league))
    .map((g) => winnerRecord(g, records))
    .filter((r): r is TeamRecord => r !== null);
}

function isConferenceGame(
  game: ScheduledGame,
  conference: Conference,
  league: LeagueState,
): boolean {
  const home = league.teams[game.homeTeamId];
  return Boolean(home && home.identity.conference === conference);
}

function winnerRecord(
  game: ScheduledGame,
  records: Map<TeamRecord['teamId'], TeamRecord>,
): TeamRecord | null {
  if (!game.result) return null;
  const winnerId =
    game.result.homeScore > game.result.awayScore ? game.homeTeamId : game.awayTeamId;
  return records.get(winnerId) ?? null;
}
