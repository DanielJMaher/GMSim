/**
 * Weekly + playoff report generation (v0.62).
 *
 * Called once per REGULAR_SEASON_WEEK tick (after games + per-week
 * subsystems fire) and once per playoff-round tick (after the round's
 * games play). Returns an array of new MediaReport entries to append
 * to `league.mediaReports`.
 *
 * Volume target: ~2-3 reports per played game. Mix of local
 * (subject team's local outlet) + 1-2 national outlets picked from
 * the appropriate-focus pool. Per game we fire one report from the
 * winner's local + one from the loser's local + 1-2 nationals
 * commenting on the matchup. With 16 games per regular-season week
 * × ~3 reports = ~48 reports per week. Volume is high but represents
 * a real beat-reporter cycle.
 */

import type { Prng } from '../prng/index.js';
import type { LeagueState } from '../types/league.js';
import type { TeamState } from '../types/team.js';
import type { ScheduledGame } from '../types/game.js';
import type { MediaOutlet, MediaReport, TeamWeekReport } from '../types/media.js';
import type { LifecyclePhase } from '../season/lifecycle.js';
import { MediaReportId } from '../types/ids.js';
import {
  BLOWOUT_WIN_TEMPLATES,
  BLOWOUT_LOSS_TEMPLATES,
  CLOSE_WIN_TEMPLATES,
  CLOSE_LOSS_TEMPLATES,
  STANDARD_WIN_TEMPLATES,
  STANDARD_LOSS_TEMPLATES,
  WIN_STREAK_TEMPLATES,
  LOSS_STREAK_TEMPLATES,
  SHUTOUT_WIN_TEMPLATES,
  DIVISIONAL_WIN_TEMPLATES,
  DIVISIONAL_LOSS_TEMPLATES,
  PLAYOFF_WIN_TEMPLATES,
  PLAYOFF_LOSS_TEMPLATES,
  SUPER_BOWL_WIN_TEMPLATES,
  SUPER_BOWL_LOSS_TEMPLATES,
  QB_HUGE_WIN_TEMPLATES,
  QB_MONSTER_TEMPLATES,
  QB_MULTI_TD_TEMPLATES,
  QB_BLAME_LOSS_TEMPLATES,
  QB_LEAD_LOSS_TEMPLATES,
  RB_BIG_WIN_TEMPLATES,
  RB_MONSTER_TEMPLATES,
  WR_BIG_DAY_TEMPLATES,
  SACK_STORM_TEMPLATES,
  PICK_STORM_TEMPLATES,
  ANEMIC_LOSS_TEMPLATES,
  fillTemplate,
  filterTemplatesForOutlet,
  type HeadlineSlots,
  type HeadlineTemplate,
} from './templates.js';
import {
  extractHeadliners,
  computeWeekStatLeaders,
  type GameHeadliner,
  type HeadlinerKind,
  type WeekStatLeaders,
} from './headliners.js';
import { deriveGamePlayerStats } from '../games/stats.js';

const BLOWOUT_MARGIN = 17;
const CLOSE_MARGIN = 3;
const STREAK_THRESHOLD = 3;

/**
 * Generate the regular-season-week report batch for one tick.
 *
 * `weekIdx` is the 0-indexed week just played; the report's
 * weekNumber field is 1-indexed for display (matches NFL convention).
 */
export function generateWeeklyMediaReports(
  prng: Prng,
  league: LeagueState,
  weekIdx: number,
  filedOnTick: number,
): readonly MediaReport[] {
  if (!league.schedule) return [];
  const week = league.schedule.regularSeason[weekIdx];
  if (!week) return [];

  // Pre-compute week-wide leaders (top passers, top rushers, etc.)
  // so player-driven headlines only fire for genuine outliers.
  const allLines = week.flatMap((g) => (g.result ? deriveGamePlayerStats(g, league) : []));
  const leaders = computeWeekStatLeaders(allLines);

  // Phrase-uniqueness set: shared across every outlet's report this
  // tick. A distinctive verb ("dismantle", "grind", "throttle") is
  // tagged on each template; once used, it can't fire again until
  // the next tick.
  const usedSignatures = new Set<string>();

  const reports: TeamWeekReport[] = [];
  let counter = 0;
  for (const game of week) {
    if (!game.result) continue;
    const gamePrng = prng.fork(`game:${game.id}`);
    const gameReports = reportsForGame(
      gamePrng,
      league,
      game,
      'REGULAR_SEASON_WEEK',
      weekIdx + 1,
      filedOnTick,
      () => `MR_S${league.seasonNumber}_W${weekIdx + 1}_${counter++}`,
      leaders,
      usedSignatures,
    );
    for (const r of gameReports) reports.push(r);
  }
  return reports;
}

