# Changelog

All notable changes to GMSim are tracked here.

Format: [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning 2.0](https://semver.org/spec/v2.0.0.html).
Commit conventions: see [`CONTRIBUTING.md`](CONTRIBUTING.md).

While `0.x.x`, minor bumps may include breaking changes. Save format is not stable.

---

## [Unreleased]

_Nothing yet._

---

## [0.7.0] — 2026-05-07

### Added — Phase 2: Retirement + injury propagation

- **Retirement + rookie replacement** (`packages/engine/src/season/retirement.ts`). Age-based retirement rolls in `advanceSeason`: 0% under 34, 5% at 34, 15% at 35, 30% at 36, 50% at 37, 70% at 38, 90% at 39, 100% at 40+. Every retiree's slot is backfilled with a freshly-generated rookie at the same position, weighted by the team's HC scheme. Retirees' contracts are dropped; rookies get fresh rookie-scale contracts (`yearsRemaining = realYears`). Placeholder for the full draft + UDFA pool dynamics that land in Phase 3 (Doc 3).
- **Injury propagation** (`packages/engine/src/season/runner.ts`). `simulateSeason` now copies `GameResult.injuries` onto `Player.injury` after each game so subsequent weeks see updated injury state. A weekly recovery sweep clears injuries whose `estimatedReturnTick` has passed. `advanceSeason` clears every remaining injury — offseason heals.
- **`generatePlayer` extensions.** Two new options for mid-sim generation: `forceAgeStage` (skip the weighted age roll, e.g. for rookie-only generation) and `simYear` (anchor `birthDate` to the current sim year instead of the league epoch). `ageToBirthDate` parameterized accordingly.
- **`generateContract.fresh` option.** When true, sets `yearsRemaining = realYears` and `signedOnTick = currentTick` for brand-new contracts (used by retirement replacement). League-creation default still rolls `yearsRemaining` uniformly so initial contracts look mid-stream.
- **21 new tests** (172 total, 1 skipped harness). Retirement: probability curve invariants, deterministic outcomes, age cap (no one over 40), 53-man roster stability, contract drop on retirement, fresh contracts on rookies. Injuries: end-of-season presence, occurredOnTick within window, estimatedReturnTick after occurredOnTick, intra-season recovery, offseason healing, determinism.
- **Validation harness** rerun: average roster age dropped from ~37 → ~29 across 3 seeds × 10 seasons (NFL-realistic). Skill-bound violations remain 0. Dynasty emergence intact.

### Deferred

- **Playoff injury propagation** is intentionally skipped — injuries during playoffs don't affect anything else this Phase since the season ends right after.
- **Cap discipline.** Auto-renewal placeholder + fresh rookie contracts together push some teams' max cap usage to ~$425M (was $365M). Real free agency / cap mechanics fix this.
- **Real medical staff / IR / multi-week recovery modeling.** Player.injury is a single struct; multiple injuries, treatment, training-staff effects are deferred.

---

## [0.6.0] — 2026-05-07

### Added — Phase 2: Season-end progression

- **Player development** (`packages/engine/src/season/development.ts`). `advancePlayerDevelopment(prng, player, league)` advances one league year of progression: experience years +1; physical, technical, mental, and stable skills evolve at per-stage growth rates (rookie technical/mental gains 6–12 pts/yr, prime gains 1–3 pts/yr, stable traits crawl, physical skills grow only as rookies and decline through veteran/aging stages). Development archetypes (`FAST_LEARNER`, `LATE_DEVELOPER`, `EARLY_BLOOMER`, `SLOW_STEADY`) modulate per-stage growth. Tier is re-derived from new current ratings each year so a developing FRINGE can rise to STARTER.
- **`advanceSeason(league)`** (`packages/engine/src/season/advance.ts`). Run at the end of a played season to produce the next year's offseason: appends a `TeamSeasonRecord` (W-L-T, division finish, playoff outcome — including which round a team lost in if any) to every team's `seasonHistory`, recomputes competitive window from win pct, advances every player via `advancePlayerDevelopment`, decrements every contract's `yearsRemaining`, auto-renews expired contracts at the player's current tier (Phase 2 placeholder for real free agency), increments `seasonNumber` and `tick` by one league-year, clears `schedule`, and flips `phase` to `OFFSEASON_PRE_FA`. Fully deterministic.
- **Web inspector — multi-season simulation.** Replaced the single Simulate Season toggle with a stateful league + Simulate / Advance / +1y / +5y / +10y controls. Header shows current season number and phase. Player ages now track current sim year via `ageOfPlayer()`. Team detail drawer gained a season history table showing W-L, division finish, and postseason result for each prior year. Team cards flag dynasties (3+ playoff appearances or 2+ Super Bowl wins).
- **15 new tests** (151 total, 1 skipped harness). Multi-season determinism (same seed + same advance calls → identical state across teams, players, contracts), age + experience progression invariants, contract decay + expired-contract auto-renewal, season history accumulation, roster size stability across 5+ seasons, cap usage stays in plausible band.
- **Validation harness** (`validate-progression.test.ts`, `describe.skip` by default). Prints multi-season stats — cap drift band, age distribution, dynasty emergence — for hand-eyeing progression changes. Across 3 seeds × 10 seasons: 0 skill-bound violations, dynasties emerge organically (e.g., LAC 4 SBs / 8 playoffs in one seed, GB 2 SBs / 3 playoffs in another), average team cap usage $234M–$261M (cap $255M).

### Deferred

- **Injury propagation** (`GameResult.injuries` → `Player.injury`) lands when stats persistence ships. `advanceSeason` ignores in-game injuries for now.
- **Real free agency.** Auto-renewal at current tier is a placeholder so contracts don't expire into thin air. Replaced in Phase 2 follow-up by the FA market dynamics from Doc 4 / Doc 7.
- **Retirement + draft replenishment.** With no retirement and no draft, rosters age uniformly across multi-season runs (avg 37 after 10 seasons in the validation harness). Both come together in the Player Lifecycle slice.
- **Coaching focus allocation.** Player Development doc's coaching resource interface is skipped; every player gets baseline coaching attention.

---

## [0.5.0] — 2026-05-07

### Added — Phase 2: Game simulation, schedule, season runner, playoffs

- **Game outcome simulator** (`packages/engine/src/games/`). `simulateGame(prng, opts)` produces a `GameResult` with scores, team-game stats (yards, turnovers, sacks, third-down %, red-zone TD %), per-game injuries, and a categorical variance label (controlled / moderate / pure per the Game Sim doc 70/25/5 mix). Logistic conversion of strength delta to win probability calibrated to NFL upset rates (Δ=3 → ~55%, Δ=10 → ~72%, Δ=20+ → 90%+). Home field advantage of 3 strength points; neutral-site flag for the Super Bowl.
- **Team strength calculator.** Single-number derivation from roster talent (top players weighted by position group: QB 35%, OL 15%, DL/DB/SKILL 12% each, LB 10%, ST 4%) + average scheme fit + coaching contribution + organizational stability.
- **Schedule generation.** 17 weeks × 16 games per week = 272 games; every team plays exactly 17 games. Pair-meeting cap of 2 enforced. Phase 2 takes the always-succeeds path: random perfect matchings each week with a soft-penalty retry against over-met pairings. NFL formula precision (division doubling, cross-conference rotation) deferred to a later refinement.
- **Season runner.** `simulateSeason(league)` returns a new league with `schedule.regularSeason` fully played, then runs the playoff bracket and populates `schedule.playoffs`. Deterministic for the same league + seed.
- **Playoffs.** Top 4 division winners (seeds 1-4) + 3 wildcards (seeds 5-7) per conference. Wild Card (3 games per conf, seed 1 bye) → Divisional (2 per conf, top seed hosts lowest remaining) → Conference Championship → Super Bowl (neutral site). Champion crowned in `playoffs.championId`.
- **Standings module.** `computeRecords`, `sortByRecord`, `divisionStandings`, `playoffSeeds`. Tiebreaker ladder: win % → division win % → conference win % → point differential → team ID.
- **Injury simulation.** Per-position per-game injury rates calibrated against the Game Sim doc's season rates (RB 1.1%/game ≈ 17% per season; LB 0.8%/game ≈ 13% per season; QB 0.3%/game ≈ 5% per season). Severity distribution 50/35/15 minor/moderate/major, with weeks-out ranges that match the doc.
- **Inspector — season view.** New "Simulate Season" button; when active, every team card shows W-L record; team detail header shows season record; a new top-level Season Results panel shows champion, both conferences' playoff seeds, and division standings.
- **24 new tests** (160 total). Game determinism, score plausibility, home-field advantage statistical signal across 400 trials, neutral-site removal of HFA, schedule validity (17 games/team, no team plays twice in a week, no pair >2 meetings), season runner integration (every game played, records sum to 17, league-wide W = L), playoff structure (3+2+1 per conference + 1 SB, every game played, champion crowned).

### Added — Phase 1: Contracts + Salary Cap accounting

- **Contracts module** (`packages/engine/src/contracts/`). Generates a contract for every player at league creation, tier-sized: STAR gets 4-year deals with $18-38M signing bonus + $8-14M base salary; STARTER gets 3-4 year mid-market deals; BACKUP gets 2-3 year minimum-plus deals; FRINGE gets 1-2 year vet-minimum deals. Contracts include realistic guarantee tapers (year 1-2 of star deals fully guaranteed, later years injury-only or non-guaranteed).
- **Cap accounting helpers**: `signingBonusProrationPerYear`, `capHitForYear`, `currentCapHit`, `teamCapUsage`, `summarizeTeamCap`, `deadMoneyOnPreJune1Release`. Implements NFL proration math (signing bonus spread evenly across contract length, capped at 5 years; void years extend the proration window).
- **`createLeague` extended** to populate `LeagueState.contracts` and assign every Player.contractId. League-wide contract count = league-wide player count = 1,696. Same seed reproduces identical contracts down to per-year base salaries.
- **`Player.tier`** is now a first-class field on the Player type, set at generation and used by contract generation. Avoids the boundary-drift problem of re-deriving tier from current skills.
- **Inspector cap displays.** Each team card now has a current-year cap usage bar (over-cap teams flagged in red); team detail drawer shows cap-vs-ceiling delta and per-player current-year cap hit + years remaining in each row of the position-group tables.
- **23 new tests.** Cap math (proration, capHitForYear over years 0..N+1, currentCapHit derivation, dead money on release), contract determinism, contract length matches tier template, league-wide cap usage stays within plausible NFL range, total contract count matches player count.

### Fixed

- **Skill-roll formula tier-separation bug.** Previous formulation `weightedMean = min(95, ceilingBaseline × weight)` saturated at 95 for any (tier, weight) pair where `tier_baseline × weight ≥ 95`, making STAR and STARTER players' weighted skills indistinguishable. Replaced with linear bias: `weightedMean = ceilingBaseline + (weight - 1) × 7`, clamped to [25, 99]. Tier separation now holds across all skills, which in turn produces realistic cap distributions (avg ~$235M per team under a $255M cap rather than the previous $880M+ runaway).

### Added — Phase 1: Scheme Identity, Player Archetypes, and Roster generation

- **Scheme Identity module** (`packages/engine/src/scheme/`). Per-scheme metadata for all 7 offensive schemes (West Coast, Air Raid, Pro Style, Run-Heavy, Spread, RPO-Based, Multiple/Hybrid) and 6 defensive schemes (4-3, 3-4, Nickel-Heavy, Cover 2 Shell, Aggressive Blitz, Hybrid Multiple): philosophy, pace, pass/run balance, pressure rate, coverage shell, real-world coordinator examples.
- **Player Archetype catalog** (`packages/engine/src/archetypes/`). 33 archetypes across QB/RB/FB/WR/TE/OL/DL/LB/DB/ST. Each defines compatible positions, scheme-fit multipliers per scheme (e.g., `QB_DUAL_THREAT` is +70% in RPO and -30%-40% in traditional pocket schemes per the Player Archetypes design doc), and skill-priority weights used for skill rolling.
- **Scheme fit calculator** (`packages/engine/src/scheme/fit.ts`). `schemeFitForPlayer(player, { offensiveScheme, defensiveScheme })` returns the fit multiplier — pure data lookup, fast, deterministic. Used downstream by trade evaluation, performance calc, free agency targeting.
- **Player generation** (`packages/engine/src/players/`). `generatePlayer(prng, opts)` produces a fully-populated Player: archetype-weighted by team scheme, age-cohort distribution (rookie/developing/prime/veteran/aging weighted 10/20/50/15/5%), talent tier (star/starter/backup/fringe weighted 5/35/40/20%), hidden current and ceiling skill ratings (gaussian rolls biased by archetype skill weights × tier baseline × age realization curve), and a development archetype.
- **Skill realization model.** Physical skills (speed, strength) barely grow after entering NFL per the Player Development design doc; technical and mental skills grow substantially through prime; rookies have meaningful current-vs-ceiling gaps in technical/mental categories. Veteran players show physical decline but retain technical mastery.
- **Roster generation** (`generateRoster`). 53-player roster blueprint (3 QB / 3 RB / 1 FB / 6 WR / 3 TE / 10 OL / 8 DL / 6 LB / 10 DB / 3 ST) with scheme-weighted archetype selection so RPO teams cluster around dual-threat QBs, 3-4 teams have more nose tackles, Vic Fangio-style defenses end up with more zone-coverage corners, etc.
- **`createLeague` extended.** Every team now has a fully populated 53-man roster with players in `LeagueState.players` (1,696 players league-wide) and player IDs on `TeamState.rosterIds`. Same seed produces an identical league down to every skill rating.
- **24 new engine tests.** Player determinism, archetype validity per position, current-never-exceeds-ceiling invariant across 100 trials, age-distribution shape, scheme-fit math, scheme-skewed roster archetype distribution (RPO vs Air Raid produces statistically different QB archetype mixes), full-league roster integration, roster-wide scheme-fit averages.
- **Web inspector — roster drawer.** Click any team card to open a per-position-group roster table showing name, age, archetype label, average key-skill (current and hidden ceiling), and per-player scheme-fit multiplier with extremes color-coded.

### Changed

- **`Player.archetype` typed strictly.** Promoted `ArchetypeId` from a string to a literal union in `types/player.ts` so player records can't carry stale archetype IDs. Archetype catalog re-exports the type to avoid duplication.
- **Engine subpath exports.** Added `@gmsim/engine/scheme`, `@gmsim/engine/archetypes`, and `@gmsim/engine/players` for scoped imports.

[Unreleased]: #unreleased
[0.5.0]: #050--2026-05-07
[0.4.0]: #040--2026-05-07
[0.3.0]: #030--2026-05-07

### Added — Phase 1: Personnel Generation slice

- **Owner / GM / Head Coach generation** (`packages/engine/src/personnel/`). Each role samples an archetype with probable spectrum ranges, rolls spectrum scores within those ranges, picks 2-4 quirks from a role-specific pool, and rolls six gaussian-biased personality traits. Identical seeds produce identical personnel (deterministic via the seeded PRNG with stable forks per sub-system).
- **Hiring tendency logic.** GM archetype probability is weighted by owner profile (analytics-leaning owners gravitate toward Analytics Architects; spendthrift + low-knowledge owners produce Cap Disasters; impatient owners produce Win-Now Aggressors; etc.). HC archetype probability is similarly weighted by combined owner + GM profiles.
- **Scheme assignment.** Head coaches receive an offensive scheme (West Coast / Air Raid / Pro Style / Run-Heavy / Spread / RPO / Hybrid) and defensive scheme (4-3 / 3-4 / Nickel-Heavy / Cover 2 Shell / Aggressive Blitz / Hybrid). Assignment is biased by the coach's offensive-defensive identity spectrum and archetype (innovators favor RPO/Spread; rigid coaches over-index on Pro Style / Power).
- **Fan-base profile generation** (`fan-base.ts`). Each market size has baseline ranges per L/L-01 resolution (Large markets less patient + more analytics-aware, Small markets more loyal + more traditional). Franchise history archetypes apply additive modifiers (Lovable Loser +3 patience, Recent Dynasty +2 urgency, etc.). All values clamped to [1, 10].
- **Team Personality formula** (`team-personality.ts`). Implements the L/L-01 weighted blend (50% Owner + 20% GM + 20% HC + 10% Fans) across all six dimensions: risk tolerance, analytics orientation, patience, financial aggressiveness, championship urgency, and organizational stability. Each dimension averages multiple component spectrums per the spec before blending.
- **`createLeague(seed)` entry point** (`packages/engine/src/league/`). Generates all 32 teams' personnel + Team Personalities + fan bases + initial competitive windows from a single seed. Output is a fully-populated `LeagueState` ready for downstream system consumption.
- **Phase 1 web inspector.** Replaced the Phase 0 placeholder with a dev-only view that surfaces every team's owner/GM/HC/quirks/scheme/Team Personality, with a re-rollable seed input and a league-wide distribution summary that flags any L/L-01 constraint violations (>4 teams at a dimension's extreme).
- **42 new engine tests.** Owner/GM/HC determinism, archetype range respect, quirk distribution, hiring tendency statistical signal (analytics owners → analytics GMs is detectable; meddler owners → old-school GMs is detectable), Team Personality math (owner extreme dominates, involvement+ego pull stability down), fan-base modifiers, and full-league determinism + uniqueness + L/L-01 distribution constraints across 50 seeds per dimension.

