/**
 * Draft-day GM & HC blurbs (v0.162) — the regime's own words on a pick.
 *
 * When a team drafts a player, the GM and the head coach each get a short,
 * celebratory write-up on WHY they're excited — a window into the front office
 * as people and evaluators. The two voices are deliberately distinct:
 *
 *   - GM   → value, board, process, roster-building. "We had a grade on him a
 *            round higher." Flavored by `draftConviction`, `intangiblesWeighting`
 *            and GM quirks (FILM_ROOM_HERMIT vs COMBINE_OBSESSED vs STAR_CHASER…).
 *   - HC   → scheme fit, role, development. Names the actual scheme archetype,
 *            talks competition for snaps and coaching the player up. Flavored by
 *            `qbDevelopment`, `playerRelationships` and HC quirks (QB_WHISPERER,
 *            CULTURE_CARRIER…).
 *
 * Length scales with the pick: a 1st-rounder gets ~5 sentences, Day-2 ~3,
 * Day-3 ~1-2, and a STEAL (a player who fell well past where the league valued
 * him) buys extra sentences and a "we couldn't believe he was there" angle.
 *
 * Living Voice: every word derives from `voiceSeed` (NOT the world seed) plus
 * fixed pick context, so the same draft sounds different per playthrough and a
 * re-opened blurb reproduces identically (a frozen dated artifact). This module
 * is pure — no `crypto`/`Math.random`, no DOM. Per North Star it surfaces
 * qualitative narrative only, never a true rating/tier number.
 */

import type { Prng } from '../prng/index.js';
import { voicePrng } from './voice.js';
import { scoutTraitsFor } from './scout-vocabulary.js';
import { getSchoolById } from '../data/colleges/index.js';
import type { Position } from '../types/enums.js';
import type { DraftBoardReason, DraftProspectProfile } from '../types/college.js';
import type {
  Gm,
  HeadCoach,
  GmQuirk,
  HcQuirk,
  OffensiveSchemeArchetype,
  DefensiveSchemeArchetype,
} from '../types/personnel.js';

export interface DraftBlurbArgs {
  gm: Gm;
  hc: HeadCoach;
  /** Snapshot of the drafted prospect (position, archetype, school, measurables…). */
  profile: DraftProspectProfile;
  /** Display name of the drafted player (`first last`). */
  playerName: string;
  /** Draft round (1-indexed). */
  round: number;
  /** Overall pick slot (1-indexed). */
  overallPick: number;
  /** The board reason badge the team acted on, or null. */
  boardReason: DraftBoardReason | null;
  /** The team's top needs at pick time. */
  needs: readonly Position[];
  /** Natural position the player converts FROM, if drafted to move spots. */
  convertedFromPosition?: Position;
  /** Whether the team had a desperate QB need at pick time. */
  qbDesperate: boolean;
  /**
   * Consensus rank of the prospect in the class, if known. The steal signal:
   * a player taken many slots LATER than the consensus valued him is a steal.
   */
  consensusRank: number | null;
  seasonNumber: number;
  voiceSeed: string;
}

export interface DraftBlurbs {
  gm: string;
  hc: string;
}

type StealTier = 'NONE' | 'MILD' | 'BIG';

// ─── Position taxonomy ──────────────────────────────────────────────────────

const OFFENSE: ReadonlySet<string> = new Set([
  'QB',
  'RB',
  'FB',
  'WR',
  'TE',
  'LT',
  'LG',
  'C',
  'RG',
  'RT',
]);
const SPECIAL: ReadonlySet<string> = new Set(['K', 'P', 'LS']);

const POS_NOUN: Record<string, string> = {
  QB: 'quarterback',
  RB: 'running back',
  FB: 'fullback',
  WR: 'receiver',
  TE: 'tight end',
  LT: 'tackle',
  LG: 'guard',
  C: 'center',
  RG: 'guard',
  RT: 'tackle',
  EDGE: 'edge rusher',
  DT: 'interior defender',
  NT: 'nose tackle',
  ILB: 'linebacker',
  OLB: 'linebacker',
  CB: 'corner',
  S: 'safety',
  NICKEL: 'nickel back',
  K: 'kicker',
  P: 'punter',
  LS: 'long snapper',
};

