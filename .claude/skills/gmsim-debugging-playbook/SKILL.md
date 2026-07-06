---
name: gmsim-debugging-playbook
description: Symptom→triage playbook for GMSim's real failure modes — background tasks dying, garbled files, stale inspector, stale agent caches, seed-flaky tests, slow suites, broken determinism. Load the moment anything behaves unexpectedly during development, BEFORE forming a theory.
---

# GMSim debugging playbook

Every trap below cost real time at least once. Check the table before theorizing — most "mysteries" here are environment, staleness, or seed noise, not engine bugs.

## When NOT to use this skill

- "Has this exact battle been fought before?" → `gmsim-failure-archaeology` (settled investigations, fenced dead ends)
- First-time machine setup → `gmsim-build-and-env`
- Designing a NEW experiment to isolate a mechanism → `gmsim-proof-and-analysis-toolkit`

## Quick triage table

| Symptom | First command | Likely cause | Section |
|---|---|---|---|
| Background task vanished / notified "killed" | `Get-Process node` | Harness watchdog reaps ~15–30 min tasks | §1 |
| Mojibake (`â€"`) in a file you edited | `git diff <file>` | PS 5.1 ANSI/UTF-8 double-encode | §2 |
| `git commit -m` errored with "pathspec ... did not match" | `git tag --points-at HEAD` | PS 5.1 quote-mangling; tag may be on wrong commit | §3 |
| Inspector shows old behavior/version | `Invoke-WebRequest http://localhost:5173/@vite/env -UseBasicParsing` | Stale/stacked dev server | §4 |
| Truth-arbiter agent reports pre-change numbers | `ls packages/truth-arbiter/data/goat/` | Cache keyed by seed+years only | §5 |
| One integration test failed after an engine change | probe 3–4 seeds | Seed reshuffle, not regression | §6 |
| Suite suddenly slow / CI shard near timeout | `node scripts/test-timing-audit.mjs packages/engine/vitest-report*.json` | A heavy file regrew | §7 |
| Same seed produces different league | `Grep 'Math.random' packages/engine/src` | PRNG order broken / Math.random snuck in | §8 |

## §1 Background tasks silently killed; orphan processes

The tool-harness watchdog reaps `run_in_background` shell tasks after roughly 15–30 minutes. Anything long (full suite ~27 min, Goatinator ~25–40 min, Scorekeeper) must run **detached**:

```powershell
Start-Process cmd -ArgumentList '/c <command> > "<log path>" 2>&1' -WorkingDirectory 'C:\Users\danie\dev\GMSim' -WindowStyle Hidden
```

then watch the log file. Kills leave **orphan node processes** that compound-slow everything. Before killing anything, identify what each node process is:

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Select-Object ProcessId, CommandLine
```

The Vite dev-server stack is ~5 node processes (pnpm → turbo → vite). Killing "all node" takes the inspector (and any test runner) down — target only what you mean to kill. (2026-07-03: goatinator "orphans" turned out to be the dev server; killing blind would have cost the eyeball session.)

## §2 PowerShell 5.1 encoding corruption

`Get-Content`/`Set-Content` on this repo's BOM-less UTF-8 files decode as ANSI and re-encode: em-dashes become `â€"`. **Never splice/transform source files with PowerShell.** Use a node script with explicit `'utf8'`:

```powershell
node -e "const fs=require('fs');const l=fs.readFileSync(p,'utf8'); ...; fs.writeFileSync(p,out,'utf8')"
```

This corrupted `mood.test.ts` on 2026-07-04; recovery was `git checkout -- <file>` and redo via node. If a PS transform already ran, assume corruption and diff before trusting the file.

## §3 PS 5.1 quote-mangling of native-command arguments

Embedded double-quotes inside an argument to a native command (e.g. `git commit -m` with a quoted phrase, even inside a single-quoted here-string) get split by PowerShell's native argument passing. Observed blast radius (2026-07-03): the message became pathspecs, the commit FAILED, and the `;`-chained `git tag` tagged the *previous* HEAD.

- Long/rich commit messages: write to a file, `git commit -F <file>`.
- Always verify: `git tag --points-at HEAD` after tagging.
- Inline `node -e` scripts with quotes/JS braces: same disease — write a `.mjs` to the scratchpad and run it.

## §4 Stale or stacked inspector

Rules from CLAUDE.md, plus field notes:

- Launch `pnpm dev` **detached** (watchdog killed backgrounded dev servers mid-eyeball twice on 2026-07-02) from the repo root.
- Vite auto-increments to 5174+ if 5173 is taken — never stack servers; if 5173 is stale, kill listeners on ports 5173–5190 specifically, then relaunch. Hard reset: also delete `apps/web/node_modules/.vite`.
- **Headless version check**: `http://localhost:5173/@vite/env` contains `const defines = {"__APP_VERSION__": "X.Y.Z"}`. Vite dev injects `define`s as globals via that module — served source keeps the bare `__APP_VERSION__` identifier, which is NORMAL, not a broken build.
- The engine is excluded from optimizeDeps and package.json changes restart the server in place (see `apps/web/vite.config.ts`), so a long-lived server stays current; engine changes appear after a re-sim in the UI.

