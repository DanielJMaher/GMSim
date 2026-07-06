---
name: gmsim-diagnostics-and-tooling
description: How to MEASURE GMSim instead of eyeballing it — the truth-arbiter agent fleet (Goatinator, Scorekeeper, Liquidator, Headhunter, …) with invocation, cost, cache semantics, and interpretation guides; plus the test-timing audit and live suite monitor. Load whenever validating a slice, investigating a metric, or asked "is the sim realistic?".
---

# GMSim diagnostics & tooling

The house doctrine: **"looks right" is never evidence.** Every league-dynamics claim is measured by an agent or probe against a real-NFL bar. This is the instrument catalog.

## When NOT to use this skill

- Writing a NEW mechanism-isolating probe → `gmsim-run-and-operate` (pattern) + `gmsim-proof-and-analysis-toolkit` (method)
- What thresholds/bands mean pass/fail for shipping → `gmsim-validation-and-qa`
- The real-world numbers themselves → `nfl-domain-reference`

## The truth-arbiter agent fleet

All run from repo root: `pnpm --filter @gmsim/truth-arbiter run <script> [args]` (scripts in `packages/truth-arbiter/package.json`; each `tsc && node dist/...`). Real-bar sides run with no args; `sim <years> <seeds>` adds the GMSim comparison where supported. Self-descriptions live in each file's header — trust those over this table when they disagree.

| Agent | Script | Authority over | Notes (as of 2026-07-04) |
|---|---|---|---|
| **Goatinator** | `goatinator sim 12 32` | Top-of-draft realism: top-10 position mix, #1/#2/#3 QB shares (real 75/44/25), trade-ups, package composition | ~25–40 min detached; seed-parallel workers; **cache `data/goat/` keyed seed+years — CLEAR after engine changes**; flags `<-- DRIFT` per row |
| **Scorekeeper** | `scorekeeper sim 10 12` | Per-game stats & results: points 22.8±10.1, pass yds, W-L pass/rush/giveaway deltas, points season-drift (stationarity gate) | cache `data/scorekeeper/`; the standing W-L pass-delta drift (32.8 vs band ≤32) is the known open problem |
| **Liquidator** | `liquidator [fa]` | Salary-cap/contract realism vs OTC: position salary spread, guarantee structure, seed-contract pricing | derived `POSITION_SALARY_FACTOR`; re-run after market-anchor changes |
| **Magistrate** | `magistrate` | Drive-level realism vs real NFL drive results | game-sim changes |
| **Skill Adjudicator** | `adjudicate` | 8-tier talent-grade distribution (overall + by position), 99-scarcity, accolades | talent/grading changes |
| **Actuary** | `actuary` | Aging/development curves vs real career shapes | development changes |
| **Headhunter** | `headhunter` | HC/GM firing-hiring ecology vs real carousel patterns (~6–7 HC changes/season) | front-office changes |
| **Barterer** | `barterer` | Trade realism (partners, values, frequency) | trade changes |
| **Ombudsman** | `ombudsman` | Media disagreement-spread gradient (real: spread explodes down-board ~6.6×; GMSim ~3.1× — pyramid-bounded, see archaeology) | media changes |
| **Scribe / Narrator** | `scribe` / `narrator` | Scouting-report wording / player-backstory voice | Living Voice work |
| **Truth Arbiter (draft-model)** | `arbiter`, `class`, `outcomes`, `class-talent`, `ras` | Generated draft classes vs the real corpus (talent shape, athletic baselines, outcomes) | generation changes |
| **Star-separation / Conversion** | `star`, `conversion` | Leaderboard separation; ELITE→Pro Bowl conversion under the bottom-up stat engine | stat-engine changes |
| **Gates** | `gates` | **The pre-push drift sweep** — every data-agent guardrail in one pass, quick modes | cheapest broad check |

**Interpretation discipline:** each agent prints real bar vs GMSim vs band, flagging drift. Three response classes: (1) in band → cite the numbers in the CHANGELOG; (2) new drift → STOP, decompose by mechanism before touching levers (law #3); (3) known accepted drift (in-draft trade-ups 4% vs 16% since v0.160; W-L pass delta) → note unchanged, don't re-litigate. Sample size matters: Goatinator #1-pick n=384 at 12×32 (±4–5pp); an 8-seed probe's n=64 is ±12pp — never calibrate on the small one.

**Cost & hygiene:** goatinator/scorekeeper are seed-parallel (`cpus-2` workers, resumable via cache) — run detached; a mid-run kill leaves the cache partially filled, and the next run resumes it (fine) — but a cache from a DIFFERENT engine version is poison: clear `data/goat/*.json`, `data/scorekeeper/*.json` after any engine change.

## Test-suite instrumentation

- **Timing audit (the growth alarm):** `pnpm test:timed` = full engine suite with JSON report + audit vs `scripts/test-timings.baseline.json`; warns when any file/module/total grows >25% over baseline (sub-5s files ignored; baselines keyed ci/local). CI runs it automatically as the advisory `timing-audit` job (`::warning::` annotations + step summary; never blocks ci-green). Refresh deliberately after accepted slowdowns: `node scripts/test-timing-audit.mjs --write-baseline packages/engine/vitest-report*.json`.
- **Live monitor:** `pnpm test:monitor` — progress bar + work-weighted ETA (reads/writes `.vitest-timings.json`, status readable mid-run at `packages/engine/.vitest-progress.txt`). This is UX; the audit is the alarm — different tools.
- **Per-file CI timings:** `gh run view --job <jobId> --log`, grep the `✓ ... ms` lines.

## Ad-hoc probes

For any question no agent answers, write a `_*.mjs` probe (pattern + rules in `gmsim-run-and-operate`). The fleet is the *validation* layer; probes are the *investigation* layer. Decision-driving probes get named with their numbers in the CHANGELOG.

## Provenance and maintenance

- Script list: `packages/truth-arbiter/package.json` `"scripts"`.
- Each agent's contract: its file header (`packages/truth-arbiter/src/**`) — re-read before relying on argument order (`sim <years> <seeds>` verified for goatinator/scorekeeper 2026-07-04).
- Cache dirs: `GOAT_DIR`/`SK_DIR` constants in the agent sources.
- Bands/real bars: printed by each run; do not hand-copy stale ones — rerun the real side (fast, no sim args).
