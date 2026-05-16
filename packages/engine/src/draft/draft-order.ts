import type { TeamId } from '../types/ids.js';
import type { TeamRecord } from '../season/standings.js';

/**
 * Compute draft order for an upcoming draft from the prior season's
 * standings. Worst team picks first; ties broken by:
 *   1. lower point differential (worse team picks earlier)
 *   2. stable team-id ordering as a final tiebreaker so output is
 *      deterministic across runs
 *
 * NFL real life uses inverse strength of schedule + playoff finish as
 * tiebreakers; slice 5a uses a simpler proxy. Future slices can layer
 * in trade-acquired picks and full NFL tiebreaker logic.
 *
 * Returns an array of `TeamId` in pick order. Length matches the input
 * map size — typically 32.
 */
export function computeDraftOrder(
  records: Map<TeamId, TeamRecord>,
): readonly TeamId[] {
  const rows: Array<{ teamId: TeamId; winPct: number; pointDiff: number }> = [];
  for (const [teamId, rec] of records) {
    const total = rec.wins + rec.losses + rec.ties;
    const winPct = total > 0 ? rec.wins / total : 0;
    const pointDiff = rec.pointsFor - rec.pointsAgainst;
    rows.push({ teamId, winPct, pointDiff });
  }
  rows.sort((a, b) => {
    // Lower winPct picks first (worse team).
    if (a.winPct !== b.winPct) return a.winPct - b.winPct;
    // Same record: lower (more negative) point diff picks first.
    if (a.pointDiff !== b.pointDiff) return a.pointDiff - b.pointDiff;
    // Final tiebreaker: stable team-id order.
    return a.teamId.localeCompare(b.teamId);
  });
  return rows.map((r) => r.teamId);
}
