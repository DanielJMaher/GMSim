import type { LeagueState } from '../types/league.js';
import { createLeague, type CreateLeagueOptions } from '../league/generate.js';
import { simulateSeason } from './runner.js';
import { advanceSeason } from './advance.js';

/**
 * A step in the genesis pipeline, reported via `onProgress` so a UI layer can
 * show real status instead of a frozen screen during the ~80s genesis cost
 * (`LEAGUE_GENESIS.md` §1.4 — measured mean 81.6s/league, D0-P4). Plain data,
 * no DOM/React (hard invariant 1) — a UI consumes this however it likes.
 */
export interface GenesisProgressEvent {
  step: 'GENERATING_ROSTERS' | 'SIMULATING_YEAR' | 'FINALIZING';
  /** The in-world year this step simulates, e.g. -5 .. -1. Only set for
   *  'SIMULATING_YEAR'. */
  year?: number;
  /** Total genesis years this run will simulate. Only set for
   *  'SIMULATING_YEAR'. */
  yearsTotal?: number;
}

export interface CreateLivingLeagueOptions extends CreateLeagueOptions {
  /**
   * Years to forward-simulate before handing the league to the caller
   * (`LEAGUE_GENESIS.md` §1.1 — the genesis-at-year-N, then-just-simulate
   * pipeline). Default 5, matching the design's D0 measurements. Named
   * so a caller CAN ask for more (§8's named follow-up: deeper veteran
   * tenure) without this function's shape changing.
   */
  genesisYears?: number;
  /** Progress callback, fired once per pipeline step. Optional — omitting it
   *  runs genesis silently (e.g. from tests/tooling). */
  onProgress?: (event: GenesisProgressEvent) => void;
}

/**
 * Build a "living" league: genesis a fresh league at year `-genesisYears`
 * (today's `createLeague`, completely unchanged), then forward-simulate
 * `genesisYears` seasons using the SAME `simulateSeason`/`advanceSeason`
 * calls every normal season already goes through. The result — organic
 * contract ages, organic dead-money situations, organic breakout/bust
 * asymmetry, organic draft-class turnover — IS the league handed back; there
 * is no further transformation (`LEAGUE_GENESIS.md` §1 — the whole design is
 * this orchestration, deliberately not a new generation/backdating mechanism).
 *
 * Pure orchestration: `createLeague` and the season-advance pipeline are
 * untouched. Determinism preserved — the same seed always produces the same
 * genesis-year state and the same 5 simulated seasons after it.
 *
 * Distinct from `createLeague` on purpose: `createLeague` stays the fast,
 * single-shot generator ~550 call sites across the engine (tests, truth-
 * arbiter probes, tooling) rely on being near-instant. `createLivingLeague`
 * is the player-facing "start a new game" path — its ~80s cost (D0-P4,
 * `LEAGUE_GENESIS.md` §3) is a UI-layer concern (`onProgress`), never
 * something the rest of the engine should pay for by default.
 */
export function createLivingLeague(options: CreateLivingLeagueOptions): LeagueState {
  const { genesisYears = 5, onProgress, ...createOptions } = options;

  onProgress?.({ step: 'GENERATING_ROSTERS' });
  let league = createLeague(createOptions);

  for (let i = 0; i < genesisYears; i++) {
    onProgress?.({ step: 'SIMULATING_YEAR', year: i - genesisYears, yearsTotal: genesisYears });
    league = simulateSeason(league);
    league = advanceSeason(league);
  }

  onProgress?.({ step: 'FINALIZING' });
  return league;
}