### Changed

- **Collapsed `@gmsim/data` into `@gmsim/engine`** (`packages/engine/src/data/`). The split was speculative and created a cyclic workspace dependency once the engine started consuming static team identity data. Static reference content (32 NFL teams, name pools) is now an internal engine concern, exposed via the `@gmsim/engine/data` subpath export. `@gmsim/data` package was deleted.

### Notes

- Per design doc, **all spectrum scores, quirks, and personality traits are hidden from the player.** The current web view exposes them because it's a dev verification tool, not a player-facing surface. The Phase 4 Scouting Report UI/UX module will replace the inspector with attributed observations per North Star.
- The `OWNER_ARCHETYPES` / `GM_ARCHETYPES` / `HC_ARCHETYPES` catalogs are an initial designer-defined set fulfilling the Personnel Generation doc's open thread on "realistic spectrum range constraints per archetype category." They are tunable; the hiring weights are likewise tunable in `gm.ts` and `hc.ts`.

---

## [0.1.0] — 2026-05-07

### Added

- **Monorepo scaffolding.** pnpm workspaces + Turborepo, three publishable packages (`@gmsim/engine`, `@gmsim/data`, `@gmsim/web`), shared TypeScript config, Prettier + EditorConfig.
- **Engine type system** (`packages/engine/src/types`) covering `LeagueState`, `TeamIdentity`, `TeamState`, `Player`, `Owner`, `Gm`, `HeadCoach`, `Contract`, `TeamPersonality`, plus branded ID types (`TeamId`, `PlayerId`, etc.) and stable string-literal enums for divisions, positions, market sizes, scheme archetypes, franchise histories, and competitive windows.
- **Seeded PRNG** (`packages/engine/src/prng`) — sfc32 algorithm with cyrb128 seed mixing. Supports `next/nextInt/nextRange/pick/shuffle/weighted/gaussian/normal`. Independent forks via `fork(label)` so subsystem changes don't shift random outcomes elsewhere. Serializable for save/load.
- **All 32 NFL teams** (`packages/data/src/team-base/teams.ts`) with conference, division, and market-size classification matching the design doc requirement (8 LARGE / 14 MEDIUM / 10 SMALL).
- **Web app shell** (`apps/web`) — Vite + React 18 + Tailwind. Renders a deterministic PRNG self-check and the league grouped by division as a sanity check that engine + data + UI wiring all resolve.
- **Anchor docs** — `docs/NORTH_STAR.md` (information attribution, hidden complexity, authentic discovery) and `docs/LIVING_LEAGUE.md` (32-team simultaneous simulation, NPC AI requirements, stress-test checkpoints).
- **Design docs index** — `docs/design-docs/README.md` lists all 17 module docs + 2 anchor docs + 2 resolution docs + 4 research docs with their Drive IDs, organized by implementation phase.
- **Test suites.** `@gmsim/engine` has 10 PRNG tests (determinism, fork independence, serialize/deserialize round-trip, statistical weighting, property-based bounds checks via fast-check). `@gmsim/data` has 5 tests asserting team count, conference split, division balance, market-size distribution, abbreviation uniqueness.
- **Versioning workflow** — Conventional Commits convention documented in `CONTRIBUTING.md`; this changelog; `scripts/sync-versions.mjs` for in-sync bumping across all workspace packages.

### Notes

- No game logic yet. This is scaffolding only — the goal of Phase 0 was to lock the architecture so Phase 1 can implement game systems against stable seams.
- Real NFL team names are used because the project is single-player and internal. If distribution scope ever changes, `packages/data/src/team-base/teams.ts` is the only file affected.
- North Star compliance is enforced at the type level: ground-truth `Player` records are not interchangeable with the (not-yet-built) UI snapshot type. The knowledge layer (`packages/engine/src/knowledge`) is empty but reserved.

[0.2.0]: #020--2026-05-07
[0.1.0]: #010--2026-05-07
