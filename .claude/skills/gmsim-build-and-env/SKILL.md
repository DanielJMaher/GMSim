---
name: gmsim-build-and-env
description: Recreate the GMSim development environment from scratch and survive its Windows/PowerShell 5.1/tool-harness traps — install, build, typecheck, test invocation anatomy, the detached-run pattern for anything long, and scratchpad conventions. Load on first contact with the repo, after machine changes, or whenever a command behaves differently than documentation implies.
---

# GMSim build & environment

Target machine (as of 2026-07-04): Windows 11, PowerShell 5.1 as the primary shell (Git Bash available), Node ≥20 (v26 in use), pnpm ≥9 (9.0.0 pinned via `packageManager`). The repo is a pnpm + Turborepo monorepo.

## When NOT to use this skill

- Something is *broken* (not just unfamiliar) → `gmsim-debugging-playbook`
- Running the app/inspector and sim probes → `gmsim-run-and-operate`
- What tests to run for a change → `gmsim-validation-and-qa`

## From zero to working

```powershell
git clone <origin> GMSim; cd GMSim
pnpm install                      # requires Node 20+, pnpm 9+
pnpm build                        # all workspaces in dependency order (engine first)
pnpm typecheck                    # tsc --noEmit everywhere
pnpm --filter @gmsim/engine exec vitest run src/prng/  # smoke: fast, deterministic
```

Layout: `packages/engine` (the game — pure TS), `packages/truth-arbiter` (validation agents + real-NFL data), `apps/web` (inspector), `scripts/` (version sync, timing audit), `docs/` (North Star, Living League, design-doc index).

**The dist gotcha:** probes and truth-arbiter agents import `packages/engine/dist/index.js`, NOT src. After ANY engine edit: `pnpm --filter @gmsim/engine build` — this is also the engine typecheck (plain `tsc -p tsconfig.json`). Forgetting it silently measures old code.

**TS strictness that will bite you** (`tsconfig.base.json`): `noUncheckedIndexedAccess` (indexing returns `T | undefined` — hence the `!` idiom on known-present lookups), `exactOptionalPropertyTypes` (use conditional spread `...(x ? { k: x } : {})`, never `k: undefined`), `verbatimModuleSyntax` (type-only imports must be `import type`), `noUnusedLocals/Parameters`. Engine test files are EXCLUDED from tsc — vitest transpiles without type-checking, so a test can lie about types; keep fixtures honest.

## Test invocation anatomy

```powershell
pnpm test                                              # all workspaces via turbo
pnpm --filter @gmsim/engine exec vitest run <paths>    # targeted files — the workhorse
pnpm --filter @gmsim/engine exec vitest run -t 'name'  # by test-name pattern
pnpm test:monitor                                      # live progress bar + ETA (engine)
pnpm test:timed                                        # full engine suite + timing audit vs baseline
```

Use `pnpm exec vitest` (not `pnpm test -- --flags`): pnpm eats vitest's flags otherwise (this is why CI uses `exec` for `--shard`). Full engine suite: ~27 min wall locally as of v0.177.0 (was 47 before the gate-optimization pass); the longest single file is ~11 min — remember vitest is sequential *within* a file.

## PowerShell 5.1 survival rules

- No `&&` / `||` pipeline chaining; use `;` or `if ($?) { ... }`. No ternary/null-coalescing.
- **Never transform repo files with Get-Content/Set-Content** — BOM-less UTF-8 decodes as ANSI and double-encodes (mojibake). Use node scripts with explicit `'utf8'`.
- **Never pass strings containing double-quotes to native commands inline** (`git commit -m`, `node -e`) — PS mangles them into separate args. Long commit messages: `git commit -F <file>`. Nontrivial node: write a `.mjs` to the scratchpad.
- Here-strings: closing `'@` at column 0.
- `Measure-Object -Line` and split counts disagree on some files; trust editor/Read line numbers.

## The detached-run pattern (mandatory for anything >10–15 min)

The tool harness backgrounds long foreground commands and its watchdog **kills** `run_in_background` tasks after ~15–30 min (full suite, Goatinator, Scorekeeper all exceed this). Run long work detached and watch the log:

```powershell
Start-Process cmd -ArgumentList '/c <command> > "<scratchpad>\run.log" 2>&1' -WorkingDirectory 'C:\Users\danie\dev\GMSim' -WindowStyle Hidden
```

Chain stages inside the one `cmd /c` with `&&` (cmd, not PS, parses it there). Watch for completion by polling the log for a terminal marker (e.g. vitest's `Test Files` line). Killed background runs leave orphan node processes — see `gmsim-debugging-playbook` §1 before killing anything.

## Scratchpad & artifact conventions

- Temp/working files go to the session scratchpad directory the harness announces — never into the repo (stray probe logs in the repo root are historical litter, not a convention to follow).
- `vitest-report*.json`, `.vitest-timings.json`, `.vitest-progress.txt` are gitignored local artifacts.
- `packages/truth-arbiter/data/` is entirely gitignored: real-data caches, agent seed-caches, and `_*.mjs` probe scripts live there untracked — a probe worth keeping gets recorded in CHANGELOG/memory by name, not committed.

## CI shape (mirror of local discipline)

`.github/workflows/ci.yml`: typecheck + build-web + engine tests in 8 vitest shards (45-min cap each) + `ci-green` aggregation (goes red on ANY non-success — timeouts render grey otherwise and once hid 15 dead runs) + advisory `timing-audit` job comparing shard timing reports against `scripts/test-timings.baseline.json` (+25% warns). `deploy.yml` publishes the inspector to GitHub Pages on push; its "Deployment failed, try again later" is a known transient — rerun the failed job.

## Provenance and maintenance

- Node/pnpm floors: root `package.json` `engines` + `packageManager`.
- Turbo task graph: `turbo.json`; workspace list: `pnpm-workspace.yaml`.
- Suite wall-time + slowest files: `node scripts/test-timing-audit.mjs packages/engine/vitest-report.json` after a `pnpm test:timed` run.
- TS strict flags: `tsconfig.base.json`.
- Watchdog/detached lore is environment-observational (dated 2026-07-04); re-confirm before relying on exact kill windows.
