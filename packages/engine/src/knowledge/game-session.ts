/**
 * `GameLeague` — the opaque league handle, and the small command surface that
 * drives it.
 *
 * ## The hole this closes
 *
 * D1 says the game UI imports `@gmsim/engine/knowledge` and nothing else, and
 * the boundary test enforces it. But D1 only ever discussed *view projections*,
 * and a game does more than read: it has to CREATE a league and ADVANCE it, and
 * those live in `league/` and `season/`.
 *
 * Exposing them through this module naively would quietly reopen the boundary.
 * The game is allowed `@gmsim/engine/types` **type-only**, so it can name
 * `LeagueState`. The moment any knowledge function hands back a real
 * `LeagueState`, game code can write:
 *
 *     const league: LeagueState = newGame({ seed });
 *     const speed = league.players[id]!.current.speed;   // ground truth
 *
 * — and every leak gate in this module is irrelevant, because the UI never had
 * to go through a view at all. The import gate cannot catch it either: the
 * imports are legal.
 *
 * So the handle is **opaque by construction**. `GameLeague` is a branded type
 * with no readable members. The game holds it, passes it back to views and
 * commands, and cannot destructure it — `league.players` is a type error, not a
 * policy violation. That is the North Star's own standard applied one level up:
 * "a React prop typed as `{ speed: 88 }` is broken by definition" works only if
 * the UI cannot obtain the object that has `speed` on it in the first place.
 *
 * Engine-internal callers (tests, the inspector, other engine modules) keep
 * using `LeagueState` directly against the underlying implementations; this
 * wrapper exists solely for the surface `apps/game` consumes.
 */

import type { LeagueState } from '../types/league.js';
import type { TeamId } from '../types/ids.js';
import type { LifecyclePhase } from '../season/lifecycle.js';
import { createLivingLeague, type GenesisProgressEvent } from '../season/genesis.js';
import { tickPhase } from '../season/lifecycle.js';

declare const GAME_LEAGUE: unique symbol;

/**
 * A league, as the game holds it: a handle with no readable fields.
 *
 * Deliberately NOT `LeagueState & {brand}` — that stays structurally readable,
 * which would defeat the whole point.
 */
export type GameLeague = { readonly [GAME_LEAGUE]: true };

/** Engine-side: wrap a real league for the game surface. */
export function asGameLeague(league: LeagueState): GameLeague {
  return league as unknown as GameLeague;
}

/** Engine-side: unwrap inside this module. Never exported to the game. */
export function unwrapGameLeague(handle: GameLeague): LeagueState {
  return handle as unknown as LeagueState;
}

export interface NewGameOptions {
  /**
   * The world seed. Everything reproducible derives from it — which is what
   * makes "replay the same seed" a real triage path (Daniel, 2026-09-12:
   * random seed per run, plus a fixed test-seed button).
   */
  seed: string;
  /**
   * Living Voice seed. Decoupled from `seed` on purpose: the same world can
   * sound different across playthroughs. Defaults to a value derived from
   * `seed`, so omitting it stays fully reproducible.
   */
  voiceSeed?: string;
  /** Seasons of history simulated before kickoff. Defaults to the engine's 5. */
  genesisYears?: number;
  /**
   * Progress callback. Genesis costs roughly 80 seconds, and the engine's own
   * note is explicit that this is a UI-layer concern — a tester staring at a
   * frozen screen is a bug report, so the new-league screen should drive a
   * progress display from this.
   */
  onProgress?: (event: GenesisProgressEvent) => void;
}

/**
 * Start a new game. This is the player-facing path (`createLivingLeague`), not
 * the fast test generator: the league arrives with organic contract ages, dead
 * money and draft-class turnover rather than a pristine year zero.
 */
export function newGame(options: NewGameOptions): GameLeague {
  const opts: Parameters<typeof createLivingLeague>[0] = { seed: options.seed };
  if (options.voiceSeed !== undefined) opts.voiceSeed = options.voiceSeed;
  if (options.genesisYears !== undefined) opts.genesisYears = options.genesisYears;
  if (options.onProgress !== undefined) opts.onProgress = options.onProgress;
  return asGameLeague(createLivingLeague(opts));
}

/** Where the league year currently sits. */
export interface GamePhaseView {
  seasonNumber: number;
  lifecyclePhase: LifecyclePhase;
  /** In-season week, or null outside the regular season. */
  currentWeek: number | null;
  /** The world seed, so the UI can show it — a tester on a random seed has to
   *  be able to tell you which world they were in. */
  seed: string;
}

export function phaseOf(handle: GameLeague): GamePhaseView {
  const league = unwrapGameLeague(handle);
  return {
    seasonNumber: league.seasonNumber,
    lifecyclePhase: league.lifecyclePhase,
    currentWeek: league.currentWeek,
    seed: league.seed,
  };
}

/** The world seed on its own, for the seed display and the bug-report line. */
export function seedOf(handle: GameLeague): string {
  return unwrapGameLeague(handle).seed;
}

/**
 * Advance the league by one lifecycle beat — a week, a playoff round, an
 * offseason event. This is the engine's normal `tickPhase`, so a game-driven
 * league and a test-driven one walk exactly the same path.
 */
export function advance(handle: GameLeague): GameLeague {
  return asGameLeague(tickPhase(unwrapGameLeague(handle)));
}

/** Every club, for the new-game team picker. Identity only. */
export function teamChoices(
  handle: GameLeague,
): readonly { teamId: TeamId; abbreviation: string; fullName: string }[] {
  const league = unwrapGameLeague(handle);
  return Object.values(league.teams).map((t) => ({
    teamId: t.identity.id,
    abbreviation: t.identity.abbreviation,
    fullName: t.identity.fullName,
  }));
}
