# Game Sim: Real Clock Model + Winner/Loser Parity — Implementation TODO

**Status:** design + findings only. The clock model below was built and
measured in a v0.159 spike, found NOT to fix the W-L pass delta on its own
(see Root Cause), and **reverted** to keep `main` clean. This doc preserves
the full design so it can be re-implemented properly, *together with* the
parity mechanism that actually closes the flag.

**Motivation:** the Scorekeeper's last remaining game-sim flag is the
**winner-vs-loser passing-yards delta** — GMSim winners out-pass losers by
~35 yds/game vs real **+9.5** (band ≤32). Everything else is on the real
bar: Magistrate drive mix 0 drift (TD/FG/punt/turnover/yards-per-drive),
Scorekeeper box score in band (pass ~256, points ~24, home win ~58%).

---

## 1. Root-cause analysis (instrumented — do not re-litigate)

Three hypotheses were tested with `_wl_passing_probe.mjs` (winner/loser
pass & rush split) on the live sim:

1. **Per-snap efficiency?** NO. GMSim winner/loser yards-per-attempt is
   8.1 / 6.9 (gap +1.2) vs real 7.4 / 6.0 (gap +1.4). Efficiency separation
   is already real. A per-snap efficiency channel (stars do more per snap)
   is a *separate, valuable* player-realism slice (Actuary A2) but does NOT
   touch this flag.
2. **Possession / clock?** NO (this is the key negative result). A full
   clock model with hurry-up/clock-burn (Section 2) was built and measured:
   the W-L delta did **not** shrink (stayed ~34). Reason: possessions
   alternate, so hurry-up adds plays to **both** teams; the clock changes
   *how many* possessions a half holds, not the *per-drive length* gap.
3. **Drive length × team quality?** YES. The winner runs ~6 more plays
   than the loser (59.7 vs 53.9; real ~63/62) because **it is the better
   team and sustains longer drives** while the loser stalls. In GMSim,
   team quality determines *both* who wins *and* who sustains drives, so the
   winner is structurally also the longer-drive team → more plays → more
   yards. Real football has play-count parity because **winning is not
   purely team quality** — turnovers, special teams, and variance let worse
   teams win and better teams lose, decoupling "winner" from "longer drives."

**Implication:** the flag is fixed by Section 3 (parity), not Section 2
(clock). The clock is realism for its own sake; build it only if that
realism is wanted, and know it carries calibration debt (Section 2.4).

---

## 2. Part A — The real clock model (realism layer; reverted, re-buildable)

Replaces the fixed play budget (`HALF_PLAYS = 62`) with a real game clock.
All in `packages/engine/src/games/drive-sim.ts`.

### 2.1 Constants
```ts
const HALF_SECONDS = 1800;        // 30 minutes
const PLAY_CLOCK_RUN_S = 40;      // clock-running play: burns play clock to next snap
const PLAY_CLOCK_STOP_S = 6;      // clock-stopping play: only the snap elapses
const OOB_CHANCE = 0.12;          // completion/run out of bounds → clock stops
const TEMPO_HURRY_MAX = 0.5;      // trailing late: run-play time ×(1−0.5)=20s
const TEMPO_BURN_MAX = 0.15;      // leading late: ×(1+0.15)=46s (asymmetric — burn is modest)
```

### 2.2 Per-play time
```ts
function playClockSeconds(kind: PlayKind, prng: Prng, tempo: number): number {
  if (kind === 'incomplete' || kind === 'int' || kind === 'fumble') return PLAY_CLOCK_STOP_S;
  if ((kind === 'complete' || kind === 'run') && prng.next() < OOB_CHANCE) return PLAY_CLOCK_STOP_S;
  return PLAY_CLOCK_RUN_S * (1 + tempo); // tempo<0 hurry-up, tempo>0 clock-burn
}
```
A 4th-down kick/change and a defensive penalty both cost `PLAY_CLOCK_STOP_S`.

### 2.3 Tempo (the hurry-up / clock-burn behaviour)
```ts
function tempoFactor(scoreDiff: number, progress: number): number {
  if (progress < 0.5) return 0;                 // no tempo effect in the 1st half
  const lateness = progress < 0.75 ? 0.4 : 1;   // mild in Q3, full in Q4
  if (scoreDiff < 0) {                           // trailing → hurry-up (faster)
    return -TEMPO_HURRY_MAX * lateness * clamp(-scoreDiff / 16, 0, 1);
  }
  return TEMPO_BURN_MAX * lateness * clamp(scoreDiff / 16, 0, 1); // leading → burn
}
```

### 2.4 Integration
- `simulateDrive(prng, ctx, startYardline, attr, scriptShift, secondsRemaining = Infinity, tempo = 0)`
  returns `{ result, plays, yards, secondsUsed }`. Funnel every exit through
  a `done(result, yards)` helper that captures `plays` + `secondsUsed`.
  Accumulate `secondsUsed += playClockSeconds(...)` per play; at the top of
  the loop, `if (secondsUsed >= secondsRemaining) return done('END_HALF', …)`
  (a possession cut off by the half is realistic and feeds the Magistrate's
  ~7.4% "End of half/game" bucket).
- `runGame`: per half, `let clock = HALF_SECONDS; while (clock > 0) { drive =
  playDrive(tag, clock); clock -= drive.secondsUsed; flip; }`. Game-script
  `progress` becomes elapsed game **time** (`elapsed / (2*HALF_SECONDS)`),
  not a play count. OT drives pass `secondsRemaining = Infinity`.
