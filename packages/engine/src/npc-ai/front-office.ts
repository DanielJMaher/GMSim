import type { LeagueState } from '../types/league.js';
import type { TeamState, FrontOfficeState, TeamSeasonRecord } from '../types/team.js';
import type { Owner, Gm, HeadCoach, CareerStint, StintEnd } from '../types/personnel.js';
import type { TeamId } from '../types/ids.js';
import type { Transaction } from '../types/transaction.js';
import type { Prng } from '../prng/index.js';
import { MarketSize, CompetitiveWindow } from '../types/enums.js';
import { computeRecords, playoffSeeds } from '../season/standings.js';
import { generateGm } from '../personnel/gm.js';
import { generateHeadCoach } from '../personnel/hc.js';
import { seedPerceivedOutletReliability } from '../personnel/perceived-outlet-trust.js';
import { computeTeamPersonality } from '../personnel/team-personality.js';

/**
 * THE FRONT-OFFICE LIFECYCLE — owner evaluations, the firing ladder, and
 * the hiring market (GM hire/fire design doc, S1 "regime mortality").
 *
 * This is NPC decision logic, so it lands HERE per CLAUDE.md invariant #6.
 * Two league-shaped entry points, both pure (league + PRNG in → league out):
 *
 *   - `runBlackMondayFirings` — fires from the BLACK_MONDAY lifecycle step
 *     (the day after the final regular-season week). Evaluates the 18
 *     non-playoff teams: accumulates career stints, updates seat pressure,
 *     and runs the firing ladder. Fired personnel flip to UNEMPLOYED but
 *     stay seated as caretakers (gmVacant/hcVacant flags) until hiring.
 *   - `runPostSeasonFrontOffice` — fires at the top of POST_SEASON_FINALIZE
 *     (after the Super Bowl, before the combine — the real-world Dec–Jan
 *     window where 91% of hires land). Evaluates the 14 playoff teams with
 *     full playoff results, then fills every vacancy league-wide: GM seat
 *     first, then HC (the new GM shapes the coach choice), TeamPersonality
 *     recomputed on every change.
 *
 * The evaluation is EXPECTATION-RELATIVE, not absolute (design §2.3 rule 7):
 * disappointment = expectedWins − wins − playoffCredit, where expectation
 * comes from last season regressed to the mean, the competitive window, and
 * a tenure ramp ("year 3 of a rebuild must show progress"). Owner patience
 * scales the heat; playoff runs bank credit that decays slowly (the
 * Keim/Telesco clock-reset). All tuning constants are exported so the
 * Headhunter audit and tests can assert against the same numbers.
 *
 * The firing ladder encodes the empirical rules (design §3.3):
 *   1. HC before GM — the coach seat heats ~2.5× faster (GM_HEAT_RATIO).
 *   2. A GM survives his FIRST own-hire's firing ~85%; when his SECOND+
 *      own hire fails, the GM goes (~75% joint, survivors lame-ducked) —
 *      zero real-world GMs in years 4–7 survived it. The two escape
 *      hatches (early-teardown, banked-credit) are mediated by low
 *      accumulated seat pressure, not a separate mercy roll.
 *   3. GM-only firings (the Robinson path) need pressure ≫ threshold.
 *
 * North Star: seat pressure and everything here is hidden ground truth.
 * The game UI sees only the resulting news items; the inspector (the
 * sanctioned calibration lens) reads the raw numbers.
 */

// ─── Tuning constants (calibrated by `run headhunter`) ──────────────────────

/** Base owner-confidence threshold above which a seat is fired. */
export const FIRING_THRESHOLD = 70;
/** Per-season decay of accumulated pressure/credit (≈25%/yr fade). */
export const PRESSURE_DECAY = 0.7;
/** Pressure points per win of disappointment, HC seat. */
export const HC_HEAT_SCALE = 23;
/** GM seat heats at this fraction of the HC rate (rule 1: ~2-2.5× slower). */
export const GM_HEAT_RATIO = 0.48;
/** Credit (negative disappointment) cools the HC seat at this rate. */
export const HC_CREDIT_SCALE = 12;
/** Credit cools the GM seat faster — winning resets the GM clock harder. */
export const GM_CREDIT_SCALE = 16;
/** Seat pressure clamp range; the negative side is the credit bank. */
export const SEAT_MIN = -60;
export const SEAT_MAX = 110;
/** Lame-duck GMs (survived a 2nd-own-hire firing) are floored here. */
export const LAME_DUCK_FLOOR = 62;
/**
 * GM-only firings (no HC firing in the same cycle — the Robinson path,
 * folding in the real-world in-season GM firings S1 doesn't model yet)
 * need the GM seat above gmThreshold × this.
 */
