/**
 * Scribe NFL-player takes (v0.121) — the Scribe's player voice, in-season.
 *
 * The take/scout-report machinery (v0.71, v0.118, v0.120) lived entirely in the
 * draft lane — every take was about a college PROSPECT. The regular season only
 * got team-week game recaps, never a player-level read. This carries the Scribe
 * voice into the NFL: each week, the genuine statistical standouts (the same
 * `extractHeadliners` outliers that drive team headlines) get a Scribe-voiced
 * PLAYER take — position-aware traits, an honest concern, the outlet's voice —
 * with the ANGLE framed by draft pedigree (production vs expectation):
 *
 *   - BREAKOUT   — a late-round / undrafted / low-tier player outproducing his
 *                  draft slot ("nobody drafted him for this").
 *   - SPOTLIGHT  — a high-pedigree player living up to the billing.
 *   - STRUGGLING — a rough outing (picks, an anemic offense) — and if the player
 *                  was a high pick, the "investment still searching" angle.
 *
 * Reuses the per-position strength + weakness vocabulary the Scribe measured, so
 * an NFL take sounds like a beat reporter who watched THAT position. Per North
 * Star: observable media output, qualitative only (no true rating/tier number).
 * Deterministic from the supplied PRNG.
 */

import type { Prng } from '../prng/index.js';
import type { LeagueState } from '../types/league.js';
import type { ScheduledGame } from '../types/game.js';
import type { Player } from '../types/player.js';
import type { TeamState } from '../types/team.js';
import type { MediaOutlet, MediaReport, MediaTone, ScoutReportBody } from '../types/media.js';
import type { LifecyclePhase } from '../season/lifecycle.js';
import { MediaReportId } from '../types/ids.js';
import type { TeamId } from '../types/ids.js';
import { getArchetypeById } from '../archetypes/index.js';
import { scoutTraitsFor, scoutConcernFor } from './scout-vocabulary.js';
import { STRENGTH_LEADS_MEASURED, STRENGTH_LEADS_LOUD } from './scout-report.js';
import { voicePrng } from './voice.js';
import {
  extractHeadliners,
  computeWeekStatLeaders,
  type GameHeadliner,
  type HeadlinerKind,
} from './headliners.js';
import { deriveGamePlayerStats } from '../games/stats.js';

type TakeAngle = 'BREAKOUT' | 'SPOTLIGHT' | 'STRUGGLING';

const NEGATIVE_KINDS: ReadonlySet<HeadlinerKind> = new Set<HeadlinerKind>([
  'qb-blame-loss',
  'qb-lead-loss',
  'anemic-loss',
]);

// Cross-kind ranking so the week's most newsworthy performances win the limited
// take slots (mirrors the headliner priority in headliners.ts).
const KIND_PRIORITY: Record<HeadlinerKind, number> = {
  'qb-monster': 100,
  'qb-blame-loss': 85,
  'qb-huge-win': 80,
  'rb-monster': 75,
  'qb-multi-td': 70,
  'sack-storm': 65,
  'rb-big-win': 60,
  'wr-big-day': 55,
  'pick-storm': 55,
  'qb-lead-loss': 50,
  'anemic-loss': 30,
};

function statPhrase(h: GameHeadliner): string {
  switch (h.kind) {
    case 'qb-monster':
    case 'qb-huge-win':
    case 'qb-lead-loss':
      return `${h.stat} passing yards`;
    case 'qb-multi-td':
      return `${h.stat} touchdown passes`;
    case 'qb-blame-loss':
      return `${h.stat} interceptions`;
    case 'rb-monster':
    case 'rb-big-win':
      return `${h.stat} rushing yards`;
    case 'wr-big-day':
      return `${h.stat} receiving yards`;
    case 'sack-storm':
      return `${h.stat} sacks`;
    case 'pick-storm':
      return `${h.stat} interceptions`;
    case 'anemic-loss':
      return `a ${h.stat}-point outing`;
  }
}

/** Low pedigree = the engine's "production vs expectation" gap for a breakout. */
function isLowPedigree(player: Player): boolean {
  if (player.draftRound === null || player.draftRound >= 4) return true;
  return player.tier === 'BACKUP' || player.tier === 'FRINGE';
}

function angleFor(player: Player, h: GameHeadliner): TakeAngle {
  if (NEGATIVE_KINDS.has(h.kind)) return 'STRUGGLING';
  return isLowPedigree(player) ? 'BREAKOUT' : 'SPOTLIGHT';
}

const HEADLINES: Record<TakeAngle, readonly string[]> = {
  BREAKOUT: [
    'Nobody drafted {name} for this: {statPhrase} and the {trait} is real.',
    "{name} is the {pos} breakout {team} didn't see coming — {statPhrase}.",
  ],
  SPOTLIGHT: [
    '{name} keeps cashing the check — {statPhrase} on the strength of {trait}.',
    'The {pos} {team} bet on delivered again: {statPhrase}.',
  ],
  STRUGGLING: [
    '{name}’s {weakness} cost {team} — {statPhrase} in the loss to {opp}.',
    'The questions on {name} are growing: {statPhrase}, and the {weakness} keeps showing up.',
  ],
};

