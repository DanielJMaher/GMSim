# Changelog

All notable changes to GMSim are tracked here.

Format: [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning 2.0](https://semver.org/spec/v2.0.0.html).
Commit conventions: see [`CONTRIBUTING.md`](CONTRIBUTING.md).

While `0.x.x`, minor bumps may include breaking changes. Save format is not stable.

---

## [Unreleased]

_Nothing yet — next Phase 1 slice (player generation) starts here._

---

## [0.2.0] — 2026-05-07

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

[Unreleased]: #unreleased
[0.2.0]: #020--2026-05-07
[0.1.0]: #010--2026-05-07