const UNIT_OF: Record<string, string> = {
  QB: 'the offense',
  RB: 'the backfield',
  FB: 'the backfield',
  WR: 'the receiver room',
  TE: 'the offense',
  LT: 'the offensive line',
  LG: 'the offensive line',
  C: 'the offensive line',
  RG: 'the offensive line',
  RT: 'the offensive line',
  EDGE: 'the defensive front',
  DT: 'the defensive front',
  NT: 'the defensive front',
  ILB: 'the front seven',
  OLB: 'the front seven',
  CB: 'the secondary',
  S: 'the secondary',
  NICKEL: 'the secondary',
  K: 'the special teams unit',
  P: 'the special teams unit',
  LS: 'the special teams unit',
};

const OFF_SCHEME_LABEL: Record<OffensiveSchemeArchetype, string> = {
  WEST_COAST: 'West Coast',
  AIR_RAID: 'Air Raid',
  PRO_STYLE: 'pro-style',
  RUN_HEAVY_POWER: 'power-run',
  SPREAD: 'spread',
  RPO_BASED: 'RPO-based',
  MULTIPLE_HYBRID: 'multiple',
};
const DEF_SCHEME_LABEL: Record<DefensiveSchemeArchetype, string> = {
  BASE_4_3: '4-3',
  BASE_3_4: '3-4',
  NICKEL_HEAVY_3_3_5: 'nickel-heavy 3-3-5',
  COVER_2_SHELL: 'Cover-2 shell',
  AGGRESSIVE_BLITZ_PRESS: 'aggressive press-blitz',
  HYBRID_MULTIPLE: 'multiple',
};

const ORDINAL = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'];

function posNoun(pos: Position): string {
  return POS_NOUN[pos] ?? 'player';
}
function unitOf(pos: Position): string {
  return UNIT_OF[pos] ?? 'the roster';
}
function ordinal(round: number): string {
  return ORDINAL[round] ?? `${round}th`;
}
function cap(s: string): string {
  return s.replace(/^./, (c) => c.toUpperCase());
}

function stealTier(overallPick: number, consensusRank: number | null): StealTier {
  if (consensusRank === null) return 'NONE';
  const fell = overallPick - consensusRank; // slots later than valued
  if (fell >= 60) return 'BIG';
  if (fell >= 28) return 'MILD';
  return 'NONE';
}

/** Sentence budget: round-driven, with a steal bump. R1 ~5 down to R7 ~1. */
function sentenceBudget(round: number, steal: StealTier): number {
  const base = round <= 1 ? 5 : round <= 3 ? 3 : round <= 5 ? 2 : 1;
  const bump = steal === 'BIG' ? 2 : steal === 'MILD' ? 1 : 0;
  return Math.min(6, base + bump);
}

/** A standout combine line keyed to the position group, or null. */
function standoutMeasurable(profile: DraftProspectProfile): string | null {
  const m = profile.measurables;
  const pos = profile.nflProjectedPosition;
  const ht = `${Math.floor(m.heightInches / 12)}-${Math.round(m.heightInches % 12)}`;
  if (OFFENSE.has(pos) && (pos === 'LT' || pos === 'LG' || pos === 'C' || pos === 'RG' || pos === 'RT')) {
    return `${m.benchPress225Reps} reps on the bench at ${ht}, ${Math.round(m.weightLbs)}`;
  }
  if (pos === 'EDGE' || pos === 'DT' || pos === 'NT') {
    return `${m.armLengthInches.toFixed(1)}" arms and the bend you can't teach`;
  }
  // Skill / speed positions — the forty is the headline.
  return `a ${m.fortyYardSeconds.toFixed(2)} forty at ${ht}, ${Math.round(m.weightLbs)}`;
}

// ─── GM voice ───────────────────────────────────────────────────────────────

