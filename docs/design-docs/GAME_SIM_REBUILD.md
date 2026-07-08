# Realistic Game-Sim Rebuild — Real Clock, Field Position, Coaching & Chemistry

**Status:** Design document — authored 2026-07-07 (Daniel-directed, design before code).
**Supersedes:** `GAME_SIM_CLOCK_AND_WL_PARITY.md` (its clock design is folded in; its
"Part B outcome-variance parity" is **retired** — see §2.4 test result).
**Serves:** North Star (the game-sim is the ground-truth stat source), Living League,
the W-L pass-delta campaign (`.claude/skills/gmsim-wl-pass-delta-campaign`).
**Framing:** REALISM-FIRST. The W-L pass delta is currently **in band** (31.4 ≤ 32);
this slice is fidelity, not a bug-fix. The delta improvement (~15 yds toward real 9.5)
is a *validated secondary* win, not the justification.

---

## 1. Why this exists

The bottom-up drive sim (`games/drive-sim.ts`) **is the live stat engine** — `outcome.ts:60`
routes any non-`topdown` league (the default; `drive-sim.test.ts:89`) through
`simulateGameBottomUp`, whose per-player lines become the box score that rolls up to
season and career stats. So this is the engine everything downstream depends on. It is
wired in, but **incomplete** on two axes:

1. **Possession & clock are abstract.** A half is a shared 1620-"second" budget with
   **strict alternating possession**; every drive starts at own 27 (`KICKOFF_START`).
   There are no timeouts, no literal clock, no field position, no two-minute drill, no
   kneel-downs. This is why winners bank a +4.4-snap surplus (real +0.9) that pins the
   W-L pass delta (see §2), and why turnovers never produce short-field points.
2. **Inputs & outputs are partial.** The box score is built from `matchupFacets`
   (ratings + per-player mood + scheme-fit). **Coaching and team chemistry do not reach
   the live game** — they live only in `teamStrength` (the *top-down* number the
   bottom-up path never uses); the Coordinator type says so outright (*"HCs do not
   influence game sim… a named future thread"*, `types/personnel.ts:251`). Some team
   stats are hardcoded stubs (3rd-down 40%, red-zone 58%; `outcome.ts:192`) and fumbles
   aren't attributed to a player.

**Goal:** rebuild the game sim as the complete, faithful ground-truth engine — a real
clock with real field position and possessions, driven by player ratings, schemes,
**coaching, and chemistry**, emitting complete stat lines.

---

## 2. The derivation record (this session, 2026-07-06/07 — read before doubting scope)

Read-only probes in `packages/truth-arbiter/data/` (`_wl_compdelta_decomp`,
`_wl_passrate_identity`, `_wl_drivelen_decomp`, `_wl_snapskew_clean`,
`_wl_possession_sizing`, `_drive_start_bars`, `_edge_win_correlation`).

- **§2.1 Efficiency-expression (lever 1) — falsified.** Real W-L comp% delta (+5.84) is
  ~85% team quality, ~15% game-state; the sim already models it as quality (+5.0) and
  already matches the real YPA delta. No headroom.
- **§2.2 Pass-rate identity (lever 2) — falsified, wrong sign.** Neutral pass identity
  correlates with **winning** (r +0.28), not losing; the real W-L rate gap is ~100%
  within-team script; the between-team identity term is −0.47pp. Adding identity spread
  would *worsen* the delta.
- **§2.3 Drive length — real-shaped, not the bug.** Sim plays/drive W-L gap (+0.27)
  matches real (+0.24); both mix-driven (winners score more). The bug is drive **COUNT**:
  strict alternation gives winners +0.33 drives where real gives them ≈0 to −0.28. The
  snap skew (sim +4.97 vs real +0.88) is ~85% this possession sign-flip. Root cause
  confirmed in code: `runGame` flips `offense` after every drive (`drive-sim.ts:822`).
- **§2.4 Outcome-variance (the old doc's Part B) — retired.** `_edge_win_correlation`:
  the sim's upset rates already match real targets (strengthΔ+0→57% vs 55%, +2-5→63% vs
  62%, +9-13→85% vs 82%). The game is **not** over-determined by quality; the residual is
  pure possession-asymmetry, so Part B's "make worse teams win more" is unnecessary.
- **§2.5 Sizing.** Matching real's snap split drops the delta ~15 yds (probe 34→18.5;
  Scorekeeper ~31→~16), with a 2nd-order rate-realization upside toward real 9.5.
