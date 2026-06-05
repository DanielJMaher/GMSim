/**
 * Player backstory — the Narrator, deepened into the engine (v0.119).
 *
 * The Narrator agent measured the REAL drafted-population backstory taxonomy
 * (Beast bios: recruiting pedigree × round, transfer/redshirt/walk-on/bloodline
 * /multi-sport/captain rates). Prospects already carry those facts; this module
 * (1) distills them into a compact `PlayerBackstory` that travels into the NFL,
 * (2) synthesizes one for generated veterans who never went through the college
 * pipeline, and (3) renders any backstory as prose for scout/media/profile copy.
 *
 * `narrateBackstory` is PURE (no PRNG) — identical facts always read the same,
 * which keeps it trivially deterministic and testable. The synthesis paths take
 * a PRNG and mirror the prospect generator's own rates so a generated vet's bio
 * is drawn from the same distribution as a drafted player's.
 *
 * Per North Star: public bio, surfaced as narrative — never a rating number.
 */

import type { Prng } from '../prng/index.js';
import type { Position, PositionGroup } from '../types/enums.js';
import type { TalentTier } from '../types/player.js';
import type {
  PlayerBackstory,
  CollegePlayer,
  RecruitingBackground,
  Bloodline,
  BloodlineRelation,
} from '../types/college.js';
import { positionGroupFor } from './position-group.js';
import { rollStarRating, rollHometown } from '../draft/recruiting.js';
import { rollMultiSportBackground } from '../draft/character.js';

const NO_BLOODLINE: Bloodline = {
  hasNflFamily: false,
  relation: null,
  relativeName: null,
  relativeWasStar: false,
};

/** "a", "a and b", "a, b and c". */
function joinAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function capitalize(s: string): string {
  return s.replace(/^./, (c) => c.toUpperCase());
}

/** The pedigree lead — how he was recruited, framed by stars + background. */
function pedigreeLead(b: PlayerBackstory): string {
  const where = `${b.hometown.city}, ${b.hometown.state}`;
  if (b.background === 'WALK_ON_STORY') return `An unheralded walk-on out of ${where}`;
  if (b.background === 'SMALL_SCHOOL_GEM') return `A small-school find from ${where}`;
  switch (b.recruitingStars) {
    case 5:
      return `A consensus five-star recruit out of ${where}`;
    case 4:
      return `A blue-chip four-star out of ${where}`;
    case 3:
      return `A solid three-star recruit from ${where}`;
    default:
      return `A lightly-recruited prospect from ${where}`;
  }
}

/**
 * Render a backstory as 1–3 sentences of prose. Empty arc/trait/bloodline
 * pieces are simply omitted, so a plain backstory reads as a single sentence.
 */
export function narrateBackstory(b: PlayerBackstory): string {
  const arcs: string[] = [];
  if (b.redshirted) arcs.push('redshirted early');
  if (b.transferred) arcs.push('transferred before finding a home');
  const lead = `${pedigreeLead(b)}${arcs.length ? ` who ${joinAnd(arcs)}` : ''}.`;

  const traits: string[] = [];
  if (b.multiSport) traits.push('a multi-sport athlete in high school');
  if (b.wasCaptain) traits.push('a team captain');
  const traitSentence = traits.length ? `${capitalize(joinAnd(traits))}.` : '';

  let bloodSentence = '';
  if (b.bloodline.hasNflFamily && b.bloodline.relation) {
    const rel = b.bloodline.relation.toLowerCase();
    const named = b.bloodline.relativeName ? ` ${b.bloodline.relativeName}` : '';
    const verb = b.bloodline.relativeWasStar ? 'starred in the league' : 'played in the league';
    bloodSentence = `NFL runs in the family — his ${rel}${named} ${verb}.`;
  }

  return [lead, traitSentence, bloodSentence].filter(Boolean).join(' ');
}

/** Distill a drafted prospect's full facts into the carried backstory. */
export function backstoryFromProspect(cp: CollegePlayer): PlayerBackstory {
  return {
    recruitingStars: cp.recruiting.starRating,
    background: cp.recruiting.background,
    hometown: cp.recruiting.hometown,
    transferred: cp.transferred,
    redshirted: cp.redshirted,
    multiSport: cp.multiSportBackground,
    bloodline: cp.bloodline,
    wasCaptain: cp.characterFlags.includes('CAPTAIN'),
  };
}

/** A school-less background tag for a generated vet (no CollegeSchool to read). */
function deriveVetBackground(prng: Prng, stars: number): RecruitingBackground {
  if (stars >= 4) return 'PEDIGREE';
  if (stars === 3) return prng.next() < 0.5 ? 'BIG_PROGRAM' : 'DEVELOPMENTAL';
  // 1–2 star: mostly a developmental/walk-on arc, occasionally a small-school gem.
  const roll = prng.next();
  if (roll < 0.45) return 'WALK_ON_STORY';
  if (roll < 0.75) return 'DEVELOPMENTAL';
  return 'SMALL_SCHOOL_GEM';
}

const BLOODLINE_RELATIONS: readonly BloodlineRelation[] = ['FATHER', 'BROTHER', 'UNCLE', 'COUSIN'];

/**
 * Synthesize a backstory for a generated veteran from tier + position.
 * Rates mirror the prospect generator (transfer ~34%, redshirt ~40%,
 * multi-sport position-weighted, bloodline ~8%, captain ~24%) so a vet's bio is
 * drawn from the same distribution as a drafted player's. Deterministic.
 */
export function synthesizeBackstory(
  prng: Prng,
  tier: TalentTier,
  position: Position,
): PlayerBackstory {
  const stars = rollStarRating(prng.fork('star'), tier);
  const group: PositionGroup = positionGroupFor(position);

  let bloodline: Bloodline = NO_BLOODLINE;
  const bloodPrng = prng.fork('blood');
  if (bloodPrng.next() < 0.08) {
    bloodline = {
      hasNflFamily: true,
      relation: bloodPrng.pick(BLOODLINE_RELATIONS),
      relativeName: null, // no name-gen for vets; the Narrator handles a nameless relative
      relativeWasStar: bloodPrng.next() < 0.3,
    };
  }

  return {
    recruitingStars: stars,
    background: deriveVetBackground(prng.fork('bg'), stars),
    hometown: rollHometown(prng.fork('home')),
    transferred: prng.fork('tx').next() < 0.34,
    redshirted: prng.fork('rs').next() < 0.4,
    multiSport: rollMultiSportBackground(prng.fork('multi'), group),
    bloodline,
    wasCaptain: prng.fork('cap').next() < 0.24,
  };
}
