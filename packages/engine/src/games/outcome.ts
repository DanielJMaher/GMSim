import { GameId } from '../types/ids.js';
import type {
  GameInjury,
  GameKind,
  GameResult,
  ScheduledGame,
  TeamGameStats,
} from '../types/game.js';
import { type PlayerGameStats, emptyPlayerGameStats } from '../types/stats.js';
import type { TeamState } from '../types/team.js';
import type { LeagueState } from '../types/league.js';
import type { Prng } from '../prng/index.js';
import { teamStrength, matchupFacets, applyAbilityBoosts, type MatchupFacets } from './strength.js';
import { simulateGameWithDrives, type PlayerStatLine } from './drive-sim.js';
import { injuryAgeMultiplier } from '../players/aging-curves.js';

export interface SimulateGameOptions {
  homeTeam: TeamState;
  awayTeam: TeamState;
  league: LeagueState;
  weekNumber: number;
  kind: GameKind;
  /** Disable home field advantage (used for neutral-site Super Bowl). */
  neutralSite?: boolean;
}

const HOME_FIELD_ADVANTAGE = 3.0;

/**
 * Logistic scaling factor for converting strength delta to win probability.
 *
 * Calibrated against the Game Sim doc's target upset rates:
 *   - Δ=3 (small favorite): home win prob ~55%
 *   - Δ=6: ~62%
 *   - Δ=10: ~72%
 *   - Δ=14: ~82%
 *   - Δ=20+: 90%+
 *
 * k=0.075 produces approximately these probabilities.
 */
const LOGISTIC_K = 0.075;

/** Variance category mix per the Game Sim doc. */
const VARIANCE_MIX = [
  { value: 'controlled' as const, weight: 70 },
  { value: 'moderate' as const, weight: 25 },
  { value: 'pure' as const, weight: 5 },
];

/**
 * Simulate one game between two teams. Returns a fully-populated
 * ScheduledGame with `result` set. Deterministic for the given prng.
 */
export function simulateGame(prng: Prng, options: SimulateGameOptions): ScheduledGame {
  const { homeTeam, awayTeam, league, weekNumber, kind, neutralSite } = options;

  // Bottom-up stat engine (v0.106+, now the DEFAULT): the matchup-driven drive
  // sim produces the score AND emergent per-player stat lines. Opt back into
  // the legacy top-down box-score path with `statEngine: 'topdown'`.
  if (league.statEngine !== 'topdown') {
    return simulateGameBottomUp(prng, options);
  }

  const homeStrength = teamStrength(homeTeam, league);
  const awayStrength = teamStrength(awayTeam, league);
  const hfa = neutralSite ? 0 : HOME_FIELD_ADVANTAGE;
  const baseDelta = homeStrength - awayStrength + hfa;

  const variance = prng.weighted(VARIANCE_MIX);
  const noiseStdev =
    variance === 'controlled' ? 6 : variance === 'moderate' ? 12 : 22;
  const adjustedDelta = baseDelta + prng.normal(0, noiseStdev);

  const homeWinProb = 1 / (1 + Math.exp(-adjustedDelta * LOGISTIC_K));
  const homeWins = prng.next() < homeWinProb;

  const { homeScore, awayScore } = rollScores(prng, adjustedDelta, homeWins);
  // Hidden abilities tilt the matchup on game day (v0.102 item 4b):
  // Superstars always-on, X-Factors roll per-game activation.
  const homeFacets = applyAbilityBoosts(matchupFacets(homeTeam, league), homeTeam, league, prng.fork('home-abil'));
  const awayFacets = applyAbilityBoosts(matchupFacets(awayTeam, league), awayTeam, league, prng.fork('away-abil'));
  const homeStats = rollStats(prng, homeScore, homeFacets, awayFacets);
  const awayStats = rollStats(prng, awayScore, awayFacets, homeFacets);
  const injuries = rollInjuries(prng, homeTeam, awayTeam, league);

  const result: GameResult = {
    homeScore,
    awayScore,
    homeStats,
    awayStats,
    injuries,
    variance,
  };

  return {
    id: GameId(`G_S${league.seasonNumber}_W${weekNumber}_${homeTeam.identity.abbreviation}_${awayTeam.identity.abbreviation}`),
    weekNumber,
    homeTeamId: homeTeam.identity.id,
    awayTeamId: awayTeam.identity.id,
    result,
    kind,
  };
}

