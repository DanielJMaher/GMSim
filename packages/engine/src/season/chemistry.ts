import type { LeagueState } from '../types/league.js';
import type { Player } from '../types/player.js';
import type { TeamState } from '../types/team.js';

/**
 * Coarse team-chemistry label, parallel to but distinct from individual
 * mood buckets. Captures the *room*, not any one player:
 *
 *   toxic      — pervasive frustration; trade rumors / leaks
 *   divided    — clique formation, unhappy stars dragging the room
 *   neutral    — workmanlike, no narrative
 *   cohesive   — playing for each other
 *   locked_in  — championship-window vibes
 *
 * Per Doc 7 + North Star: this is observable through media tone and
 * results, never displayed numerically in the eventual player-facing
 * UI. The dev inspector exposes bucket + raw for tuning.
 */
export type ChemistryBucket =
  | 'toxic'
  | 'divided'
  | 'neutral'
  | 'cohesive'
  | 'locked_in';

export const CHEMISTRY_BUCKETS: readonly ChemistryBucket[] = [
  'toxic',
  'divided',
  'neutral',
  'cohesive',
  'locked_in',
];

/**
 * Map a 0..100 chemistry score to its coarse bucket. Boundaries match
 * the mood-bucket spacing so the two surfaces read consistently in the
 * inspector even though they describe different things.
 */
export function chemistryBucket(score: number): ChemistryBucket {
  if (score < 20) return 'toxic';
  if (score < 40) return 'divided';
  if (score < 60) return 'neutral';
  if (score < 80) return 'cohesive';
  return 'locked_in';
}

export interface TeamChemistry {
  /** Weighted-by-tier roster mood average, 0..100. */
  score: number;
  bucket: ChemistryBucket;
  /** Count of rostered players (active + IR) with mood < 20. */
  unhappyCount: number;
  /** Count of rostered players currently demanding a trade. */
  tradeRequestCount: number;
}

/**
 * Tier weights for the chemistry roll-up. STAR unhappiness dominates
 * — the room feels what its best player feels — while FRINGE players
 * register only weakly. Sums don't need to normalise to 1; the
 * weighted-average division normalises across whoever is on the roster.
 */
const TIER_WEIGHT: Record<Player['tier'], number> = {
  STAR: 4,
  STARTER: 2,
  BACKUP: 1,
  FRINGE: 0.5,
};

/**
 * Roll the team's roster moods into a single 0..100 chemistry score
 * plus narrative counters. Considers the active 53 and IR (PS skipped
 * — they're separate from the active locker room in v0.17.0). Pure
 * compute on top of `Player.mood`; storing this on `TeamState` would
 * just be a denormalised cache to keep in sync.
 */
export function teamChemistry(team: TeamState, league: LeagueState): TeamChemistry {
  const ids = [...team.rosterIds, ...team.injuredReserveIds];
  let weightedSum = 0;
  let weightTotal = 0;
  let unhappyCount = 0;
  let tradeRequestCount = 0;
  for (const id of ids) {
    const p = league.players[id];
    if (!p) continue;
    const w = TIER_WEIGHT[p.tier];
    weightedSum += p.mood * w;
    weightTotal += w;
    if (p.mood < 20) unhappyCount++;
    if (p.tradeRequestedOnTick !== null) tradeRequestCount++;
  }
  const score = weightTotal > 0 ? weightedSum / weightTotal : 75;
  return {
    score,
    bucket: chemistryBucket(score),
    unhappyCount,
    tradeRequestCount,
  };
}
