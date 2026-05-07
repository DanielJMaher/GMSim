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
import { teamStrength } from './strength.js';

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
  const homeStats = rollStats(prng, homeScore, homeStrength, awayStrength);
  const awayStats = rollStats(prng, awayScore, awayStrength, homeStrength);
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

function rollStats(
  prng: Prng,
  pointsScored: number,
  ownStrength: number,
  oppStrength: number,
): TeamGameStats {
  const strengthAdj = (ownStrength - oppStrength) * 0.5;
  const totalYards = Math.max(
    150,
    Math.round(prng.normal(330 + pointsScored * 3 + strengthAdj, 60, { min: 100, max: 600 })),
  );
  // Pass/run split varies by team; simple model: ~62% passing on avg.
  const passingShare = Math.max(0.4, Math.min(0.85, prng.normal(0.62, 0.08)));
  const passingYards = Math.round(totalYards * passingShare);
  const rushingYards = totalYards - passingYards;
  const turnovers = Math.max(0, Math.round(prng.normal(1.3, 0.9)));
  const sacks = Math.max(0, Math.round(prng.normal(2.4, 1.4)));
  const thirdDownConversionPct = Math.max(
    10,
    Math.min(70, Math.round(prng.normal(40 + strengthAdj * 0.6, 7))),
  );
  const redZoneTdPct = Math.max(
    20,
    Math.min(85, Math.round(prng.normal(58 + strengthAdj * 0.4, 10))),
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
