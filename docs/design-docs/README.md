# Design Docs Index

**Posture (Daniel, 2026-07-11 final): design docs are LOCAL-ONLY working copies,
Google-Drive-backed, NOT published.** Only this `README.md` is tracked in git;
every other `docs/design-docs/*.md` is gitignored (see `.gitignore`, committed
`bc31e8e`/`d34cd52`). The docs still live on disk as working copies you edit
in place — they're just not part of the published repo.

Two tiers of design doc:

1. **Authored working docs** (the ones we write and revise here — Living Voice,
   GM Hire/Fire, the game-sim/talent-spread/Maddeninator design docs, the alpha
   UI/scouting docs, …). These live on disk (gitignored) and are **byte-faithfully
   backed up** to the Drive folder **"GMSim design-docs (repo backup)"**
   (`1rvpwCeAUczv1u8bKMemGPXNLAOxuMpjC`). **RULE: any session that edits one of
   these re-uploads it to that Drive folder in the same session** (gitignored files
   are not in git — a clean clone or `git clean` loses local edits otherwise).
2. **The original numbered corpus** (Phase 1–4 module docs, resolution & research
   docs below). These are Drive-native Google Docs, read **just-in-time by file ID**
   via the Google Drive MCP tool — deliberately not mirrored to the repo, to avoid
   drift between a local copy and the evolving Drive original.

