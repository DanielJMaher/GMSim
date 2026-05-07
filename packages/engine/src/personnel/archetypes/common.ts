/**
 * Archetype categories per the Personnel Generation System design doc.
 *
 * From the design doc:
 *   "Archetypes are not characters — they are the raw material the
 *    generation system draws from to create unique individuals every time.
 *    The archetype category sets the probable range — it does not fix the
 *    score."
 *
 * So an archetype here is a *spectrum range descriptor* + label, not a
 * pre-baked individual. Generation rolls within these ranges to produce
 * one unique Owner/GM/HC, then layers quirks and personality traits on
 * top for further variation.
 *
 * Archetype labels are internal — they are never shown to the player.
 * Players learn organizational personality through observed behavior,
 * not labels (see docs/NORTH_STAR.md).
 */

/**
 * Inclusive [min, max] range for a spectrum score, both endpoints in [1, 10].
 */
export type SpectrumRange = readonly [min: number, max: number];

export const FULL_RANGE: SpectrumRange = [1, 10];

/**
 * An archetype constrains a subset of spectrums to specific ranges.
 * Spectrums not listed in `ranges` roll over the full [1, 10] range.
 *
 * @template TSpectrumKey  Keyof the relevant spectrum interface
 *                         (OwnerSpectrums, GmSpectrums, HcSpectrums).
 */
export interface Archetype<TSpectrumKey extends string> {
  /** Stable ID used internally; never displayed to the player. */
  readonly id: string;
  /** Human-readable label for debugging/diagnostics. Never displayed in-game. */
  readonly label: string;
  /** Per-spectrum probable range. Spectrums omitted use FULL_RANGE. */
  readonly ranges: Partial<Record<TSpectrumKey, SpectrumRange>>;
}
