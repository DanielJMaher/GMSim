# @gmsim/truth-arbiter

A ground-truth corpus of **real NFL draft history (2014–2026)** used to verify
that GMSim's generated rosters and draft classes are realistic.

This package lives **outside** the pure-TS engine on purpose: it does I/O
(network, filesystem, a local LLM). It never imports into the engine; it's a
calibration/verification tool that reads engine output.

## Source layout (agent families)

The agents are grouped by the realism domain they police. Each agent is a CLI
entrypoint (see Commands); shared plumbing lives in `lib/`.

```
src/
  lib/          shared infra — no entrypoints
                config (paths), types, csv, engine-bridge (built-engine consumer)
  corpus/       text corpora the realism + voice work draws on
                scrape · embed · search   (NFL.com prose corpus, Ollama)
                beast · pff               (scouting-VOICE corpus — Brugler + PFF)
                fetch · parse-round · combine · outcomes · ollama  (corpus helpers)
  draft-model/  draft-CLASS realism (grades, talent spread, measurables)
                arbiter · arbiter-class · arbiter-outcomes · class-build
                class-talent · ras
  media/        media-SPREAD realism + its data scrapers
                ombudsman · nmdd · ndb
  sim/          on-field sim realism + talent taxonomy
                magistrate · star-separation · skill-adjudicator
                conversion · slot-diag
  cap/          salary-cap realism
                liquidator · cap-usage-probe
  voice/        scouting-VOICE + player-BACKSTORY realism (reads corpus/ sources)
                scribe · narrator (+ lexicon helper)
```