- Drop `HALF_PLAYS` (now unused — strict `noUnusedLocals`).

### 2.5 Calibration achieved + the DEBT
- Per-play times were tuned so a neutral half ≈ 62 plays (got 62.8 → plays/
  game ~125 = real). Drive metrics ≈ pre-clock. So the plumbing is
  behaviour-neutral.
- **DEBT:** scoring% fell to ~32.6 (drift, real 36.3) because realistic
  mid-drive half-cutoffs lose some would-be scores the old between-drives
  half-end kept. FIX in re-implementation: lift `RED_ZONE_TD_BASE` ~0.48 →
  ~0.52 to restore TD%/scoring; if points then exceed the band, trim
  `YDS_PER_COMPLETION` ~11.5 → ~11.2 (the red-zone resolution decouples
  points from raw yards, so this no longer craters scoring). Verify against
  Magistrate (TD 21.7 / FG 14.6 / scoring 36.3) + Scorekeeper (points 22.8).

---

## 3. Part B — The winner/loser parity fix (what actually closes the flag)

Goal: GMSim winner/loser **plays** ≈ equal (real ~63/62) and **pass yards
delta → ~9.5** (band ≤32), without breaking the Magistrate drive bar.
The lever is to make the game OUTCOME less perfectly determined by team
quality, so the long-drive team isn't always the winner.

Three candidate mechanisms (instrument each with `_wl_passing_probe`):

1. **Outcome variance via turnovers + special teams (recommended).** Give
   takeaways and a (currently absent) special-teams/field-position channel
   more sway over WHO WINS, independent of yardage. A worse team that wins
   the turnover battle should win despite fewer yards. This raises play-count
   parity directly: the winner is no longer reliably the longer-drive team.
   - Build a light special-teams / starting-field-position model (return
     yards, a blocked kick / muffed punt rate), and let game variance
     (`VARIANCE_MIX` already exists) tilt outcomes more.
   - Calibration target: among games, correlation(team-edge, win) should
     drop toward the real ~0.6-0.7 (currently higher); winner/loser plays
     converge.

2. **Comeback drive-sustain (secondary).** A trailing team in the script
   gets a modest 3rd-down conversion boost (comeback urgency / defense in
   prevent), so its drives sustain longer and it accumulates plays. Keep it
   bounded — overdone, it makes bad teams move the ball unrealistically.
   - Hook: in `resolvePlay` or the down logic, raise effective conversion
     when `scriptShift > 0` (trailing) and `down >= 3`.

3. **Cap the winner's play-hogging (crudest, last resort).** Soft-cap how
   much one team's sustained drives dominate a half. Least physical; only if
   1 + 2 undershoot.

**Why this is a real slice, not a knob:** it touches how team strength maps
to wins (the core competitive model), which ripples to standings realism,
the Pythagorean fit (currently RMSE ~1.4, real ~1.4 — guard it stays), and
the Magistrate bar. Expect a full re-calibration pass.

---

## 4. Part C — Build sequence & calibration

1. **Clock model (Part A)** behind the existing live path; recalibrate to
   Magistrate green (red-zone-base lift, Section 2.5). Verify plays/game
   ~125, drive mix 0 drift, full suite green. Commit.
2. **Parity mechanism (Part B.1)** — special-teams/variance channel; verify
   `_wl_passing_probe` shows winner/loser plays converging + pass delta →
   band, Pythagorean RMSE held, standings spread (Scorekeeper wins sd ~3.3)
   held. Add Part B.2 if needed. Commit.
3. **Joint calibration** against ALL agents: Magistrate (0 drift),
   Scorekeeper (box + W-L deltas in band + points centred ~22.8 — folds in
   the standing yds/completion-at-ceiling residual), Adjudicate (accolades
   unaffected), full vitest suite (every scoring/stat guard).
4. Consider adding a **drives/game** check to the Scorekeeper/Magistrate
   (real ~21.6) — the clock model makes this directly measurable and it
   guards the pace nuance (plays/drive ~5.5).

---

## 5. Verification harness (already built; in `packages/truth-arbiter/data/`, gitignored)

- `_wl_passing_probe.mjs` — winner/loser pass & rush split (THE parity gauge).
- `_live_drive_probe.mjs` — live drive metrics + outcome mix.
- `_sim_timing.mjs` — perf (a non-issue: clock model ~6-10 ms/week, ~1.7% of
  a season tick; do not let perf drive the design).
- `run magistrate sim N` — drive bar (now audits the LIVE path, v0.157).
- `run scorekeeper sim 3 2` — box score + W-L deltas + win distribution.

---

## 6. Risks & notes

- The clock model is **tier-1 (real-time) fidelity bolted onto a tier-2
  (drive-based) sim**. Building it commits to that fidelity step; the project
  deliberately chose tier-2 (see `project_matchup_sim_and_magistrate`). Only
  do it if the realism is wanted for its own sake — it is NOT required to fix
  the W-L flag (Part B is).
- Every scoring change ripples to ~all season/career stat guards — run the
  full suite each iteration.
- The W-L pass delta is only ~2.8 over band and the sim is otherwise on the
  real bar; this whole effort is polish, not a correctness fix. Sequence it
  accordingly.
