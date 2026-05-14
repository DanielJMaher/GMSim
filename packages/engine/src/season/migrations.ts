import type { LeagueState } from '../types/league.js';
import type { Player } from '../types/player.js';
import type { PlayerId } from '../types/ids.js';
import { rollMoodProfileFromSeed } from '../players/mood-profile.js';

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
  if (Object.keys(updates).length === 0) return league;
  return {
    ...league,
    players: { ...league.players, ...updates },
  };
}
