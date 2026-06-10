# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

This is a pnpm + Turborepo monorepo. Run everything from the repo root unless noted.

- `pnpm install` — first-time setup. Requires Node 20+ and pnpm 9+.
- `pnpm dev` — run all dev servers (currently just `apps/web` via Vite).
- `pnpm build` — build all workspaces in dependency order.
- `pnpm test` — run vitest across all workspaces.
- `pnpm typecheck` — `tsc --noEmit` across all workspaces. Engine builds first because `apps/web` consumes its emitted `.d.ts`.
- `pnpm lint` — placeholder; ESLint is not wired up yet.

Engine-specific (run inside `packages/engine`):

- `pnpm test` — vitest run.
- `pnpm test:watch` — vitest watch mode.
- Single test: `pnpm test src/path/to/file.test.ts` (or with a pattern: `pnpm test -t 'cap proration'`).

Web-specific (inside `apps/web`):

- `pnpm dev` — Vite dev server.
- `pnpm build` — `tsc -p tsconfig.json && vite build`. CI builds via `pnpm --filter @gmsim/web... build` so the engine is built first; the trailing `...` is required.

Versioning:

- `pnpm version:sync` — print current version of root and every workspace package.
- `pnpm version:sync <new-version>` — bump root `package.json` and every workspace `package.json` in lockstep. Releases require this (see Release workflow in `CONTRIBUTING.md`); root is the source of truth and all packages must stay in sync.

## Architecture

### Monorepo layout

```
packages/
  engine/    pure TS sim engine — the entire game lives here
  (data, shared, ui — planned, not yet present)
apps/
  web/       Vite + React inspector that drives the engine
  (desktop, mobile — planned)
docs/
  NORTH_STAR.md       UI/data philosophy — non-negotiable
  LIVING_LEAGUE.md    32-team scale requirements
  design-docs/        index of Google Drive design docs (Drive is authoritative)
```

Currently only `@gmsim/engine` and `@gmsim/web` exist. The web app is the "inspector" — a single `App.tsx` that imports from the engine to render league state. It is published to GitHub Pages via `.github/workflows/deploy.yml`.

### Hard invariants (enforced by structure, not discipline)

1. **Engine is pure TypeScript.** `packages/engine` must not import DOM, React, Node-specific modules, or anything platform-bound. Same build must run unchanged in browser, Tauri, and Capacitor. If you reach for `fs`, `process`, or `window` inside the engine, stop.

2. **Determinism via seeded PRNG.** All randomness routes through `packages/engine/src/prng`. Saves serialize the seed; the engine reproduces league state from it. Never call `Math.random()` inside the engine.

3. **Knowledge-layer separation (North Star).** The engine stores ground truth (`Player`, full ratings, hidden ceilings, scout reliability, etc.). A *game* UI **never reads ground truth directly** — it reads `packages/engine/src/knowledge` (`prospectSnapshot` → `ProspectSnapshot`): attributed, source-bylined, qualitative knowledge with every dev-only/numeric-rating/band field stripped at the type level (`knowledge/snapshot.test.ts` is the leak gate). A React prop typed as `{ speed: 88 }` is broken by definition. The **inspector is the sanctioned exception** — it reads `ProspectDossier` (perceived/real) as the calibration lens. A player-facing surface that needs more **extends the knowledge module**; it never imports around it. See `docs/NORTH_STAR.md` — the acceptance check at the bottom is the gate.

4. **League-shaped engine API.** All engine functions operate on the entire `LeagueState`. There is no "player team" privilege at the engine level — UI scopes the player's view, the engine doesn't. NPC behavior and player behavior share the same code paths.

5. **32-team scale is foundational.** Every system must run for all 32 teams from its first commit. This is not an optimization pass. See the stress-test checklist in `docs/LIVING_LEAGUE.md`. The "full season league tick" benchmark is a CI gate (`season/league-tick-benchmark.test.ts`, runs in the sharded CI suite) — keep it green when adding engine subsystems.

6. **NPC AI is centralized.** `packages/engine/src/npc-ai` is the canonical, auditable surface for NPC team decisions (draft, trade, FA, hire/fire). Historically the logic grew inside feature modules (`draft/`, `transactions/`); it is re-exported through `npc-ai/` and migrates there opportunistically when a module gets reworked. **New NPC decision behavior lands in (or is re-exported through) `npc-ai/` in the same slice that creates it.** Scattering AI logic across feature modules makes "the NPCs feel generic" undebuggable.

### Engine public surface

`packages/engine/src/index.ts` is what "ships" a module — adding an export there makes it part of the public API. Modules without exports there are internal/in-progress.

Subpath exports are configured in `packages/engine/package.json` (`./types`, `./prng`, `./personnel`, `./league`, `./scheme`, `./archetypes`, `./players`, `./contracts`, `./games`, `./season`, `./data`, `./knowledge`, `./npc-ai`). The web app uses both `@gmsim/engine` (top-level) and `@gmsim/engine/types` (type-only imports).

