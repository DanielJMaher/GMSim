import type { TeamId, PlayerId, GmId } from '../types/ids.js';
import type { PositionGroup, Position } from '../types/enums.js';
import type {
  CollegePlayer,
  CollegePlayerObservation,
  CollegeScout,
  CombineMeasurables,
  DraftBoardEntry,
  DraftBoardReason,
} from '../types/college.js';
import type { TeamState } from '../types/team.js';
import type { Player, PlayerSkills, ArchetypeId } from '../types/player.js';
import type { HeadCoach, Gm, PerceivedOutletReliability } from '../types/personnel.js';
import type { MediaOutlet } from '../types/media.js';
import type { MediaOutletId } from '../types/ids.js';
import { getArchetypeById } from '../archetypes/index.js';
import { schemeFitForPlayer } from '../scheme/index.js';
import { positionGroupFor } from '../players/position-group.js';
import { athleticBaseline, POSITION_BASELINED_SKILLS, type AthleticBaseline } from '../players/athletic-baselines.js';
import { softCap } from '../players/skills.js';
import { boardPositionalFactor } from './position-value.js';
import { positionNeedPressure } from './team-needs.js';
import { convertiblePositions } from '../players/position-conversion.js';
import { perceiveProjection, teamScoutSkill } from './perceived-position.js';
import { voicePrng } from '../media/voice.js';
import { recencyWeight } from '../scouting/recency.js';
import { combineAthleticSkills } from './measurables.js';
import { ScoutId } from '../types/ids.js';

/**
 * Maximum board depth. v0.52 raises from 50 → 500 to rank every
 * draft-eligible prospect a team has visibility into (own scouts or
 * league-aggregate via the v0.51 media-board proxy). With the
 * eligible cohort ≈ 500 prospects across JR/SR/RS_SR after class-
 * size bumps in v0.52, 500 covers the full pool with headroom.
 * Daniel: "big boards should rank every available draft-eligible
 * player."
 */
const DRAFT_BOARD_SIZE = 500;

/**
 * Priority formula calibration (v0.51).
 *
 * v0.46–v0.50 used a raw multiplicative formula:
 *
 *   priority = observedSkillScore × schemeFit × meanConfidence × need
 *
 * The inspector's draft-replay reach histogram (v0.50) revealed
 * pathological reach: 129/214 picks landed ≥+30 ahead of consensus
 * AND 42/214 landed ≤−30 (steals at the late picks). Bimodal — no
 * picks on consensus. Diagnosis: multiplicative compounding of
 * schemeFit/confidence/need produced per-team priority swings of
 * 4×+ for the same observedSkillScore, so each team's #1 became a
 * "niche darling" rather than a consensus top prospect. Late-round
 * picks then scooped the true blue-chips that no team had at #1.
 *
 * v0.51 makes observedSkillScore the dominant signal and uses
 * per-team factors as small ADDITIVE adjustments (Doc 3's "variance
 * IS the system" still holds — boards diverge on second and third
 * priorities — but the top of each team's board now centers on the
 * prospects everyone evaluates highly):
 *
 *   priority = (observedSkillScore + schemeBonus + needBonus)
 *              × confidenceFactor
 *
 *   schemeBonus      = (schemeFit - 1) × SCHEME_BONUS_SCALE
 *                      → clamped to ±SCHEME_BONUS_CAP
 *   needBonus        = (need - 1) × NEED_BONUS_SCALE
 *                      → clamped to ±NEED_BONUS_CAP
 *   confidenceFactor = CONFIDENCE_FLOOR
 *                      + (1 - CONFIDENCE_FLOOR) × meanConfidence
 *
 * Real NFL: a true blue-chip QB tops every team's board regardless
 * of scheme. Scheme fit and need shift mid-board rankings but rarely
 * unseat the consensus top-of-class. Our v0.51 formula targets that
 * behavior.
 */
const SCHEME_BONUS_SCALE = 8;
const SCHEME_BONUS_CAP = 6;
const NEED_BONUS_SCALE = 12;
const NEED_BONUS_CAP = 4;
const CONFIDENCE_FLOOR = 0.8;
/** Cap on how far the media consensus can pull a single board's talent read
 * (#5). Even a max-trust GM with high-confidence media on an unscouted
 * prospect blends media at most this fraction — firsthand scouting still
 * anchors the board. */
const MEDIA_BLEND_MAX = 0.5;

/**
 * Combine read (v0.78). The combine is a public event — every team gets
 * the same precisely-measured athletic numbers — so it's injected into
 * board regeneration as a league-wide synthetic observation per attendee
 * (not stored in the per-team scout stream). `combineAthleticSkills`
 * turns the measurables into a position-relative read of the four
 * athletic skills; this confidence governs how hard that read pulls the
 * board's confidence-weighted skill aggregate. High + freshly-dated, so a
 * workout warrior visibly climbs and a poor tester slides. Tuning knob.
 */
const COMBINE_OBS_CONFIDENCE = 0.7;
const COMBINE_SCOUT_ID = ScoutId('COMBINE');

/**
 * How much a prospect's athletic DEVIATION from his position baseline shades his
 * observed grade. Post-Slice-3, physical skills are position-baselined, so their
 * ABSOLUTE value is ~constant within a position (every edge tests ~the same) and
 * adds no talent signal — including it just inflated every athletic-position
 * grade uniformly and flooded the board with EDGE/OLB/DT. Instead the grade is
 * built from football skills, plus a bonus for testing ABOVE position average
 * (a freak) and a penalty for below (a stiff). 0 = athleticism ignored in the
 * grade; 1 = a +10 athletic outlier adds +10. Tuning knob.
 */