/**
 * Bottom-up game (v0.106+): the matchup-driven drive sim produces the score
 * and emergent per-player stat lines. Team box scores are summed from those
 * lines so downstream consumers (standings, media) stay consistent; injuries
 * still roll on the shared per-game model.
 */
function simulateGameBottomUp(prng: Prng, options: SimulateGameOptions): ScheduledGame {
  const { homeTeam, awayTeam, league, weekNumber, kind, neutralSite } = options;
  const sim = simulateGameWithDrives(prng.fork('drives'), homeTeam, awayTeam, league, {
    neutralSite: neutralSite ?? false,
  });
  const stats = sim.playerStats ?? new Map<string, PlayerStatLine>();

  // Stamp each line with the team it was accrued for (rosters at sim time) —
  // stats must survive roster churn (trades/cuts/FA), so team-scoped views
  // join through `teamId`, not the team's later rosterIds.
  const homeIds = new Set<string>(homeTeam.rosterIds);
  const playerStats: PlayerGameStats[] = [];
  for (const [pid, l] of stats) {
    const g = emptyPlayerGameStats(
      pid as PlayerGameStats['playerId'],
      homeIds.has(pid) ? homeTeam.identity.id : awayTeam.identity.id,
    );
    g.passAttempts = l.passAttempts;
    g.passCompletions = l.passCompletions;
    g.passingYards = l.passingYards;
    g.passingTds = l.passingTds;
    g.explosiveCompletions = l.explosiveCompletions;
    g.interceptionsThrown = l.interceptionsThrown;
    g.rushingAttempts = l.rushingAttempts;
    g.rushingYards = l.rushingYards;
    g.rushingTds = l.rushingTds;
    g.targets = l.targets;
    g.receptions = l.receptions;
    g.receivingYards = l.receivingYards;
    g.receivingTds = l.receivingTds;
    g.tackles = l.tackles;
    g.sacks = l.sacks;
    g.interceptions = l.interceptions;
    g.fumblesLost = l.fumblesLost;
    g.fieldGoalsMade = l.fieldGoalsMade;
    g.fieldGoalsAttempted = l.fieldGoalsAttempted;
    g.extraPointsMade = l.extraPointsMade;
    g.punts = l.punts;
    g.puntYards = l.puntYards;
    g.returnYards = l.returnYards;
    g.returnTds = l.returnTds;
    playerStats.push(g);
  }

  const result: GameResult = {
    homeScore: sim.homeScore,
    awayScore: sim.awayScore,
    homeStats: teamStatsFromLines(homeTeam, stats),
    awayStats: teamStatsFromLines(awayTeam, stats),
    injuries: rollInjuries(prng, homeTeam, awayTeam, league),
    variance: 'moderate',
    playerStats,
  };

  return {
    id: GameId(`G_S${league.seasonNumber}_W${weekNumber}_${homeTeam.identity.abbreviation}_${awayTeam.identity.abbreviation}`),
    weekNumber,
    homeTeamId: homeTeam.identity.id,
    awayTeamId: awayTeam.identity.id,
    result,
    kind,
  };
}

/** Sum a team's emergent player lines into its conventional box score.
 *  `sacks` = defensive sacks the team generated; `turnovers` = offensive
 *  giveaways, INTs thrown ONLY — player lines carry ball-carrier
 *  `fumblesLost` (P4b), but folding them in changes `turnovers` semantics
 *  for every consumer, so the team box stays INT-only until the
 *  measurement audit re-bases it deliberately. */