export const GM_ONLY_BAR = 1.0;
/**
 * A lame-duck GM is already condemned — his bar drops below the normal
 * threshold so a mediocre next season finishes the job (the empirical
 * "gone within 12 months"; a genuinely strong season still saves him).
 */
export const LAME_DUCK_BAR = 0.85;
/** Sustained contention without a ring burns the coach (McDermott path). */
export const RING_FATIGUE = 12;
/** GM accumulated pressure below this opens the survive-coach-#2 hatch. */
export const HATCH_PRESSURE_CEILING = 25;
/** P(joint fire) when coach #2+ (own hire) fails and no hatch is open. */
export const SECOND_HIRE_JOINT_P = 0.75;
/** P(joint fire) when coach #2+ fails but a hatch IS open. */
export const SECOND_HIRE_HATCH_JOINT_P = 0.12;
/** P(joint fire) when the GM's FIRST own hire is fired. */
export const FIRST_HIRE_JOINT_P = 0.12;
/** P(joint fire) when an INHERITED coach is fired. */
export const INHERITED_JOINT_P = 0.05;
/** Chance a GM vacancy is filled from the unemployed-retread pool. */
export const GM_RETREAD_P = 0.15;
/** Chance an HC vacancy is filled from the retread pool (retreads are common). */
export const HC_RETREAD_P = 0.35;
/** Retreads must have worked within this many seasons to stay hireable. */
export const RETREAD_RECENCY = 6;

/** Mean wins in a 17-game season. */
const MEAN_WINS = 8.5;
/** Regression-to-mean factor on last season's wins. */
const PRIOR_REGRESSION = 0.35;

// ─── Season outcome plumbing ────────────────────────────────────────────────

/** What the owner saw this season — the evaluation input. */
export interface SeasonOutcome {
  wins: number;
  losses: number;
  ties: number;
  madePlayoffs: boolean;
  championshipResult?: TeamSeasonRecord['championshipResult'];
}

function champBonus(result: TeamSeasonRecord['championshipResult'] | undefined): number {
  switch (result) {
    case 'won_super_bowl':
      return 6;
    case 'lost_super_bowl':
      return 4;
    case 'lost_conference':
      return 2.5;
    case 'lost_divisional':
      return 1;
    case 'lost_wildcard':
      return 0.5;
    default:
      return 0;
  }
}

/**
 * Replicates the playoff-walk in lifecycle's `buildSeasonRecord` for the
 * front-office evaluation (which runs before the season record is
 * appended to `seasonHistory`).
 */
export function playoffOutcomeForTeam(
  league: LeagueState,
  teamId: TeamId,
): Pick<SeasonOutcome, 'madePlayoffs' | 'championshipResult'> {
  const playoffs = league.schedule?.playoffs;
  if (!playoffs) return { madePlayoffs: false };
  const games = [
    ...playoffs.wildCard,
    ...playoffs.divisional,
    ...playoffs.conference,
    ...playoffs.superBowl,
  ].filter((g) => g.homeTeamId === teamId || g.awayTeamId === teamId);
  if (games.length === 0) return { madePlayoffs: false };
  if (playoffs.championId === teamId) {
    return { madePlayoffs: true, championshipResult: 'won_super_bowl' };
  }
  const last = games[games.length - 1];
  if (!last?.result) return { madePlayoffs: true };
  const wonLast =
    (last.homeTeamId === teamId && last.result.homeScore > last.result.awayScore) ||
    (last.awayTeamId === teamId && last.result.awayScore > last.result.homeScore);
  if (wonLast) return { madePlayoffs: true };
  switch (last.kind) {
    case 'WILD_CARD':
      return { madePlayoffs: true, championshipResult: 'lost_wildcard' };
    case 'DIVISIONAL':
      return { madePlayoffs: true, championshipResult: 'lost_divisional' };
    case 'CONFERENCE':
      return { madePlayoffs: true, championshipResult: 'lost_conference' };
    case 'SUPER_BOWL':
      return { madePlayoffs: true, championshipResult: 'lost_super_bowl' };
    default:
      return { madePlayoffs: true };
  }
}

