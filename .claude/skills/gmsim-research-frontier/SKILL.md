---
name: gmsim-research-frontier
description: The open problems where GMSim can advance the state of the art in sports simulation — living-league emergence, information-asymmetry gameplay, statistical indistinguishability — each with why current sims fail, GMSim's specific asset, the first three concrete steps in this repo, and a falsifiable result milestone. Load when picking ambitious next work, framing the project externally, or judging whether an idea is frontier-grade or maintenance.
---

# GMSim research frontier

Daniel's ranking (2026-07-04): **(1) living-league emergence, (2) information-asymmetry gameplay, (3) statistical indistinguishability** — with 3 as the foundation the other two stand on. A frontier item is only "in progress" once it has a probe and a falsifiable milestone; until then it's an idea. Nothing below may be claimed externally before its milestone is measured (no-oversell law).

## When NOT to use this skill

- Executing the current hardest LIVE problem → `gmsim-wl-pass-delta-campaign`
- The discipline for turning any of these into accepted results → `gmsim-research-methodology`

## Frontier 1 — Living-league emergence (ranked #1)

**Why current SOTA fails:** commercial sports sims (franchise modes, text sims) produce statistically plausible seasons but *interchangeable* leagues — NPC organizations are parameter noise around one rational optimizer, so no run develops eras, dynasties with causes, scheme fads, or cursed franchises anyone can narrate. Emergence is faked with scripted "storylines," which is the opposite of emergence.

**GMSim's specific assets:** (a) organizational personality as a computed, evolving state (Owner 50/GM 20/HC 20/Fan 10 — `docs/LIVING_LEAGUE.md`) driving DECISIONS through one auditable surface (`npc-ai/`); (b) generational-change cascades as a design contract; (c) determinism — an emergent era can be *replayed and dissected* seed-exactly, which no commercial sim can do; (d) the truth-arbiter harness, which can measure distributional signatures of emergence instead of eyeballing anecdotes.

**First three steps in this repo:**
1. Write `_era_signature_probe.mjs`: 30-season runs × N seeds measuring dynasty statistics (title concentration, playoff-streak length distribution, HC-tenure tails, franchise win-% autocorrelation over 5-season windows) — and the same table from real NFL history (1990–2025) as the bar.
2. Test the null: does today's engine already produce real-shaped dynasty concentration, or does parity wash everything to the mean? (Prediction to write down first — see methodology.)
3. Identify the shortest-path coupling that real leagues have and GMSim may lack (e.g. sustained QB advantage × front-office stability feedback), probe its strength in both.

**You have a result when:** a 30-season GMSim league's era-signature table (concentration, streaks, tenure tails) sits inside real-history bands WITHOUT any storyline scripting — and a named, seed-replayable dynasty can be causally traced through the transaction log (why THIS team stayed on top). Falsifier: if matching concentration requires injecting scripted events, the emergence claim dies.

## Frontier 2 — Information-asymmetry gameplay (ranked #2)

**Why current SOTA fails:** every mainstream sim shows true ratings (or thinly veiled letter grades). "Scouting" is a fog-of-war progress bar that converges to truth. No shipped sports game makes *source reliability itself* the learned skill — the thing real GMs actually do.

**GMSim's specific assets:** the North Star architecture is already load-bearing — ground truth is type-sealed away from game UI (`engine/src/knowledge`, leak-gated by `knowledge/snapshot.test.ts`); scouts/media have modeled reliability, bias, and voice (Scribe/Narrator/Ombudsman agents police their realism); the inspector's perceived/real pairing is a built-in calibration instrument for perception-vs-truth distance.

**First three steps in this repo:**
1. Define the measurable: "source-reading skill is learnable" ⇒ a policy that weights sources by observed track record must beat a trust-everyone policy. Write `_source_learnability_probe.mjs`: simulate draft cycles, compare prospect-evaluation error of (a) naive consensus vs (b) reliability-weighted hindsight weighting. The GAP is the learnability signal the game design needs.
2. Sweep the reliability-variance lever: how much scout/outlet quality spread makes the gap large enough to matter but small enough that consensus isn't useless (the playability window).
3. Extend the knowledge layer with the first *longitudinal* source-memory surface (per-source track record as attributed observations — never a number shown to the player), per North Star §5.

**You have a result when:** the probe shows a reliability-aware policy beats naive consensus by a stable, tunable margin across seeds — i.e. the information game has a measurable skill ceiling — while every UI surface still passes the North Star acceptance check. Falsifier: if weighting by track record barely beats consensus at any playable variance, the core loop premise needs redesign.

## Frontier 3 — Statistical indistinguishability (ranked #3, the foundation)

**Why current SOTA fails:** sims match headline averages but leak at the joints — cross-metric coherence (the W-L pass delta is exactly such a joint), distribution tails, season-over-season stationarity, and market/output coupling (cap spend vs on-field results).

**GMSim's specific asset:** the truth-arbiter fleet already measures ~a dozen realism authorities against open real corpora, with bands and drift flags — most sims have zero such harness. The near-term frontier work IS the residual list: the pass delta (campaign skill), restructure March-pinning depth, top-QB APY stability, #2-QB share.

**First three steps in this repo:**
1. Execute `gmsim-wl-pass-delta-campaign` (the biggest known joint-leak).
2. Build the "Turing table": one consolidated report of every agent's real-vs-sim rows — the project's indistinguishability scorecard (`run gates` is the seed of this; extend it to emit a single table with pass/drift counts).
3. Add one NEW joint each cycle (e.g. per-team season W-L autocorrelation; injury-adjusted production curves via the Actuary) — the scorecard should grow columns, not just stay green.

**You have a result when:** a domain-literate reader given matched real and GMSim tables (same format, same era length) cannot reliably pick the sim — operationalized as: zero DRIFT rows across the full fleet at standard n, sustained across 3 consecutive releases. Falsifier: any standing drift row (today there are two: pass delta, in-draft trade-up rate).

## Prioritization guidance

Foundation residuals (frontier 3) outrank new emergence probes when they share mechanisms — the pass delta IS a game-script/coupling question that emergence work would inherit. But per Daniel's ranking, an emergence-signature probe (frontier 1, step 1) is legitimate ambitious work TODAY: it's read-only instrumentation, cheap to start, and its result shapes years of design.

## Provenance and maintenance

- Ranking + definitions: Daniel, 2026-07-04 (this file is the record).
- Assets cited: `docs/NORTH_STAR.md`, `docs/LIVING_LEAGUE.md`, `knowledge/snapshot.test.ts`, `packages/truth-arbiter/`.
- Residual list freshness: latest CHANGELOG sections + agent runs; update the frontier-3 step list as residuals close.
- Probes named here do not exist yet (2026-07-04) — they are the specified first steps; remove the "first steps" once shipped and replace with the measured status.
