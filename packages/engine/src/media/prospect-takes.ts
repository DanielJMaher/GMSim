/**
 * Media prospect "takes" (v0.71) — the sleeper-alert voice.
 *
 * Slice 1 gave the media a numeric read on the class; this is the
 * narrative on top of it. Each outlet champions a few sleepers (the
 * prospects its evaluators love) and publishes a take — "don't sleep on
 * this guy" — with flavor driven by the sleeper channel and the outlet's
 * hype:
 *
 *   - TAPE sleeper        → "overlooked, can play" (small-school gem).
 *   - MEASURABLES sleeper → "freak workout, production questions"
 *                           (the workout-warrior reach).
 *   - High-hype outlet    → loud, speculative ("steal of the draft!").
 *   - Measured outlet     → grounded, positive ("quietly pro-ready").
 *
 * Presentation only: the *selection* of which prospects an outlet loves
 * happens in the scouting cycle (reusing the shared sleeper machinery)
 * and is passed in here, so this module imports nothing from the draft
 * layer at runtime (only the channel type). Output is a
 * `PlayerTakeReport` (kind `player-take`, `subjectIsCollegeProspect`)
 * appended to `LeagueState.mediaReports` — the existing report stream
 * the inspector already renders.
 */

import type { Prng } from '../prng/index.js';
import type { CollegePlayer } from '../types/college.js';
import type { MediaOutlet, MediaReport, MediaTone } from '../types/media.js';
import type { LifecyclePhase } from '../season/lifecycle.js';
import type { SleeperChannel } from '../draft/sleepers.js';
import { MediaReportId } from '../types/ids.js';
import { COLLEGE_SCHOOLS } from '../data/colleges/index.js';

const SCHOOL_NAME_BY_ID = new Map<string, string>(
  COLLEGE_SCHOOLS.map((s) => [s.id, s.name] as const),
);

interface TakeTemplate {
  pattern: string;
  tone: MediaTone;
}

// Templates keyed by channel; the "loud" set fires for high-hype outlets.
const TAPE_MEASURED: readonly TakeTemplate[] = [
  { pattern: "Don't sleep on {name} ({school}) — quietly one of the more pro-ready {pos}s in this class.", tone: 'POSITIVE' },
  { pattern: '{name} is the kind of {pos} who plays 15 years without a Pro Bowl — {school} produced a pro.', tone: 'POSITIVE' },
  { pattern: 'Scouts who watched the {school} tape keep coming back to {name}. Underrated, full stop.', tone: 'POSITIVE' },
];
const TAPE_LOUD: readonly TakeTemplate[] = [
  { pattern: "Nobody's talking about {name} ({school}) and it's criminal — this is a future starter.", tone: 'SPECULATIVE' },
  { pattern: '{name} out of {school} is the steal of the entire draft. Book it.', tone: 'SPECULATIVE' },
  { pattern: "I can't believe {name} isn't a household name. Best {pos} nobody's watching.", tone: 'SPECULATIVE' },
];
const MEASURABLES_MEASURED: readonly TakeTemplate[] = [
  { pattern: 'The {school} tape is uneven, but {name}’s testing numbers give him a real NFL ceiling.', tone: 'POSITIVE' },
  { pattern: '{name} is a developmental {pos}, but the athletic traits at {school} are worth a mid-round swing.', tone: 'NEUTRAL' },
];
const MEASURABLES_LOUD: readonly TakeTemplate[] = [
  { pattern: "Forget the stats — {name} ({school}) is a workout freak with All-Pro tools. Someone's reaching.", tone: 'SPECULATIVE' },
  { pattern: '{name}’s workout broke the combine. {school} just produced a top-50 athlete overnight.', tone: 'SPECULATIVE' },
];

function pool(channel: SleeperChannel, loud: boolean): readonly TakeTemplate[] {
  if (channel === 'MEASURABLES') return loud ? MEASURABLES_LOUD : MEASURABLES_MEASURED;
  return loud ? TAPE_LOUD : TAPE_MEASURED;
}

/**
 * Build one outlet's take on a sleeper. Loud templates fire when the
 * outlet's hype is high (it's the hot-take crowd); measured outlets stay
 * grounded.
 */
export function buildProspectSleeperTake(
  prng: Prng,
  args: {
    outlet: MediaOutlet;
    prospect: CollegePlayer;
    channel: SleeperChannel;
    filedOnTick: number;
    seasonNumber: number;
    lifecyclePhase: LifecyclePhase;
  },
): MediaReport {
  const { outlet, prospect, channel } = args;
  const loud = outlet.hypeSpectrum >= 6;
  const templates = pool(channel, loud);
  const template = prng.pick(templates);
  const school = SCHOOL_NAME_BY_ID.get(prospect.schoolId) ?? prospect.schoolId;
  const headline = template.pattern
    .replace(/\{name\}/g, `${prospect.firstName} ${prospect.lastName}`)
    .replace(/\{school\}/g, school)
    .replace(/\{pos\}/g, prospect.nflProjectedPosition);

  return {
    id: MediaReportId(`CTAKE_S${args.seasonNumber}_${outlet.id}_${prospect.id}`),
    outletId: outlet.id,
    filedOnTick: args.filedOnTick,
    seasonNumber: args.seasonNumber,
    weekNumber: null,
    lifecyclePhase: args.lifecyclePhase,
    tone: template.tone,
    headline,
    kind: 'player-take',
    subjectPlayerId: prospect.id,
    subjectIsCollegeProspect: true,
  };
}

/**
 * One outlet's mock-board headline for a top projected pick — a
 * `ProspectBoardReport` carrying the projected slot. Published for an
 * outlet's premium picks so "[Outlet] mock: X at No. 1" shows in the
 * feed; the full board is computed on demand (see media/mock-boards.ts).
 */
export function buildMockBoardReport(
  args: {
    outlet: MediaOutlet;
    prospect: CollegePlayer;
    projectedOverallPick: number;
    filedOnTick: number;
    seasonNumber: number;
    lifecyclePhase: LifecyclePhase;
  },
): MediaReport {
  const { outlet, prospect, projectedOverallPick } = args;
  const school = SCHOOL_NAME_BY_ID.get(prospect.schoolId) ?? prospect.schoolId;
  const headline = `${outlet.name} mock: ${prospect.firstName} ${prospect.lastName} (${prospect.nflProjectedPosition}, ${school}) — No. ${projectedOverallPick} overall.`;
  return {
    id: MediaReportId(
      `CMOCK_S${args.seasonNumber}_${outlet.id}_${prospect.id}`,
    ),
    outletId: outlet.id,
    filedOnTick: args.filedOnTick,
    seasonNumber: args.seasonNumber,
    weekNumber: null,
    lifecyclePhase: args.lifecyclePhase,
    tone: 'NEUTRAL',
    headline,
    kind: 'prospect-board',
    subjectPlayerId: prospect.id,
    projectedOverallPick,
  };
}