export const PHYS_DEV_WEIGHT = 0.5;

/**
 * Position conversion for need (2026-06-03, Daniel-directed). A team values a
 * prospect at the spot it would actually PLAY him: usually his natural
 * projected position, but a team with a real hole at a convertible position
 * (see `convertiblePositions`) plays him THERE — a team needing a left tackle
 * drafts a projected RIGHT tackle and kicks him to LT. The prospect is then
 * valued at the assigned position's draft premium (`boardPositionalFactor`), so
 * a high-graded RT rises on the board of a team that needs an LT.
 *
 * Conversion is NEED-driven, NOT value-driven. A prospect doesn't "become" a
 * left tackle just because LT is worth more — WHERE a team plays a versatile
 * prospect is decided by where its hole is (need pressure), not by the position
 * premium (otherwise every team would convert its cheaper prospects up to the
 * premium spots). The premium only enters the VALUE he provides once assigned
 * (the `boardPositionalFactor` on his priority). A team converts only when a
 * convertible spot's hole is real (`MIN_CONVERSION_PRESSURE`) and CLEARLY
 * bigger than the need at his natural spot (`CONVERSION_RETENTION` keeps him
 * home on a tie).
 */
const MIN_CONVERSION_PRESSURE = 0.6;
const CONVERSION_RETENTION = 0.85;

/**
 * The position this team would draft + play `natural` at, given its per-position
 * `needPressure`. Picks the convertible spot with the biggest HOLE (need
 * pressure) — off-natural spots taxed by CONVERSION_RETENTION and gated at
 * MIN_CONVERSION_PRESSURE — so a team plays him where it actually needs a body,
 * not at whichever convertible spot is most valuable. Returns `natural` when no
 * pressure map is supplied (legacy callers) or no conversion clears the bar.
 */
function assignedPositionFor(
  natural: Position,
  needPressure: Readonly<Record<Position, number>> | undefined,
): Position {
  if (!needPressure) return natural;
  let best = natural;
  let bestPressure = needPressure[natural] ?? 0;
  for (const c of convertiblePositions(natural)) {
    if (c === natural) continue;
    const pc = needPressure[c] ?? 0;
    if (pc < MIN_CONVERSION_PRESSURE) continue;
    const taxed = pc * CONVERSION_RETENTION;
    if (taxed > bestPressure) {
      bestPressure = taxed;
      best = c;
    }
  }
  return best;
}

/**
 * Build one synthetic, league-wide combine observation per attending
 * prospect from the class's combine results. Athletic skills only; the
 * combine says nothing about football skill. Returns an empty map when no
 * combine results are supplied (pre-combine regenerations are unchanged).
 */
function buildCombineObsByProspect(
  collegePool: readonly CollegePlayer[],
  combineResults: Readonly<Record<string, CombineMeasurables>> | undefined,
  addedOnTick: number,
): Map<PlayerId, CollegePlayerObservation> {
  const out = new Map<PlayerId, CollegePlayerObservation>();
  if (!combineResults) return out;
  for (const cp of collegePool) {
    const m = combineResults[cp.id];
    if (!m || !m.attended) continue;
    const implied = combineAthleticSkills(cp.nflProjectedPosition, m);
    const skills: Partial<Record<keyof PlayerSkills, number>> = {};
    const confidence: Partial<Record<keyof PlayerSkills, number>> = {};
    let any = false;
    for (const [k, v] of Object.entries(implied)) {
      if (typeof v === 'number') {
        skills[k as keyof PlayerSkills] = v;
        confidence[k as keyof PlayerSkills] = COMBINE_OBS_CONFIDENCE;
        any = true;
      }
    }
    if (!any) continue;
    out.set(cp.id, {
      scoutId: COMBINE_SCOUT_ID,
      collegePlayerId: cp.id,
      observedOnTick: addedOnTick,
      skills,
      confidence,
    });
  }
  return out;
}

/**
 * Position-group depth targets used by the draft-board need score.
 * A team well below target at a position group elevates prospects
 * who project there. Slightly thinner than the FA watch-list
 * targets because draft-board need is a long-term planning lens
 * (1-3 year payoff), not an immediate-roster-shortfall one.
 */
const POSITION_GROUP_TARGETS: Record<PositionGroup, number> = {
  QB: 3,
  SKILL: 12,
  OL: 9,
  DL: 8,
  LB: 7,
  DB: 10,
  ST: 3,
};

/**
 * Build all 32 teams' internal draft boards from the league's
 * college observations. Pure function — no PRNG. Mirrors the
 * NFL `regenerateWatchLists` approach so the same confidence-
 * weighted aggregation pattern carries over.
 *
 *   1. Index observations by the team-of-scout that filed them.
 *   2. For each team:
 *        a. Group its observations by collegePlayerId.
 *        b. Confidence-weight observed key skills into one aggregate.
 *        c. priority = observedSkillScore × schemeFit × meanConfidence × need
 *        d. Sort desc, take top N.
 *        e. Derive a `DraftBoardReason` from which component drove it.
 */