// ─── The owner's expectation model ──────────────────────────────────────────

/**
 * Competitive-window expectation bump. A CHAMPIONSHIP-window owner
 * expects double digits; a REBUILDING owner accepts losing — for a
 * while (see the tenure ramp).
 */
function windowBump(window: CompetitiveWindow): number {
  switch (window) {
    case CompetitiveWindow.CHAMPIONSHIP:
      return 2;
    case CompetitiveWindow.CONTENDER:
      return 1.5;
    case CompetitiveWindow.EMERGING:
      return -0.5;
    case CompetitiveWindow.STAGNANT:
      return 0;
    case CompetitiveWindow.RETOOLING:
      return -1.5;
    case CompetitiveWindow.REBUILDING:
      return -2.5;
  }
}

/**
 * What the owner expected this season: last season's wins regressed 35%
 * to the mean, shifted by the competitive window, plus a tenure ramp —
 * patience for losing runs out as a regime ages (+1 win/season from the
 * person's 3rd season, capped at +3). Without the ramp a perpetual
 * 4-13 rebuild never fires anyone; with it, year-4-of-the-rebuild
 * coaches are squarely on the hook, which is the real pattern.
 */
export function expectedWinsForTeam(
  team: TeamState,
  tenureSeasons: number,
  rampCap = 3,
): number {
  const last = team.seasonHistory[team.seasonHistory.length - 1];
  const prior = last ? last.wins : MEAN_WINS;
  const regressed = prior + PRIOR_REGRESSION * (MEAN_WINS - prior);
  const ramp = Math.min(rampCap, Math.max(0, tenureSeasons - 2));
  const exp = regressed + windowBump(team.competitiveWindow) + ramp;
  return Math.min(12.5, Math.max(4.5, exp));
}

/** Owner patience 1..10 → pressure multiplier 1.8 (hair-trigger) … 0.5. */
function ownerImpatience(owner: Owner): number {
  return 1.8 - ((owner.spectrums.patience - 1) / 9) * 1.3;
}

/** Market-size + fan-patience heat modifier (~0.85 … ~1.25). */
function marketHeat(team: TeamState): number {
  const size =
    team.identity.marketSize === MarketSize.LARGE
      ? 1.15
      : team.identity.marketSize === MarketSize.SMALL
        ? 0.9
        : 1.0;
  return size * (1 + (5.5 - team.fanBase.patienceLevel) * 0.02);
}

/** Consecutive playoff seasons ending at the most recent recorded one. */
function playoffStreak(history: readonly TeamSeasonRecord[]): number {
  let n = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (!history[i]!.madePlayoffs) break;
    n++;
  }
  return n;
}

export interface SeatUpdate {
  gm: number;
  hc: number;
  expectedHcWins: number;
  expectedGmWins: number;
}

/**
 * One season's seat-pressure update for a team. Pure — exported for
 * tests and the Headhunter. Decay first (old grievances and old glory
 * both fade), then heat or credit from this season's
 * expectation-relative disappointment.
 */