interface Ctx {
  name: string;
  pos: Position;
  noun: string;
  unit: string;
  school: string | null;
  trait1: string;
  trait2: string;
  measurable: string;
  steal: StealTier;
  round: number;
  overallPick: number;
  reason: DraftBoardReason | null;
  needsHim: boolean;
  convertedFrom: Position | undefined;
  qbDesperate: boolean;
}

function gmOpener(p: Prng, gm: Gm, c: Ctx): string {
  const conv = gm.spectrums.draftConviction;
  if (conv >= 7) {
    return p.pick([
      `We had real conviction on ${c.name}, and we weren't leaving the building without him.`,
      `${c.name} was locked near the top of our board, so this was an easy call when we were on the clock.`,
    ]);
  }
  if (conv <= 3) {
    return p.pick([
      `Honestly, we couldn't believe ${c.name} was still sitting there — we jumped on it.`,
      `When ${c.name} kept sliding, the value got to a point we couldn't pass up.`,
    ]);
  }
  return p.pick([
    `We're thrilled to add ${c.name} to the room.`,
    `${c.name} is a name we kept circling back to, and we're glad he's ours.`,
  ]);
}

function gmValue(p: Prng, c: Ctx): string {
  if (c.steal === 'BIG') {
    return p.pick([
      `Frankly, we had a grade on him a couple rounds higher than this — that's the kind of value that wins you a draft.`,
      `Getting a player we valued this much in the ${ordinal(c.round)} round is a credit to staying patient.`,
    ]);
  }
  if (c.steal === 'MILD') {
    return p.pick([
      `We had him rated well ahead of where we got him, and that value matters.`,
      `To land him in the ${ordinal(c.round)} round is better than we expected when the day started.`,
    ]);
  }
  switch (c.reason) {
    case 'POSITIONAL_NEED':
      return `He fills a real need for us, and we didn't have to reach to do it.`;
    case 'BLUE_CHIP':
      return `He was the best player on our board, full stop.`;
    case 'SCHEME_FIT':
      return `He fits what we're building schematically as well as anyone in this class.`;
    case 'CONVERSION_PROJECTION':
      return `We saw a role for him that not everyone in the league did — that's where value hides.`;
    default:
      return `He's got the traits we covet and a ceiling we're betting on.`;
  }
}

function gmEval(p: Prng, gm: Gm, c: Ctx): string {
  const lines: Partial<Record<GmQuirk, string>> = {
    FILM_ROOM_HERMIT: `The tape is what did it — we watched every snap, and the ${c.trait1} is real.`,
    COMBINE_OBSESSED: `The testing jumped off the page; ${c.measurable} is rare at the spot.`,
    HOMETOWN_HERO_BIAS: `We know this kid and we trust the background — the makeup checked every box.`,
    SCAR_TISSUE: `We did our homework on the medicals and the makeup — he's the kind of bet we're comfortable making.`,
    PHONE_ALWAYS_ON: `We worked the board hard to make sure we were in position for him.`,
    THE_HOARDER: `Adding a player at this level and still keeping our flexibility is exactly how we like to operate.`,
    LOYALTY_KEEPER: `He's the kind of character you build a locker room around.`,
    RECLAMATION_PROJECT_ADDICT: `There's untapped upside here we believe our staff can pull out of him.`,
    STAR_CHASER: `We don't apologize for chasing talent — the ceiling on this kid is special.`,
    PROCESS_PURIST: `He fit our process top to bottom; we trusted the board and it rewarded us.`,
  };
  const present = gm.quirks.map((q) => lines[q]).filter((s): s is string => Boolean(s));
  if (present.length > 0) return p.pick(present);
  // Spectrum fallback — still reveals how this GM evaluates.
  if (gm.spectrums.intangiblesWeighting >= 7) {
    return `The makeup is everything we look for — a worker and a leader.`;
  }
  if (gm.spectrums.analyticsReliance >= 7) {
    return `The numbers and the tape pointed the same direction, and that's when we move.`;
  }
  return `We trusted our evaluation on him, and we feel great about where he landed.`;
}