export function regenerateDraftBoards(
  teams: Readonly<Record<TeamId, TeamState>>,
  _collegeScouts: Readonly<Record<ScoutId, CollegeScout>>,
  coaches: Readonly<Record<string, HeadCoach>>,
  collegePool: readonly CollegePlayer[],
  observations: readonly CollegePlayerObservation[],
  addedOnTick: number,
): Record<TeamId, DraftBoardEntry[]> {
  // Index prospects by id for O(1) lookup.
  const prospectById = new Map<PlayerId, CollegePlayer>();
  for (const cp of collegePool) prospectById.set(cp.id, cp);

  // Map collegeScoutId -> teamId for observation routing.
  const scoutToTeam = new Map<ScoutId, TeamId>();
  for (const team of Object.values(teams)) {
    for (const sid of team.collegeScoutIds) scoutToTeam.set(sid, team.identity.id);
  }

  // Bucket observations by owning team.
  const obsByTeam = new Map<TeamId, CollegePlayerObservation[]>();
  for (const obs of observations) {
    const teamId = scoutToTeam.get(obs.scoutId);
    if (!teamId) continue;
    let bucket = obsByTeam.get(teamId);
    if (!bucket) {
      bucket = [];
      obsByTeam.set(teamId, bucket);
    }
    bucket.push(obs);
  }

  // Compute each team's NFL position-group depth (drives the need
  // score). Counted off `team.rosterIds` against `league.players` —
  // but we don't have that map in this signature. Pass it in via
  // the team-shaped need below; for the slice-3 caller we accept
  // a `players` map argument so the count is exact.
  const out: Record<TeamId, DraftBoardEntry[]> = {} as Record<TeamId, DraftBoardEntry[]>;

  for (const teamId of Object.keys(teams) as TeamId[]) {
    const team = teams[teamId]!;
    const hc = coaches[team.headCoachId];
    if (!hc) {
      out[teamId] = [];
      continue;
    }
    const teamObs = obsByTeam.get(teamId) ?? [];
    out[teamId] = buildBoardForTeam(
      teamObs,
      prospectById,
      hc,
      team,
      addedOnTick,
    );
  }
  return out;
}

/**
 * Higher-level entry point that takes the full league and computes
 * each team's positional-need scores from their current NFL roster.
 * `regenerateDraftBoards` could compute these internally too, but
 * keeping the per-roster scan separate keeps the signature small.
 */
export function regenerateDraftBoardsForLeague(args: {
  teams: Readonly<Record<TeamId, TeamState>>;
  collegeScouts: Readonly<Record<ScoutId, CollegeScout>>;
  coaches: Readonly<Record<string, HeadCoach>>;
  players: Readonly<Record<string, Player>>;
  collegePool: readonly CollegePlayer[];
  observations: readonly CollegePlayerObservation[];
  addedOnTick: number;
  /** Class combine results — when supplied, the (public) combine is
   * blended into every board's athletic read. Omit pre-combine. */
  combineResults?: Readonly<Record<string, CombineMeasurables>>;
  /** Media outlets' prospect reads (#5). When supplied with `gms`, each
   * team blends the media consensus into its board, weighted by its GM's
   * `mediaTrust`. Omit to disable media consumption (legacy behavior). */
  mediaObservations?: readonly CollegePlayerObservation[];
  gms?: Readonly<Record<GmId, Gm>>;
  /** Media outlets (#5 slice 2a). When supplied, each media read is weighted
   * by its outlet's per-position-group accuracy, so a sharp outlet's read
   * moves boards and a junk outlet's barely registers. */
  mediaOutlets?: Readonly<Record<MediaOutletId, MediaOutlet>>;
  /** Living Voice seed (v0.127). When supplied, each team forms a fallible
   * PERCEIVED position read per prospect (identify / miss / invent a
   * conversion), seeded off it. Omit → omniscient (legacy) projection. */
  voiceSeed?: string;
}): Record<TeamId, DraftBoardEntry[]> {
  const needScoresByTeam = new Map<TeamId, Record<PositionGroup, number>>();
  const pressureByTeam = new Map<TeamId, Record<Position, number>>();
  for (const team of Object.values(args.teams)) {
    needScoresByTeam.set(team.identity.id, computeDraftNeedScores(team, args.players));
    pressureByTeam.set(team.identity.id, positionNeedPressure(team, args.players));
  }
  return regenerateDraftBoardsInternal({ ...args, needScoresByTeam, pressureByTeam });
}