export function computeSeatUpdate(
  team: TeamState,
  owner: Owner,
  outcome: SeasonOutcome,
  seasonNumber: number,
): SeatUpdate {
  const fo = team.frontOffice;
  const hcSeasons = seasonNumber - fo.hcHiredSeason + 1;
  const gmSeasons = seasonNumber - fo.gmHiredSeason + 1;

  const expectedHcWins = expectedWinsForTeam(team, hcSeasons);
  // The GM's patience ramp runs a season longer (cap 4): "three drafts"
  // of grace, then years 4-7 of sustained failure become unsurvivable.
  const expectedGmWins = expectedWinsForTeam(team, gmSeasons, 4);
  const playoffCredit = (outcome.madePlayoffs ? 1.5 : 0) + champBonus(outcome.championshipResult);
  const dHc = expectedHcWins - outcome.wins - playoffCredit;
  const dGm = expectedGmWins - outcome.wins - playoffCredit;

  const impatience = ownerImpatience(owner);
  const heat = marketHeat(team);

  let hc = fo.seatPressure.hc * PRESSURE_DECAY;
  let gm = fo.seatPressure.gm * PRESSURE_DECAY;

  hc += dHc > 0 ? dHc * HC_HEAT_SCALE * impatience * heat : dHc * HC_CREDIT_SCALE;
  gm += dGm > 0 ? dGm * HC_HEAT_SCALE * GM_HEAT_RATIO * impatience * heat : dGm * GM_CREDIT_SCALE;

  // Ring fatigue: 4+ straight playoff years, no ring this year, an owner
  // who cares about legacy → the COACH wears it (the GM is spared, even
  // strengthened — the "GM power era" pattern).
  const streak = playoffStreak(team.seasonHistory) + (outcome.madePlayoffs ? 1 : 0);
  if (
    outcome.madePlayoffs &&
    outcome.championshipResult !== 'won_super_bowl' &&
    streak >= 4 &&
    owner.spectrums.legacyMotivation >= 6
  ) {
    hc += RING_FATIGUE;
  }

  // A condemned lame duck stays condemned regardless of a decent
  // season… (applied before the ring wipe so a championship — and only
  // a championship — clears the floor).
  if (fo.gmLameDuck) gm = Math.max(gm, LAME_DUCK_FLOOR);

  // …but a ring wipes the slate hard for both chairs.
  if (outcome.championshipResult === 'won_super_bowl') {
    hc = Math.min(hc, -40);
    gm = Math.min(gm, -50);
  }

  return {
    gm: Math.min(SEAT_MAX, Math.max(SEAT_MIN, gm)),
    hc: Math.min(SEAT_MAX, Math.max(SEAT_MIN, hc)),
    expectedHcWins,
    expectedGmWins,
  };
}

// ─── The firing ladder ──────────────────────────────────────────────────────

export interface FiringDecision {
  fireHc: boolean;
  fireGm: boolean;
  /** Both fired in the same cycle (clean house). */
  joint: boolean;
  /** The fired HC was the current GM's own hire. */
  hcWasOwnHire: boolean;
  /** GM survived a 2nd-own-hire firing → becomes a lame duck. */
  gmBecomesLameDuck: boolean;
}

function firingThreshold(owner: Owner, jitter: number): number {
  let t = FIRING_THRESHOLD + jitter;
  if (owner.quirks.includes('LOYALTY_BLIND')) t += 15;
  if (owner.quirks.includes('PANIC_SELLER')) t -= 12;
  t -= (owner.personality.egoLevel - 5.5) * 0.8;
  return t;
}

/**
 * Run the firing ladder for one team given updated seat pressure.
 * Order is fixed: evaluate the HC first; GM accountability follows from
 * whose hire the fired coach was (design §3.3, hardened).
 */
