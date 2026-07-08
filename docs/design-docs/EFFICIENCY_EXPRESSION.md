# Efficiency Expression — quality as explosiveness, not sustainment

**Status:** DESIGN — APPROVED 2026-07-08 (Daniel's three calls recorded in §9);
**checkpointed multi-step slice.** Vision-central competitive-model slice;
**fenced** (touches `passEdge` → the #1-QB pipeline). This is the W-L pass-delta
campaign's named **endgame lever #1**, promoted to a full slice because the
game-sim rebuild's red-zone grind (P5) exposed and amplified the skew it targets.

**HARD INVARIANT (Daniel, 2026-07-08): the coin flip is never an acceptable
outcome — we simulate entire games, not parts of them.** Play-by-play drives
that sim all the way through the red zone are fixed; the skew MUST be solved with
the grind in place. "Revert to the coin flip" is NOT a fallback anywhere in this
plan. **Target: W-L pass delta ~10** (real 9.5), not merely inside the band.

Cross-refs: `.claude/skills/gmsim-wl-pass-delta-campaign` (the campaign),
`docs/design-docs/GAME_SIM_REBUILD.md` (P5 / the grind), probe
`packages/truth-arbiter/data/_p5_snapskew.mjs` (the evidence below).

---

## 1. The problem, precisely

The W-L pass delta (winners' pass yds/game − losers') is **+9.5 in real football**
but **~25–28 in the sim**. Four campaign rounds and the whole rebuild established
that this is **not** an efficiency problem and **not** a red-zone problem — it is a
**volume** problem driven by **drive-length skew**.

The campaign's decomposition (real n=7,493 team-games, sim n=65,269):

| | real Δ(W−L) | sim Δ(W−L) |
|---|---|---|
| pass yds/g | **+9.5** | **+32.8** |
| attempts/g | **−4.8** (losers throw MORE) | **−1.6** |
| comp% | +5.9 | +5.0 |
| yds/att | +1.29 | +1.36 |
| decomp | −34.7 vol / +44.1 eff | −12.2 vol / +45.0 eff |

**The efficiency side already matches real** (eff-part 45.0 vs 44.1; comp% and
yds/att deltas are right). The entire gap is **volume**: real losers out-attempt
winners by 4.8/game; sim losers by only 1.6. Winners get too many attempts.

Why? **Winners sustain longer drives → more snaps → more attempts.** The snap-skew
probe (`_p5_snapskew.mjs`, current grind build, single-season):

```
WIN   plays/drive 6.76   pass 234.2   rush 115.3
LOSS  plays/drive 6.13   pass 206.1   rush  68.2
Δ     plays/drive +0.63          PASS Δ 28.1
```

Winners grind **+0.63 plays/drive** (+5.2 plays/game). That snap surplus × the pass
rate ≈ the whole excess pass delta. Real winners' plays/drive edge is ~symmetric.

**The rebuild connection:** with the red-zone coin flip, the skew is ~0.18 (the flip
truncates scoring drives at the 20, and winners score more, so it clips *their*
drives most — masking the skew). Remove the flip so drives grind to the goal and the
skew balloons to **0.63**. The grind is worth keeping (it's realistic, scoring is on
the Magistrate bar); it just re-exposes this root cause at full strength.

---

## 2. Root cause: `passEdge` sustains instead of strikes

In `resolvePlay` (drive-sim.ts) a team's passing edge expresses on **two** channels:

```
comp_rate    = BASE_COMPLETION (0.655) + passEdge · K_comp   (K_comp = 0.004)
yds/complete = YDS_PER_COMPLETION (11.5) + passEdge · K_yds   (K_yds  = 0.05)
```

The **completion-rate** channel is the culprit. A better team completes more passes
→ converts more first downs → **the drive stays alive longer** → more plays, more
snaps, more attempts. Quality buys **sustainment**. Real quality buys
**explosiveness** — good offenses strike bigger and score in *fewer* plays, so their
possessions aren't systematically longer than a bad team's.

Per edge point, yards-per-attempt currently comes 58% from the completion channel,
42% from the yards channel:

```
∂YPA/∂edge = K_comp·(yds/comp) + comp_rate·K_yds
           = 0.004·11.5 + 0.655·0.05  =  0.046  +  0.033  =  0.079 yds/att/edge
                    (completion: 58%)     (yards: 42%)
```

The completion-weighted half of a team's edge is exactly the part that lengthens its
drives.

---

## 3. The lever: rotate the edge from completions to yards

Shift weight off `K_comp` onto `K_yds`, **holding `∂YPA/∂edge` (hence points-per-edge,
hence wins) fixed** — so the same quality produces the same points, but via bigger
strikes and *fewer plays*:

```
0.079  =  K_comp'·11.5 + 0.655·K_yds'      (the constant-YPA-per-edge line)
```

| shift | K_comp' | K_yds' | quality comp% Δ | quality yds/att Δ |
|---|---|---|---|---|
| today | 0.004 | 0.050 | +5.0pp | (baseline) |
| half | 0.002 | 0.085 | +2.5pp | bigger |
| full | 0.000 | 0.120 | 0.0pp | biggest |

(comp% Δ uses the measured W−L edge gap ≈ 12.5: `0.004·12.5 ≈ 5.0pp`.)

Rotating toward yards makes a good team's drives **shorter** (it scores in fewer,
bigger plays) → the +0.63 plays/drive skew shrinks → winner attempts fall → the loser
attempt advantage grows toward the real −4.8 → **pass delta falls**, with the efficiency
deltas (which already match real) **preserved in aggregate** — comp% delta trades down,
yds/att delta trades up, YPA holds.

**But** rotating off `K_comp` drops the sim's comp% delta below the real +5.9 unless
something replaces it. That is the derivation obligation.

---

## 4. Derivation obligation (do this FIRST — it gates the whole slice)

The campaign's standing warning: *"the sim's +5.0 comp% delta currently matches real
via quality alone; naively halving the coupling breaks that match."* So we must know
**how much of the real +5.9 W-L comp% delta is quality vs game-state.**

**Derive from pbp (2015–2024):** split the real W-L completion% gap into
1. **Quality** — comp% by team-season passing rank (good teams complete more, all game
   states equal), and
2. **Game-state** — comp% by score-differential-at-snap (leading teams throw short/safe
   → high comp%, low air yards; trailing teams throw deep/desperate → low comp%, high
   air yards, high volume).

New probe `_wl_comppct_decomp.mjs`: for each pass, bucket by (passer team-season comp%
quantile) × (score diff bucket). The marginal of each isolates the two components.

**The result decides the mechanism (but NOT whether the grind ships — that's fixed):**
- If the real comp% delta is **substantially game-state** (expected — leading teams'
  check-down comp% is a known effect), then we **move** that share out of `K_comp`
  (quality) and into a new **game-state comp% channel** (below). Net comp% delta holds;
  the quality→sustainment coupling is what shrinks. **The lever is justified — primary path.**
- If it's **mostly quality**, the comp%↔sustainment rotation can't carry the whole load
  without breaking the comp% match. The coin flip is NOT a fallback (hard invariant). We
  turn to the **alternative explosiveness channels** in §8a — a quality-scaled big-play
  (explosive-completion) rate, and/or making down-conversion itself less quality-elastic —
  which shorten winners' drives without touching the comp% mean. The derivation still
  matters: it tells us how much of the skew the comp%-rotation can carry vs how much the
  alternatives must.

**Also derive** the real W-L **yds/att-by-score-state** curve — the trailing-deep /
leading-checkdown yards split — to calibrate the game-state channel's yards term so the
efficiency-by-state matches real, not just the aggregate.

---

## 5. The mechanism (three coupled changes)

Assuming the derivation supports it:

1. **Reduce `K_comp`** (quality → completion%) — from 0.004 toward the value that leaves
   only the *quality* share of the comp% delta (e.g. 0.002 if game-state is ~half).
2. **Add a game-state efficiency channel**, driven by the existing `scriptShift`
   (already the score-state signal): leading → +comp% / −yds (check-downs, clock-kill,
   already run-tilted → shorter possessions); trailing → −comp% / +yds (deep shots) on
   top of the existing volume tilt. Constants derived in §4, **mean-neutral** (centered
   so the league comp%/YPA means hold; only the W-L spread and its *source* move).
3. **Increase `K_yds`** (quality → yds/complete) along the constant-YPA line (§3) so
   points-per-edge — and therefore the win distribution and the #1-QB pipeline — are
   held fixed.

Calibration target is the **grind** build (skew 0.63), not the coin-flip build (0.18) —
this lever must be stronger than the campaign's original 0.18→0.06 scope. That strength
is the main risk (see §7).

---

## 6. Predictions to hold (write into the slice before running)

- plays/drive skew **0.63 → toward ~0.1** (probe `_p5_snapskew.mjs`); real is ~symmetric.
- Scorekeeper **W-L pass delta → ~10** (real 9.5 — the explicit target, not just band ≤32).
- attempts gap **−1.6 → toward −4.8** (the volume fix — the whole residual is here).
- comp% delta stays **~+5–6** (now quality + game-state), yds/att delta stays **~real**;
  points mean/sd, pass yds mean/sd, rush yds, pass att, giveaway delta, rush delta
  (≤55), pointsDrift — **all in band**.
- Magistrate drive bar unchanged (TD/FG/points-per-drive); this is a per-play efficiency
  rotation, not a scoring change.
- **Goatinator #1/#2/#3 QB shares unchanged** — the dual-gate (see §7).

Any of these missing → the mechanism reopens; trading one band for another is failure.

---

## 7. Fences & the dual-gate (why this is careful, not casual)

- **`passEdge` is the v0.164 #1-QB pipeline.** Team record ← wins ← `passEdge` → the
  draft-order → the #1-QB share (real bar 75%). The lever changes only the *expression*
  (comp% vs yds split), **not the magnitude** and **not the `qbPlay` 0.65 weight**, and
  holds points-per-edge fixed — so wins, records, and draft order should be invariant.
  **But this is dual-gated:** the slice MUST re-run the Goatinator and show #1/#2/#3 QB
  shares hold. If they move, the lever is touching the pipeline and stops.
- **`leagueRecenter`'s uniform-shift property** must be preserved (scoring constants are
  fenced for it) — the game-state channel keys off `scriptShift`, not off raw team
  scoring, to stay recenter-safe.
- **The game-script pass-RATE shape is locked** (v0.153, real pbp table). This slice adds
  an *efficiency*-by-state channel; it does **not** retune the rate table.
- **INT exposure:** more trailing-team deep shots (game-state channel) raises the loser
  INT rate — cross-check the giveaway delta (−0.4, floor −0.3) moves toward real (−0.9)
  and stays in band.

---

## 8. Sequencing with the red-zone grind

The grind (branch `p5-redzone-grind-wip`, run-tilt build) is a **fixed part of the
release** — the coin flip does not come back. This lever (± the §8a alternatives)
carries the delta while the grind carries the realism. Order of work:
derive (§4) → implement the comp%→yds rotation + game-state channel → confirm the skew
drops on the coin-flip base (fast to iterate) → drop in the grind (remove coin flip,
apply RZ run-tilt) → joint recalibrate to the ~10 target → full validation +
Goatinator. The grind ships; the only open question is *which mix of levers* gets the
delta to ~10, never *whether* we grind.

### 8a. Alternative / supplementary explosiveness channels

Because the coin flip is off the table, the delta must reach ~10 with the grind in
place — and the comp%→yds rotation may not carry all of a 0.63 skew alone. Reserve
these, calibrated by the §4 derivation:

- **Quality-scaled explosive-completion rate.** Instead of (or with) raising the
  yds/comp *mean*, give higher-`passEdge` offenses a higher rate of *explosive*
  completions (20+ yd) — a second, heavier tail on the completion-gain draw. Good
  teams score in fewer plays via the occasional chunk, not by completing more often.
  This shortens winner drives while leaving comp% mean (and its delta) untouched — so
  it works even if §4 says the comp% delta is mostly quality.
- **Quality-inelastic down conversion.** The skew is ultimately a *conversion-rate*
  gap (winners keep drives alive). A cap on how much team quality can lift the
  first-down conversion rate — expressed through explosiveness above the cap instead —
  attacks the skew at its source.
- Each is its own mean-neutral, probe-first sub-step; we add only what the numbers
  demand to hit ~10, and re-validate every band + the Goatinator each time.

---

## 9. Decisions (Daniel, 2026-07-08) & the step plan

1. **Scope:** checkpointed multi-step slice — I stop and report at each checkpoint below.
2. **No coin flip, ever** — we simulate entire games. Hard invariant (see header). If the
   comp% rotation falls short, §8a carries the rest; the grind ships regardless.
3. **Target ~10** (real 9.5), not just in-band.

**Checkpointed steps** (each is a stop-and-report gate):

- **C1 — Derivation** (`_wl_comppct_decomp.mjs`, read-only). Decompose the real W-L comp%
  delta (+5.9) and the yds/att-by-score-state curve into quality vs game-state. Report the
  split → it sets the K_comp reduction and the game-state channel constants. Cheap; no code.
- **C2 — Inspector game lab** (§10). Build the box-score + drive-analysis view first, so C3+
  are eyeballed live, not just probed. Ships as its own inspector slice (no engine risk).
- **C3 — Lever on the coin-flip base.** comp%→yds rotation + game-state channel; confirm the
  skew drops and every Scorekeeper band holds + Goatinator QB shares hold. Checkpoint.
- **C4 — Drop in the grind.** Remove the coin flip, apply the RZ run-tilt (branch work);
  joint-recalibrate. Add §8a channels only as the ~10 target demands. Checkpoint.
- **C5 — Full validation + release.** All bands at delta ~10, skew ~0.1, Goatinator green,
  Magistrate green, targeted tests, CHANGELOG. Normal release; push on Daniel's call.

## 10. The inspector as calibration lens: game box scores + play-by-play drives

Daniel (2026-07-08): expose **game box scores** and **play-by-play drive analysis** in the
inspector. This is both a lasting feature and the live lens for C3–C5 — it replaces the
throwaway probes (`_p5_snapskew`, `_redzone_bars`) with an eyeballable surface so the skew,
the RZ behavior, and the W-L splits are visible as the levers move.

**Inspector-sanctioned, not North-Star-gated:** these are ground-truth *sim outputs* (the
engine's own box score / drive log), and the inspector is the explicit calibration
exception. No `ProspectSnapshot` layer applies. (A future *player-facing* game-center would
read a knowledge-layer view; that's out of scope here.)

**Data path — deterministic re-sim, no storage.** `simulateGameWithDrives` already returns
everything: `DriveGameResult { homeScore, awayScore, driveLog: DriveOutcome[], playerStats:
Map }`. `DriveOutcome` carries `{ offense, result, plays, yards, clock, start }` per drive.
The inspector calls it directly on the current `LeagueState` for a chosen matchup + seed —
determinism means the same seed reproduces the same game, so nothing needs to be persisted.
Confirm `simulateGameWithDrives` is on the public `@gmsim/engine` surface (it's exported
from `drive-sim.ts`; add to `index.ts` / the `./games` subpath if not).

**The view — a "Game Lab" panel:**
1. **Single game.** Pick home/away (dropdowns over league teams) + a seed → sim. Render:
   - **Box score:** team totals (points, pass/rush yds, attempts, comp%, sacks, TOs, FG/XP,
     punts) side by side, then per-player stat lines (QB passing, rushers, receivers,
     defense, ST) — driven by the new P4b stat fields.
   - **Drive chart:** the `driveLog` as a drive-by-drive table — # · offense · start field
     position · result · plays · yards · clock — with points accrued. A compact field-strip
     visual per drive (own-X → end-X, color by result) makes RZ behavior legible.
2. **Aggregate / calibration mode.** Sim N games (e.g. 200) of a matchup or league-wide;
   show the bars that matter for this slice **split by W/L**: plays/drive, pass yds, rush
   yds, attempts, comp%, drive-outcome mix. This is the `_p5_snapskew` view, live — the
   skew (WIN vs LOSS plays/drive) reads right off it, next to the real bars.
3. **Real bars alongside.** Where a real number exists (drive-outcome mix, plays/drive, the
   W-L deltas), show it beside the sim value — the inspector's perceived/real discipline
   applied to team-level bars, so the gap is always visible.

**Build note:** engine stays pure (it already returns the data); this is all `apps/web`.
Keep it a self-contained panel/route; heavy aggregate sims run on a click, not on mount.
Sequenced as **C2** so C3–C5 are validated by eye as well as by probe.
```