**The Scribe** (`voice/scribe.ts`) is the voice authority: it reads the Beast +
PFF corpora and emits an empirical voice profile — source fingerprints (Brugler
runs long and bullet-heavy; PFF is terse and comp-happy), a polarity lexicon
(which words signal a strength vs a weakness, by weighted log-odds), the
vocabulary each position group over-uses, and the NFL-comp inventory. It writes
a `scribe-profile.json` spec, and its position vocabulary is wired into the
engine (`media/scout-vocabulary.ts`): generated prospect takes now carry a
position-aware `{trait}` (QB "pocket poise / arm talent", EDGE "edge-setting
strength / corner-bending ability", CB "press-man cover skills") instead of a
generic "{pos}". `run scribe audit` samples the generated takes to eyeball it.

**The Narrator** (`voice/narrator.ts`) is the backstory authority: it mines the
`background` bios into a taxonomy for generating realistic player origins —
recruiting pedigree (the star-rating distribution), pedigree × draft round (the
real correlation: blue-chips cluster early, the under-recruited slide to Day 3 /
UDFA), backstory motifs (transfer / redshirt / walk-on / football bloodline /
multi-sport / hardship), and home-state geography. Its `audit` mode generates a
GMSim class and prints the engine's pedigree×round + motif rates next to the
real targets — the calibration lens for tuning generation toward reality.

## Why two artifacts

Verifying "are our generated classes realistic?" is mostly a **distributional**
question (score curves by round, positional frequency, size norms) — that's
structured data, not vector similarity. So the corpus has two parts:

1. **`data/corpus.json`** — every pick as a structured record: year, round,
   overall pick, team, name, position, college, measurables (height/weight/
   arm/hand/wing), the three NGS scores (Production / Athleticism / Overall),
   **combine athletic testing** (40 / bench / vertical / broad / 3-cone /
   shuttle), and the scout write-up. This powers the quantitative checks.
2. **`data/embeddings.json`** — each write-up embedded with
   `nomic-embed-text` (768-dim) for **semantic** retrieval ("which real
   prospects resemble this generated player?"). A layer on top of the stats.

Both are git-ignored (large, regenerable, and not ours to redistribute).

## Source

**Picks + scores + write-ups + size:** NFL.com draft tracker, e.g.
`https://www.nfl.com/draft/tracker/2014/rounds/1` — server-rendered HTML,
parsed directly (no headless browser). The parser anchors on **label text**
("Production", "Overall Score", "PROSPECT ANALYSIS"), not the volatile
Tailwind class names, so it survives year-to-year markup tweaks. Raw HTML is
cached under `data/raw/` — re-runs only re-parse, never re-fetch.

**Combine athletic testing:** the open [nflverse combine dataset](https://github.com/nflverse/nflverse-data/releases/tag/combine)
(CSV), joined to each pick by draft year + overall pick (name fallback for
the rare mismatch). We use nflverse here because nfl.com renders the workout
numbers client-side and Pro-Football-Reference sits behind a Cloudflare
challenge — nflverse publishes the same data cleanly and openly.

## Commands

```bash
# Scrape → structured corpus (all years, or pass specific years)
pnpm --filter @gmsim/truth-arbiter scrape
pnpm --filter @gmsim/truth-arbiter scrape 2014 2015

# Embed write-ups → semantic index (needs Ollama running + model pulled)
ollama pull nomic-embed-text
pnpm --filter @gmsim/truth-arbiter embed

# Semantic search demo over the write-ups
pnpm --filter @gmsim/truth-arbiter run search "explosive edge rusher with rare get-off"

# Arbiter check: physical/athletic realism of a generated class vs real drafts
# (requires the engine built: pnpm --filter @gmsim/engine build)
pnpm --filter @gmsim/truth-arbiter run arbiter

# Per-class realism + class-to-class variance (does the generator vary like
# real classes do — deep-WR years, barren-QB years?)
pnpm --filter @gmsim/truth-arbiter run class <seed|nickname>   # grade one class
pnpm --filter @gmsim/truth-arbiter run class variance [N]      # variance vs real
# Named-seed registry (regression tracking — recall a class after tweaks):
pnpm --filter @gmsim/truth-arbiter run class name "deep WR class" <seed>
pnpm --filter @gmsim/truth-arbiter run class list

# Real career-outcome curves by round ("did the pick pan out": wAV, Pro Bowl
# rate, starter tenure, bust rate) — the reference for the development model.
pnpm --filter @gmsim/truth-arbiter run outcomes
# Phase B — generated outcomes via forward-sim (slow), compared to real curves.
pnpm --filter @gmsim/truth-arbiter run outcomes sim [years]

# Skill Adjudicator — talent-grade + accolade GUARDRAIL. Run after any
# generation/development tweak to confirm we stayed in the tier guardrails.
pnpm --filter @gmsim/truth-arbiter run adjudicate          # generated grade dist (fast)
pnpm --filter @gmsim/truth-arbiter run adjudicate sim [N]  # post-development + Pro Bowl/All-Pro rates

# Magistrate — DRIVE-LEVEL realism bar from real NFL play-by-play (nflverse).
# Outcome mix, points/plays/yards per drive, 3rd-down %, red-zone TD % — the
# targets the (forthcoming) matchup-driven sim must hit.
pnpm --filter @gmsim/truth-arbiter run magistrate [startYear endYear]

# The Scribe — scouting-VOICE profile from the Beast + PFF guides. Source
# fingerprints, strength/weakness polarity lexicon, per-position vocabulary,
# NFL-comp inventory. Aggregate stats only (no verbatim copyrighted text).
# Also writes data/voice/scribe-profile.json — the machine-readable voice spec.
pnpm --filter @gmsim/truth-arbiter run scribe
# audit mode: sample GMSim's generated prospect-take headlines (needs the engine
# built) so the position-aware phrasing is eyeballable.
pnpm --filter @gmsim/truth-arbiter run scribe audit

# The Narrator — player-backstory taxonomy from the bios. Recruiting pedigree,
# pedigree x draft round, backstory motifs, home-state geography.
pnpm --filter @gmsim/truth-arbiter run narrator
# audit mode: GMSim's generated backstories vs the real targets (needs the
# engine built) — pedigree x round + motif rates side by side with deltas.
pnpm --filter @gmsim/truth-arbiter run narrator audit

pnpm --filter @gmsim/truth-arbiter typecheck
```

> Note: use `pnpm run search` (not `pnpm search`, which is pnpm's registry search).

## Status

First cut complete: scraper + structured corpus (3,334 picks, 2014–2026) +
combine testing merged (2,559 picks, 2,103 with a 40-time) + embedding index
(3,212 write-ups). NGS scores and combine coverage both populate nearly all
of Rounds 1–4 and taper through Day 3, matching real coverage.

## Arbiter checks

`arbiter.ts` is the first verification check: it generates a GMSim draft class
(via the engine) and compares every measurable/combine metric, by position
group, against the real corpus — flagging any cell off by ≥0.5 real σ. This
validates the engine's size/athletic baselines (`draft/measurables.ts`) against
reality and points at exactly what to tune. The engine is consumed via its
built `dist` (see `engine-bridge.ts`), so build it first.

Future checks (not built): positional draft-frequency, grade-curve by round,
and semantic grounding of generated scouting prose via `embeddings.json`.

## Caveats

- nfl.com's ToS restricts scraping; this is low-volume, cached, rate-limited
  (≈1 req/sec) personal calibration use.
- Requires Node 20+ and a local Ollama install for the embedding step.
