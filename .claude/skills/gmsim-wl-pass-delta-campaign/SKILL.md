---
name: gmsim-wl-pass-delta-campaign
description: The executable, decision-gated campaign for GMSim's hardest live problem — the W-L pass delta (winners out-pass losers by 32.8 yds/game vs the real 9.5). Load when assigned this problem, when the Scorekeeper flags the pass-delta drift, or when any change touches game-script, passEdge, or drive-sim outcome variance.
---

# Campaign: the W-L pass delta

**The problem (as of 2026-07-04, v0.177.0):** in real football, winners out-gain losers through the air by only **+9.5 pass yds/game** (nflverse REG 2011–2025) because *trailing teams throw their way back* — losing inflates your passing volume, decoupling pass yards from winning. In GMSim the delta is **32.8** (band ≤32; stable 32.2–32.9 across three releases): passing production still predicts winning ~3.5× too strongly. Winning by air is the tell of a sim; real teams win on the ground and defense while losers rack up empty air yards.

This is a CONTINUED siege, not a fresh fight. Four rounds already shipped: **96.5 → 70.4** (v0.149 game script v1) → **~57** → **36** (v0.153 script v2, shape locked to the real pass-rate table) → **~33** residual named and stable since. The cheap mechanisms are spent.

## When NOT to use this skill

- Just running/reading the Scorekeeper (not attacking the delta) → `gmsim-diagnostics-and-tooling`
- A DIFFERENT band drifted → `gmsim-debugging-playbook` + `gmsim-failure-archaeology` first
- General method questions (evidence bar, lifecycle) → `gmsim-research-methodology`

## Ground rules

- Success is **measured, never eyeballed**: Scorekeeper `sim 10 12` (fresh caches) with the pass delta inside `[-10, 32]` while EVERY other band holds (points mean/sd, pass yds mean/sd, pass att, comp%, rush delta [15,55], giveaway delta [-1.6,-0.3], pointsDrift ±1.6). Trading one drift for another is failure.
- All changes route through normal change control; the four unwritten laws apply — especially **never tune to fix the symptom** (no blind constant nudges) and **predict numbers before running**.
- This is a vision-central competitive-model slice: expect the design-before-code law to apply — write the chosen mechanism up and get Daniel's sign-off before implementing.

## Fenced wrong paths (do not re-fight)

| Fenced path | Why |
|---|---|
| "Add game script" | ALREADY EXISTS: `gameScriptShift` in `games/drive-sim.ts` (v0.149), shape LOCKED to the measured real pass-rate table (nflverse pbp 2015–2024, 5,246 team-games; Q4-step not ramp; constants `SCRIPT_*`). Pass-RATE mix is calibrated; re-deriving it buys nothing. |
| More trail-side volume | Script v2 + volume work already pulled 57→36; the residual survived a calibrated-to-real attempt mix — it is not a volume problem. |
| Tuning drive-sim scoring constants | Fenced since v0.165 (scoring drift arc): they're the wrong lever, and `leagueRecenter`'s uniform-shift property must be preserved. |
| Cutting `passEdge` qbPlay weight (0.65) casually | It's the v0.164 lever that fixed #1-QB share (record↔QB coupling feeds the draft-order pipeline). Any touch must re-validate Goatinator #1/#2/#3 QB shares in the same slice — treat as last-resort, dual-gated. |
| Raising leaders' rushing further | Rush delta already runs high (50.8 vs real 35.1, band ≤55) — headroom is nearly gone in that direction. |

## Phase 0 — Reproduce the baseline (half a day)

1. `pnpm --filter @gmsim/engine build`; clear `packages/truth-arbiter/data/scorekeeper/*.json`.
2. Detached: `pnpm --filter @gmsim/truth-arbiter run scorekeeper sim 10 12`.
3. **Expect:** pass delta 32±1.5, rush delta ~50±4, pass sd ~67 (real 75.4), comp% in band. If pass delta ≠ ~32 → the problem moved; re-baseline everything before proceeding (an engine change since v0.177.0 shifted it — find which, via CHANGELOG).

## Phase 1 — Decompose the delta — **EXECUTED 2026-07-06, result below**

