---
name: gmsim-run-and-operate
description: Running GMSim — the inspector dev server (launch, refresh, headless version check, port hygiene, Pages deploy) and the probe workflow for driving the engine headlessly (.mjs against dist, forward-sim recipes, output conventions). Load when you need to SEE or EXERCISE the sim — eyeball a slice, run a probe, check what's deployed.
---

# GMSim run & operate

Two ways to run the thing: the **inspector** (Vite+React dev server — the developer's calibration lens, the only UI that exists) and **headless probes** (`.mjs` scripts driving `packages/engine/dist`). There is no game UI yet; "running the game" means one of these.

## When NOT to use this skill

- Environment setup/build basics → `gmsim-build-and-env`
- The measurement agents with real-NFL bars → `gmsim-diagnostics-and-tooling`
- Inspector shows something WRONG → `gmsim-debugging-playbook` §4

## The inspector

Launch **detached, from the repo root** (backgrounded dev servers get watchdog-killed mid-eyeball; it happened twice on 2026-07-02):

```powershell
Start-Process cmd -ArgumentList '/c pnpm dev' -WorkingDirectory 'C:\Users\danie\dev\GMSim' -WindowStyle Hidden
```

- URL: `http://localhost:5173` (binds all interfaces — reachable on the LAN). Vite auto-increments to 5174+ if 5173 is taken: **never stack servers**; kill listeners on 5173–5190 and relaunch instead.
- **Headless version check** (the badge, without a browser):
  ```powershell
  (Invoke-WebRequest 'http://localhost:5173/@vite/env' -UseBasicParsing).Content | Select-String '__APP_VERSION__'
  ```
  Expect `const defines = {"__APP_VERSION__": "<current version>"}`. Vite dev injects `define`s as globals via `/@vite/env`; served modules keep the bare identifier — that's normal.
- Staleness is largely solved in `apps/web/vite.config.ts` (engine excluded from optimizeDeps; server restarts itself when package.json changes) — a long-lived server stays current; engine changes appear after re-simming in the UI. Hard reset if ever needed: kill 5173–5190, delete `apps/web/node_modules/.vite`, relaunch.
- **CLAUDE.md obligation:** after every slice, confirm 5173 answers with the current version before calling anything eyeball-ready.
- House rule for inspector surfaces: any *perceived* grade shown must show the *real* grade beside it (`perceived / real`); the inspector reads ground truth by design — game UI never will.

## Deploy (the only public artifact)

`.github/workflows/deploy.yml` publishes the inspector to GitHub Pages on every push to main (`pnpm --filter @gmsim/web... build` — the trailing `...` builds the engine first; `base: './'` makes assets subpath-safe). Known transient: `deploy-pages` sometimes fails with "Deployment failed, try again later" — `gh run rerun <id> --failed` fixes it (observed 2026-07-02, 15s on retry).

## Headless probes — the workhorse pattern

A probe is a throwaway-but-recorded `.mjs` in `packages/truth-arbiter/data/` (gitignored) importing the **built** engine:

```javascript
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const dist = resolve(import.meta.dirname, '../../engine/dist/index.js');
const eng = await import(pathToFileURL(dist).href);

let league = eng.createLeague({ seed: 'my-probe-0' });
for (let s = 0; s < 8; s++) {
  const played = eng.simulateSeason(league);   // full year incl. playoffs
  // measure played-state here (stats, usage, logs)
  league = eng.advanceSeason(played);          // full offseason machine
}
```

Rules of the road:
- **Rebuild first**: `pnpm --filter @gmsim/engine build` — probes read `dist/`, and a stale dist silently measures old code.
- Cost model: one season-sim ≈ 17–20 s locally (as of v0.177.0). 8 seeds × 8 seasons ≈ 18 min ⇒ detached (see `gmsim-build-and-env`). Print progress per season so partial output is readable mid-run.
- `eng.tickPhase(league)` steps ONE lifecycle phase — the tool for probing mid-offseason state (e.g. post-finalize dating; the v0.175 investigation used exactly this).
- Useful exported measurers: `teamCapUsage`, `summarizeTeamCap`, `seasonStatsForLeague`, `currentCapHit`, `unamortizedSigningBonus`; the transaction log (`league.transactionLog`) is the event history — filter by `kind` (`'re-sign'`, `'fa-sign'`, `'hc-fired'`, `'restructure'`, `'contract-expiration'`, …). Extension vs re-sign window contracts share kind `'re-sign'` — discriminate by contract-id suffix `_EXT` vs `_RS`.
- Naming: `_snake_case.mjs` with a header comment stating question + usage; take `seeds`/`years` as argv. Existing probes in that directory are the style guide (`_cap_decay.mjs`, `_qb_churn_by_record_sim.mjs`, `_carousel_probe.mjs`, `_contract_shape_probe.mjs`).
- A probe that produced a decision gets its name + numbers into the CHANGELOG entry — the script itself stays untracked.

## What output lands where

- Probe stdout → your detached-run log file (scratchpad).
- Agent seed-caches → `packages/truth-arbiter/data/goat/`, `data/scorekeeper/` (clear after engine changes!).
- Timing reports → `packages/engine/vitest-report*.json` (gitignored); baseline → `scripts/test-timings.baseline.json` (committed).
- Saves: none yet — a "save" is a seed (determinism invariant); the inspector re-sims from seeds.

## Provenance and maintenance

- Inspector mechanics/comments: `apps/web/vite.config.ts`; obligation text: `CLAUDE.md` "Inspector refresh".
- Deploy: `.github/workflows/deploy.yml`.
- Engine exports available to probes: `packages/engine/src/index.ts`.
- Season-sim cost drifts with hardware/engine: re-time with one `simulateSeason` in a scratch probe (stated 17–20 s as of 2026-07-04).
