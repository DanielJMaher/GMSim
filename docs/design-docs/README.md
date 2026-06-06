# Design Docs Index

Authoritative design lives in Google Drive (owner: `danieljmaher@gmail.com`).
We read each module doc just-in-time when implementing the corresponding
slice rather than mirroring full text into the repo — this avoids drift
between repo copies and Drive originals when designs evolve.

To fetch a doc, use the Google Drive MCP tool with the listed file ID.

---

## Anchor docs (must reference)

| # | Title | Drive ID |
|---|---|---|
| — | North Star (principles consolidated locally — no standalone Drive doc) | see `docs/NORTH_STAR.md` |
| 1 | Living League: 32-Team Ecosystem | `1vDnynFESV5120fZb1EZHUnz4F-VaXzQGy8c_W4Dm-5w` |
| 0 | Master Reference (this index's source) | `1J9fxCVxItX1c2Pw97yaK0h-0zoA0uUN1oen9tH7yX20` |

## Authored-in-repo design docs

| Title | Path | Notes |
|---|---|---|
| Living Voice — Scouting & Media as a Living, Non-Deterministic Layer | `docs/design-docs/LIVING_VOICE.md` | Authored 2026-06-05 (Daniel-directed). Read-to-learn blurb encoding, two-seed determinism split (world seed = players, voice seed = voice), Voice Pack corpus seam. Candidate to promote to Drive as authoritative. |

## Phase 1 — Foundation

| # | Title | Drive ID | Priority |
|---|---|---|---|
| 6 | Personnel Generation System | `13-Ckahld2V0fPUmR-7iz1D60XZJkqVO1JiEhWeF40do` | HIGHEST |
| 20 | 32-Team Personality (L/L-01 resolution) | `1oh87cchSTNvAEKG0vyj46d5xW9IF2_SXcAQOviVznzg` | HIGHEST |
| 15 | Offensive/Defensive Scheme Identity | `1_iSDl53p2g0EtKO_jGZvV197ZHtoZuSeM8Pmz8CxrsQ` | HIGHEST |
| 16 | Player Archetypes by Scheme | `1QFkiduUxrs5UsHCc4JdLkukIsc64Ib_hYUqTQog-N_I` | HIGH |

## Phase 2 — Core gameplay

| # | Title | Drive ID | Priority |
|---|---|---|---|
| 11 | Salary Cap | `17VGW7ExodPGibSi5hGSGu5ziZe_wF4ywvtXOa1jaEzU` | HIGH |
| 17 | Game Simulation | `1Xnco5-qbV-hfYMwFjB991ijl9VEP5YqWInJVX2JVhdI` | HIGH |
| 13 | Player Development | `1Uo12L_IgwyxkXKw1iGeTs5BZTeB4tW0huqfqAKH4mgk` | HIGH |
| 7 | Roster Management | `1mX57YpLTL4mUufw4Ct_zb1OB111XBjsz3_A0RHcEwOw` | HIGH |

## Phase 3 — Strategic layer

| # | Title | Drive ID | Priority |
|---|---|---|---|
| 3 | Draft Module (32-Team Update) | `1s5KkfE_Wlj297V69kXyKhQLqsbhNkjekpHpsmeW7Rag` | HIGH |
| 5 | Draft Pick Trade Value Chart | `1_yP4ZYEJk3RJeUlrpQnG0M28ofFWCZIkPmtLBZXvxfo` | MEDIUM |
| 14 | Trade Module | `1JMor2gc0kE4NH_tq1odq2BkpYgoE0YAypkEmGVbRCx8` | HIGH |
| 4 | Roster & Free Agent Scouting | `1_aBYeg9V4dqQSANeMCjG_zaqnyOqrhQfTJ9Tg_VHTI8` | HIGH |
| 10 | Inter-Team Relationships | `1NS7hBRHdOuEHmErZoxDgogHqlvMcuAet2Z6CDuf5pi0` | MEDIUM |

## Phase 4 — Immersion + polish

| # | Title | Drive ID | Priority |
|---|---|---|---|
| 18 | Scouting Report UI/UX | `1ki-S4H-xIkWnPTXkS8lr2wWibmx6Klmalsbpad5R79g` | MEDIUM |
| 12 | League News & Transaction Feed | `1KmRs01SHC7Wn8JhYNUgaQKtmp3XgWQPPKVxYKLU5Y4Q` | MEDIUM |
| 8 | Coaching Staff Hiring & Management | `1331JCjoLHj2MYGioLUr8MiFRVLttydwedroqz5qc1SQ` | MEDIUM |
| 9 | Dynasty & Rebuild Cycles | `1pQm8QeD6TkgrZ2AWe7qRUj_VwePyNm2qML9k2vsBfWA` | MEDIUM |

## Resolution docs

| # | Title | Drive ID |
|---|---|---|
| 19 | Draft Module Film Study Resolution (D/N-01 FINAL) | `1ewKMjjewM9x_Xur2A8sd7rLjv9Za6QJitm_O_LD4xME` |
| 20 | 32-Team Personality (L/L-01 RESOLVED) | `1oh87cchSTNvAEKG0vyj46d5xW9IF2_SXcAQOviVznzg` |

## Research docs (reference only)

| # | Title | Drive ID |
|---|---|---|
| 21 | NFL Defensive Schemes 2004-2024 | `1wObICUyTwRxtq_9ICeMKgwyP0QgDOCHV953D0PCNxeg` |
| 22 | NFL Offensive Schemes 2004-2024 - EXPANDED | `1zMKuBuAPKr8GZXHA8EDU46fNhcI4HBIdgDR7mqLViH8` |
| 23 | Design Document Punch List — COMPLETE | `1Ka7BhsF4BnvHvHkmJa2gULiE_p7tcuEUjHjNEOslZuY` |

---

## Already read (digest in repo as types/types of comment)

As of Phase 0 setup, the following docs have been read in full and their key concepts are reflected in the engine type system (`packages/engine/src/types`):

- Living League (#1) — drove `LeagueState` shape and the league-shaped engine API requirement
- Personnel Generation (#6) — drove all `Owner`/`Gm`/`HeadCoach` types, spectrums, quirks, personality
- 32-Team Personality (#20) — drove `TeamPersonality` weighted formula
- Scheme Identity (#15) — drove offensive/defensive scheme archetype enums
- Player Archetypes (#16) — drove archetype tag concept on `Player`
- Salary Cap (#11) — drove `Contract` shape (proration, dead money, void years, guarantees)
- Trade Module (#14) — types and 5-factor evaluation will land in `engine/src/trade/`
- Player Development (#13) — drove `developmentArchetype`, hidden ceilings on `Player`
- Game Simulation (#17) — types will land in `engine/src/game-sim/`

Docs not yet read in full (deferred to their respective phases):
- Draft Module (#3), Roster Mgmt (#7), Coaching Staff (#8), Dynasty Cycles (#9),
  Inter-Team Relationships (#10), News Feed (#12), Roster/FA Scouting (#4),
  Trade Value Chart (#5), Scouting Report UI/UX (#18), Film Study Resolution (#19)
