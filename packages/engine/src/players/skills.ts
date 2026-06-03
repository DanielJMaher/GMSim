import type { Prng } from '../prng/index.js';
import type {
  PlayerSkills,
  PlayerDevelopmentArchetype,
  TalentTier,
  TalentGrade,
} from '../types/player.js';
import type { PlayerArchetype } from '../archetypes/types.js';
import type { Position } from '../types/enums.js';
import type { AgeStage } from './age.js';
import { ALL_SKILL_KEYS, categoryFor, effectiveSkillWeight } from './skill-keys.js';
import { athleticBaseline, POSITION_BASELINED_SKILLS, type AthleticBaseline } from './athletic-baselines.js';

export type { TalentTier, TalentGrade } from '../types/player.js';

/**
 * Fine 8-grade distribution (Skill Adjudicator). Weights are chosen so they
 * roll up — via `GRADE_TO_TIER` — to the legacy coarse 5/35/40/20
 * STAR/STARTER/BACKUP/FRINGE split, so the ~130 `tier` consumers see an
 * unchanged distribution while generation gains real resolution.
 */
const GRADE_WEIGHTS = [
  { value: 'ELITE' as TalentGrade, weight: 1 },
  { value: 'STAR' as TalentGrade, weight: 4 }, // → STAR 5
  { value: 'HIGH_STARTER' as TalentGrade, weight: 13 },
  { value: 'STARTER' as TalentGrade, weight: 22 }, // → STARTER 35
  { value: 'WEAK_STARTER' as TalentGrade, weight: 18 },
  { value: 'ROTATIONAL' as TalentGrade, weight: 22 }, // → BACKUP 40
  { value: 'BACKUP' as TalentGrade, weight: 12 },
  { value: 'FRINGE' as TalentGrade, weight: 8 }, // → FRINGE 20
];

/** Mean ceiling (max-potential) baseline per fine grade. Talent-spread fix
 *  Lever 2 (2026-06-03) STEEPENED the long tail into a real pyramid: the
 *  mid/low grades drop harder (STARTER 76→75, WEAK_STARTER 70→68, ROTATIONAL
 *  64→61, BACKUP 58→55, FRINGE 52→49) so blue-chips separate from replacement
 *  level — the flat-pool root cause behind the board flood + draft-reach
 *  blow-up. Lever 3 (2026-06-03) then STEEPENED THE TOP: ELITE 94→99,
 *  STAR 88→93, HIGH_STARTER 82→85, so genuine blue-chips TOWER (the shallow
 *  pyramid was the convergent bottleneck behind weak board-surfacing, the
 *  team-board blue-chip-lock gap, and the media-spread gradient cap). Raising
 *  the top means would normally inflate the 99-ceiling rate the Skill
 *  Adjudicator guards (≲4%) — so the softCap is RESHAPED in tandem (knee
 *  86→89 to uncompress the upper band, RAWMAX 115→132 so a literal 99 still
 *  needs an extreme draw): the blue-chip OVERALL rises while individual maxed
 *  attributes stay rare (the two are separable). Validated by the Skill
 *  Adjudicator (tier dist + 99 scarcity) + Truth Arbiter class-talent + the
 *  Ombudsman media gradient. */
const GRADE_CEILING_MEAN: Record<TalentGrade, number> = {
  ELITE: 99,
  STAR: 93,
  HIGH_STARTER: 82,
  STARTER: 75,
  WEAK_STARTER: 68,
  ROTATIONAL: 61,
  BACKUP: 55,
  FRINGE: 49,
};

/** Fine grade → legacy coarse tier (preserves the 5/35/40/20 split). */
const GRADE_TO_TIER: Record<TalentGrade, TalentTier> = {
  ELITE: 'STAR',
  STAR: 'STAR',
  HIGH_STARTER: 'STARTER',
  STARTER: 'STARTER',
  WEAK_STARTER: 'BACKUP',
  ROTATIONAL: 'BACKUP',
  BACKUP: 'FRINGE',
  FRINGE: 'FRINGE',
};

export function gradeToTier(grade: TalentGrade): TalentTier {
  return GRADE_TO_TIER[grade];
}

export function rollTalentGrade(prng: Prng): TalentGrade {
  return prng.weighted(GRADE_WEIGHTS);
}

/** Order of grades from best to worst (for thresholds + the Adjudicator). */
export const GRADE_ORDER: readonly TalentGrade[] = [
  'ELITE', 'STAR', 'HIGH_STARTER', 'STARTER', 'WEAK_STARTER', 'ROTATIONAL', 'BACKUP', 'FRINGE',
];

