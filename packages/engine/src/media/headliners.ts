/**
 * Game-headliner extraction (v0.62.1).
 *
 * Given a played game + the league state, surface 0-N standout
 * player performances per side ("the QB threw for 400", "the LB had
 * 3 sacks", "the QB threw 3 picks"). Headliners drive the
 * player-named templates so headlines READ like
 * "Mendoza throws for 400 as Raiders steamroll Patriots" rather
 * than generic team-action copy.
 *
 * Thresholds are tuned conservatively — only genuinely
 * headline-worthy performances qualify, so player-named templates
 * fire when there's a real story to tell.
 */

import type { LeagueState } from '../types/league.js';
import type { ScheduledGame } from '../types/game.js';
import type { PlayerGameStats } from '../types/stats.js';
import type { PlayerId, TeamId } from '../types/ids.js';
import type { Player } from '../types/player.js';
import { deriveGamePlayerStats } from '../games/stats.js';

/**
 * Week-relative leader set (v0.62.1). Computed once per
 * `generateWeeklyMediaReports` call from ALL games in the week, then
 * passed to each game's `extractHeadliners`. Gates the
 * "top-performer-relative" headliner kinds: a player must BOTH clear
 * the static threshold AND be in the week's leader set to get a
 * player-driven headline.
 *
 * Adapts to whatever the stat distribution actually is. If the
 * engine's per-game passing yards are running unusually low this
 * season, the "top 2 passers of the week" set still surfaces real
 * leaders — and the static minimum prevents the leader from being
 * trivially bad ("nobody passed 250 this week so no QB headliners").
 */
export interface WeekStatLeaders {
  topPassYards: ReadonlySet<PlayerId>;
  topRushYards: ReadonlySet<PlayerId>;
  topRecYards: ReadonlySet<PlayerId>;
  topPassTds: ReadonlySet<PlayerId>;
  topSacks: ReadonlySet<PlayerId>;
  topInts: ReadonlySet<PlayerId>;
}

const EMPTY_LEADERS: WeekStatLeaders = {
  topPassYards: new Set(),
  topRushYards: new Set(),
  topRecYards: new Set(),
  topPassTds: new Set(),
  topSacks: new Set(),
  topInts: new Set(),
};

/**
 * Build the week's leader set from the full set of per-game stat lines.
 * Picks top-K (default 3) per category. K is small enough that only
 * genuinely outlier performances qualify, but large enough that a
 * week typically surfaces 2-3 player-driven headlines per stat.
 */
export function computeWeekStatLeaders(
  allLines: readonly PlayerGameStats[],
  k: number = 3,
): WeekStatLeaders {
  if (allLines.length === 0) return EMPTY_LEADERS;
  return {
    topPassYards: topK(allLines, k, (l) => l.passingYards),
    topRushYards: topK(allLines, k, (l) => l.rushingYards),
    topRecYards: topK(allLines, k, (l) => l.receivingYards),
    topPassTds: topK(allLines, k, (l) => l.passingTds),
    topSacks: topK(allLines, k, (l) => l.sacks),
    topInts: topK(allLines, k, (l) => l.interceptions),
  };
}

function topK(
  lines: readonly PlayerGameStats[],
  k: number,
  getter: (l: PlayerGameStats) => number,
): ReadonlySet<PlayerId> {
  const sorted = [...lines]
    .filter((l) => getter(l) > 0)
    .sort((a, b) => getter(b) - getter(a))
    .slice(0, k);
  return new Set(sorted.map((l) => l.playerId));
}

/** Kinds of headlining performance. Drives which template pool matches. */
export type HeadlinerKind =
  /** QB with 300+ passing yards in a win. */
  | 'qb-huge-win'
  /** QB with 400+ passing yards (regardless of W/L). */
  | 'qb-monster'
  /** QB with 3+ TD passes in a win. */
  | 'qb-multi-td'
  /** QB with 3+ INTs thrown in a loss. */
  | 'qb-blame-loss'
  /** QB with 300+ yards but team lost — "led an anemic offense" angle. */
  | 'qb-lead-loss'
  /** RB with 100+ rushing yards in a win. */
  | 'rb-big-win'
  /** RB with 150+ rushing yards (any result). */
  | 'rb-monster'
  /** WR/TE with 100+ receiving yards. */
  | 'wr-big-day'
  /** Defender with 3+ sacks. */
  | 'sack-storm'
  /** Defender with 2+ INTs. */
  | 'pick-storm'
  /** Team scored ≤10 points in a loss — "anemic offense" angle. */
  | 'anemic-loss';

