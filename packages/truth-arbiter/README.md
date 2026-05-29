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

pnpm --filter @gmsim/truth-arbiter typecheck
```

> Note: use `pnpm run search` (not `pnpm search`, which is pnpm's registry search).

## Status

First cut complete: scraper + structured corpus (3,334 picks, 2014–2026) +
combine testing merged (2,559 picks, 2,103 with a 40-time) + embedding index
(3,212 write-ups). NGS scores and combine coverage both populate nearly all
of Rounds 1–4 and taper through Day 3, matching real coverage.

## Next (the Truth Arbiter agent — not built yet)

An agent that, given a GMSim-generated draft class / rosters, runs distribution
checks against `corpus.json` (e.g. "your R1 overall-score spread is 78–99 but
real is 84–95", "you draft too many QBs in R1", "your generated EDGEs average
290 lbs vs real R1 EDGE ~260") and uses `embeddings.json` to ground generated
profiles/prose against the real corpus.

## Caveats

- nfl.com's ToS restricts scraping; this is low-volume, cached, rate-limited
  (≈1 req/sec) personal calibration use.
- Requires Node 20+ and a local Ollama install for the embedding step.
