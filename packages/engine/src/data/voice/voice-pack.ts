/**
 * The Voice Pack (v0.126) — Living Voice, Slice D.
 *
 * The scouting-report write-up was thin because the engine only carried ~3
 * hand-written phrases per attribute and a 4-sentence template. This is the
 * growable VOCABULARY BANK: many original phrasings per (attribute, polarity,
 * position), plus the connective tissue a real report braids together — lead
 * frames, production / athleticism / makeup clauses, concern connectors and
 * mitigators, projections, and comp templates.
 *
 * GROUNDING (not copying): the Scribe agent (`truth-arbiter run scribe`) measured
 * the real Beast/PFF corpus and emits aggregates only (copyright — never verbatim
 * passages). This pack is ORIGINAL phrasing authored to that grounding: the per-
 * position distinctive vocab (`positionPolarity`), the cadence target (median
 * ~18 bullets + a ~179-word narrative, ~11–12 words/bullet), and the intensifier
 * / hedge / comp rates. See `packages/truth-arbiter/data/voice/scribe-profile.json`.
 *
 * Per the Living Voice HARD RULE no phrase here speaks a number or a band — the
 * words NAME the attribute, the band only picks which pool. Selection rides
 * `voiceSeed` at the call site.
 */

import type { PlayerSkills } from '../../types/player.js';
import type { VocabBucket } from '../../media/scout-vocabulary.js';

type SkillKey = keyof PlayerSkills;

export interface SkillPhrases {
  /** Phrases for a strength (elite/good band). */
  pos: readonly string[];
  /** Phrases for a concern (below/poor band). */
  neg: readonly string[];
}

/**
 * Position-agnostic phrasing for the physical / mental / stable attributes.
 * The phrase NAMES the attribute (Daniel: the words key in on the underlying
 * stat); it never speaks a number.
 */