export interface GameHeadliner {
  playerId: PlayerId;
  playerLastName: string;
  playerPosition: string;
  teamId: TeamId;
  kind: HeadlinerKind;
  /** Primary stat value (yards, sacks, picks, TDs). */
  stat: number;
  /**
   * Secondary stat slot for templates that want a second value.
   * E.g. for qb-huge-win we set this to TDs, for sack-storm we set
   * this to combined tackles, etc.
   */
  secondaryStat: number;
}

export interface GameHeadliners {
  winner: readonly GameHeadliner[];
  loser: readonly GameHeadliner[];
}

// Static MINIMUM thresholds. A player must clear these AND be in the
// week's leader set (for top-performer-relative kinds) to qualify.
// The leader-set gate prevents noise; the static gate prevents
// "leader" from meaning trivially bad in a quiet week.
const QB_HUGE_YDS = 300;
const QB_MONSTER_YDS = 400;
const QB_BLAME_INTS = 3;
const QB_MULTI_TD = 3;
const RB_BIG_YDS = 110;
const RB_MONSTER_YDS = 160;
const WR_BIG_YDS = 110;
const SACK_STORM = 3;
const PICK_STORM = 2;
const ANEMIC_POINTS = 10;

/**
 * Extract up to ~3 headliners per side from the just-played game.
 * Returns empty arrays when nothing reaches the headline threshold —
 * in which case the report pipeline falls back to team-action
 * templates.
 *
 * `leaders` gates the top-performer-relative kinds (qb-monster,
 * rb-big-win, etc.): even if a player clears the static threshold,
 * they must be in the week's leader set to fire one of those
 * headlines. Notable-incident kinds (qb-blame-loss, anemic-loss) are
 * threshold-only — a 4-INT game is news regardless of league-wide
 * passing volume that week.
 */