function regenerateDraftBoardsInternal(args: {
  teams: Readonly<Record<TeamId, TeamState>>;
  collegeScouts: Readonly<Record<ScoutId, CollegeScout>>;
  coaches: Readonly<Record<string, HeadCoach>>;
  collegePool: readonly CollegePlayer[];
  observations: readonly CollegePlayerObservation[];
  needScoresByTeam: Map<TeamId, Record<PositionGroup, number>>;
  /** Per-team, per-position need pressure (for convert-to-need; optional —
   *  legacy/test callers without rosters skip conversion). */
  pressureByTeam?: Map<TeamId, Record<Position, number>>;
  addedOnTick: number;
  combineResults?: Readonly<Record<string, CombineMeasurables>>;
  mediaObservations?: readonly CollegePlayerObservation[];
  gms?: Readonly<Record<GmId, Gm>>;
  mediaOutlets?: Readonly<Record<MediaOutletId, MediaOutlet>>;
  voiceSeed?: string;
}): Record<TeamId, DraftBoardEntry[]> {
  const prospectById = new Map<PlayerId, CollegePlayer>();
  for (const cp of args.collegePool) prospectById.set(cp.id, cp);

  const scoutToTeam = new Map<ScoutId, TeamId>();
  for (const team of Object.values(args.teams)) {
    for (const sid of team.collegeScoutIds) scoutToTeam.set(sid, team.identity.id);
  }

  const obsByTeam = new Map<TeamId, CollegePlayerObservation[]>();
  const obsByProspect = new Map<PlayerId, CollegePlayerObservation[]>();
  for (const obs of args.observations) {
    const teamId = scoutToTeam.get(obs.scoutId);
    if (!teamId) continue;
    let bucket = obsByTeam.get(teamId);
    if (!bucket) {
      bucket = [];
      obsByTeam.set(teamId, bucket);
    }
    bucket.push(obs);
    let pBucket = obsByProspect.get(obs.collegePlayerId);
    if (!pBucket) {
      pBucket = [];
      obsByProspect.set(obs.collegePlayerId, pBucket);
    }
    pBucket.push(obs);
  }

  // v0.51: league-wide aggregate per prospect — derived from ALL
  // teams' scout observations pooled together. This is the
  // "media big board" proxy Doc 3 calls out as the third intel
  // stream (alongside team scouts + team coaches) until the full
  // media-outlets module lands. Boards that haven't been scouted
  // by a particular team's staff still surface the consensus
  // prospects through this aggregate, with reduced confidence to
  // reflect "we know about this guy from the wider league signal,
  // not firsthand."
  // Public combine read (v0.78), one synthetic observation per attendee,
  // blended into every team's board below + the league aggregate here.
  const combineObsByProspect = buildCombineObsByProspect(
    args.collegePool,
    args.combineResults,
    args.addedOnTick,
  );

  // Athletic-deviation reference (league observed mean per position) so the
  // board grades athleticism relative to position norm, not absolute — see
  // aggregateCollegeObservations / PHYS_DEV_WEIGHT.
  const athleticRef = computeAthleticRefByPosition(args.observations, prospectById);

  const leagueAggregateByProspect = new Map<
    PlayerId,
    { observedSkillScore: number; meanConfidence: number }
  >();
  const aggregateIds = new Set<PlayerId>(obsByProspect.keys());
  for (const pid of combineObsByProspect.keys()) aggregateIds.add(pid);
  for (const pid of aggregateIds) {
    const prospect = prospectById.get(pid);
    if (!prospect) continue;
    const obsList = obsByProspect.get(pid) ?? [];
    const combineObs = combineObsByProspect.get(pid);
    const merged = combineObs ? [...obsList, combineObs] : obsList;
    leagueAggregateByProspect.set(
      pid,
      aggregateCollegeObservations(merged, prospect, args.addedOnTick, athleticRef),
    );
  }

  // Media reads grouped by prospect (#5 — GMs consume the media), kept
  // UNWEIGHTED here. Slice 2: each team weights these by its own GM's
  // *perceived* outlet reliability below, so two GMs can read the same
  // outlet very differently — a sharp GM discounts the junk voice a
  // buzz-chaser chases. (Pre-Slice-2 this was a single league-wide
  // aggregate weighted by the outlets' TRUE accuracy — omniscient.)
  const mediaByProspect = new Map<PlayerId, CollegePlayerObservation[]>();
  if (args.mediaObservations) {
    for (const obs of args.mediaObservations) {
      const b = mediaByProspect.get(obs.collegePlayerId);
      if (b) b.push(obs);
      else mediaByProspect.set(obs.collegePlayerId, [obs]);
    }
  }

  const out: Record<TeamId, DraftBoardEntry[]> = {} as Record<TeamId, DraftBoardEntry[]>;
  for (const teamId of Object.keys(args.teams) as TeamId[]) {
    const team = args.teams[teamId]!;
    const hc = args.coaches[team.headCoachId];
    // GM's trust in the media (0..1); drives how hard media pulls the board.
    const gm = args.gms?.[team.gmId];
    const mediaTrust01 = gm ? (gm.spectrums.mediaTrust - 1) / 9 : 0;
    const need = args.needScoresByTeam.get(teamId);
    if (!hc || !need) {
      out[teamId] = [];
      continue;
    }
    // Build THIS GM's media consensus, weighting each outlet by the GM's
    // perceived reliability (falls back to the outlet's true accuracy for
    // legacy GMs without a seeded belief). Skipped for media-skeptics
    // (mediaTrust01 === 0), who ignore it downstream anyway.
    const mediaAggregateByProspect =
      mediaByProspect.size > 0 && mediaTrust01 > 0
        ? buildMediaAggregateForGm(
            mediaByProspect,
            prospectById,
            args.addedOnTick,
            gm?.perceivedOutletReliability,
            args.mediaOutlets,
            athleticRef,
          )
        : undefined;
    const teamObs = obsByTeam.get(teamId) ?? [];
    // Perceived-conversion context (v0.127): supplied only when a voiceSeed is
    // threaded (live boards), so legacy/test callers keep the omniscient read.
    const conversionCtx = args.voiceSeed
      ? {
          voiceSeed: args.voiceSeed,
          teamId,
          scoutSkill: teamScoutSkill(
            team.collegeScoutIds
              .map((sid) => args.collegeScouts[sid])
              .filter((s): s is CollegeScout => !!s),
          ),
        }
      : undefined;
    out[teamId] = buildBoardForTeamWithNeed(
      teamObs,
      prospectById,
      hc,
      need,
      args.addedOnTick,
      leagueAggregateByProspect,
      combineObsByProspect,
      mediaAggregateByProspect,
      mediaTrust01,
      athleticRef,
      args.pressureByTeam?.get(teamId),
      conversionCtx,
    );
  }
  return out;
}