### Design docs

Authoritative design lives in Google Drive (owner `danieljmaher@gmail.com`). The index with Drive file IDs is in `docs/design-docs/README.md`. **Read the Drive doc just-in-time** when implementing a module — we deliberately do not mirror full docs into the repo (avoids drift). Fetch via the Google Drive MCP tool using the listed file ID. If a design doc and the code disagree, the code is wrong, or the design doc needs explicit revision.

## Conventions

- **TypeScript strict mode** with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `noUnusedLocals`, `noUnusedParameters` all on (see `tsconfig.base.json`). Type-only imports must use `import type`.
- **Tests sit next to source**: `foo.ts` → `foo.test.ts`. Vitest is configured at `packages/engine/vitest.config.ts`.
- **Conventional Commits** with scopes matching the module (`engine`, `engine/cap`, `engine/personnel`, `web`, `docs`, `repo`). See `CONTRIBUTING.md` for the type → version-bump mapping.
- **Repo-level SemVer.** Every workspace package shares the root version. While in `0.x.x`, minor bumps may include breaking changes.
- **Prettier** (`.prettierrc`): single quotes, semis, trailing commas, 100 col, 2-space indent.

## Release workflow (when explicitly asked)

1. Move `CHANGELOG.md` `## [Unreleased]` contents into a new dated section for the new version.
2. `pnpm version:sync <new-version>` to bump all `package.json`s in lockstep.
3. Commit with `chore(release): vX.Y.Z`.
4. Tag `vX.Y.Z`. Don't push tags upstream unless asked.

## Push gate

**Never push to GitHub with any failing tests.** Run `pnpm test` from the
repo root (or `pnpm test` inside the relevant workspace) and verify the
vitest summary line shows zero failures BEFORE any `git push`. This
applies whether the user says "fire it off," "push," or any other push
trigger. If tests are failing — even unrelated to the slice — fix or
revert until the suite is green, then push.

## Inspector refresh (after every slice)

The inspector at `localhost:5173` must show the **current** build after
every slice — verify this automatically, don't wait to be told it's stale.

The two historical staleness causes are fixed in `apps/web/vite.config.ts`
(v0.130.0+): the engine is **excluded from optimizeDeps** (engine edits
hot-update like app source — no more frozen pre-bundle), and a watcher
**restarts the dev server when `package.json` changes** (so the
`__APP_VERSION__` badge follows `pnpm version:sync` automatically). A
long-lived `pnpm dev` now stays current; a browser refresh is usually all
an eyeball needs.

Still required:

1. **No stale sibling servers.** Vite auto-increments to 5174+ if 5173 is
   taken; older-version servers on other ports confuse eyeball
   verification. If 5173 isn't the current build, kill all listeners on
   5173–5190 and relaunch rather than stacking servers.
2. **Launch `pnpm dev` from the repo root** (a background shell may land
   elsewhere — `cd` to the root first), and never kill by "all node
   processes" (that takes the test runner down too) — target the port
   listeners only.
3. **Confirm after each slice** that 5173 answers and reports the
   expected version before declaring it eyeball-ready. If it's somehow
   stale anyway, the old hard-reset still works: kill 5173–5190, delete
   `apps/web/node_modules/.vite`, relaunch.

## Inspector & draft-scouting conventions

These are durable rules, not one-off requests. Apply them anywhere they fit.

1. **Perceived always shows real.** The inspector is the developer's
   calibration lens. Anywhere it surfaces a *perceived* grade (a scouting
   / media / board read), it must show the **real** (ground-truth) grade
   right next to it — a `perceived / real` pair, or a dedicated "Real"
   column. Daniel uses the gap to judge whether the perception layer
   feels right; a perceived number with no reality check is useless to
   him. (This is inspector-only; it does NOT violate the North Star — the
   *game* UI still never reads ground truth.)

2. **Scouting events refine known prospects; they do not discover
   unknowns high on the board.** Real evaluators have a season of tape
   before the offseason. Concretely:
   - **The combine invites ~300–350 already-scouted prospects** (see
     `COMBINE_INVITE_CAP` / `selectCombineInvitees`). A prospect with no
     scouting reads is not invited and therefore cannot vault onto a
     board off a workout. The combine **refines** known names — it never
     introduces an unknown to the board ("Unknown → #75" is a bug).
   - **Pro-day risers are allowed but bounded.** A pro day can move a
     known prospect up, but it cannot lift a previously-unknown prospect
     above roughly #200 on the big board.
   - General principle for any new scouting beat: it adjusts the read on
     prospects already in the evaluation funnel; the funnel only widens
     gradually (small-school tape, all-star invites), never in one jump.