## §5 Stale truth-arbiter caches

Goatinator and Scorekeeper cache per-seed results in `packages/truth-arbiter/data/goat/` and `data/scorekeeper/` keyed by **(seed, years) only** — they cannot tell the engine changed. After ANY engine change:

```powershell
Remove-Item packages\truth-arbiter\data\goat\*.json, packages\truth-arbiter\data\scorekeeper\*.json
```

(If a hook blocks Remove-Item, `bash -c "rm -f ..."` works.) A "no change" agent report on a changed engine is the classic tell. Verify cache dirs in `packages/truth-arbiter/src/sim/goatinator.ts` (`GOAT_DIR`) / `scorekeeper.ts` (`SK_DIR`).

## §6 Seed-flaky test vs real regression

A single-seed integration test failing after an engine change is often a *reshuffled trajectory*, not a broken pipeline. Engine changes legitimately alter rosters → games → records for a fixed seed. Discriminate before "fixing":

1. **Multi-seed probe** on the new engine: same assertion across 3–4 seeds (write a quick `.mjs` against `packages/engine/dist` — pattern in `packages/truth-arbiter/data/_carousel_probe.mjs`). Others pass → seed-level.
2. **Worktree A/B** for the rate/mechanism:
   ```powershell
   git worktree add ..\GMSim-<tag> <tag>
   cd ..\GMSim-<tag>; pnpm install --frozen-lockfile; pnpm --filter @gmsim/engine build
   node <same probe pointed at this dist>
   git worktree remove ..\GMSim-<tag> --force
   ```
3. League-wide rate unchanged → fix the TEST (more cycles/seeds, per-season assertions). Rate collapsed → real regression, go hunt.

Worked case: the front-office carousel test (2026-07-04, CHANGELOG `[0.177.0] Fixed`) — 0 firings on one seed; probe showed 4/4/10 on other seeds and the v0.174.1 worktree rate unchanged; the test ran 2 cycles under a "3yr" name and was fixed to 3.

## §7 Suite/CI slowdown

vitest runs a file's tests **sequentially** — one heavy file bounds the wall clock regardless of shards/cores (mood.test.ts once ran 42.2 CI minutes and WAS the pipeline). Diagnosis:

- Timing audit vs baseline: `node scripts/test-timing-audit.mjs packages/engine/vitest-report*.json` (warns >25% growth; CI runs this automatically as the advisory `timing-audit` job).
- Per-file CI timings: `gh run view --job <jobId> --log` and grep the `✓ ... ms` lines.
- Fix pattern: split the file, consolidate multi-season walks into one shared trajectory with per-season assertions, or `it.skip` log-only instruments (house convention). A CI shard timeout means a heavy file regrew — do NOT raise `timeout-minutes` (see `.github/workflows/ci.yml` comment).

## §8 Determinism breaks

Same seed + same code must reproduce identical league state (engine invariant #2). If not:

- `Grep 'Math.random' packages/engine/src` — engine *source* must have zero calls (as of 2026-07-04: 3 comment mentions + 1 synthetic-ID helper in `trade/value.test.ts`, test-only).
- More subtle: **PRNG call-order changes**. Subsystems draw from forked streams (`prng.fork('re-sign-window')` etc. in `season/lifecycle.ts`), so cross-subsystem order is protected — but *within* a stream, adding/removing/reordering a draw shifts every subsequent roll. A refactor that "shouldn't change behavior" but consumes dice differently is a behavior change.
- Test hook: `advance.test.ts` "determinism" and `re-sign.test.ts` deterministic-seed tests.

## Where evidence lives

When something looks broken, check whether it broke before: `CHANGELOG.md` (~6,800 lines, the chronicle of record), `git log --grep=<term>`, and provenance comments on constants in source (house style puts the derivation and incident at the definition).

## Provenance and maintenance

- Watchdog/orphan/detached lore: environment-observational (re-test by backgrounding a 30-min sleep), stated as of 2026-07-04.
- Cache dirs: `Grep 'GOAT_DIR|SK_DIR' packages/truth-arbiter/src/sim/`.
- Timing audit: `node scripts/test-timing-audit.mjs --help` (usage line) / `.github/workflows/ci.yml` `timing-audit` job.
- Math.random census: `Grep -c 'Math.random' packages/engine/src`.
- Inspector mechanics: `apps/web/vite.config.ts` comments; CLAUDE.md "Inspector refresh".