function buildBoardForTeam(
  teamObservations: readonly CollegePlayerObservation[],
  prospectById: Map<PlayerId, CollegePlayer>,
  hc: HeadCoach,
  _team: TeamState,
  addedOnTick: number,
): DraftBoardEntry[] {
  // Without a roster-need map we use neutral need 1.0 across the board.
  // The richer caller (regenerateDraftBoardsForLeague) supplies real need.
  const need: Record<PositionGroup, number> = {
    QB: 1, SKILL: 1, OL: 1, DL: 1, LB: 1, DB: 1, ST: 1,
  };
  return buildBoardForTeamWithNeed(teamObservations, prospectById, hc, need, addedOnTick);
}

/**
 * Confidence discount applied to the league-aggregate fallback when
 * a team has no firsthand observations of a prospect. Doc 3: media
 * coverage is real but doesn't carry the same conviction as your
 * own scouts. 0.4 lets consensus blue chips still surface on every
 * board but keeps niche-fit prospects (where the picking team
 * actually scouted them) at higher priority for that team.
 */
const LEAGUE_FALLBACK_CONFIDENCE_DISCOUNT = 0.7;

function buildBoardForTeamWithNeed(
  teamObservations: readonly CollegePlayerObservation[],
  prospectById: Map<PlayerId, CollegePlayer>,
  hc: HeadCoach,
  needScores: Readonly<Record<PositionGroup, number>>,
  addedOnTick: number,
  leagueAggregateByProspect?: ReadonlyMap<
    PlayerId,
    { observedSkillScore: number; meanConfidence: number }
  >,
  combineObsByProspect?: ReadonlyMap<PlayerId, CollegePlayerObservation>,
  mediaAggregateByProspect?: ReadonlyMap<
    PlayerId,
    { observedSkillScore: number; meanConfidence: number }
  >,
  mediaTrust01 = 0,
  athleticRefByPos?: ReadonlyMap<string, ReadonlyMap<string, number>>,
  needPressure?: Readonly<Record<Position, number>>,
  // Perceived-conversion inputs (v0.127). When `voiceSeed` is supplied the team
  // forms a fallible position read per prospect (identify / miss / invent a
  // conversion), seeded off voiceSeed + team + prospect. Omit → omniscient.
  conversionCtx?: { voiceSeed: string; teamId: TeamId; scoutSkill: number },
): DraftBoardEntry[] {
  const byProspect = new Map<PlayerId, CollegePlayerObservation[]>();
  for (const obs of teamObservations) {
    let bucket = byProspect.get(obs.collegePlayerId);
    if (!bucket) {
      bucket = [];
      byProspect.set(obs.collegePlayerId, bucket);
    }
    bucket.push(obs);
  }

  // The combine is public — fold its athletic read into the prospects
  // this team has *already scouted*, sharpening their own grade (v0.78).
  // Prospects the team hasn't scouted still get the combine, but through
  // the shared league aggregate below — so a public event moves every
  // board the same way instead of scattering athletic-only reads (which
  // would manufacture divergence the draft reads as reaches).
  if (combineObsByProspect) {
    for (const [pid, cObs] of combineObsByProspect) {
      const bucket = byProspect.get(pid);
      if (bucket) bucket.push(cObs);
    }
  }

  // Candidate set = (team's own observations) ∪ (every prospect any
  // team in the league has observations on). Without the union we
  // skip true blue-chips that other teams' scouts cover well but
  // ours didn't — exactly the v0.50 reach-bias root cause.
  const candidateIds = new Set<PlayerId>(byProspect.keys());
  if (leagueAggregateByProspect) {
    for (const pid of leagueAggregateByProspect.keys()) candidateIds.add(pid);
  }

  const entries: DraftBoardEntry[] = [];
  for (const collegePlayerId of candidateIds) {
    const prospect = prospectById.get(collegePlayerId);
    if (!prospect) continue;
    // Boards are the "who could we actually pick" surface — keep
    // them limited to draft-eligible prospects (JR / SR / RS_SR).
    // Filter out only prospects who EXPLICITLY chose to return to
    // school this cycle (v0.53.1). Pending JRs (pre-declaration
    // roll) still appear — the board is a strategic view of the
    // full draftable cohort. Once declarations roll, returning
    // JRs are stamped `hasReturnedToSchool=true` and drop off
    // until they age into SR (auto-declared) next cycle.
    if (!prospect.isDraftEligible) continue;
    if (prospect.hasReturnedToSchool) continue;

    const ownObs = byProspect.get(collegePlayerId);
    const aggregated = ownObs
      ? aggregateCollegeObservations(ownObs, prospect, addedOnTick, athleticRefByPos)
      : null;

    // Pull from own scouts if available; otherwise from the league
    // aggregate (with reduced confidence to reflect "media" intel
    // vs firsthand scouting).
    let observedSkillScore: number;
    let meanConfidence: number;
    let observationCount: number;
    if (aggregated && aggregated.meanConfidence > 0) {
      observedSkillScore = aggregated.observedSkillScore;
      meanConfidence = aggregated.meanConfidence;
      observationCount = ownObs!.length;
    } else if (leagueAggregateByProspect) {
      const league = leagueAggregateByProspect.get(collegePlayerId);
      if (!league || league.meanConfidence === 0) continue;
      observedSkillScore = league.observedSkillScore;
      meanConfidence = league.meanConfidence * LEAGUE_FALLBACK_CONFIDENCE_DISCOUNT;
      observationCount = 0;
    } else {
      continue;
    }

    // Blend the media consensus into the talent read (#5). Media pulls harder
    // when the GM trusts it AND when own scouting is thin (it fills gaps) —
    // a film-room GM (low mediaTrust) is unmoved; a media-driven GM chases
    // the public read on prospects he hasn't scouted himself.
    const mediaRead = mediaAggregateByProspect?.get(collegePlayerId);
    if (mediaRead && mediaRead.meanConfidence > 0 && mediaTrust01 > 0) {
      const w =
        clamp01(mediaTrust01 * mediaRead.meanConfidence * (1.2 - meanConfidence)) *
        MEDIA_BLEND_MAX;
      observedSkillScore = observedSkillScore * (1 - w) + mediaRead.observedSkillScore * w;
      meanConfidence = Math.min(1, meanConfidence + w * mediaRead.meanConfidence * 0.3);
    }

    // The team's PERCEIVED projection (v0.127) — it may identify the true
    // conversion, miss it (and value him at his college spot), or invent one.
    // Everything downstream (scheme fit, need, positional premium, reason) keys
    // off this belief, not ground truth. Omniscient when no voice channel.
    const perceived = perceiveProjection(prospect, {
      scoutSkill: conversionCtx?.scoutSkill ?? 0.5,
      needPressure,
      prng: conversionCtx
        ? voicePrng(conversionCtx.voiceSeed, 'convert', conversionCtx.teamId, collegePlayerId)
        : undefined,
    });
    const schemeFit = schemeFitForCollegeProspect(prospect, hc, perceived.position, perceived.archetype);
    const projGroup = positionGroupFor(perceived.position);
    const need = needScores[projGroup] ?? 1.0;
    const schemeBonus = clampSigned(
      (schemeFit - 1) * SCHEME_BONUS_SCALE,
      SCHEME_BONUS_CAP,
    );
    const needBonus = clampSigned((need - 1) * NEED_BONUS_SCALE, NEED_BONUS_CAP);
    const confFactor = CONFIDENCE_FLOOR + (1 - CONFIDENCE_FLOOR) * meanConfidence;
    // The spot THIS team would play him at — the perceived projection, re-slotted
    // to a convertible hole on the roster. Drives the positional premium below
    // and the actual position on draft.
    const assignedPosition = assignedPositionFor(perceived.position, needPressure);
    // Positional value (v0.91): shade the talent signal by how much draft
    // capital the position is worth, so an equal-graded QB/EDGE/LT out-ranks
    // a replaceable spot (a safety doesn't go top-5 on talent alone). Applied
    // uniformly across all 32 boards, so the consensus shifts with it and the
    // pick-vs-consensus reach distribution stays in equilibrium. Uses the
    // ASSIGNED position so a convert-to-need prospect earns the premium of the
    // spot he'd actually play (the RT a team will start at LT is valued as an LT).
    const posFactor = boardPositionalFactor(assignedPosition);
    const priority = Math.max(
      0,
      (observedSkillScore * posFactor + schemeBonus + needBonus) * confFactor,
    );
    const reason = deriveDraftBoardReason(
      prospect,
      observedSkillScore,
      meanConfidence,
      schemeFit,
      need,
      perceived.sawConversion,
    );

    entries.push({
      collegePlayerId,
      priority: round1(priority),
      reason,
      observedSkillScore: round1(observedSkillScore),
      schemeFit: round2(schemeFit),
      meanConfidence: round2(meanConfidence),
      observationCount,
      addedOnTick,
      assignedPosition,
      perceivedPosition: perceived.position,
    });
  }

  entries.sort((a, b) => b.priority - a.priority);
  return entries.slice(0, DRAFT_BOARD_SIZE);
}

