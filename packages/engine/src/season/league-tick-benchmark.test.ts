import { describe, expect, it } from 'vitest';

import { createLeague } from '../league/generate.js';
import { advanceSeason } from './advance.js';
import { simulateSeason } from './runner.js';

/**
 * Full-season league-tick benchmark — the 32-team scale gate promised in
 * `docs/LIVING_LEAGUE.md` ("32-team performance is a CI gate").
 *
 * One league year = create (32 teams + college pool) → simulateSeason
 * (NFL 17 weeks + playoffs, interleaved college season + postseason) →
 * advanceSeason (full offseason lifecycle through the draft + college
 * cycle). Calibrated 2026-06-09: ~16s on an idle local machine; under
 * parallel suite load on CI runners this can stretch several-fold, so
 * the budget is deliberately generous. It only trips on a structural
 * regression — an accidental O(n²) over the player pool, unbounded
 * growth in a per-tick sweep — not on runner noise.
 *
 * If this test starts failing without an obvious hot spot, profile a
 * season tick before raising the budget; the budget is the contract.
 */
describe('league-tick benchmark (32-team scale gate)', () => {
  it('runs a full league year inside the wall-clock budget', () => {
    const BUDGET_MS = 240_000;

    const start = Date.now();
    const created = createLeague({ seed: 'league-tick-benchmark' });
    const played = simulateSeason(created);
    const advanced = advanceSeason(played);
    const elapsed = Date.now() - start;

    // Sanity: the cycle actually did a league year's work.
    expect(played.lifecyclePhase).toBe('SUPER_BOWL');
    expect(advanced.lifecyclePhase).toBe('READY_FOR_NEXT_SEASON');
    expect(Object.keys(advanced.players).length).toBeGreaterThan(1_500);

    expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});
