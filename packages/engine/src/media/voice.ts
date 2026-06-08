/**
 * Living Voice — the voice-seed expression split (Slice B, v0.124).
 *
 * The engine is deterministic from `LeagueState.seed`: same seed → identical
 * players, ratings, measurables, and history. But a player's FACTS and a
 * scout's WORDS are different layers. Slice B decouples the second:
 *
 *   - `seed`       → the WORLD. Players, ratings, draft order, game results.
 *                    Deterministic and reproducible (engine invariant #2).
 *   - `voiceSeed`  → the VOICE. Every word an outlet/scout *says* — template,
 *                    intensifier, comp, phrasing. A separate, independently
 *                    serialized seed so the SAME world can sound different
 *                    every playthrough.
 *
 * Step B converts only the WORDS off `voiceSeed`. Non-voice randomness (which
 * sleepers an outlet champions, which standouts headline) is *selection* and
 * stays on the world seed — that becomes voice-driven in B2 ("opinions too",
 * see LIVING_VOICE.md §10.1).
 *
 * Purity: this module never touches `crypto`/`Math.random`. The app draws real
 * entropy at the UI boundary and passes a random `voiceSeed` into `createLeague`
 * for "alive per playthrough"; engine-only callers (tests) get the deterministic
 * derived default and stay reproducible.
 */

import { Prng } from '../prng/index.js';

/**
 * The deterministic default `voiceSeed` for a world seed. Used when no explicit
 * voice seed is supplied (engine-only callers, tests) and by the save migration
 * to backfill pre-Slice-B saves. Stable: a derived default reproduces the same
 * voice every load — only an *explicit* random `voiceSeed` (the app) varies it.
 */
export function deriveVoiceSeed(seed: string): string {
  return `${seed}::voice`;
}

/**
 * Root PRNG for one filed line of voice. Drawn from `voiceSeed` (NOT the world
 * seed) plus fixed context (season / tick / outlet / player) so each line is an
 * independent stream: two outlets writing the same prospect the same week pick
 * different words, and re-opening a line reproduces it identically (it's derived
 * purely from voiceSeed + fixed context — no shared cursor, per the §11
 * "report is a frozen dated artifact" rule).
 */
export function voicePrng(voiceSeed: string, ...context: Array<string | number>): Prng {
  return new Prng(`${voiceSeed}::voice::${context.join(':')}`);
}
