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
      // Regular season is 17 weeks — injury must have occurred in those weeks.
      expect(p.injury.occurredOnTick).toBeLessThan(startTick + 17);
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
