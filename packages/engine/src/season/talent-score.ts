import type { Player, TalentGrade } from '../types/player.js';
import type { AgingBucket } from '../players/aging-curves.js';
import { agingBucketFor } from '../players/aging-curves.js';
import { gradeToTier } from '../players/skills.js';
import { keySkillAverage } from '../archetypes/key-skill.js';

/**
 * Sustained-talent re-grade (PFF model, 2026-06-30, Daniel-directed).
 *
 * THE PROBLEM IT REPLACES. The old offseason re-grade (`deriveGradeFromSkills`)
 * mapped each player's CURRENT key-skill average to a grade against ONE absolute
 * cross-position threshold. But every technique skill ages as category
 * `technical` (declines late and gently), so positions whose key skills are all
 * technical/mental — QB and K/P — hold their ability near ceiling for a whole
 * career and PILE UP in the standing star pool (probe: QB stars 4.8→17.5/league
 * over 8 seasons, K/P 4.3→12.8 against its suppressed draft supply, while OL and
 * LB collapse). The league-wide star RATE stayed on target; its COMPOSITION
 * drifted hard toward QB/K.
 *
 * THE MODEL. Each player carries a sticky {@link Player.talentScore} (0..1).
 * Every offseason this pass:
 *   1. Ranks every player WITHIN his position (aging bucket) by current
 *      key-skill average → a percentile (1 = best at his position this year).
 *      Position-relative is what kills the pile-up: a QB is measured against
 *      QBs, not against an absolute line his aging-resistant skills never fall
 *      below.
 *   2. EWMA-smooths that percentile into talentScore (α = {@link TALENT_SCORE_ALPHA},
 *      ~3-year memory) — the PFF "consistency" mechanism. A single down year
 *      barely dents a sustained elite; a washed veteran slides out of "star"
 *      over ~2-3 seasons, not on a one-year cliff.
 *   3. Maps talentScore → grade with a FIXED absolute cut ({@link GRADE_CUTS}),
 *      NOT a per-position quota — so the COUNT of elites per position floats
 *      with the era (3 elite QBs one year, 5 another, 2 another).
 *
 * Position-fair + sticky + floating-count, with one grade field (tier derives
 * from grade as before), so the ~180 grade/tier consumers are untouched. Pure
 * and deterministic: a rank + an average, no PRNG.
 */

/** EWMA weight on the current season's percentile. ~3-year memory at 0.35 — the
 *  track record a player builds by playing. Free agents use the same decay: a
 *  recently-cut player keeps a fair (declining) grade for a couple years, which
 *  prices his re-sign correctly. The FA pool is bounded separately by the
 *  ABSOLUTE washout (`retirement.ts` `currentAbilityGrade`), not by this grade. */
export const TALENT_SCORE_ALPHA = 0.35;

/**
 * talentScore (0..1) → talent grade. The cuts reproduce the league
 * `DESIGN_TARGET` mix (ELITE 1% / STAR 4% / HIGH_STARTER 13% / STARTER 22% /
 * WEAK_STARTER 18% / ROTATIONAL 22% / BACKUP 12% / FRINGE 8%) on the SMOOTHED
 * standing pool. They are the empirical quantiles of the developed-league
 * talentScore distribution at each DESIGN_TARGET top-share boundary
 * (`data/_talent_score_quantiles.mjs`, 8y × 4 seeds), NOT a raw uniform
 * percentile — the EWMA compresses scores toward the middle, so the middle cuts
 * sit well above their nominal percentile (STARTER at 0.74, not 0.60). Kept
 * consistent with `GRADE_SEED_SCORE` in players/skills.ts (band midpoints) so a
 * fresh league's generated grades survive the first re-grade.
 */
const GRADE_CUTS: ReadonlyArray<readonly [number, TalentGrade]> = [
  [0.98, 'ELITE'],
  [0.948, 'STAR'],
  [0.88, 'HIGH_STARTER'],
  [0.736, 'STARTER'],
  [0.642, 'WEAK_STARTER'],
  [0.495, 'ROTATIONAL'],
  [0.305, 'BACKUP'],
];

export function gradeFromTalentScore(score: number): TalentGrade {
  for (const [cut, grade] of GRADE_CUTS) {
    if (score >= cut) return grade;
  }
  return 'FRINGE';
}

/**
 * Within-position mid-rank percentile of each player's current key-skill
 * average, in (0,1). The reference set is ROSTERED players only (teamId set):
 * "star" means elite among players actually on NFL rosters, and it pins the
 * league-wide star RATE to ~DESIGN_TARGET (~5% of rostered) rather than ~5% of
 * the much larger rostered+free-agent population. Free agents are still graded —
 * ranked against the rostered reference (so they land low, as they should).
 * Ties share the average rank.
 */
function withinPositionPercentiles(players: readonly Player[]): Map<string, number> {
  const ksaOf = new Map<string, number>();
  const bucketOf = new Map<string, AgingBucket>();
  const refByBucket = new Map<AgingBucket, number[]>();
  for (const p of players) {
    const bucket = agingBucketFor(p.position);
    const ksa = keySkillAverage(p.current, p.archetype);
    ksaOf.set(p.id, ksa);
    bucketOf.set(p.id, bucket);
    if (p.teamId !== null) {
      const arr = refByBucket.get(bucket);
      if (arr) arr.push(ksa);
      else refByBucket.set(bucket, [ksa]);
    }
  }

  const out = new Map<string, number>();
  for (const p of players) {
    const ref = refByBucket.get(bucketOf.get(p.id)!);
    if (!ref || ref.length === 0) {
      out.set(p.id, 0.5);
      continue;
    }
    const ksa = ksaOf.get(p.id)!;
    let below = 0;
    let equal = 0;
    for (const v of ref) {
      if (v < ksa) below++;
      else if (v === ksa) equal++;
    }
    out.set(p.id, (below + 0.5 * equal) / ref.length);
  }
  return out;
}

/**
 * Offseason league-wide re-grade. Returns a new players map with each player's
 * {@link Player.talentScore}, {@link Player.talentGrade} and {@link Player.tier}
 * updated. Call AFTER development has advanced current skills, on the full
 * post-development population (so percentiles reflect the season that just
 * ended); rookies entered this offseason keep their generation seed until their
 * first pass.
 */
export function regradeLeagueTalent(
  players: Readonly<Record<string, Player>>,
): Record<string, Player> {
  const all = Object.values(players);
  const percentiles = withinPositionPercentiles(all);

  const out: Record<string, Player> = {};
  for (const p of all) {
    const pct = percentiles.get(p.id) ?? 0.5;
    const talentScore = TALENT_SCORE_ALPHA * pct + (1 - TALENT_SCORE_ALPHA) * p.talentScore;
    const talentGrade = gradeFromTalentScore(talentScore);
    out[p.id] = { ...p, talentScore, talentGrade, tier: gradeToTier(talentGrade) };
  }
  return out;
}
