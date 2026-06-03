import type { PlayerSkills } from '../types/player.js';
import type { CollegePlayer } from '../types/college.js';
import { getArchetypeById } from '../archetypes/index.js';
import { PROSPECT_PROJECTION } from './college-observation.js';

/**
 * Draft grades (2026-06-03, Daniel-directed) — the NFL.com / Zierlein 8-point
 * scouting scale. Every prospect carries a grade on the SAME scale the scouts
 * and media speak in: a single number (e.g. 6.34) that rolls up to a plain-
 * English projection ("Will eventually be plus starter").
 *
 * Two readings, per the inspector "perceived always shows real" convention:
 *   - REAL grade  — from the prospect's TRUE projected NFL overall (ground truth).
 *   - PERCEIVED grade — from the board's observed skill score (what scouts believe).
 * "No grade" (null) means *not evaluated yet* — a prospect with no scouting read,
 * never an undraftable one. The real grade is always available.
 *
 * The grade maps a 0-100 PROJECTED OVERALL (the mean of a prospect's archetype
 * key skills, blended toward his ceiling by `PROSPECT_PROJECTION` — i.e. the
 * exact quantity scouts estimate, so perceived and real sit on one scale). The
 * `pLo/pHi` input anchors are calibrated to GMSim's generated classes (measured
 * 2026-06-03): #1 ≈ 84.8, #3 ≈ 83.5, #12 ≈ 82, #32 ≈ 80.8, #100 ≈ 78,
 * #256 ≈ 74.5 → a realistic draft shape (~3 All-Pro, ~12 Pro-Bowl-or-better,
 * ~45 Year-1-starter-or-better grades, long backup/UDFA tail).
 *
 * The real scale is NON-contiguous (gaps at e.g. 7.2, 7.6-7.9); we only ever
 * emit grades INSIDE a defined band, so the gaps never appear.
 */
export interface DraftGradeBand {
  /** Inclusive low grade for this band. */
  readonly gradeLo: number;
  /** Inclusive high grade for this band. */
  readonly gradeHi: number;
  /** Projected-overall input window mapping into this band (pLo ≤ P < pHi). */
  readonly pLo: number;
  readonly pHi: number;
  /** Plain-English projection. */
  readonly label: string;
}

/**
 * Bands HIGH → LOW. Grade is linearly interpolated within the matching input
 * window, so a P at `pLo` reads `gradeLo` and a P at `pHi` reads `gradeHi`.
 */
export const DRAFT_GRADE_BANDS: readonly DraftGradeBand[] = [
  { gradeLo: 8.0, gradeHi: 8.0, pLo: 87.0, pHi: 999, label: 'The perfect prospect' },
  { gradeLo: 7.3, gradeHi: 7.5, pLo: 83.5, pHi: 87.0, label: 'Perennial All-Pro' },
  { gradeLo: 7.0, gradeHi: 7.1, pLo: 82.0, pHi: 83.5, label: 'Pro Bowl talent' },
  { gradeLo: 6.7, gradeHi: 6.9, pLo: 80.3, pHi: 82.0, label: 'Year 1 starter' },
  { gradeLo: 6.5, gradeHi: 6.6, pLo: 79.6, pHi: 80.3, label: 'Boom-or-bust potential' },
  { gradeLo: 6.4, gradeHi: 6.49, pLo: 78.8, pHi: 79.6, label: 'Will become good starter within two years' },
  { gradeLo: 6.3, gradeHi: 6.39, pLo: 78.0, pHi: 78.8, label: 'Will eventually be plus starter' },
  { gradeLo: 6.2, gradeHi: 6.29, pLo: 77.0, pHi: 78.0, label: 'Will eventually be average starter' },
  { gradeLo: 6.1, gradeHi: 6.19, pLo: 76.0, pHi: 77.0, label: 'Good backup with the potential to develop into starter' },
  { gradeLo: 6.0, gradeHi: 6.09, pLo: 75.0, pHi: 76.0, label: 'Traits or talent to be above-average backup' },
  { gradeLo: 5.8, gradeHi: 5.99, pLo: 73.3, pHi: 75.0, label: 'Average backup or special-teamer' },
  { gradeLo: 5.6, gradeHi: 5.69, pLo: 72.0, pHi: 73.3, label: 'Candidate for bottom of roster or practice squad' },
  { gradeLo: 5.5, gradeHi: 5.59, pLo: 70.5, pHi: 72.0, label: 'Priority undrafted free agent' },
];

