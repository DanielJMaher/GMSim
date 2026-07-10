---
name: gmsim-architecture-contract
description: GMSim's load-bearing design decisions, the six hard invariants with their rationale and enforcement, the lifecycle spine and its dating semantics, the v0.176 economy contract, and the current known-weak points. Load BEFORE designing any engine feature, adding a module or export, touching LeagueState/types, or wiring any UI surface to engine data.
---

# GMSim architecture contract

GMSim is a pnpm+Turborepo monorepo: `packages/engine` (pure TypeScript sim — the entire game) and `apps/web` (the developer "inspector"). The engine must run unchanged in browser, Tauri, and Capacitor. This file states what must stay true and *why*; violating an invariant is a design bug even if tests pass.

## When NOT to use this skill

- Real-NFL rules the engine models (CBA, cap math, draft economics) → `nfl-domain-reference`
- The catalog of tunable constants and how to change one → `gmsim-levers-and-calibration`
- Why past designs were rejected → `gmsim-failure-archaeology`

## The six hard invariants

| # | Invariant | Why | Enforcement |
|---|---|---|---|
| 1 | **Engine purity** — `packages/engine` imports no DOM, React, Node modules, or anything platform-bound | Same build ships to browser/Tauri/Capacitor; one platform leak forks the build forever | Discipline + review; grep for `window.`, `process.`, `from 'fs'` |
| 2 | **Seeded-PRNG determinism** — all randomness via `packages/engine/src/prng`; saves serialize the seed; the engine reproduces league state from it | Saves are seeds, replays are exact, every bug is reproducible, and every A/B experiment is noise-free | Zero `Math.random` in engine source (as of 2026-07-04: comments only, plus one synthetic-ID helper in `trade/value.test.ts` — test-only); determinism tests in `advance.test.ts`, `re-sign.test.ts` |
| 3 | **Knowledge-layer separation** (North Star) — game UI reads ONLY `engine/src/knowledge` (attributed, source-bylined, qualitative); never ground truth | The entire game concept is playing through imperfect, attributed information (see `docs/NORTH_STAR.md` — its acceptance check is the shipping gate) | Type-level: `ProspectSnapshot` strips numeric/dev fields; `knowledge/snapshot.test.ts` is the leak gate. A React prop typed `{ speed: 88 }` is broken by definition |
| 4 | **League-shaped API** — engine functions operate on whole `LeagueState`; no player-team privilege | NPC and player behavior share code paths, so NPCs can never be second-class (`docs/LIVING_LEAGUE.md`) | Convention + review; UI scopes the player's view |
| 5 | **32-team scale from first commit** | "Optimize later" fails the Living League bar; the sim must feel alive at full scale always | `season/league-tick-benchmark.test.ts` — full league year inside `BUDGET_MS = 240_000` — is a CI gate |
| 6 | **NPC AI centralized** in `engine/src/npc-ai` (canonical or re-exported) | Scattered decision logic makes "the NPCs feel generic" undebuggable | New NPC decision behavior lands in/re-exports through `npc-ai/` in the same slice that creates it |

**The inspector exception:** `apps/web` is the developer calibration lens and deliberately reads ground truth (`ProspectDossier`, perceived/real pairs). CLAUDE.md's standing rule: anywhere the inspector shows a *perceived* grade it must show the *real* one beside it. This does NOT license game UI to do the same.

**North Star acceptance check** (any player-facing surface): (1) does it display a number reflecting engine state directly? (2) does it tell the player something they should have learned by observation? (3) does it attribute every claim to a source? Fail 1 or 2, or miss 3 → it does not ship.

## Module map (packages/engine/src, as of v0.177.0)

`archetypes` (player archetype catalog + scheme fits) · `college-season` (CFB schedule/postseason/stats) · `contracts` (cap math, cash ledger, tiers, rookie scale, constants) · `data` (static data) · `draft` (boards, event, promote, scouting beats, needs) · `games` (drive-sim, strength, box scores) · `knowledge` (the ONLY game-UI read surface) · `league` (generation) · `media` (voice, takes, blurbs, headliners) · `npc-ai` (decision surface) · `personnel` (owners/GMs/coaches) · `players` (skills, aging, abilities) · `prng` · `scheme` · `scouting` · `season` (lifecycle, runner, development, retirement, mood, stats, awards) · `trade` · `transactions` (re-sign, extensions, restructures, FA, cuts, trades, poach) · `types`.

**Public surface rule:** `packages/engine/src/index.ts` is what "ships" a module — an export there is public API. Subpath exports live in `packages/engine/package.json` (`./types`, `./prng`, `./personnel`, `./league`, `./scheme`, `./archetypes`, `./players`, `./contracts`, `./games`, `./season`, `./data`, `./knowledge`, `./npc-ai`). Modules without index exports are internal/in-progress.

## The lifecycle spine (season/lifecycle.ts) — the most load-bearing sequencing in the repo

`tickPhase` walks a date-ordered season timeline (NFL and college weeks interleave by calendar). The offseason phases in execution order: `POST_SEASON_FINALIZE` → `OFFSEASON_TRANSACTIONS` → (college/pre-draft beats) → `PRE_DRAFT` → `DRAFT` → `POST_DRAFT_ROSTER` → `COLLEGE_CYCLE` → `READY_FOR_NEXT_SEASON`. `advanceSeason` is a thin loop over `tickPhase`.

