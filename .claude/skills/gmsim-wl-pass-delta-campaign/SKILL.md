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

## Phase 1 — Decompose the delta (the discriminating experiment)

The 32.8 is `mean(passYds | win) − mean(passYds | loss)`. Split it into **volume × efficiency**: passYds = attempts × yards/attempt.

Write `_wl_delta_decomp.mjs` (pattern: `gmsim-run-and-operate`; sibling instrument `_wl_passing_probe.mjs` exists in `packages/truth-arbiter/data/`): per team-game record attempts, completions, yards, win/loss → report W-L deltas for attempts, comp%, YPA, and yards; same table from `games.csv` real side (columns exist — see `_qb_churn_by_record.mjs` for the csv-parsing pattern).

**Gate — expected observations and branches (numbers are hypotheses to confirm, wrong-by-much = learn something):**
- Real side: attempts delta slightly NEGATIVE (losers attempt more), YPA delta ~+1; sim side prediction: attempts delta ≈ 0 (script calibrated the mix), **YPA/comp% delta strongly positive** — the delta lives in EFFICIENCY.
  - If confirmed → the winners-complete-too-cleanly mechanism: proceed to Phase 2, solution menu A/B.
  - If sim attempts delta is strongly POSITIVE instead → the script isn't binding in real games (integration seam: check `gameScriptShift` is actually reached with nonzero `progress ≥ 0.5` and real score diffs — instrument the call inputs); fix the seam first, re-run Phase 0.
  - If BOTH sides show the same efficiency delta but sim yards still separate more → variance deficit: check per-game pass-yds sd win vs loss; go to menu B.

## Phase 2 — Solution menu (ranked; each with its theory obligation)

**A. Garbage-time defensive softness (prevent defense) — first choice, missing real phenomenon.** Leading defenses concede short completions late; real losers' air yards are partly EMPTY yards allowed on purpose. Obligation: derive comp%/YPA by (score state × quarter) from nflverse pbp for the real bar (the pbp pipeline exists — `_pace_script_out.txt` came from it); implement as a defense-side counterpart to `gameScriptShift` (completion/YPA modifier when leading big, late), constants carrying the derivation per house style. Prediction to write down: trailing-team comp% rises ~3–6pp in Q4-when-down-big; pass delta falls toward ~15–20 without touching attempts mix; comp% overall stays ≤ band top (real 63.3 — watch it, this ADDS completions).

**B. Per-game passing-outcome variance — the sd gap is the clue.** Sim pass-yds sd 67.4 vs real 75.4: game-to-game passing noise (protection breakdowns, weather, gameplan) is under-modeled, so quality shows through too cleanly and yards sort by winner. Obligation: prove where real variance exceeds sim (within-team across games, not across teams — decompose sd); implement as a seeded per-game team passing-form factor in drive-sim (PRNG stream: fork it — do NOT perturb existing streams' call order). Prediction: sd → ~73–78, pass delta drops several points, points sd stays ≤13.1.

**C. Efficiency-coupling damp (LAST resort, dual-gated).** Reduce how directly qbPlay converts to drive success (`passEdge`), compensating the #1-QB pipeline elsewhere. Only if A+B leave >5 points of gap; requires Goatinator 12×32 QB shares to hold in the SAME slice.

Combining A+B is legitimate; ship as one slice with both derivations documented.

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