- **§2.6 Drive-start bars (REAL, REG 2015-24, 56,489 drives).** Only **45% of drives are
  kickoffs**:

  | transition | % of drives | mean start (own yd) |
  |---|---|---|
  | KICKOFF | 45.3% | 25.4 |
  | PUNT | 37.8% | 24.4 |
  | INTERCEPTION | 6.0% | 47.0 |
  | FUMBLE | 4.1% | 53.1 |
  | DOWNS | 4.0% | 36.0 |
  | MISSED_FG | 2.2% | 36.5 |
  | (muff/onside/block, ~1%) | 1.5% | 45–81 |

---

## 3. Pillar A — Real clock, field position, timeouts, possession

All in `games/drive-sim.ts`. Reuse the calibrated per-play core (`resolvePlay`,
attribution, red-zone resolution, turnover rates); rebuild the *envelope* around it.

### 3.1 Literal clock
- Replace `HALF_CLOCK_SECONDS = 1620` with a real clock: **4 quarters × 900 s** (half
  1800, game 3600). Two-minute warning at 120 s left in each half stops the clock.
- Per-play seconds keep the v0.178 `CLOCK_*` costs (run 34, complete 31, incomplete 5,
  sack 33, turnover 7), but now the *literal* clock — the coach's tempo (§4) modulates
  them, replacing the coarse `scriptShift`-gated hurry/kill multipliers.

### 3.2 Field position & possession chaining (Daniel: "not every drive starts with a kickoff")
- `simulateDrive` **surfaces the ending spot** (`ballOn`) and time used, alongside the
  existing result. The next offense takes over at the flipped field position per §2.6:
  - **Score (TD/FG)** → kickoff → receiving team at **own ~25** (return model, §3.4).
  - **Punt** → receiving team at the **net-punt spot** (mean own ~24; a punt-distance +
    return model off the LOS).
  - **Turnover (INT/fumble)** → recovering team at the **spot** flipped (mean own 47 /
    53 — the short fields that produce points; today's model misses this entirely).
  - **Downs / Missed FG** → opponent at the **spot** (own ~36).
  - **Safety** → free kick from own 20.
- Possession is **no longer strict alternation**: it chains off how each drive ends and
  how the clock/timeouts run out — which is what produces the real snap split (§2.3/2.5).

### 3.3 Timeouts (the linchpin)
- **3 per half per team**, reset at halftime. Consumed by clock management: the trailing
  team spends them to stop the clock and preserve possessions; the leading team forces
  the opponent to burn them, then **kneels** when the opponent is out.
- End-of-half behavior **emerges** from `secondsRemaining × scoreDiff × fieldPosition ×
  timeouts`: hurry-up two-minute drill (trailing) vs run-clock/victory-formation
  (leading). The `END_HALF` random-stub drive (`drive-sim.ts:815`) is replaced by real
  end-of-half play. This is the mechanism that gives losers their extra possessions and
  winners their kneel-downs → snap skew +4.97 → ~+0.9 → delta drop.

### 3.4 Special teams — FULL (Daniel, 2026-07-07: "full return-man/kicker/punter")
Special teams is a real **roster dimension**, not a light field-position hack. Ratings
drive outcomes and every unit posts a real stat line:
- **Kicker** rating → FG accuracy × distance (replaces the flat `fgSuccess` curve with a
  kicker-driven one) and kickoff leg; stat line FGM/FGA by range, XP, touchbacks.
- **Punter** rating → punt distance, hang time, placement (net punt, inside-20); stat
  line punts / gross / net / I20.
- **Returner** rating → kickoff- & punt-return yards, the occasional return TD; coverage
  units suppress opponent returns; stat line returns / yards / TDs.
- The small blocked / muffed / onside rates (§2.6, ~1.5%) as real game-swing events.
- These feed §3.2's starting field position (a booming punter or a dangerous returner
  measurably shifts field position → drives → the box score) — so a great ST unit is a
  genuine competitive edge, and K/P/returner ratings finally matter.