/**
 * Generate the report batch for one playoff round. `phase` is the
 * round's lifecycle phase; `games` is the round's just-played games
 * (read from `league.schedule.playoffs.wildCard` etc by the caller).
 */
export function generatePlayoffRoundMediaReports(
  prng: Prng,
  league: LeagueState,
  phase: LifecyclePhase,
  games: readonly ScheduledGame[],
  filedOnTick: number,
): readonly MediaReport[] {
  const allLines = games.flatMap((g) => (g.result ? deriveGamePlayerStats(g, league) : []));
  const leaders = computeWeekStatLeaders(allLines);
  const usedSignatures = new Set<string>();

  const reports: TeamWeekReport[] = [];
  let counter = 0;
  for (const game of games) {
    if (!game.result) continue;
    const gamePrng = prng.fork(`game:${game.id}`);
    const gameReports = reportsForGame(
      gamePrng,
      league,
      game,
      phase,
      null,
      filedOnTick,
      () => `MR_S${league.seasonNumber}_${phase}_${counter++}`,
      leaders,
      usedSignatures,
    );
    for (const r of gameReports) reports.push(r);
  }
  return reports;
}

/**
 * National-coverage saturation per phase. The Super Bowl is the only
 * game that week and every national outlet weighs in; lesser playoff
 * rounds scale between regular-season-baseline and Super-Bowl-max.
 * Beat writers stay tied to their own team (they don't cover other
 * teams' games) so this scale applies only to NATIONAL outlets.
 */
function nationalCoverageCount(phase: LifecyclePhase, nationalsAvailable: number): number {
  switch (phase) {
    case 'REGULAR_SEASON_WEEK':
      return Math.min(1, nationalsAvailable);
    case 'WILD_CARD':
      return Math.min(3, nationalsAvailable);
    case 'DIVISIONAL':
      return Math.min(5, nationalsAvailable);
    case 'CONFERENCE':
      return Math.min(7, nationalsAvailable);
    case 'SUPER_BOWL':
      // The Super Bowl saturates — every national outlet files.
      return nationalsAvailable;
    default:
      return Math.min(1, nationalsAvailable);
  }
}

function reportsForGame(
  prng: Prng,
  league: LeagueState,
  game: ScheduledGame,
  phase: LifecyclePhase,
  weekNumber: number | null,
  filedOnTick: number,
  nextId: () => string,
  leaders: WeekStatLeaders,
  usedSignatures: Set<string>,
): TeamWeekReport[] {
  const result = game.result!;
  const home = league.teams[game.homeTeamId];
  const away = league.teams[game.awayTeamId];
  if (!home || !away) return [];

  const homeWon = result.homeScore > result.awayScore;
  const winner = homeWon ? home : away;
  const loser = homeWon ? away : home;
  const wScore = homeWon ? result.homeScore : result.awayScore;
  const lScore = homeWon ? result.awayScore : result.homeScore;
  const margin = wScore - lScore;
  const isShutout = lScore === 0;

  const winnerStreak = currentSeasonStreak(league, winner, game);
  const loserStreak = currentSeasonStreak(league, loser, game);
  const isDivisional = winner.identity.division === loser.identity.division;

  const isPlayoff = phase !== 'REGULAR_SEASON_WEEK';
  const isSuperBowl = phase === 'SUPER_BOWL';
  const roundLabel = playoffRoundLabel(phase);

  // Extract per-game headliners. Gated by `leaders` so only week-wide
  // outlier performances drive player-named templates.
  const headliners = extractHeadliners(game, league, leaders);

  const reports: TeamWeekReport[] = [];

  const allOutlets = Object.values(league.mediaOutlets);
  const winnerLocal = allOutlets.find(
    (o) => typeof o.market === 'object' && 'localTo' in o.market && o.market.localTo === winner.identity.id,
  );
  const loserLocal = allOutlets.find(
    (o) => typeof o.market === 'object' && 'localTo' in o.market && o.market.localTo === loser.identity.id,
  );
  const nationals = allOutlets.filter(
    (o) => o.market === 'NATIONAL' && (o.focus === 'NFL' || o.focus === 'BOTH'),
  );

  function emitReport(
    outletId: typeof allOutlets[number]['id'],
    headline: string,
    tone: TeamWeekReport['tone'],
    subjectTeamId: typeof winner.identity.id,
  ): void {
    reports.push({
      kind: 'team-week-report',
      id: MediaReportId(nextId()),
      outletId,
      filedOnTick,
      seasonNumber: league.seasonNumber,
      weekNumber,
      lifecyclePhase: phase,
      tone,
      headline,
      subjectTeamId,
      gameId: game.id,
    });
  }

  if (winnerLocal) {
    const r = pickHeadlineForReport(
      prng.fork(`tpl:winner-local`),
      winnerLocal,
      headliners.winner,
      winner,
      loser,
      wScore,
      lScore,
      margin,
      winnerStreak,
      'win',
      roundLabel,
      isDivisional,
      { isPlayoff, isSuperBowl, isWinner: true, margin, isShutout, streakLen: winnerStreak, isDivisional },
      usedSignatures,
    );
    if (r) emitReport(winnerLocal.id, r.headline, r.tone, winner.identity.id);
  }

  if (loserLocal) {
    const r = pickHeadlineForReport(
      prng.fork(`tpl:loser-local`),
      loserLocal,
      headliners.loser,
      loser,
      winner,
      wScore,
      lScore,
      margin,
      loserStreak,
      'loss',
      roundLabel,
      isDivisional,
      { isPlayoff, isSuperBowl, isWinner: false, margin, isShutout, streakLen: loserStreak, isDivisional },
      usedSignatures,
    );
    if (r) emitReport(loserLocal.id, r.headline, r.tone, loser.identity.id);
  }

  const coverageCount = nationalCoverageCount(phase, nationals.length);
  if (coverageCount > 0) {
    const sorted = [...nationals].sort((a, b) => a.id.localeCompare(b.id));
    const pickPrng = prng.fork('national-shuffle');
    pickPrng.shuffle(sorted);
    const picked = sorted.slice(0, coverageCount);
    for (let i = 0; i < picked.length; i++) {
      const national = picked[i]!;
      const r = pickHeadlineForReport(
        prng.fork(`tpl:national:${i}`),
        national,
        headliners.winner,
        winner,
        loser,
        wScore,
        lScore,
        margin,
        winnerStreak,
        'win',
        roundLabel,
        isDivisional,
        { isPlayoff, isSuperBowl, isWinner: true, margin, isShutout, streakLen: winnerStreak, isDivisional },
        usedSignatures,
      );
      if (r) emitReport(national.id, r.headline, r.tone, winner.identity.id);
    }
  }

  return reports;
}

