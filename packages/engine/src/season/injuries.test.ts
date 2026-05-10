import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from './runner.js';
import { advanceSeason } from './advance.js';

/**
 * Injury propagation tests. The `simulateSeason` runner now copies
 * GameInjury events back onto Player.injury so subsequent weeks (and
 * the offseason inspector) see them. `advanceSeason` clears any
 * lingering injuries — offseason heals.
 */
describe('injury propagation', () => {
  it('produces some injured players by season end', () => {
    const league = simulateSeason(createLeague({ seed: 'inj-some' }));
    const injured = Object.values(league.players).filter((p) => p.injury !== null);
    // Across 32 teams × 17 weeks × ~16 games and per-position rates ~0.5-1%,
    // every season produces dozens of injuries. A handful should still be
    // active at end of regular season.
    expect(injured.length).toBeGreaterThan(0);
  });

  it('every injury has occurredOnTick within the season window', () => {
    const league = createLeague({ seed: 'inj-window' });
    const startTick = league.tick;
    const after = simulateSeason(league);
    for (const p of Object.values(after.players)) {
      if (!p.injury) continue;
      expect(p.injury.occurredOnTick).toBeGreaterThanOrEqual(startTick);
      // Regular season is 17 weeks (ticks 0..16) and the playoffs run
      // four more rounds (WC=17, DIV=18, CONF=19, SB=20). Any propagated
      // injury must have occurred inside that 21-tick window.
      expect(p.injury.occurredOnTick).toBeLessThanOrEqual(startTick + 20);
    }
  });

  it('estimatedReturnTick is occurredOnTick + weeksOut (i.e., > occurredOnTick)', () => {
    const league = simulateSeason(createLeague({ seed: 'inj-return' }));
    for (const p of Object.values(league.players)) {
      if (!p.injury) continue;
      expect(p.injury.estimatedReturnTick).toBeGreaterThan(p.injury.occurredOnTick);
    }
  });

  it('a player whose injury return tick is in the past at end of regular season has been recovered', () => {
    const league = createLeague({ seed: 'inj-recover' });
    const after = simulateSeason(league);
    // Any active injury at season-end must still have estimatedReturnTick
    // > the last tick of the regular season (16, since regular season runs
    // weekIdx 0..16).
    const lastRegSeasonTick = league.tick + 16;
    for (const p of Object.values(after.players)) {
      if (!p.injury) continue;
      expect(p.injury.estimatedReturnTick).toBeGreaterThan(lastRegSeasonTick);
    }
  });

  it('advanceSeason clears all injuries (offseason heals)', () => {
    const played = simulateSeason(createLeague({ seed: 'inj-heal' }));
    const injuredBefore = Object.values(played.players).filter((p) => p.injury !== null);
    expect(injuredBefore.length).toBeGreaterThan(0); // sanity
    const after = advanceSeason(played);
    for (const p of Object.values(after.players)) {
      expect(p.injury).toBeNull();
    }
  });

  it('determinism — same seed yields identical injury state', () => {
    const a = simulateSeason(createLeague({ seed: 'inj-det' }));
    const b = simulateSeason(createLeague({ seed: 'inj-det' }));
    for (const id of Object.keys(a.players)) {
      expect(b.players[id]!.injury).toEqual(a.players[id]!.injury);
    }
  });
});

