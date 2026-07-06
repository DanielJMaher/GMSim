---
name: gmsim-proof-and-analysis-toolkit
description: GMSim's first-principles analysis recipes — decomposition probes, worktree A/B exoneration, monotonicity arguments, equilibrium/steady-state reasoning, channel attribution, and infeasibility proofs — each with a worked example from this repo's history. Load when you need to PROVE a mechanism (not just observe a metric), attribute a regression, or argue a fix is safe before running anything.
---

# GMSim proof & analysis toolkit

"Prove it, don't just install it" here means: before a lever moves, you can state the mechanism, show the decomposition that isolates it, and predict the numbers the change will produce. These are the repo's proven recipes. Determinism (seeded PRNG) is the superpower underneath all of them — identical seeds make every comparison noise-free.

## When NOT to use this skill

- Just running the standard instruments → `gmsim-diagnostics-and-tooling`
- The hunch→result lifecycle and evidence bar → `gmsim-research-methodology`
- Probe mechanics (.mjs patterns, costs) → `gmsim-run-and-operate`

## Recipe 1 — Channel decomposition (attribute before you tune)

*When a composite metric drifts, split it by causal channel and count.*
Method: identify every path that can produce the outcome; write a probe that labels each occurrence with its channel; the counts tell you where the problem lives — often it's "all of them equally," which changes the fix entirely.
**Worked example (v0.175):** #1-overall QB share fell 76→67. The probe `_no1_qb_decomposition.mjs` categorized every non-QB #1 pick by HOW the team's QB got there (contract-id suffixes `_RS` = re-sign window, `_EXT` = extension, else FA/drafted): the result was exactly **4/4/4** across three channels — so the fix had to be a shared record-aware carve-out in all three, not a bigger knob on any one. A tuning-first approach would have overcorrected one channel and missed two.

## Recipe 2 — Worktree A/B (exonerate or convict a release)

*When behavior differs from memory/expectation, run the identical probe on the old code.*
Method: `git worktree add ..\GMSim-<tag> <tag>` → `pnpm install --frozen-lockfile` → build engine → run the same `.mjs` probe against that dist → compare rates, not anecdotes → `git worktree remove ..\GMSim-<tag> --force`. Deterministic seeds make the comparison exact.
**Worked example (v0.177):** the carousel test showed 0 HC firings; the v0.174.1 worktree showed the league-wide firing rate UNCHANGED (18 vs 21 over 4 seeds) — the engine was exonerated, the test convicted (2 cycles under a "3yr" name). Also used at v0.163 to exonerate the realization fix for the scoring residual ("PRE-EXISTING — exonerated by A/B").

## Recipe 3 — Monotonicity / direction arguments (prove safety without running)

*Show that a change can only move a metric in one direction; then one measurement of magnitude suffices.*
**Worked example (v0.167):** the WR need-reach trim could only REDISTRIBUTE #2-overall picks from WR toward QB, never away — so shipping it could not worsen the #2-QB residual; the argument is recorded in CHANGELOG `[0.167.0]` and spared a full re-validation cycle. Use when a residual sits near a band and you must prove your slice doesn't own it.

## Recipe 4 — Steady-state / conservation reasoning (predict equilibria on paper)

*Sum the flows; a stationary population's aggregate is the sum of its inputs — then find why reality deviates.*
**Worked examples (v0.176):** (1) for a stationary roster age-mix, mean cap hit = mean APY regardless of contract shape — so escalators "shouldn't" change usage; the observed sag came from the non-conservation terms (deals dying before their big years, growth outpacing a trailing floor window) — which located BOTH real fixes. (2) The trailing cash-floor window under 6% growth binds at 89%×(mean of older caps)/today ≈ 81% — arithmetic that predicted the measured sag almost exactly. Do this math BEFORE coding; it tells you which residuals are structural.

## Recipe 5 — Infeasibility proof (kill a whole approach class honestly)

*Implement the strongest version of the tempting approach; show its best case still fails; fence it forever.*
**Worked example (v0.165):** the static reconcile for scoring drift (aging-consistent generation + re-baseline) was BUILT and shown insufficient — the developed equilibrium moves season-to-season and QB survivorship is irreducible, so NO static offset can null a season-varying drift. Result: the dynamic `leagueRecenter` fix plus a permanent fence ("drive-sim constants are the wrong lever"). An infeasibility result is a shippable outcome: it converts an infinite tuning swamp into a closed question.

## Recipe 6 — Seam instrumentation (when unit tests pass but reality disagrees)

*Probe the actual integration state at the exact boundary, not the unit in isolation.*
Method: use `eng.tickPhase(league)` to stop the lifecycle at the phase in question and print the raw values both sides of the seam see.
**Worked example (v0.175):** a 20-line probe stepped one `tickPhase` past finalize and printed `lastRecord.seasonNumber` vs `league.seasonNumber` for all 32 teams: 0/32 matched — proving the v0.154 damper had never fired, in one run, before any fix was designed.

## Recipe 7 — Baseline-first measurement (the non-negotiable order)

Every experiment: (1) probe on CURRENT dist and record numbers; (2) write predicted post-change numbers; (3) change; (4) rebuild dist; (5) clear agent caches; (6) re-probe; (7) compare to the PREDICTION. The baseline run also validates the probe itself (a probe first run after the change can't distinguish its own bugs from the change's effects). Small-n honesty: an 8-seed #1-pick probe is ±12pp — use it for mechanism shape, never for calibration verdicts; the 12×32 Goatinator (n=384, ±4–5pp) settles shares.

## Recipe 8 — Real-bar derivation (make the spec before making the change)

When modeling a new phenomenon, derive the real-world table FIRST from the corpus in `packages/truth-arbiter/data/` (games.csv, draft_picks.csv, trades, OTC, pbp-derived artifacts), commit the numbers into the constant's provenance comment, and only then implement. **Worked examples:** the game-script pass-rate table (nflverse pbp 2015–2024, locked into `SCRIPT_*` constants v0.153); cap growth 6%/yr from the 2005→2026 endpoints; `POSITION_SALARY_FACTOR` from OTC top-10 APYs via the Liquidator.

## Provenance and maintenance

- Worked examples anchor to CHANGELOG sections `[0.163]`, `[0.165]`, `[0.167]`, `[0.175]`–`[0.177]` and the named probes in `packages/truth-arbiter/data/` — spot-verify there.
- Probe cost model + patterns: `gmsim-run-and-operate` (17–20 s/season-sim as of 2026-07-04).
- When a new recipe earns its place (used twice with receipts), add it here with its worked example.