---

## 4. Pillar B — Coaching & chemistry reach the drives and plays

### 4.1 Coaching → drives/plays (grounded in `HcSpectrums` + `HcQuirk`, 1–10 spectrums)
Elegantly, **the head coach IS the clock/possession decision-maker** — Pillar A's
two-minute/kneel/4th-down logic is *how coaching enters the game*, not a separate hook.

| Coach attribute | Game effect |
|---|---|
| `gameManagement` | Timeout usage, two-minute execution, kneel timing, clock discipline (§3.3). A great game-manager wastes no timeouts and maximizes end-of-half possessions; a poor one strands them. |
| `playCallingAggression` + `FOURTH_DOWN_GAMBLER` | 4th-down go-for-it rate (the `down===4` logic, `drive-sim.ts:605`), deep-shot rate. |
| `offensiveDefensiveIdentity` | Baseline pass/run tilt (shifts `PASS_RATE` per team) — the O-vs-D identity. |
| `adaptability` + `HALFTIME_ADJUSTER` | A 2nd-half edge adjustment (small, bounded) — good adjusters gain, static ones fade. |
| `pressureResponse` | Late-and-close execution modifier (a small edge/variance shift when the game is within one score in Q4). |
| `BLITZ_HAPPY` / `CLOCK_KILLER` / `RUN_FIRST_*` | Defensive pressure rate / kneel bias / run tilt. |

All bounded so coaching is a **real but secondary** factor vs talent (target: a top-vs-
bottom HC swings a team's game outcome by roughly the coaching share already in
`teamStrength`, ~1 unit of edge — calibrate against a coach-quality vs win% probe).

### 4.2 Chemistry → drives/plays (grounded in `teamChemistry().score`, 0–100)
Team chemistry (`season/chemistry.ts` — STAR-weighted roster-mood roll-up, buckets
toxic<20 / divided<40 / neutral<60 / cohesive<80 / locked_in≥80) enters as a **team
cohesion effect on the MISTAKE / CONSISTENCY / CLUTCH channels** — deliberately DISTINCT
from per-player mood, which is *already* in the facets (`moodMultiplier`), to avoid
double-counting:
- **Mistakes:** cohesive rooms commit fewer turnovers & penalties; toxic rooms more
  (modulate `INT_RATE`/`FUMBLE_LOST_RATE`/`DEF_PENALTY_RATE` by a bounded cohesion factor).
- **Consistency:** high chemistry narrows per-play variance (fewer busted plays); low
  chemistry widens it.
- **Clutch:** locked-in teams get a small late-and-close execution bump (composes with
  `pressureResponse`).
- **ASYMMETRIC magnitude (Daniel, 2026-07-07):** a *toxic* room tanks a talented team
  HARDER than a locked-in room lifts one — the downside is steeper than the upside (e.g.
  toxic ≈ −8% at the floor vs locked_in ≈ +4% at the ceiling). Neutral (≈50–60) is a
  no-op; the curve is centered there. Chemistry is still a tie-breaker, not a talent
  substitute, but dysfunction bites.

### 4.3 Complete emergent stats
- **Fumble attribution** to a ball-carrier/defender (today fumbles aren't attributed →
  turnover undercount, `outcome.ts:184`).
- **Real 3rd-down% and red-zone%** emitted from the drive log (replace the 40/58 stubs).
- **Full special-teams stat lines** (kicker / punter / returner / coverage) per §3.4, plus
  fuller defensive lines.

---

## 5. Determinism plan

- Fork a PRNG per drive by a **global sequential index** (`prng.fork('drive:'+i)`),
  plays forked from the drive's PRNG — deterministic given the (deterministic) possession
  sequence. No `Math.random`; engine-purity invariant preserved.
