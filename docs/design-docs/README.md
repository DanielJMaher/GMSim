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
| GM Hire/Fire & The Front-Office Lifecycle | `docs/design-docs/GM_HIRE_FIRE.md` | Authored 2026-06-11 (Daniel-directed, design before code). Real-NFL firing baselines (GM W/L sequences vs coach-firing timing), Black Monday evaluation, firing ladder (HC before GM, "his guy" coupling), hiring market, Headhunter calibration agent. Resolves Doc #8's in-season-firings open thread; implements Doc #9's rebuild triggers. |
| Talent Spread v2 — Turnover Identity & the Fumble Dimension | `docs/design-docs/TALENT_SPREAD.md` | v1 (efficiency-channel scaling, Fable 2026-07-13) FALSIFIED at implementation — §0 records the three lessons (yardage channels can't close the delta; garbage-time ~flat; sim luck is yardage-shaped → COMPOSITION problem). **v2 (Fable 2026-07-14): fumble-dimension turnover identity** — offense `ballSecurity` + defense `fumbleForcing` facets feeding the (currently flat) fumble rate, mean-neutral, INT channel FROZEN (already ×1.02 real); pre-registered fatal test (pass delta must NOT rise + P(winner out-passed) toward real bar) with a D3 response-curve checkpoint. Drive backup `1OWv5TJDoZBgVVOOsEAkYcWr_uEHrJH5-` (supersedes all prior — trash `1GDfCde2…`,`1bJPWckC…`,`1uAZZR7…`,`1Gwjlro6…`,`12e84IL4…`). **⛔⛔ v2 ALSO FALSIFIED (Opus 2026-07-14, §0b):** ballSecurity/fumbleForcing are roster-quality facets, so the good team also wins the turnover battle — P(winner out-passed) moved WRONG way (38.8→37.6%). UNIFYING LESSON: no quality-correlated channel decouples winning from yardage; the decoupler must be quality-ORTHOGONAL (high-variance turnovers / garbage-time). Reverted, no code shipped. D0 probes live + reusable. Needs a v3 rethink (Fable). |
| The Maddeninator — Madden-Ratings Realism Agent | `docs/design-docs/MADDENINATOR.md` | Planned 2026-07-14 (Fable, Daniel-directed). New truth-arbiter agent (Adjudicator sibling): ingests Madden ratings by year+team from nfldraftbuzz.com/madden (site recon done — URL scheme/columns/player-IDs verified; browser-UA required), Ollama-assisted attribute-map + player-ID joins, four bar families (roster shape · aging/dev trends · YoY shocks · team ratings↔W-L). THE external anchor for the stalled talent-spread question (spread + shocks). **M0+M1 SHIPPED `c5db688`** (30,783 player-seasons, Madden 2012-2026 = NFL 2011-2025, curl-backed scraper + Ollama attribute-map draft). **⚡HEADLINE: Madden team-OVR↔wins corr ≈0.365 vs sim 0.435 — the sim is NOT under-coupled; the wins-sd deficit is LUCK not talent spread → refutes the talent-spread premise, confirms the v2-falsification direction.** Drive `1vIDrPI1C879oR9adjRxvRJkhyIyCw6--` (supersedes `1CvVCCA0…`,`16YsKVWw…` — trash). M2 next (real-side bars + checkpoint 2). |
| Maddeninator Findings — Real-Side Anchors | `docs/design-docs/MADDENINATOR_FINDINGS.md` | Opus 2026-07-14, **§7 added 2026-07-15**. The decision-grade consolidation of the Madden real-side anchors (M2 read) — the input for the W-L/talent-spread campaign re-plan. Team-OVR↔wins 0.365 vs sim 0.435 (deficit is LUCK not spread) · QB partial-corr 0.284 dominant, EDGE weak (0.074), non-QB flat ~0.10 · offense drives wins 2.2× defense. **§7 YoY shock anchor (MEASURED): real OVR persistence φ≈0.876 — REFRAMES the guessed "real 0.57"; real is stickier than sim 0.71, not noisier (M3 must re-measure sim φ survivor-conditional before any engine φ change).** Re-plan seed: quality-orthogonal variance + concentrate win-drive on QB/offense. Drive `1Slt86xaczmFisTawmDWvtKp16EqeXlpq` (supersedes `1IANOqTpSyYU9bT6aA_uA8GXB0oQi5yTw` — trash). |

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