/** Derive a grade from an overall ceiling value (for promotion / migration,
 *  where a player has skills but no rolled grade). Thresholds are the
 *  midpoints between adjacent `GRADE_CEILING_MEAN` anchors. */
export function gradeFromOverall(overall: number): TalentGrade {
  if (overall >= 91) return 'ELITE';
  if (overall >= 85) return 'STAR';
  if (overall >= 79) return 'HIGH_STARTER';
  if (overall >= 73) return 'STARTER';
  if (overall >= 67) return 'WEAK_STARTER';
  if (overall >= 61) return 'ROTATIONAL';
  if (overall >= 55) return 'BACKUP';
  return 'FRINGE';
}

/**
 * How fully a player has reached their ceiling, by life-stage and skill
 * category. Per the Player Development design doc:
 *   - Physical attributes barely grow after entering NFL.
 *   - Technical and mental skills grow substantially through prime.
 *   - Stable traits (work ethic, etc.) barely move.
 *
 * `current = ceiling * ratio + small noise`, clamped to ceiling.
 */
const REALIZATION_BY_STAGE: Record<AgeStage, { physical: number; technical: number; mental: number; stable: number }> = {
  ROOKIE:     { physical: 0.95, technical: 0.62, mental: 0.60, stable: 0.90 },
  DEVELOPING: { physical: 1.00, technical: 0.78, mental: 0.78, stable: 0.95 },
  PRIME:      { physical: 1.00, technical: 0.97, mental: 0.97, stable: 1.00 },
  VETERAN:    { physical: 0.90, technical: 1.00, mental: 1.00, stable: 1.00 },
  AGING:      { physical: 0.78, technical: 1.00, mental: 1.00, stable: 1.00 },
};

/** Legacy 4-tier roll — now derived from the fine grade so the distribution
 *  is identical and the two stay consistent. */
export function rollTalentTier(prng: Prng): TalentTier {
  return gradeToTier(rollTalentGrade(prng));
}

export interface RolledSkills {
  current: PlayerSkills;
  ceiling: PlayerSkills;
  tier: TalentTier;
  talentGrade: TalentGrade;
}

/**
 * Linked-rating clusters (Skill Adjudicator, 2026-06-02). Real NFL attributes
 * within a family move together — a 99-speed player is also explosive; a QB
 * accurate short is usually accurate medium. We roll a per-player latent per
 * cluster and add a small idiosyncratic perturbation per skill, so cluster-
 * mates correlate WITHOUT being identical. `rho` is the target WITHIN-grade
 * (grade-residualized) mean pairwise correlation the Adjudicator audits. The
 * linkage is deliberately MODERATE — it must preserve individual strengths and
 * weaknesses (a rusher's go-to move, a QB's hot/cold zones, a man-vs-zone CB).
 * Athleticism is the only tight cluster (combine tests are physically linked).
 * Skills not listed here are unclustered (pure idiosyncratic roll). NOTE: kept
 * in sync with the Adjudicator's CORR_CLUSTERS (truth-arbiter); `ballSkills` is
 * intentionally NOT in `coverage` (elite coverage ≠ INT production).
 */
type SkillClusterId =
  | 'athleticism'
  | 'qbAccuracy'
  | 'passRushFundamentals'
  | 'passRushMoves'
  | 'coverage'
  | 'blocking'
  | 'receivingHands'
  | 'routeRunning';

const CLUSTER_RHO: Record<SkillClusterId, number> = {
  athleticism: 0.7,
  qbAccuracy: 0.4,
  passRushFundamentals: 0.45,
  passRushMoves: 0.25,
  coverage: 0.4,
  blocking: 0.5,
  receivingHands: 0.4,
  routeRunning: 0.55,
};