function gmNeed(p: Prng, c: Ctx): string {
  if (c.needsHim) {
    return p.pick([
      `Addressing ${c.noun} was a priority coming into this draft.`,
      `We targeted help at ${c.noun}, and he was the right man for it.`,
    ]);
  }
  return p.pick([
    `We stayed true to our board rather than forcing a need.`,
    `Best-player-available is how we operate, and that's what this was.`,
  ]);
}

function gmTrait(p: Prng, c: Ctx): string {
  return p.pick([
    `Beyond the ${c.trait1}, the ${c.trait2} gives him a real foundation to build on.`,
    `What you'll love is the ${c.trait1} — it shows up all over his tape.`,
  ]);
}

function gmCloser(p: Prng, gm: Gm): string {
  if (gm.personality.confidence >= 7 || gm.personality.egoLevel >= 7) {
    return p.pick([
      `Don't be surprised if this is a pick people are talking about in a few years.`,
      `We think we got this one right, and we got it right at value.`,
    ]);
  }
  return p.pick([
    `We're excited to get him in the building and get to work.`,
    `He's going to fit right in around here.`,
  ]);
}

// ─── HC voice ───────────────────────────────────────────────────────────────

function hcOpener(p: Prng, hc: HeadCoach, c: Ctx): string {
  if (c.pos === 'QB' && hc.spectrums.qbDevelopment >= 7) {
    return p.pick([
      `Getting a quarterback with this skill set is the kind of opportunity you wait for as a coach.`,
      `From the first install, I can already see what ${c.name} is going to look like in our hands.`,
    ]);
  }
  return p.pick([
    `${c.name} is exactly the kind of ${c.noun} we want in this program.`,
    `From the moment we studied ${c.name}, he felt like one of us.`,
  ]);
}

function hcScheme(p: Prng, hc: HeadCoach, c: Ctx): string {
  // Conversion phrasing only when the move actually changes the noun
  // (LT/RT and LG/RG share one — "move off tackle" to "tackle" reads wrong).
  if (c.convertedFrom && posNoun(c.convertedFrom) !== c.noun) {
    return `We love him at ${c.noun} — the move off ${posNoun(c.convertedFrom)} fits exactly what we ask.`;
  }
  if (SPECIAL.has(c.pos)) {
    return `He's going to make his mark on all four special-teams units right away.`;
  }
  if (OFFENSE.has(c.pos)) {
    return p.pick([
      `In our ${OFF_SCHEME_LABEL[hc.offensiveScheme]} offense, his ${c.trait1} is going to translate right away.`,
      `He's a clean fit for the ${OFF_SCHEME_LABEL[hc.offensiveScheme]} concepts we build around.`,
    ]);
  }
  return p.pick([
    `He's a natural for what we ask in our ${DEF_SCHEME_LABEL[hc.defensiveScheme]} looks.`,
    `The way we play defense in our ${DEF_SCHEME_LABEL[hc.defensiveScheme]} front, his ${c.trait1} is going to shine.`,
  ]);
}

function hcRole(p: Prng, c: Ctx): string {
  if (c.round <= 2) {
    return p.pick([
      `I expect him to compete for a real role from day one.`,
      `He's going to be in the mix for snaps the moment he walks in.`,
    ]);
  }
  if (c.round <= 4) {
    return `He's going to push for snaps and earn his way onto the field.`;
  }
  return `He'll make his money on teams first and grow into a bigger role.`;
}

