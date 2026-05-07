# Contributing to GMSim

## Versioning

GMSim uses [Semantic Versioning 2.0](https://semver.org/spec/v2.0.0.html) at the **repo level**. All workspace packages share the same version (synced via `pnpm version:sync`); the root `package.json` is the source of truth. Packages aren't published — the version stamp exists to label releases (saves, builds, milestones), not for npm consumption.

```
MAJOR.MINOR.PATCH
```

- **MAJOR** — save-format break (existing saves won't load), or a sweeping engine rewrite.
- **MINOR** — new module shipped (e.g. Trade Module landing). New systems, new UI surfaces.
- **PATCH** — bug fixes, balance tweaks, internal refactors with no save-format impact.

While `0.x.x`, anything goes — minor bumps may include breaking changes. We graduate to `1.0.0` when the game is feature-complete enough to be played start-to-finish without obvious gaps.

## Commit messages — Conventional Commits

Every commit message follows [Conventional Commits 1.0](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>

<optional body>

<optional footer(s)>
```

### Types

| Type | Effect on version | Use for |
|---|---|---|
| `feat` | MINOR bump | A new user-visible feature or system |
| `fix` | PATCH bump | A bug fix |
| `perf` | PATCH bump | A performance improvement |
| `refactor` | PATCH bump | Internal code change, no behavior change |
| `docs` | none | Documentation only |
| `test` | none | Tests only |
| `build` | none | Build system / dependencies |
| `chore` | none | Maintenance, tooling, version bumps |
| `ci` | none | CI/CD changes |
| `style` | none | Formatting, no logic change |

### Scopes (optional but encouraged)

Scope = the package or module. Common scopes:

- `engine` — anything in `packages/engine`
- `engine/personnel`, `engine/draft`, `engine/cap`, etc. — specific engine module
- `data` — anything in `packages/data`
- `web` — anything in `apps/web`
- `docs` — repo docs (NORTH_STAR.md, LIVING_LEAGUE.md, design-docs)
- `repo` — root config, tooling, monorepo setup

### Breaking changes

For any breaking change (currently rare while pre-1.0), append `!` after the type/scope and add a `BREAKING CHANGE:` footer:

```
feat(engine/cap)!: switch contract money to integer cents

BREAKING CHANGE: Existing saves will not load. Migration is not provided.
```

### Examples

```
feat(engine/personnel): generate 32 unique owners with quirks
fix(engine/cap): correct void-year proration when rolling guarantees trigger
refactor(engine/prng): inline cyrb128 to avoid extra hash call
docs(NORTH_STAR): add scout-reliability examples
test(engine/trade): property-test 5-factor evaluator symmetry
chore: bump root version to 0.2.0
```

## Release workflow

1. Make changes; commit with Conventional Commits.
2. When ready to cut a release:
   - Update `CHANGELOG.md` — move the contents of `## [Unreleased]` into a new section dated today, with the new version.
   - Run `pnpm version:sync <new-version>` to bump the root `package.json` and all workspace package.jsons in lockstep.
   - Commit with `chore(release): vX.Y.Z`.
   - Tag: `git tag vX.Y.Z`.
3. Don't push tags upstream until/unless we have a remote. While the repo is local, tags are sufficient for traceability.

## Code style

- TypeScript strict mode (already enforced via `tsconfig.base.json`).
- Prettier formatting (config at `.prettierrc`).
- Pure engine — `packages/engine` may not import DOM, React, Node-specific modules, or anything platform-bound. The engine is designed to run unchanged in browser, Tauri, and Capacitor.
- Tests next to source files: `foo.ts` → `foo.test.ts`.
- See `docs/NORTH_STAR.md` for UI/data architecture rules. The knowledge-layer separation is non-negotiable.

## When in doubt

Read the relevant Drive design doc before writing code. The Drive index is in `docs/design-docs/README.md`. Design intent is authoritative; if a design doc and the code disagree, the code is wrong (or the design doc needs explicit revision).
