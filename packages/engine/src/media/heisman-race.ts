/**
 * Heisman race narrative (v0.73) — the media's in-season story thread.
 *
 * Mid-season, outlets start filing a weekly "Heisman watch" — an
 * evolving `NarrativeReport` thread (shared `threadId`) naming the
 * current frontrunner off cumulative season production. The frontrunner
 * can change week to week as the stats accumulate, so the thread reads
 * as a developing race that pays off into the December Heisman ceremony.
 * Hype dials the tone: a clickbait outlet declares it over, a measured
 * one says he "leads the field."
 *
 * Pure + deterministic. Reuses `selectHeisman` (the same scorer that
 * crowns the winner) so the in-season narrative and the eventual award
 * agree on what a Heisman season looks like.
 */

import type { Prng } from '../prng/index.js';
import type { CollegePlayer } from '../types/college.js';
import type {
  CollegeSeasonStatLine,
} from '../types/college-season.js';
import type { MediaOutlet, MediaReport, MediaTone } from '../types/media.js';
import type { LifecyclePhase } from '../season/lifecycle.js';
import { MediaReportId } from '../types/ids.js';
import { COLLEGE_SCHOOLS } from '../data/colleges/index.js';
import { selectHeisman } from '../college-season/awards.js';

const SCHOOL_NAME_BY_ID = new Map<string, string>(
  COLLEGE_SCHOOLS.map((s) => [s.id, s.name] as const),
);

/** The college week (1-indexed) the Heisman watch starts firing. */
export const HEISMAN_WATCH_START_WEEK = 5;

function statLine(line: CollegeSeasonStatLine): string {
  const { passingYards, rushingYards, receivingYards } = line;
  if (passingYards >= rushingYards && passingYards >= receivingYards && passingYards > 0) {
    return `${passingYards} pass yds, ${line.passingTds} TD`;
  }
  if (rushingYards >= receivingYards && rushingYards > 0) {
    return `${rushingYards} rush yds, ${line.rushingTds} TD`;
  }
  if (receivingYards > 0) {
    return `${receivingYards} rec yds, ${line.receivingTds} TD`;
  }
  return `${line.sacks} sacks, ${line.tackles} tkl`;
}

interface RaceTemplate {
  pattern: string;
  tone: MediaTone;
}
const MEASURED: readonly RaceTemplate[] = [
  { pattern: 'Heisman watch, Week {w}: {name} ({school}) leads the field — {stat}.', tone: 'NEUTRAL' },
  { pattern: '{name} has played his way to the front of the Heisman race ({stat} through Week {w}).', tone: 'POSITIVE' },
];
const LOUD: readonly RaceTemplate[] = [
  { pattern: 'Week {w}: {name} is running away with the Heisman. {stat}. It’s over.', tone: 'SPECULATIVE' },
  { pattern: 'Hand {name} ({school}) the Heisman now — {stat} and nobody is close.', tone: 'SPECULATIVE' },
];

/**
 * Generate this week's Heisman-watch reports. A rotating outlet files
 * the watch each week; the loudest college outlet chimes in too. Empty
 * before `HEISMAN_WATCH_START_WEEK` or when there's no production yet.
 */
export function generateHeismanRaceReports(
  prng: Prng,
  args: {
    outlets: Readonly<Record<string, MediaOutlet>>;
    statsLines: readonly CollegeSeasonStatLine[];
    pool: readonly CollegePlayer[];
    weekNumber: number; // 1-indexed college week
    filedOnTick: number;
    seasonNumber: number;
  },
): MediaReport[] {
  if (args.weekNumber < HEISMAN_WATCH_START_WEEK) return [];

  const race = selectHeisman(args.statsLines, args.seasonNumber, { finalistCount: 3 });
  if (!race) return [];

  const frontrunner = args.pool.find((cp) => cp.id === race.winnerId);
  if (!frontrunner) return [];
  const line = args.statsLines.find((l) => l.playerId === race.winnerId);
  if (!line) return [];

  const collegeOutlets = Object.values(args.outlets)
    .filter((o) => o.focus === 'COLLEGE')
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (collegeOutlets.length === 0) return [];

  // A rotating outlet files each week; the loudest outlet also chimes
  // in (distinct from the rotating one).
  const filers = new Set<MediaOutlet>();
  filers.add(collegeOutlets[args.weekNumber % collegeOutlets.length]!);
  const loudest = collegeOutlets.reduce((a, b) => (b.hypeSpectrum > a.hypeSpectrum ? b : a));
  if (loudest.hypeSpectrum >= 8) filers.add(loudest);

  const school = SCHOOL_NAME_BY_ID.get(frontrunner.schoolId) ?? frontrunner.schoolId;
  const stat = statLine(line);
  const name = `${frontrunner.firstName} ${frontrunner.lastName}`;
  const threadId = `heisman-S${args.seasonNumber}`;

  const reports: MediaReport[] = [];
  for (const outlet of filers) {
    const loud = outlet.hypeSpectrum >= 6;
    const template = prng.fork(`o:${outlet.id}`).pick(loud ? LOUD : MEASURED);
    const headline = template.pattern
      .replace(/\{w\}/g, String(args.weekNumber))
      .replace(/\{name\}/g, name)
      .replace(/\{school\}/g, school)
      .replace(/\{stat\}/g, stat);
    reports.push({
      id: MediaReportId(`HEISMAN_S${args.seasonNumber}_W${args.weekNumber}_${outlet.id}`),
      outletId: outlet.id,
      filedOnTick: args.filedOnTick,
      seasonNumber: args.seasonNumber,
      weekNumber: args.weekNumber,
      lifecyclePhase: 'COLLEGE_WEEK' as LifecyclePhase,
      tone: template.tone,
      headline,
      kind: 'narrative',
      threadId,
    });
  }
  return reports;
}