const SUMMARY: Record<TakeAngle, readonly string[]> = {
  BREAKOUT: [
    'A name to know now — {name} backed up the box score with the tape.',
    'The production is no fluke; {name} looks the part at {pos}.',
  ],
  SPOTLIGHT: [
    'Star-level stuff from {name}, right on schedule.',
    '{name} is playing like one of the better {pos}s in the league.',
  ],
  STRUGGLING: [
    'A night {name} will want back.',
    'The {pos} play has to get cleaner for {team}.',
  ],
};

function pedigreeBottomLine(player: Player, angle: TakeAngle): string {
  const round = player.draftRound;
  if (angle === 'BREAKOUT') {
    return round === null
      ? 'An undrafted find playing like a starter — the kind of hit that wins front offices games.'
      : 'A later-round pick outproducing his draft slot in a hurry.';
  }
  if (angle === 'SPOTLIGHT') {
    return round !== null && round <= 2
      ? 'Exactly what a premium pick is supposed to look like.'
      : 'A core piece playing like one.';
  }
  // STRUGGLING
  return round !== null && round <= 2
    ? 'The talent that made him a high pick is still in there — the team needs it to show.'
    : 'A rough night for a role player — nothing that changes the bigger picture.';
}

function fill(
  template: string,
  v: { name: string; pos: string; team: string; opp: string; trait: string; weakness: string; statPhrase: string },
): string {
  return template
    .replace(/\{name\}/g, v.name)
    .replace(/\{pos\}/g, v.pos)
    .replace(/\{team\}/g, v.team)
    .replace(/\{opp\}/g, v.opp)
    .replace(/\{trait\}/g, v.trait)
    .replace(/\{weakness\}/g, v.weakness)
    .replace(/\{statPhrase\}/g, v.statPhrase);
}

function buildBody(
  prng: Prng,
  player: Player,
  outlet: MediaOutlet,
  angle: TakeAngle,
  slots: Parameters<typeof fill>[1],
): ScoutReportBody {
  const loud = outlet.hypeSpectrum >= 6;
  const leads = loud ? STRENGTH_LEADS_LOUD : STRENGTH_LEADS_MEASURED;
  const leadPrng = prng.fork('leads');
  const traits = scoutTraitsFor(prng.fork('traits'), player.position, 2);

  // Positive angles lead with what's working; a struggling player still has the
  // one redeeming flash (fair scouting), so always at least one strength.
  const strengthCount = angle === 'STRUGGLING' ? 1 : loud ? 2 : 1 + (prng.fork('cnt').next() < 0.4 ? 1 : 0);
  const strengths: string[] = [];
  for (let i = 0; i < strengthCount && i < traits.length; i++) {
    strengths.push(`${leadPrng.pick(leads)} ${traits[i]}`.replace(/^./, (c) => c.toUpperCase()));
  }

  const summary = fill(prng.fork('summary').pick(SUMMARY[angle]), slots);
  const concern = `The watch-out remains ${slots.weakness}.`;
  const bottomLine = pedigreeBottomLine(player, angle);

  const compPrng = prng.fork('comp');
  let comp: string | undefined;
  if (compPrng.next() < (loud ? 0.5 : 0.3)) {
    const label = getArchetypeById(player.archetype)?.label;
    if (label) comp = `Plays like a ${compPrng.pick(['prototypical', 'classic', 'modern'])} ${label}.`;
  }

  return comp === undefined
    ? { summary, strengths, concern, bottomLine }
    : { summary, strengths, concern, bottomLine, comp };
}

/** Build one NFL player take from a week's headliner. */
export function buildNflPlayerTake(
  prng: Prng,
  args: {
    player: Player;
    outlet: MediaOutlet;
    headliner: GameHeadliner;
    team: TeamState;
    opp: TeamState;
    seasonNumber: number;
    weekNumber: number | null;
    lifecyclePhase: LifecyclePhase;
    filedOnTick: number;
    idSuffix: string;
  },
): MediaReport {
  const { player, outlet, headliner, team, opp } = args;
  const angle = angleFor(player, headliner);
  const trait = scoutTraitsFor(prng.fork('htrait'), player.position, 1)[0] ?? 'his game';
  const weakness = scoutConcernFor(prng.fork('hweak'), player.position);
  const slots = {
    name: `${player.firstName} ${player.lastName}`,
    pos: player.position,
    team: team.identity.nickname,
    opp: opp.identity.nickname,
    trait,
    weakness,
    statPhrase: statPhrase(headliner),
  };
  const headline = fill(prng.fork('headline').pick(HEADLINES[angle]), slots);
  const scoutReport = buildBody(prng.fork('body'), player, outlet, angle, slots);
  const tone: MediaTone = angle === 'STRUGGLING' ? 'CRITICAL' : 'POSITIVE';

  return {
    kind: 'player-take',
    id: MediaReportId(`NTAKE_S${args.seasonNumber}_${args.idSuffix}`),
    outletId: outlet.id,
    filedOnTick: args.filedOnTick,
    seasonNumber: args.seasonNumber,
    weekNumber: args.weekNumber,
    lifecyclePhase: args.lifecyclePhase,
    tone,
    headline,
    subjectPlayerId: player.id,
    subjectIsCollegeProspect: false,
    scoutReport,
  };
}