export const GENERIC_SKILL_PHRASES: Partial<Record<SkillKey, SkillPhrases>> = {
  speed: {
    pos: [
      'rare top-end speed',
      'easy long speed to pull away from angles',
      'a different gear once he hits the open field',
      'the kind of giddy-up that turns a crease into six',
      'track speed that shows up on tape, not just the watch',
      'gears that keep climbing down the field',
    ],
    neg: [
      'pedestrian long speed',
      'a top gear that lets pursuit angles catch him',
      'straight-line speed that lags the position',
      'a build-up runner who gets caught from behind',
      'enough speed to function but never to separate',
    ],
  },
  acceleration: {
    pos: [
      'explosive burst out of his stance',
      'an instant first gear to top speed',
      'a violent get-off that beats hesitation',
      'the short-area burst to close in a blink',
      'suddenness in the first five yards',
    ],
    neg: [
      'a gradual build-up rather than a true burst',
      'a slow first step off the snap',
      'acceleration that takes a beat too long to arrive',
      'a get-off that lets blockers and DBs reset',
    ],
  },
  agility: {
    pos: [
      'loose, sudden change-of-direction',
      'rare flexibility to sink his hips and redirect',
      'elite short-area quickness in a phone booth',
      'the foot quickness to make the first man miss',
      'fluid, easy movement skills for the position',
      'the ankle flexion to stick a foot and go',
    ],
    neg: [
      'tight hips changing direction',
      'a long, gathered cut that bleeds speed',
      'stiffness redirecting in tight quarters',
      'a build that gets segmented when asked to flip',
      'movement that looks labored in space',
    ],
  },
  strength: {
    pos: [
      'easy play strength at the point of attack',
      'a powerful, densely-built frame',
      'the functional strength to win the leverage battle',
      'a strong base that absorbs and resets',
      'the pop to jolt a defender at contact',
    ],
    neg: [
      'a frame that has to get appreciably stronger',
      'getting moved off his spot by raw power',
      'play strength that shows up late in his arc',
      'a narrow build that needs to fill out',
      'a tendency to get displaced at the point of attack',
    ],
  },
  durability: {
    pos: [
      'a durable, always-available track record',
      'a sturdy build that has held up to a heavy workload',
      'a high-mileage player who keeps answering the bell',
    ],
    neg: [
      'a worrying injury history that medical will dig into',
      'a frame that wears down as the season goes',
      'durability questions teams will have to clear',
      'a body that has already taken a lot of hits',
    ],
  },
  handsBallSkills: {
    pos: [
      'strong, reliable hands',
      'a wide catch radius and soft, late hands',
      'ball skills that win at the contested catch point',
      'the hand-eye to pluck it away from his frame',
      'natural tracking on the ball in the air',
    ],
    neg: [
      'hands that fight the football',
      'a body-catcher who lets it into his pads',
      'concentration drops that show up on tape',
      'a narrow catch radius outside his frame',
      'inconsistent finishing through contact',
    ],
  },
  footballIq: {
    pos: [
      'advanced football IQ',
      'a quick, sees-it-before-it-happens processor',
      'rare instincts and anticipation for the spot',
      'the diagnostic speed to play fast and clean',
      'a feel for leverage and spacing beyond his years',
    ],
    neg: [
      'processing that runs a beat slow',
      'reads he does not trigger on until late',
      'instincts that have to catch up to the speed of the game',
      'a tendency to play a tick behind the action',
      'recognition that lags against disguise',
    ],
  },
  decisionMaking: {
    pos: [
      'poised, sound decision-making',
      'a calm, take-what-the-defense-gives approach',
      'the discipline to protect the football',
      'decisions that rarely put his team in a hole',
    ],
    neg: [
      'risky decisions when the picture muddies',
      'a habit of forcing it into coverage',
      'decision-making that gets loose when he is hurried',
      'a gambler’s streak that bites him',
    ],
  },
  composure: {
    pos: [
      'unshakable poise in the moment',
      'composure that rises as the lights get brighter',
      'a steady pulse when the game tightens up',
      'the temperament to shake off a bad rep',
    ],
    neg: [
      'nerves that surface in the biggest moments',
      'composure that wavers under a heavy rush',
      'a tendency to speed up when it gets hot',
      'a competitor who can let one mistake snowball',
    ],
  },
  leadership: {
    pos: [
      'a vocal, respected leader',
      'command of the room and the huddle',
      'the presence a locker room organizes itself around',
      'a captain whose teammates clearly follow him',
    ],
    neg: [
      'a quiet presence still growing into a leadership voice',
      'a lead-by-example type who will not set the tone vocally',
      'a follower more than a driver at this stage',
    ],
  },
  competitiveness: {
    pos: [
      'a relentless, snap-to-snap motor',
      'a genuine competitive edge that shows up in the dirty work',
      'a finisher who plays through the whistle',
      'the kind of dog teams covet at the position',
    ],
    neg: [
      'effort that comes and goes',
      'a motor that cools when the game gets away from him',
      'competitive snaps he is content to take off',
      'a tendency to coast when he is not the focal point',
    ],
  },
  workEthic: {
    pos: [
      'a film-room and weight-room grinder',
      'pro habits already in place',
      'the work ethic and makeup to keep climbing',
      'a self-starter coaches rave about behind the scenes',
    ],
    neg: [
      'practice habits coaches want more consistency from',
      'a work ethic that has been quietly questioned',
      'maturity in his preparation that still has to grow',
    ],
  },
  coachability: {
    pos: [
      'a sponge who soaks up coaching',
      'quick to apply a correction rep to rep',
      'the coachability to keep developing his craft',
    ],
    neg: [
      'a stubborn streak that coaching will have to manage',
      'corrections that take time to stick',
      'a my-way edge that needs the right room',
    ],
  },
};

/** Generic technique phrasing when a position has no specific override. */
export const TECHNICAL_FALLBACK: SkillPhrases = {
  pos: [
    'polished, pro-ready technique',
    'clean, repeatable fundamentals',
    'a refined craft that is ahead of his class',
    'technique that lets the tools play up',
  ],
  neg: [
    'raw, unrefined technique',
    'fundamentals that need real cleaning up',
    'technique that lags his physical tools',
    'a project whose craft has to catch the traits',
  ],
};

/**
 * Position-specific phrasing for the umbrella technique keys (and a few skills
 * that read differently by spot). Grounded in the Scribe's per-position vocab.
 */