**Fresh-clone note:** a clean clone has NO design docs on disk (they're gitignored).
Pull the authored working docs from the Drive backup folder, and fetch numbered
corpus docs just-in-time by file ID as needed.

If a design doc and the code disagree, the code is wrong, or the doc needs an
explicit revision (re-uploaded to Drive the same session).

---

## Anchor docs (must reference)

| # | Title | Drive ID |
|---|---|---|
| — | North Star (principles consolidated locally — no standalone Drive doc) | see `docs/NORTH_STAR.md` |
| 1 | Living League: 32-Team Ecosystem | `1vDnynFESV5120fZb1EZHUnz4F-VaXzQGy8c_W4Dm-5w` |
| 0 | Master Reference (this index's source) | `1J9fxCVxItX1c2Pw97yaK0h-0zoA0uUN1oen9tH7yX20` |

## Tier 1 — Authored working docs (local on disk, gitignored, Drive-backed)

Backed up to Drive folder `1rvpwCeAUczv1u8bKMemGPXNLAOxuMpjC`. Edit locally →
re-upload same session.

| Title | Path | Notes |
|---|---|---|
| Living Voice — Scouting & Media as a Living, Non-Deterministic Layer | `docs/design-docs/LIVING_VOICE.md` | Authored 2026-06-05 (Daniel-directed). Read-to-learn blurb encoding, two-seed determinism split (world seed = players, voice seed = voice), Voice Pack corpus seam. Candidate to promote to Drive as authoritative. |
| GM Hire/Fire & The Front-Office Lifecycle | `docs/design-docs/GM_HIRE_FIRE.md` | Authored 2026-06-11 (Daniel-directed, design before code). Real-NFL firing baselines (GM W/L sequences vs coach-firing timing), Black Monday evaluation, firing ladder (HC before GM, "his guy" coupling), hiring market, Headhunter calibration agent. Resolves Doc #8's in-season-firings open thread; implements Doc #9's rebuild triggers. |
| Talent Spread v2 — Turnover Identity & the Fumble Dimension | `docs/design-docs/TALENT_SPREAD.md` | v1 (efficiency-channel scaling, Fable 2026-07-13) FALSIFIED at implementation — §0 records the three lessons (yardage channels can't close the delta; garbage-time ~flat; sim luck is yardage-shaped → COMPOSITION problem). **v2 (Fable 2026-07-14): fumble-dimension turnover identity** — offense `ballSecurity` + defense `fumbleForcing` facets feeding the (currently flat) fumble rate, mean-neutral, INT channel FROZEN (already ×1.02 real); pre-registered fatal test (pass delta must NOT rise + P(winner out-passed) toward real bar) with a D3 response-curve checkpoint. Drive backup `1OWv5TJDoZBgVVOOsEAkYcWr_uEHrJH5-` (supersedes all prior — trash `1GDfCde2…`,`1bJPWckC…`,`1uAZZR7…`,`1Gwjlro6…`,`12e84IL4…`). **⛔⛔ v2 ALSO FALSIFIED (Opus 2026-07-14, §0b):** ballSecurity/fumbleForcing are roster-quality facets, so the good team also wins the turnover battle — P(winner out-passed) moved WRONG way (38.8→37.6%). UNIFYING LESSON: no quality-correlated channel decouples winning from yardage; the decoupler must be quality-ORTHOGONAL (high-variance turnovers / garbage-time). Reverted, no code shipped. D0 probes live + reusable. **v3 rethink DELIVERED 2026-07-15 → `SEASON_FORM.md` (supersedes this doc as the campaign design of record; this doc remains the falsification archive).** |
| The Maddeninator — Madden-Ratings Realism Agent | `docs/design-docs/MADDENINATOR.md` | Planned 2026-07-14 (Fable, Daniel-directed). New truth-arbiter agent (Adjudicator sibling): ingests Madden ratings by year+team from nfldraftbuzz.com/madden (site recon done — URL scheme/columns/player-IDs verified; browser-UA required), Ollama-assisted attribute-map + player-ID joins, four bar families (roster shape · aging/dev trends · YoY shocks · team ratings↔W-L). THE external anchor for the stalled talent-spread question (spread + shocks). **M0+M1 SHIPPED `c5db688`** (30,783 player-seasons, Madden 2012-2026 = NFL 2011-2025, curl-backed scraper + Ollama attribute-map draft). **⚡HEADLINE: Madden team-OVR↔wins corr ≈0.365 vs sim 0.435 — the sim is NOT under-coupled; the wins-sd deficit is LUCK not talent spread → refutes the talent-spread premise, confirms the v2-falsification direction.** Drive `1vIDrPI1C879oR9adjRxvRJkhyIyCw6--` (supersedes `1CvVCCA0…`,`16YsKVWw…` — trash). M2 next (real-side bars + checkpoint 2). |
| Maddeninator Findings — Real-Side Anchors | `docs/design-docs/MADDENINATOR_FINDINGS.md` | Opus 2026-07-14, **§7 added 2026-07-15**. The decision-grade consolidation of the Madden real-side anchors (M2 read) — the input for the W-L/talent-spread campaign re-plan. Team-OVR↔wins 0.365 vs sim 0.435 (deficit is LUCK not spread) · QB partial-corr 0.284 dominant, EDGE weak (0.074), non-QB flat ~0.10 · offense drives wins 2.2× defense. **§7 YoY shock anchor (MEASURED): real player OVR φ≈0.876, shocks 0.465 z. §7b (Fable 2026-07-15, `_sim_yoy_phi.mjs`): sim side measured apples-to-apples — sim player φ 0.966, shocks 0.156 z (~3× too SMALL); sim team 0.71 vs real team 0.525 → the sim UNDER-churns at both levels (the earlier "sim over-shocks" read was a team-vs-player artifact). φ fenced OUT of the W-L campaign (wrong timescale); under-churn → M3/aging.** Re-plan seed: quality-orthogonal variance → executed as `SEASON_FORM.md`. Drive `1ymlCvs0ljBH8xklXrz8BeAOjEGF3t59d` (supersedes `1Slt86xaczmFisTawmDWvtKp16EqeXlpq`, `1IANOqTpSyYU9bT6aA_uA8GXB0oQi5yTw` — trash). |
| Season Form — quality-orthogonal variance re-plan (talent-spread v3) | `docs/design-docs/SEASON_FORM.md` | **APPROVED Daniel 2026-07-15. D1 fumble form SHIPPED v0.185.0 `ca00ed3`. D2 red-zone form FALSIFIED as inert (Opus 2026-07-17, §12) — reverted.** The W-L campaign endgame re-plan. Spine: the binomial-ceiling proof — ~90% of the missing wins-variance MUST be season-persistent. Mechanism: hidden team-season **form latent ε** (quality-orthogonal) expressed through non-yardage channels — D1 fumble + D2 red-zone. **§12 UNIFYING FINDING: BOTH channels are bar-saturated in the sim** (fumble margin sd 3.91 vs real 4.17; RZ TD% sd 5.91pp vs real 6.7pp — 0.79pp headroom) → neither can supply the missing variance (D2 fatal test: P(out-passed) 39.0→39.0 flat, wins-sd 2.62→2.65). Cross-ref Maddeninator ("wins deficit is LUCK not talent"; strength→wins 0.365 vs sim 0.435). **PIVOT: the missing season-persistent luck lives in the deferred channel — D4 injury availability (QB above all); handed to Fable as its own doc `INJURY_REALISM.md` (brief 2026-07-17). Sequencing: Roster Floor → D4 injuries (no D3 curve — neither channel transmitted).** Drive `1DoopqyRnR1rDyfBUOzftyXx-68BiDa4e` (full §0–§12, uploaded 2026-07-17; supersedes `10Tir_WEScSkxYrCDIlua45Nph8bTbXnI` + §11 companion `1jXlHjKyMEo71SgDXvzO9Xs8Rau4X13Vc` + `1c9LKK93sg51SoHZPiCTZBZCV71ELaS2k` — trash all three). |
| Real-Roster Baseline + Injury Continuation | `docs/design-docs/REAL_ROSTER_BASELINE.md` | **DIRECTED — Daniel 2026-07-17/18 (Fable authors, 2026-07-18).** The post-D2-falsification pivot, two parts. **Part B FIRST + gates all:** build real-NFL league seeds — **SAME EXACT PLAYERS per team** (frozen season-start snapshot), Madden ratings → engine skills via the signed-off attr map + a load-bearing scale-calibration transform; prove on 2024, then expand 2016-2024 (~288 real team-seasons); engine must run within pre-registered bounds (corr(sim wins, real wins) 0.35-0.50 honest ceiling — Madden OVR↔wins is 0.365; ≥90% of teams inside their sim 5-95 band) before generated seeds are trusted again — becomes the permanent regression baseline for every engine change. Stages: B0 builder+calibration (Daniel eyeball) → B1 20-seed 2024 replicates (checkpoint) → B2 all years → B3 **M-INJ** (Maddeninator × injury cross-ref: value-weighted availability loss, transmission wins², QB1-out yardage expression = the empirical P(out-passed)-gate answer) → B4 amended injury brief. **Part A recorded:** injury model = TWO channels — availability + play-through DEGRADATION (attribute-specific penalties, GM decision surface); **CONCUSSIONS = standalone module (Daniel-marked)**. **10 HARD FLAGS open (§B.4/B.4b)**; standing workstream rule: flag even slightly-off things loudly. **B0-B4 ALL EXECUTED 2026-07-18** (Daniel blessed "#2"; builder `packages/truth-arbiter/data/_rr_seed.mjs`, harness `_rr_b2.mjs`, per-year seeds cached). **§B.8: B2 PASSES → baseline ADOPTED as the permanent regression harness** — 288 real team-seasons, corr(sim,real) 0.425 IN BOUND (sim beats its own prior 8/9 years), **wins-sd 2.72-2.87 EVERY year vs real 3.3 = the variance gap is universal → third independent confirmation of the missing luck channel.** **M-INJ landed all 4 measurements** (`_minj_report.md`): QB1 −0.250 wins/start missed; availability = +1.85 of the ~3.9 missing wins² (47%, undercount); QB1 out in ~22% of real team-games vs engine ~0.3%/game (smoking gun); **fatal-test ruling settled: P(out-passed) NOT a D4 gate (39.9% in QB1-out-loser games < 46.5% all) → replaced by corr(strength,wins)→0.365.** **Injury brief v2 = `INJURY_BRIEF_FOR_FABLE.md`** (Drive `1oZoxckcbare96wIVyhjcaVii0x5m3Ntl`) — Daniel runs it to design `INJURY_REALISM.md`. Drive `1UqLfMFLzzajRfVQSTqLeULGXyknkkB7D` (supersedes `1kiAgpDQfzjItgKUAlEa5WOjdi1aqpi3c`, `1y3Qi0fpSmgJYHCr8evBArqsYxd3QZCuG`, `1YfgkFrSTUz19mHWlvnDfN-I-wwqA3BRI` — trash all). |
| Injury Realism — the load-bearing variance channel (Season Form Part 2/D4) | `docs/design-docs/INJURY_REALISM.md` | **APPROVED — Daniel 2026-07-18 (all six §13 calls). Opus implements Stage I starting at D0 (§7); no engine code before the D0 report.** Designed by a Fable agent from `INJURY_BRIEF_FOR_FABLE.md` v2 (Drive `1oZoxckcbare96wIVyhjcaVii0x5m3Ntl`). **Headline audit finding (code-verified): the TRANSMISSION HOLE — nothing in `games/` reads `Player.injury`; `strength.ts` uses full `rosterIds` unfiltered → 85% of injury events (MINOR/MODERATE) are on-field no-ops.** Stage I = rate fix (QB 0.003/game vs real QB1-out ~22% of team-games, benching-discounted to ~13-16% at D0-P1) + `availableRoster()` transmission fix + extracted `season/injuries.ts`, jointly. Stage II = attr-specific play-through degradation (INJURY_CATALOG, effective-skills view) + GM play-or-sit surface (npc-ai path). **§13.4 modified ruling: interim generic `'head'` injury = fixed 3-week absence, no GM override, ships Stage I; full Concussion Protocol module (real data + league protocol, no-override state machine) = named follow-on Part 3.** Fatal test: wins-sd ↑ AND delta not ↑ AND corr→0.365 (P(out-passed) demoted to instrument per M-INJ.3). Gates incl. the B2 real-roster harness (frozen + injury layer; DAL-2024 marquee). Roster Floor lands before Stage I validation. Drive `1fQCeFWkRYd20MhPOC8iyaCDECHkd5gLr` (supersedes `1NlNIOxak-sNLiQMnS3VaiP6Q07TAEdqj` — trash). |
| Roster Floor — mandatory-53, restructure-first | `docs/design-docs/ROSTER_FLOOR.md` | **APPROVED + SHIPPED v0.186.0 (`1826147`), PATCHED v0.187.2 (direct, no-agents session, 2026-07-21).** §12 termination proof falsified under Injury Stage I stress (seed `goat-18` team NYG: same-contract restructure nibbling + a cut-spiral, deficit 2→11, dead money detonating to $232M/$341M cap by season 5) — fixed with a per-engagement restructure-exclusion set + a cut budget (`Math.max(5, deficitStart*3)`); reproduced the exact 11-hour hang scenario post-fix, now resolves in <2 min. 2 new regression tests, 16/16 passing. **Root cause of the underlying cap spiral routed to `LEAGUE_GENESIS.md`** (leagues start with no contract history, so all complexity is manufactured forward under stress) — this fix keeps the ladder bounded/honest, that design fixes why teams get into this shape at all. INV-FLOOR: exact-53 AND cap-compliant post-`advanceSeason`. Mechanism: `enforceRosterFloor` 4-rung ladder — (1) restructure-first (v0.176 `restructureContract` + new `maxConvert` partial-conversion param; NO competitive-window gate on this path; doesn't count vs MAX_RESTRUCTURES_PER_SEASON), (2) fringe cut (`pickMinimalCasualty`, roster-aware target), (3) loop w/ termination proof, (4) loud `roster-floor-violation` — never silent sub-53, never a cap tolerance. **Mid-season RULED: same ladder wired as the weekly midseason-FA affordability fallback (IR-driven sub-53 triggers restructure-first same week); Week-1 boundary = the exact-53 GATE; in-season = never-below-53 assertion.** Acceptance: the 4 `<=53` INTENDED-TEMPORARY sites (retirement/advance/offseason/proactive-trades tests) re-tightened to exact-53 + **pin-rate flips instrument→permanent GATE=0**. D0 P1-P4 listed for Opus (ATL `retire-trajectory` repro, ladder sufficiency, affordability-skip census, post-fix A/B). Battery waiver (skip Magistrate/Goatinator) APPROVED §12.4. Drive `1evlTMm7-kwyBWo1JCTJs1BCBz0Mocftw` (§12 sign-off record; supersedes `1-zSsAZS6y5bd1_nveUfilspxYFXgafYH` — trash). |
| League Genesis — pre-seeding a living league by simulating its real past | `docs/design-docs/LEAGUE_GENESIS.md` | **APPROVED + SIMPLIFIED — Daniel 2026-07-21/22.** The root-cause fix for the Roster Floor dead-money spiral: leagues were born at "year 0" with no history, so cap complexity was manufactured forward under stress instead of reflecting real accumulated decisions. **Mechanism (revised 2026-07-22, Daniel's simplification — discarded the original backward-search entirely): genesis a league at year −5 via existing `createLeague`, then forward-simulate 5 seasons via the SAME `simulateSeason`+`advanceSeason` calls used for every normal season — the player's day-1 league IS the output.** No new simulation mode; the asymmetric "some contracts good, some bad" realism falls out for free from the engine's own real development variance. Team-era cap-health correlation DEFERRED (named TODO, gated on a future NPC-GM-personality system — hook: `personnel/team-personality.ts` owner `egoLevel`). Real-Roster Baseline gets a separate, simpler treatment (§7): no genesis there, just attach real players' ACTUAL historical contracts via `gsis_id` join. Player-facing progress signal required during genesis (real load-time cost accepted, player must see status, not a frozen screen). **D0 COMPLETE, KILL CONDITION CLEARED (2026-07-22, measured directly, no agents): 20 seeds × 5-season genesis runs → 0/20 (0.0%) hit any roster-floor-violation** (worst dead-money/cap ratio 20.5% vs the pre-fix NYG case's 68%); genesis wall-clock mean 81.6s/league; real cross-team cap variance 15.2% of mean (1.86x spread) measured and on record. **Ready for implementation.** Drive `13YDDvjdA4uGBCHCV6soM2wZhrv-VE8Wm` (16,273B byte-verified; supersedes `1OG3u1736Lb1ov1eDz05Sz0ONaO-bblUd`, `1tjgQVhs-cU6r-EFYK5ZT08juvZ9Q8DJ7`, `1zykmdj_lit8YmKr5yL-FmVHbar-pTtQZ` — trash all). |
| Roster-Size Invariant Across the Season Lifecycle — decision brief | `docs/design-docs/ROSTER_LIFECYCLE_INVARIANT.md` | **RESOLVED — Fable ruled §13 (2026-07-16).** History: Season Form D1's game-outcome shift stranded ATL at 48 in season 8; the mandatory safety-valve (`_sf_d1_bounce.mjs`) FALSIFIED the §5 model — `advanceSeason` runs the whole offseason incl. draft+53-cutdown, so post-`advanceSeason` is the **Week-1 roster** (seasons 1–7 all exactly 53, where the invariant lives); post-`simulateSeason` is the END-of-season roster (4–9 teams at 54–65). So exact-53 was a seed-lucky overclaim, and ATL-at-48 is a cap-realism **bug** (`applyMinimalCapCasualties` fires only over-cap). **§13 ruling: (a) mandatory-53 floor = named future slice "Roster Floor" (`ROSTER_FLOOR.md`, restructure-first; lands before Season Form D3); D1 ships NOW decoupled with exact-53 relaxed to `<=53` post-`advanceSeason` + INTENDED-TEMPORARY comments; framing-#1 reverted; red cap-squeeze test deleted.** Executed by Opus 2026-07-16 (4 test relaxations, engine green). Drive backup split for size: `1-RHtiRSMhepHdLN2OkUHEM27NcGwu9N_` (§0–§12) + `1ayUcCEk_aVeMTZnV2rc5BEwEROjn37Wb` (§13 ruling); local file is the complete source. |

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