- This rebuild **changes every game's PRNG stream**, so exact game/season stat outputs
  change. The determinism *invariant* (same seed → same result) holds; the *values*
  move. Every test asserting specific game/season numbers re-baselines (see §7). This is
  the "re-opens all bands" cost, and it is expected.

---

## 6. Real bars & calibration targets

| Bar | Target | Source |
|---|---|---|
| Drive starts by transition | §2.6 table | pbp 2015-24 |
| Plays / team-game | 62.7 | Magistrate / `_pace_script_bar` |
| Drives / game | 21.6 | Magistrate |
| Plays / drive | ~5.5 | Magistrate |
| Points / team-game | 22.8 | Scorekeeper |
| Pass yds / comp% / rush | in Scorekeeper bands | Scorekeeper |
| W-L pass delta | ≤32, target ↓ toward real 9.5 (sizing ~16) | Scorekeeper |
| Home win% | 55.4% (fix OT coin-flip; today always home-first) | Scorekeeper |
| Upset curve | §2.4 targets (already met — guard it) | doc / `_edge_win_correlation` |
| Snap skew W-L | +0.88 (from +4.97) | `_wl_snapskew_clean` |
| Coaching effect | top-vs-bottom HC ≈ 1 edge-unit of win% | new probe |
| Chemistry effect | ASYMMETRIC: toxic ≈ −8% floor, locked_in ≈ +4% ceiling, neutral no-op | new probe |
| Special teams | FG% by range (kicker-driven), net punt ~40, KO/punt-return avg, return-TD rate — all on real bars | pbp / new probe |
| OT | coin-flip possession (today always home-first) | new |

---

## 7. Validation gates (every phase)

1. Targeted vitest for touched modules + the game-sim determinism tests.
2. **Magistrate** — drive bar (0 drift on mix/yards/pace) incl. new drives/game.
3. **Scorekeeper** `sim 10 12` fresh caches — ALL bands hold (points mean/sd, pass
   mean/sd, pass att, comp%, rush delta, giveaway delta, pointsDrift) with the W-L pass
   delta **improving** and staying ≤32.
4. **Goatinator** — QB shares / draft pipeline unaffected (the passEdge coupling is
   untouched but the box score changes).
5. **Full suite** each iteration (scoring ripples to ~all season/career stat guards).
6. The §2.5 sizing (delta → ~mid-teens) is the falsifiable target for Pillar A.

---

## 8. Phased build sequence (each phase its own gated slice)

- **P1 — Field position + possession chaining** (on the existing v0.178 seconds
  budget; the *literal quarter-clock* moves to P2 where two-minute/timeouts need it —
  cleaner, lower-risk than bundling both recalibrations). Chain possessions off the
  prior drive's transition (kickoff/punt/turnover/downs/missed-FG); recalibrate so the
  drive-start bars, pace, and scoring hold despite short-field turnovers (a red-zone
  trim per the old doc §2.5). **DONE 2026-07-07** — drive starts on-bar (kickoff own
  25.5, punt 25.0, turnover 49.1), Magistrate points/drive 1.95=1.95, TD/FG on bar;
  residual: plays/drive 5.03 (P5). Commit as v0.179.
- **P2 — Timeouts + end-of-half kneel / two-minute drill + OT coin-flip.** The
  possession asymmetry. **DONE 2026-07-07 (v0.180.0):** a leading offense victory-kneels
  once its threshold clears (sooner as the trailing defense burns timeouts); a trailing
  offense runs the two-minute drill (pass boost + hurry clock). Result — snap skew
  +2.89 → +0.97 (real +0.88), offensive drives W−L −0.21 (real −0.28), END_HALF flipped
  winner-ward, **W-L pass delta 21.9 → 15.3** (real 9.5); rush yds 95.3 and pass att 31.0
  held in band; home win% 55.8 (OT coin-flip). Like P1, built on the existing seconds-
  BUDGET clock (thresholds in budget-seconds); the *literal* 1800s quarter clock with
  explicit clock-stops is deferred — it's realism/feel, not needed for the asymmetry, and
  would re-open pace calibration. Commit as v0.180.0.
  Deliver the possession asymmetry → snap skew collapse → W-L delta drop. Gate on §2.5
  sizing + all Scorekeeper bands. Commit.
