import type { LeagueState } from '../types/league.js';
import type { TeamState } from '../types/team.js';
import type { Player, PlayerSkills } from '../types/player.js';
import type { Prng } from '../prng/index.js';
import { schemeFitForPlayer } from '../scheme/fit.js';
import { getArchetypeById } from '../archetypes/index.js';
import { Position, PositionGroup } from '../types/enums.js';
import { moodMultiplier } from '../season/mood.js';
import { getAbility, type AbilityFacet } from '../players/abilities.js';

/**
 * Compute a single-number team strength used as the primary input to
 * game outcome rolls. Higher = stronger team.
 *
 * Composition (rough; tunable):
 *   - 70% top-roster talent (top N players' weighted averages)
 *   - 15% scheme fit aggregate (avg fit-multiplier of contributors)
 *   - 10% coaching contribution (HC game management + player development)
 *   - 5% chemistry contribution (Team Personality organizational stability)
 *
 * Output is a number roughly in [40, 100]. The game outcome calculator
 * uses *differences* between strengths, so absolute scaling matters
 * less than consistent ordinality across the league.
 */
export function teamStrength(team: TeamState, league: LeagueState): number {
  const players = team.rosterIds
    .map((id) => league.players[id])
    .filter((p): p is Player => Boolean(p));
  if (players.length === 0) return 50;

  const hc = league.coaches[team.headCoachId]!;
  const tp = league.teamPersonalities[team.identity.id]!;

  // ─── Talent contribution (top players, position-weighted) ─────────────
  const talent = topTalentScore(players);

  // ─── Scheme fit aggregate ─────────────────────────────────────────────
  let fitSum = 0;
  let fitCount = 0;
  for (const p of players) {
    const fit = schemeFitForPlayer(p, {
      offensiveScheme: hc.offensiveScheme,
      defensiveScheme: hc.defensiveScheme,
    });
    fitSum += fit;
    fitCount++;
  }
  const avgFit = fitCount > 0 ? fitSum / fitCount : 1.0;
  // Map avgFit (range ~0.85..1.4) to a 0-100 contribution centered at 60.
  const fitContribution = (avgFit - 1.0) * 60 + 60; // avg fit 1.0 → 60

  // ─── Coaching contribution ────────────────────────────────────────────
  const coachingContribution =
    (hc.spectrums.gameManagement + hc.spectrums.staffDevelopment) * 5; // 1-10 → 5-50, mid 30

  // ─── Chemistry contribution ───────────────────────────────────────────
  const chemistryContribution = tp.organizationalStability * 6; // 1-10 → 6-60, mid 36

  // Weighted combination
  const base =
    talent * 0.7 + fitContribution * 0.15 + coachingContribution * 0.1 + chemistryContribution * 0.05;
  // ─── Ability bonus (v0.102 item 4b) ──────────────────────────────────
  // Difference-makers tilt win probability, not just the box score. EV
  // bonus (X-Factors weighted heavier; per-game activation lives in the
  // stat layer), capped so a star-stacked roster doesn't run away.
  return base + abilityStrengthBonus(players);
}

function abilityStrengthBonus(players: readonly Player[]): number {
  let bonus = 0;
  for (const p of players) {
    for (const id of p.abilities) {
      const a = getAbility(id);
      if (!a) continue;
      bonus += a.tier === 'X_FACTOR' ? 1.5 : 0.6;
    }
  }
  return Math.min(6, bonus);
}

/**
 * Top-talent score: weighted average of position-group leaders.
 *
 * For each position group, take the top N (by archetype-key-skill avg)
 * and average them, then weight groups by importance:
 *   QB  35%, OL 15%, DL 12%, DB 12%, SKILL 12%, LB 10%, ST 4%
 *
 * The QB heavy weight matches NFL reality — a great QB carries
 * everything else more than vice-versa.
 */
