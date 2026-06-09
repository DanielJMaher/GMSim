/**
 * Skill-band vocabulary (v0.125) — Living Voice, Slice C.
 *
 * The scout-report write-up must KEY IN on the player's underlying stats: a
 * strength names the attribute a scout rated high, a concern names the one he
 * rated low — and because the scout's read carries his own error, he can be
 * wrong about it. This module is the mapping from a *banded observed value* to
 * the WORDS for that attribute.
 *
 *   bandOf(value)               → which band a 0–100 observed value falls in.
 *   REPORT_SKILLS_BY_BUCKET     → the handful of the 18 observed attributes a
 *                                 scout would actually grade for a position
 *                                 (keeps a CB's coverage out of a QB report).
 *   describeSkill(skill, band,  → the phrase, e.g. elite technicalSkill on a QB
 *     bucket, prng)               → "rare arm talent"; poor accuracy → "deep
 *                                   accuracy that comes and goes".
 *
 * Per the Living Voice HARD RULE the band itself is NEVER spoken — it only picks
 * the words (and shows in the dev inspector next to the real value). The phrase
 * pick takes a PRNG so wording rides `voiceSeed` (Slice B): same world + same
 * read, different playthrough → different words.
 *
 * This is the small, curated, Voice-Pack-shaped seed that later Living Voice
 * slices (D = pack extraction, E = per-source bias) grow.
 */

import type { Prng } from '../prng/index.js';
import type { PlayerSkills } from '../types/player.js';
import type { Position } from '../types/enums.js';
import { bucketFor, type VocabBucket } from './scout-vocabulary.js';
import {
  GENERIC_SKILL_PHRASES,
  POSITION_SKILL_PHRASES,
  TECHNICAL_FALLBACK,
  type SkillPhrases,
} from '../data/voice/voice-pack.js';

export type SkillBand = 'elite' | 'good' | 'average' | 'below' | 'poor';

/** Polarity of a band — drives whether it can surface as a pro or a con. */
export type BandPolarity = 'positive' | 'neutral' | 'negative';

/**
 * Band thresholds on a 0–100 observed (projected-ability) value. Tuned so
 * "elite" is genuinely rare and "average" is the broad middle — a scout flags a
 * strength or a concern, not every dimension.
 */
export function bandOf(value: number): SkillBand {
  if (value >= 85) return 'elite';
  if (value >= 72) return 'good';
  if (value >= 57) return 'average';
  if (value >= 44) return 'below';
  return 'poor';
}

/** elite/good → positive (a pro); below/poor → negative (a con); average → neutral. */
export function bandPolarity(band: SkillBand): BandPolarity {
  if (band === 'elite' || band === 'good') return 'positive';
  if (band === 'below' || band === 'poor') return 'negative';
  return 'neutral';
}

type SkillKey = keyof PlayerSkills;

/**
 * Which of the 18 observed attributes a scout grades for each position bucket —
 * the report-worthy subset. The umbrella technique key (`technicalSkill`,
 * `passRushTechnique`, …) means something position-specific; the per-bucket
 * phrase overrides below give it the right words.
 */
export const REPORT_SKILLS_BY_BUCKET: Record<VocabBucket, readonly SkillKey[]> = {
  QB: ['technicalSkill', 'decisionMaking', 'footballIq', 'composure', 'agility', 'leadership', 'competitiveness', 'workEthic'],
  RB: ['speed', 'acceleration', 'agility', 'strength', 'handsBallSkills', 'competitiveness', 'durability', 'footballIq'],
  WR: ['speed', 'acceleration', 'agility', 'handsBallSkills', 'technicalSkill', 'competitiveness', 'footballIq', 'composure'],
  TE: ['handsBallSkills', 'blockingTechnique', 'speed', 'strength', 'technicalSkill', 'competitiveness', 'footballIq', 'durability'],
  OL: ['blockingTechnique', 'strength', 'agility', 'technicalSkill', 'competitiveness', 'durability', 'footballIq', 'composure'],
  EDGE: ['passRushTechnique', 'speed', 'acceleration', 'strength', 'agility', 'competitiveness', 'footballIq', 'workEthic'],
  DT: ['passRushTechnique', 'strength', 'tacklingTechnique', 'agility', 'durability', 'competitiveness', 'footballIq', 'workEthic'],
  LB: ['tacklingTechnique', 'coverageTechnique', 'speed', 'footballIq', 'decisionMaking', 'strength', 'competitiveness', 'composure'],
  CB: ['coverageTechnique', 'speed', 'acceleration', 'agility', 'handsBallSkills', 'composure', 'footballIq', 'competitiveness'],
  S: ['coverageTechnique', 'tacklingTechnique', 'speed', 'footballIq', 'decisionMaking', 'composure', 'competitiveness', 'leadership'],
  ST: ['technicalSkill', 'composure', 'competitiveness', 'leadership', 'workEthic'],
};

/**
 * Phrase pool for one (attribute, position) — the position override if the
 * Voice Pack has one (umbrella technique keys), else the generic phrasing, else
 * a generic technique fallback. The pools live in the growable Voice Pack
 * (`data/voice/voice-pack.ts`).
 */
function polarityFor(skill: SkillKey, bucket: VocabBucket): SkillPhrases {
  const override = POSITION_SKILL_PHRASES[bucket]?.[skill];
  if (override) return override;
  const generic = GENERIC_SKILL_PHRASES[skill];
  if (generic) return generic;
  return TECHNICAL_FALLBACK;
}

/**
 * The WORDS for one banded attribute read. Positive bands (elite/good) pull
 * from the strength pool, negative bands (below/poor) from the concern pool;
 * 'average' returns null (a scout doesn't list a middling trait). The PRNG is
 * the voice channel — pass a `voicePrng` so wording varies by playthrough.
 */
export function describeSkill(
  skill: SkillKey,
  band: SkillBand,
  position: Position,
  prng: Prng,
): string | null {
  const polarity = bandPolarity(band);
  if (polarity === 'neutral') return null;
  const phrases = polarityFor(skill, bucketFor(position));
  const pool = polarity === 'positive' ? phrases.pos : phrases.neg;
  if (pool.length === 0) return null;
  return prng.pick(pool);
}
