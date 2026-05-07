# GMSim

Authentic NFL GM simulator. Single-player. Web-first, with desktop (Tauri) and mobile (Capacitor) shells planned.

## Status

Phase 0 — scaffolding. No game logic yet.

## Structure

```
packages/
  engine/    pure TS sim engine (no DOM, no React)
  data/      static reference content (schemes, archetypes, base teams)
  shared/    types, constants, North Star helpers
  ui/        shared React components (added in Phase 2)
apps/
  web/       Vite + React app (Phase 0+)
  desktop/   Tauri shell (Phase 5)
  mobile/    Capacitor shell (Phase 5)
docs/
  NORTH_STAR.md
  LIVING_LEAGUE.md
  design-docs/   mirrors of Drive design documents
```

## First-time setup

Requires Node 20+ and pnpm 9+.

```
pnpm install
pnpm dev
```

## Architecture invariants

1. **Engine is pure TS.** No DOM imports, no React imports, no platform-specific APIs. Same engine builds run in browser, Tauri, Capacitor.
2. **Determinism.** All randomness routes through the seeded PRNG in `packages/engine/src/prng`. Saves serialize the seed; the engine reproduces league state from it.
3. **Hidden state, attributed surface.** Engine stores ground truth. UI only ever reads from the knowledge layer (`packages/engine/src/knowledge`), which tags every fact with source + confidence + observed_at. See `docs/NORTH_STAR.md`.
4. **All systems scale to 32 teams.** No system is complete until validated to run for all 32 teams without performance degradation. See `docs/LIVING_LEAGUE.md`.