export const POSITION_SKILL_PHRASES: Partial<
  Record<VocabBucket, Partial<Record<SkillKey, SkillPhrases>>>
> = {
  QB: {
    technicalSkill: {
      pos: [
        'rare arm talent',
        'effortless velocity to every level of the field',
        'pinpoint ball placement with anticipation',
        'the arm to make every NFL throw',
        'a smooth, repeatable release',
        'touch and timing on the intermediate game',
      ],
      neg: [
        'accuracy that comes and goes',
        'a build-up arm that labors on the deep out',
        'ball placement that drifts off-platform',
        'mechanics that get noisy under duress',
        'a delivery that needs to quicken up',
      ],
    },
    agility: {
      pos: [
        'real escapability to extend plays',
        'the mobility to threaten defenses with his legs',
        'light feet to climb and reset in the pocket',
        'second-reaction creativity outside structure',
      ],
      neg: [
        'a tendency to drift rather than climb the pocket',
        'limited second-reaction juice',
        'happy feet that bail clean pockets early',
      ],
    },
  },
  RB: {
    handsBallSkills: {
      pos: ['three-down receiving chops', 'natural hands as a check-down outlet', 'the route feel to flex into the slot'],
      neg: ['stone hands out of the backfield', 'a back the defense can sit on in passing downs', 'limited value as a receiver'],
    },
  },
  WR: {
    technicalSkill: {
      pos: [
        'nuanced, layered route running',
        'sharp, sudden breaks out of his stems',
        'a release package that defeats press',
        'the tempo and pacing of a polished route runner',
        'savvy at the top of the route to create separation',
      ],
      neg: [
        'a raw, rounded route tree',
        'releases that stall against physical press',
        'tempo and nuance that are still developing',
        'a separator by athleticism more than craft',
      ],
    },
  },
  TE: {
    blockingTechnique: {
      pos: ['in-line blocking pop', 'the hand use to sustain at the point of attack', 'a genuinely willing, effective run blocker'],
      neg: ['in-line blocking that lags the receiving game', 'a blocker who gets stacked and shed', 'effort and pad level as a blocker to fix'],
    },
    handsBallSkills: {
      pos: ['reliable, plus hands down the seam', 'a big, late-hands target in traffic', 'the catch radius to win above the rim'],
      neg: ['hands that come and go in traffic', 'a target who lets contested balls into his frame'],
    },
  },
  OL: {
    blockingTechnique: {
      pos: [
        'clean hand placement and a heavy, accurate punch',
        'a pass-pro anchor that holds up against power',
        'the technique to mirror rushers in space',
        'a finisher who plays through the echo of the whistle',
      ],
      neg: [
        'hands that drift and re-fit late in reps',
        'a tendency to lunge and bend at the waist',
        'an anchor that gives ground against a long bull',
        'placement that gets sloppy when his feet stop',
      ],
    },
    technicalSkill: {
      pos: ['refined footwork in his kick-slide', 'sound, repeatable pass sets', 'light, quick feet to climb to the second level'],
      neg: ['heavy feet redirecting to counters', 'a high pad level out of his stance', 'technique that needs a rebuild at the next level'],
    },
  },
  EDGE: {
    passRushTechnique: {
      pos: [
        'a deep, well-sequenced pass-rush plan',
        'active, heavy hands to defeat blocks',
        'corner-bending burst to flatten to the quarterback',
        'a counter ready the moment the first move fails',
        'the bend and ankle flexion to win the edge',
      ],
      neg: [
        'a thin counter-rush plan',
        'a rush that stalls when the first move is stoned',
        'hands that arrive late and uncoordinated',
        'stiffness flattening the corner',
      ],
    },
  },
  DT: {
    passRushTechnique: {
      pos: ['interior-rush disruption that collapses the pocket', 'heavy hands to stack and shed', 'a quick, jolting first step for his size'],
      neg: ['a one-dimensional bull rush', 'pad level that rises out of his stance', 'a rush plan that needs more than power'],
    },
    tacklingTechnique: {
      pos: ['a sure, wrap-up finisher at the point', 'the strength to anchor and two-gap', 'block-shedding pop to make plays off his frame'],
      neg: ['inconsistent finishing in the run game', 'getting washed against down blocks and doubles', 'a tackler who lets ballcarriers slip his grasp'],
    },
  },
  LB: {
    tacklingTechnique: {
      pos: ['a sure, downhill tackler', 'a thumper who finishes through contact', 'block-shedding strength to fill the alley'],
      neg: ['inconsistent tackling in space', 'a tendency to get swallowed up in the wash', 'finishing that breaks down in the open field'],
    },
    coverageTechnique: {
      pos: ['fluid coverage instincts for an off-ball linebacker', 'the range and feel to carry seams', 'sticky in man on backs and tight ends'],
      neg: ['stiffness opening his hips in coverage', 'a step slow carrying verticals', 'coverage reads that lag the route concept'],
    },
  },
  CB: {
    coverageTechnique: {
      pos: [
        'sticky press-man cover skills',
        'fluid hips to mirror and match at the line',
        'the recovery speed to stay in phase',
        'a feel for route concepts and leverage',
        'ball skills to finish at the catch point',
      ],
      neg: [
        'grabbiness at the top of the route',
        'tightness flipping his hips in transition',
        'a tendency to peek into the backfield and lose his man',
        'eyes-discipline lapses that good route runners exploit',
      ],
    },
  },
  S: {
    coverageTechnique: {
      pos: ['true range over the top', 'centerfield instincts and angles to the ball', 'the versatility to play down in the box or deep'],
      neg: ['tightness in his deep transitions', 'poor angles to the football', 'a tendency to bite hard on play-action'],
    },
    tacklingTechnique: {
      pos: ['a physical, sure tackler in the alley', 'box-safety striking ability', 'sound, consistent run fits'],
      neg: ['inconsistent tackling in space', 'a hesitant downhill trigger', 'finishing in the open field that comes and goes'],
    },
  },
};