/** The lowest grade the scale defines — the floor for any draftable talent. */
export const DRAFT_GRADE_FLOOR = 5.5;
/** Shown when a grade is not yet available (no scouting read). */
export const NO_DRAFT_GRADE_LABEL = 'Grade not yet available';

/**
 * Map a projected overall (0-100) to a draft grade on the 8-point scale.
 * `null` in → `null` out ("No grade"). Below the UDFA window the talent isn't
 * draftable; we floor at 5.5 so every evaluated prospect still carries a number.
 */
export function draftGradeFromOverall(projectedOverall: number | null): number | null {
  if (projectedOverall === null || Number.isNaN(projectedOverall)) return null;
  const p = projectedOverall;
  for (const band of DRAFT_GRADE_BANDS) {
    if (p >= band.pLo) {
      if (band.pHi - band.pLo <= 0) return round2(band.gradeLo);
      const t = Math.min(1, (p - band.pLo) / (band.pHi - band.pLo));
      return round2(band.gradeLo + t * (band.gradeHi - band.gradeLo));
    }
  }
  return DRAFT_GRADE_FLOOR;
}

/** The plain-English projection for a grade value. */
export function draftGradeLabel(grade: number | null): string {
  if (grade === null || Number.isNaN(grade)) return NO_DRAFT_GRADE_LABEL;
  // Find the band whose [gradeLo, gradeHi] contains the grade; fall back to the
  // nearest by value (handles a floored 5.5 or a rounding edge).
  for (const band of DRAFT_GRADE_BANDS) {
    if (grade >= band.gradeLo - 1e-9 && grade <= band.gradeHi + 1e-9) return band.label;
  }
  if (grade >= 8.0) return DRAFT_GRADE_BANDS[0]!.label;
  return DRAFT_GRADE_BANDS[DRAFT_GRADE_BANDS.length - 1]!.label;
}

/** Two-decimal display string for a grade, or the em dash for "No grade". */
export function formatDraftGrade(grade: number | null): string {
  return grade === null ? '—' : grade.toFixed(2);
}

/** Anything carrying the skill + archetype fields a projected overall needs
 *  (a `CollegePlayer` or a promoted NFL `Player`). */
export interface ProjectableProspect {
  current: PlayerSkills;
  ceiling: PlayerSkills;
  archetype: CollegePlayer['archetype'];
}

/** The archetype's defining ("key") skills — weight ≥ 1.2, matching the draft
 *  board's own football-grade key-skill selection. */
function keySkillKeys(archetypeId: ProjectableProspect['archetype']): (keyof PlayerSkills)[] {
  const archetype = getArchetypeById(archetypeId);
  if (!archetype) return ['technicalSkill', 'footballIq', 'speed'];
  const keys = Object.entries(archetype.skillWeights)
    .filter(([, w]) => (w ?? 1) >= 1.2)
    .map(([k]) => k as keyof PlayerSkills);
  return keys.length > 0 ? keys : ['technicalSkill'];
}

/**
 * A prospect's TRUE projected NFL overall (0-100): the mean of his archetype
 * key skills, each blended `PROSPECT_PROJECTION` of the way from current toward
 * ceiling — the same quantity the draft board's `observedSkillScore` estimates,
 * so the resulting REAL grade is directly comparable to the PERCEIVED grade.
 */
export function prospectProjectedOverall(prospect: ProjectableProspect): number {
  const keys = keySkillKeys(prospect.archetype);
  let sum = 0;
  let n = 0;
  for (const k of keys) {
    const cur = prospect.current[k];
    const ceil = prospect.ceiling[k];
    if (cur === undefined || ceil === undefined) continue;
    sum += cur + PROSPECT_PROJECTION * (ceil - cur);
    n += 1;
  }
  return n > 0 ? sum / n : 0;
}

/** A prospect's REAL (ground-truth) draft grade — always available. */
export function prospectRealDraftGrade(prospect: ProjectableProspect): number {
  return draftGradeFromOverall(prospectProjectedOverall(prospect)) ?? DRAFT_GRADE_FLOOR;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