/**
 * Try a player-driven headliner template first; fall back to a
 * team-action template. Returns null if BOTH fail (outlet's hype
 * affordance didn't match anything in the pool — silent for this
 * game).
 *
 * About 60% of the time a matching headliner exists, the headliner
 * template wins. The remaining 40% the team-action template fires
 * for variety (so the feed isn't all-player-driven).
 */
function pickHeadlineForReport(
  prng: Prng,
  outlet: MediaOutlet,
  headliners: readonly GameHeadliner[],
  subjectTeam: TeamState,
  oppTeam: TeamState,
  wScore: number,
  lScore: number,
  margin: number,
  streakLen: number,
  streakKind: 'win' | 'loss',
  roundLabel: string | undefined,
  isDivisional: boolean,
  facets: OutcomeFacets,
  usedSignatures: Set<string>,
): { headline: string; tone: TeamWeekReport['tone'] } | null {
  // 60% chance to try player-driven if a matching headliner exists.
  const useHeadliner = headliners.length > 0 && prng.fork('headliner-roll').next() < 0.6;
  if (useHeadliner) {
    const headliner = prng.fork('headliner-pick').pick(headliners);
    const pool = headlinerTemplatePool(headliner.kind);
    const filtered = filterTemplatesForOutletAndSignatures(
      pool,
      outlet.hypeSpectrum,
      outlet.tier,
      usedSignatures,
    );
    if (filtered.length > 0) {
      const template = prng.fork('headliner-template').pick(filtered);
      const slots = buildHeadlinerSlots(
        subjectTeam,
        oppTeam,
        wScore,
        lScore,
        margin,
        streakLen,
        streakKind,
        roundLabel,
        isDivisional,
        headliner,
      );
      if (template.signature) usedSignatures.add(template.signature);
      return { headline: fillTemplate(template.pattern, slots), tone: template.tone };
    }
  }

  // Team-action fallback.
  const teamSlots = buildSlots(
    subjectTeam,
    oppTeam,
    wScore,
    lScore,
    margin,
    streakLen,
    streakKind,
    roundLabel,
    isDivisional,
  );
  const template = pickTemplate(prng.fork('team-action'), outlet, facets, usedSignatures);
  if (!template) return null;
  if (template.signature) usedSignatures.add(template.signature);
  return { headline: fillTemplate(template.pattern, teamSlots), tone: template.tone };
}