function hcDev(p: Prng, hc: HeadCoach, c: Ctx): string {
  const lines: Partial<Record<HcQuirk, string>> = {
    QB_WHISPERER: `I can't wait to get in the lab with him — the traits to develop are all there.`,
    CULTURE_CARRIER: `He raises the standard in the room the moment he walks in.`,
    RUN_FIRST_NO_MATTER_WHAT: `He fits the physical, downhill brand of football we want to play.`,
    BLITZ_HAPPY: `He gives us another weapon to bring pressure and play on our terms.`,
    GADGET_PLAY_LOVER: `Our staff is already drawing up ways to get him involved.`,
    HALFTIME_ADJUSTER: `He's smart and versatile — the kind of player you can scheme around.`,
    FOURTH_DOWN_GAMBLER: `He plays with the same edge we coach with.`,
    CLOCK_KILLER: `He fits the complementary, ball-control football we believe in.`,
    LOYAL_TO_A_FAULT: `He's our kind of guy, and we're going to invest in him.`,
  };
  const present = hc.quirks
    // QB_WHISPERER is a quarterback-development trait — only color a QB pick.
    .filter((q) => q !== 'QB_WHISPERER' || c.pos === 'QB')
    .map((q) => lines[q])
    .filter((s): s is string => Boolean(s));
  if (present.length > 0) return p.pick(present);
  if (hc.spectrums.staffDevelopment >= 7) {
    return `We'll coach the details up — that's what our staff does best.`;
  }
  return `There's a foundation here we're excited to build on.`;
}

function hcCloser(p: Prng, hc: HeadCoach): string {
  if (hc.spectrums.playerRelationships >= 7) {
    return p.pick([
      `He's going to love playing here, and we're going to love coaching him.`,
      `Can't wait to get to know him and get him on the grass.`,
    ]);
  }
  return p.pick([`Can't wait to get him on the grass.`, `He's going to add a lot to what we do.`]);
}

// ─── Orchestration ──────────────────────────────────────────────────────────

function assemble(sentences: string[], budget: number): string {
  return sentences
    .slice(0, budget)
    .map((s) => cap(s.trim()))
    .join(' ');
}

/**
 * Build the GM and HC draft-day blurbs for one pick. Deterministic from
 * `voiceSeed` + the pick's fixed context.
 */
export function buildDraftBlurbs(args: DraftBlurbArgs): DraftBlurbs {
  const { gm, hc, profile, playerName, voiceSeed, seasonNumber, overallPick } = args;
  const pos = profile.nflProjectedPosition;
  const steal = stealTier(overallPick, args.consensusRank);
  const budget = sentenceBudget(args.round, steal);

  // One root stream per blurb off the VOICE seed + fixed pick context.
  const traitPrng = voicePrng(voiceSeed, 'draft-blurb-traits', seasonNumber, overallPick);
  const traits = scoutTraitsFor(traitPrng, pos, 2);
  const needsHim = args.needs.includes(pos);

  const c: Ctx = {
    name: playerName,
    pos,
    noun: posNoun(pos),
    unit: unitOf(pos),
    school: getSchoolById(profile.schoolId)?.name ?? null,
    trait1: traits[0] ?? 'his game',
    trait2: traits[1] ?? 'his frame',
    measurable: standoutMeasurable(profile) ?? 'his testing',
    steal,
    round: args.round,
    overallPick,
    reason: args.boardReason,
    needsHim,
    convertedFrom: args.convertedFromPosition,
    qbDesperate: args.qbDesperate,
  };

  const gp = voicePrng(voiceSeed, 'draft-blurb-gm', seasonNumber, overallPick, gm.id);
  const gmSentences = [
    gmOpener(gp.fork('open'), gm, c),
    gmValue(gp.fork('value'), c),
    gmNeed(gp.fork('need'), c),
    gmEval(gp.fork('eval'), gm, c),
    gmTrait(gp.fork('trait'), c),
    gmCloser(gp.fork('close'), gm),
  ];

  const hp = voicePrng(voiceSeed, 'draft-blurb-hc', seasonNumber, overallPick, hc.id);
  const hcSentences = [
    hcOpener(hp.fork('open'), hc, c),
    hcScheme(hp.fork('scheme'), hc, c),
    hcRole(hp.fork('role'), c),
    hcDev(hp.fork('dev'), hc, c),
    hcCloser(hp.fork('close'), hc),
  ];

  return {
    gm: assemble(gmSentences, budget),
    hc: assemble(hcSentences, budget),
  };
}
