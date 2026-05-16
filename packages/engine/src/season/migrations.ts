import type { LeagueState } from '../types/league.js';
import type { Player } from '../types/player.js';
import type { PlayerId } from '../types/ids.js';
import { Prng } from '../prng/index.js';
import { rollMoodProfileFromSeed } from '../players/mood-profile.js';
import { generateInitialCollegePool } from '../draft/pool.js';

/**
 * Runtime forward-compatibility guards. Called at the top of season
 * entry points so leagues created on older engine versions get
 * patched up to the current schema deterministically. Each migration
 * is a no-op when the field is already present, so it's cheap to run
 * every tick.
 *
 * v0.18.0: every Player gained `moodProfile`. v0.17.0 saves had a
 * flat `mood: 75` for everyone and no profile — backfill rolls a
 * stable profile from `${league.seed}::${playerId}` and snaps the
 * player's current mood to their new setPoint so the old saturation
 * pattern doesn't survive the upgrade.
 *
 * v0.32.0: `LeagueState.collegePool` exists. Pre-v0.32 saves had no
 * field — backfill by deterministically generating an initial pool
 * from the league's seed. Anchors birthdates to the current sim year
 * so the prospects are correctly aged for the league they're being
 * loaded into.
 */
export function migrateLeagueForward(league: LeagueState): LeagueState {
  const updates: Record<PlayerId, Player> = {};
  for (const [id, player] of Object.entries(league.players)) {
    if (player.moodProfile) continue;
    const profile = rollMoodProfileFromSeed(`${league.seed}::${id}`);
    updates[id as PlayerId] = {
      ...player,
      moodProfile: profile,
      mood: profile.setPoint,
    };
  }

  let next = league;
  if (Object.keys(updates).length > 0) {
    next = {
      ...next,
      players: { ...next.players, ...updates },
    };
  }

  if (!next.collegePool) {
    const simYear = 2026 + (next.seasonNumber - 1);
    const pool = generateInitialCollegePool(
      new Prng(`${next.seed}::college-pool::backfill`),
      { simYear, idPrefix: `B${next.seasonNumber}` },
    );
    next = { ...next, collegePool: pool };
  }

  return next;
}
