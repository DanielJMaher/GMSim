import type { LeagueState } from '../types/league.js';
import type { ScheduledGame, PlayoffsState } from '../types/game.js';
import type { Prng } from '../prng/index.js';
import { simulateGame } from '../games/outcome.js';
import { computeRecords, playoffSeeds } from './standings.js';
import { Conference } from '../types/enums.js';
import type { TeamRecord } from './standings.js';

/**
 * Run the full playoff bracket: Wild Card → Divisional → Conference →
 * Super Bowl. Higher seed hosts; Super Bowl is at a neutral site.
 *
 * Mutates a copy of league state — callers should pass the league after
 * the regular season completes and merge the returned PlayoffsState
 * back into `league.schedule.playoffs`.
 */
export function runPlayoffs(prng: Prng, league: LeagueState): PlayoffsState {
  const records = computeRecords(league);
  const seeds = playoffSeeds(league, records);

  // ─── Wild Card round ────────────────────────────────────────────────
  // Seeds 2v7, 3v6, 4v5 in each conference. Seed 1 has a bye.
  const wildCard: ScheduledGame[] = [];
  for (const conf of Object.values(Conference)) {
    const confSeeds = seeds[conf];
    if (confSeeds.length < 7) continue;
    wildCard.push(playGame(prng.fork(`wc-${conf}-2v7`), league, confSeeds[1]!, confSeeds[6]!, 'WILD_CARD'));
    wildCard.push(playGame(prng.fork(`wc-${conf}-3v6`), league, confSeeds[2]!, confSeeds[5]!, 'WILD_CARD'));
    wildCard.push(playGame(prng.fork(`wc-${conf}-4v5`), league, confSeeds[3]!, confSeeds[4]!, 'WILD_CARD'));
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
      playGame(
        prng.fork(`div-${conf}-1vlow`),
        league,
        remainingBySeed[0]!,
        remainingBySeed[remainingBySeed.length - 1]!,
        'DIVISIONAL',
      ),
    );
    divisional.push(
      playGame(
        prng.fork(`div-${conf}-mid`),
        league,
        remainingBySeed[1]!,
        remainingBySeed[2]!,
        'DIVISIONAL',
      ),
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
      playGame(
        prng.fork(`conf-${conf}`),
        league,
        sortedWinners[0]!,
        sortedWinners[1]!,
        'CONFERENCE',
      ),
    );
  }

  // ─── Super Bowl ─────────────────────────────────────────────────────
  const conferenceWinners = conference
    .map((g) => winnerRecord(g, records))
    .filter((r): r is TeamRecord => r !== null);
  const superBowl: ScheduledGame[] = [];
  let championId: PlayoffsState['championId'] = null;
  if (conferenceWinners.length === 2) {
    const game = playGame(
      prng.fork('sb'),
      league,
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
    wildCard,
    divisional,
    conference,
    superBowl,
    championId,
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

