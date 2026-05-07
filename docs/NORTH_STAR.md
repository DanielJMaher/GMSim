# North Star

Source of truth for tone, philosophy, and player experience. Every system, every UI surface, every algorithm must be checked against this document. If a feature conflicts with North Star, the feature changes — not North Star.

The principles below are extracted from the design corpus (the master reference doc names a "North Star Document" but no standalone Drive file by that name exists; its principles are quoted across the module docs and consolidated here).

---

## 1. Information attribution

Every piece of information shown to the player has a source. There is no omniscient narrator and no "true" stat panel.

- A player's 40 time as reported by the team's lead scout is **not** the same data point as the same 40 time reported by an NFL Network draft pundit. Both may be right, both may be wrong, and the player must learn which sources trend reliable over time.
- "We think this WR runs about a 4.4" is acceptable. "WR has 88 SPEED" is not.
- Source reliability is not displayed numerically. The player builds reliability intuition through pattern recognition over multiple draft cycles, free agency cycles, and seasons.

## 2. Hidden complexity

The mechanical engine is sophisticated. The interface is not.

- Spectrum scores, quirks, hidden ceilings, scheme-fit multipliers, chemistry coefficients — all of these exist in the engine and drive observable behavior. None are ever shown to the player numerically.
- Hidden state surfaces only through observable behavior, statistical results, and media/scout coverage tone.
- An opposing GM's positional bias is discoverable by watching their drafts over multiple years — never displayed.

## 3. Authentic discovery

The player builds a mental model the way a real GM does — through observation, repeated interaction, and accumulated experience.

- The game never summarizes the league. There is no "league overview" screen that lists every team's needs, tendencies, and modifier states.
- The player learns which other GMs overpay in free agency by watching free agency. The player learns which coaches go for it on fourth down by watching games.
- Mastery comes from time in the chair, not from reading a tooltip.

## 4. Descriptive language over numerical certainty

When information must be surfaced in UI, prefer descriptive language with hedging that maps to underlying source confidence.

- "Sources around the building feel he's a system fit" — surfaces a positive scheme-fit signal at moderate confidence.
- "Multiple scouts agree he's the most polished route runner in the class" — high consensus, high confidence.
- "Our area scout has been quiet on him this fall" — neutral signal, possibly negative, attributed to a single source.
- "Film study suggests his production may be system-aided" — flagged concern, single source (post-season film study), specifically per the D/N-01 resolution.

## 5. Source reliability is built, not given

A scout who has been right consistently for three seasons feels more reliable to the player. The game never tells the player which scouts are reliable. Reliability emerges from observation.

- This applies to scouts, coaches' reports, media outlets, agents, and anonymous sources.
- A scout's reliability score exists in the engine. It is **never** displayed to the player.
- This is the load-bearing North Star principle for the entire scouting and media layer.

---

## Engineering enforcement

The North Star is enforced at the architecture level, not via developer discipline.

- **Knowledge layer separation.** The engine stores ground truth. The UI never reads ground truth directly. The UI reads from a knowledge layer that contains only attributed observations: `{ fact, source_id, confidence, observed_at }`. See `packages/engine/src/knowledge`.
- **No raw rating display.** UI components must not accept numerical ratings as props. The shared UI library (`packages/ui`) exposes display primitives that take attributed observations and render descriptive language. A component that takes `{ speed: 88 }` as a prop is broken by definition.
- **Type-level enforcement.** The `PlayerSnapshot` type used by UI is a different type than the `Player` ground-truth record. They cannot be substituted for each other.

## Acceptance check

Before any UI surface ships, ask:

1. Does this surface display a number that reflects engine state directly?
2. Does this surface tell the player something they should have learned through observation?
3. Does this surface attribute every claim to a source?

If 1 or 2 is yes, or 3 is no, the surface fails the North Star check and does not ship.