const SKILL_CLUSTER: Readonly<Record<string, SkillClusterId>> = {
  speed: 'athleticism', acceleration: 'athleticism', agility: 'athleticism', changeOfDirection: 'athleticism',
  accuracyShort: 'qbAccuracy', accuracyMedium: 'qbAccuracy', accuracyDeep: 'qbAccuracy',
  accuracyLeft: 'qbAccuracy', accuracyMiddle: 'qbAccuracy', accuracyRight: 'qbAccuracy',
  getOff: 'passRushFundamentals', bend: 'passRushFundamentals', handTechnique: 'passRushFundamentals',
  bullRush: 'passRushMoves', longArm: 'passRushMoves', pushPull: 'passRushMoves', swimMove: 'passRushMoves',
  ripMove: 'passRushMoves', spinRush: 'passRushMoves', crossChop: 'passRushMoves', ghostMove: 'passRushMoves',
  manCoverage: 'coverage', zoneCoverage: 'coverage', pressCoverage: 'coverage',
  runBlockPower: 'blocking', runBlockFinesse: 'blocking', passBlockPower: 'blocking',
  passBlockFinesse: 'blocking', impactBlock: 'blocking', leadBlock: 'blocking',
  catching: 'receivingHands', catchInTraffic: 'receivingHands', contestedCatch: 'receivingHands',
  routeShort: 'routeRunning', routeMedium: 'routeRunning', routeDeep: 'routeRunning',
};

const CLUSTER_IDS = Object.keys(CLUSTER_RHO) as SkillClusterId[];

/** Marginal per-skill standard deviation (preserved from the pre-factor-model
 *  generation so single-skill distributions, and thus tier/accolade rates,
 *  barely move when linkage is added). */
const SKILL_SD = 7;

/**
 * Scarcity (Skill Adjudicator): the old generation rolled each ceiling as
 * `normal(weightedMean, 7)` with weightedMean up to 99, so high-grade weighted
 * skills piled at the 99 cap — ~15% of players had a maxed attribute and ~19
 * could hit 99 speed (Madden: ~1). `softCap` compresses the top end so a literal
 * 99 takes an extreme (outlier) draw — rare, not impossible. After this: ~3 at
 * 99-ceiling speed, ~1.4/1k per attribute. Mid/low ratings (≤ knee) untouched.
 */
// Linear compression with a raw-max clamp: raw ratings above the knee are
// squeezed toward 99, and only raw >= RAWMAX (the outlier tail) actually reaches
// 99 — so a literal 99 is rare but POSSIBLE (the freak escape). RAWMAX tunes the
// 99 count directly (lower = more 99s). Slope (99-KNEE)/(RAWMAX-KNEE) < 1 means
// no inflation of mid-high values.
const SOFTCAP_KNEE = 90;
const SOFTCAP_RAWMAX = 120;

/**
 * Outlier component — the freak escape hatch. Clusters and scarcity are
 * TENDENCIES, not laws: a few players must break them (DK Metcalf / Calvin
 * Johnson big-and-fast, Anthony Richardson freak-athlete-poor-accuracy, a
 * freak-athletic TE like Kenyon Sadiq). Each latent draw has a small chance of
 * an amplified ("heavy tail") value, letting a rare player punch a single skill
 * or a whole cluster through the soft cap, or deviate sharply from his cluster.
 */
const OUTLIER_RATE = 0.04;
const OUTLIER_AMP = 2.6;

/**
 * How much talent grade nudges PHYSICAL attributes (Slice 3). Physical
 * baselines come from POSITION (athletic-baselines.ts), but better players are
 * weakly more athletic on average — so grade adds a small ± lift (ELITE +~3.5,
 * FRINGE −~3.5) rather than driving physicals outright. Kept small so the
 * position size/speed tradeoff (strength↔speed) dominates.
 */
const PHYS_GRADE_LIFT = 1.0;

/** Standard-normal draw with a rare amplified tail (see OUTLIER_*). */
function latentDraw(prng: Prng): number {
  const z = prng.gaussian();
  return prng.next() < OUTLIER_RATE ? z * OUTLIER_AMP : z;
}

/** Compress values above the knee toward 99 so the cap is reached only by the
 *  extreme (outlier) tail. Identity at/below the knee. Exported so the draft
 *  board can center its athletic-deviation reference on what generation actually
 *  produces (a high position baseline like WR speed 91 generates ~88 post-cap). */
export function softCap(x: number): number {
  if (x <= SOFTCAP_KNEE) return x;
  const t = Math.min(1, (x - SOFTCAP_KNEE) / (SOFTCAP_RAWMAX - SOFTCAP_KNEE));
  return SOFTCAP_KNEE + (99 - SOFTCAP_KNEE) * t;
}

