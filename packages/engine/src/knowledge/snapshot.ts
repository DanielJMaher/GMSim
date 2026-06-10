/**
 * The knowledge layer's game-safe snapshot — the North Star boundary made
 * concrete (docs/NORTH_STAR.md, CLAUDE.md invariant #3).
 *
 * `ProspectSnapshot` is what a *game* UI is allowed to know about a prospect:
 * public record (identity, measurables, college stats, injuries) plus
 * attributed, qualitative, source-bylined remarks. It is built from the same
 * assembly as the inspector's `ProspectDossier` (`draft/dossier.ts`) with every
 * dev-only / ground-truth / numeric-rating field stripped:
 *
 *   - no `realGrade` / `realValue` / `realProjectedPosition` (ground truth)
 *   - no `perceivedGrade` / `observedValue` (numeric ratings — "a React prop
 *     typed as `{ speed: 88 }` is broken by definition")
 *   - no `band` (engine-internal; the band picks the words and is never spoken)
 *   - confidence surfaces as a qualitative label, never a number (source
 *     reliability is built through observation, not displayed)
 *
 * The inspector remains the sanctioned exception — it reads `ProspectDossier`
 * directly for the perceived/real calibration lens. A player-facing surface
 * that needs something not on this type should extend the knowledge layer,
 * not reach around it.
 */

import type { LeagueState } from '../types/league.js';
import type { Position } from '../types/enums.js';
import type { PlayerId } from '../types/ids.js';
import type { ClassYear, CollegeInjury, CollegeSeasonStats } from '../types/college.js';
import {
  assembleProspectDossier,
  type AttributedPoint,
  type DossierMeasurables,
  type DossierViewer,
} from '../draft/dossier.js';

/**
 * Qualitative confidence — how firmly the source holds the read. Maps from the
 * observation's numeric confidence engine-side; the number itself never crosses
 * this boundary.
 */
export type ConfidenceLabel = 'tentative' | 'moderate' | 'firm';

/** One attributed, qualitative remark — a strength or a concern, bylined. */
export interface AttributedRemark {
  /** The phrase (lowercase fragment; UI sentence-cases). Never contains a rating. */
  text: string;
  /** The scout/evaluator who filed the read this remark derives from. */
  sourceId: string;
  /** Display name for the byline (scout name, or outlet name for media). */
  sourceName: string;
  /** How firmly the source holds it. */
  confidence: ConfidenceLabel;
}

/**
 * Everything a game UI may show about one prospect, from one viewer's
 * standpoint (a team's scouting department, or a media outlet's coverage).
 */
export interface ProspectSnapshot {
  prospectId: PlayerId;
  firstName: string;
  lastName: string;
  /** Public record — where he lines up on Saturdays. */
  collegePosition: Position;
  /**
   * Where THIS viewer believes he projects. May be a missed or invented
   * conversion — the viewer doesn't know that, and neither does this type.
   */
  projectedPosition: Position;
  /** The viewer believes he moves off his college position. */
  isPerceivedConversion: boolean;
  classYear: ClassYear;
  schoolId: string;
  ageYears: number;
  /** Public record: verified size + combine numbers (null if untested). */
  measurables: DossierMeasurables;
  /** Public record: the college box-score history. */
  collegeStats: readonly CollegeSeasonStats[];
  /** Public record: injury history. */
  injuries: readonly CollegeInjury[];
  /** Attributed strengths, strongest first. */
  strengths: readonly AttributedRemark[];
  /** Attributed concerns, most serious first. */
  concerns: readonly AttributedRemark[];
  /** One-line qualitative scheme-fit read. */
  schemeFit: string;
  /** The projection prose (Beast-style). Qualitative throughout. */
  writeup: string;
  /** Who the write-up is bylined to. */
  bylineSourceName: string;
  /** How many independent reads the viewer has on file (their own filings). */
  observationCount: number;
  /** Header label for the evaluating source (team name or outlet name). */
  viewerLabel: string;
}

/** Numeric confidence (0..1) → qualitative label. The number stays engine-side. */
export function confidenceLabel(confidence: number): ConfidenceLabel {
  if (confidence < 0.45) return 'tentative';
  if (confidence < 0.7) return 'moderate';
  return 'firm';
}

function toRemark(p: AttributedPoint): AttributedRemark {
  return {
    text: p.text,
    sourceId: p.sourceId,
    sourceName: p.sourceName,
    confidence: confidenceLabel(p.confidence),
  };
}

/**
 * Assemble the game-safe snapshot one viewer holds on one prospect. Returns
 * `null` only when the prospect or viewer doesn't exist; an unscouted prospect
 * returns the public-record card with empty remark lists and a "no report on
 * file" write-up.
 */
export function prospectSnapshot(
  league: LeagueState,
  viewer: DossierViewer,
  prospectId: PlayerId,
): ProspectSnapshot | null {
  const d = assembleProspectDossier(league, viewer, prospectId);
  if (!d) return null;
  return {
    prospectId: d.prospectId,
    firstName: d.firstName,
    lastName: d.lastName,
    collegePosition: d.collegePosition,
    projectedPosition: d.projectedPosition,
    isPerceivedConversion: d.isPerceivedConversion,
    classYear: d.classYear,
    schoolId: d.schoolId,
    ageYears: d.ageYears,
    measurables: d.measurables,
    collegeStats: d.collegeStats,
    injuries: d.injuries,
    strengths: d.pros.map(toRemark),
    concerns: d.cons.map(toRemark),
    schemeFit: d.schemeFit,
    writeup: d.writeup,
    bylineSourceName: d.bylineSourceName,
    observationCount: d.observationCount,
    viewerLabel: d.viewerLabel,
  };
}
