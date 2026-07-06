---
name: gmsim-validation-and-qa
description: What counts as evidence in GMSim — the gate ladder from targeted tests to the full suite, the test-writing patterns (trajectory tests, integration-shaped regressions, equilibrium gates, instrument skipping), band/threshold discipline, and how to add tests that survive. Load when validating a slice, writing/updating tests, or judging whether evidence is sufficient to ship.
---

# GMSim validation & QA

Evidence here has a ladder, and each rung has a scope: **unit/targeted tests** prove a mechanism, **behavior agents** prove league dynamics, the **full suite** proves nothing else broke — and only Daniel triggers that last one (unwritten law #1). "All my targeted gates passed" is a shipping condition for a *slice*, never for a *push* (the v0.174.0 incident is the standing proof).

## When NOT to use this skill

- Which agent measures what → `gmsim-diagnostics-and-tooling`
- Ship/release mechanics once evidence is in hand → `gmsim-change-control`
- Statistical method for new experiments → `gmsim-proof-and-analysis-toolkit`

## The gate ladder (what to run for a change)

1. **Touched-module test files** — always, with exact counts reported. `pnpm --filter @gmsim/engine exec vitest run src/<module>/`
2. **Neighbor files** for coupled systems (the levers table in `gmsim-levers-and-calibration` names couplings): money changes → contracts/ + transactions/ + `league/generate-cap`; draft changes → `draft/event`, `qb-reach`; season-spine changes → `advance`, `league-tick-benchmark`.
3. **Engine build** (`pnpm --filter @gmsim/engine build`) = typecheck; web typecheck if exported types moved.
4. **Behavior agents** when league dynamics could move (cleared caches!): the family's authority from the fleet table; `run gates` for the cheap broad sweep.
5. **Benchmark** (`src/season/league-tick-benchmark.test.ts`, budget 240s) — on a QUIET machine; it's timing-sensitive, never under sim contention.
6. **Full suite** — Daniel's call only. ~27 min wall detached (as of v0.177.0).

## Test-writing patterns (the house forms)

**Trajectory test** (the preferred multi-season form): ONE shared walk asserting every invariant EVERY season, instead of separate walks with end-state checks. Stronger and cheaper — the 2026-07-04 consolidation cut retirement/advance in half while upgrading point checks to per-season. Canonical examples: `season/retirement.test.ts` "10-season trajectory", `season/advance.test.ts` "6-season trajectory". Use per-assertion messages (`expect(x, 'season 3: ...')`).

**Integration-shaped regression test**: when a bug lived in a SEAM (unit tests passed because they injected the very value the seam corrupted), the regression test must cross the seam for real. Canonical: `transactions/re-sign.test.ts` "lastSeasonWins resolves the just-played season" — simulates a season and runs `tickPhase` through finalize, because the v0.154 damper died exactly there while its unit tests stayed green.

**Equilibrium gate** (for slow one-directional biases): multi-seed × many-season walk asserting a mean stays anchored and tails don't saturate. Canonical: `season/mood-equilibrium.test.ts` (4 seeds × 8 seasons; league mood mean within ±5 of setPoint mean; <2% pegged). Single-season checks cannot catch drift-per-season bugs.

**Seed-robustness rules**: a single-seed assertion on a ramping/stochastic system needs margin — the carousel test failed at 2 cycles with a ≥1 floor purely by reshuffle (v0.177.0 Fixed). Give walks enough cycles for pressure to build, prefer multi-seed for rate claims, and when an engine change flips a seed-sensitive test, discriminate reshuffle-vs-regression FIRST (`gmsim-debugging-playbook` §6).

**Instrument convention**: log-only diagnostics (`expect(true)` endings, console tables) are `describe.skip`/`it.skip` by default with a comment saying when to unskip — precedents in `transactions/proactive-trades.test.ts`, `season/mood-long-horizon.test.ts`, `*.diagnostic.test.ts`. They are probes wearing test clothing; the gate is not their home. (Three of them once cost 21 CI minutes per run.)

**Band discipline**: numeric bands are wide on purpose — they catch *catastrophic drift*, not exact values ("the point is to catch catastrophic drift, not to pin the exact number" — advance.test). Money bands must be **cap-relative** (`avg / league.salaryCap`), never raw dollars: the cap grows 6%/yr, so dollar bands silently tighten until they lapse (two were converted in v0.176). When a band trips honestly and the new value is accepted, the CHANGELOG documents WHY alongside the band change.

**Fixture honesty**: engine tests are excluded from tsc — vitest won't type-check them. Hand-built fixtures must match real dating/semantics (post-finalize shape = `seasonNumber: 2` with history dated 1; cash-floor fixtures need `cashSpentBySeason` ledgers). Copy the shapes from existing tests in the same file.

## Performance budget for new tests

Season-sims cost ~17–20s each; vitest is sequential within a file. Before adding a multi-season test: can an existing trajectory test absorb the assertion? If it needs its own walk, does it belong in its own FILE (parallelism)? The timing audit (`pnpm test:timed`) warns at +25% file growth — a new heavy file shows up as "NEW heavy file (no baseline)". Budget consciously; refresh the baseline deliberately when the growth is accepted.

## The certified inventory (what must stay green, always)

- `knowledge/snapshot.test.ts` — the North Star leak gate (type-level ground-truth stripping).
- `league/generate.test.ts` — birth invariants incl. the hard-cap-at-birth gate (v0.174.0's permanent lesson).
- `season/league-tick-benchmark.test.ts` — the 32-team scale CI gate.
- `season/mood-equilibrium.test.ts` — the saturation regression gate.
- Determinism tests (`advance`, `re-sign`) — the seeded-PRNG invariant.
- The Scorekeeper `pointsDrift` stationarity gate — scoring must not drift over seasons (the v0.165 settlement).

## Provenance and maintenance

- Suite shape/counts: `pnpm test:timed` (134 files as of 2026-07-04, v0.177.0).
- Named canonical tests: verify by opening them; if renamed, update here.
- Band philosophy quotes: comments in `season/advance.test.ts`, `transactions/offseason.test.ts`.
- Benchmark budget: `BUDGET_MS` in the benchmark file.
