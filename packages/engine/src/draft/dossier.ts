/**
 * Prospect scouting dossier (v0.125) — what one team's scouts (or one media
 * outlet) are SAYING about a prospect, assembled for the scouting-report UI.
 *
 * This is the visible payoff of the Scribe/Narrator + Living Voice work, and the
 * home of Living Voice **Slice C**: the strengths/concerns KEY IN on the
 * player's underlying stats — each point is derived from a specific source's
 * *noisy observed read* of an attribute (`CollegePlayerObservation.skills`), so
 * the source can be **wrong**, and each point is **attributed** to the scout
 * whose read drove it. The wording rides `voiceSeed` (Slice B), so the same
 * world said by the same staff reads differently across playthroughs.
 *
 * Per North Star this assembles from the knowledge layer (observations), never
 * from ground truth — the prose/pros/cons never speak a number or a band. The
 * `observedValue` / `realValue` carried on each point are DEV-ONLY (the
 * inspector's "perceived always shows real" calibration convention); the game UI
 * would render only the prose + attribution.
 */

import type { LeagueState } from '../types/league.js';
import type { Position } from '../types/enums.js';
import type { PlayerSkills } from '../types/player.js';
import type { PlayerId, TeamId, MediaOutletId, ScoutId } from '../types/ids.js';
import type {
  CollegePlayer,
  CollegePlayerObservation,
  CombineMeasurables,
  CollegeSeasonStats,
  CollegeInjury,
  ClassYear,
  DraftBoardReason,
} from '../types/college.js';
import type { Prng } from '../prng/index.js';
import { voicePrng } from '../media/voice.js';
import { bucketFor } from '../media/scout-vocabulary.js';
import {
  bandOf,
  bandPolarity,
  describeSkill,
  REPORT_SKILLS_BY_BUCKET,
  type SkillBand,
} from '../media/skill-vocabulary.js';

type SkillKey = keyof PlayerSkills;

/** Who is doing the evaluating — a team's scouting staff or a media outlet. */
export type DossierViewer =
  | { kind: 'team'; teamId: TeamId }
  | { kind: 'outlet'; outletId: MediaOutletId };

/** One attributed strength or concern, derived from a source's banded read. */
export interface AttributedPoint {
  skillKey: SkillKey;
  /** Which band the source's read fell in (drives the words; never spoken). */
  band: SkillBand;
  /** The phrase naming the attribute (lowercase fragment; UI sentence-cases). */
  text: string;
  /** The scout/evaluator who filed this read. */
  sourceId: string;
  /** Display name for the byline (scout name, or outlet name for media). */
  sourceName: string;
  /** Source's confidence on this read, 0..1. */
  confidence: number;
  /** DEV-ONLY: the source's observed (perceived) value, 0..100. */
  observedValue: number;
  /** DEV-ONLY: the prospect's true current value, 0..100. */
  realValue: number;
}

export interface DossierMeasurables {
  /** Truth-size for the header (height/weight/arm/hand). */
  heightInches: number;
  weightLbs: number;
  armLengthInches: number;
  handSizeInches: number;
  /** Reported combine numbers (null if no combine has run / prospect skipped). */
  combine: CombineMeasurables | null;
  /** Whether the VIEWER team attended this prospect's school pro day (null for outlet). */
  proDayAttendedByViewer: boolean | null;
}

export interface ProspectDossier {
  prospectId: PlayerId;
  firstName: string;
  lastName: string;
  collegePosition: Position;
  projectedPosition: Position;
  classYear: ClassYear;
  schoolId: string;
  ageYears: number;
  measurables: DossierMeasurables;
  collegeStats: readonly CollegeSeasonStats[];
  injuries: readonly CollegeInjury[];
  pros: readonly AttributedPoint[];
  cons: readonly AttributedPoint[];
  /** One-line scheme-fit read (qualitative). */
  schemeFit: string;
  /** Beast-style projection prose; length scales with the source's read of stature. */
  writeup: string;
  /** Who the write-up is bylined to (lead scout, or the outlet). */
  bylineSourceName: string;
  /** Source's perceived overall (confidence-weighted observed), 0..100, or null if unscouted. */
  perceivedGrade: number | null;
  /** DEV-ONLY: true current overall, 0..100. */
  realGrade: number | null;
  /** How many independent reads the viewer has on this prospect. */
  observationCount: number;
  /** Header label for the evaluating source (team name or outlet name). */
  viewerLabel: string;
}

const MAX_PROS = 5;
const MAX_CONS = 4;
/** Band-neutral midpoint used to weight concern severity. */
const CONCERN_PIVOT = 57;

