import { DraftPickId } from '../types/ids.js';
import type { TeamId } from '../types/ids.js';
import type { DraftPickAsset } from '../types/college.js';

/**
 * How many years of future picks each team owns. Real NFL teams
 * trade picks up to ~3 years out (occasionally 4); 3 is the sweet
 * spot — meaningful trade capital without infinite future-pick
 * inflation. Beyond 3 years out, future-pick chart value (Doc 5)
 * already caps at the 3-year discount (0.44×), so additional years
 * would be ornamental.
 */
const PICK_HORIZON_YEARS = 3;

const DRAFT_ROUNDS = 7;

/**
 * Generate every team's owned picks across the horizon, starting from
 * `startingSeasonNumber`. At league creation, this generates picks
 * for seasons N+1 through N+PICK_HORIZON_YEARS (since the season-N
 * draft hasn't been modeled as a real draft event yet for new
 * leagues — runDraft fires DURING advanceSeason which prepares
 * season N+1).
 *
 * Deterministic — ids encode (originalTeam, season, round) so the
 * same inputs always produce the same asset list.
 */
export function generateInitialDraftPicks(
  teamIds: readonly TeamId[],
  startingSeasonNumber: number,
): DraftPickAsset[] {
  const out: DraftPickAsset[] = [];
  for (const teamId of teamIds) {
    for (let s = startingSeasonNumber; s < startingSeasonNumber + PICK_HORIZON_YEARS; s++) {
      for (let r = 1; r <= DRAFT_ROUNDS; r++) {
        out.push(buildPick(teamId, s, r));
      }
    }
  }
  return out;
}

/**
 * Advance the pick horizon forward one year:
 *   - Pop the now-current-year's picks (consumed by the just-fired draft)
 *   - Push a fresh year at the far edge of the horizon, owned by each
 *     team's original-team self
 *
 * `currentDraftSeason` is the season the draft just fired for (i.e.,
 * the nextSeasonNumber the advance is preparing). After this call,
 * the asset list contains picks for seasons currentDraftSeason+1
 * through currentDraftSeason+PICK_HORIZON_YEARS.
 *
 * Idempotent for a given (existing picks, currentDraftSeason). If
 * the new far-year picks already exist (defensive against double-
 * advance), they're not duplicated.
 */
export function advancePickHorizon(
  existingPicks: readonly DraftPickAsset[],
  currentDraftSeason: number,
  teamIds: readonly TeamId[],
): DraftPickAsset[] {
  const farYear = currentDraftSeason + PICK_HORIZON_YEARS;
  // Strip out the just-drafted year (assets should already be gone
  // via consumePicks during runDraft, but if any leaked through
  // — e.g. an unused pick from a malformed draft — drop them here).
  const survivors = existingPicks.filter((p) => p.seasonNumber > currentDraftSeason);
  // Add the new horizon year if not already present (defensive).
  const existingFarYearIds = new Set(
    survivors.filter((p) => p.seasonNumber === farYear).map((p) => p.id),
  );
  const newPicks: DraftPickAsset[] = [];
  for (const teamId of teamIds) {
    for (let r = 1; r <= DRAFT_ROUNDS; r++) {
      const pick = buildPick(teamId, farYear, r);
      if (!existingFarYearIds.has(pick.id)) newPicks.push(pick);
    }
  }
  return [...survivors, ...newPicks];
}

/**
 * Order picks within a given season + round by the original team's
 * inverse standing (worst original team picks first). Returns the
 * picks in slot order; the team that actually makes the pick is each
 * asset's `currentTeamId`.
 *
 * `originalTeamSlot` is a map of `originalTeamId → slot` derived from
 * the just-finished season's draft order (typically built by passing
 * `computeDraftOrder(records)` as an array and turning into a map of
 * team → idx).
 */
export function picksForRoundInSlotOrder(
  picks: readonly DraftPickAsset[],
  seasonNumber: number,
  round: number,
  originalTeamSlot: ReadonlyMap<TeamId, number>,
): DraftPickAsset[] {
  const matching = picks.filter((p) => p.seasonNumber === seasonNumber && p.round === round);
  matching.sort((a, b) => {
    const sa = originalTeamSlot.get(a.originalTeamId) ?? Number.POSITIVE_INFINITY;
    const sb = originalTeamSlot.get(b.originalTeamId) ?? Number.POSITIVE_INFINITY;
    return sa - sb;
  });
  return matching;
}

/**
 * Remove consumed picks from the asset list. Returns a new array.
 */
export function consumePicks(
  picks: readonly DraftPickAsset[],
  consumedIds: ReadonlySet<DraftPickId>,
): DraftPickAsset[] {
  if (consumedIds.size === 0) return [...picks];
  return picks.filter((p) => !consumedIds.has(p.id));
}

/**
 * Convenience: build the slot-order map from a draft-order array.
 */
export function buildSlotMap(draftOrder: readonly TeamId[]): Map<TeamId, number> {
  const out = new Map<TeamId, number>();
  draftOrder.forEach((tid, idx) => out.set(tid, idx));
  return out;
}

/**
 * Sum the number of picks each team currently owns (any future
 * season). Convenience for inspector + trade-evaluation display.
 */
export function pickOwnershipByTeam(
  picks: readonly DraftPickAsset[],
): Map<TeamId, DraftPickAsset[]> {
  const out = new Map<TeamId, DraftPickAsset[]>();
  for (const p of picks) {
    let bucket = out.get(p.currentTeamId);
    if (!bucket) {
      bucket = [];
      out.set(p.currentTeamId, bucket);
    }
    bucket.push(p);
  }
  return out;
}

function buildPick(teamId: TeamId, seasonNumber: number, round: number): DraftPickAsset {
  return {
    id: DraftPickId(`DP_S${seasonNumber}_R${round}_${teamId}`),
    originalTeamId: teamId,
    currentTeamId: teamId,
    seasonNumber,
    round,
  };
}

export const DRAFT_PICK_HORIZON_YEARS = PICK_HORIZON_YEARS;
export const DRAFT_PICK_ROUNDS = DRAFT_ROUNDS;
