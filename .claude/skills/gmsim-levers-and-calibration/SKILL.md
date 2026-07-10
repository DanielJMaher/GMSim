---
name: gmsim-levers-and-calibration
description: The catalog of GMSim's calibration levers (tuning constants) — where each family lives, what real bar validates it, which are proven vs provisional — and the mandatory probe-first procedure for changing ANY of them. Load before touching any exported constant, threshold, multiplier, or curve in the engine, or when a sim metric is off its bar and you're tempted to tune.
---

# GMSim levers and calibration

GMSim has almost no runtime flags; its configuration axis is **calibration constants** ("levers"). Every lever is a claim about NFL reality, carries a provenance comment at its definition (derivation, real bar, measured effect, incident history), and is guarded by a validation instrument. The cardinal sin here has a name — **law #3: never tune to fix a symptom** — no lever changes without a probe demonstrating the mechanism, and never weaken a trigger to make dormant behavior fire.

## When NOT to use this skill

- The real-world numbers behind the bars → `nfl-domain-reference`
- Running the validation agents → `gmsim-diagnostics-and-tooling`
- Designing the mechanism-isolating probe → `gmsim-proof-and-analysis-toolkit`

## The lever families (file anchors, as of 2026-07-04 / v0.177.0)

| Family | File | Key levers | Validated by |
|---|---|---|---|
| Economy spine | `contracts/constants.ts` | `SALARY_CAP_ANNUAL_GROWTH` (1.06), `ANCHOR_CAP` ($255M), `leagueMinimumSalary()` | cap-decay probes, cash tests |
| Cash floor | `contracts/cash.ts` | `CASH_FLOOR_PCT` (0.89), `CASH_FLOOR_WINDOW` (4, = 3 booked + current) | cash pace ~90% vs 89% target |
| FA deal shapes | `transactions/free-agency.ts` | `FA_DEAL_BY_TIER` (totals, `baseShape` escalators, `voidYears`) | Y1/APY ≈ 0.877; Liquidator |
| FA auction | `transactions/fa-bidding.ts` | `TIER_STANDARD_Y1` (**moves in lockstep with FA_DEAL_BY_TIER or multipliers double-count**), `BID_MULTIPLIER_FLOOR/CEIL` (0.7/1.2), `CASH_LAG_BID_FLOOR` (0.9), `CASH_LAG_OVERPAY_MAX/SLOPE` (1.6/3.0) | cap band, teams≥90% count |
| Retention | `transactions/re-sign.ts` | `RESIGN_BASE_BY_TIER`, `RESIGN_QB_FLOOR` (0.93), age/mood dampers, `RESIGN_QB_BAD_TEAM_WINS/FACTOR` (6/0.45), `RESIGN_INCUMBENT_PREMIUM`, `CASH_LAG_RESIGN_PREMIUM`, `RESIGN_CAP_HEADROOM` (0.9) | retention 78.4% bar; QB churn-by-record; Goatinator #1-QB |
| Extensions | `transactions/extensions.ts` | `CAP_FLOOR_TARGET` (0.88), `CASH_LAG_FLOOR_TARGET` (0.93), `CAP_EXTENSION_CEIL` (0.95), age gates, QB record carve-out | cap-decay; Goatinator |
| Restructures | `transactions/restructures.ts` | win-now trigger (>92% usage), `RESTRUCTURE_ROOM_TARGET`, `MIN_CONVERTIBLE` | fire-count probes — **trigger is fenced: never lower it** |
| Draft value | `draft/position-value.ts` | `POSITION_DRAFT_VALUE` (QB 1.55 …), `BOARD_PREMIUM_STRENGTH`, slot-premium decay (τ=5), `QB_REVEALED_SLOT_VALUE` + fade-by-pick-7, non-QB factor (0.5) | Goatinator top-10 mix + #1/#2/#3 QB share |
| QB-room desire | `draft/team-needs.ts` | Rosen abandon floors by slot (0.45/0.87/0.99 at picks 1/2/3), desire quartile mapping | Goatinator GOAT slots (real 75/44/25) |
| Talent grading | `players/skills.ts`, `season/talent-score.ts` | `GRADE_CUTS` (clean quantiles, ELITE .989/STAR .962/…), `GRADE_SEED_SCORE`, EWMA α=0.35 | composition stationarity (±3pp over 8 seasons), grade-dist probes |
| Player market factors | `contracts/tiers.ts` | `POSITION_SALARY_FACTOR` (QB 2.5 …), `BONUS_SHARE_OF_GUARANTEE` (0.6), guarantee targets | Liquidator vs OTC |
| Game sim | `games/drive-sim.ts` | `passEdge` qbPlay weight (0.65), `leagueRecenter` (per-season league-mean offset) | Scorekeeper bands — **drive-sim constants are FENCED as the lever for scoring drift** |
| Game sim: pass texture (v0.184) | `games/drive-sim.ts` | `EXPLOSIVE_BASE/EDGE_K` (0.15/0.002 — 20+ level & the C1 48% quartile spread), Gamma body `BODY_K/CAP/SHIFT` (real completion shape, median 9), `EXPLOSIVE_RECENTER`, `DOWN_COMP_EARLY/LATE` (+0.021/−0.052 = real 7.3pp gap) + `DOWN_SACK_*` (0.85/1.6) | 20+/att quartile bars (`_c3_explosive_probe.mjs`), Scorekeeper comp%/sacks (2.4 exact), Magistrate punt — **mean-solve is exact per edge; K_comp (0.004) is a MATCHING BAR (C1), never cut** |
| Game sim: red zone (v0.184) | `games/drive-sim.ts` | **NO COIN FLIP — hard invariant, drives grind to the goal.** `RZ_PASS_TILT` (0.2 = realism cap; 0.28 broke goal-area pass rate vs real 47%), `RZ_TILT_DTG` (30), `RZ_COMP/RUN_*` compression, goal-line gain cap, 4th-and-goal go (≤5/≤3 @ 0.5), `CLOCK_KICK` (12s) | Magistrate outcome mix + drives/game 22.9; Scorekeeper rush delta (54.3 vs 55 ceiling — the tilt TRADES rush-delta headroom for pass delta) |
| Game sim: FALSIFIED (do not retry) | — | leader-pace burn (real kill s/play ≈ neutral, `_clock_cost_bar.mjs` 2026-07-09 — `KILL_COMPLETE_MULT` 1.11 IS real); comp%→yds-mean rotation; pass-rate identity; sticks-straddle special case (the Gamma body does it naturally) | the campaign skill's fence list |
| Front office | `npc-ai/front-office.ts` | `FIRING_THRESHOLD`, `PRESSURE_DECAY`, heat scales, ring fatigue, lame-duck floor | Headhunter; carousel probes (~6–7 HC changes/season real) |

