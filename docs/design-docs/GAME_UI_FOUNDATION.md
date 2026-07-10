# Game UI Foundation — the alpha track

**Status: APPROVED — Daniel, 2026-07-10.** Rulings: **D2b** (coach's card — his
framing: *you know more about your veterans than your young guys or other teams'
vets*; knowledge scales with exposure) and **D3a** ("no shortcuts — do it right,
the game is its own thing separate from the inspector"). D1/D4/D5/D6 stand as
recommended. Vision-central (design-before-code law applies — satisfied by this doc). This doc scopes the FIRST player-facing game UI: the walking skeleton
that puts 4 alpha testers in front of the three loops — **scouting, drafting, game
sim** — with rework-later expressly OK. It is a foundation doc: boundaries, shell,
saves, reproducibility, and the alpha scope cut. Feature designs for the scouting
process and draft-day experience are their own docs (in flight on the alpha track).

Cross-refs: `docs/NORTH_STAR.md` (the acceptance check is the gate),
`CLAUDE.md` invariants #3/#4, `packages/engine/src/knowledge/` (the boundary today),
memory `project_alpha_track_plan.md` (the track).

---

## 1. What "alpha" means here

Four testers, each able to: create a league → play a season loop (sim weeks, read
results) → run a scouting cycle → sit a live draft → repeat. Feedback wanted on
*feel* (drafting, scouting, game sim), not polish. Everything is allowed to be
reworked later EXCEPT the things that are expensive to rework: the knowledge
boundary, the save format's versioning story, and the reproducibility hooks. Those
three are what this doc nails down.

## 2. The knowledge boundary, applied honestly

**Inventory (2026-07-10):** the game-safe surface is exactly three exports —
`ProspectSnapshot`, `hotSeatKnowledge`, `DossierViewer`. Everything else the alpha
must display is currently unexposed or inspector-only.

**The clarification the UI effort needs:** `LeagueState` mixes two kinds of data —

- **Public world facts** — standings, schedules, box scores, transactions, contract
  terms (real NFL contracts are public), news items, draft results, player
  name/age/position/college, awards. Nothing hidden; any surface may show them.
- **Hidden truth** — ratings, potentials/ceilings, hidden career shapes, mood
  internals, scout reliability, chemistry scores, coach spectrums, seat-pressure
  numbers, `talentScore`. The North Star's acceptance check targets exactly these
  (a prop typed `{ speed: 88 }` is broken by definition).

**Proposed mechanism (Decision D1):** the game UI imports ONLY
`@gmsim/engine/knowledge`. The module grows **typed view projections** per surface
— `leagueView` (standings/schedule/results), `rosterView` (players as the club
knows them), `contractView`, `newsView`, `draftRoomView`, plus the existing
prospect/hot-seat reads. Each projection is leak-gated the way
`knowledge/snapshot.test.ts` already gates `ProspectSnapshot` (type-level: no
numeric-rating fields exist on the view types). Public facts pass through
verbatim; hidden truth is either absent or expressed qualitatively with
attribution. Rationale: one enforcement point, an existing test pattern to copy,
and every future UI PR has a mechanically checkable rule ("does it import
anything but knowledge/?" — greppable, CI-gateable).

**The big open call (Decision D2): how well do you know YOUR OWN players?**
The read-to-learn vision (Living Voice / Madden-2005 model) implies even your own
roster is known through coaches' reports, practice observations, and production —
not numbers. Options:
- **D2a — full fog:** own players get the same qualitative treatment as prospects
  (coach-attributed remarks, confidence that grows with tenure). Purest vision;
  most work; risks frustrating testers who expect a ratings screen.
- **D2b — coach's card (RULED, 2026-07-10):** own players show a stable qualitative
  card (position grades as letter bands from the coaching staff,
  strengths/weaknesses prose) that is honest-but-coarse — perceived, but
  high-confidence and rarely wrong for veterans; rookies/young players stay foggy.
  **The governing principle (Daniel): knowledge scales with EXPOSURE — your own
  veterans (seasons of practice tape) > your own young players > other teams'
  veterans (game tape only) > other teams' young players.** Confidence in the
  view types should derive from tenure-with-club + league service time, so the
  same machinery later prices trade targets (you never know their guy like yours).
- **D2c — own-team numbers:** show real ratings for your own roster only. Fastest;
  violates the spirit; hard to walk back after testers anchor on it. Not
  recommended.

## 3. App shell (Decision D3)

- **D3a — new `apps/game`** (Vite + React, same stack as the inspector). The
  inspector remains a dev tool; the game is a different product with different
  rules (knowledge-only imports). Shared code moves to `packages/ui` only when
  duplication actually hurts (not preemptively). The monorepo was shaped for this
  ("apps/desktop, mobile — planned"). **Recommended.**
- **D3b — a mode inside `apps/web`.** Fastest start, but the inspector's 7,700-line
  `App.tsx` reads ground truth everywhere; keeping the boundary clean inside one
  app means policing every import forever. Not recommended.

Alpha distribution: GitHub Pages already deploys `apps/web`; a second Pages entry
(or a subpath build) serves `apps/game` — testers get a URL, no install. Engine
runs fully in-browser (pure TS — invariant #1 pays off here).

## 4. Saves (Decision D4)

Engine state is one serializable object + PRNG seed; `migrateLeagueForward`
already heals old saves forward and repo SemVer marks save breaks (MAJOR).
Proposal:
- **IndexedDB** for persistence (LeagueState is multi-MB; localStorage won't fit).
  Save slots + autosave-on-advance. A thin `apps/game` storage module; the engine
  stays storage-ignorant.
- **Export/import as a file** (JSON, gzipped) from day one — this is also the bug-
  report vehicle (§5).
- Every save stamps `version` (root package.json) + creation seed. Loading an
  older save runs the existing migration path; loading a NEWER save than the app
  politely refuses.

## 5. Alpha feedback reproducibility (the cheap superpower)

Determinism means every tester complaint can be a one-click repro — if we design
the hooks in now:
- A **"Report issue" button** on every screen: captures version, league seed +
  voiceSeed, current save export, the active screen, and (on game surfaces) the
  gameId — zips it for the tester to attach.
- Game results are re-simmable from (matchup id × seed) — the Game Lab already
  proves the pattern. "This game felt wrong" arrives as the exact game.
- Triage flow: load save → reproduce → classify against the truth-arbiter bars
  (which is why the instrument-certification charter runs before feedback arrives).

## 6. Alpha scope cut

**M0 — walking skeleton (the first Opus build):** new league (seed + team pick) →
season hub (standings, schedule, sim-week/sim-to-date buttons, box scores via the
Game Lab components adapted to knowledge views) → offseason rail (the calendar
already exists) → draft room v0 (board from ProspectSnapshot, pick-making, NPC
picks streaming in with war-room blurbs) → next season. Scouting appears as
READ-ONLY reports (the snapshot feed) — agency comes with the scouting design.
**Explicitly reuses:** knowledge/snapshot, Game Lab box-score/drive components
(ported behind a view type), draft blurbs, news items.

**M1 — the scouting loop** (blocked on the scouting-process design doc): assign
attention, watch knowledge sharpen, feel the fog.

**M2 — draft-day feel** (blocked on the draft-day audit): trade offers to the
player, pacing, runs, tension.

**Non-goals for alpha:** free agency/contract management UI (view-only),
trades outside the draft, media browsing beyond a news feed, coaching staff
management, settings/customization, mobile layout, audio.

## 7. Decisions requested

| # | Question | Recommendation |
|---|---|---|
| D1 | Boundary mechanism: knowledge-module view projections, leak-gated, UI imports knowledge/ only | Yes — one enforcement point, pattern exists |
| D2 | Own-roster knowledge model | D2b coach's card for alpha; D2a full fog as the long-term target |
| D3 | Shell | D3a new `apps/game` |
| D4 | Saves | IndexedDB + file export/import, version-stamped |
| D5 | Alpha distribution | Pages URL, in-browser, no accounts |
| D6 | M0 scope as cut in §6 | Ship M0 before M1/M2 designs land |