export function decideFiring(
  prng: Prng,
  team: TeamState,
  owner: Owner,
  seats: { gm: number; hc: number },
  outcome: SeasonOutcome,
  seasonNumber: number,
): FiringDecision {
  const fo = team.frontOffice;
  const hcSeasons = seasonNumber - fo.hcHiredSeason + 1;
  const gmSeasons = seasonNumber - fo.gmHiredSeason + 1;
  const jitter = (prng.next() * 2 - 1) * 6;
  const threshold = firingThreshold(owner, jitter);
  const gmThreshold = threshold + 8; // the GM bar is inherently higher

  let fireHc = seats.hc > threshold;
  // HC year-1 grace: near-immune unless the season cratered (≤4 wins is
  // the one-and-done escape hatch — ~0.6/yr league-wide in real life).
  if (fireHc && hcSeasons <= 1 && outcome.wins > 4) fireHc = false;

  let fireGm = false;
  let joint = false;
  let gmBecomesLameDuck = false;
  const hcWasOwnHire = fo.hcHiredByGmId === team.gmId;

  if (fireHc) {
    if (!hcWasOwnHire) {
      // Inherited coach fired — the GM is shielded (~95% survival).
      joint = seats.gm > gmThreshold * 1.2 || prng.next() < INHERITED_JOINT_P;
    } else if (fo.gmCoachFiringsSurvived === 0) {
      // The GM's FIRST own hire fired — usually survives and picks #2.
      joint = seats.gm > gmThreshold * 1.15 || prng.next() < FIRST_HIRE_JOINT_P;
    } else {
      // SECOND+ own hire fired — the GM goes. The only real-world
      // survivors had LOW accumulated pressure: early-teardown years
      // (expectations at the floor) or a heavy credit bank. In the
      // 4–7-year band neither hatch is normally open ⇒ survival ≈ 0.
      const hatchOpen = seats.gm < HATCH_PRESSURE_CEILING;
      joint = prng.next() < (hatchOpen ? SECOND_HIRE_HATCH_JOINT_P : SECOND_HIRE_JOINT_P);
      // Surviving WITHOUT a hatch is borrowed time (lame duck). Hatch
      // survivors (Caserio/Telesco pattern) genuinely keep power.
      if (!joint && !hatchOpen) gmBecomesLameDuck = true;
    }
    fireGm = joint;
  } else {
    // GM-only firing without a coach firing — the Robinson path, plus
    // the condemned-lame-duck cleanup at a reduced bar.
    const bar = fo.gmLameDuck ? LAME_DUCK_BAR : GM_ONLY_BAR;
    fireGm = seats.gm > gmThreshold * bar;
  }

  // GM years 1–2 grace ("three drafts"): broken only by panic owners.
  if (fireGm && gmSeasons <= 2 && !owner.quirks.includes('PANIC_SELLER')) {
    fireGm = false;
    if (joint) joint = false;
  }

  return { fireHc, fireGm, joint: fireHc && fireGm, hcWasOwnHire, gmBecomesLameDuck };
}

// ─── Career-stint bookkeeping ───────────────────────────────────────────────

function isOpenStintFor(stint: CareerStint, teamId: TeamId, role: CareerStint['role']): boolean {
  return stint.toSeason === null && stint.teamId === teamId && stint.role === role;
}

/**
 * Fold this season's result onto the person's open stint for this team,
 * creating the stint lazily (self-heals migrated saves where stints
 * start empty).
 */
function accumulateStint(
  stints: readonly CareerStint[],
  teamId: TeamId,
  role: CareerStint['role'],
  hiredSeason: number,
  outcome: SeasonOutcome,
): readonly CareerStint[] {
  const idx = stints.findIndex((s) => isOpenStintFor(s, teamId, role));
  const base: CareerStint =
    idx >= 0
      ? stints[idx]!
      : {
          teamId,
          role,
          fromSeason: hiredSeason,
          toSeason: null,
          wins: 0,
          losses: 0,
          ties: 0,
          playoffAppearances: 0,
          championships: 0,
          end: null,
        };
  const updated: CareerStint = {
    ...base,
    wins: base.wins + outcome.wins,
    losses: base.losses + outcome.losses,
    ties: base.ties + outcome.ties,
    playoffAppearances: base.playoffAppearances + (outcome.madePlayoffs ? 1 : 0),
    championships:
      base.championships + (outcome.championshipResult === 'won_super_bowl' ? 1 : 0),
  };
  if (idx >= 0) return stints.map((s, i) => (i === idx ? updated : s));
  return [...stints, updated];
}

function closeStint(
  stints: readonly CareerStint[],
  teamId: TeamId,
  role: CareerStint['role'],
  seasonNumber: number,
  end: StintEnd,
): readonly CareerStint[] {
  return stints.map((s) =>
    isOpenStintFor(s, teamId, role) ? { ...s, toSeason: seasonNumber, end } : s,
  );
}

function openStintFor(stints: readonly CareerStint[], teamId: TeamId, role: CareerStint['role']): CareerStint | undefined {
  return stints.find((s) => isOpenStintFor(s, teamId, role));
}

// ─── Evaluation pass (shared by both lifecycle hooks) ───────────────────────