// ─── Composer banks (the connective tissue of a full write-up) ──────────────

/** Build adjective by position bucket — the "thick OG", "lean WR" frame word. */
export const BUILD_WORDS: Record<VocabBucket, readonly string[]> = {
  QB: ['well-proportioned', 'sturdy', 'prototypically-sized'],
  RB: ['compact, well-built', 'thickly-built', 'sturdy, low-to-the-ground'],
  WR: ['long, lean', 'wiry', 'smoothly-built'],
  TE: ['big, long-limbed', 'thickly-built', 'broad-framed'],
  OL: ['thick, broad-framed', 'massive, long-armed', 'powerfully-built'],
  EDGE: ['long, explosive', 'twitched-up', 'lean and bendy'],
  DT: ['thick, powerfully-built', 'broad, heavy-handed', 'stout'],
  LB: ['compact, well-built', 'rangy', 'sturdy'],
  CB: ['long, fluid', 'lean, twitchy', 'wiry'],
  S: ['rangy, well-built', 'sturdy, physical', 'lean and rangy'],
  ST: ['well-built', 'sturdy', 'wiry'],
};

/** Lead-frame templates. Slots: {build} {pos} {school} {name}. */
export const LEAD_TEMPLATES: readonly string[] = [
  'A {build} {pos} out of {school}, {name} {pedigree}.',
  '{name} is a {build} {pos} prospect from {school} who {pedigree}.',
  'Out of {school}, {name} projects as a {build} {pos} and {pedigree}.',
  '{name} checks in as a {build} {pos} from {school}; {pedigree}.',
];

/** Pedigree clause keyed off recruiting stars / background (qualitative). */
export const PEDIGREE_BLUE_CHIP: readonly string[] = [
  'arrived as a blue-chip recruit and looked the part right away',
  'came in as a coveted recruit and has carried the billing',
  'was a marquee signing and has played up to the hype',
];
export const PEDIGREE_DEVELOPMENTAL: readonly string[] = [
  'climbed the depth chart the hard way and improved every season',
  'was a lightly-recruited prospect who steadily earned his snaps',
  'developed into a name through production, not recruiting stars',
];
export const PEDIGREE_TRANSFER: readonly string[] = [
  'found his footing after a transfer and took off',
  'reset his career with a move and broke out at his new home',
];
export const PEDIGREE_NEUTRAL: readonly string[] = [
  'put together a résumé that earned a long look',
  'worked his way onto the draft radar',
];