/**
 * Filter templates by outlet hype/tier AND by phrase-uniqueness:
 * exclude templates whose `signature` has already been used in this
 * tick. If exclusion would empty the pool, fall back to the
 * unfiltered set (better to repeat a phrase than fail to fire).
 */
function filterTemplatesForOutletAndSignatures(
  templates: readonly HeadlineTemplate[],
  outletHype: number,
  outletTier: MediaOutlet['tier'],
  usedSignatures: Set<string>,
): HeadlineTemplate[] {
  const outletMatches = filterTemplatesForOutlet(templates, outletHype, outletTier);
  const uniqueMatches = outletMatches.filter(
    (t) => !t.signature || !usedSignatures.has(t.signature),
  );
  return uniqueMatches.length > 0 ? uniqueMatches : outletMatches;
}

function headlinerTemplatePool(kind: HeadlinerKind): readonly HeadlineTemplate[] {
  switch (kind) {
    case 'qb-huge-win':
      return QB_HUGE_WIN_TEMPLATES;
    case 'qb-monster':
      return QB_MONSTER_TEMPLATES;
    case 'qb-multi-td':
      return QB_MULTI_TD_TEMPLATES;
    case 'qb-blame-loss':
      return QB_BLAME_LOSS_TEMPLATES;
    case 'qb-lead-loss':
      return QB_LEAD_LOSS_TEMPLATES;
    case 'rb-big-win':
      return RB_BIG_WIN_TEMPLATES;
    case 'rb-monster':
      return RB_MONSTER_TEMPLATES;
    case 'wr-big-day':
      return WR_BIG_DAY_TEMPLATES;
    case 'sack-storm':
      return SACK_STORM_TEMPLATES;
    case 'pick-storm':
      return PICK_STORM_TEMPLATES;
    case 'anemic-loss':
      return ANEMIC_LOSS_TEMPLATES;
  }
}

function buildHeadlinerSlots(
  subject: TeamState,
  opp: TeamState,
  wScore: number,
  lScore: number,
  margin: number,
  streakLen: number,
  streakKind: 'win' | 'loss',
  round: string | undefined,
  isDivisional: boolean,
  headliner: GameHeadliner,
): HeadlineSlots {
  const slots: HeadlineSlots = {
    team: subject.identity.location,
    teamAbbr: subject.identity.abbreviation,
    teamNickname: subject.identity.nickname,
    opp: opp.identity.location,
    oppAbbr: opp.identity.abbreviation,
    oppNickname: opp.identity.nickname,
    margin,
    wScore,
    lScore,
    streakLen,
    streakKind,
    isDivisional,
    player: headliner.playerLastName,
    playerPos: headliner.playerPosition,
    stat: headliner.stat,
    stat2: headliner.secondaryStat,
  };
  if (round) slots.round = round;
  return slots;
}

function buildSlots(
  team: TeamState,
  opp: TeamState,
  wScore: number,
  lScore: number,
  margin: number,
  streakLen: number,
  streakKind: 'win' | 'loss',
  round: string | undefined,
  isDivisional: boolean,
): HeadlineSlots {
  const slots: HeadlineSlots = {
    team: team.identity.location,
    teamAbbr: team.identity.abbreviation,
    teamNickname: team.identity.nickname,
    opp: opp.identity.location,
    oppAbbr: opp.identity.abbreviation,
    oppNickname: opp.identity.nickname,
    margin,
    wScore,
    lScore,
    streakLen,
    streakKind,
    isDivisional,
  };
  if (round) slots.round = round;
  return slots;
}

interface OutcomeFacets {
  isPlayoff: boolean;
  isSuperBowl: boolean;
  isWinner: boolean;
  margin: number;
  isShutout: boolean;
  streakLen: number;
  isDivisional: boolean;
}

/**
 * Pick the template pool based on game outcome facets, then filter
 * by the outlet's hype + tier, then pick one at random. Order of
 * priority (most-specific first):
 *
 *   1. Super Bowl winner/loser
 *   2. Playoff winner/loser
 *   3. Win/loss streak amplifier (regular-season only, streak ≥ 3)
 *   4. Shutout win
 *   5. Blowout (margin ≥ 17)
 *   6. Close call (margin ≤ 3)
 *   7. Standard
 */
function pickTemplate(
  prng: Prng,
  outlet: MediaOutlet,
  facets: OutcomeFacets,
  usedSignatures: Set<string>,
): HeadlineTemplate | null {
  const pool = pickTemplatePool(facets);
  const filtered = filterTemplatesForOutletAndSignatures(
    pool,
    outlet.hypeSpectrum,
    outlet.tier,
    usedSignatures,
  );
  if (filtered.length === 0) return null;
  return prng.pick(filtered);
}

