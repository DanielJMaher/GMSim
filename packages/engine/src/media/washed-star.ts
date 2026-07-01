/**
 * Washed-star divergence (v0.169) — the media DISAGREES about a fading name.
 *
 * The talent model (v0.168) makes `talentGrade` sticky: it EWMA-tracks a
 * player's within-position standing, so a declining star keeps his STAR-tier
 * grade for ~2-3 seasons AFTER his current level has slipped. That lag is
 * exactly the "still called elite, but producing mid-tier" window — and it's
 * the kind of thing the media argues about. Once per season the beat splits:
 *
 *   - a national hot-take outlet files that he's WASHED — coasting on the name,
 *     not the current tape (tone CRITICAL);
 *   - his LOCAL beat (a homer, or a measured national if he has no beat) DEFENDS
 *     him as still impactful — the box score misses what he does (tone POSITIVE).
 *
 * The divergence is the point: which outlet is right resolves over the next
 * seasons (the gap closes, or he bounces back), teaching the player whom to
 * trust. Selection (who's washed, which outlets) is deterministic world-state
 * (the sticky grade vs the current within-position percentile); only the WORDS
 * ride `league.voiceSeed` (Living Voice split). Per North Star, no rating, grade
 * or tier number is ever spoken.
 */

import type { LeagueState } from '../types/league.js';
import type { Player } from '../types/player.js';
import type { MediaOutlet, MediaReport, ScoutReportBody } from '../types/media.js';
import type { LifecyclePhase } from '../season/lifecycle.js';
import type { TeamId } from '../types/ids.js';
import { MediaReportId } from '../types/ids.js';
import { gradeToTier } from '../players/skills.js';
import { withinPositionPercentiles } from '../season/talent-score.js';
import { scoutTraitsFor, scoutConcernFor } from './scout-vocabulary.js';
import { voicePrng } from './voice.js';

/** Week the divergence fires — mid-season, once the "is he done?" narrative has
 *  a body of play behind it. Silent if the season is shorter than this. */
export const WASHED_STAR_TAKE_WEEK = 10;

/** How far the CURRENT within-position percentile must sit below the sticky
 *  reputation (`talentScore`) before "washed" chatter is warranted. Both are
 *  within-position percentiles, so this is apples-to-apples. */
const WASHED_GAP = 0.2;

/** A "name" is an established veteran — you can't coast on a reputation you
 *  haven't built. */
const MIN_EXPERIENCE = 4;

interface WashedCandidate {
  player: Player;
  gap: number;
}

function findWashedStars(league: LeagueState, limit: number): WashedCandidate[] {
  const percentiles = withinPositionPercentiles(Object.values(league.players));
  const candidates: WashedCandidate[] = [];
  for (const player of Object.values(league.players)) {
    if (player.teamId === null) continue;
    if (player.experienceYears < MIN_EXPERIENCE) continue;
    // Still CALLED elite/star (stored, sticky grade), but the current standing
    // has slipped well below that reputation.
    if (gradeToTier(player.talentGrade) !== 'STAR') continue;
    const current = percentiles.get(player.id);
    if (current === undefined) continue;
    const gap = player.talentScore - current;
    if (gap < WASHED_GAP) continue;
    candidates.push({ player, gap });
  }
  // Biggest reputation-vs-reality gap first; ties to the bigger name (earlier
  // draft pick), then id for a stable order.
  candidates.sort(
    (a, b) =>
      b.gap - a.gap ||
      (a.player.draftOverallPick ?? 9999) - (b.player.draftOverallPick ?? 9999) ||
      a.player.id.localeCompare(b.player.id),
  );
  return candidates.slice(0, limit);
}

const WASHED_HEADLINES: readonly string[] = [
  'Somebody has to say it about {name}: the name is doing the work, the {pos} play isn’t.',
  '{name} is coasting on the reputation now — the tape stopped backing the billing a while ago.',
  'The {name} brand still sells; the current tape tells {team} a different story.',
  '{name}’s prime is in the rear-view — {team} is paying for the memory, not the player.',
];
const WASHED_SUMMARY: readonly string[] = [
  'The marquee still says star; the week-to-week tape says complementary piece.',
  'A big name whose actual level has quietly slid toward the middle of the pack.',
  'Reputation is the last thing to fade, and {name} is the proof.',
];
const WASHED_BOTTOM: readonly string[] = [
  'Still a name. Not still a star — and {team} may be the last to admit it.',
  'Coasting on the resume works until the snaps say otherwise; they’re starting to.',
  'The billing and the ballplayer have drifted apart, and it’s showing.',
];

const DEFEND_HEADLINES: readonly string[] = [
  'Don’t bury {name} yet — he still tilts games for {team} in ways the box score misses.',
  'The {name} slander is lazy: he’s still the guy {team} leans on when it matters.',
  'Washed? Hardly. {name} isn’t what he was, but he’s still moving the needle for {team}.',
  '{name} keeps hearing the doubters, and keeps being exactly what {team} needs.',
];
const DEFEND_SUMMARY: readonly string[] = [
  'Not the force he once was, but far from finished — the impact is still on the tape.',
  'The counting stats dipped; the winning plays didn’t. {name} still matters to {team}.',
  'A proven vet who does the quiet things {team} would struggle to replace.',
];
const DEFEND_BOTTOM: readonly string[] = [
  'Still a difference-maker for {team} — the “washed” talk is premature.',
  'Value that shows up in more than the numbers. {name} isn’t done.',
  'You don’t bet against this kind of vet in the games that count.',
];