function evaluateTeams(
  league: LeagueState,
  prng: Prng,
  teamIds: readonly TeamId[],
  outcomes: ReadonlyMap<TeamId, SeasonOutcome>,
): LeagueState {
  const seasonNumber = league.seasonNumber;
  const teams: Record<string, TeamState> = { ...league.teams };
  const gms: Record<string, Gm> = { ...league.gms };
  const coaches: Record<string, HeadCoach> = { ...league.coaches };
  const log: Transaction[] = [];

  for (const teamId of teamIds) {
    const team = teams[teamId]!;
    const owner = league.owners[team.ownerId]!;
    const gm = gms[team.gmId]!;
    const hc = coaches[team.headCoachId]!;
    const outcome = outcomes.get(teamId)!;
    const fo = team.frontOffice;
    const teamPrng = prng.fork(`eval:${teamId}`);

    // 1. Stints accumulate this season for the sitting GM + HC.
    let nextGm: Gm = {
      ...gm,
      careerStints: accumulateStint(gm.careerStints, teamId, 'GM', fo.gmHiredSeason, outcome),
    };
    let nextHc: HeadCoach = {
      ...hc,
      careerStints: accumulateStint(hc.careerStints, teamId, 'HC', fo.hcHiredSeason, outcome),
    };

    // 2. Seat pressure update.
    const seats = computeSeatUpdate(team, owner, outcome, seasonNumber);

    // 3. The ladder.
    const decision = decideFiring(teamPrng, team, owner, seats, outcome, seasonNumber);

    let nextFo: FrontOfficeState = {
      ...fo,
      seatPressure: { gm: seats.gm, hc: seats.hc },
      gmLameDuck: fo.gmLameDuck || decision.gmBecomesLameDuck,
    };

    if (decision.fireHc) {
      nextHc = {
        ...nextHc,
        status: 'UNEMPLOYED',
        careerStints: closeStint(
          nextHc.careerStints,
          teamId,
          'HC',
          seasonNumber,
          decision.joint ? 'JOINT_FIRED' : 'FIRED',
        ),
      };
      const stint = nextHc.careerStints.find(
        (s) => s.teamId === teamId && s.role === 'HC' && s.toSeason === seasonNumber,
      );
      log.push({
        kind: 'hc-fired',
        tick: league.tick,
        seasonNumber,
        teamId,
        coachId: team.headCoachId,
        jointWithGm: decision.joint,
        inSeason: false,
        seasonsServed: seasonNumber - fo.hcHiredSeason + 1,
        wins: stint?.wins ?? 0,
        losses: stint?.losses ?? 0,
        ties: stint?.ties ?? 0,
        seatPressure: seats.hc,
        ownHireIndex: decision.hcWasOwnHire ? fo.gmCoachFiringsSurvived + 1 : 0,
        gmTenureSeasons: seasonNumber - fo.gmHiredSeason + 1,
      });
      nextFo = {
        ...nextFo,
        hcVacant: true,
        gmCoachFiringsSurvived:
          decision.hcWasOwnHire && !decision.fireGm
            ? fo.gmCoachFiringsSurvived + 1
            : fo.gmCoachFiringsSurvived,
      };
    }

    if (decision.fireGm) {
      nextGm = {
        ...nextGm,
        status: 'UNEMPLOYED',
        careerStints: closeStint(
          nextGm.careerStints,
          teamId,
          'GM',
          seasonNumber,
          decision.joint ? 'JOINT_FIRED' : 'FIRED',
        ),
      };
      const stint = nextGm.careerStints.find(
        (s) => s.teamId === teamId && s.role === 'GM' && s.toSeason === seasonNumber,
      );
      log.push({
        kind: 'gm-fired',
        tick: league.tick,
        seasonNumber,
        teamId,
        gmId: team.gmId,
        jointWithHc: decision.joint,
        inSeason: false,
        seasonsServed: seasonNumber - fo.gmHiredSeason + 1,
        wins: stint?.wins ?? 0,
        losses: stint?.losses ?? 0,
        ties: stint?.ties ?? 0,
        seatPressure: seats.gm,
      });
      nextFo = { ...nextFo, gmVacant: true };
    }

    gms[team.gmId] = nextGm;
    coaches[team.headCoachId] = nextHc;
    teams[teamId] = { ...team, frontOffice: nextFo };
  }

  return {
    ...league,
    teams: teams as LeagueState['teams'],
    gms: gms as LeagueState['gms'],
    coaches: coaches as LeagueState['coaches'],
    transactionLog: [...league.transactionLog, ...log],
  };
}

