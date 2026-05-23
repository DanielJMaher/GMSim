import type { Prng } from '../prng/index.js';
import type { CollegeGame, CollegeGameResult, CollegeTeamGameStats } from '../types/college-season.js';

/**
 * Home-field advantage in college football is bigger than NFL —
 * home crowds, travel, kid players' nerves on the road. Real-world
 * estimates put it at ~3.5–4 points; we use 4.0.
 */
const HOME_FIELD_ADVANTAGE = 4.0;

/**
 * Logistic scaling factor — calibrated against college-football
 * upset rates which are HIGHER than NFL (more talent-stratified
 * matchups produce blowouts; talent-close G5 matchups are coin
 * flips, but cross-tier games (Ohio State vs. Akron) are nearly
 * deterministic).
 *
 * k=0.085 gives:
 *   Δ=3 (close):  ~57% home win
 *   Δ=8:          ~67%
 *   Δ=15:         ~78%
 *   Δ=25:         ~89%
 *   Δ=40+:        ~97% (Power vs Group of 5 baseline gap)
 */
const LOGISTIC_K = 0.085;

const VARIANCE_MIX = [
  { value: 'controlled' as const, weight: 60 },
  { value: 'moderate' as const, weight: 30 },
  { value: 'pure' as const, weight: 10 },
];

export interface SimulateCollegeGameOptions {
  game: CollegeGame;
  homeStrength: number;
  awayStrength: number;
  /** Disable home field advantage (used for neutral-site bowls + CFP). */
  neutralSite?: boolean;
}

/**
 * Simulate one college game. Returns a fully-populated `CollegeGame`
 * with `result` set. Deterministic for the given prng.
 *
 * Lighter than NFL `simulateGame` — no per-unit advantages, no
 * injuries. Just strength delta + variance → score + team stats.
 */
export function simulateCollegeGame(
  prng: Prng,
  options: SimulateCollegeGameOptions,
): CollegeGame {
  const { game, homeStrength, awayStrength, neutralSite } = options;
  const hfa = neutralSite ? 0 : HOME_FIELD_ADVANTAGE;
  const baseDelta = homeStrength - awayStrength + hfa;

  const variance = prng.weighted(VARIANCE_MIX);
  const noiseStdev =
    variance === 'controlled' ? 7 : variance === 'moderate' ? 14 : 26;
  const adjustedDelta = baseDelta + prng.normal(0, noiseStdev);

  const homeWinProb = 1 / (1 + Math.exp(-adjustedDelta * LOGISTIC_K));
  const homeWins = prng.next() < homeWinProb;

  const { homeScore, awayScore } = rollScores(prng, adjustedDelta, homeWins);
  const homeStats = rollStats(prng, homeScore, homeStrength, awayStrength);
  const awayStats = rollStats(prng, awayScore, awayStrength, homeStrength);

  const result: CollegeGameResult = {
    homeScore,
    awayScore,
    homeStats,
    awayStats,
    variance,
  };
  return { ...game, result };
}

/**
 * Score generator. College averages (per FBS box scores 2014-2024):
 *   winning score mean ~32, std ~10
 *   losing score mean ~21, std ~10
 *   total mean ~53
 *
 * Higher than NFL across the board — college offenses run more
 * plays, and the talent gap between teams more often translates to
 * scoreboard separation.
 */
function rollScores(
  prng: Prng,
  delta: number,
  homeWins: boolean,
): { homeScore: number; awayScore: number } {
  const expectedMargin = Math.max(1, Math.min(35, Math.abs(delta) * 0.5));
  const winnerScore = Math.round(prng.normal(32, 10, { min: 7, max: 70 }));
  const loserScore = Math.max(
    0,
    Math.min(
      winnerScore - 1,
      Math.round(winnerScore - prng.normal(expectedMargin, 5, { min: 1, max: 45 })),
    ),
  );

  if (homeWins) return { homeScore: winnerScore, awayScore: loserScore };
  return { homeScore: loserScore, awayScore: winnerScore };
}

/**
 * Generate a team's box-score line. College stats targets (per
 * FBS averages):
 *   passing yds/game ~245
 *   rushing yds/game ~165 (more rushing than NFL — option / spread)
 *   total yds/game   ~410
 *   turnovers given  ~1.4
 *   sacks given up   ~2.5
 *
 * Stronger teams against weaker opponents shift these up; the
 * `strengthGap` shift below produces visible disparity between
 * powerhouse and overmatched lines.
 */
function rollStats(
  prng: Prng,
  pointsScored: number,
  ownStrength: number,
  oppStrength: number,
): CollegeTeamGameStats {
  const strengthGap = ownStrength - oppStrength;

  const passingMean = 230 + strengthGap * 1.3 + pointsScored * 1.5;
  const rushingMean = 155 + strengthGap * 0.8 + pointsScored * 1.0;
  const passingYards = clamp(
    Math.round(prng.normal(passingMean, 60, { min: 20, max: 600 })),
    20,
    600,
  );
  const rushingYards = clamp(
    Math.round(prng.normal(rushingMean, 45, { min: 10, max: 450 })),
    10,
    450,
  );
  const totalYards = passingYards + rushingYards;

  const turnoversMean = 1.4 + (oppStrength - ownStrength) * 0.02;
  const turnovers = Math.max(0, Math.round(prng.normal(turnoversMean, 0.9)));

  const sacksMean = 2.5 + (ownStrength - oppStrength) * 0.04;
  const sacks = Math.max(0, Math.round(prng.normal(sacksMean, 1.5)));

  return {
    totalYards,
    passingYards,
    rushingYards,
    turnovers,
    sacks,
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
