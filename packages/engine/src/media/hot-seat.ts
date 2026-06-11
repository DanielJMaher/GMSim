import type { Prng } from '../prng/index.js';
import type { LeagueState } from '../types/league.js';
import type { TeamState } from '../types/team.js';
import type { MediaOutlet, MediaReport, HotSeatReport, HotSeatHeat, MediaTone } from '../types/media.js';
import type { LifecyclePhase } from '../season/lifecycle.js';
import type { TeamId } from '../types/ids.js';
import { MediaReportId } from '../types/ids.js';
import { voicePrng } from './voice.js';
import { computeRecords } from '../season/standings.js';
import { previewSeatPressure } from '../npc-ai/front-office.js';

/**
 * Hot-seat coverage (S3, v0.140) — the front-office lifecycle as a
 * media object. Outlets read the HIDDEN seat pressure through their own
 * accuracy and hype: a sharp insider lands near the real number, a
 * sports-radio outlet misses wide and runs hot — so some outlets call
 * firings that never come, and the player learns who to believe by
 * watching what actually happens. That's the entire point.
 *
 * Living Voice split: the WORLD prng decides which chairs get covered,
 * which outlets file, and how wrong they are (selection + perception
 * are world facts); `voiceSeed` decides only the words.
 *
 * Game surfaces consume this through `knowledge/front-office.ts`
 * (qualitative heat bands, no numbers); the inspector reads
 * `perceivedSeat` for the perceived/real calibration pair.
 */

/** A perceived seat below this isn't a story — the outlet stays quiet. */
export const HOT_SEAT_REPORT_FLOOR = 45;
/** Real preview pressure above this puts a chair on the media radar. */
export const HOT_SEAT_RADAR_FLOOR = 35;
/** League-wide cap per tick — hot-seat talk is a beat, not a flood. */
export const HOT_SEAT_MAX_PER_TICK = 4;

const HC_TEMPLATES: Record<HotSeatHeat, readonly string[]> = {
  warm: [
    "Quietly, {subject}'s seat in {city} is getting warm",
    'Pressure is building on {subject} after another flat stretch',
    '{team} brass watching {subject} closely, per sources',
    'Patience in {city} is not unlimited for {subject}',
  ],
  hot: [
    'Sources: {subject} is coaching for his job in {city}',
    "{subject}'s seat is officially hot as the {team} stumble",
    'Patience wearing thin with {subject}, league sources say',
    'The {team} are evaluating everything — including {subject}',
  ],
  inferno: [
    '{subject} not expected to survive without a dramatic turnaround',
    "It would 'take a miracle' for {subject} to keep his job in {city}",
    'League circles already treat {subject} as a dead man walking',
    "Barring a stunner, {subject}'s time in {city} is over, sources say",
  ],
};

const GM_TEMPLATES: Record<HotSeatHeat, readonly string[]> = {
  warm: [
    'Whispers in {city}: ownership wants more from {subject}’s roster',
    '{team} front office under quiet review, per sources',
    'Questions about {subject}’s draft record are getting louder',
  ],
  hot: [
    'Sources: GM {subject}’s roster plan is under organizational review',
    '{subject}’s moves face internal scrutiny as the {team} sink',
    'Ownership pressing {subject} for answers in {city}',
  ],
  inferno: [
    "Ownership has 'seen enough' of GM {subject}, sources say",
    '{subject} not expected to survive the offseason in {city}',
    'A full front-office teardown is on the table in {city}',
  ],
};

function heatFor(perceived: number): HotSeatHeat {
  if (perceived >= 85) return 'inferno';
  if (perceived >= 65) return 'hot';
  return 'warm';
}

function toneFor(heat: HotSeatHeat): MediaTone {
  return heat === 'warm' ? 'SPECULATIVE' : 'CRITICAL';
}

function fill(template: string, team: TeamState, subject: string): string {
  return template
    .replace(/\{subject\}/g, subject)
    .replace(/\{team\}/g, team.identity.nickname)
    .replace(/\{city\}/g, team.identity.location);
}

interface ChairCandidate {
  team: TeamState;
  chair: 'HC' | 'GM';
  realPreview: number;
  subjectName: string;
}

/**
 * Generate this tick's hot-seat reports. `weekIdx === null` is the
 * preseason batch ("enters the season on the hot seat" — carried
 * pressure only, no games yet).
 */