export function extractHeadliners(
  game: ScheduledGame,
  league: LeagueState,
  leaders: WeekStatLeaders = EMPTY_LEADERS,
): GameHeadliners {
  if (!game.result) return { winner: [], loser: [] };
  const stats = deriveGamePlayerStats(game, league);
  if (stats.length === 0) return { winner: [], loser: [] };

  const homeWon = game.result.homeScore > game.result.awayScore;
  const winnerId = (homeWon ? game.homeTeamId : game.awayTeamId) as TeamId;
  const loserId = (homeWon ? game.awayTeamId : game.homeTeamId) as TeamId;
  const lScore = homeWon ? game.result.awayScore : game.result.homeScore;

  const winnerHeadliners: GameHeadliner[] = [];
  const loserHeadliners: GameHeadliner[] = [];

  for (const line of stats) {
    const player = league.players[line.playerId];
    if (!player) continue;
    const onTeamId = player.teamId as TeamId | null;
    if (!onTeamId) continue;
    const isWinnerSide = onTeamId === winnerId;
    const isLoserSide = onTeamId === loserId;
    if (!isWinnerSide && !isLoserSide) continue;

    const headliner = classifyLine(player, line, isWinnerSide, isLoserSide, leaders);
    if (!headliner) continue;
    if (isWinnerSide) winnerHeadliners.push(headliner);
    else loserHeadliners.push(headliner);
  }

  // Anemic-offense angle attaches to the loser's QB (if any) when the
  // team's total points are ≤ ANEMIC_POINTS. Surfaces only if the
  // QB didn't already qualify for a worse headliner (e.g.,
  // qb-blame-loss for 3+ INTs).
  if (lScore <= ANEMIC_POINTS) {
    const loserQbLine = bestPasserLine(stats, league, loserId);
    if (loserQbLine) {
      const loserQb = league.players[loserQbLine.playerId];
      const alreadyHeadlined = loserHeadliners.some(
        (h) => h.playerId === loserQbLine.playerId,
      );
      if (loserQb && !alreadyHeadlined) {
        loserHeadliners.push({
          playerId: loserQbLine.playerId,
          playerLastName: loserQb.lastName,
          playerPosition: loserQb.position,
          teamId: loserId,
          kind: 'anemic-loss',
          stat: lScore,
          secondaryStat: loserQbLine.passingYards,
        });
      }
    }
  }

  // Trim each side to keep the report pool reasonable.
  return {
    winner: rankAndCap(winnerHeadliners, 3),
    loser: rankAndCap(loserHeadliners, 2),
  };

  function classifyLine(
    player: Player,
    line: PlayerGameStats,
    isWinnerSide: boolean,
    isLoserSide: boolean,
    leaders: WeekStatLeaders,
  ): GameHeadliner | null {
    const base = {
      playerId: line.playerId,
      playerLastName: player.lastName,
      playerPosition: player.position,
      teamId: player.teamId! as TeamId,
    };

    // QB monster — clears static threshold AND is one of the week's
    // top passers. Both gates required.
    if (line.passingYards >= QB_MONSTER_YDS && leaders.topPassYards.has(line.playerId)) {
      return { ...base, kind: 'qb-monster', stat: line.passingYards, secondaryStat: line.passingTds };
    }
    if (isWinnerSide && line.passingYards >= QB_HUGE_YDS && leaders.topPassYards.has(line.playerId)) {
      return { ...base, kind: 'qb-huge-win', stat: line.passingYards, secondaryStat: line.passingTds };
    }
    if (isWinnerSide && line.passingTds >= QB_MULTI_TD && leaders.topPassTds.has(line.playerId)) {
      return { ...base, kind: 'qb-multi-td', stat: line.passingTds, secondaryStat: line.passingYards };
    }
    // qb-blame-loss is notable-incident: threshold-only, not gated by
    // leader-set. A 4-INT game is news whether other QBs threw for
    // 200 or 350.
    if (isLoserSide && line.interceptionsThrown >= QB_BLAME_INTS) {
      return { ...base, kind: 'qb-blame-loss', stat: line.interceptionsThrown, secondaryStat: line.passingYards };
    }
    // qb-lead-loss: leader-set gated so it only fires for the genuine
    // "led the league in passing yards but lost" angle.
    if (isLoserSide && line.passingYards >= QB_HUGE_YDS && leaders.topPassYards.has(line.playerId)) {
      return { ...base, kind: 'qb-lead-loss', stat: line.passingYards, secondaryStat: line.passingTds };
    }

    // RB — rushing-yard volume. Leader-set gated.
    if (line.rushingYards >= RB_MONSTER_YDS && leaders.topRushYards.has(line.playerId)) {
      return { ...base, kind: 'rb-monster', stat: line.rushingYards, secondaryStat: line.rushingTds };
    }
    if (isWinnerSide && line.rushingYards >= RB_BIG_YDS && leaders.topRushYards.has(line.playerId)) {
      return { ...base, kind: 'rb-big-win', stat: line.rushingYards, secondaryStat: line.rushingTds };
    }

    // WR/TE — receiving-yard volume. Leader-set gated.
    if (line.receivingYards >= WR_BIG_YDS && leaders.topRecYards.has(line.playerId)) {
      return { ...base, kind: 'wr-big-day', stat: line.receivingYards, secondaryStat: line.receivingTds };
    }

    // Defense — sack/pick storms. Leader-set gated.
    if (line.sacks >= SACK_STORM && leaders.topSacks.has(line.playerId)) {
      return { ...base, kind: 'sack-storm', stat: line.sacks, secondaryStat: line.tackles };
    }
    if (line.interceptions >= PICK_STORM && leaders.topInts.has(line.playerId)) {
      return { ...base, kind: 'pick-storm', stat: line.interceptions, secondaryStat: line.tackles };
    }

    return null;
  }
}

function bestPasserLine(
  stats: readonly PlayerGameStats[],
  league: LeagueState,
  teamId: TeamId,
): PlayerGameStats | null {
  let best: PlayerGameStats | null = null;
  for (const line of stats) {
    const player = league.players[line.playerId];
    if (!player) continue;
    if (player.teamId !== teamId) continue;
    if (player.position !== 'QB') continue;
    if (!best || line.passingYards > best.passingYards) best = line;
  }
  return best;
}

/**
 * Rank headliners by impact (monster > huge > multi > big) and cap
 * the list to keep template variety high without overwhelming the
 * pool.
 */
function rankAndCap(headliners: GameHeadliner[], cap: number): GameHeadliner[] {
  const priority: Record<HeadlinerKind, number> = {
    'qb-monster': 100,
    'qb-huge-win': 80,
    'qb-multi-td': 70,
    'rb-monster': 75,
    'rb-big-win': 60,
    'wr-big-day': 55,
    'sack-storm': 65,
    'pick-storm': 55,
    'qb-lead-loss': 50,
    'qb-blame-loss': 85, // blame stories are headline-worthy
    'anemic-loss': 30,
  };
  return [...headliners]
    .sort((a, b) => (priority[b.kind] ?? 0) - (priority[a.kind] ?? 0))
    .slice(0, cap);
}