**The dating seam (burn this in):** `POST_SEASON_FINALIZE` increments `league.seasonNumber` to the UPCOMING season, appends the just-played season's `TeamSeasonRecord` dated `history.length + 1` (= seasonNumber − 1 after the roll), and — since v0.176 — grows the salary cap. **Every offseason phase runs post-increment**, so any offseason code reading "last season" from `seasonHistory` must compare against `league.seasonNumber - 1`. The canonical accessor is `lastSeasonWins(team, league)` in `transactions/re-sign.ts`; the v0.154 record-aware QB churn shipped DEAD for ~20 releases because it compared against `seasonNumber` directly (see `gmsim-failure-archaeology`). Never hand-roll this comparison.

**Offseason transaction order inside `applyOffseasonTransactions`** (the real March order — room created early survives into FA): restructures FIRST → re-sign window → contract expirations → cap cuts → proactive trades → NFL scouting cycle → FA refill → minimal cap casualties → practice squad → mood drift → watch lists. **Extensions** run later, at `POST_DRAFT_ROSTER` (roster final at 53). Moving any of these reorders money flows and invalidates calibration.

**PRNG stream isolation:** subsystems draw from named forks (`prng.fork('re-sign-window')`, `'front-office'`, `'draft-round-N'`, `'retirement'`, `'scouting-cycle'`, `'practice-squad'`, `'udfa'`, …) so one subsystem's extra draw doesn't shift another's dice. Within a stream, call ORDER is behavior — a refactor that reorders draws is a behavior change.

## The economy contract (v0.176)

- `league.salaryCap` grows 6%/yr at finalize (`SALARY_CAP_ANNUAL_GROWTH` — the real 20-year CAGR; derivation comment at the constant in `contracts/constants.ts`). `LeagueState.salaryCapBySeason` records each season's cap because the CBA cash floor prices each season against ITS OWN cap.
- **The capRatio pattern:** every pricing anchor is dollars-at-`ANCHOR_CAP` ($255M) scaled by `salaryCap / ANCHOR_CAP` at signing time — FA tier shapes (`FA_DEAL_BY_TIER`), the auction anchor `TIER_STANDARD_Y1` **and its multiplier divisor in lockstep** (or growth compounds twice), `leagueMinimumSalary()`, extension gain floors, restructure floors, the rookie scale. New money code MUST use this pattern or it silently deflates as the cap grows.
- Deals are back-loaded (per-tier escalating `baseShape`; Y1 ≈ 0.88 × APY); STAR deals carry 1 void year; `unamortizedSigningBonus()` (`contracts/cap.ts`) is the single source of truth for dead money on release, trade, restructure fold, and the expiry void charge.
- Cash ≠ cap: `cashSpentBySeason` books at finalize BEFORE the years-remaining decrement (first-year detection is `yearsRemaining === realYears`); restructures are cash-neutral via `signingBonusCashPaid`.

## Save/migration contract

Old saves are healed forward in `season/migrations.ts` (`migrateLeagueForward`, called by `advanceSeason`): each missing field gets a backfill block with a comment naming the version that introduced it. Adding a `LeagueState`/`TeamState` field ⇒ add a migration block in the same slice. Repo-level SemVer: MAJOR = save break (CONTRIBUTING.md).

## Known-weak points (open, as of 2026-07-10 / v0.184.1)

| Weakness | Number | Why it's hard |
|---|---|---|
| W-L pass delta (winners out-pass losers) | 20.8 vs real 9.5 (was 32.8) | The in-slice levers are spent (v0.184 explosive-tail + grind); the measured remainder is garbage-time exposure → the season-wins-sd (talent-spread) slice owns it — see `gmsim-wl-pass-delta-campaign` |
| Season wins sd (talent spread) | 2.6 vs real 3.3 | Too few blowout seasons; now ALSO gates the pass delta — the named next slice |
| W-L rush delta | 54.3 riding the 55 ceiling | Coupled to the RZ run tilt (0.2 = realism cap); any tilt change moves both deltas |
| 4th-down DOWNS share | 2.6% vs real 4.7% | Sim under-goes on 4th; interacts with the punt bar — needs a policy pass, not a knob |
| Restructure activation depth | 0–2 fires / 8 seasons | Honest March pinning is rare; fixing it via a lower trigger is forbidden |
| Top-QB APY stability | 22–26% of cap only when a fresh STAR QB deal exists | The 0.95 extension ceiling blocks pre-expiry franchise-QB re-pricing |
| #2-overall QB share | 39 vs real 44 | Shipped levers provably can't move it (CHANGELOG `[0.167.0]` monotonicity note) |
| In-draft trade-up rate | 4% vs real 16% | Accepted drift since v0.160 |

## Provenance and maintenance

- Invariants text: `CLAUDE.md` "Hard invariants"; North Star check: `docs/NORTH_STAR.md`; stress-test bar: `docs/LIVING_LEAGUE.md`.
- Purity/PRNG: `Grep -c 'Math.random' packages/engine/src` (expect comments/tests only); fork names: `Grep "\.fork\('" packages/engine/src/season/lifecycle.ts`.
- Benchmark budget: `Select-String -Path packages\engine\src\season\league-tick-benchmark.test.ts -Pattern 'BUDGET_MS'`.
- Subpath exports: `packages/engine/package.json` `"exports"` map.
- Offseason order: read `applyOffseasonTransactions` + `applyPostDraftRoster` in `season/lifecycle.ts`.
- Weak-point numbers: latest Goatinator/Scorekeeper runs + CHANGELOG `[0.175.0]`–`[0.177.0]`.
