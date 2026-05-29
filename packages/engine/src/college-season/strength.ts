import type { CollegePlayer } from '../types/college.js';
import type { ConferenceTier } from '../types/college.js';
import { keySkillAverage } from '../archetypes/key-skill.js';

/**
 * Compute a school's strength rating used as the primary input to
 * college-game outcome rolls. Higher = stronger team.
 *
 * Slice 1 uses a deliberately simpler model than NFL `teamStrength`:
 *
 *   1. **Roster contribution** — average skill of the school's top
 *      ~22 prospects (rough "starter cohort"). Weighted by NFL talent
 *      tier so STAR/STARTER prospects matter more than BACKUP/FRINGE.
 *   2. **Conference-tier baseline** — POWER schools default to a
 *      higher floor than G5/FCS/SMALL, reflecting the gap between
 *      the recruiting pool, facilities, and depth that the prospect
 *      cohort alone doesn't capture (walk-on depth, redshirt classes
 *      not in the draft-eligible pool, etc.).
 *
 * The two components are blended with the roster carrying ~60% of
 * the weight at full cohort and falling back to ~30% when the
 * school's prospect cohort in the pool is thin. This gives small
 * schools a sensible strength even when they have only 2-3
 * prospects, while letting an unusually loaded SEC school rise
 * above their tier baseline when their cohort is exceptional.
 *
 * Output is a number roughly in [40, 100].
 */
export function collegeTeamStrength(
  schoolId: string,
  tier: ConferenceTier,
  prospectsBySchool: ReadonlyMap<string, readonly CollegePlayer[]>,
): number {
  const baseline = tierBaseline(tier);
  const prospects = prospectsBySchool.get(schoolId) ?? [];
  if (prospects.length === 0) {
    return baseline;
  }

  const starterCount = 22;
  const scored = prospects
    .map((p) => ({ p, score: tierWeightedSkill(p) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, starterCount);

  const rosterAvg =
    scored.reduce((s, x) => s + x.score, 0) / scored.length;

  // Roster weight scales with cohort coverage: full 22 → 0.6, thin
  // cohort (e.g. 4 prospects) → ~0.2. Forces the baseline to carry
  // most of the weight when our college pool is too thin for a school.
  const coverage = Math.min(1, scored.length / starterCount);
  const rosterWeight = 0.3 + 0.3 * coverage;
  const baselineWeight = 1 - rosterWeight;

  return rosterAvg * rosterWeight + baseline * baselineWeight;
}

/**
 * Tier baseline strength. Calibrated so a POWER school with zero
 * prospects still rates above a G5 school with zero prospects, and
 * the gap is wide enough to drive upset rates that feel
 * NFL-like but with the higher variance characteristic of CFB.
 *
 *   POWER       — strong default; Alabama-Vanderbilt gap comes from cohort
 *   GROUP_OF_5  — solid mid-major default
 *   FCS         — well below FBS; FCS upsets are rare but real
 *   SMALL       — DII / DIII / NAIA; effectively never plays FBS
 */
function tierBaseline(tier: ConferenceTier): number {
  switch (tier) {
    case 'POWER':
      return 78;
    case 'GROUP_OF_5':
      return 65;
    case 'FCS':
      return 50;
    case 'SMALL':
      return 40;
  }
}

/**
 * Per-prospect skill score, weighted by NFL talent tier. STAR
 * prospects pull a school's strength up more than the raw skill
 * delta would suggest, reflecting how a single transcendent player
 * (Bo Nix at Oregon, Caleb Williams at USC) lifts a college team's
 * ceiling beyond the sum of parts.
 */
function tierWeightedSkill(p: CollegePlayer): number {
  const skill = keySkillAvg(p);
  const tierMul =
    p.tier === 'STAR'
      ? 1.15
      : p.tier === 'STARTER'
        ? 1.05
        : p.tier === 'BACKUP'
          ? 0.95
          : 0.85;
  return skill * tierMul;
}

/**
 * Position-aware skill composite (Stage 5b): the archetype's KEY
 * skills, not a flat (technicalSkill + footballIq + speed)/3 stub — so a
 * team's strength reflects its players' actual granular profiles. Shares the
 * NFL sim's signal via `keySkillAverage`.
 */
function keySkillAvg(p: CollegePlayer): number {
  return keySkillAverage(p.current, p.archetype);
}

/**
 * Pre-bucket prospects by school id for repeated strength lookups.
 * Callers pass this map into `collegeTeamStrength` to avoid scanning
 * the full pool on every game.
 */
export function bucketProspectsBySchool(
  pool: readonly CollegePlayer[],
): Map<string, CollegePlayer[]> {
  const map = new Map<string, CollegePlayer[]>();
  for (const p of pool) {
    const arr = map.get(p.schoolId) ?? [];
    arr.push(p);
    map.set(p.schoolId, arr);
  }
  return map;
}