interface AggregatedCollegeObservation {
  observedSkillScore: number;
  meanConfidence: number;
}

/**
 * Confidence-weighted aggregate of one prospect's observations from
 * one team's scouts, with **recency weighting** (v0.41.0): older
 * observations carry less weight via exponential decay (half-life
 * one league year, floor 0.125). The "observed key skill" is
 * averaged over the skills with archetype weight ≥ 1.2 (skills that
 * actually matter for this archetype). Falls back to a small default
 * set when the archetype is unknown / has no high-weight skills.
 *
 * `currentTick` is the tick the board is being regenerated at;
 * per-observation age = `currentTick - obs.observedOnTick`.
 */
/**
 * League-wide OBSERVED mean of each position-baselined physical skill, per
 * position. Used as the athletic-deviation reference so the deviation averages
 * to zero per position (no athletic positional bias in the observed grade — a
 * prospect is only credited for testing ABOVE his position's norm). Built from
 * scout observations (the same space the grade is read in).
 */
function computeAthleticRefByPosition(
  observations: readonly CollegePlayerObservation[],
  prospectById: Map<PlayerId, CollegePlayer>,
): Map<string, Map<string, number>> {
  const sums = new Map<string, Map<string, { sum: number; n: number }>>();
  for (const obs of observations) {
    const prospect = prospectById.get(obs.collegePlayerId);
    if (!prospect) continue;
    const pos = prospect.nflProjectedPosition as string;
    let bySkill = sums.get(pos);
    if (!bySkill) {
      bySkill = new Map();
      sums.set(pos, bySkill);
    }
    for (const key of POSITION_BASELINED_SKILLS) {
      const v = obs.skills[key as keyof PlayerSkills];
      if (v === undefined) continue;
      const cur = bySkill.get(key) ?? { sum: 0, n: 0 };
      cur.sum += v;
      cur.n += 1;
      bySkill.set(key, cur);
    }
  }
  const out = new Map<string, Map<string, number>>();
  for (const [pos, bySkill] of sums) {
    const m = new Map<string, number>();
    for (const [k, s] of bySkill) if (s.n > 0) m.set(k, s.sum / s.n);
    out.set(pos, m);
  }
  return out;
}

