import type { LeagueState } from '../types/league.js';
import type { ScheduledGame, PlayoffsState } from '../types/game.js';
import type { Player } from '../types/player.js';
import type { Prng } from '../prng/index.js';
import { simulateGame } from '../games/outcome.js';
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

/**
 * Run the full playoff bracket: Wild Card → Divisional → Conference →
 * Super Bowl. Higher seed hosts; Super Bowl is at a neutral site.
 *
 * Returns the played bracket plus an updated player map. Per-game
 * injuries are propagated onto `Player.injury` so the inspector and
 * the offseason heal both see playoff outcomes consistently.
 */
export function runPlayoffs(prng: Prng, league: LeagueState): RunPlayoffsResult {
  const records = computeRecords(league);
  const seeds = playoffSeeds(league, records);
  let players: Record<string, Player> = league.players as Record<string, Player>;

  function play(
    forkLabel: string,
    higherSeed: TeamRecord,
    lowerSeed: TeamRecord,
    kind: ScheduledGame['kind'],
    neutralSite = false,
  ): ScheduledGame {
    const leagueWithLatestPlayers: LeagueState = { ...league, players };
    const game = playGame(prng.fork(forkLabel), leagueWithLatestPlayers, higherSeed, lowerSeed, kind, neutralSite);
    if (game.result?.injuries.length) {
      const occurredOnTick = league.tick + (PLAYOFF_TICK_OFFSET[kind] ?? 17);
      const updates: Record<string, Player> = {};
      for (const inj of game.result.injuries) {
        const p = players[inj.playerId];
        if (!p) continue;
        updates[inj.playerId] = {
          ...p,
          injury: {
            type: inj.type,
            severity: inj.severity,
            occurredOnTick,
            estimatedReturnTick: occurredOnTick + inj.weeksOut,
          },
        };
      }
      if (Object.keys(updates).length > 0) {
        players = { ...players, ...updates };
      }
    }
    return game;
  }

  // ─── Wild Card round ────────────────────────────────────────────────
  // Seeds 2v7, 3v6, 4v5 in each conference. Seed 1 has a bye.
  const wildCard: ScheduledGame[] = [];
  for (const conf of Object.values(Conference)) {
    const confSeeds = seeds[conf];
    if (confSeeds.length < 7) continue;
    wildCard.push(play(`wc-${conf}-2v7`, confSeeds[1]!, confSeeds[6]!, 'WILD_CARD'));
    wildCard.push(play(`wc-${conf}-3v6`, confSeeds[2]!, confSeeds[5]!, 'WILD_CARD'));
    wildCard.push(play(`wc-${conf}-4v5`, confSeeds[3]!, confSeeds[4]!, 'WILD_CARD'));
  }

  // ─── Divisional round ───────────────────────────────────────────────
  // Seed 1 hosts the lowest remaining seed; other two remaining seeds play.
  const divisional: ScheduledGame[] = [];
  for (const conf of Object.values(Conference)) {
    const confSeeds = seeds[conf];
    if (confSeeds.length < 7) continue;
    const wcWinners = wildCardWinners(wildCard, conf, league);
    const remaining = [confSeeds[0]!, ...wcWinners];
    // Re-sort by original seed
    const remainingBySeed = remaining
      .map((r) => ({ r, seed: confSeeds.indexOf(r) }))
      .sort((a, b) => a.seed - b.seed)
      .map((x) => x.r);
    if (remainingBySeed.length < 4) continue;
    divisional.push(
      play(
        `div-${conf}-1vlow`,
        remainingBySeed[0]!,
        remainingBySeed[remainingBySeed.length - 1]!,
        'DIVISIONAL',
      ),
    );
    divisional.push(
      play(`div-${conf}-mid`, remainingBySeed[1]!, remainingBySeed[2]!, 'DIVISIONAL'),
    );
  }

  // ─── Conference championships ───────────────────────────────────────
  const conference: ScheduledGame[] = [];
  for (const conf of Object.values(Conference)) {
    const confDivisional = divisional.filter((g) => isConferenceGame(g, conf, league));
    const winners = confDivisional
      .map((g) => winnerRecord(g, records))
      .filter((r): r is TeamRecord => r !== null);
    if (winners.length < 2) continue;
    const sortedWinners = winners.sort(
      (a, b) =>
        seeds[conf].indexOf(a) - seeds[conf].indexOf(b),
    );
    conference.push(
      play(`conf-${conf}`, sortedWinners[0]!, sortedWinners[1]!, 'CONFERENCE'),
    );
  }

  // ─── Super Bowl ─────────────────────────────────────────────────────
  const conferenceWinners = conference
    .map((g) => winnerRecord(g, records))
    .filter((r): r is TeamRecord => r !== null);
  const superBowl: ScheduledGame[] = [];
  let championId: PlayoffsState['championId'] = null;
  if (conferenceWinners.length === 2) {
    const game = play(
      'sb',
      conferenceWinners[0]!,
      conferenceWinners[1]!,
      'SUPER_BOWL',
      true,
    );
    superBowl.push(game);
    if (game.result) {
      championId =
        game.result.homeScore > game.result.awayScore
          ? game.homeTeamId
          : game.awayTeamId;
    }
  }

  return {
    playoffs: {
      wildCard,
      divisional,
      conference,
      superBowl,
      championId,
    },
    players,
  };
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
    game.result.homeScore > game.result.awayScore
      ? game.homeTeamId
      : game.awayTeamId;
  return records.get(winnerId) ?? null;
}

