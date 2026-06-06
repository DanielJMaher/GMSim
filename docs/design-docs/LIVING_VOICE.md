# Living Voice — Scouting & Media as a Living, Non-Deterministic Layer

## Status: Formal Design Document (authored 2026-06-05, Daniel-directed)

Anchors this serves (validate every decision against them):
- **North Star** (`docs/NORTH_STAR.md`) — information is attributed; the player
  learns ratings by reading, never by seeing numbers; source reliability is
  *built, not given*.
- **Living League** (`docs/LIVING_LEAGUE.md`) — stress-test #5: "Media ecosystem
  generating attributed, personality-consistent coverage **without becoming
  repetitive**." This document promotes that line from a test to a principle.
- Module docs already in force: Roster & FA Scouting (#4), Scouting Report UI/UX
  (#18), Draft / Film-Study Resolution (#19), League News & Transaction Feed (#12).

---

## 1. The Vision

You do not *see* a player's ratings. You **read** about him and infer them. This
is the Madden 2005 rookie-scouting model: a blurb is a lossy, *banded* encoding
of a hidden rating — "unbelievable arm" means THP 90+, "adequate arm strength,
more effective with medium routes" means 70–79. Critically, in that system a
*backstory* is already a coded attribute read: under RB Speed,
`"two-sport athlete, ran track" → SPD 80–89`. The sport **is** the signal.

GMSim takes that model and removes its two big limitations:

1. **It must feel alive.** Madden's blurbs were a small fixed table; you
   memorized them. GMSim's scouts and media must **never spit out the same words
   and flavors each playthrough** — that makes the game boring. Two playthroughs
   of the same world seed produce the *same players* but a *different-sounding
   league*: different scouts, different phrasings, different takes.
2. **Scouts have voice, and scouts are wrong.** A report is colored by *who*
   filed it — their vocabulary, their biases, their comps, their humor — and the
   band they assign can be off. The player learns *whom to trust* over seasons,
   never from a meter.

And the seed of all of it, the worked example we start from: a blurb like
`notableOtherSport` has to **mean something**. "Ran track at 230" is not flavor —
it is a SPEED-and-size read that says *physical freak* (DK Metcalf). Tennis
(Rosen) reads as touch / hand-eye / pocket feel. Basketball (Darnold) reads as
athleticism the tape didn't credit. If we surface a second sport, it must encode
a real, readable attribute — modulo the scout's error.

---

## 2. Core Principle — the Determinism Split

GMSim's engine is pure and seeded: ground truth reproduces from the world seed,
saves serialize it, and the engine never calls `Math.random()`. **Voice does not
get to break that — it reconciles with it.**

The reconciliation is a **two-seed model** plus a **corpus-fed vocabulary**:

| Layer | Seed source | Serialized? | Reproduces in a save? | Same across new games of one world seed? |
|---|---|---|---|---|
| **Ground truth** (players, ratings, measurables) | world seed | yes | yes | **yes** — same players every time |
| **Perception** (each source's banded read of an attribute) | **voice seed** | yes | yes | **no** — different opinions each new game |
| **Expression** (the exact words, comps, humor) | voice seed + corpus | derived, not stored | yes (re-derives identically) | **no** — different voice each new game |

- **`voiceSeed`** is a second seed on `LeagueState`. It is generated from real
  entropy **at new-game creation**, *independent of the world seed*, and then
  serialized. Consequences:
  - The engine stays **deterministic given `voiceSeed`** — fully testable, saves
    reproduce exactly (re-open the save, the scout says the same thing).
  - Because `voiceSeed` is randomized per new game and **not derived from the
    world seed**, the *same world* (same players) sounds different every
    playthrough. "Non-deterministic to the player" is implemented as
    "deterministic given a seed the player never sees and never controls."
  - This honors CLAUDE.md invariant #2 (no `Math.random()` in the engine) while
    delivering "alive." The only `Math.random()` is the one-time entropy draw
    that *creates* `voiceSeed`, and it lives at the app/new-game boundary, not in
    the engine tick.
- **Vocabulary is large and growable**, so even at a fixed `voiceSeed` the prose
  doesn't feel canned, and the size grows as we ingest real corpora (§7).

> Design rule: **ground truth is seeded; voice is voice-seeded.** A system that
> phrases a scout report off the world seed is wrong by this document — re-rolling
> the world would change the players; we want the players fixed and the voice free.

---

## 3. The Three Layers

```
GROUND TRUTH            PERCEPTION                        EXPRESSION
(world seed)            (voice seed, stored)              (voice seed + corpus, derived)
Player.current[arm]=88  scoutX reads arm → band "80–89"   "puts good velocity behind his
measurables: 4.41 / 228 with confidence 0.7              tosses, zips it in" (Scout X voice)
                        outletY reads arm → band "90+"     "ELITE arm — every throw on the
                        (optimistic on QBs)                tree" (loud outlet voice)
```

1. **Ground truth** — unchanged. `Player.current` (0–100), `measurables`,
   abilities. Seeded, serialized, never shown as numbers.
2. **Perception** — for each (source, player, attribute): a **band** (e.g.
   80–89), plus confidence, plus `observed_at`/`source_id`. This is the existing
   `CollegePlayerObservation` idea, *re-expressed as bands* and driven by the
   voice seed. A source's band can differ from truth (error) and from other
   sources (disagreement). This is **game state** — it persists; a scout's
   opinion can't change every time you open the screen.
3. **Expression** — the **words**. A pure function of (attribute, band,
   confidence, position, source voice profile, vocabulary corpus, voice seed) →
   a phrase. Not stored; re-derived on demand. This is where "alive" lives, and
   where new real-world corpora plug in.

The North Star knowledge layer (`packages/engine/src/knowledge`,
`PlayerSnapshot`) is the **boundary**: the UI reads Perception+Expression, never
Ground Truth. (Inspector is the sanctioned exception — it shows perceived *and*
real side by side for calibration; see §9.)

---

## 4. The Blurb Encoding Model

Grounded in the Madden 2005 mapping (see the full table captured during research)
but un-limited and voiced.

### 4.1 Bands
Each scout-able attribute maps to coarse bands — roughly `90+ / 80–89 / 70–79 /
60–69 / 50–59 / 49-` (band edges can be per-attribute; QB SPD bands differ from
RB SPD bands, exactly as Madden did). A band, not a number, is the unit of
perception. This is the natural fit for "descriptive language with hedging that
maps to source confidence" (North Star §4).

> **HARD RULE — the band is engine-internal and is NEVER spoken.** The band picks
> the words and is shown in the *inspector* next to the real rating (calibration,
> §9). It must never appear in player-facing text — no "70s arm", no "80–89
> range", no number or range of any kind. A scout says *"the deep ball started to
> wobble — his arm's more of a question than the tape first suggested,"* never
> *"more like a 70s arm."* Stats are hidden (North Star); the band is just the
> hidden hook the vocabulary hangs on. Any player-facing string containing a
> rating number or band range is broken by definition.

### 4.2 Band from the scout's read (scout error, free)
The band a source assigns is computed from its **already-noisy** read of the true
rating (the existing scout model: `trueAccuracy` per group, confidence). High
accuracy → band usually contains the truth; low accuracy / low confidence → band
drifts. Wider confidence → the source hedges ("might have enough arm…"). We do
**not** need a new error model to start (Daniel's choice #1): different sources
already land on different bands. Per-source *voice/bias* on top of that is §5.

### 4.3 Phrase from the band (voice + non-repetition)
`describe(attribute, band, position, sourceVoice, vocab, voiceSeed) → phrase`.
The vocabulary is keyed by **(attribute, band, position-group)** and holds *many*
phrasings per cell, each tagged with voice facets (hype/measured, formal/slangy,
comp-prone, hedged). Selection:
- draws from the cell matching the band,
- filtered by the source's voice profile (a measured beat writer never says
  "ELITE, book it"),
- varied by the voice seed + a recently-used set so the feed doesn't repeat
  (the existing `usedSignatures` pattern in `media/reports.ts`, generalized).

This subsumes today's `scout-report.ts` strengths/concerns — which currently pick
*random* position vocabulary unconnected to the read. After this, **a strength
blurb fires because the scout's read is genuinely high, a concern because it's
genuinely low**, and the words encode the band.

### 4.4 Comps & humor
Real reports reach for comparisons ("reminds me of young Favre", "Kelly Holcomb
type") and humor ("diagnosed with severe fumbilitis"). These are voice-profile
properties of the source and live in the corpus. Comps presently use archetype
labels (no real names — deferred "generated-legend name pool" stays deferred);
the corpus seam (§7) is where a real comp inventory eventually lands.

---

## 5. Sources Have Voice (and Are Wrong)

Every scout and every outlet carries a **voice profile** — its own vocabulary
lean, register, comp-habit, humor, and biases — assigned off the **voice seed**
at generation. This is the heart of "whom to trust."

- **Scouts** (`CollegeScout`, NFL scouts): position specialties + hidden depths,
  quirks (overvalues names, nails conversions, blind on FA), per-group accuracy.
  A quirk biases the *band* (a name-chaser bands veterans up); the voice profile
  biases the *words*.
- **Outlets** (`MediaOutlet`): tier/hype/accuracy already per-group
  (`accuracyByGroup`, `hypeByGroup`). A loud RADIO outlet over-bands and reaches
  for hot-take phrasings; a BEAT writer is measured and granular; an INSIDER is
  terse and accurate. (These exist; this doc gives them the voice-pack vocabulary
  to draw from.)
- **Disagreement is the product.** Two sources on one player land on different
  bands in different words. The Scouting-UI doc (#18) and Film-Study resolution
  (#19) require this be shown as natural variation — "confirms our field read" vs
  "raises questions" — never as a reliability meter. Reliability is *built* by the
  player noticing who was right (North Star §5).

### 5.1 Voice is composed from background — and it EVOLVES
A source's voice profile is not a single random draw; it is **layered from the
source's history**, and it **drifts as that history changes** — this is how the
league's vocabulary evolves over a dynasty:
- **Scheme lineage.** A coach/scout who came up in a 4-3 front reaches for 4-3
  vernacular ("3-technique", "Will/Sam", "gap shooter"). Move that coach to a 3-4
  and his vocabulary *shifts over time* — he starts saying "5-tech", "edge",
  "two-gap". The words track where his football brain was *formed* and bend
  toward where he is *now*.
- **Region / coaching tree.** A Southeast lifer, an Air-Raid disciple, an
  old-school AFC-North run-game guy — each tilts the lexicon. Trees propagate:
  hires off a coordinator inherit a slice of his voice.
- **Era.** A 2004 voice and a 2024 voice differ; as sim-years pass, the league's
  ambient vocabulary can age.
The Voice Pack (§7) is therefore **layered/taggable** (by scheme, region, era),
and a source's effective vocabulary is a *blend* of the layers its background
selects — recomputed when the source's scheme/team/role changes. This makes
generational change (coaching carousel, scheme shifts) audibly real:
the *same franchise* literally talks differently after a regime change.

---

## 6. Worked Example — `notableOtherSport` Made Meaningful

The current `notableOtherSport` (v0.122) is random flavor. Recast it as the
canonical attribute-coded blurb:

- It is **generated from the player's hidden physical/skill profile**, not rolled
  free: track → high SPEED; basketball → AGILITY/leaping/COD; baseball → arm /
  hand-eye; tennis/golf → touch / footwork / composure.
- It **only surfaces when the underlying attribute is genuinely high** — so
  reading it *tells you something true* (a real standout signal), modulo the
  filing source's error.
- The **"surprising for his frame"** variant fires when size contradicts the
  athletic read — heavy + elite speed = the Metcalf "ran track at 230" tell.
- It is filed by a **source with voice** and a **band**: a sharp scout's "ran a
  legit track 200 at 240 lbs" reads as elite; a homer outlet might over-band a
  merely-good athlete.

This is the general model (§4) at one high-signal cell. Build it first; it proves
the principle, then generalizes to all attributes.

---

## 7. Growing the Voice — Corpora & the Ingestion Seam

Daniel: bring more real-life scouting reports into the Scribe and Narrator agents
and let that feed media/scouting output; **we can defer new sources, but the
implementation must accept adaptations from them.** So we design the *seam* now
and fill it later.

### 7.1 The Voice Pack (the extension point)
The engine consumes voice as **data, not code**: a versioned **Voice Pack** —
```
VoicePack {
  version, provenance[],            // which corpora fed it
  bands: per-attribute band edges,
  phrasings: (attribute, band, posGroup) -> Phrase[] (each tagged with voice facets),
  polarity: per-position strength/weakness signal (the Scribe positionPolarity),
  comps: inventory (archetype labels now; real-name pool later),
  motifs: backstory templates (the Narrator),
  sportSignals: sport -> attribute mapping (notableOtherSport, §6),
}
```
Adding a real-world source = producing a larger Voice Pack. **No engine code
change** — the engine already reads the pack. This is the "accept adaptations
from new sources" requirement, satisfied structurally.

### 7.2 The agents
- **The Scribe** (exists) — measures phrasing/vocabulary/polarity from real
  scouting corpora (Beast, PFF). Already emits `scribe-profile.json`. Extend it
  to emit the **phrasings + bands + polarity** sections of the Voice Pack.
- **The Narrator** (exists) — measures backstory motifs. Emits the **motifs +
  sportSignals** sections.
- **New: the Lexicon agent** (create if needed) — the **ingestion/normalization**
  pipeline: take a new real-life source (a scouting-guide corpus, a beat-writer
  archive), normalize it into the Voice-Pack schema, and *merge* it into the
  growing pack with provenance. The Scribe/Narrator stay the *analysis* agents;
  the Lexicon is the *intake* agent that lets the vocabulary grow without bespoke
  parsing each time. (Defer building until we have a second source to ingest, but
  the Voice-Pack schema is designed for it now.)

### 7.3 Copyright posture (unchanged)
Source corpora stay local/gitignored; agents emit only aggregate
vocabulary/statistics, never verbatim copyrighted passages — same posture as the
existing Scribe/Narrator.

---

## 8. Architecture & Invariants

- **Where it lives.** Ground truth in the engine core. Perception + the
  describe() function in a `media/voice` (or `knowledge/voice`) engine module.
  The Voice Pack is engine `data/`. The UI consumes via the knowledge layer.
- **`voiceSeed`** added to `LeagueState` (serialized). Created from entropy at the
  app/new-game boundary, **not** in the engine tick. Migration: pre-`voiceSeed`
  saves derive one deterministically from `${worldSeed}::voice` (so old saves stay
  reproducible; they just won't have had per-playthrough variety, which is fine).
- **Determinism preserved.** Every voice function is pure given
  `(voiceSeed, perception, voicePack)`. Tests pin a `voiceSeed` and assert
  stability; a separate test asserts *two different voice seeds → different
  words, identical players*.
- **North Star compliance.** No numbers to the player; bands surface only as
  phrases; attribution on every line; reliability never shown. (Inspector
  excepted, §9.)
- **32-team scale.** Voice runs for all 32 teams' scouts + the full outlet set;
  the Voice Pack is shared read-only data; non-repetition is per-tick league-wide
  (generalize `usedSignatures`). Stress-test #5 (non-repetitive) becomes a real
  test: sample N reports across a season, assert phrasing diversity stays above a
  floor.

---

## 9. Inspector (Calibration)

Per the standing inspector rule (perceived always shows real), every voiced
surface in the **inspector** shows the band/phrase **and** the true rating beside
it, so Daniel can judge whether the encoding feels right (does "unbelievable arm"
actually sit at 90+? does this scout's voice read as that scout?). This is
inspector-only and does not violate North Star — the *game* UI still never shows
ground truth.

---

## 10. Phased Implementation

1. **Slice A — `notableOtherSport` becomes attribute-coded (§6).** DONE (v0.123).
   Smallest real instance of "blurb = coded attribute"; derived from the physical/
   skill profile, surfaces only on genuine highs, Metcalf surprise variant.
2. **Slice B — `voiceSeed` + the expression split (§2).** Detailed plan in §10.1.
3. **Slice B2 — perception off `voiceSeed` (the "opinions too" payoff).** Move the
   scout noisy-read generation + the board-derivation inputs onto `voiceSeed`, so
   the *same players* get **different evaluations, boards, steals and busts every
   playthrough** (Daniel's decision #2). Bigger; its own slice; Slice B is
   architected to make it a clean follow-on.
4. **Slice C — band encoding (§4).** `describe(attribute, band, …)`; bands from
   the scout's read; wire scout-report strengths/concerns to fire **from the
   actual reads** (high→strength, low→concern), encoding the band.
5. **Slice D — Voice Pack extraction (§7).** Move vocabulary/polarity/motifs/
   sportSignals into the versioned, scheme/region/era-layered pack; Scribe/
   Narrator emit it; engine consumes it as data.
6. **Slice E — per-source voice profiles (§5, §5.1).** Assign each scout/outlet a
   voice profile off `voiceSeed`, composed from background (scheme/region/tree)
   and drifting on regime change; filter phrasing by it; band-level per-source
   bias (the deferred TODO) lands here.
7. **Later — the Lexicon ingestion agent + a second real corpus; real-name comp
   pool.** Deferred; the schema already accepts them.

Each slice ships its own tagged release with tests, per project cadence.

### 10.1 Slice B — detailed plan (next session)

**Locked decisions (Daniel, 2026-06-05):** (1) boundary = bio/history is
world-seeded (fixed; `notableOtherSport` stays put), scout+media *sayings* are
`voiceSeed` (alive); (2) "opinions too" — architect so `voiceSeed` will
eventually drive perception (boards diverge per playthrough) — *that move is
Slice B2*; Slice B itself converts only the **words**; (3) ship the inspector
voice-seed control.

**Goal of B:** stand up `voiceSeed` and prove the expression split on the
scout/media voice, with the calibration lens. Perception/boards unchanged in B.

1. **`voiceSeed: string` on `LeagueState`** (`types/league.ts`), serialized.
2. **`createLeague({ seed, voiceSeed? })`** — `voiceSeed` optional. Omitted →
   derive `${seed}::voice` (engine stays pure + deterministic for tests/
   engine-only callers). The **app** (apps/web) draws real entropy
   (`crypto`/`Math.random` at the UI boundary, never in the engine) and passes a
   random `voiceSeed` for "alive per playthrough."
3. **Migration:** pre-`voiceSeed` saves → `${seed}::voice` (stable; old saves
   don't get per-playthrough variety, which is fine).
4. **Route WORD generation off `voiceSeed`.** In the take/report generators
   (`media/scout-report.ts`, `media/nfl-takes.ts`, `media/prospect-takes.ts`),
   the prng used for *word/template/comp selection* is built from
   `league.voiceSeed` (+ context: tick/outlet/player) instead of the world-seed
   prng passed down from `college-cycle.ts` / `reports.ts`. Non-voice randomness
   (e.g. WHICH sleepers an outlet picks) **stays on the world seed in B** — that's
   selection/perception, deferred to B2. Keep the change surgical so the test is
   clean.
5. **Inspector control (apps/web), new-game/create path:** surface `voiceSeed`
   beside the world seed with a **"randomize voice"** action → re-create the
   league from the *same world seed* + a *new* `voiceSeed`, so Daniel hears "same
   league, different voice." Do NOT offer mid-save re-roll (it would conflict with
   frozen dated artifacts, §11); calibration happens on fresh creates.
6. **Tests:** (a) `createLeague` reproduces exactly given `(seed, voiceSeed)`;
   (b) **same `seed`, different `voiceSeed` → identical `players`/ratings/
   measurables (deep-equal ground truth) but different media-report words**;
   (c) same `seed` + same `voiceSeed` → full reproduction; (d) migration backfills
   `voiceSeed`.

**Watch-outs:** keep `Math.random`/`crypto` strictly at the apps/web boundary
(CLAUDE.md invariant #2). The "different words" assertion needs a surface that
fires deterministically in a unit context — reuse the `simulateSeason` fixture
from `nfl-takes.test.ts`. `notableOtherSport` does **not** move (it's bio).

---

## 11. Open Questions & TODOs

- **(DECIDED — Daniel) Report = dated artifact, append-only.** A scouting report
  is a *delivered document*. You **cannot amend a line once filed — you can only
  add new dated lines.** Each player has an append-only dossier of dated,
  attributed, frozen lines (this IS today's append-only report stream, scoped per
  player). Words are chosen fresh *at filing time* (so lines vary across sources,
  weeks, and playthroughs via `voiceSeed`) and then **never change** — re-opening
  last month's line reads identically; it's history. The *opinion* evolves only
  by **appending a new line** off a real new look (game, combine, pro day, added
  tape), which may carry a different band. No report ever re-renders on view.
- **(TODO — Slice E) Band-level per-source bias.** Daniel chose "use the existing
  noisy read + confidence" for the band now (#1). Per-source *bias* on the band
  (name-chasers band veterans up, homers inflate) is a marked TODO for Slice E.
- **(DECIDED — Daniel) Voice evolves with background.** Not "start global, maybe
  packs later" — the Voice Pack is **layered by scheme/region/era** and a source's
  voice is a blend that **drifts when his scheme/role changes** (a 4-3 coach who
  moves to a 3-4 shifts vocabulary over time). See §5.1. Implementation may
  *begin* with one layer and add the rest, but the schema is layered from day one.
- **(DECIDED — Daniel) Boundary = bio fixed, sayings alive.** A player's facts
  and history are world-seeded and identical every playthrough (incl.
  `notableOtherSport`); everything a scout/outlet *says* is `voiceSeed`. See §2,
  §10.1.
- **(DECIDED — Daniel) "Opinions too."** `voiceSeed` ultimately drives *what
  scouts think* (reads → boards), so the same world yields different evaluations/
  boards/steals/busts each playthrough. Implemented in **Slice B2**; Slice B
  architects toward it but moves only words.
- **(DECIDED — Daniel) Inspector voice-seed control.** Show `voiceSeed` + a
  "randomize voice" action on the create path (same world, new voice); no mid-save
  re-roll (conflicts with frozen artifacts). Ships in Slice B.
- **(OPEN) Where `voiceSeed` entropy is drawn.** apps/web new-game/create path for
  now (UI boundary, never the engine); needs a home in the eventual real app
  new-game flow.

---

*This document honors the North Star: the game presents information, the player
interprets it — and now, the league says it differently every time.*
