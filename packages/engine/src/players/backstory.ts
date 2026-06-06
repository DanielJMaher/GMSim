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

import type { Position, PositionGroup } from '../types/enums.js';
import type { TalentTier, PlayerSkills } from '../types/player.js';
import type {
  PlayerBackstory,
  CollegePlayer,
  RecruitingBackground,
  Bloodline,
  BloodlineRelation,
} from '../types/college.js';
import { Prng } from '../prng/index.js';
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

/**
 * Notable second-sport — the Living-Voice "blurb = coded attribute" seed
 * (v0.123, Slice A). It is NOT a free roll: it is DERIVED FROM the player's
 * hidden athletic profile and only surfaces when an attribute is genuinely
 * standout, so reading it tells you something true (track → speed, hoops →
 * agility/leaping, baseball → arm/hands, tennis/golf → QB touch). The
 * "surprising for his frame" variant fires when size contradicts the athletic
 * read — a heavy player who still runs (the DK Metcalf tell).
 *
 * The descriptor is a bare noun phrase and NEVER speaks a rating or number
 * (North Star — stats are hidden). Deterministic given the prng.
 */

/** A rating at/above this (0–100) is "genuinely standout" — worth a sport tell. */
const ELITE = 84;
/** Even elite athletes didn't all star in another sport. */
const NOTABLE_PROB = 0.55;
/** Heavy + fast = the surprising-for-his-frame tell (Metcalf territory). */
const SURPRISE_SPEED_LBS = 230;
/** True big man for the throws/mat events. */
const BIG_STRONG_LBS = 250;

const TRACK_SPEED: readonly string[] = [
  'a state-champion sprinter',
  'a high-school track standout',
  'an anchor on the state-title relay',
];
const SURPRISE_SPEED: readonly string[] = [
  'a sprinter who ran varsity track at his size',
  'a state-meet sprinter despite his frame',
  'big enough for the line and still ran a relay leg',
];
const HOOPS: readonly string[] = [
  'a shifty high-school point guard',
  'a varsity basketball starter',
  'a soccer winger with sudden feet',
];
const HOOPS_BIG: readonly string[] = [
  'a nimble big man on the basketball team',
  'light enough on his feet to start at forward',
];
const LEAP: readonly string[] = [
  'a high-jump champion',
  'a volleyball net presence',
  'a leaper who played above the rim',
];
const THROWS_STRONG: readonly string[] = [
  'a state-placing shot-putter',
  'a heavyweight wrestler',
  'a discus thrower at the state meet',
];
const BASEBALL_ARM: readonly string[] = [
  'a flame-throwing prep pitcher',
  'a hard-throwing baseball recruit',
];
const TENNIS_GOLF: readonly string[] = [
  'a nationally-ranked junior tennis player',
  'a scratch golfer',
  'a state-ranked tennis player',
];
const BASEBALL_HANDS: readonly string[] = [
  'an all-state baseball outfielder',
  'a shortstop with soft hands',
  'a center fielder who tracked everything',
];

/** The athletic facts the notable-sport read keys off. */
export interface NotableSportInput {
  skills: PlayerSkills;
  weightLbs: number;
  position: Position;
}

/**
 * Derive a NOTABLE second-sport descriptor from the player's athletic profile,
 * or null (the common case — most players' second sport isn't worth a line).
 * Deterministic given the prng.
 */
export function rollNotableOtherSport(prng: Prng, input: NotableSportInput): string | null {
  const { skills, weightLbs, position } = input;
  const group = positionGroupFor(position);
  const big = weightLbs >= SURPRISE_SPEED_LBS;

  // Collect the player's genuinely-standout athletic traits, each with the sport
  // pool that "explains" it. Pick the most extreme.
  const cands: { v: number; pool: readonly string[] }[] = [];
  const speedish = Math.max(skills.speed, skills.acceleration);
  if (speedish >= ELITE) cands.push({ v: speedish, pool: big ? SURPRISE_SPEED : TRACK_SPEED });
  const quick = Math.max(skills.agility, skills.changeOfDirection);
  if (quick >= ELITE) cands.push({ v: quick, pool: big ? HOOPS_BIG : HOOPS });
  if (skills.jumping >= ELITE) cands.push({ v: skills.jumping, pool: LEAP });
  if (skills.strength >= ELITE && weightLbs >= BIG_STRONG_LBS) {
    cands.push({ v: skills.strength, pool: THROWS_STRONG });
  }
  if (position === 'QB' && skills.throwPower >= ELITE) {
    cands.push({ v: skills.throwPower, pool: BASEBALL_ARM });
  }
  if (position === 'QB' && Math.max(skills.composure, skills.accuracyDeep) >= ELITE) {
    cands.push({ v: Math.max(skills.composure, skills.accuracyDeep), pool: TENNIS_GOLF });
  }
  if ((group === 'SKILL' || group === 'DB') && skills.catching >= ELITE) {
    cands.push({ v: skills.catching, pool: BASEBALL_HANDS });
  }

  if (cands.length === 0) return null;
  if (prng.next() >= NOTABLE_PROB) return null;
  cands.sort((a, b) => b.v - a.v);
  // Among the genuinely-standout traits, lean toward the most extreme but allow
  // the runner-up so two equally-fast players don't always cite the same sport.
  const top = cands.length > 1 && prng.next() < 0.3 ? cands[1]! : cands[0]!;
  return prng.pick(top.pool);
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
  // Multi-sport is baseline reality, not a story — only a NOTABLE second sport
  // (standout / surprising) earns a line.
  if (b.notableOtherSport) traits.push(b.notableOtherSport);
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

/** Distill a drafted prospect's full facts into the carried backstory. The
 *  notable second-sport is derived deterministically from the prospect id (only
 *  multi-sport players are eligible), so it's stable across reload and promote. */
export function backstoryFromProspect(cp: CollegePlayer): PlayerBackstory {
  const notableOtherSport = cp.multiSportBackground
    ? rollNotableOtherSport(new Prng(`${cp.id}::notable-sport`), {
        skills: cp.current,
        weightLbs: cp.measurables.weightLbs,
        position: cp.nflProjectedPosition,
      })
    : null;
  return {
    recruitingStars: cp.recruiting.starRating,
    background: cp.recruiting.background,
    hometown: cp.recruiting.hometown,
    transferred: cp.transferred,
    redshirted: cp.redshirted,
    multiSport: cp.multiSportBackground,
    notableOtherSport,
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
 *
 * `athletic` (skills + weight) feeds the attribute-coded notable second-sport
 * (Slice A). When omitted (callers without a rolled skill set), the bio simply
 * carries no notable sport — a clean degrade, not a wrong signal.
 */
export function synthesizeBackstory(
  prng: Prng,
  tier: TalentTier,
  position: Position,
  athletic?: { skills: PlayerSkills; weightLbs: number },
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

  const multiSport = rollMultiSportBackground(prng.fork('multi'), group);
  const notableOtherSport =
    multiSport && athletic
      ? rollNotableOtherSport(prng.fork('notable'), {
          skills: athletic.skills,
          weightLbs: athletic.weightLbs,
          position,
        })
      : null;
  return {
    recruitingStars: stars,
    background: deriveVetBackground(prng.fork('bg'), stars),
    hometown: rollHometown(prng.fork('home')),
    transferred: prng.fork('tx').next() < 0.34,
    redshirted: prng.fork('rs').next() < 0.4,
    multiSport,
    notableOtherSport,
    bloodline,
    wasCaptain: prng.fork('cap').next() < 0.24,
  };
}
