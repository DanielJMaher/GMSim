import type { PlayerSkills } from '../types/player.js';
import type { Position } from '../types/enums.js';
import type { CollegePlayer } from '../types/college.js';
import { getArchetypeById } from '../archetypes/index.js';
import { athleticBaseline, POSITION_BASELINED_SKILLS, type AthleticBaseline } from '../players/athletic-baselines.js';
import { softCap } from '../players/skills.js';
import { PROSPECT_PROJECTION } from './college-observation.js';
import { PHYS_DEV_WEIGHT } from './board.js';

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
 * The grade maps a 0-100 PROJECTED OVERALL — the board's football+athletic
 * score (see `prospectProjectedOverall`), the exact quantity the scouts'
 * `observedSkillScore` estimates, so perceived and real sit on ONE scale. The
 * `pLo/pHi` anchors are calibrated to GMSim's generated classes (re-measured
 * 2026-06-03 on this unified scale): top of class ≈ 89, #12 ≈ 83, #32 ≈ 81,
 * #100 ≈ 78, #256 ≈ 73 → a realistic draft shape, long backup/UDFA tail.
 *
 * The 8.0 "perfect prospect" window opens at 96 — ABOVE the realistic max
 * (~92, a rare freak) — so it stays mythical and essentially never prints; the
 * genuine elite tops out at "Perennial All-Pro" (7.3-7.5). (Before this, the
 * perceived input — `observedSkillScore`, which carries an athletic-deviation
 * bonus the old real-grade input omitted — overshot the old open-ended 8.0
 * threshold and printed spurious "perfect prospect" grades for freak athletes.)
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
  { gradeLo: 8.0, gradeHi: 8.0, pLo: 96.0, pHi: 999, label: 'The perfect prospect' },
  { gradeLo: 7.3, gradeHi: 7.5, pLo: 84.5, pHi: 96.0, label: 'Perennial All-Pro' },
  { gradeLo: 7.0, gradeHi: 7.1, pLo: 82.0, pHi: 84.5, label: 'Pro Bowl talent' },
  { gradeLo: 6.7, gradeHi: 6.9, pLo: 79.5, pHi: 82.0, label: 'Year 1 starter' },
  { gradeLo: 6.5, gradeHi: 6.6, pLo: 78.5, pHi: 79.5, label: 'Boom-or-bust potential' },
  { gradeLo: 6.4, gradeHi: 6.49, pLo: 77.5, pHi: 78.5, label: 'Will become good starter within two years' },
  { gradeLo: 6.3, gradeHi: 6.39, pLo: 76.5, pHi: 77.5, label: 'Will eventually be plus starter' },
  { gradeLo: 6.2, gradeHi: 6.29, pLo: 75.5, pHi: 76.5, label: 'Will eventually be average starter' },
  { gradeLo: 6.1, gradeHi: 6.19, pLo: 74.5, pHi: 75.5, label: 'Good backup with the potential to develop into starter' },
  { gradeLo: 6.0, gradeHi: 6.09, pLo: 73.5, pHi: 74.5, label: 'Traits or talent to be above-average backup' },
  { gradeLo: 5.8, gradeHi: 5.99, pLo: 71.5, pHi: 73.5, label: 'Average backup or special-teamer' },
  { gradeLo: 5.6, gradeHi: 5.69, pLo: 70.0, pHi: 71.5, label: 'Candidate for bottom of roster or practice squad' },
  { gradeLo: 5.5, gradeHi: 5.59, pLo: 68.0, pHi: 70.0, label: 'Priority undrafted free agent' },
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
 *  (a `CollegePlayer`, which has `nflProjectedPosition`, or a promoted NFL
 *  `Player`, which has `position`). */
export interface ProjectableProspect {
  current: PlayerSkills;
  ceiling: PlayerSkills;
  archetype: CollegePlayer['archetype'];
  /** NFL projected position (CollegePlayer) — used for the athletic baseline. */
  nflProjectedPosition?: Position;
  /** NFL position (promoted Player) — fallback when nflProjectedPosition absent. */
  position?: Position;
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

function meanBaseline(b: AthleticBaseline): number {
  return (b.speed + b.acceleration + b.agility + b.changeOfDirection + b.jumping + b.strength) / 6;
}

/**
 * A prospect's TRUE projected NFL overall (0-100): the "perfect-scout" version
 * of the draft board's `observedSkillScore`, computed the SAME way so the REAL
 * grade lands on the SAME scale as the PERCEIVED grade (otherwise a freak
 * athlete reads perceived ≫ real and prints a spurious 8.0).
 *
 *   football   = mean of the archetype's NON-physical key skills, each blended
 *                `PROSPECT_PROJECTION` from current toward ceiling
 *   athleticDev= mean DEVIATION of the archetype's PHYSICAL key skills from the
 *                position athletic baseline (a freak grades up, a stiff down)
 *   overall    = football + athleticDev · PHYS_DEV_WEIGHT
 *
 * Mirrors `aggregateCollegeObservations` in board.ts (with uniform weights and
 * the softCap(baseline) athletic reference the board falls back to).
 */
export function prospectProjectedOverall(prospect: ProjectableProspect): number {
  const keys = keySkillKeys(prospect.archetype);
  const pos = prospect.nflProjectedPosition ?? prospect.position;
  const athBase = pos ? athleticBaseline(pos) : null;

  let footballSum = 0;
  let footballN = 0;
  let devSum = 0;
  let devN = 0;
  for (const k of keys) {
    const cur = prospect.current[k];
    const ceil = prospect.ceiling[k];
    if (cur === undefined || ceil === undefined) continue;
    const projected = cur + PROSPECT_PROJECTION * (ceil - cur);
    if (POSITION_BASELINED_SKILLS.has(k as string) && athBase) {
      const base = softCap(athBase[k as keyof AthleticBaseline]);
      devSum += projected - base;
      devN += 1;
    } else {
      footballSum += projected;
      footballN += 1;
    }
  }

  const football = footballN > 0 ? footballSum / footballN : null;
  const athleticDev = devN > 0 ? devSum / devN : 0;
  if (football !== null) return football + athleticDev * PHYS_DEV_WEIGHT;
  // All key skills are physical (no football signal) — fall back to the absolute
  // physical read, matching the board's same-case fallback.
  if (devN > 0 && athBase) return athleticDev + meanBaseline(athBase);
  return 0;
}

/** A prospect's REAL (ground-truth) draft grade — always available. */
export function prospectRealDraftGrade(prospect: ProjectableProspect): number {
  return draftGradeFromOverall(prospectProjectedOverall(prospect)) ?? DRAFT_GRADE_FLOOR;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