function pickTemplatePool(facets: OutcomeFacets): readonly HeadlineTemplate[] {
  if (facets.isSuperBowl) {
    return facets.isWinner ? SUPER_BOWL_WIN_TEMPLATES : SUPER_BOWL_LOSS_TEMPLATES;
  }
  if (facets.isPlayoff) {
    return facets.isWinner ? PLAYOFF_WIN_TEMPLATES : PLAYOFF_LOSS_TEMPLATES;
  }
  // Regular-season layered priority. Streak + shutout amplifiers
  // dominate when present; otherwise fall back to outcome-margin
  // pools, with a divisional layer when teams share a division.
  if (facets.streakLen >= STREAK_THRESHOLD) {
    return facets.isWinner ? WIN_STREAK_TEMPLATES : LOSS_STREAK_TEMPLATES;
  }
  if (facets.isWinner && facets.isShutout) {
    return SHUTOUT_WIN_TEMPLATES;
  }
  if (facets.margin >= BLOWOUT_MARGIN) {
    return facets.isWinner ? BLOWOUT_WIN_TEMPLATES : BLOWOUT_LOSS_TEMPLATES;
  }
  // Divisional matchups: blend the divisional pool into the close /
  // standard pools so divisional language surfaces about half the
  // time on those margins.
  if (facets.isDivisional && facets.margin > CLOSE_MARGIN) {
    return facets.isWinner
      ? [...STANDARD_WIN_TEMPLATES, ...DIVISIONAL_WIN_TEMPLATES]
      : [...STANDARD_LOSS_TEMPLATES, ...DIVISIONAL_LOSS_TEMPLATES];
  }
  if (facets.isDivisional && facets.margin <= CLOSE_MARGIN) {
    return facets.isWinner
      ? [...CLOSE_WIN_TEMPLATES, ...DIVISIONAL_WIN_TEMPLATES]
      : [...CLOSE_LOSS_TEMPLATES, ...DIVISIONAL_LOSS_TEMPLATES];
  }
  if (facets.margin <= CLOSE_MARGIN) {
    return facets.isWinner ? CLOSE_WIN_TEMPLATES : CLOSE_LOSS_TEMPLATES;
  }
  return facets.isWinner ? STANDARD_WIN_TEMPLATES : STANDARD_LOSS_TEMPLATES;
}

function playoffRoundLabel(phase: LifecyclePhase): string | undefined {
  switch (phase) {
    case 'WILD_CARD':
      return 'Wild Card';
    case 'DIVISIONAL':
      return 'Divisional Round';
    case 'CONFERENCE':
      return 'Conference Championship';
    case 'SUPER_BOWL':
      return 'Super Bowl';
    default:
      return undefined;
  }
}

/**
 * Walk this season's played games for `team` (up to but not including
 * `currentGame`) to count their consecutive prior wins or losses.
 * Returns the streak length INCLUDING the current game's outcome.
 * E.g., a team that just won after winning the previous two has
 * streakLen=3.
 */
function currentSeasonStreak(
  league: LeagueState,
  team: TeamState,
  currentGame: ScheduledGame,
): number {
  if (!league.schedule || !currentGame.result) return 0;
  // Determine whether the team won the current game.
  const teamId = team.identity.id;
  const currentWon =
    (currentGame.homeTeamId === teamId &&
      currentGame.result.homeScore > currentGame.result.awayScore) ||
    (currentGame.awayTeamId === teamId &&
      currentGame.result.awayScore > currentGame.result.homeScore);

  // Walk backwards through the regular-season schedule, counting
  // consecutive games with the same outcome.
  let streak = 1; // includes the current game
  let foundCurrent = false;
  for (let w = league.schedule.regularSeason.length - 1; w >= 0; w--) {
    const week = league.schedule.regularSeason[w] ?? [];
    for (const g of week) {
      if (!g.result) continue;
      if (g.id === currentGame.id) {
        foundCurrent = true;
        continue;
      }
      // Skip games not involving this team OR games after currentGame
      // in walk order (we want only games BEFORE currentGame).
      if (!foundCurrent) continue;
      const isThisTeam = g.homeTeamId === teamId || g.awayTeamId === teamId;
      if (!isThisTeam) continue;
      const won =
        (g.homeTeamId === teamId && g.result.homeScore > g.result.awayScore) ||
        (g.awayTeamId === teamId && g.result.awayScore > g.result.homeScore);
      if (won === currentWon) streak++;
      else return streak;
    }
  }
  return streak;
}