interface TakeCandidate {
  headliner: GameHeadliner;
  subjectTeamId: TeamId;
  oppTeamId: TeamId;
}

/**
 * Generate the week's NFL player takes from the just-played games. Collects
 * every game's headliners, ranks them league-wide, and files a Scribe-voiced
 * take for the top `maxTakes` — so the feed surfaces the genuine weekly stories
 * without flooding. Each take is filed by a national outlet (rotating) or the
 * player's local beat. Returns reports to append to `league.mediaReports`.
 *
 * Living Voice (v0.124): SELECTION (which standouts headline, which outlet) is
 * deterministic world-state — it reads the world seed's game results, no voice
 * RNG. Only the WORDS of each take draw from `league.voiceSeed` (per season /
 * phase / week / player), so the same week's results sound different per
 * playthrough. See media/voice.ts + LIVING_VOICE.md §10.1.
 */
export function generateNflPlayerTakes(
  league: LeagueState,
  games: readonly ScheduledGame[],
  phase: LifecyclePhase,
  weekNumber: number | null,
  filedOnTick: number,
  maxTakes = 6,
): readonly MediaReport[] {
  const played = games.filter((g) => g.result);
  if (played.length === 0) return [];

  const allLines = played.flatMap((g) => deriveGamePlayerStats(g, league));
  const leaders = computeWeekStatLeaders(allLines);

  const candidates: TakeCandidate[] = [];
  for (const game of played) {
    const result = game.result!;
    const homeWon = result.homeScore > result.awayScore;
    const winnerId = (homeWon ? game.homeTeamId : game.awayTeamId) as TeamId;
    const loserId = (homeWon ? game.awayTeamId : game.homeTeamId) as TeamId;
    const { winner, loser } = extractHeadliners(game, league, leaders);
    for (const h of winner) candidates.push({ headliner: h, subjectTeamId: winnerId, oppTeamId: loserId });
    for (const h of loser) candidates.push({ headliner: h, subjectTeamId: loserId, oppTeamId: winnerId });
  }
  if (candidates.length === 0) return [];

  // Rank by newsworthiness (kind priority, then raw stat), de-dup per player
  // (a player gets at most one take per week — his single biggest story).
  candidates.sort(
    (a, b) =>
      (KIND_PRIORITY[b.headliner.kind] ?? 0) - (KIND_PRIORITY[a.headliner.kind] ?? 0) ||
      b.headliner.stat - a.headliner.stat,
  );
  const seen = new Set<string>();
  const picked: TakeCandidate[] = [];
  for (const c of candidates) {
    if (seen.has(c.headliner.playerId)) continue;
    seen.add(c.headliner.playerId);
    picked.push(c);
    if (picked.length >= maxTakes) break;
  }

  const allOutlets = Object.values(league.mediaOutlets);
  const nationals = allOutlets.filter(
    (o) => o.market === 'NATIONAL' && (o.focus === 'NFL' || o.focus === 'BOTH'),
  );

  const reports: MediaReport[] = [];
  let idx = 0;
  for (const c of picked) {
    const player = league.players[c.headliner.playerId];
    const team = league.teams[c.subjectTeamId];
    const opp = league.teams[c.oppTeamId];
    if (!player || !team || !opp) continue;
    // Prefer the player's local beat; otherwise rotate the nationals.
    const local = allOutlets.find(
      (o) =>
        typeof o.market === 'object' &&
        'localTo' in o.market &&
        o.market.localTo === c.subjectTeamId &&
        (o.focus === 'NFL' || o.focus === 'BOTH'),
    );
    const outlet = local ?? nationals[idx % Math.max(1, nationals.length)];
    if (!outlet) continue;
    reports.push(
      buildNflPlayerTake(
        voicePrng(league.voiceSeed, league.seasonNumber, phase, weekNumber ?? 'PO', c.headliner.playerId),
        {
          player,
          outlet,
          headliner: c.headliner,
          team,
          opp,
          seasonNumber: league.seasonNumber,
          weekNumber,
          lifecyclePhase: phase,
          filedOnTick,
          idSuffix: `${phase}_${weekNumber ?? 'PO'}_${idx}`,
        },
      ),
    );
    idx++;
  }
  return reports;
}
