import { GameId } from '../types/ids.js';
import type {
  GameInjury,
  GameKind,
  GameResult,
  ScheduledGame,
  TeamGameStats,
} from '../types/game.js';
import type { TeamState } from '../types/team.js';
import type { LeagueState } from '../types/league.js';
import type { Prng } from '../prng/index.js';
import { teamStrength, unitStrengths, type UnitStrengths } from './strength.js';

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
  const homeUnits = unitStrengths(homeTeam, league);
  const awayUnits = unitStrengths(awayTeam, league);
  const homeStats = rollStats(prng, homeScore, homeUnits, awayUnits);
  const awayStats = rollStats(prng, awayScore, awayUnits, homeUnits);
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
  ownUnits: UnitStrengths,
  oppUnits: UnitStrengths,
): TeamGameStats {
  const passAdvantage = ownUnits.passOffense - oppUnits.passDefense;
  const rushAdvantage = ownUnits.rushOffense - oppUnits.rushDefense;

  // Yards: NFL avg ~345 total. Each point of unit advantage shifts
  // the relevant phase by ~1.6 yards/game (passing) / ~1.0 yards/game
  // (rushing); scoring puts a small additional multiplier on yardage
  // (drives that score also produce yards).
  const passingMean =
    220 + passAdvantage * 1.6 + pointsScored * 1.6;
  const rushingMean =
    110 + rushAdvantage * 1.0 + pointsScored * 0.6;
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

  // Turnovers: better passing offense vs worse opposing pass defense
  // → fewer giveaways. Mean 1.3, swing of ±0.5.
  const turnoversMean = 1.3 + (oppUnits.passDefense - ownUnits.passOffense) * 0.018;
  const turnovers = Math.max(0, Math.round(prng.normal(turnoversMean, 0.85)));

  // Sacks generated by THIS team's defense (NFL convention). Better
  // pass-rush vs weaker opposing OL/QB → more sacks.
  const sacksMean = 2.4 + (ownUnits.passDefense - oppUnits.passOffense) * 0.035;
  const sacks = Math.max(0, Math.round(prng.normal(sacksMean, 1.3)));

  // Drive-efficiency stats keep their old shape but use the new
  // advantage signal instead of the raw strength delta.
  const offenseAdj = (passAdvantage + rushAdvantage) * 0.25;
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

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Per-game injury rolls. Per the Game Sim doc, RBs ~15-20% season rate,
 * LBs ~12-15%, WRs ~10-12%, etc. We translate season rates to per-game
 * rates (divide by ~17 games) and roll independently per player.
 *
 * Most games: 0-2 injuries. Many games: zero. This keeps injury impact
 * present without overwhelming the early-game simulation.
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
      const rate = perGameInjuryRate(player.position);
      if (prng.next() < rate) {
        injuries.push(rollInjury(prng, playerId));
      }
    }
  }
  return injuries;
}

function rollInjury(prng: Prng, playerId: string): GameInjury {
  // Severity distribution per Game Sim doc: 50% minor, 35% moderate, 15% major.
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
  const types = ['hamstring', 'ankle', 'concussion', 'shoulder', 'knee', 'back', 'foot'];
  return {
    playerId: playerId as GameInjury['playerId'],
    weeksOut,
    severity,
    type: prng.pick(types),
  };
}

function perGameInjuryRate(position: string): number {
  // Approximate per-game probabilities derived from doc's season-rate ranges.
  // Numbers are intentionally low so a 17-game season produces realistic
  // ~10-20% per-position season injury rates.
  switch (position) {
    case 'RB':
      return 0.011;
    case 'OLB':
    case 'ILB':
      return 0.008;
    case 'WR':
      return 0.007;
    case 'CB':
    case 'S':
    case 'NICKEL':
      return 0.006;
    case 'TE':
      return 0.005;
    case 'LT':
    case 'LG':
    case 'C':
    case 'RG':
    case 'RT':
      return 0.005;
    case 'EDGE':
    case 'DT':
    case 'NT':
      return 0.005;
    case 'QB':
      return 0.003;
    case 'K':
    case 'P':
    case 'LS':
      return 0.0008;
    default:
      return 0.005;
  }
}