function viewerKey(viewer: DossierViewer): string {
  return viewer.kind === 'team' ? (viewer.teamId as string) : (viewer.outletId as string);
}

/** Simple driver-license age at Sept 1 of the current sim year. */
function ageAt(birthDate: string, seasonNumber: number): number {
  const simYear = 2026 + (seasonNumber - 1);
  const ref = Date.parse(`${simYear}-09-01`);
  const dob = Date.parse(birthDate);
  if (Number.isNaN(ref) || Number.isNaN(dob)) return 0;
  return Math.max(0, Math.floor((ref - dob) / (365.25 * 24 * 3600 * 1000)));
}

function meanOverKeys(skills: PlayerSkills, keys: readonly SkillKey[]): number | null {
  const rec = skills as unknown as Record<string, number>;
  let s = 0;
  let n = 0;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === 'number') {
      s += v;
      n += 1;
    }
  }
  return n > 0 ? Math.round(s / n) : null;
}

const REASON_LABEL: Record<DraftBoardReason, string> = {
  BLUE_CHIP: 'A blue-chip target',
  SCHEME_FIT: 'A scheme fit',
  POSITIONAL_NEED: 'Fills a position of need',
  CONVERSION_PROJECTION: 'A projection / conversion bet',
  DEVELOPMENTAL: 'A developmental upside bet',
};

function fitWord(schemeFit: number): string {
  if (schemeFit >= 1.15) return 'an ideal';
  if (schemeFit >= 1.0) return 'a clean';
  if (schemeFit >= 0.9) return 'a workable';
  return 'a projected';
}

/** Sentence pool for the bottom-line projection, keyed off the perceived grade. */
function projectionLine(prng: Prng, grade: number | null): string {
  const g = grade ?? 0;
  if (g >= 82) {
    return prng.pick([
      'An early-round talent who should come off the board on the draft’s first day.',
      'A top-of-the-board prospect — the traits are special.',
    ]);
  }
  if (g >= 72) {
    return prng.pick([
      'A Day 2 projection with a starter’s ceiling.',
      'Projects as an early contributor who can grow into a starter.',
    ]);
  }
  if (g >= 62) {
    return prng.pick([
      'A mid-round developmental bet with a defined role.',
      'The kind of value pick that pays off by year two.',
    ]);
  }
  if (g >= 52) {
    return prng.pick([
      'A late-round flier / priority free-agent type.',
      'A depth and special-teams projection who has to earn it.',
    ]);
  }
  return prng.pick([
    'A deep-roster projection who’ll have to win a job in camp.',
    'A camp-body evaluation at this stage — the tools need to show up.',
  ]);
}

function buildWriteup(
  prng: Prng,
  args: {
    name: string;
    projPos: Position;
    schoolName: string;
    pros: readonly AttributedPoint[];
    cons: readonly AttributedPoint[];
    perceivedGrade: number | null;
  },
): string {
  const { name, projPos, schoolName, pros, cons, perceivedGrade } = args;
  const parts: string[] = [];
  parts.push(
    prng.pick([
      `${name} projects as a ${projPos} at the next level.`,
      `On tape, ${name} fits the ${projPos} mold.`,
      `${name} comes out of ${schoolName} with a ${projPos} projection.`,
    ]),
  );
  if (pros.length > 0) {
    const lead = pros[0]!.text;
    const second = pros[1]?.text;
    parts.push(
      second
        ? prng.pick([
            `His calling card is ${lead}, backed by ${second}.`,
            `He wins with ${lead} and ${second}.`,
          ])
        : prng.pick([`His calling card is ${lead}.`, `He wins with ${lead}.`]),
    );
  }
  if (cons.length > 0) {
    parts.push(
      prng.pick([
        `The concern is ${cons[0]!.text}.`,
        `He’ll have to answer ${cons[0]!.text} against NFL competition.`,
        `Scouts will flag ${cons[0]!.text}.`,
      ]),
    );
  }
  parts.push(projectionLine(prng, perceivedGrade));
  // Top prospects get more words (Beast: the names everyone knows run long).
  if ((perceivedGrade ?? 0) >= 78 && pros.length >= 3) {
    parts.push(
      prng.pick([
        'The traits are real and the floor is high.',
        'There’s starter-or-better upside if the development hits.',
        'Teams will have him circled early.',
      ]),
    );
  }
  return parts.join(' ');
}

/**
 * Assemble the dossier one viewer (team or outlet) holds on one prospect.
 * Returns `null` only when the prospect or viewer doesn't exist; an unscouted
 * prospect returns a populated identity card with empty pros/cons and a
 * "no report on file" write-up so the UI can still show who he is.
 */