/**
 * Roll current and ceiling skill ratings for a player.
 *
 * Factor model (2026-06-02): per-player cluster latents + a small idiosyncratic
 * perturbation make linked ratings correlate (speed↔acceleration) without being
 * identical, and a soft cap makes 99s rare — with a heavy-tailed outlier
 * component so freaks still break through. Per skill:
 *
 *   weightedMean = GRADE_CEILING_MEAN[grade] + (archetypeWeight - 1)·7
 *   ceiling      = softCap( weightedMean + a_c·Z_cluster + b_c·E_skill )
 *                  where a_c = 7·√ρ_c, b_c = 7·√(1-ρ_c)  → marginal σ ≈ 7,
 *                  within-grade cluster correlation ≈ ρ_c
 *   current      = ceiling · stage_realization + small noise   (≤ ceiling)
 *
 * Deterministic for a given prng + archetype + ageStage.
 */
export function rollSkills(
  prng: Prng,
  archetype: PlayerArchetype,
  ageStage: AgeStage,
  position: Position,
): RolledSkills {
  const talentGrade = rollTalentGrade(prng);
  const tier = gradeToTier(talentGrade);
  const ceilingBaseline = GRADE_CEILING_MEAN[talentGrade];
  const realization = REALIZATION_BY_STAGE[ageStage];

  // Slice 3: PHYSICAL attributes are baselined off POSITION, not talent grade —
  // a CB is fast/light, a DT slow/strong, so strength↔speed comes out negative.
  // Grade adds only a small ± lift on top (better players weakly more athletic).
  const athBase = athleticBaseline(position);
  const gradeIdx = GRADE_ORDER.indexOf(talentGrade);
  const physLift = (3.5 - gradeIdx) * PHYS_GRADE_LIFT;

  // One shared latent per cluster for this player — the source of within-cluster
  // linkage. For the athleticism cluster this latent is the player's reproduced
  // RAS (how athletic he is FOR his position). Drawn up front for determinism.
  const clusterLatent: Record<string, number> = {};
  for (const c of CLUSTER_IDS) clusterLatent[c] = latentDraw(prng);

  const ceiling = {} as PlayerSkills;
  const current = {} as PlayerSkills;

  for (const key of ALL_SKILL_KEYS) {
    // Physical attrs: position baseline + small grade lift. Everything else:
    // grade baseline + archetype weight bias (each weight unit ≈ ±7 points,
    // preserving tier separation while letting archetype priorities show).
    let mean: number;
    if (POSITION_BASELINED_SKILLS.has(key)) {
      mean = athBase[key as keyof AthleticBaseline] + physLift;
    } else {
      const weight = effectiveSkillWeight(archetype.skillWeights, key);
      mean = clamp(ceilingBaseline + (weight - 1) * 7, 25, 99);
    }

    // Variance split: shared cluster component (a_c·Z) + idiosyncratic
    // perturbation (b_c·E). a_c² + b_c² = SKILL_SD² preserves the marginal
    // spread; a_c²/SKILL_SD² = ρ_c sets the within-grade cluster correlation.
    const cluster = SKILL_CLUSTER[key];
    const rho = cluster ? CLUSTER_RHO[cluster] : 0;
    const a = SKILL_SD * Math.sqrt(rho);
    const b = SKILL_SD * Math.sqrt(1 - rho);
    const z = cluster ? clusterLatent[cluster]! : 0;
    const e = latentDraw(prng);
    const raw = mean + a * z + b * e;
    const ceilVal = Math.round(clamp(softCap(raw), 1, 99));
    ceiling[key] = ceilVal;

    const cat = categoryFor(key);
    const ratio = realization[cat];
    // Small noise so two players with identical archetype+tier+age aren't
    // numerically identical on every skill.
    const noisyCurrent = Math.round(ceilVal * ratio + prng.normal(0, 2));
    current[key] = Math.min(ceilVal, Math.max(1, noisyCurrent));
  }

  return { current, ceiling, tier, talentGrade };
}

/**
 * Roll a development archetype uniformly. The Player Development doc
 * doesn't specify a distribution; uniform is a reasonable starting
 * point, tunable later if we observe imbalance in long-running sims.
 */
const DEVELOPMENT_ARCHETYPES: readonly PlayerDevelopmentArchetype[] = [
  'FAST_LEARNER',
  'SLOW_STEADY',
  'ADVERSITY_DRIVEN',
  'EARLY_BLOOMER',
  'LATE_DEVELOPER',
  'CONFIDENCE_DEPENDENT',
];

export function rollDevelopmentArchetype(prng: Prng): PlayerDevelopmentArchetype {
  return prng.pick(DEVELOPMENT_ARCHETYPES);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
