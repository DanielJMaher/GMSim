import type { Prng } from '../prng/index.js';
import type {
  RecruitingProfile,
  RecruitingBackground,
  StarRating,
  CollegeSchool,
  Hometown,
} from '../types/college.js';
import type { TalentTier } from '../types/player.js';
import { HOMETOWN_POOLS } from '../data/colleges/hometowns.js';

const STAR_DISTRIBUTION: ReadonlyArray<{ value: StarRating; weight: number }> = [
  { value: 5, weight: 1 },
  { value: 4, weight: 8 },
  { value: 3, weight: 24 },
  { value: 2, weight: 42 },
  { value: 1, weight: 25 },
];

/**
 * Roll a star rating biased loosely by the prospect's true NFL tier.
 * The correlation is intentional but loose: 5-star busts and walk-on
 * stars are real. Roughly:
 *
 *   STAR    → ~25% 5-star, 35% 4-star, 25% 3-star, rest 1-2
 *   STARTER → ~5% 5-star,  20% 4-star, 35% 3-star, rest 1-2
 *   BACKUP  → typical population distribution
 *   FRINGE  → biased toward 1-2 stars, rare 3-4 spike
 */
export function rollStarRating(prng: Prng, tier: TalentTier): StarRating {
  const tierWeights: ReadonlyArray<{ value: StarRating; weight: number }> = (() => {
    switch (tier) {
      case 'STAR':
        return [
          { value: 5, weight: 25 },
          { value: 4, weight: 35 },
          { value: 3, weight: 25 },
          { value: 2, weight: 12 },
          { value: 1, weight: 3 },
        ];
      case 'STARTER':
        return [
          { value: 5, weight: 5 },
          { value: 4, weight: 20 },
          { value: 3, weight: 35 },
          { value: 2, weight: 30 },
          { value: 1, weight: 10 },
        ];
      case 'BACKUP':
        return STAR_DISTRIBUTION;
      case 'FRINGE':
        return [
          { value: 5, weight: 0.5 },
          { value: 4, weight: 4 },
          { value: 3, weight: 18 },
          { value: 2, weight: 45 },
          { value: 1, weight: 32 },
        ];
    }
  })();
  return prng.weighted(tierWeights);
}

/**
 * National recruiting rank — top 300 list. Star rating gates which
 * range a prospect can fall into; higher stars get lower ranks
 * (rank 1 = best). 1- and 2-stars typically have no rank.
 */
export function rollNationalRank(prng: Prng, star: StarRating): number | null {
  switch (star) {
    case 5:
      // Top 30
      return prng.nextRange(1, 31);
    case 4:
      // 25–150 (overlap with low-end 5-stars is realistic)
      return prng.nextRange(25, 151);
    case 3:
      // 100–300 if ranked at all; 50% chance of being unranked
      return prng.next() < 0.5 ? prng.nextRange(100, 301) : null;
    case 2:
      // Mostly unranked; rare top-300 surprises
      return prng.next() < 0.05 ? prng.nextRange(250, 301) : null;
    case 1:
      return null;
  }
}

/**
 * Pick a hometown using the weighted state pool. Returns city + state.
 */
export function rollHometown(prng: Prng): Hometown {
  const totalWeight = HOMETOWN_POOLS.reduce((sum, p) => sum + p.weight, 0);
  let roll = prng.next() * totalWeight;
  for (const pool of HOMETOWN_POOLS) {
    roll -= pool.weight;
    if (roll <= 0) {
      return {
        city: pool.cities[prng.nextInt(pool.cities.length)]!,
        state: pool.state,
      };
    }
  }
  const fallback = HOMETOWN_POOLS[HOMETOWN_POOLS.length - 1]!;
  return {
    city: fallback.cities[prng.nextInt(fallback.cities.length)]!,
    state: fallback.state,
  };
}

/**
 * Derive a recruiting-background tag from star rating + school tier
 * + small probabilistic noise. Captures the genre-tag layer scouts
 * and media use to frame the prospect's arc:
 *
 *   PEDIGREE         — high-star (4-5) at POWER program
 *   BIG_PROGRAM      — 3-4 star at POWER program (the steady starter pipeline)
 *   DEVELOPMENTAL    — 2-3 star at POWER who improved year-over-year
 *   SMALL_SCHOOL_GEM — anything at GROUP_OF_5 / FCS / SMALL with real talent
 *   WALK_ON_STORY    — 1-star or unranked who emerged
 *   TRANSFER         — overrides others; supplied by caller iff prospect transferred
 */
export function deriveBackground(
  prng: Prng,
  star: StarRating,
  school: CollegeSchool,
  tier: TalentTier,
  isTransfer: boolean,
): RecruitingBackground {
  if (isTransfer) return 'TRANSFER';

  if (school.tier === 'SMALL' || school.tier === 'FCS') {
    return star === 1 || (star === 2 && prng.next() < 0.4) ? 'WALK_ON_STORY' : 'SMALL_SCHOOL_GEM';
  }
  if (school.tier === 'GROUP_OF_5') {
    return star <= 2 ? 'WALK_ON_STORY' : 'SMALL_SCHOOL_GEM';
  }
  // POWER program from here
  if (star >= 4) return 'PEDIGREE';
  if (star === 3) {
    return tier === 'STAR' || tier === 'STARTER' ? 'BIG_PROGRAM' : 'DEVELOPMENTAL';
  }
  // 2-star or 1-star at POWER
  return tier === 'STAR' || tier === 'STARTER' ? 'DEVELOPMENTAL' : 'WALK_ON_STORY';
}

export interface RollRecruitingProfileOptions {
  prng: Prng;
  tier: TalentTier;
  school: CollegeSchool;
  isTransfer: boolean;
}

export function rollRecruitingProfile(options: RollRecruitingProfileOptions): RecruitingProfile {
  const star = rollStarRating(options.prng.fork('star'), options.tier);
  const nationalRank = rollNationalRank(options.prng.fork('rank'), star);
  const hometown = rollHometown(options.prng.fork('hometown'));
  const background = deriveBackground(
    options.prng.fork('background'),
    star,
    options.school,
    options.tier,
    options.isTransfer,
  );
  return {
    starRating: star,
    nationalRank,
    hometown,
    background,
  };
}