// ─── Lifecycle entry points ─────────────────────────────────────────────────

/**
 * BLACK_MONDAY: evaluate the non-playoff teams (the real-world day-after-
 * week-18 purge). Playoff teams are deferred to POST_SEASON_FINALIZE so
 * their evaluation sees the playoff run.
 */
export function runBlackMondayFirings(league: LeagueState, prng: Prng): LeagueState {
  const records = computeRecords(league);
  const seeds = playoffSeeds(league, records);
  const playoffTeamIds = new Set<TeamId>(
    [...seeds.AFC, ...seeds.NFC].map((r) => r.teamId),
  );

  const outcomes = new Map<TeamId, SeasonOutcome>();
  const teamIds: TeamId[] = [];
  for (const team of Object.values(league.teams)) {
    const id = team.identity.id;
    if (playoffTeamIds.has(id)) continue;
    const r = records.get(id)!;
    teamIds.push(id);
    outcomes.set(id, { wins: r.wins, losses: r.losses, ties: r.ties, madePlayoffs: false });
  }

  return evaluateTeams(league, prng, teamIds, outcomes);
}

/**
 * POST_SEASON_FINALIZE (top): evaluate playoff teams with full playoff
 * results, then run the league-wide hiring window. Returns the league
 * with every seat filled — the rest of finalize (awards, development,
 * retirement) runs on the post-carousel league.
 */
export function runPostSeasonFrontOffice(league: LeagueState, prng: Prng): LeagueState {
  const records = computeRecords(league);
  const seeds = playoffSeeds(league, records);
  const playoffTeamIds = [...seeds.AFC, ...seeds.NFC].map((r) => r.teamId);

  const outcomes = new Map<TeamId, SeasonOutcome>();
  for (const id of playoffTeamIds) {
    const r = records.get(id)!;
    const playoff = playoffOutcomeForTeam(league, id);
    outcomes.set(id, {
      wins: r.wins,
      losses: r.losses,
      ties: r.ties,
      madePlayoffs: playoff.madePlayoffs,
      ...(playoff.championshipResult
        ? { championshipResult: playoff.championshipResult }
        : {}),
    });
  }

  const afterEvals = evaluateTeams(league, prng.fork('playoff-evals'), playoffTeamIds, outcomes);
  return runHiringWindow(afterEvals, prng.fork('hiring'));
}

// ─── The hiring window ──────────────────────────────────────────────────────

interface RetreadCandidate<T> {
  person: T;
  weight: number;
}

function retreadPool<T extends Gm | HeadCoach>(
  people: Readonly<Record<string, T>>,
  role: CareerStint['role'],
  currentSeason: number,
): RetreadCandidate<T>[] {
  const out: RetreadCandidate<T>[] = [];
  for (const person of Object.values(people)) {
    if (person.status !== 'UNEMPLOYED') continue;
    const lastStint = [...person.careerStints]
      .filter((s) => s.role === role && s.toSeason !== null)
      .sort((a, b) => (b.toSeason ?? 0) - (a.toSeason ?? 0))[0];
    if (!lastStint) continue;
    if (currentSeason - (lastStint.toSeason ?? 0) > RETREAD_RECENCY) continue;
    const games = person.careerStints.reduce((n, s) => n + s.wins + s.losses + s.ties, 0);
    const wins = person.careerStints.reduce((n, s) => n + s.wins, 0);
    const champs = person.careerStints.reduce((n, s) => n + s.championships, 0);
    const winPct = games > 0 ? wins / games : 0.4;
    out.push({ person, weight: Math.max(0.1, winPct + 0.5 * champs) });
  }
  return out;
}

/**
 * Fill every vacant seat league-wide: GM first (so the incoming GM
 * shapes the coach archetype), then HC. New GMs arrive with FRESH
 * miscalibrated outlet-trust priors — the media-trust ecology churn
 * this module exists to unblock. Retreads keep their learned beliefs.
 */