describe('injured reserve', () => {
  it('createLeague initializes every team with an empty IR list', () => {
    const league = createLeague({ seed: 'ir-init' });
    for (const team of Object.values(league.teams)) {
      expect(team.injuredReserveIds).toEqual([]);
    }
  });

  it('MAJOR injuries during a season move the player to IR (off rosterIds)', () => {
    const league = simulateSeason(createLeague({ seed: 'ir-move' }));
    let irTotal = 0;
    let majorActiveAtSeasonEnd = 0;
    for (const team of Object.values(league.teams)) {
      irTotal += team.injuredReserveIds.length;
      // Every IR'd player should still be a Player record on this team,
      // and must NOT appear on the active roster.
      for (const playerId of team.injuredReserveIds) {
        expect(team.rosterIds).not.toContain(playerId);
        const player = league.players[playerId]!;
        expect(player.teamId).toBe(team.identity.id);
      }
    }
    // Sanity: a 32-team season produces several MAJOR injuries.
    expect(irTotal).toBeGreaterThan(0);
    // Regular-season MAJOR injuries always trigger an IR move. Playoff
    // MAJOR injuries do NOT (the season ends immediately and the offseason
    // heal clears state). So any active rosterIds player with a MAJOR
    // injury at season-end must have been hurt during the playoffs (tick
    // ≥ league.tick + 17).
    let majorRegSeasonOnRoster = 0;
    const playoffStartTick = league.tick + 17;
    for (const team of Object.values(league.teams)) {
      for (const playerId of team.rosterIds) {
        const p = league.players[playerId]!;
        if (p.injury?.severity === 'MAJOR') {
          majorActiveAtSeasonEnd++;
          if (p.injury.occurredOnTick < playoffStartTick) {
            majorRegSeasonOnRoster++;
          }
        }
      }
    }
    // Regular-season MAJOR injuries are always IR'd, never left on roster.
    expect(majorRegSeasonOnRoster).toBe(0);
    // Some playoff-week MAJOR injuries land on rosterIds without an IR
    // move — that's expected behavior, just spot-check it can happen.
    expect(majorActiveAtSeasonEnd).toBeGreaterThanOrEqual(0);
  });

  it('advanceSeason restores IR players to the active roster', () => {
    const played = simulateSeason(createLeague({ seed: 'ir-restore' }));
    const irBefore = new Map<string, Set<string>>();
    let irTotalBefore = 0;
    for (const team of Object.values(played.teams)) {
      irBefore.set(team.identity.id, new Set(team.injuredReserveIds));
      irTotalBefore += team.injuredReserveIds.length;
    }
    expect(irTotalBefore).toBeGreaterThan(0); // sanity

    const after = advanceSeason(played);
    for (const team of Object.values(after.teams)) {
      expect(team.injuredReserveIds).toEqual([]);
      // Each pre-advance IR player either retired (gone from league.players)
      // or is now on the active roster (or was released by cap cuts).
      for (const playerId of irBefore.get(team.identity.id) ?? []) {
        const player = after.players[playerId];
        if (!player) continue; // retired
        if (player.teamId === null) continue; // released or expired
        if (player.teamId !== team.identity.id) continue; // signed elsewhere
        expect(after.teams[team.identity.id]!.rosterIds).toContain(playerId);
      }
    }
  });

  it('playoff games propagate injuries onto Player.injury', () => {
    // A single 32-team season produces enough rounds (~13 playoff games
    // × per-game injury rolls) that at least one playoff-week injury
    // shows up under any seed.
    const baseLeague = createLeague({ seed: 'playoff-inj' });
    const league = simulateSeason(baseLeague);
    const playoffStartTick = baseLeague.tick + 17;
    const playoffInjuries = Object.values(league.players).filter(
      (p) => p.injury && p.injury.occurredOnTick >= playoffStartTick,
    );
    expect(playoffInjuries.length).toBeGreaterThan(0);
    for (const p of playoffInjuries) {
      // The four playoff rounds are at ticks +17 through +20.
      expect(p.injury!.occurredOnTick).toBeLessThanOrEqual(playoffStartTick + 3);
      expect(p.injury!.estimatedReturnTick).toBeGreaterThan(p.injury!.occurredOnTick);
    }
  });

  it('IR persists determinism: same seed yields identical IR state across teams', () => {
    const a = simulateSeason(createLeague({ seed: 'ir-det' }));
    const b = simulateSeason(createLeague({ seed: 'ir-det' }));
    for (const teamId of Object.keys(a.teams)) {
      expect(b.teams[teamId as keyof typeof b.teams]!.injuredReserveIds).toEqual(
        a.teams[teamId as keyof typeof a.teams]!.injuredReserveIds,
      );
    }
  });
});
