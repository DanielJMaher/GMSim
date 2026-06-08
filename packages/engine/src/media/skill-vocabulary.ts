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
  QB: ['technicalSkill', 'decisionMaking', 'footballIq', 'composure', 'agility', 'leadership'],
  RB: ['speed', 'acceleration', 'agility', 'strength', 'handsBallSkills', 'competitiveness', 'durability'],
  WR: ['speed', 'acceleration', 'agility', 'handsBallSkills', 'technicalSkill', 'competitiveness'],
  TE: ['handsBallSkills', 'blockingTechnique', 'speed', 'strength', 'technicalSkill', 'competitiveness'],
  OL: ['blockingTechnique', 'strength', 'agility', 'technicalSkill', 'competitiveness', 'durability'],
  EDGE: ['passRushTechnique', 'speed', 'acceleration', 'strength', 'agility', 'competitiveness'],
  DT: ['passRushTechnique', 'strength', 'tacklingTechnique', 'agility', 'durability', 'competitiveness'],
  LB: ['tacklingTechnique', 'coverageTechnique', 'speed', 'footballIq', 'decisionMaking', 'strength'],
  CB: ['coverageTechnique', 'speed', 'acceleration', 'agility', 'handsBallSkills', 'composure'],
  S: ['coverageTechnique', 'tacklingTechnique', 'speed', 'footballIq', 'decisionMaking', 'composure'],
  ST: ['technicalSkill', 'composure', 'competitiveness', 'leadership'],
};

interface Polarity {
  /** Phrases for a strength (elite/good). */
  pos: readonly string[];
  /** Phrases for a concern (below/poor). */
  neg: readonly string[];
}

/**
 * Position-agnostic phrasing for the physical / mental / stable attributes —
 * these mean the same thing everywhere. The phrase NAMES the attribute (per
 * Daniel: the words key in on the underlying stat); it never speaks a number.
 */
const GENERIC: Partial<Record<SkillKey, Polarity>> = {
  speed: {
    pos: ['rare top-end speed', 'easy long speed to pull away', 'a different gear in the open field'],
    neg: ['pedestrian long speed', 'a top gear that lets angles catch him', 'straight-line speed that lags the position'],
  },
  acceleration: {
    pos: ['explosive burst out of his stance', 'instant acceleration to top speed', 'a violent first gear'],
    neg: ['a gradual build-up speed', 'a slow first step off the snap', 'burst that takes a beat to arrive'],
  },
  agility: {
    pos: ['loose, sudden change-of-direction', 'rare flexibility to sink and redirect', 'elite short-area quickness'],
    neg: ['tight hips changing direction', 'a long, gathered cut', 'stiffness redirecting in space'],
  },
  strength: {
    pos: ['easy play strength at the point of attack', 'a powerful, well-built frame', 'the strength to win the leverage battle'],
    neg: ['a frame that needs to get stronger', 'getting moved off his spot by power', 'play strength that shows up late'],
  },
  durability: {
    pos: ['a durable, available track record', 'a sturdy build that holds up', 'plays through contact without wearing down'],
    neg: ['a worrying injury history', 'a frame that wears down late', 'durability questions to clear medically'],
  },
  handsBallSkills: {
    pos: ['strong, reliable hands', 'a wide catch radius and late hands', 'ball skills that win at the catch point'],
    neg: ['hands that fight the football', 'body-catching away from his frame', 'concentration drops that show up'],
  },
  footballIq: {
    pos: ['advanced football IQ', 'a quick, sees-it-before-it-happens processor', 'rare instincts for the position'],
    neg: ['processing that runs a beat slow', 'reads he doesn’t see until late', 'instincts that need to catch up to the speed'],
  },
  decisionMaking: {
    pos: ['poised, sound decision-making', 'a calm, take-what’s-there approach', 'decisions that protect the football'],
    neg: ['risky decisions under duress', 'a habit of forcing it into trouble', 'decision-making that gets loose when rushed'],
  },
  composure: {
    pos: ['unshakable poise in the moment', 'composure that rises late in games', 'a steady pulse when it tightens up'],
    neg: ['nerves that show in the biggest moments', 'composure that wavers under pressure', 'a tendency to speed up when it’s hot'],
  },
  leadership: {
    pos: ['a vocal, respected leader', 'command of the room and the huddle', 'the kind of presence a locker room follows'],
    neg: ['a quiet presence still growing into a leadership role', 'a lead-by-example type who won’t set the tone vocally'],
  },
  competitiveness: {
    pos: ['a relentless, snap-to-snap motor', 'a genuine competitive edge', 'a finisher who plays through the whistle'],
    neg: ['effort that comes and goes', 'a motor that cools when it’s not going his way', 'competitive snaps he takes off'],
  },
  workEthic: {
    pos: ['a film-room and weight-room grinder', 'pro habits already in place', 'the work ethic to keep climbing'],
    neg: ['practice habits coaches want more from', 'a work ethic that’s been questioned', 'maturity in his prep that has to grow'],
  },
  coachability: {
    pos: ['a sponge who takes coaching', 'quick to apply corrections', 'the coachability to keep developing'],
    neg: ['a stubborn streak with coaching', 'corrections that take time to stick', 'a my-way edge that needs managing'],
  },
};