export function runHiringWindow(league: LeagueState, prng: Prng): LeagueState {
  const hiredSeason = league.seasonNumber + 1; // first season they work
  const teams: Record<string, TeamState> = { ...league.teams };
  const gms: Record<string, Gm> = { ...league.gms };
  const coaches: Record<string, HeadCoach> = { ...league.coaches };
  const personalities = { ...league.teamPersonalities };
  const log: Transaction[] = [];

  for (const team of Object.values(league.teams)) {
    const teamId = team.identity.id;
    const fo = teams[teamId]!.frontOffice;
    if (!fo.gmVacant && !fo.hcVacant) continue;

    const owner = league.owners[team.ownerId]!;
    const hirePrng = prng.fork(`hire:${teamId}`);
    let nextTeam = teams[teamId]!;
    let nextFo = fo;

    if (fo.gmVacant) {
      const pool = retreadPool(gms, 'GM', league.seasonNumber);
      const useRetread = pool.length > 0 && hirePrng.next() < GM_RETREAD_P;
      let hired: Gm;
      if (useRetread) {
        const pick = hirePrng.weighted(pool.map((c) => ({ value: c.person, weight: c.weight })));
        hired = { ...pick, status: 'EMPLOYED' };
      } else {
        const fresh = generateGm(
          hirePrng.fork('gen'),
          `${team.identity.abbreviation}_S${hiredSeason}`,
          owner,
        );
        hired = {
          ...fresh,
          perceivedOutletReliability: seedPerceivedOutletReliability(
            hirePrng.fork('outlet-trust'),
            fresh,
            league.mediaOutlets,
          ),
        };
      }
      gms[hired.id] = hired;
      nextTeam = { ...nextTeam, gmId: hired.id };
      nextFo = {
        ...nextFo,
        gmVacant: false,
        gmHiredSeason: hiredSeason,
        gmCoachFiringsSurvived: 0,
        gmLameDuck: false,
        seatPressure: { ...nextFo.seatPressure, gm: 0 },
      };
      log.push({
        kind: 'gm-hired',
        tick: league.tick,
        seasonNumber: league.seasonNumber,
        teamId,
        gmId: hired.id,
        retread: useRetread,
      });
    }

    if (fo.hcVacant) {
      const gm = gms[nextTeam.gmId]!;
      const pool = retreadPool(coaches, 'HC', league.seasonNumber);
      const useRetread = pool.length > 0 && hirePrng.next() < HC_RETREAD_P;
      let hired: HeadCoach;
      if (useRetread) {
        const pick = hirePrng.weighted(pool.map((c) => ({ value: c.person, weight: c.weight })));
        hired = { ...pick, status: 'EMPLOYED' };
      } else {
        hired = generateHeadCoach(
          hirePrng.fork('gen-hc'),
          `${team.identity.abbreviation}_S${hiredSeason}`,
          owner,
          gm,
        );
      }
      coaches[hired.id] = hired;
      nextTeam = { ...nextTeam, headCoachId: hired.id };
      nextFo = {
        ...nextFo,
        hcVacant: false,
        hcHiredSeason: hiredSeason,
        hcHiredByGmId: nextTeam.gmId,
        seatPressure: { ...nextFo.seatPressure, hc: 0 },
      };
      log.push({
        kind: 'hc-hired',
        tick: league.tick,
        seasonNumber: league.seasonNumber,
        teamId,
        coachId: hired.id,
        retread: useRetread,
        hiredByGmId: nextTeam.gmId,
      });
    }

    nextTeam = { ...nextTeam, frontOffice: nextFo };
    teams[teamId] = nextTeam;
    personalities[teamId] = computeTeamPersonality(
      owner,
      gms[nextTeam.gmId]!,
      coaches[nextTeam.headCoachId]!,
      nextTeam.fanBase,
    );
  }

  return {
    ...league,
    teams: teams as LeagueState['teams'],
    gms: gms as LeagueState['gms'],
    coaches: coaches as LeagueState['coaches'],
    teamPersonalities: personalities,
    transactionLog: [...league.transactionLog, ...log],
  };
}

/** Convenience for inspector/tests: the open stint of a sitting GM/HC. */
export { openStintFor as openCareerStint };
