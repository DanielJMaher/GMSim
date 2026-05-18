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

3. **Knowledge-layer separation (North Star).** The engine stores ground truth (`Player`, full ratings, hidden ceilings, scout reliability, etc.). The UI **never reads ground truth directly** — it reads from the knowledge layer in `packages/engine/src/knowledge`, which tags each fact with `{ source_id, confidence, observed_at }`. A React prop typed as `{ speed: 88 }` is broken by definition; it must be a `PlayerSnapshot`-shaped attributed observation. See `docs/NORTH_STAR.md` — the acceptance check at the bottom is the gate.

4. **League-shaped engine API.** All engine functions operate on the entire `LeagueState`. There is no "player team" privilege at the engine level — UI scopes the player's view, the engine doesn't. NPC behavior and player behavior share the same code paths.

5. **32-team scale is foundational.** Every system must run for all 32 teams from its first commit. This is not an optimization pass. See the stress-test checklist in `docs/LIVING_LEAGUE.md`. A "full season league tick" benchmark is intended to be a CI gate (not yet wired up — when adding new engine subsystems, include this in the test plan).

6. **NPC AI is centralized.** All NPC team decisions (draft, trade, FA, hire/fire) route through `packages/engine/src/npc-ai`. Scattering AI logic across feature modules makes "the NPCs feel generic" undebuggable.

### Engine public surface

`packages/engine/src/index.ts` is what "ships" a module — adding an export there makes it part of the public API. Modules without exports there are internal/in-progress.

Subpath exports are configured in `packages/engine/package.json` (`./types`, `./prng`, `./personnel`, `./league`, `./scheme`, `./archetypes`, `./players`, `./contracts`, `./games`, `./season`, `./data`). The web app uses both `@gmsim/engine` (top-level) and `@gmsim/engine/types` (type-only imports).

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