function topTalentScore(players: readonly Player[]): number {
  const groupTopN: Record<PositionGroup, number> = {
    QB: 1,
    SKILL: 8,
    OL: 5,
    DL: 4,
    LB: 3,
    DB: 5,
    ST: 1,
  };
  const groupWeight: Record<PositionGroup, number> = {
    QB: 0.35,
    SKILL: 0.12,
    OL: 0.15,
    DL: 0.12,
    LB: 0.1,
    DB: 0.12,
    ST: 0.04,
  };

  let total = 0;
  for (const group of Object.keys(groupTopN) as PositionGroup[]) {
    const groupPlayers = players
      .filter((p) => p.positionGroup === group)
      .map((p) => ({ p, score: keySkillAvg(p) * moodMultiplier(p.mood) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, groupTopN[group]);
    if (groupPlayers.length === 0) continue;
    const groupAvg =
      groupPlayers.reduce((s, x) => s + x.score, 0) / groupPlayers.length;
    total += groupAvg * groupWeight[group];
  }
  return total;
}

function keySkillAvg(p: Player): number {
  const archetype = getArchetypeById(p.archetype);
  const keys = archetype
    ? (Object.entries(archetype.skillWeights)
        .filter(([, w]) => (w ?? 1) >= 1.2)
        .map(([k]) => k as keyof typeof p.current))
    : (['technicalSkill', 'footballIq', 'speed'] as (keyof typeof p.current)[]);
  if (keys.length === 0) return 50;
  let s = 0;
  for (const k of keys) s += p.current[k];
  return s / keys.length;
}

/**
 * Per-unit strength breakdown used by the stat-rolling layer to scale
 * passing/rushing yards, sacks, and turnovers by relevant roster
 * skill. Each value is on the same 0-100 scale as `teamStrength`.
 *
 * The intent is "this team has a STAR QB and FRINGE OL" reads
 * differently from "this team has a FRINGE QB and STAR OL" in the
 * box score, even if their overall `teamStrength` happens to be equal.
 */
export interface UnitStrengths {
  passOffense: number;
  rushOffense: number;
  passDefense: number;
  rushDefense: number;
}

/**
 * Granular matchup facets (v0.97, player-model overhaul Stage 5). Each is a
 * 0-100 rating computed from the team's best players' SPECIFIC granular
 * skills at the relevant positions — so a nasty pass-rush repertoire, a
 * route-running corps, or a man-coverage secondary reads distinctly instead
 * of collapsing into one "pass defense" number. The game-stat layer
 * (`outcome.rollStats`) pits offense facets against defense facets to drive
 * the box score; the legacy 4-unit `UnitStrengths` is derived from these.
 */
export interface MatchupFacets {
  qbPlay: number;
  passProtection: number;
  receivingCorps: number;
  rushingCorps: number;
  runBlocking: number;
  passRush: number;
  coverage: number;
  runDefense: number;
  // Dimensional pass-rush ⇄ protection sub-facets (v0.101, item 3): a power
  // rusher attacks the OL's anchor, a finesse/speed rusher attacks its
  // mirror — so a one-dimensional rusher is stoned by the matching counter
  // and wins big against a weak one. `outcome.rollStats` matches these
  // per-angle instead of comparing the aggregates.
  passRushPower: number;
  passRushFinesse: number;
  passProtAnchor: number;
  passProtMirror: number;
}

function meanKeys(p: Player, keys: readonly (keyof PlayerSkills)[]): number {
  let s = 0;
  for (const k of keys) s += p.current[k];
  return keys.length > 0 ? s / keys.length : 50;
}

/** Average of the top-N players (in `positions`, ranked by `score`,
 * mood-adjusted) of their score. 50 when the team has nobody there. */
function facet(
  players: readonly Player[],
  positions: ReadonlySet<Position>,
  score: (p: Player) => number,
  topN: number,
): number {
  const scored = players
    .filter((p) => positions.has(p.position))
    .map((p) => score(p) * moodMultiplier(p.mood))
    .sort((a, b) => b - a)
    .slice(0, topN);
  if (scored.length === 0) return 50;
  return scored.reduce((a, b) => a + b, 0) / scored.length;
}

const OL_POS = new Set([Position.LT, Position.LG, Position.C, Position.RG, Position.RT]);
const QB_POS = new Set([Position.QB]);
const RECV_POS = new Set([Position.WR, Position.TE, Position.RB]);
const RUSH_POS = new Set([Position.RB, Position.FB]);
const RUSHER_POS = new Set([Position.EDGE, Position.DT, Position.NT, Position.OLB]);
const COVER_POS = new Set([Position.CB, Position.S, Position.NICKEL]);
const FRONT7_POS = new Set([Position.EDGE, Position.DT, Position.NT, Position.ILB, Position.OLB]);

const QB_KEYS: readonly (keyof PlayerSkills)[] = [
  'accuracyShort', 'accuracyMedium', 'accuracyDeep', 'accuracyLeft', 'accuracyMiddle',
  'accuracyRight', 'throwPower', 'decisionMaking', 'throwUnderPressure', 'footballIq',
];
const PROTECT_KEYS: readonly (keyof PlayerSkills)[] = ['passBlockPower', 'passBlockFinesse', 'handTechnique'];
const RECV_KEYS: readonly (keyof PlayerSkills)[] = [
  'routeShort', 'routeMedium', 'routeDeep', 'releaseVsPress', 'releaseVsOff',
  'catching', 'catchInTraffic', 'contestedCatch',
];
const RUSHCORPS_KEYS: readonly (keyof PlayerSkills)[] = [
  'carrying', 'ballCarrierVision', 'elusiveness', 'breakTackle', 'trucking', 'jukeMove', 'speed', 'agility',
];
const RUNBLOCK_KEYS: readonly (keyof PlayerSkills)[] = ['runBlockPower', 'runBlockFinesse', 'impactBlock', 'leadBlock', 'strength'];
const COVER_KEYS: readonly (keyof PlayerSkills)[] = ['manCoverage', 'zoneCoverage', 'pressCoverage', 'ballSkills', 'playRecognition'];
const RUNDEF_KEYS: readonly (keyof PlayerSkills)[] = ['blockShedding', 'tackle', 'pursuit', 'hitPower', 'strength', 'playRecognition'];
const POWER_MOVES: readonly (keyof PlayerSkills)[] = ['bullRush', 'longArm', 'pushPull'];
const FINESSE_MOVES: readonly (keyof PlayerSkills)[] = ['swimMove', 'ripMove', 'spinRush', 'crossChop', 'ghostMove'];

/** A pass rusher is good if he has a winning move — power OR finesse — on
 * top of get-off/bend/hands; we don't require both. */
function passRushScore(p: Player): number {
  const fundamentals = meanKeys(p, ['getOff', 'bend', 'handTechnique']);
  const bestMove = Math.max(meanKeys(p, POWER_MOVES), meanKeys(p, FINESSE_MOVES));
  return 0.4 * fundamentals + 0.6 * bestMove;
}

// Per-angle scorers for the dimensional pass-rush ⇄ protection matchup.
const rushFundamentals = (p: Player) => meanKeys(p, ['getOff', 'bend', 'handTechnique']);
const powerRushScore = (p: Player) => 0.3 * rushFundamentals(p) + 0.7 * meanKeys(p, POWER_MOVES);
const finesseRushScore = (p: Player) => 0.3 * rushFundamentals(p) + 0.7 * meanKeys(p, FINESSE_MOVES);
const anchorScore = (p: Player) =>
  0.7 * p.current.passBlockPower + 0.3 * p.current.handTechnique;
const mirrorScore = (p: Player) =>
  0.7 * p.current.passBlockFinesse + 0.3 * p.current.handTechnique;

export function matchupFacets(team: TeamState, league: LeagueState): MatchupFacets {
  const players = team.rosterIds
    .map((id) => league.players[id])
    .filter((p): p is Player => Boolean(p));
  return {
    qbPlay: facet(players, QB_POS, (p) => meanKeys(p, QB_KEYS), 1),
    passProtection: facet(players, OL_POS, (p) => meanKeys(p, PROTECT_KEYS), 5),
    receivingCorps: facet(players, RECV_POS, (p) => meanKeys(p, RECV_KEYS), 4),
    rushingCorps: facet(players, RUSH_POS, (p) => meanKeys(p, RUSHCORPS_KEYS), 2),
    runBlocking: facet(players, OL_POS, (p) => meanKeys(p, RUNBLOCK_KEYS), 5),
    passRush: facet(players, RUSHER_POS, passRushScore, 4),
    coverage: facet(players, COVER_POS, (p) => meanKeys(p, COVER_KEYS), 4),
    runDefense: facet(players, FRONT7_POS, (p) => meanKeys(p, RUNDEF_KEYS), 6),
    passRushPower: facet(players, RUSHER_POS, powerRushScore, 4),
    passRushFinesse: facet(players, RUSHER_POS, finesseRushScore, 4),
    passProtAnchor: facet(players, OL_POS, anchorScore, 5),
    passProtMirror: facet(players, OL_POS, mirrorScore, 5),
  };
}

// Which MatchupFacets keys an ability's facet boosts. Pass-rush and
// protection abilities bump the dimensional sub-facets too (those are what
// actually drive sacks/pressure in `outcome.dimRushWin`).
const FACET_TARGETS: Record<AbilityFacet, readonly (keyof MatchupFacets)[]> = {
  qbPlay: ['qbPlay'],
  receivingCorps: ['receivingCorps'],
  rushingCorps: ['rushingCorps'],
  passProtection: ['passProtection', 'passProtAnchor', 'passProtMirror'],
  passRush: ['passRush', 'passRushPower', 'passRushFinesse'],
  coverage: ['coverage'],
  runDefense: ['runDefense'],
};

const SUPERSTAR_BOOST = 3;
const X_FACTOR_ACTIVE_CHANCE = 0.5;
const X_FACTOR_ACTIVE_BOOST = 14;
const X_FACTOR_IDLE_BOOST = 3;

/**
 * Apply a team's hidden abilities to its game-day matchup facets (v0.102
 * item 4b). Superstars are an always-on edge; X-Factors roll activation per
 * game (≈50%) — when they pop they DOMINATE that facet, when they don't they
 * leave only a small residual. Deterministic from `prng`; returns a new
 * facet set (input untouched). Sparse league-wide, so NFL averages hold.
 */
export function applyAbilityBoosts(
  facets: MatchupFacets,
  team: TeamState,
  league: LeagueState,
  prng: Prng,
): MatchupFacets {
  const out = { ...facets };
  const players = team.rosterIds
    .map((id) => league.players[id])
    .filter((p): p is Player => Boolean(p));
  for (const p of players) {
    for (const id of p.abilities) {
      const a = getAbility(id);
      if (!a) continue;
      let boost: number;
      if (a.tier === 'X_FACTOR') {
        const active = prng.fork(p.id).next() < X_FACTOR_ACTIVE_CHANCE;
        boost = active ? X_FACTOR_ACTIVE_BOOST : X_FACTOR_IDLE_BOOST;
      } else {
        boost = SUPERSTAR_BOOST;
      }
      for (const key of FACET_TARGETS[a.facet]) {
        out[key] = Math.min(100, out[key] + boost);
      }
    }
  }
  return out;
}

/**
 * Legacy 4-unit strengths, derived from the granular facets so existing
 * consumers (and the stat layer's high-level pass/rush split) keep working.
 */
export function unitStrengths(team: TeamState, league: LeagueState): UnitStrengths {
  const f = matchupFacets(team, league);
  return {
    passOffense: 0.5 * f.qbPlay + 0.28 * f.receivingCorps + 0.22 * f.passProtection,
    rushOffense: 0.55 * f.runBlocking + 0.45 * f.rushingCorps,
    passDefense: 0.55 * f.passRush + 0.45 * f.coverage,
    rushDefense: f.runDefense,
  };
}