- **P3 — Coaching & chemistry into plays** (§4.1/4.2). **DONE 2026-07-07 (v0.181.0):**
  head-coach competence edge (game-day spectrums, centered on the midpoint) + 4th-down
  aggression (`playCallingAggression` + `FOURTH_DOWN_GAMBLER`) on the live ctx; team
  chemistry drives the turnover (mistakes) channel, ASYMMETRIC (toxic +20% / cohesive
  −10%). Measured: coaching swings a great-vs-terrible HC ~**2.3pp win%** (`COACH_EDGE_K`
  0.55, Daniel-set); all Scorekeeper bands green, INT band held (chemistry-over-seasons),
  delta 14.9. LEARNING: coaching is talent-secondary — it moves per-team win% but NOT the
  standings spread (wins sd 2.6 vs real 3.3 is a separate **talent-spread** item, a future
  slice). Facet path (Magistrate) unchanged by construction (`turnoverMult`/`aggression`
  default 1). Commit as v0.181.0.
- **P4a — special teams as a roster dimension (ratings).** **DONE 2026-07-07
  (v0.182.0):** each team's kicker/punter/return man ratings drive FG make rate,
  net punt, and return field position — centered on each unit's real league
  average (kicker/punter ~65, returners ~87) so it's MEAN-NEUTRAL (bars hold,
  spread moves). Determinism preserved (no new PRNG draws). Contained to
  `drive-sim.ts`. Scorekeeper deferred to the push gate (mean-neutral).
- **P4b — ST + fumble stat lines** (§4.3). **DONE 2026-07-07 (v0.183.0):**
  `PlayerGameStats` gains ST/fumble fields plumbed through the pipeline (types →
  drive-sim attribution → outcome mapping → per-field aggregation); kicker gets
  FGM/FGA + XP/TD, punter gets punts + net yards, ball-carrier gets the fumble.
  Pure stat-recording — no new PRNG, outcomes byte-identical to v0.182. 47
  stat/game tests green. **Deferred to P4c:** the return-man stat line
  (`returnYards`/`returnTds` plumbed but 0 — the returner *rating* already drives
  field position) + the 3rd-down%/red-zone% team-stat unstub.
- **P5 — Joint recalibration** across Magistrate + Scorekeeper + full suite; release.

---

## 9. Risks & mitigations

- **Re-opens every calibrated band** (new PRNG stream + scoring changes). Mitigation:
  phased, each phase gated to green before the next; keep the per-play *physics*
  constants (comp%, YPA, run yds, turnover rates) frozen — recalibrate only the envelope
  (clock, field position, red-zone base).
- **Short-field turnovers inflate scoring** (a real effect the model omits today).
  Mitigation: the old doc's §2.5 knobs (red-zone base / YDS_PER_COMPLETION) rebalance it.
- **Double-counting mood** (chemistry vs per-player mood). Mitigation: §4.2 targets
  distinct channels (mistakes/consistency/clutch), neutral-centered.
- **Scope / tier-fidelity.** This bolts tier-1 (real-time) fidelity onto a tier-2
  (drive-based) sim — a deliberate step up. It's justified because the game-sim is the
  ground-truth source (not "for its own sake"). Phasing keeps each step shippable.

---

## 10. Resolved decisions (Daniel, 2026-07-07)

1. **Coaching magnitude** — leave at ≈1 edge-unit (the current `teamStrength` 10% share)
   for now; **revisit if bad coaches end up coaching well "for no reason."**
2. **Chemistry** — **ASYMMETRIC**: a toxic room tanks a talented team harder than a
   locked-in room lifts one (§4.2).
3. **Special teams** — **FULL**: return-man / kicker / punter as a real roster dimension
   with real stat lines (§3.4).
4. **OT** — **YES**, add the coin-flip; folded into P2 (§8).