/**
 * Position-specific phrasing for the umbrella technique keys, which mean
 * different things by spot. Falls back to a generic technique phrasing.
 */
const TECHNICAL_FALLBACK: Polarity = {
  pos: ['polished, pro-ready technique', 'clean, repeatable fundamentals', 'technique that’s ahead of his class'],
  neg: ['raw, unrefined technique', 'fundamentals that need cleaning up', 'technique that lags his physical tools'],
};

const POSITION_OVERRIDES: Partial<Record<VocabBucket, Partial<Record<SkillKey, Polarity>>>> = {
  QB: {
    technicalSkill: {
      pos: ['rare arm talent', 'effortless velocity to all three levels', 'pinpoint accuracy with anticipation'],
      neg: ['accuracy that comes and goes', 'a build-up arm that labors on deep outs', 'ball placement that drifts off-platform'],
    },
    agility: {
      pos: ['real escapability to extend plays', 'the mobility to threaten on the move', 'light feet to climb the pocket'],
      neg: ['a tendency to drift rather than climb', 'limited second-reaction mobility', 'happy feet that bail clean pockets'],
    },
  },
  WR: {
    technicalSkill: {
      pos: ['nuanced route running', 'sharp, sudden breaks out of his stems', 'a release package that beats press'],
      neg: ['a raw, rounded route tree', 'releases that stall against press', 'tempo and nuance still to develop'],
    },
  },
  TE: {
    blockingTechnique: {
      pos: ['in-line blocking pop', 'the hand use to sustain at the point of attack', 'a willing, effective run blocker'],
      neg: ['inline blocking that lags the receiving game', 'a blocker who gets stacked at the point', 'effort and pad level as a blocker to fix'],
    },
  },
  OL: {
    blockingTechnique: {
      pos: ['clean hand placement and a heavy punch', 'a pass-pro anchor that holds up', 'the technique to mirror in space'],
      neg: ['hands that drift late in reps', 'a tendency to lunge and bend at the waist', 'anchor that gives ground against power'],
    },
    technicalSkill: {
      pos: ['refined footwork in his kick-slide', 'sound, repeatable pass sets', 'pro-ready technique in space'],
      neg: ['heavy feet redirecting to counters', 'a high pad level out of his stance', 'technique that needs rebuilding'],
    },
  },
  EDGE: {
    passRushTechnique: {
      pos: ['a deep, polished pass-rush plan', 'active, heavy hands to defeat blocks', 'corner-bending burst off the edge'],
      neg: ['a thin counter-rush plan', 'a rush that stalls when the first move fails', 'hands that arrive late in his rush'],
    },
  },
  DT: {
    passRushTechnique: {
      pos: ['interior-rush disruption', 'heavy hands to stack and shed', 'a quick first step for his size'],
      neg: ['a one-dimensional bull rush', 'pad level that rises out of his stance', 'a pass-rush plan that needs more tools'],
    },
    tacklingTechnique: {
      pos: ['a sure, wrap-up finisher at the point', 'the strength to anchor the run', 'block-shedding pop'],
      neg: ['inconsistent finishing in the run game', 'getting washed against doubles', 'tackles he lets escape his grasp'],
    },
  },
  LB: {
    tacklingTechnique: {
      pos: ['a sure, downhill tackler', 'a thumper who finishes through contact', 'block-shedding strength to fill'],
      neg: ['inconsistent tackling in space', 'a tendency to get caught up in the wash', 'finishing that breaks down in the open field'],
    },
    coverageTechnique: {
      pos: ['fluid coverage instincts', 'the range to carry seams', 'sticky in man on backs and tight ends'],
      neg: ['stiffness opening his hips in coverage', 'a step slow carrying verticals', 'coverage reads that lag the route'],
    },
  },
  CB: {
    coverageTechnique: {
      pos: ['sticky press-man cover skills', 'fluid hips to mirror and match', 'recovery speed to stay in phase'],
      neg: ['grabbiness at the top of the route', 'tightness flipping his hips', 'a tendency to peek into the backfield'],
    },
  },
  S: {
    coverageTechnique: {
      pos: ['range over the top', 'centerfield instincts to the football', 'the versatility to play down or deep'],
      neg: ['tightness in deep transitions', 'poor angles to the football', 'a tendency to bite on play-action'],
    },
    tacklingTechnique: {
      pos: ['a physical, sure tackler in the alley', 'box-safety striking ability', 'sound alley fits'],
      neg: ['inconsistent tackling in the alley', 'a hesitant trigger downhill', 'finishing in space that comes and goes'],
    },
  },
};

function polarityFor(skill: SkillKey, bucket: VocabBucket): Polarity {
  const override = POSITION_OVERRIDES[bucket]?.[skill];
  if (override) return override;
  const generic = GENERIC[skill];
  if (generic) return generic;
  // Umbrella technique keys with no position override fall back to a generic
  // technique phrasing rather than nothing.
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
