/**
 * Media outlet generation (v0.62).
 *
 * Generates the league's media ecosystem at league creation. Stable
 * across the league's lifespan — no outlet birth/death yet. Deterministic
 * from the league seed.
 *
 * Total count: ~47 outlets per league:
 *   - 10 national outlets (mix of insider / beat / columnist / radio)
 *   - 5 college-focused outlets (reserved for the college-season slice)
 *   - 32 team-local outlets (1 per franchise — typically beat reporter
 *     or local sports radio depending on draw)
 *
 * The spectrums (accuracy 1-10, hype 1-10) carry small per-league
 * variance off the template baseline so different leagues feel slightly
 * different. The relative ordering (an INSIDER outlet stays more accurate
 * than a RADIO outlet) is preserved.
 */

import type { Prng } from '../prng/index.js';
import type { TeamState } from '../types/team.js';
import type { TeamId, MediaOutletId } from '../types/ids.js';
import { MediaOutletId as MediaOutletIdCtor } from '../types/ids.js';
import type {
  MediaOutlet,
  MediaTier,
  MediaFocus,
  MediaMarket,
} from '../types/media.js';

interface NationalOutletTemplate {
  /** Stable id slug used to construct `M_<slug>`. */
  slug: string;
  name: string;
  tier: MediaTier;
  focus: MediaFocus;
  baselineAccuracy: number; // 1-10
  baselineHype: number; // 1-10
}

/**
 * National-tier outlets. Names are plausible-fictional rather than
 * real trademarks — avoids both legal noise and the worse outcome
 * of dating the engine to a specific real-world media lineup.
 *
 * The accuracy / hype baselines anchor each outlet's archetype:
 *   INSIDER tier → high accuracy (8-9), low-medium hype (3-5)
 *   BEAT tier → high accuracy (8-9), low hype (2-4)
 *   COLUMNIST tier → mid accuracy (6-7), medium-high hype (5-7)
 *   RADIO tier → low accuracy (3-5), high hype (8-9)
 *   BLOG tier → wide range (set per outlet)
 */
const NATIONAL_OUTLET_TEMPLATES: readonly NationalOutletTemplate[] = [
  // Insiders — the breaking-news, source-laden top of the food chain
  {
    slug: 'pro-football-insider',
    name: 'Pro Football Insider',
    tier: 'INSIDER',
    focus: 'NFL',
    baselineAccuracy: 9,
    baselineHype: 4,
  },
  {
    slug: 'gridiron-wire',
    name: 'Gridiron Wire',
    tier: 'INSIDER',
    focus: 'NFL',
    baselineAccuracy: 9,
    baselineHype: 5,
  },
  // National beats — the careful long-form analysts
  {
    slug: 'pro-football-weekly',
    name: 'Pro Football Weekly',
    tier: 'BEAT',
    focus: 'NFL',
    baselineAccuracy: 8,
    baselineHype: 3,
  },
  {
    slug: 'football-outsiders',
    name: 'Football Outsiders',
    tier: 'BEAT',
    focus: 'NFL',
    baselineAccuracy: 8,
    baselineHype: 2,
  },
  // Columnists — opinionated national takes
  {
    slug: 'the-front-office',
    name: 'The Front Office',
    tier: 'COLUMNIST',
    focus: 'NFL',
    baselineAccuracy: 7,
    baselineHype: 6,
  },
  {
    slug: 'down-and-distance',
    name: 'Down & Distance',
    tier: 'COLUMNIST',
    focus: 'NFL',
    baselineAccuracy: 6,
    baselineHype: 7,
  },
  {
    slug: 'gridiron-monthly',
    name: 'Gridiron Monthly',
    tier: 'COLUMNIST',
    focus: 'BOTH',
    baselineAccuracy: 7,
    baselineHype: 6,
  },
  // National sports radio — high volume, low accuracy
  {
    slug: 'national-football-radio',
    name: 'National Football Radio',
    tier: 'RADIO',
    focus: 'NFL',
    baselineAccuracy: 4,
    baselineHype: 9,
  },
  {
    slug: 'the-blitz-show',
    name: 'The Blitz Show',
    tier: 'RADIO',
    focus: 'NFL',
    baselineAccuracy: 5,
    baselineHype: 8,
  },
  // National blog — wide-coverage, mid-tier
  {
    slug: 'two-minute-drill',
    name: 'Two-Minute Drill',
    tier: 'BLOG',
    focus: 'BOTH',
    baselineAccuracy: 6,
    baselineHype: 7,
  },
];

/**
 * College-focused outlets. v0.62 generates these as entities but no
 * generator writes reports for them yet — the college-season slice
 * will populate `prospect-board` / `narrative` / `player-take` kinds
 * keyed to college subjects.
 */
