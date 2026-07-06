---
name: gmsim-research-methodology
description: The discipline that turns a hunch into an accepted GMSim result — the evidence bar (one mechanism explains ALL observations including negatives), predict-numbers-before-running, the idea lifecycle from probe to adopted change or documented retirement, and where good ideas historically come from. Load when starting any investigation or calibration project, or when evidence feels "good enough" and you're about to ship on it.
---

# GMSim research methodology

The project's epistemics in one line: **a claim is a number, a mechanism, and an instrument — or it isn't a claim.** This file is the lifecycle and the bar; the recipes live in `gmsim-proof-and-analysis-toolkit`.

## When NOT to use this skill

- The analysis techniques themselves → `gmsim-proof-and-analysis-toolkit`
- Which instrument measures what → `gmsim-diagnostics-and-tooling`
- Whether a finished result may ship → `gmsim-change-control`

## The evidence bar

1. **One mechanism must explain ALL observations — including the negatives.** A hypothesis that explains the drift but not why three other bands stayed put is incomplete. Worked precedent: the v0.175 investigation held out until ONE frame (retention channels with no record-awareness) explained the #1-QB drop AND the unchanged league-wide churn gradient AND the unchanged retention aggregate. The v0.176 sag investigation had to explain why CASH pace held while CAP usage sagged — which is what located the real mechanism (charge timing, not spending).
2. **Predict numbers before running.** Write the expected post-change values down first (in the plan, the probe header, or the PR text). A confirmed prediction is evidence of understanding; a surprise — even a favorable one — reopens the mechanism question. The contract-shape slice predicted the floor-window arithmetic (≈81% effective target) before measuring it.
3. **Survive adversarial refutation.** Before shipping, actively try to kill your own result: run the A/B that could exonerate the old code (Recipe 2), check the metric on seeds you didn't tune on, and check every NEIGHBOR instrument (the levers table names couplings). Historical convictions-by-refutation: the "orphan node processes" theory (2026-07-03) died on one `Get-CimInstance` — they were the dev server; the carousel "regression" died on a 4-seed probe.
4. **Negative and null results are shippable.** The v0.165 infeasibility proof and the v0.172 dormancy finding are both permanent assets. "We measured it and it doesn't work" ends a swamp; write it into the CHANGELOG/archaeology with the same rigor as a win.

## The idea lifecycle

```
hunch → archaeology check → probe (baseline first) → mechanism statement
     → prediction in numbers → (design sign-off if vision-central)
     → implementation → re-probe vs prediction → neighbor gates
     → adopted (CHANGELOG w/ numbers) | retired (documented, fenced)
```

- **Archaeology check** (`gmsim-failure-archaeology`): the battle may be settled or the path fenced. Re-fighting settled battles is the most expensive failure mode this repo has.
- **Baseline first**: the probe runs on the CURRENT dist before any change (Recipe 7) — it validates the probe itself and anchors the comparison.
- **Mechanism statement**: one paragraph, written, naming the causal path — not "X is low" but "X is low BECAUSE flow A defers to future years while gate B prices against older caps."
- **Design sign-off**: vision-central mechanisms get Daniel's approval pre-code (unwritten law #2). Calibration-within-design proceeds, then reports.
- **Neighbor gates**: levers are coupled (cap↔star-tier inflation, anchors↔auction divisor, qbPlay↔draft pipeline). The instrument list for the family AND its named neighbors, fresh caches.
- **Adopted**: CHANGELOG entry with the decomposition table, before→after vs real bar, instrument + n, residuals named. **Retired**: the negative goes into the CHANGELOG/archaeology with symptom→evidence→fence so it stays dead.

There are no experiment flags in this codebase (as of 2026-07-04): experiments live as PROBES against dist, not as flagged engine paths. If an experiment truly needs an engine flag, it must be documented as experimental at the definition and removed (not abandoned) when settled — precedent strongly favors probe-first instead.

## Statistical honesty

- Know your n: Goatinator 12×32 gives n=384 #1-picks (±4–5pp); an 8×8 probe is n=64 (±12pp) — mechanism shape only, never calibration verdicts. State the n with every share/rate claim.
- Determinism kills run-to-run noise but NOT seed-to-seed variance: rate claims need multiple seeds; single-seed changes are anecdotes.
- Bands are wide by design; steering happens against the real number ("real 9.5 is the star to steer by"), shipping happens against the band.
- Beware metrics that conflate channels (a "changed primary QB" rate includes benchings AND contract churn — the v0.175 investigation had to split them before the churn number meant anything).

## Where good ideas historically come from

Ranked by track record in this repo:
1. **Daniel's eyeball findings** in the inspector (the v0.159–v0.160 findings queue; birth-cap Browns find) — the inspector exists to make his pattern-recognition cheap; keep perceived/real pairs visible.
2. **Agent drift flags** — most calibration slices started as a `<-- DRIFT` row (EDGE flood, pass delta, points drift).
3. **Real-bar gaps found while deriving specs** — modeling work that starts from the real table exposes what the engine lacks (game script came from the pass-delta bar; void years from the OTC structures).
4. **Archaeology residuals** — the "named residual" list is a standing idea queue with pre-built context.
5. **Seam audits after incidents** — the v0.175 dating bug prompted checking EVERY seasonHistory consumer; one incident, systematic sweep, several latent finds. Generalize the incident before closing it.

## Provenance and maintenance

- Precedents cited: CHANGELOG `[0.165.0]`, `[0.172.0]`, `[0.175.0]`, `[0.176.0]`; probe names therein.
- Experiment-flag claim ("none exist"): re-verify with `Grep -i 'experiment' packages/engine/src` before repeating it.
- This methodology is descriptive of practice through v0.177.0 — if practice evolves (e.g. real experiment flags arrive), update the lifecycle section in the same slice.