function fill(template: string, v: { name: string; pos: string; team: string }): string {
  return template
    .replace(/\{name\}/g, v.name)
    .replace(/\{pos\}/g, v.pos)
    .replace(/\{team\}/g, v.team);
}

function buildDivergenceReports(
  league: LeagueState,
  candidate: WashedCandidate,
  washedOutlet: MediaOutlet,
  defendOutlet: MediaOutlet,
  teamName: string,
  phase: LifecyclePhase,
  weekNumber: number | null,
  filedOnTick: number,
  idx: number,
): MediaReport[] {
  const { player } = candidate;
  const slots = {
    name: `${player.firstName} ${player.lastName}`,
    pos: player.position,
    team: teamName,
  };

  const base = (stance: 'WASHED' | 'DEFEND', outlet: MediaOutlet, scoutReport: ScoutReportBody, headline: string): MediaReport => ({
    kind: 'player-take',
    id: MediaReportId(`WASH_S${league.seasonNumber}_${idx}_${stance}`),
    outletId: outlet.id,
    filedOnTick,
    seasonNumber: league.seasonNumber,
    weekNumber,
    lifecyclePhase: phase,
    tone: stance === 'WASHED' ? 'CRITICAL' : 'POSITIVE',
    headline,
    subjectPlayerId: player.id,
    subjectIsCollegeProspect: false,
    scoutReport,
  });

  // WASHED — a fading strength, and the concern is now the story.
  const wp = voicePrng(league.voiceSeed, league.seasonNumber, phase, weekNumber ?? 'PO', player.id, 'washed');
  const wTrait = scoutTraitsFor(wp.fork('trait'), player.position, 1)[0] ?? 'his best trait';
  const wWeak = scoutConcernFor(wp.fork('weak'), player.position);
  const washed = base('WASHED', washedOutlet, {
    summary: fill(wp.fork('sum').pick(WASHED_SUMMARY), slots),
    strengths: [`The ${wTrait} still flashes, just not snap to snap.`],
    concern: `The ${wWeak} has gone from a quibble to the whole conversation.`,
    bottomLine: fill(wp.fork('bl').pick(WASHED_BOTTOM), slots),
  }, fill(wp.fork('hl').pick(WASHED_HEADLINES), slots));

  // DEFEND — still doing what wins, one honest question remains.
  const dp = voicePrng(league.voiceSeed, league.seasonNumber, phase, weekNumber ?? 'PO', player.id, 'defend');
  const dTraits = scoutTraitsFor(dp.fork('trait'), player.position, 2);
  const dWeak = scoutConcernFor(dp.fork('weak'), player.position);
  const defend = base('DEFEND', defendOutlet, {
    summary: fill(dp.fork('sum').pick(DEFEND_SUMMARY), slots),
    strengths: dTraits.slice(0, 2).map((t, i) => (i === 0 ? `Still ${t}.` : `The ${t} still travels.`)),
    concern: `The ${dWeak} is a fair question at this stage of the career.`,
    bottomLine: fill(dp.fork('bl').pick(DEFEND_BOTTOM), slots),
  }, fill(dp.fork('hl').pick(DEFEND_HEADLINES), slots));

  return [washed, defend];
}

/**
 * File the season's washed-star divergences — each a WASHED (national) +
 * DEFEND (local beat / measured national) pair. Returns reports to append to
 * `league.mediaReports`. Fires once, at {@link WASHED_STAR_TAKE_WEEK}.
 */
export function generateWashedStarTakes(
  league: LeagueState,
  phase: LifecyclePhase,
  weekNumber: number | null,
  filedOnTick: number,
  maxTakes = 3,
): readonly MediaReport[] {
  const candidates = findWashedStars(league, maxTakes);
  if (candidates.length === 0) return [];

  const outlets = Object.values(league.mediaOutlets);
  const nfl = (o: MediaOutlet): boolean => o.focus === 'NFL' || o.focus === 'BOTH';
  // National skeptics, loudest first — the hot-take crowd runs the "washed" story.
  const nationals = outlets
    .filter((o) => o.market === 'NATIONAL' && nfl(o))
    .sort((a, b) => b.hypeSpectrum - a.hypeSpectrum || a.id.localeCompare(b.id));
  if (nationals.length === 0) return [];
  // Measured national fallback for the DEFEND when a player has no local beat.
  const measuredNational = [...nationals].reverse();

  const localBeat = (teamId: TeamId): MediaOutlet | undefined =>
    outlets.find(
      (o) => typeof o.market === 'object' && 'localTo' in o.market && o.market.localTo === teamId && nfl(o),
    );

  const reports: MediaReport[] = [];
  let idx = 0;
  for (const candidate of candidates) {
    const teamId = candidate.player.teamId;
    const team = teamId ? league.teams[teamId] : undefined;
    if (!team || teamId === null) continue;
    const washedOutlet = nationals[idx % nationals.length]!;
    const defendOutlet =
      localBeat(teamId) ??
      measuredNational.find((o) => o.id !== washedOutlet.id) ??
      washedOutlet;
    if (defendOutlet.id === washedOutlet.id) {
      idx++;
      continue; // need two distinct voices for a divergence
    }
    reports.push(
      ...buildDivergenceReports(
        league,
        candidate,
        washedOutlet,
        defendOutlet,
        team.identity.location,
        phase,
        weekNumber,
        filedOnTick,
        idx,
      ),
    );
    idx++;
  }
  return reports;
}