function aggregateCollegeObservations(
  observations: readonly CollegePlayerObservation[],
  prospect: CollegePlayer,
  currentTick: number,
  athleticRefByPos?: ReadonlyMap<string, ReadonlyMap<string, number>>,
): AggregatedCollegeObservation {
  const archetype = getArchetypeById(prospect.archetype);
  const keys: (keyof PlayerSkills)[] = archetype
    ? (Object.entries(archetype.skillWeights)
        .filter(([, w]) => (w ?? 1) >= 1.2)
        .map(([k]) => k as keyof PlayerSkills))
    : ['technicalSkill', 'footballIq', 'speed'];
  if (keys.length === 0) keys.push('technicalSkill');

  // Football skills (grade-driven, the real talent signal) are averaged
  // directly; position-baselined PHYSICAL skills contribute only their
  // DEVIATION from the position's athletic baseline (a freak edge grades up, a
  // stiff edge down) so the position-constant athleticism doesn't inflate every
  // grade at the position. See PHYS_DEV_WEIGHT.
  const athBase = athleticBaseline(prospect.nflProjectedPosition as Parameters<typeof athleticBaseline>[0]);
  // Deviation reference: the league's OBSERVED per-position athletic mean when
  // available (self-centering → zero average athletic bias per position), else
  // softCap(baseline) as an approximation of what generation produces.
  const posRef = athleticRefByPos?.get(prospect.nflProjectedPosition as string);
  let footballSum = 0;
  let footballWeight = 0;
  let devSum = 0;
  let devWeight = 0;
  let confidenceSum = 0;
  let confidenceWeightCount = 0;

  for (const obs of observations) {
    const recency = recencyWeight(currentTick - obs.observedOnTick);
    for (const key of keys) {
      const value = obs.skills[key];
      const conf = obs.confidence[key];
      if (value === undefined || conf === undefined) continue;
      const weight = conf * recency;
      if (POSITION_BASELINED_SKILLS.has(key as string)) {
        const base = posRef?.get(key as string) ?? softCap(athBase[key as keyof AthleticBaseline]);
        devSum += (value - base) * weight;
        devWeight += weight;
      } else {
        footballSum += value * weight;
        footballWeight += weight;
      }
    }
    for (const conf of Object.values(obs.confidence)) {
      if (typeof conf !== 'number') continue;
      confidenceSum += conf * recency;
      confidenceWeightCount += recency;
    }
  }

  const football = footballWeight > 0 ? footballSum / footballWeight : null;
  const athleticDev = devWeight > 0 ? devSum / devWeight : 0;
  // Normal case: football grade + athletic deviation bonus/penalty. If the
  // archetype's key skills are ALL physical (no football signal), fall back to
  // the absolute physical read so we still return a sane grade.
  const observedSkillScore =
    football !== null
      ? football + athleticDev * PHYS_DEV_WEIGHT
      : devWeight > 0
        ? devSum / devWeight + averageBaseline(athBase)
        : 0;

  return {
    observedSkillScore,
    meanConfidence: confidenceWeightCount > 0 ? confidenceSum / confidenceWeightCount : 0,
  };
}

/** Mean of a position's athletic baseline (fallback grade for all-physical archetypes). */
function averageBaseline(b: AthleticBaseline): number {
  return (b.speed + b.acceleration + b.agility + b.changeOfDirection + b.jumping + b.strength) / 6;
}

/**
 * Project a `CollegePlayer` into the minimal `Player`-like shape
 * the scheme-fit calculator reads. The calculator only consults
 * `archetype` and the side it implies — perfectly safe.
 */
function schemeFitForCollegeProspect(
  prospect: CollegePlayer,
  hc: HeadCoach,
  // The position + archetype the TEAM evaluates him as (its perceived
  // projection). Defaults to the true projection — the legacy/omniscient read.
  evalPosition: Position = prospect.nflProjectedPosition,
  evalArchetype: ArchetypeId = prospect.archetype,
): number {
  const playerLike = {
    archetype: evalArchetype,
    position: evalPosition,
    // v0.96: pass the prospect's true skills so fit is embodiment-aware
    // (only blue-chip prospects realize a premium scheme fit).
    current: prospect.current,
    // v0.99 item 1: pass size so the fit's size penalty applies (an
    // undersized prospect at his projected position fits worse).
    heightInches: prospect.measurables.heightInches,
    weightLbs: prospect.measurables.weightLbs,
  } as unknown as Player;
  return schemeFitForPlayer(playerLike, {
    offensiveScheme: hc.offensiveScheme,
    defensiveScheme: hc.defensiveScheme,
  });
}

