/**
 * Scout/media read of a player's hidden abilities (v0.102 item 4c).
 *
 * The knowledge-layer bridge: ground truth is the player's LATENT ability
 * (`latentAbilities`), but an evaluator never sees the flag — they form a
 * READ whose fidelity depends on their reliability. A sharp evaluator spots
 * a true standout trait almost every time and rarely invents one; a poor one
 * misses real traits and occasionally hallucinates a flashy one off a few
 * good plays. Consumers (media takes, GM boards, the player UI) render the
 * hedged descriptive phrase (`describeAbilityHint`), never the flag.
 *
 * North Star: this produces a perceived, attributed read — not ground truth.
 */

import type { Prng } from '../prng/index.js';
import { getAbility } from '../players/abilities.js';

export interface AbilityRead {
  abilityId: string;
  /** True = a real latent trait the evaluator correctly spotted. False = a
   *  false flag (the evaluator was fooled). The UI doesn't show this; it's
   *  for the inspector's perceived/real lens and calibration. */
  hit: boolean;
}

// A latent trait is spotted with probability scaling from poor → elite
// reliability; a non-latent trait is (rarely) flagged when reliability is low.
const SPOT_FLOOR = 0.3;
const SPOT_SPAN = 0.65; // reliability 1.0 → ~0.95 spot rate
const FALSE_FLAG_MAX = 0.06; // reliability 0.0 → 6% per eligible non-trait

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Produce an evaluator's read of a player's abilities.
 *
 * @param latentIds   the player's true latent ability ids (0–1 in practice)
 * @param eligibleIds catalog ability ids valid for the player's position
 *                    (the pool a false flag can be drawn from)
 * @param reliability evaluator fidelity in [0, 1]
 */
export function scoutAbilityRead(
  prng: Prng,
  latentIds: readonly string[],
  eligibleIds: readonly string[],
  reliability: number,
): AbilityRead[] {
  const r = clamp01(reliability);
  const reads: AbilityRead[] = [];
  const latent = new Set(latentIds);

  const spotRate = clamp01(SPOT_FLOOR + SPOT_SPAN * r);
  for (const id of latentIds) {
    if (prng.fork(`spot:${id}`).next() < spotRate) {
      reads.push({ abilityId: id, hit: true });
    }
  }

  // X-Factor latent traits are loud — even mediocre evaluators rarely false-
  // flag ON TOP of a real one, so only draw false flags when nothing real
  // was spotted, keeping reads sparse and the signal legible.
  if (reads.length === 0) {
    const falseRate = clamp01((1 - r) * FALSE_FLAG_MAX);
    for (const id of eligibleIds) {
      if (latent.has(id)) continue;
      if (prng.fork(`false:${id}`).next() < falseRate) {
        reads.push({ abilityId: id, hit: false });
        break; // at most one false flag — keeps the read tidy
      }
    }
  }

  return reads.filter((rd) => getAbility(rd.abilityId) !== undefined);
}