/** Strength-clause connectors (lead with the calling card). */
export const STRENGTH_LEADS: readonly string[] = [
  'His game starts with',
  'The calling card is',
  'What jumps out first is',
  'He wins with',
  'On tape, it starts with',
];
export const STRENGTH_ADDERS: readonly string[] = [
  'On top of that, he brings',
  'He pairs it with',
  'Just as important is',
  'He backs it up with',
];

/** Production clauses by a rough qualitative tier (NO numbers — North Star). */
export const PRODUCTION_PHRASES = {
  high: [
    'The production backs the tape — he was a focal point of his offense.',
    'He was genuinely productive against a real schedule, not a stat-padder.',
    'The box score tells the same story the tape does: a difference-maker.',
  ],
  defense_high: [
    'The production matches the traits — he was a disruptive force on his front.',
    'He filled the stat sheet against quality competition.',
    'The tape and the splash plays line up.',
  ],
  mid: [
    'The production is solid if not eye-popping.',
    'He was a steady contributor without a monster final line.',
    'The numbers are good, not gaudy — a reliable piece.',
  ],
  low: [
    'The résumé is thin on production, which teams will weigh.',
    'He flashed more than he produced, a projection more than a résumé.',
    'The counting stats lag the traits at this stage.',
  ],
} as const;

/** Athletic clause keyed off a combine-band descriptor (only when tested). */
export const ATHLETIC_PHRASES = {
  elite: [
    'The testing confirmed a rare athlete.',
    'He backed it up with a standout workout.',
    'The numbers put a freaky athletic profile on paper.',
  ],
  good: [
    'The workout numbers check the boxes.',
    'He tested as a clean, functional athlete.',
  ],
  poor: [
    'The workout was underwhelming, and it will cost him with some staffs.',
    'He is a better football player than a tester.',
  ],
} as const;

/** Concern connectors + mitigators. */
export const CONCERN_LEADS: readonly string[] = [
  'The concern is',
  'Scouts will flag',
  'He will have to clean up',
  'The questions center on',
  'Where it gets dicey is',
];
export const CONCERN_ADDERS: readonly string[] = [
  'There are also reps where',
  'On the down side, you also see',
  'It is fair to wonder about',
];
export const CONCERN_MITIGATORS: readonly string[] = [
  'but the traits give him a runway to fix it',
  'though it is the kind of thing good coaching can clean up',
  'and most of it is correctable with reps',
  'yet none of it is a deal-breaker on the tools',
];

/** Projection lines by perceived-grade tier (qualitative — no slot numbers). */
export const PROJECTION_BY_TIER: Record<'r1' | 'r2' | 'mid' | 'late' | 'depth', readonly string[]> = {
  r1: [
    'A top-of-the-board talent who should hear his name early on the draft’s first night.',
    'An early-round prospect with the traits to start and star.',
    'A blue-chip evaluation — the kind of player you build around.',
  ],
  r2: [
    'A Day 2 projection with a clear starter’s ceiling.',
    'He profiles as an early contributor who grows into a starter.',
    'A high-floor pick with the upside to outpace his draft slot.',
  ],
  mid: [
    'A mid-round developmental bet with a defined role to grow into.',
    'The kind of value pick that pays off by year two.',
    'A rotational piece early with starter upside if it clicks.',
  ],
  late: [
    'A late-round flier and a priority-free-agent type.',
    'A depth and special-teams projection who has to earn a role.',
    'A traits bet worth a late dart.',
  ],
  depth: [
    'A deep-roster projection who will have to win a job in camp.',
    'A camp body at this stage — the tools have to show up on a roster bubble.',
    'A long-shot evaluation who needs everything to break right.',
  ],
};

/** Comp template + adjectives (used at the corpus's ~5% comp rate). */
export const COMP_TEMPLATES: readonly string[] = [
  'In the mold of a {adj} {archetype}.',
  'Plays like a {adj} {archetype}.',
  'The frame and game evoke a {adj} {archetype}.',
];
export const COMP_ADJECTIVES: readonly string[] = ['prototypical', 'classic', 'modern', 'high-floor', 'rangy'];