function teamStatsFromLines(
  team: TeamState,
  stats: Map<string, PlayerStatLine>,
): TeamGameStats {
  let passingYards = 0;
  let rushingYards = 0;
  let sacks = 0;
  let turnovers = 0;
  for (const id of team.rosterIds) {
    const l = stats.get(id);
    if (!l) continue;
    passingYards += l.passingYards;
    rushingYards += l.rushingYards;
    sacks += l.sacks;
    turnovers += l.interceptionsThrown;
  }
  return {
    totalYards: passingYards + rushingYards,
    passingYards,
    rushingYards,
    turnovers,
    sacks,
    thirdDownConversionPct: 40,
    redZoneTdPct: 58,
  };
}

/**
 * Generate winner/loser scores. NFL average total is ~45 points; the
 * winner's margin loosely scales with the strength delta.
 */
function rollScores(prng: Prng, delta: number, homeWins: boolean): {
  homeScore: number;
  awayScore: number;
} {
  const expectedMargin = Math.max(1, Math.min(28, Math.abs(delta) * 0.4));
  const winnerScore = Math.round(prng.normal(24, 7, { min: 3, max: 56 }));
  const loserScore = Math.max(
    0,
    Math.min(winnerScore - 1, Math.round(winnerScore - prng.normal(expectedMargin, 4, { min: 1, max: 35 }))),
  );

  if (homeWins) {
    return { homeScore: winnerScore, awayScore: loserScore };
  }
  return { homeScore: loserScore, awayScore: winnerScore };
}

/**
 * Roll one team's offensive stat line. NFL averages over the last
 * decade (2014-2024) target:
 *
 *   passing yds/team/game ~230,  rushing yds/team/game ~115
 *   pass attempts/team    ~33,   completions ~21    (~64% comp%)
 *   sacks given up        ~2.4,  turnovers committed ~1.3
 *   pass TDs              ~1.55, rush TDs ~0.9
 *
 * The yard means below are tuned to land here. Outputs are then
 * shifted by per-unit advantage (passOff vs opp passDef, etc.) so
 * a STAR QB on a great OL produces meaningfully more passing yards
 * than a FRINGE QB on a weak OL.
 */
function rollStats(
  prng: Prng,
  pointsScored: number,
  own: MatchupFacets,
  opp: MatchupFacets,
): TeamGameStats {
  // v0.97: granular matchup edges (player-model overhaul Stage 5). Each
  // edge is offense-facet − defense-facet, ~0 across the league (facets
  // share a distribution), so the base constants below still hold the NFL
  // averages while individual matchups swing the box score.
  const coverageEdge = (own.qbPlay + own.receivingCorps) / 2 - opp.coverage;
  const runEdge = (own.runBlocking + own.rushingCorps) / 2 - opp.runDefense;
  // v0.101 item 3: DIMENSIONAL pass-rush matchup. A rusher wins via his
  // best angle vs the matching protection counter (power→anchor,
  // finesse→mirror), centered by DIM_RUSH_BIAS so league-average sacks/
  // pressure hold. oppRushWin = the offense's pocket being beaten;
  // ownRushWin = this team's defense beating the opponent's protection.
  const oppRushWin = dimRushWin(opp, own);
  const ownRushWin = dimRushWin(own, opp);

  // Passing: a QB/receiving edge over coverage lifts yards; getting the
  // pocket beaten (oppRushWin > 0) suppresses them.
  const passingMean = 220 + coverageEdge * 1.4 - oppRushWin * 0.8 + pointsScored * 1.6;
  const rushingMean = 110 + runEdge * 1.1 + pointsScored * 0.6;
  const passingYards = clamp(
    Math.round(prng.normal(passingMean, 55, { min: 30, max: 520 })),
    30,
    520,
  );
  const rushingYards = clamp(
    Math.round(prng.normal(rushingMean, 35, { min: 20, max: 320 })),
    20,
    320,
  );
  const totalYards = passingYards + rushingYards;

  // Turnovers committed by THIS offense: tight coverage (vs QB+receiving)
  // and a beaten pocket (oppRushWin) both force giveaways.
  const turnoversMean = 1.3 + (opp.coverage - own.qbPlay) * 0.016 + oppRushWin * 0.012;
  const turnovers = Math.max(0, Math.round(prng.normal(turnoversMean, 0.85)));

  // Sacks generated by THIS team's defense: its dimensional rush win over
  // the opponent's protection.
  const sacksMean = 2.4 + ownRushWin * 0.07;
  const sacks = Math.max(0, Math.round(prng.normal(sacksMean, 1.3)));

  // Drive-efficiency stats keep their old shape, driven by the combined
  // offensive matchup advantage.
  const offenseAdj = (coverageEdge + runEdge) * 0.25;
  const thirdDownConversionPct = clamp(
    Math.round(prng.normal(40 + offenseAdj * 0.6, 7)),
    10,
    70,
  );
  const redZoneTdPct = clamp(
    Math.round(prng.normal(58 + offenseAdj * 0.4, 10)),
    20,
    85,
  );

  return {
    totalYards,
    passingYards,
    rushingYards,
    turnovers,
    sacks,
    thirdDownConversionPct,
    redZoneTdPct,
  };
}

