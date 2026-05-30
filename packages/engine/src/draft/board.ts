import type { TeamId, PlayerId, GmId } from '../types/ids.js';
import type { PositionGroup } from '../types/enums.js';
import type {
  CollegePlayer,
  CollegePlayerObservation,
  CollegeScout,
  CombineMeasurables,
  DraftBoardEntry,
  DraftBoardReason,
} from '../types/college.js';
import type { TeamState } from '../types/team.js';
import type { Player, PlayerSkills } from '../types/player.js';
import type { HeadCoach, Gm } from '../types/personnel.js';
import { getArchetypeById } from '../archetypes/index.js';
import { schemeFitForPlayer } from '../scheme/index.js';
import { positionGroupFor } from '../players/position-group.js';
import { boardPositionalFactor } from './position-value.js';
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
}): Record<TeamId, DraftBoardEntry[]> {
  const needScoresByTeam = new Map<TeamId, Record<PositionGroup, number>>();
  for (const team of Object.values(args.teams)) {
    needScoresByTeam.set(team.identity.id, computeDraftNeedScores(team, args.players));
  }
  return regenerateDraftBoardsInternal({ ...args, needScoresByTeam });
}

function regenerateDraftBoardsInternal(args: {
  teams: Readonly<Record<TeamId, TeamState>>;
  collegeScouts: Readonly<Record<ScoutId, CollegeScout>>;
  coaches: Readonly<Record<string, HeadCoach>>;
  collegePool: readonly CollegePlayer[];
  observations: readonly CollegePlayerObservation[];
  needScoresByTeam: Map<TeamId, Record<PositionGroup, number>>;
  addedOnTick: number;
  combineResults?: Readonly<Record<string, CombineMeasurables>>;
  mediaObservations?: readonly CollegePlayerObservation[];
  gms?: Readonly<Record<GmId, Gm>>;
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
      aggregateCollegeObservations(merged, prospect, args.addedOnTick),
    );
  }

  // Media consensus read per prospect (#5 — GMs consume the media). Pooled
  // across all outlets' observations, aggregated like a scouting read. Each
  // team blends this in below, weighted by its GM's mediaTrust.
  const mediaAggregateByProspect = new Map<
    PlayerId,
    { observedSkillScore: number; meanConfidence: number }
  >();
  if (args.mediaObservations && args.mediaObservations.length > 0) {
    const mediaByProspect = new Map<PlayerId, CollegePlayerObservation[]>();
    for (const obs of args.mediaObservations) {
      const b = mediaByProspect.get(obs.collegePlayerId);
      if (b) b.push(obs);
      else mediaByProspect.set(obs.collegePlayerId, [obs]);
    }
    for (const [pid, obsList] of mediaByProspect) {
      const prospect = prospectById.get(pid);
      if (!prospect) continue;
      mediaAggregateByProspect.set(
        pid,
        aggregateCollegeObservations(obsList, prospect, args.addedOnTick),
      );
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
    const teamObs = obsByTeam.get(teamId) ?? [];
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
      ? aggregateCollegeObservations(ownObs, prospect, addedOnTick)
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

    const schemeFit = schemeFitForCollegeProspect(prospect, hc);
    const projGroup = positionGroupFor(prospect.nflProjectedPosition);
    const need = needScores[projGroup] ?? 1.0;
    const schemeBonus = clampSigned(
      (schemeFit - 1) * SCHEME_BONUS_SCALE,
      SCHEME_BONUS_CAP,
    );
    const needBonus = clampSigned((need - 1) * NEED_BONUS_SCALE, NEED_BONUS_CAP);
    const confFactor = CONFIDENCE_FLOOR + (1 - CONFIDENCE_FLOOR) * meanConfidence;
    // Positional value (v0.91): shade the talent signal by how much draft
    // capital the position is worth, so an equal-graded QB/EDGE/LT out-ranks
    // a replaceable spot (a safety doesn't go top-5 on talent alone). Applied
    // uniformly across all 32 boards, so the consensus shifts with it and the
    // pick-vs-consensus reach distribution stays in equilibrium.
    const posFactor = boardPositionalFactor(prospect.nflProjectedPosition);
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
function aggregateCollegeObservations(
  observations: readonly CollegePlayerObservation[],
  prospect: CollegePlayer,
  currentTick: number,
): AggregatedCollegeObservation {
  const archetype = getArchetypeById(prospect.archetype);
  const keys: (keyof PlayerSkills)[] = archetype
    ? (Object.entries(archetype.skillWeights)
        .filter(([, w]) => (w ?? 1) >= 1.2)
        .map(([k]) => k as keyof PlayerSkills))
    : ['technicalSkill', 'footballIq', 'speed'];
  if (keys.length === 0) keys.push('technicalSkill');

  let skillSum = 0;
  let skillWeight = 0;
  let confidenceSum = 0;
  let confidenceWeightCount = 0;

  for (const obs of observations) {
    const recency = recencyWeight(currentTick - obs.observedOnTick);
    for (const key of keys) {
      const value = obs.skills[key];
      const conf = obs.confidence[key];
      if (value === undefined || conf === undefined) continue;
      const weight = conf * recency;
      skillSum += value * weight;
      skillWeight += weight;
    }
    for (const conf of Object.values(obs.confidence)) {
      if (typeof conf !== 'number') continue;
      confidenceSum += conf * recency;
      confidenceWeightCount += recency;
    }
  }

  return {
    observedSkillScore: skillWeight > 0 ? skillSum / skillWeight : 0,
    meanConfidence: confidenceWeightCount > 0 ? confidenceSum / confidenceWeightCount : 0,
  };
}

/**
 * Project a `CollegePlayer` into the minimal `Player`-like shape
 * the scheme-fit calculator reads. The calculator only consults
 * `archetype` and the side it implies — perfectly safe.
 */
function schemeFitForCollegeProspect(prospect: CollegePlayer, hc: HeadCoach): number {
  const playerLike = {
    archetype: prospect.archetype,
    position: prospect.nflProjectedPosition,
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
): DraftBoardReason {
  // Conversion projection takes priority when scheme fit is strong AND
  // the prospect is a primary conversion candidate — that's the
  // "creative team identified him" narrative.
  if (prospect.isConversionCandidate && schemeFit >= 1.15) {
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

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