Values quoted are anchors for recognition, not gospel — always read the current definition; the provenance comment there outranks this table.

## Lever status discipline

- **Proven**: the provenance comment cites a measured effect against a named real bar (most of the table above).
- **Provisional/candidate**: labeled as such in the comment; no unproven effect may be stated as fact. History: a `skills.ts` comment once claimed a lever effect that measurement falsified — the fix (shipped v0.170) was correcting the COMMENT. If you falsify a comment, fixing it is a shippable change.
- **Dormant-by-design**: behavior wired but not firing because reality doesn't trigger it (restructures pre-v0.176). The gate is the spec; make reality honest instead of the gate generous.

## Procedure: changing a lever (the mandatory loop)

1. **Read the provenance comment** at the definition — it usually names the incident that set the current value and the instrument that validates it.
2. **Check the archaeology** (`gmsim-failure-archaeology`) — the change you're considering may be fenced.
3. **Baseline probe BEFORE the change**: run/write the mechanism probe (`packages/truth-arbiter/data/_*.mjs` pattern) against the current `packages/engine/dist`. Record numbers.
4. **Predict the numbers** the change should produce, in writing, before running (see `gmsim-research-methodology`).
5. Change the lever; `pnpm --filter @gmsim/engine build` (probes read `dist/`, not `src/` — an un-rebuilt dist silently probes old code).
6. **Clear agent caches** (`packages/truth-arbiter/data/goat/*.json`, `data/scorekeeper/*.json`) — they're keyed by seed+years only.
7. Re-probe + run the family's validating agent(s). Compare against prediction, not vibes.
8. **Guard the neighbors**: levers are coupled — the cap level was once propped by QB/K star-tier inflation (v0.168 archaeology); tier deflation dropped spend (v0.171); anchors and the auction divisor must move together (v0.176). Run the adjacent family's instrument when in doubt.
9. Update the provenance comment (new value, derivation, measured effect, date) and the CHANGELOG entry with the measured numbers.

## Adding a new lever (checklist)

- [ ] Named `SCREAMING_SNAKE` constant, exported only if tests/inspector need it
- [ ] Provenance comment: real bar + derivation + validating instrument + date
- [ ] Cap-relative if it's money (`× salaryCap / ANCHOR_CAP` — a raw dollar constant silently deflates 6%/yr)
- [ ] A probe or test that would catch it drifting
- [ ] NPC-decision levers live in or re-export through `npc-ai/` (invariant #6)

## Provenance and maintenance

- Regenerate the family table's file anchors: `Grep 'export const [A-Z_]+ =' packages/engine/src --files-with-matches`.
- Spot-verify any quoted value before relying on it: read the constant's definition (values here are as of v0.177.0).
- The falsified-comment incident: CHANGELOG `[0.170.0]` (skills.ts comment fix shipped alongside cap-floor extensions).
- Coupling examples: CHANGELOG `[0.168.0]` (cap/star coupling), `[0.171.0]` (tier deflation → spend), `[0.176.0]` (anchor/divisor lockstep).