export function assembleProspectDossier(
  league: LeagueState,
  viewer: DossierViewer,
  prospectId: PlayerId,
): ProspectDossier | null {
  const prospect = league.collegePool.find((cp) => cp.id === prospectId);
  if (!prospect) return null;

  const sourceNames = new Map<string, string>();
  const obs: CollegePlayerObservation[] = [];
  let viewerLabel = '';
  let proDayAttendedByViewer: boolean | null = null;

  if (viewer.kind === 'team') {
    const team = league.teams[viewer.teamId];
    if (!team) return null;
    viewerLabel = `${team.identity.location} ${team.identity.nickname}`;
    const scoutIds = new Set<string>(team.collegeScoutIds as unknown as string[]);
    for (const o of league.collegeObservations) {
      if (o.collegePlayerId !== prospectId || !scoutIds.has(o.scoutId as string)) continue;
      obs.push(o);
      const sc = league.collegeScouts[o.scoutId];
      if (sc) sourceNames.set(o.scoutId as string, sc.name);
    }
    // The head coach's own visit reads count as a source too.
    const coach = league.coaches[team.headCoachId];
    if (coach) {
      for (const cv of league.coachVisitObservations) {
        if (cv.collegePlayerId !== prospectId || cv.coachId !== coach.id) continue;
        obs.push({
          scoutId: cv.coachId as unknown as ScoutId,
          collegePlayerId: cv.collegePlayerId,
          observedOnTick: cv.observedOnTick,
          skills: cv.skills,
          confidence: cv.confidence,
        });
        sourceNames.set(coach.id as string, `${coach.name} (HC)`);
      }
    }
    const rec = (league.proDayAttendance[viewer.teamId] ?? []).find(
      (r) => r.schoolId === prospect.schoolId,
    );
    proDayAttendedByViewer = rec ? rec.attended : false;
  } else {
    const outlet = league.mediaOutlets[viewer.outletId];
    if (!outlet) return null;
    viewerLabel = outlet.name;
    const prefix = `${viewer.outletId as string}::`;
    for (const o of league.mediaCollegeObservations) {
      if (o.collegePlayerId !== prospectId || !(o.scoutId as string).startsWith(prefix)) continue;
      obs.push(o);
      sourceNames.set(o.scoutId as string, outlet.name);
    }
  }

  const projPos = prospect.nflProjectedPosition;
  const reportSkills = REPORT_SKILLS_BY_BUCKET[bucketFor(projPos)];
  const currentRec = prospect.current as unknown as Record<string, number>;
  const vKey = viewerKey(viewer);

  // For each report-worthy attribute, the source that rated it HIGHEST can drive
  // a strength; the source that rated it LOWEST can drive a concern. Different
  // sources driving different points is exactly the cross-scout disagreement we
  // want to surface.
  const pros: AttributedPoint[] = [];
  const cons: AttributedPoint[] = [];
  for (const skill of reportSkills) {
    let best: { o: CollegePlayerObservation; v: number } | null = null;
    let worst: { o: CollegePlayerObservation; v: number } | null = null;
    for (const o of obs) {
      const v = o.skills[skill];
      if (typeof v !== 'number') continue;
      if (best === null || v > best.v) best = { o, v };
      if (worst === null || v < worst.v) worst = { o, v };
    }
    const realValue = Math.round(currentRec[skill] ?? 0);
    if (best && bandPolarity(bandOf(best.v)) === 'positive') {
      const band = bandOf(best.v);
      const id = best.o.scoutId as string;
      const text = describeSkill(skill, band, projPos, voicePrng(league.voiceSeed, 'pro', vKey, prospectId, id, skill));
      if (text) {
        pros.push({
          skillKey: skill,
          band,
          text,
          sourceId: id,
          sourceName: sourceNames.get(id) ?? id,
          confidence: best.o.confidence[skill] ?? 0.5,
          observedValue: Math.round(best.v),
          realValue,
        });
      }
    }
    if (worst && bandPolarity(bandOf(worst.v)) === 'negative') {
      const band = bandOf(worst.v);
      const id = worst.o.scoutId as string;
      const text = describeSkill(skill, band, projPos, voicePrng(league.voiceSeed, 'con', vKey, prospectId, id, skill));
      if (text) {
        cons.push({
          skillKey: skill,
          band,
          text,
          sourceId: id,
          sourceName: sourceNames.get(id) ?? id,
          confidence: worst.o.confidence[skill] ?? 0.5,
          observedValue: Math.round(worst.v),
          realValue,
        });
      }
    }
  }
  // Strongest reads lead (Beast: biggest strength first); cap the lists.
  pros.sort((a, b) => b.observedValue * b.confidence - a.observedValue * a.confidence);
  cons.sort(
    (a, b) =>
      (CONCERN_PIVOT - b.observedValue) * b.confidence -
      (CONCERN_PIVOT - a.observedValue) * a.confidence,
  );
  const prosCapped = pros.slice(0, MAX_PROS);
  const consCapped = cons.slice(0, MAX_CONS);

  // Perceived overall — confidence-weighted mean of the viewer's reads over the
  // report skills. Real overall — truth, dev-only.
  let ws = 0;
  let wsum = 0;
  for (const o of obs) {
    for (const skill of reportSkills) {
      const v = o.skills[skill];
      if (typeof v !== 'number') continue;
      const c = o.confidence[skill] ?? 0.5;
      ws += v * c;
      wsum += c;
    }
  }
  const perceivedGrade = wsum > 0 ? Math.round(ws / wsum) : null;
  const realGrade = meanOverKeys(prospect.current, reportSkills);

  // Lead source for the byline: most reads, tie → highest mean confidence.
  let bylineSourceName = viewerLabel;
  if (viewer.kind === 'team' && obs.length > 0) {
    const byId = new Map<string, { count: number; conf: number; n: number }>();
    for (const o of obs) {
      const id = o.scoutId as string;
      const cur = byId.get(id) ?? { count: 0, conf: 0, n: 0 };
      cur.count += 1;
      for (const c of Object.values(o.confidence)) {
        if (typeof c === 'number') {
          cur.conf += c;
          cur.n += 1;
        }
      }
      byId.set(id, cur);
    }
    let leadId: string | null = null;
    let leadKey = -1;
    for (const [id, v] of byId) {
      const key = v.count * 1000 + (v.n > 0 ? v.conf / v.n : 0);
      if (key > leadKey) {
        leadKey = key;
        leadId = id;
      }
    }
    if (leadId) bylineSourceName = sourceNames.get(leadId) ?? viewerLabel;
  }

  // Scheme fit — reuse the team's own board read when present; neutral otherwise.
  let schemeFit: string;
  if (viewer.kind === 'team') {
    const entry = (league.draftBoards[viewer.teamId] ?? []).find(
      (e) => e.collegePlayerId === prospectId,
    );
    if (entry) {
      const assigned =
        entry.assignedPosition && entry.assignedPosition !== projPos
          ? `, projected to ${entry.assignedPosition}`
          : '';
      schemeFit = `${REASON_LABEL[entry.reason]} — ${fitWord(entry.schemeFit)} fit in this scheme${assigned}.`;
    } else {
      schemeFit = `Not currently on the board — a scheme projection at ${projPos}.`;
    }
  } else {
    schemeFit = `Scheme-agnostic ${projPos} evaluation; fit depends on the room.`;
  }

  const schoolName = prospect.schoolId; // UI maps id → display name.
  const writeup =
    obs.length === 0
      ? `${viewerLabel} has no report on file for ${prospect.firstName} ${prospect.lastName} yet.`
      : buildWriteup(voicePrng(league.voiceSeed, 'writeup', vKey, prospectId), {
          name: `${prospect.firstName} ${prospect.lastName}`,
          projPos,
          schoolName,
          pros: prosCapped,
          cons: consCapped,
          perceivedGrade,
        });

  return {
    prospectId,
    firstName: prospect.firstName,
    lastName: prospect.lastName,
    collegePosition: prospect.collegePosition,
    projectedPosition: projPos,
    classYear: prospect.classYear,
    schoolId: prospect.schoolId,
    ageYears: ageAt(prospect.birthDate, league.seasonNumber),
    measurables: {
      heightInches: prospect.measurables.heightInches,
      weightLbs: prospect.measurables.weightLbs,
      armLengthInches: prospect.measurables.armLengthInches,
      handSizeInches: prospect.measurables.handSizeInches,
      combine: league.combineResults[prospectId] ?? null,
      proDayAttendedByViewer,
    },
    collegeStats: prospect.collegeStats,
    injuries: prospect.injuryHistory,
    pros: prosCapped,
    cons: consCapped,
    schemeFit,
    writeup,
    bylineSourceName,
    perceivedGrade,
    realGrade,
    observationCount: obs.length,
    viewerLabel,
  };
}

/** Convenience: a prospect's college-pool record, for selectors. */
export function findProspect(league: LeagueState, prospectId: PlayerId): CollegePlayer | undefined {
  return league.collegePool.find((cp) => cp.id === prospectId);
}