`_wl_delta_decomp.mjs` (in `packages/truth-arbiter/data/`) splits the delta into volume × efficiency, real side from `stats_team_week_*.csv` joined to `games.csv` (the Scorekeeper's own join), sim side from the Scorekeeper seed cache. Measured (real n=7,493 team-games; sim n=65,269):

| | real win | real loss | Δreal | sim win | sim loss | Δsim |
|---|---|---|---|---|---|---|
| pass yds/g | 249.9 | 240.4 | **+9.5** | 268.7 | 235.9 | **+32.8** |
| attempts/g | 31.9 | 36.7 | **−4.8** | 32.2 | 33.8 | **−1.6** |
| comp% | 66.5 | 60.6 | +5.9 | 66.3 | 61.3 | +5.0 |
| yds/att | 7.83 | 6.55 | +1.29 | 8.34 | 6.98 | +1.36 |
| decomp | | | −34.7 vol +44.1 eff | | | −12.2 vol +45.0 eff |

**Verdict: the efficiency side is already REAL** (eff-part 45.0 vs 44.1; YPA and comp% deltas match). The entire gap is the **volume side**: real losers out-attempt winners by 4.8/game, sim by only 1.6 — and (4.8−1.6) × ~7.3 YPA ≈ the full 23-yard excess. One mechanism accounts for the whole residual, including why four rounds of pass-RATE work stalled: the script shifts the mix, but trailing teams never accumulate extra PLAYS.

**Mechanism located in code:** `runGame` (drive-sim) runs each half on a FIXED shared play budget (`halfPlays >= HALF_PLAYS`) with strictly alternating possession — every play costs 1 budget unit regardless of type. Real volume separation comes from unequal CLOCK costs: incompletions/sideline throws stop the clock (pass-heavy trailers pack more snaps into the same minutes); leaders' runs burn it (clock-kill shortens the game). The sim structurally cannot produce −4.8.

## Phase 1b — Locate the loss — **EXECUTED 2026-07-06: mechanism CONVICTED**

Two more measurements closed the case (`_pace_script_out.txt` from the prior pace research + `_script_exposure_probe.mjs`, which replays `simulateGameWithDrives` drive logs and mirrors the shift math over real pbp exposure):

1. **Real losers do NOT gain snaps** — real per-side plays/game W 63.1 vs L 62.3 (+0.8). The real −6 pass-play separation is pure RATE (W 53.6% vs L 63.9% on ~equal volume). The naïve "hurry-up gives losers extra plays" story is quantitatively tiny.
2. **Sim exposure is real-shaped** — the (score-diff × phase) play distribution matches real bucket-for-bucket; mean script-shift gap L−W = 0.098 (real-exposure equivalent 0.091). Under its own exposure, the script SHOULD produce a 6.3-attempt gap — matching real.
3. **The loss is snap-share skew**: sim per-side plays/game **W 66.9 vs L 62.7 (+4.2)**. The shared per-half PLAY budget (`HALF_PLAYS = 62` × 2) makes snap share proportional to drive quality — better teams sustain drives and eat the budget. The real CLOCK equalizes snaps: trailing teams compress seconds/play (incompletions, sideline throws, hurry-up), leaders stretch them. Winners' +4.2 snap surplus × ~50% pass rate cancels ~⅔ of the script's rate separation: 6.3 predicted → 1.5 realized (probe's realized == box measurement, chain validated end-to-end).

Also noted: sim plays/team-game 64.8 vs real 62.7 and drives/game 23.5 vs 21.6 — both ~3–9% hot; the same fix can recalibrate them.

## Phase 2/3 — IMPLEMENTED + MEASURED (2026-07-06) — the drift is CLEARED, the endgame is mapped

Shipped (v0.178 slice): the clock mechanism (plays cost real seconds — run 34.0 / completion 31.3 / incompletion 5.0 / sack 33.1 / turnover 7.3, from `_clock_cost_bar.mjs` over pbp 2022–24; hurry ×0.85, kill-completes ×1.11; halves budgeted at `HALF_CLOCK_SECONDS = 1620`, script progress clock-based) **plus the Q2 trail script** (`SCRIPT_Q2_TRAIL = 0.4` — the real table's +8pp down-big Q2 spread that the v0.153 "H1 silent" lock missed).

**Measured (Scorekeeper 10×12 fresh): W-L pass delta 32.8 → 31.4 — inside the band for the first time since the gate existed; ZERO drift rows.** Collateral wins from the pace calibration: points/game 24.0 → 23.3 (real 22.8), pass yds mean 252.2 → 246.2 (real 245.4), plays/team-game 65.8 → 63.0 (real 62.7). Magistrate drive bar holds (outcome mix within ~1pp; plays/drive 5.24 vs real 5.50 — the pre-existing short-drive shape).

**Prediction post-mortem (methodology: surprises reopen the mechanism):** the clock did NOT equalize per-side snaps as designed — under strict alternating possession, snap share = the plays-per-drive ratio regardless of budget currency (measured Δsnaps +4.2 → +3.8 only). Snap skew traces to **drive LENGTH tracking team quality** (sim W 5.59 vs L 5.41 plays/drive; real is nearly symmetric — sim quality buys sustainment where real quality buys explosiveness). The Q2 script added ~+0.5pp of rate gap (exposure-weighted, as the table implies — my ~2pp hope over-weighted early-game deficits).

## The endgame — two named levers carry the remaining ~20 yards (delta 31.4 → ~10-16)

1. **Efficiency-expression rebalance**: shift `passEdge`'s expression from completion% (`BASE_COMPLETION + passEdge×0.004`) toward yards-per-completion, holding points-per-edge fixed — good teams strike bigger instead of grinding longer → plays/drive Δ 0.18 → ~0.06 → snap Δ → ~+1 (worth ~1.5 attempts of gap). OBLIGATION FIRST: decompose the real W-L comp% delta (+5.9) into quality-vs-game-state components from pbp — the sim's +5.0 currently matches real via quality alone, and naively halving the coupling would break that match.
2. **Team pass-rate identity**: all sim teams share `PASS_RATE 0.57`; real team season pass rates spread ~50–66% and pass-heavy identity correlates with losing. Derive the real identity spread (pbp/team-week), drive it from scheme/personnel, and the W-L rate gap widens honestly (realized 7.3pp → toward 10.3pp ≈ ~2 attempts of gap). Watch: attempts sd and per-team stat distributions move too.

Both are probe-first slices with their own real-bar derivations. Combined predicted landing: attempts gap −1.8 → ≈ −4.5..−5.5 → pass delta ≈ 10–16.

## Phase 2 — original solution write-up (superseded above, kept for the derivation)

**Clock-weighted play costs.** Each play inside `simulateDrive` costs CLOCK units by type/outcome instead of a flat 1: run ≈ high (clock runs), completed pass ≈ slightly less, incompletion ≈ markedly less (clock stops); optional lead-late run surcharge (the deliberate kill) and trail-late discount (hurry-up). `simulateDrive` returns `clock` alongside `plays`; `runGame` budgets the half in clock units and feeds `progress` from clock. Deterministic per existing outcomes — **no new PRNG draws, call-order safe**.

Theory obligation: derive real seconds/play by (type × outcome × script state) from the cached pbp (2015–2024, `packages/truth-arbiter/data/pbp_*.csv`).

**Predictions to hold (write into the slice):** per-side snap delta +4.2 → ≈ +1; realized attempts gap −1.5 → ≈ −4.5 to −5.5; Scorekeeper pass delta 32.8 → ≈ 10–16; plays/team-game 64.8 → ≈ 62.7 and drives/game toward 21.6 (free recalibration); attempts mean stays in [30.3, 38.3]; points mean/sd, comp%, rush delta, giveaway delta, pointsDrift all in band; Magistrate drive bar unchanged; benchmark within budget.

**Falsified/moot paths (Phase 1, 2026-07-06):** garbage-time efficiency softness (sim losers already at/above real efficiency); `passEdge`/qbPlay damp (efficiency deltas match real — exonerated; still carries the #1-QB pipeline); per-game variance widening (real sd gap exists but is symmetric — polish, not cause).

## Phase 3 — Validate and promote

1. Rebuild; clear BOTH agent caches; targeted tests: `src/games/`, `src/season/runner.test.ts`, `stats-coherence`, benchmark (quiet box).
2. Scorekeeper `sim 10 12` fresh: **promotion bar = pass delta ≤ 32 band honestly approached (target ≤ 20; real 9.5 is the star to steer by), all other rows in band, pointsDrift stationary.**
3. Magistrate (drive-level bar unchanged), Goatinator if `passEdge` or anything QB-adjacent moved.
4. Cross-check the giveaway delta (−0.4, band floor −0.3): garbage-time passing adds INT exposure — it may move toward real (−0.9); it must not exit the band.
5. CHANGELOG entry with the full decomposition table (before/after, real bar), the derivation citations, and residuals named. Normal release + Daniel's push gate.

## If you get stuck

Re-read the arc in CHANGELOG (grep `pass delta`): 96.5→70.4→57→36→33 — each round's entry documents what its mechanism bought and what it explicitly left. The remaining gap has survived a real-calibrated attempt mix; any proposal that only moves attempts is already falsified.

## Provenance and maintenance

- Current delta + bands: run the Scorekeeper (real side is free — no `sim` args).
- Script constants/lore: `games/drive-sim.ts` "Game script" comment block (v0.149/v0.153, `SCRIPT_*`).
- Battle history: `Grep 'pass delta' CHANGELOG.md`.
- Real pbp table artifact: `_pace_script_out.txt` reference in the drive-sim comments; pbp derivation scripts in `packages/truth-arbiter/data/`.
- Numbers here dated 2026-07-04 (v0.177.0) — re-baseline at Phase 0 regardless.