const COLLEGE_OUTLET_TEMPLATES: readonly NationalOutletTemplate[] = [
  {
    slug: 'college-football-insider',
    name: 'College Football Insider',
    tier: 'INSIDER',
    focus: 'COLLEGE',
    baselineAccuracy: 9,
    baselineHype: 4,
  },
  {
    slug: 'campus-pressbox',
    name: 'Campus Pressbox',
    tier: 'BEAT',
    focus: 'COLLEGE',
    baselineAccuracy: 8,
    baselineHype: 3,
  },
  {
    slug: 'recruiting-247',
    name: 'Recruiting 247',
    tier: 'COLUMNIST',
    focus: 'COLLEGE',
    baselineAccuracy: 7,
    baselineHype: 7,
  },
  {
    slug: 'saturday-stories',
    name: 'Saturday Stories',
    tier: 'COLUMNIST',
    focus: 'COLLEGE',
    baselineAccuracy: 6,
    baselineHype: 8,
  },
  {
    slug: 'gameday-radio',
    name: 'Gameday Radio',
    tier: 'RADIO',
    focus: 'COLLEGE',
    baselineAccuracy: 4,
    baselineHype: 9,
  },
];

/**
 * Templates for per-team local outlets. Each team gets exactly ONE
 * local outlet, drawn from this pool. Distribution lets some teams
 * have a buttoned-up beat reporter (high accuracy, low hype) while
 * other teams have a hot-take sports-radio station (low accuracy,
 * high hype) — captures real-NFL local-market variance.
 *
 * Selection is deterministic per team-id via PRNG.
 */
interface LocalOutletKind {
  /** Format string for the outlet name. `{loc}` = team city / region. */
  nameTemplate: string;
  tier: MediaTier;
  baselineAccuracy: number;
  baselineHype: number;
  /** Relative selection weight. */
  weight: number;
}

const LOCAL_OUTLET_KINDS: readonly LocalOutletKind[] = [
  // Beat reporters — the careful one-team experts
  {
    nameTemplate: 'The {loc} Beat',
    tier: 'BEAT',
    baselineAccuracy: 8,
    baselineHype: 3,
    weight: 4,
  },
  {
    nameTemplate: '{loc} Press Box',
    tier: 'BEAT',
    baselineAccuracy: 8,
    baselineHype: 4,
    weight: 3,
  },
  // Local columnists — opinionated but informed
  {
    nameTemplate: '{loc} Football Notes',
    tier: 'COLUMNIST',
    baselineAccuracy: 7,
    baselineHype: 5,
    weight: 3,
  },
  // Local sports radio — the hot-take engines
  {
    nameTemplate: 'Sports Talk {loc}',
    tier: 'RADIO',
    baselineAccuracy: 4,
    baselineHype: 9,
    weight: 2,
  },
  {
    nameTemplate: '{loc} Sports Drive',
    tier: 'RADIO',
    baselineAccuracy: 5,
    baselineHype: 8,
    weight: 2,
  },
  // Local fan blog
  {
    nameTemplate: 'Inside the {loc} Locker',
    tier: 'BLOG',
    baselineAccuracy: 6,
    baselineHype: 7,
    weight: 2,
  },
];

/**
 * Generate the league's media ecosystem. Deterministic from seed.
 * Returns the full outlet record keyed by MediaOutletId.
 */
export function generateMediaOutlets(
  prng: Prng,
  teams: readonly TeamState[],
): Record<MediaOutletId, MediaOutlet> {
  const out: Record<string, MediaOutlet> = {};

  // National + college outlets — direct from templates with small
  // per-league spectrum variance off the baseline (±1 in each axis).
  for (const tpl of [...NATIONAL_OUTLET_TEMPLATES, ...COLLEGE_OUTLET_TEMPLATES]) {
    const id = MediaOutletIdCtor(`MO_${tpl.slug}`);
    const variancePrng = prng.fork(`variance:${tpl.slug}`);
    const accDelta = variancePrng.nextRange(-1, 2); // -1, 0, or +1
    const hypeDelta = variancePrng.nextRange(-1, 2);
    out[id] = {
      id,
      name: tpl.name,
      tier: tpl.tier,
      focus: tpl.focus,
      market: 'NATIONAL' as MediaMarket,
      accuracySpectrum: clamp(tpl.baselineAccuracy + accDelta, 1, 10),
      hypeSpectrum: clamp(tpl.baselineHype + hypeDelta, 1, 10),
    };
  }

  // Per-team local outlets — one per franchise, drawn from weighted pool.
  for (const team of teams) {
    const teamPrng = prng.fork(`local:${team.identity.id}`);
    const kind = pickWeightedKind(teamPrng.fork('kind'), LOCAL_OUTLET_KINDS);
    const accDelta = teamPrng.fork('acc').nextRange(-1, 2);
    const hypeDelta = teamPrng.fork('hype').nextRange(-1, 2);
    const id = MediaOutletIdCtor(`MO_local_${team.identity.id}`);
    out[id] = {
      id,
      name: kind.nameTemplate.replace('{loc}', team.identity.location),
      tier: kind.tier,
      focus: 'NFL',
      market: { localTo: team.identity.id as TeamId },
      accuracySpectrum: clamp(kind.baselineAccuracy + accDelta, 1, 10),
      hypeSpectrum: clamp(kind.baselineHype + hypeDelta, 1, 10),
    };
  }

  return out as Record<MediaOutletId, MediaOutlet>;
}

function pickWeightedKind(prng: Prng, kinds: readonly LocalOutletKind[]): LocalOutletKind {
  return prng.weighted(kinds.map((k) => ({ value: k, weight: k.weight })));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