/**
 * Dimensional pass-rush win (v0.101 item 3): how much `rush`'s best attack
 * angle (power vs anchor, finesse vs mirror) beats `prot`'s matching
 * counter. `Math.max` rewards a rusher who wins his strong angle even if
 * the protection holds elsewhere; `DIM_RUSH_BIAS` re-centers the max so the
 * league-average matchup lands at ~0 (holding NFL sack/pressure rates).
 */
const DIM_RUSH_BIAS = 6;
function dimRushWin(rush: MatchupFacets, prot: MatchupFacets): number {
  const power = rush.passRushPower - prot.passProtAnchor;
  const finesse = rush.passRushFinesse - prot.passProtMirror;
  return Math.max(power, finesse) - DIM_RUSH_BIAS;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Per-game injury rolls (Injury Realism Stage I, v0.188.0).
 *
 * A player who is ALREADY out with an active injury is not exposed to a new
 * game injury — he is not on the field. This matches the availability model the
 * rate table was fit against (the D0 Monte-Carlo skips the out-window, INJURY_
 * REALISM §3.1 / `_inj_d0_p4fit.mjs`) and keeps man-games from double-counting.
 * MAJOR-injured players are already off `rosterIds` (on IR); MINOR/MODERATE/head
 * players stay rostered but are skipped here.
 */
function rollInjuries(
  prng: Prng,
  home: TeamState,
  away: TeamState,
  league: LeagueState,
): readonly GameInjury[] {
  const injuries: GameInjury[] = [];
  for (const team of [home, away]) {
    for (const playerId of team.rosterIds) {
      const player = league.players[playerId];
      if (!player) continue;
      if (player.injury) continue; // already out — not exposed (see fn doc)
      // S5: proneness rises with age + falls with durability (real bar:
      // injury-shortened seasons run 17% mid-20s → 32% at 34).
      const rate =
        injuryRateByPosition(player.position) * injuryAgeMultiplier(player, league.seasonNumber);
      if (prng.next() < rate) {
        injuries.push(rollInjury(prng, playerId));
      }
    }
  }
  return injuries;
}

/**
 * Interim head-injury share (INJURY_REALISM §6, Daniel's §13.4 ruling). Of all
 * injury EVENTS, this fraction is a generic `'head'` injury (fixed 3-week
 * absence, no severity roll, no play-through) carved out of the severity/
 * duration pool — replacing the old `'concussion'` entry in the generic type
 * list. 0.12 inherits the prior generic-pool concussion share (~1/7, trimmed:
 * concussions are a minority of significant injuries) as an INTERIM placeholder;
 * the precise incidence/timeline is the named Concussion Protocol module's D0 to
 * derive from real injury-report data. The `'head'` type tag lets that module
 * migrate these records without save-format archaeology.
 */
const HEAD_INJURY_SHARE = 0.12;
/** Fixed head-injury absence (weeks). Interim; the protocol module replaces it. */
const HEAD_INJURY_WEEKS = 3;

function rollInjury(prng: Prng, playerId: string): GameInjury {
  // Head injuries are carved out of the generic severity/duration rolls (§6):
  // a fixed 3-week absence, tagged distinctly. Nominal MODERATE severity keeps
  // it off IR and off the MAJOR body-scar path (severity is not meaningful for
  // head — the `'head'` type is the load-bearing tag).
  if (prng.next() < HEAD_INJURY_SHARE) {
    return {
      playerId: playerId as GameInjury['playerId'],
      weeksOut: HEAD_INJURY_WEEKS,
      severity: 'MODERATE',
      type: 'head',
    };
  }
  // Severity distribution (kept — D0-P4 found the §3.1 "more short events,
  // MODERATE narrowed" reshape COUNTERPRODUCTIVE: it caps p90 and forces the
  // rate absurdly high. The M-INJ.1 p90~9/sd~4 skew comes from the long MAJOR
  // tail, so 50/35/15 with 1-3/3-9/8-26 is retained and the tail kept long).
  const severity = prng.weighted([
    { value: 'MINOR' as const, weight: 50 },
    { value: 'MODERATE' as const, weight: 35 },
    { value: 'MAJOR' as const, weight: 15 },
  ]);
  const weeksOut =
    severity === 'MINOR'
      ? prng.nextRange(1, 3)
      : severity === 'MODERATE'
        ? prng.nextRange(3, 9)
        : prng.nextRange(8, 26);
  const types = ['hamstring', 'ankle', 'shoulder', 'knee', 'back', 'foot'];
  return {
    playerId: playerId as GameInjury['playerId'],
    weeksOut,
    severity,
    type: prng.pick(types),
  };
}

/**
 * Per-game injury probability by position (Injury Realism Stage I, v0.188.0),
 * replacing the old doc-guess `perGameInjuryRate`. Sized so season-level
 * starts-missed distributions land on the M-INJ.1-derived, D0-P1-discounted
 * targets: QB1 mean ~2.0-2.2 starts missed (real 3.24 raw, benching-discounted;
 * P1 bracket [1.33, 2.82]); roster-wide man-games ~286/team (sd 40) and
 * value-weighted loss ~34.3% (sd 4.5pp).
 *
 * Fit PER-CONSTRAINT, not by a uniform multiplier (D0-P4 HARD FLAG 2): the QB
 * bar wants ~12× the old rate, but the man-games / value-weighted bars want
 * ~19-20× — a single scale cannot hit both, because the old table over-weighted
 * QB relative to the skill/front-seven positions that dominate man-games. So QB
 * sits at its own P1-discounted bar (0.035 ≈ 11.7×), and every non-QB row is
 * ~19× its old value. Bracket carried: QB [0.022, 0.047].
 *
 * The DRAW stays quality-orthogonal by construction (per-position exposure ×
 * age/durability only — never record, strength, or standings; INJURY_REALISM
 * §8). Effective rate = this × `injuryAgeMultiplier`.
 */
function injuryRateByPosition(position: string): number {
  switch (position) {
    case 'RB':
      return 0.209; // 0.011 × 19
    case 'OLB':
    case 'ILB':
      return 0.152; // 0.008 × 19
    case 'WR':
      return 0.133; // 0.007 × 19
    case 'CB':
    case 'S':
    case 'NICKEL':
      return 0.114; // 0.006 × 19
    case 'TE':
      return 0.095; // 0.005 × 19
    case 'LT':
    case 'LG':
    case 'C':
    case 'RG':
    case 'RT':
      return 0.095; // 0.005 × 19
    case 'EDGE':
    case 'DT':
    case 'NT':
      return 0.095; // 0.005 × 19
    case 'QB':
      return 0.035; // own P1-discounted bar (~11.7×); bracket 0.022-0.047
    case 'K':
    case 'P':
    case 'LS':
      return 0.015; // 0.0008 × ~19
    default:
      return 0.095; // 0.005 × 19
  }
}