export function generateHotSeatReports(
  prng: Prng,
  league: LeagueState,
  weekIdx: number | null,
  filedOnTick: number,
  phase: LifecyclePhase,
): readonly MediaReport[] {
  const records = weekIdx !== null ? computeRecords(league) : null;

  // 1. The radar: chairs whose REAL previewed pressure merits coverage.
  const candidates: ChairCandidate[] = [];
  for (const team of Object.values(league.teams)) {
    const owner = league.owners[team.ownerId];
    if (!owner) continue;
    const record = records?.get(team.identity.id) ?? null;
    const preview = previewSeatPressure(team, owner, record, league.seasonNumber);
    const fo = team.frontOffice;
    if (!fo.hcVacant && preview.hc > HOT_SEAT_RADAR_FLOOR) {
      const hc = league.coaches[team.headCoachId];
      if (hc) {
        candidates.push({ team, chair: 'HC', realPreview: preview.hc, subjectName: hc.name });
      }
    }
    if (!fo.gmVacant && preview.gm > HOT_SEAT_RADAR_FLOOR) {
      const gm = league.gms[team.gmId];
      if (gm) {
        candidates.push({ team, chair: 'GM', realPreview: preview.gm, subjectName: gm.name });
      }
    }
  }
  if (candidates.length === 0) return [];
  candidates.sort((a, b) => b.realPreview - a.realPreview);

  // 2. Outlets file. Local beat first, then a national voice — louder
  //    outlets are more likely to chase the story.
  const nationals = Object.values(league.mediaOutlets).filter(
    (o) => o.market === 'NATIONAL' && (o.focus === 'NFL' || o.focus === 'BOTH'),
  );
  const reports: HotSeatReport[] = [];
  let counter = 0;

  for (const cand of candidates) {
    if (reports.length >= HOT_SEAT_MAX_PER_TICK) break;
    const chairPrng = prng.fork(`chair:${cand.team.identity.id}:${cand.chair}`);

    const local = Object.values(league.mediaOutlets).find(
      (o) => typeof o.market === 'object' && o.market.localTo === cand.team.identity.id,
    );
    const national =
      nationals.length > 0
        ? chairPrng.weighted(nationals.map((o) => ({ value: o, weight: o.hypeSpectrum })))
        : undefined;

    for (const outlet of [local, national]) {
      if (!outlet || reports.length >= HOT_SEAT_MAX_PER_TICK) continue;
      const report = fileReport(
        chairPrng.fork(`outlet:${outlet.id}`),
        league,
        cand,
        outlet,
        weekIdx,
        filedOnTick,
        phase,
        () => MediaReportId(`MR_HS_S${league.seasonNumber}_T${filedOnTick}_${counter++}`),
      );
      if (report) reports.push(report);
    }
  }
  return reports;
}

function fileReport(
  prng: Prng,
  league: LeagueState,
  cand: ChairCandidate,
  outlet: MediaOutlet,
  weekIdx: number | null,
  filedOnTick: number,
  phase: LifecyclePhase,
  nextId: () => ReturnType<typeof MediaReportId>,
): HotSeatReport | null {
  // The outlet's PERCEPTION: real ± accuracy noise, leaned by hype.
  const noise = prng.normal(0, (10 - outlet.accuracySpectrum) * 0.9);
  const hypeLean = (outlet.hypeSpectrum - 5.5) * 3;
  const perceived = cand.realPreview + noise + hypeLean;
  // Measured outlets stay silent on borderline reads.
  if (perceived < HOT_SEAT_REPORT_FLOOR) return null;

  const heat = heatFor(perceived);
  const templates = cand.chair === 'HC' ? HC_TEMPLATES[heat] : GM_TEMPLATES[heat];
  // Words ride the voice seed — same world, different phrasing.
  const vp = voicePrng(
    league.voiceSeed,
    'hot-seat',
    league.seasonNumber,
    filedOnTick,
    outlet.id,
    cand.team.identity.id,
    cand.chair,
  );
  const headline = fill(vp.pick(templates), cand.team, cand.subjectName);

  return {
    kind: 'hot-seat',
    id: nextId(),
    outletId: outlet.id,
    filedOnTick,
    seasonNumber: league.seasonNumber,
    weekNumber: weekIdx !== null ? weekIdx + 1 : null,
    lifecyclePhase: phase,
    tone: toneFor(heat),
    headline,
    subjectTeamId: cand.team.identity.id as TeamId,
    chair: cand.chair,
    subjectName: cand.subjectName,
    perceivedSeat: Math.round(perceived * 10) / 10,
    heat,
  };
}
