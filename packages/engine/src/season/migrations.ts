import type { LeagueState } from '../types/league.js';
import type { Player } from '../types/player.js';
import type { TeamState } from '../types/team.js';
import type { CollegeScout, CollegePlayerObservation } from '../types/college.js';
import type { PlayerId, ScoutId, TeamId } from '../types/ids.js';
import { Prng } from '../prng/index.js';
import { rollMoodProfileFromSeed } from '../players/mood-profile.js';
import { generateInitialCollegePool } from '../draft/pool.js';
import { generateTeamCollegeScouts } from '../draft/college-scout.js';
import { generateInitialCollegeObservations } from '../draft/college-observation.js';
import { regenerateDraftBoardsForLeague } from '../draft/board.js';
import { runCombine } from '../draft/combine.js';
import { runProDays } from '../draft/pro-days.js';
import type { DraftBoardEntry, CombineMeasurables, ProDayAttendanceRecord } from '../types/college.js';

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
 *
 * v0.33.0: `LeagueState.collegeScouts`, `LeagueState.collegeObservations`,
 * and `TeamState.collegeScoutIds` exist. Pre-v0.33 saves get a
 * deterministic backfill seeded from `${seed}::college-scouts::backfill`
 * so reload-then-save reproduces a stable league.
 *
 * v0.34.0: `LeagueState.draftBoards` exists. Pre-v0.34 saves get a
 * fresh board derivation (pure function — no PRNG needed) from the
 * other already-present state. If college scouts were also missing
 * the v0.33 backfill runs first, so boards always have something to
 * derive from.
 *
 * v0.35.0: `LeagueState.combineResults` and `LeagueState.proDayAttendance`
 * exist. Pre-v0.35 saves backfill from seeds
 * `${seed}::combine::backfill` and `${seed}::pro-days::backfill`. Pro
 * days uses the just-backfilled boards as input so attendance is
 * stable across reload.
 *
 * v0.36.0: `LeagueState.draftHistory` exists. Pre-v0.36 saves backfill
 * with an empty array — no historical reconstruction possible without
 * full record of every prior draft, and the cost of starting fresh is
 * minimal (only the upcoming draft's records matter for downstream).
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

  // v0.33.0 college scouts + observations + per-team collegeScoutIds.
  // Detect missing-field state via collegeScouts (the league-level
  // map). If absent, generate scouts for every team deterministically.
  if (!next.collegeScouts) {
    const cscoutsPrng = new Prng(`${next.seed}::college-scouts::backfill`);
    const collegeScouts: Record<string, CollegeScout> = {};
    const collegeScoutsByTeam: Record<string, readonly CollegeScout[]> = {};
    const teamUpdates: Record<string, TeamState> = {};
    for (const team of Object.values(next.teams)) {
      const owner = next.owners[team.ownerId];
      const gm = next.gms[team.gmId];
      if (!owner || !gm) continue;
      const teamScouts = generateTeamCollegeScouts(
        cscoutsPrng.fork(`team:${team.identity.abbreviation}`),
        team.identity.abbreviation,
        owner,
        gm,
      );
      const collegeScoutIds: ScoutId[] = [];
      for (const cs of teamScouts) {
        collegeScouts[cs.id] = cs;
        collegeScoutIds.push(cs.id);
      }
      collegeScoutsByTeam[team.identity.id] = teamScouts;
      teamUpdates[team.identity.id] = { ...team, collegeScoutIds };
    }
    const observations: CollegePlayerObservation[] = generateInitialCollegeObservations(
      cscoutsPrng.fork('initial-obs'),
      collegeScoutsByTeam as Readonly<Record<TeamId, readonly CollegeScout[]>>,
      next.collegePool,
      next.tick,
    );
    next = {
      ...next,
      teams: { ...next.teams, ...teamUpdates } as typeof next.teams,
      collegeScouts: collegeScouts as Readonly<Record<ScoutId, CollegeScout>>,
      collegeObservations: observations,
    };
  } else {
    // collegeScouts exists but a team may still be missing collegeScoutIds
    // (defensive — handles hand-edited save files). No new scouts
    // generated; just back-fill empty arrays.
    let teamsTouched = false;
    const teamUpdates: Record<string, TeamState> = {};
    for (const team of Object.values(next.teams)) {
      if (!team.collegeScoutIds) {
        teamUpdates[team.identity.id] = { ...team, collegeScoutIds: [] };
        teamsTouched = true;
      }
    }
    if (teamsTouched) {
      next = { ...next, teams: { ...next.teams, ...teamUpdates } as typeof next.teams };
    }
    if (!next.collegeObservations) {
      next = { ...next, collegeObservations: [] };
    }
  }

  // v0.34.0 draft boards. Pure derivation from already-present state.
  if (!next.draftBoards) {
    const boards = regenerateDraftBoardsForLeague({
      teams: next.teams,
      collegeScouts: next.collegeScouts,
      coaches: next.coaches,
      players: next.players,
      collegePool: next.collegePool,
      observations: next.collegeObservations,
      addedOnTick: next.tick,
    });
    next = { ...next, draftBoards: boards as Readonly<Record<TeamId, readonly DraftBoardEntry[]>> };
  }

  // v0.35.0 combine results.
  if (!next.combineResults) {
    const combine = runCombine(
      new Prng(`${next.seed}::combine::backfill`),
      next.collegePool,
      next.tick,
    );
    next = {
      ...next,
      combineResults: combine as Readonly<Record<import('../types/ids.js').PlayerId, CombineMeasurables>>,
    };
  }

  // v0.35.0 pro-day attendance. Depends on draftBoards being present.
  if (!next.proDayAttendance) {
    const proDays = runProDays(
      new Prng(`${next.seed}::pro-days::backfill`),
      next.teams,
      next.collegePool,
      next.draftBoards,
    );
    next = {
      ...next,
      proDayAttendance: proDays as Readonly<Record<TeamId, readonly ProDayAttendanceRecord[]>>,
    };
  }

  // v0.36.0 draft history. No reconstruction — start empty.
  if (!next.draftHistory) {
    next = { ...next, draftHistory: [] };
  }

  return next;
}