function deriveDraftBoardReason(
  prospect: CollegePlayer,
  observedSkillScore: number,
  meanConfidence: number,
  schemeFit: number,
  need: number,
  // Whether THIS team perceives a position conversion (identified or invented).
  sawConversion: boolean,
): DraftBoardReason {
  // Conversion projection takes priority when scheme fit is strong AND
  // THIS team perceives a move off his college spot — the "creative team
  // identified him" narrative (the team that missed it labels him normally).
  if (sawConversion && schemeFit >= 1.15) {
    return 'CONVERSION_PROJECTION';
  }
  // Blue chip — high observed skill + strong confidence (lots of
  // reports agreeing).
  if (observedSkillScore >= 80 && meanConfidence >= 0.55) {
    return 'BLUE_CHIP';
  }
  if (schemeFit >= 1.3) return 'SCHEME_FIT';
  if (need >= 1.15) return 'POSITIONAL_NEED';
  // Big ceiling-vs-current gap → developmental project.
  // Use the prospect's true ceiling here (engine-side derivation, not
  // UI-displayable per North Star — the team's UI surfaces only
  // descriptive language about upside).
  const cgap = ceilingMean(prospect.ceiling) - currentMean(prospect.current);
  if (cgap >= 12) return 'DEVELOPMENTAL';
  // Default
  return 'BLUE_CHIP';
}

function ceilingMean(s: PlayerSkills): number {
  return (s.speed + s.acceleration + s.agility + s.strength + s.technicalSkill +
    s.footballIq + s.decisionMaking + s.handsBallSkills) / 8;
}
function currentMean(s: PlayerSkills): number {
  return (s.speed + s.acceleration + s.agility + s.strength + s.technicalSkill +
    s.footballIq + s.decisionMaking + s.handsBallSkills) / 8;
}

/**
 * Compute per-position-group need scores for a team's draft board.
 * Same shape as the FA watch-list need computation but a touch
 * softer (sqrt floor at 0.85, ceiling at 1.25) — draft is long-term
 * planning, not crisis hiring. A team thin at OL still considers
 * top WR talent.
 */
function computeDraftNeedScores(
  team: TeamState,
  players: Readonly<Record<string, Player>>,
): Record<PositionGroup, number> {
  const counts: Record<PositionGroup, number> = {
    QB: 0, SKILL: 0, OL: 0, DL: 0, LB: 0, DB: 0, ST: 0,
  };
  for (const pid of team.rosterIds) {
    const p = players[pid];
    if (!p) continue;
    counts[p.positionGroup]++;
  }
  const scores: Record<PositionGroup, number> = {} as Record<PositionGroup, number>;
  for (const group of Object.keys(counts) as PositionGroup[]) {
    const ratio = POSITION_GROUP_TARGETS[group] / Math.max(1, counts[group]);
    scores[group] = clamp(Math.sqrt(ratio), 0.85, 1.25);
  }
  return scores;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Symmetric clamp to ±cap. */
function clampSigned(v: number, cap: number): number {
  return Math.max(-cap, Math.min(cap, v));
}

/** Clamp to [0, 1]. */
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Media evaluator scoutId is `${outletId}::e${n}`; strip the evaluator suffix. */
function outletIdOf(scoutId: string): string {
  const i = scoutId.indexOf('::');
  return i === -1 ? scoutId : scoutId.slice(0, i);
}

/**
 * Build one GM's media consensus read per prospect, weighting each outlet's
 * observation by how reliable THIS GM perceives that outlet to be on the
 * prospect's position group (Slice 2 — GMs consume the media). A GM who
 * (wrongly) trusts a loud outlet lets its read dominate; a sharp GM who reads
 * it as junk barely registers it. Falls back to the outlet's true accuracy
 * when the GM has no seeded belief (legacy saves), and to full weight for an
 * unknown outlet id (e.g. synthetic test reads).
 */
function buildMediaAggregateForGm(
  mediaByProspect: ReadonlyMap<PlayerId, CollegePlayerObservation[]>,
  prospectById: Map<PlayerId, CollegePlayer>,
  addedOnTick: number,
  perceived: PerceivedOutletReliability | undefined,
  outlets: Readonly<Record<MediaOutletId, MediaOutlet>> | undefined,
  athleticRefByPos?: ReadonlyMap<string, ReadonlyMap<string, number>>,
): Map<PlayerId, { observedSkillScore: number; meanConfidence: number }> {
  const out = new Map<PlayerId, { observedSkillScore: number; meanConfidence: number }>();
  for (const [pid, obsList] of mediaByProspect) {
    const prospect = prospectById.get(pid);
    if (!prospect) continue;
    const group = positionGroupFor(prospect.nflProjectedPosition);
    const weighted = obsList.map((o) => weightMediaObs(o, group, perceived, outlets));
    out.set(pid, aggregateCollegeObservations(weighted, prospect, addedOnTick, athleticRefByPos));
  }
  return out;
}

/**
 * Scale a media observation's confidence by the GM's perceived reliability of
 * its outlet for `group` (1-10 → ×0.1-1.0). Perception first; outlet true
 * accuracy as a legacy fallback; full weight if the outlet is unknown.
 */
function weightMediaObs(
  obs: CollegePlayerObservation,
  group: PositionGroup,
  perceived: PerceivedOutletReliability | undefined,
  outlets: Readonly<Record<MediaOutletId, MediaOutlet>> | undefined,
): CollegePlayerObservation {
  const outletId = outletIdOf(obs.scoutId) as MediaOutletId;
  let acc = perceived?.[outletId]?.[group];
  if (acc === undefined && outlets) {
    const outlet = outlets[outletId];
    if (outlet) acc = outlet.accuracyByGroup[group] ?? outlet.accuracySpectrum;
  }
  if (acc === undefined) return obs;
  const w = clamp01(acc / 10);
  if (w >= 1) return obs;
  const scaled: Partial<Record<keyof PlayerSkills, number>> = {};
  for (const k of Object.keys(obs.confidence) as (keyof PlayerSkills)[]) {
    scaled[k] = (obs.confidence[k] ?? 0) * w;
  }
  return { ...obs, confidence: scaled };
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
