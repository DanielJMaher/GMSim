# Draft-Class Variance — classes with personality, emergently

**Status: APPROVED — Daniel, 2026-07-10** (amendments applied: A2 includes
Super Bowl starters; A5 total-talent-mass-floats + the no-conservation hard
rule; "2B you NAILED"). Alpha-track workstream 3a
(design-before-code; vision-central). Daniel's rulings shaping this doc:
**variance is emergent** ("think theory of big numbers" — over many seeds some
classes are awful, some amazing, droughts and gluts included; no scripted class
templates), **gems in nearly all classes** with rates DERIVED from 20 years of
real outcomes (framework below; Opus pulls the data), **all the personalities**
("make it feel diverse and real — people aren't all the same, it's statistics").
Cross-refs: `SCOUTING_PROCESS.md` (gem *discovery* gates on coverage/scout
quality — dangerous-neglect ruling), `project_alpha_track_plan.md`.

---

## 1. Design stance: distribution, not templates

The generator should produce class-level variance the way reality does: latent
year factors + sampling noise, so "the weak QB class" is something you DISCOVER
in the media narrative, not a tag the engine rolled. Concretely, the slice is:

1. **Audit** the current generator (`draft/pool.ts`, `generate-college-player.ts`,
   `CLASS_TOP_GRADE_MULT`): measure the variance of class-level statistics
   ACROSS SEEDS today. Hypothesis: every class is statistically the same class
   (means calibrated, variance collapsed) — the audit quantifies it.
2. **Introduce latent structure** only as the real data demands: per-position
   per-year quality factors (a QB-desert year is a low draw on the QB factor),
   class-depth factor (top-heavy vs deep), small-school supply factor. Each
   factor's spread is DERIVED (§2), never invented.
3. **Validate distributions, not means** (§3) — the novel gate: match the
   real year-to-year VARIANCE of class statistics, not just the average class.

**The knowability rule (Daniel #1):** class strength must be discoverable the
way it is in real life — media narrative ("weakest QB class in a decade"),
scout chatter, board depth — never a displayed number. The Living Voice
machinery carries it.

## 2. The derivation framework (Opus pulls; bars land in truth-arbiter)

Data: nflverse `draft_picks` (1980–2026: college, round, pick, career fields),
the truth-arbiter draft-history corpus (3,334 picks + outcomes), seasonal stats
for career-quality proxies (Pro Bowls / All-Pros / games started / career AV
where available). Windows: 2000–2024 unless noted (Daniel: "last 20 years").

**A. Class-level variance bars (the emergent-personality spec):**
- A1. Positional counts per class in round 1 / top-100 — per-position mean AND
  year-to-year sd (the QB spread: 1–6 first-round QBs; RB droughts; WR waves).
- A2. Class strength: eventual Pro Bowlers + All-Pros + **Super Bowl starters**
  (started a Super Bowl at any career point — Daniel 2026-07-10) per class;
  distribution across classes (the 2011-QB-class vs 2013-QB-class spread).
- A3. Depth shape: hit rate (≥N starts or ≥1 PB) by round PER CLASS — the
  top-heavy vs deep signature; correlation between R1 quality and R3–5 quality
  within a class (are deep classes deep everywhere?).
- A4. Positional gluts/droughts joint structure: do positions swing together
  or independently? (Sets whether latent factors are per-position or share a
  class-level component.)
- A5. **R1-caliber supply per class — total talent mass FLOATS (Daniel,
  2026-07-10).** One class can carry ~50 legit first-round-grade prospects,
  another 7 — and the later rounds do NOT make up the deficit. Derive the
  spread two ways: outcome-based (players per class who reached a top-quality
  career bar regardless of draft slot) and, where recoverable, analyst
  first-round-grade counts per year. **HARD GENERATOR RULE: no conservation of
  talent — no renormalization that evens class quality mass back toward the
  mean. A weak class is weak, top to bottom, full stop.** (The engine's talent
  regrade is within-position percentile over the LEAGUE, so a weak class
  entering a strong league correctly reads as weak — verify no downstream
  system quietly re-inflates it.)

**B. The small-school / gems framework (Daniel #2, expanded):**
School tiers: Power-conference / Group-of-5 / FCS / D2-D3-NAIA (map from the
college field; a tier table is part of the deliverable).
- B1. Draft share by tier × round (how much small-school talent enters, where).
- B2. **Mid-to-late-round (R4–7) Pro Bowler rate by tier** — the gem-rate bar.
- B3. **Small-school flameout rate** (drafted R1–3, out of the league ≤3 yrs)
  vs the same for power-conference picks — the mirage rate.
- B4. UDFA gem rate by tier (the Kurt Warner tail).
- B5. Combine-riser outcomes by tier: small-school + elite measurables —
  boom-or-bust profile vs power-school equivalents.
- B6. Late-bloomer signal: older prospects / one-year producers — hit rates
  (feeds hidden career shapes already in the engine).
- B7. Positional gem geography: which positions produce small-school gems
  (OL/DB historically?) — gates where the generator PLACES hidden talent.
- B8. Draft-slide outcomes: players picked far below consensus (mock-board
  proxy where derivable) — do fallers outperform slot? (The "medical/character
  fall" payoff-vs-trap rate; feeds visit value in the scouting loop.)
- B9. Production-context gems: high-dominance FCS stats vs mediocre-P5 stats —
  which converts? (Sets how the generator couples college production to talent
  for low-visibility prospects.)

**C. Generator obligations from B:** real talent must be SEEDED in
low-visibility spots at the derived rates (small school, context-suppressed
production, late development), with discovery gated by scouting coverage +
scout quality — the engine must not mark gems; it must place them where only
good scouting looks.

## 3. Validation

- Extend the **class-talent agent** (exists) with a variance mode: N seeds ×
  M classes → distribution of A1–A4 statistics vs the real year-to-year bars.
  Flag when sim classes are too SAME (variance floor), not just off-mean.
- Gem gates: generated-pool audit (talent by school tier at the B-rates) +
  a full-cycle probe (do gems get FOUND at rates consistent with scouting
  coverage — ties to the scouting design's danger model).
- Goatinator must hold (class variance changes top-of-draft inputs — the
  #1/#2/#3 QB shares are means over many drafts and should survive honest
  variance; if they move, the variance leaked bias, not spread).

## 4. Sequencing

Derivations (Opus, data-only) can run any time — no engine risk. Generator
changes come AFTER, sized by what the audit finds. Alpha does not block on
this slice; it upgrades the pool the testers draft from.
