# @gmsim/truth-arbiter

A ground-truth corpus of **real NFL draft history (2014–2026)** used to verify
that GMSim's generated rosters and draft classes are realistic.

This package lives **outside** the pure-TS engine on purpose: it does I/O
(network, filesystem, a local LLM). It never imports into the engine; it's a
calibration/verification tool that reads engine output.

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
