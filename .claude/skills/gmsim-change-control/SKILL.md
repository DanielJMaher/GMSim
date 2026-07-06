---
name: gmsim-change-control
description: How changes are classified, gated, shipped, and pushed in GMSim. Load before ANY commit, release cut, version bump, tag, push decision, or "is this slice ready to ship?" moment — and before running the full test suite, which is itself a gated action here.
---

# GMSim change control

The unit of work is the **slice**: one shippable behavior change, diagnosed → designed → implemented → validated → released as its own tagged version. Slices ship locally and *batch*; pushing is a separate, human-gated act. This file is the doc of record for the rules that no other doc states.

## When NOT to use this skill

- Evidence standards and which tests/probes count as validation → `gmsim-validation-and-qa`
- CHANGELOG/commit prose style and templates → `gmsim-docs-and-writing`
- Environment or tooling failures while gating → `gmsim-debugging-playbook`

## The change taxonomy

| Level | What it is | Gate | Artifact |
|---|---|---|---|
| Slice | One behavior change (feature, fix, calibration) | Targeted tests + relevant probes/agents green; typecheck | Commits on `main` |
| Release | A finished slice (or a small coherent batch) | Slice gates + CHANGELOG section + lockstep version bump | `chore`/`feat`/`fix` commit + `git tag vX.Y.Z` |
| Push | Publishing accumulated releases to origin | **FULL suite zero-failures + Daniel's explicit call** | `git push` + tags |

Repo-level SemVer (see `CONTRIBUTING.md`): every workspace package shares the root version; MAJOR = save-format break, MINOR = new system (pre-1.0 may break), PATCH = fixes/perf/refactor. Conventional Commits 1.0 with scopes like `engine/cap`, `engine/npc-ai`, `web`, `repo`.

## The four unwritten laws

Confirmed by Daniel 2026-07-04. No other doc states these; they are absolute.

1. **No push and no full-suite gate without Daniel's explicit call.** Sessions ship tagged *local* releases and batch them. As of 2026-07-04 (v0.177.0) three releases sit local: `97cfa81` v0.175.0, `e1e3820` v0.176.0, `231685a` v0.177.0, with origin/main at v0.174.1. "Fire it off", "push", or any push trigger from Daniel activates the push protocol below — nothing else does. Running the ~27-minute full suite uninvited is also a violation: it is his gate to call.
2. **Design before code on vision-central modules.** Modules central to the game's vision (draft, front-office, media voice, the economy) get a *written design* and Daniel's approval before implementation. Precedents: `docs/design-docs/GM_HIRE_FIRE.md` ("design before code", authored 2026-06-11 before the front-office lifecycle shipped); the contract-shape project (2026-07-03) was planned, questioned, and approved before any code. Slices execute scope; they do not invent it.
3. **Never tune to fix a symptom.** No calibration constant changes without a probe demonstrating the *mechanism* first, and never weaken a trigger to make dormant behavior fire. Precedent: v0.172 restructures fired zero times for two releases because no team was honestly cap-pinned — the trigger was deliberately left at 92% ("Don't lower the trigger (fake behavior)"); v0.176's escalating contracts created honest pinning instead. See `gmsim-levers-and-calibration` for the probe-first procedure.
4. **Real-NFL bars are the spec.** Every calibration claim cites a real-data bar (nflverse/OTC data under `packages/truth-arbiter/data/`). "Looks right" is never evidence. Example spec citations from shipped work: #1-overall QB share real bar 75% (nflverse draft_picks.csv 2011-2026); cap growth 6%/yr (2005 $85.5M → 2025 $279.2M CAGR, derived at `SALARY_CAP_ANNUAL_GROWTH` in `packages/engine/src/contracts/constants.ts`).

## The push gate (from CLAUDE.md, with its incidents)

**Never push with any failing test.** Run the full suite and verify the vitest summary shows zero failures BEFORE any `git push` — even failures unrelated to your slice get fixed or reverted first.

Two incidents justify the paranoia:

- **CI was silently dead for 15 straight runs (2026-06-11 → v0.169).** An engine shard outgrew its `timeout-minutes`; GitHub renders a timeout as neutral grey "cancelled", not a red X, and nobody noticed. The fix (`.github/workflows/ci.yml`): 8 shards plus a `ci-green` aggregation job that goes RED unless every job succeeded. Lesson: a gate that can fail invisibly is not a gate.
- **v0.174.0 passed every targeted gate and failed the full gate** (20 tests across 8 files: sub-53 rosters, contract-less players in the FA pool, broken depth charts, a non-empty day-one transaction log). The approach was replaced entirely in v0.174.1 (see CHANGELOG `[0.174.1]`). Lesson: targeted gates ship a slice; only the FULL gate guards a push.

## Checklists

### Shipping a slice
1. Targeted test files for every touched module green (run them yourself; report exact counts).
2. Behavior-level validation where the slice touches league dynamics: relevant truth-arbiter agent(s) with **caches cleared first** (`packages/truth-arbiter/data/goat/`, `data/scorekeeper/` — keyed by seed+years only, they do NOT know the engine changed).
3. `pnpm --filter @gmsim/engine build` (this is the typecheck) and, if types changed, web typecheck too.
4. Inspector refresh check (CLAUDE.md obligation): `Invoke-WebRequest http://localhost:5173/@vite/env -UseBasicParsing` and confirm `__APP_VERSION__` shows the current version.
5. CHANGELOG entry under `## [Unreleased]` with measured numbers.

### Cutting a release
1. Move `[Unreleased]` into a dated `## [X.Y.Z] — YYYY-MM-DD` section.
2. `pnpm version:sync X.Y.Z` (bumps root + all workspace package.json in lockstep; `scripts/sync-versions.mjs`).
3. Commit. **Long messages must use `git commit -F <file>`** — PowerShell 5.1 mangles embedded double-quotes in `-m` here-strings (the message splits into pathspecs, the commit fails, and a `;`-chained `git tag` then tags the WRONG commit; this happened 2026-07-03). Title format: `type(scope): summary (vX.Y.Z)`.
4. `git tag vX.Y.Z`, then verify: `git tag --points-at HEAD` and `git status --short` (clean).

### When Daniel calls the push
1. Run the FULL suite detached (see `gmsim-build-and-env` for the detached pattern; ~27 min as of v0.177.0). Zero failures required — fix or revert anything red, even if unrelated.
2. `git push` then `git push origin <tags>` for each batched tag (tags don't auto-push).
3. Watch CI run to green (`gh run list`, `gh run watch`); the Pages deploy occasionally fails with a transient "Deployment failed, try again later" — just `gh run rerun <id> --failed`.
4. First post-push run only (as of 2026-07-04): download the `vitest-timings-*` artifacts and capture the CI timing baseline per the CLAUDE.md test-timing-audit section.

## Provenance and maintenance

- Unpushed-release state: `git log origin/main..main --oneline` (stated batch is as of 2026-07-04).
- Push-gate text and inspector obligation: `CLAUDE.md` ("Push gate", "Inspector refresh").
- SemVer/commit rules: `CONTRIBUTING.md`.
- ci-green incident: comments in `.github/workflows/ci.yml`.
- v0.174.0 full-gate failure: `CHANGELOG.md` section `[0.174.1]`.
- Restructure dormancy precedent: `CHANGELOG.md` `[0.172.0]` + comments in `packages/engine/src/transactions/restructures.ts`.
- version:sync behavior: `scripts/sync-versions.mjs`.
