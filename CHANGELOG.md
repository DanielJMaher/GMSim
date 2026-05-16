# Changelog

All notable changes to GMSim are tracked here.

Format: [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning 2.0](https://semver.org/spec/v2.0.0.html).
Commit conventions: see [`CONTRIBUTING.md`](CONTRIBUTING.md).

While `0.x.x`, minor bumps may include breaking changes. Save format is not stable.

---

## [Unreleased]

_Nothing yet._

---

## [0.37.0] — 2026-05-16

### Changed — Full 7-round draft + retirement refactor (Doc 3 — Draft Module slice 5b)

The Draft Module completes its core loop. `processRetirements` no
longer injects replacement rookies — retirees just open roster
slots, and the draft (now 7 rounds = 224 picks) fills most of them.
Remaining gaps backfill from FA via the existing `refillRosters`
step. `preseasonCuts` trims the natural overflow back to 53.

**Engine — `engine/src/season/retirement.ts`:**

- `processRetirements` shrunk: removed `newPlayers`, `newContracts`
  from `RetirementOutcome`. The function now only computes who
  retired and removes them from rosters. The retirement-replacement
  `generateReplacement` helper + `sideForGroup` mapper are gone —
  the draft owns rookie supply now.
- File is ~110 LOC lighter as a result.

**Engine — `engine/src/season/advance.ts`:**

- Splice loop simplified: retirement-shaped rosters are just the
  surviving-player list; no `Object.assign(playersNext, newPlayers)`
  / `Object.assign(contractsNext, newContracts)` calls.
- Draft loop expands to 7 rounds (was 1). Each round forks the prng
  with a round-scoped label and gets its own `startingOverallPick`
  so pick numbers across the draft go 1..224 in order. If a round
  runs short (declared-prospect pool exhausted — rare; depends on
  this year's junior declaration distribution), the loop breaks
  cleanly rather than firing empty rounds.
- All 224 drafted rookies are protected from the preseason cut
  pool (single union set passed in).

**Engine — `engine/src/contracts/rookie-scale.ts`:**

- New `generateRookieContract` function — required because drafted
  rookies were previously getting veteran-tier contracts via
  `generateContract`, which works for one rookie per team (slice 5a)
  but blows the cap when 7 picks per team each get a tier-scaled
  deal. Rookie contracts now follow a rough NFL CBA scale: 4-year
  fixed length, total value decays exponentially from ~$40M at pick
  #1 to ~$4M at pick #200+, signing-bonus share scales from 60%
  (top picks) down to 10% (late picks). Year-1 fully guaranteed
  for all picks; year-2 fully guaranteed for round 1, injury-only
  for rounds 2–3, none after. `promoteProspectToPlayer` now takes
  `overallPick` so the contract math has what it needs.
- A future slice can layer in the full per-slot CBA table + the
  round-1 fifth-year option mechanic.

**Pipeline interaction:**

- Retirement: ~30–60 retirees league-wide → rosters drop to ~50/team
- `refillRosters`: backfills from FA → rosters back to ~53/team
- Draft (7 rounds): adds 7 per team → rosters at ~60/team
- `preseasonCuts`: trims overflow back to 53 (lowest-skill first,
  drafted rookies protected)
- End state: 53 active per team, draft picks on roster, low-skill
  FAs and replacement-grade vets released to the pool

The "wasted FA signings then cut" is realistic — real NFL teams
sign vet-min depth in March that gets cut in August when draft
picks show up.

**Tests:** event tests updated to expect 200–224 picks per year
(was exactly 32). All other tests (retirement, advance, transactions)
still pass with the refactor — the roster invariants hold because
`preseasonCuts` returns the world to 53.

**Public surface:** `RetirementOutcome` shape changed (breaking for
direct callers of `processRetirements`). No external callers outside
`advanceSeason`.

**Not in this slice (deferred):**

- Trade-ups / trade-downs between picks (slice 5c — needs Doc 5
  trade-value chart integration).
- Compensatory picks (slice 5c).
- UDFA pipeline — undrafted declared juniors / seniors currently
  expire when the pool advances. Real flow: they go to a rookie FA
  pool teams sign from. Future slice.
- NFL real-life draft-order tiebreakers (strength of schedule,
  playoff round of elimination).
- Multi-stage NFL preseason (90 → 85 → 53 with preseason exposed
  as an interactive phase).

---

## [0.36.0] — 2026-05-16

### Added — Junior declaration + single-round draft (Doc 3 — Draft Module slice 5a)

The Draft Module finally produces NFL players. Junior declarations
roll each offseason; the draft event consumes the boards built in
slice 3 and converts drafted prospects to NFL `Player` records with
rookie contracts. Round 1 only — rounds 2–7 + trade-ups land in
slice 5b alongside the `processRetirements` refactor that opens up
real roster slots for the larger draft class.

**Engine — types in `engine/src/types/college.ts`:**

- `DraftPickRecord` — one row per pick. Tracks `seasonNumber` +
  `round` + `overallPick` + `teamId` + `collegePlayerId` +
  `promotedPlayerId` (same id, shared namespace) + `contractId` +
  `pickedOnTick` + board attribution at pick time
  (`boardRankAtPick`, `boardPriorityAtPick`, `boardReasonAtPick`,
  all nullable for off-board fallback picks).

**Engine — `engine/src/draft/`:**

- `declaration.ts` — `rollJuniorDeclarations` tier-biased per junior:
  STAR ~85%, STARTER ~55%, BACKUP ~25%, FRINGE ~5%. SR / RS_SR
  auto-declare. Pre-JR classes never declare. Idempotent — doesn't
  flip already-declared prospects back.
- `draft-order.ts` — `computeDraftOrder` from prior season's
  records. Worst win% picks first; ties broken by lower point
  differential, then stable team-id order. NFL real-life tiebreakers
  (strength of schedule, playoff finish) are slice 5b polish.
- `promote.ts` — `promoteProspectToPlayer` converts a `CollegePlayer`
  into an NFL `Player` + rookie contract. Position uses
  `nflProjectedPosition` (so conversion candidates land at their
  projected NFL spot, not college position). Skills + ceiling +
  archetype + dev archetype carry through verbatim. Fresh
  `moodProfile` rolled (college prospects don't have one — their
  hidden intangibles cover a different facet).
- `event.ts` — `runDraft` + `applyDraftResult`. Each team picks the
  highest-priority available prospect from their own board; falls
  back to BPA across the pool if their board is exhausted. Returns
  a pure result (`picks`, `newPlayers`, `newContracts`, roster
  additions, removed-from-pool set); `applyDraftResult` folds the
  result into a new `LeagueState`.

**Wiring (`engine/src/season/advance.ts`):**

- Order in the offseason pipeline: `rollJuniorDeclarations` →
  `runDraft` + `applyDraftResult` → `advanceCollegePool`. The
  declaration runs on the current pool BEFORE the draft, so newly-
  declared juniors are eligible to be picked the same year. Pool
  advance runs AFTER the draft — drafted prospects already exited
  the pool, so the senior cohort's auto-expire only catches
  undrafted seniors.

**`LeagueState.draftHistory`** — new field, append-only. Every pick
across every draft accumulates here. Inspector reads the tail by
`seasonNumber` to show "this year's draft."

**Preseason cuts** (NFL-style roster trim): `processRetirements`
still auto-injects rookies (refactor lives in slice 5b), so after
the draft a team carries 54 players (53 + 1 draft pick). Real NFL
teams briefly carry 90+ during training camp then trim to 53 before
Week 1. New `preseasonCuts` step in `engine/src/transactions/preseason-cuts.ts`
models the simpler "anyone over 53 gets released to the FA pool,
lowest skill first" form — released players become FAs (null
teamId + contractId), no dead money charged (real preseason cuts
are mostly cost-free aside from rookie guarantees, which slice 5b
will model). Just-drafted rookies are protected from the cut pool
(real NFL almost never cuts a draft pick in their first preseason).
Runs in `advanceSeason` immediately after the draft. End-state:
53-man active roster, same as before — invariants preserved. The
full 90 → 85 → 53 multi-stage trim with preseason as an interactive
phase is a future slice.

**Migrations:** pre-v0.36 saves backfill `draftHistory: []`. No
historical reconstruction — the upcoming draft is what matters.

**Inspector:**

- New `Draft results` panel between `Draft Boards` and
  `Free Agent Pool`. Season selector flips between drafted years.
  Per-pick row shows # / team / rookie name + tier / NFL position /
  school / board rank (emerald for top-5 picks, amber for off-board
  fallbacks) / reason badge (colored per type) / priority.

**Public surface:** new exports `rollJuniorDeclarations`,
`computeDraftOrder`, `promoteProspectToPlayer`, `runDraft`,
`applyDraftResult`, types `PromoteOptions`, `PromoteResult`,
`RunDraftOptions`, `DraftRunResult`.

**Tests:** 20 new across `declaration.test.ts` (5) and
`event.test.ts` (15) — tier-weighted declaration distribution,
auto-declare invariants, idempotent re-rolls, draft fires N picks
in order, drafted prospects exit the pool exactly once, picks come
from team boards 90%+ of the time, promoted player landing at NFL
projected position with rookie contract, determinism,
`applyDraftResult` roster + contract + history wiring, multi-year
accumulation, draft-order matches inverse standings, drafted
rookies show up on team rosters, migration backfill.

**Not in this slice (slice 5b):**

- Rounds 2–7 (just call `runDraft` repeatedly with re-ordered
  draftOrder; the primitive supports it).
- `processRetirements` refactor so retirements open slots instead
  of in-place replacing — required for multi-round drafts without
  inflating rosters to 60.
- Trade-ups / trade-downs in the war room.
- Compensatory picks.
- UDFA pool from undrafted declared juniors (slice 5a expires them
  with the senior cohort; the future UDFA pipeline can pick them
  up before pool advance).
- NFL real-life draft-order tiebreakers (strength of schedule,
  playoff round of elimination).

---

## [0.35.0] — 2026-05-16

### Added — Combine + Pro Days (Doc 3 — Draft Module slice 4)

The Draft Module's measurement-reveal + intel-deployment layer.
Combines produce universal physical measurements visible to every
team; pro days surface per-school attendance decisions that scale
with how many of that school's prospects sit on a team's board.

**Engine — types in `engine/src/types/college.ts`:**

- `CombineMeasurables` — reported drill values per prospect (height,
  weight, arm length, hand size, 40, bench, vertical, broad, 3-cone,
  shuttle) with per-drill `undefined` when the prospect opted out.
  `attended` flag + `measuredOnTick`. Noise on each drill is tight
  (40-yard σ=0.03s, vertical σ=0.5") — combines are precisely
  measured.
- `ProDayAttendanceRecord` — per-school decision with `schoolId`,
  `attended`, `reason` (AUTO / INTERESTED / FLYER / SKIP), and
  `boardCount` (number of that school's prospects on this team's
  top-30 board).

**Engine — `engine/src/draft/`:**

- `combine.ts` — `runCombine` runs the event for every draft-eligible
  prospect. `rollCombineResults` per-prospect with skip-rate model:
  base 20% per drill, with character-flag modifiers
  (WORKOUT_WARRIOR → 0%, TAPE_STAR_POOR_TESTER → 50% on speed
  drills, INJURY_PRONE → +10% overall, 5-star + PEDIGREE → +10%
  on every drill — top picks have little to gain).
- `pro-days.ts` — `runProDays` per-team, per-school decision. Schools
  with ≥3 board prospects → AUTO attend. Score 2 → 80% INTERESTED.
  Score 1 → 65% INTERESTED. Score 0 → 5% FLYER (small-school random
  look). Deterministic.

**Wiring:**

- `LeagueState.combineResults: Record<PlayerId, CombineMeasurables>`
- `LeagueState.proDayAttendance: Record<TeamId, readonly ProDayAttendanceRecord[]>`
- `createLeague` runs initial combine + pro days for the initial pool.
- `advanceSeason` runs both after the college pool advance + board
  refresh (so pro-day attendance is scored against the just-refreshed
  boards).
- `migrateLeagueForward` backfills both for pre-v0.35 saves
  (`${seed}::combine::backfill` and `${seed}::pro-days::backfill`).

**Inspector:**

- New `40` column on the College Pool prospect table. Shows
  combine-reported 40-yard time in emerald when available, `DNP`
  in italics when the prospect skipped, and `—` when the prospect
  isn't draft-eligible.

**Public surface:** new top-level exports `runCombine`,
`rollCombineResults`, `runProDays`.

**Tests:** 16 new — combine determinism, noise band against truth,
WORKOUT_WARRIOR never-skips invariant, drill-skip rate range,
runCombine eligibility filter, advanceSeason refresh, migration
backfill (combine); attendance scheduling, reason-matches-attended
invariant, AUTO/0-score correlation, determinism, schedule
covers only eligible schools, advanceSeason refresh, migration
backfill (pro days).

**Not in this slice (deferred to future slices):**

- Combine interview meetings — 10 prospects per team, 30 questions
  allocated across Scheme Fit / On-Field Intangibles / Off-Field
  Intangibles. Significant scope; its own slice.
- Coverage-competition penalty for popular pro days (needs a
  refactor of the observation pipeline to apply per-school
  accuracy bonuses).
- Strategic full-combine-skips (slice 4 always sets `attended: true`
  for declared draft-eligible prospects).
- Junior declaration logic (still always-false in slice 4 — the
  draft event slice will flip it).
- The draft event itself (next natural slice).

---

## [0.34.0] — 2026-05-15

### Added — 32 internal draft boards (Doc 3 — Draft Module slice 3)

Every team now maintains a unique internal draft board derived from
their own scouts' reports + their scheme + their roster need. Per
Doc 3:

> All 32 teams maintain their own internal big board. No two teams
> have the same board — scheme fit and organizational biases create
> meaningful differences in prospect rankings across all 32 teams.

The same prospect can sit at #4 on one team's board with reason
CONVERSION_PROJECTION and at #28 on another team's board with reason
DEVELOPMENTAL — the variance is the substrate the eventual draft
event will use to produce realistic reaches and steals.

**Engine — types in `engine/src/types/college.ts`:**

- `DraftBoardReason` — five derived reasons:
  `BLUE_CHIP` (consensus top pick), `SCHEME_FIT` (strong archetype
  match for this team's scheme), `POSITIONAL_NEED` (team thin at
  prospect's projected NFL position group), `CONVERSION_PROJECTION`
  (this team's scouts identified the prospect as a position-
  conversion candidate AND the team's scheme fits the projection —
  the "creative team identified him" narrative), `DEVELOPMENTAL`
  (large ceiling-vs-current gap, long-term value).
- `DraftBoardEntry` — `collegePlayerId` + `priority` + `reason` +
  derived components (`observedSkillScore`, `schemeFit`,
  `meanConfidence`, `observationCount`) + `addedOnTick`. Same
  shape conventions as the FA `WatchListEntry` so future UI work
  can render boards and watch lists with shared components.
- `LeagueState.draftBoards: Record<TeamId, readonly DraftBoardEntry[]>`
  — new field.

**Engine — `engine/src/draft/board.ts`:**

- `regenerateDraftBoardsForLeague` — pure function over teams +
  collegeScouts + coaches + players + collegePool + observations.
  No PRNG. Mirrors the NFL `regenerateWatchLists` algorithm:
    1. Index observations by team-of-scout that filed them.
    2. Group each team's observations by collegePlayerId.
    3. Confidence-weight observed key-skills (archetype-weighted)
       into one aggregate score.
    4. priority = observedSkillScore × schemeFit × meanConfidence × need.
    5. Sort desc, take top 50.
    6. Derive a `DraftBoardReason` from which component dominated.
- `regenerateDraftBoards` — lower-level shim that takes a pre-
  computed need-score map (kept for testability + future callers
  that want to override need scoring without rebuilding the
  whole league).

**Wiring:**

- `createLeague` builds initial boards inline from the just-
  generated college observations + rosters.
- `advanceSeason` regenerates boards after the college scouting
  cycle so each new season's boards reflect the freshly-observed
  prospect pool + the new roster shape (post-development,
  post-FA, post-draft-class arrivals).
- `migrateLeagueForward` backfills `draftBoards` for pre-v0.34
  saves — pure derivation, no PRNG seed needed (the v0.33
  collegeScouts/observations backfill already provides the
  inputs).

**Inspector:**

- New `Draft Boards — 32 internal boards` panel (between
  CollegePool and FreeAgentPool) with team selector + top-N
  toggle (10/20/50). Shows the chosen team's board ranked by
  priority, with school + NFL projection (highlighted on
  conversion candidates and showing `COL→NFL` arrow), priority,
  observed skill score, scheme fit, mean confidence, observation
  count, and reason badge color-coded per category. Above the
  table: a quick rollup of how many entries fell into each reason
  bucket — useful for spotting "this team has 6 conversion
  candidates" (probably a 3-4 team spotting OLB tweener DEs) vs
  "this team has zero" (4-3 team that doesn't see the conversion).

**Public surface:**

- New top-level exports: `regenerateDraftBoards`,
  `regenerateDraftBoardsForLeague`.

**Tests:** 9 new in `board.test.ts` — initial population, sort
order invariant, every-field-populated, board variance across
teams (Jaccard similarity bounded), CONVERSION_PROJECTION fires
on real prospects, determinism, advanceSeason regeneration with
new tick, migration backfill, pure-shim equivalence. Full engine
suite green.

**Not in this slice (deferred):**

- War room / draft-day decisions (the actual draft event itself).
- Trade-up / trade-down lookahead in board priority.
- Run-on-position adjustments (when scouts notice their target
  group thinning, board entries shift up).
- Recency-weighted aggregation (older reports decay).
- Coach-visit weight (Doc 3's coaching-evaluation lane lifts
  certain prospects in the war-room phase).

---

## [0.33.0] — 2026-05-15

### Added — College scouts + observations (Doc 3 — Draft Module slice 2)

The Draft Module's evaluation layer. Every team now fields **10–15
college scouts** (per Doc 3, vs. NFL's 3–5 pro-personnel scouts) who
file attributed, per-skill-confidence-weighted observations on the
college pool. Mirrors the NFL scouting framework but with college-
specific shape: bigger staffs, regional preference, an extra
~20% noise on top of the NFL noise floor (college tape is
harder to evaluate than NFL film).

**Engine — new types in `engine/src/types/college.ts`:**

- `ScoutRegion` — five US-region tags + `NATIONAL` + `STATE_TO_REGION`
  lookup table covering all 50 states.
- `CollegeScout` — id, name, age, yearsExperience, knownSpecialty
  (PositionGroup), preferredRegion, hidden per-PositionGroup
  trueAccuracy, 1–2 quirks (reuses NFL `ScoutQuirk` pool).
- `CollegePlayerObservation` — same shape as NFL `PlayerObservation`
  (per-skill values + confidence) but keyed off `CollegePlayer.id`
  via `collegePlayerId` so slice 3 (draft boards) can use the same
  confidence-weighted aggregation as the NFL watch-list code.

**Engine — `engine/src/draft/`:**

- `college-scout.ts` — `generateCollegeScout`,
  `generateTeamCollegeScouts`, `collegeScoutStaffSize` (10/12/14/15
  by Owner financial commitment), `teamCollegeScoutAccuracyMean`
  (0.35..0.80, capped slightly lower than NFL's 0.40..0.85).
- `college-observation.ts` — `generateCollegeObservation` with base
  noise of 18 (vs NFL's 15), regional accuracy bonus (+0.06 when a
  scout's preferred region matches the prospect's hometown OR
  school state), and a 70/30 region-biased sampling for the
  league-wide sweep. Scouts evaluate prospects whose **projected
  NFL position group** matches their specialty — the conversion-
  candidate axis means a college DE who projects as a 3-4 OLB
  is observed by LB scouts, not DL scouts.
- `college-cycle.ts` — `advanceCollegeScoutingCycle` primitive,
  parallel to `advanceScoutingCycle` for NFL.

**Engine — wiring:**

- `TeamState.collegeScoutIds: readonly ScoutId[]` — new field.
- `LeagueState.collegeScouts: Record<ScoutId, CollegeScout>` and
  `LeagueState.collegeObservations: readonly CollegePlayerObservation[]`
  — new fields.
- `createLeague` generates 10–15 college scouts per team and runs
  the initial league-wide observation sweep (~1900–2900 reports
  depending on staff sizes).
- `advanceSeason` runs `advanceCollegeScoutingCycle` after the
  college-pool advance — every season adds a fresh round of
  observations on the new prospect pool. Append-only.
- `migrateLeagueForward` backfills `collegeScouts`,
  `collegeObservations`, and per-team `collegeScoutIds` for
  pre-v0.33 saves with a deterministic seed.

**Inspector:**

- College Pool panel header now reports total college scouts +
  total reports filed.
- New per-prospect "Reports" column in the prospect table —
  shows how many cross-team observations exist on each
  draft-eligible prospect. Highlighted violet when a prospect
  has 8+ reports (well-scouted); dimmed when 0 (coverage gap,
  realistic for off-region small-school types).

**Quirk pool reuse:**

- `composedQuirkEffect` reads `tier`, `experienceYears`, and
  `careerAwards` off the player. College observation projects
  `CollegePlayer` into that subset (treating prospects as
  `experienceYears = 0` rookies with no career awards).
  YOUNG_PLAYER_BIAS fires uniformly on prospects;
  SHARP_ON_ROLE_PLAYERS / PRACTICE_SQUAD_GEM_HUNTER respond to
  prospect tier; OVERVALUES_NAME_RECOGNITION effectively no-ops
  (no NFL accolades yet — the eventual media-darling integration
  in a later slice will give that quirk something to bite on for
  prospects).

**Public surface:**

- New top-level exports: `generateCollegeScout`,
  `generateTeamCollegeScouts`, `collegeScoutStaffSize`,
  `teamCollegeScoutAccuracyMean`,
  `generateInitialCollegeObservations`,
  `generateCollegeObservation`, `advanceCollegeScoutingCycle`.

**Tests:** 22 new across `college-scout.test.ts` (11) and
`college-observation.test.ts` (11) — staff sizing, accuracy mean
floor, deterministic generation, regional preference distribution,
quirk-bias sanity, deterministic observation, attribution invariant,
high-vs-low-accuracy noise comparison, position-group routing,
regional-bias sampling, league integration, migration backfill,
ID namespace separation. Full engine suite still green.

**Not in this slice (deferred):**

- Per-team draft boards (slice 3 — coming next).
- Active deployment scheduling (which scouts attend which college
  games each week — depends on a college-football schedule sim
  that doesn't exist yet).
- Coverage-competition penalties (when 15+ teams scout the same
  marquee program, intelligence gets noisier — needs deployment
  data first).
- Coach visits during NFL bye weeks (Doc 3's coaching-evaluation
  lane — separate slice).
- Recency-weighted aggregation (older reports decay).

---

## [0.32.0] — 2026-05-15

### Added — College Player substrate (Doc 3 — Draft Module slice 1)

The Draft Module's foundation. `engine/src/draft/` materializes a deep,
character-rich `CollegePlayer` entity and a league-shared pool that
all 32 teams will eventually scout. Slice 1 ships the substrate;
college scouts (slice 2) and per-team draft boards (slice 3) layer
on top of it without changing this shape.

**Why deep on slice 1:** the draft was the original driving vision for
this project. A thin "id + name + skills" prospect would force every
later slice (scouts, boards, combine, war room) to invent its own
character data ad-hoc. Putting the richness in the substrate up front
means scouts and media in slice 2+ have something distinctive to
report on — a quiet 5-star pedigree at Alabama with a bloodline reads
differently from a brash walk-on at Toledo with a coach-conflict flag,
even before any scout lays eyes on either.

**Engine — `engine/src/draft/`:**

- `CollegePlayer` type carries identity (school, class year, draft
  eligibility, hometown), full ground-truth skill ratings + ceiling
  (mirrors `Player` shape so the future draft event can promote a
  prospect to NFL with no remapping), recruiting profile (star
  rating, national rank, hometown, background tag), bloodline,
  combine-shape measurables (independent of skills — workout
  warriors and tape stars are real), hidden intangibles
  (leadership presence / interview skill / work ethic /
  coachability / competitiveness / football character),
  personality voice (6 distinct voices), character flags
  (13 narrative flags), per-year college stats, and per-year
  injury history.
- **Conversion candidate axis** — ~14% of prospects project to a
  different NFL position than they play in college (Doc 3:
  "college DE who's actually a 3-4 OLB"). The engine carries true
  NFL projection separately from college position; another ~25%
  of non-converters carry a plausible alternate position the
  creative evaluator might consider.
- **Archetype misread axis** — `archetype` (true NFL archetype)
  and `assumedArchetype` (what college coaching/media calls them)
  diverge for all conversion candidates and ~12% of non-converters.
  This is the gap scouts can either nail or miss.
- **Measurables decoupled from skills** by design. ~30%
  correlation between true speed skill and 40-time leaves room
  for both `WORKOUT_WARRIOR` and `TAPE_STAR_POOR_TESTER` flags
  to fire on real outliers.

**Engine — supporting modules:**

- `engine/src/data/colleges/index.ts` — 80+ schools across SEC,
  Big Ten, Big 12, ACC, AAC, MWC, MAC, Sun Belt, C-USA, FCS, and
  small-school umbrella. Each school carries conference id +
  tier (POWER / GROUP_OF_5 / FCS / SMALL) + state.
- `engine/src/data/colleges/hometowns.ts` — weighted hometown
  pool across ~35 states, biased heavily toward TX / FL / CA / GA
  (real recruiting hotbeds). Slice 2's regional scout coverage
  will read this.
- `measurables.ts` — position-keyed combine baselines (height,
  weight, arm, hand, 40, bench, vertical, broad, 3-cone, shuttle).
- `character.ts` — personality voice + hidden intangibles
  + character flags. Voice nudges intangible dials so dimensions
  cohere (ALPHA_LEADER bumps leadership presence; BRASH dampens
  coachability and lifts off-field-incident odds).
- `recruiting.ts` — star rating biased loosely by true NFL tier
  (5-star busts and walk-on stars are real), national rank
  gating, hometown roll, recruiting-background tag.
- `college-stats.ts` — per-year season totals position-keyed.
  QB stats include attempts/comp%/YPA biased by skill;
  DL/LB carry tackles + sacks + forced fumbles; OL carries
  games + starts only (tape is what's graded).
- `conversion.ts` — position projection table + true-vs-assumed
  archetype derivation.
- `pool.ts` — `generateInitialCollegePool` (~1000 prospects
  spread across 6 class years, school-tier-weighted) and
  `advanceCollegePool` (age every prospect, expire SR/RS_SR,
  inject fresh TRUE_FR class). Inflow ≈ outflow so pool size
  is stable across multi-year runs.

**Engine — wiring:**

- `LeagueState.collegePool` — new field, populated by
  `createLeague` from a `college-pool`-labeled root-PRNG fork.
- `advanceSeason` runs `advanceCollegePool` after the watch-list
  refresh — seniors expire (slice 1 has no draft event yet so
  none get promoted to NFL; the draft-event slice will replace
  this expiration), TRUE_FR class arrives, every retained
  prospect gains one new season of stats and possibly one new
  injury entry.
- `migrateLeagueForward` backfills `collegePool` for pre-v0.32
  saves with a deterministic generation seeded from
  `${seed}::college-pool::backfill`.

**Public surface:**

- New top-level exports from `@gmsim/engine`:
  `generateCollegePlayer`, `generateInitialCollegePool`,
  `advanceCollegePool`, `rollMeasurables`, `rollCharacterFlags`,
  `rollRecruitingProfile`, `rollCollegeStats`,
  `rollPositionProjection`, `pickTrueArchetype`,
  `pickAssumedArchetype`, `COLLEGE_SCHOOLS`, `CONFERENCES`,
  `getSchoolById`, `getSchoolsByTier`, plus types.
- New subpath export: `@gmsim/engine/draft`.

**Inspector:**

- New `College Pool` panel between `LeagueOverview` and
  `FreeAgentPoolPanel`. Shows pool size + breakdown by class
  year, summary stats (conversion candidates, archetype misreads,
  character flags, NFL bloodlines, 4–5 star recruits, small-school
  / walk-ons), and a top-15 (expandable to 60) draft-eligible
  prospect table with name + hometown, school + tier badge,
  college position, NFL projection (highlighted when conversion
  + when archetype is being misread), personality voice, star
  rating, tier, and top character flags.

**Tests:** 30 new across `generate-college-player.test.ts` (16),
`pool.test.ts` (10), and `integration.test.ts` (4) — determinism,
class-year eligibility, conversion-candidate distribution,
archetype-misread invariant, measurable plausibility at scale,
position override, transfer flag, star-rating-by-tier bias,
hometown sourcing, multi-year pool stability, freshman-class
injection, `createLeague` integration, `advanceSeason`
integration, migration backfill. Full suite still green.

**Not in this slice (deferred to future Draft slices):**

- College scouts + per-skill confidence-weighted observations
  (slice 2).
- Per-team draft boards with scheme-fit awareness (slice 3).
- The draft event itself (rounds, picks, war rooms, trade-ups).
- Combine + pro days (with team meeting allocation +
  10-meetings-30-questions logic).
- Post-season film study with Doc 19's 50%-of-coaching-visit cap.
- Media outlets + media big boards.
- Coach visits during NFL bye weeks.
- Junior declaration logic (slice 1 leaves all eligible
  prospects with `hasDeclared = false`).
- Week-by-week college season simulation (significant scope of
  its own).
- Mid-cohort attrition (transfer-out, walk-out) — slice 1
  balances inflow ≈ senior outflow rather than modeling
  per-year attrition rolls.

---

## [0.31.0] — 2026-05-15

### Added — Periodic scouting cycle (Doc 4 slice 4)

Scouts now re-evaluate the league every season instead of producing a
single observation set at league creation. Watch lists regenerate from
the full observation history, so the FA market reads current
intelligence rather than year-one snapshots. Lays the substrate the
Draft Module's college-scouting cycle will inherit.

**Engine:**

- New `advanceScoutingCycle(prng, league, observedOnTick)` in
  `engine/src/scouting/cycle.ts`. Each scout produces a fresh round
  of ~8 attributed observations on other-team players in their known
  specialty group (same logic as the initial sweep, stamped with the
  current tick). Observations are append-only — historic reports stay
  as a track record.
- Wired into `advanceSeason` between `runProactiveTrades` and
  `refillRosters` so the FA auction reads post-development player
  skills.
- `generateInitialWatchLists` → `regenerateWatchLists`. Same function,
  now idempotent and called every cycle.

**Fixed — watch-list cleanup post-cycle:**

- A previously-observed player who got signed/traded to the watching
  team was leaving stale entries on that team's list (initial
  generation excluded own-team via the observation filter, but the
  cycle path didn't). `regenerateWatchLists` now drops entries where
  `player.teamId === teamId`, catching active-roster, IR, and
  practice-squad assignments.
- A second `regenerateWatchLists` call runs at the *end* of
  `advanceSeason`, after `refillRosters` + `refillPracticeSquad`, so
  FA signings + PS poaches don't leave stale entries on the watch list
  of the team that just acquired the player. Purely a filter pass — no
  new observations.

**Fixed — priority no longer clamped at 100:**

- Priority composite (`observedSkillScore × schemeFit × meanConfidence
  × need`) regularly exceeded 100 for top targets, collapsing every
  star-tier entry to "priority 100.0" in the inspector. Removed the
  upper clamp so the top of each list visibly differentiates. Lower
  bound at 0 stays. FA-bidding boost formula still caps at +25%
  regardless of priority, so no gameplay effect — purely restores
  inspector resolution.

**Inspector:**

- ScoutCard now shows a `N reports` counter so cycle accumulation is
  visible at a glance (grows by ~8 each season-advance).
- Scout Observations panel sorts observations within each team
  newest-first by `observedOnTick`, so the most recent report
  bubbles to the top when a player has been observed across multiple
  cycles.

**Tests:** 7 new (`cycle.test.ts`) — append-only invariant, prior
observations preserved, watch-list regeneration, determinism,
integration with `advanceSeason`, multi-season accumulation, and the
post-cycle own-team-exclusion invariant. Full suite: 447 passing.

**Not in this slice (deferred):**

- Recency-weighted aggregation (old observations weight less). Watch
  for this when the Draft Module lands and prospects develop visibly
  across college years.
- Mid-season observation cycles (waiver-wire reactivity).
- Knowledge-layer read interface for the eventual game UI.

---

## [0.30.0] — 2026-05-15

### Added — Watch lists drive FA bidding (Doc 4 slice 3)

The scouting pipeline now moves the market. When a player hits the
auction, each bidder's cash valuation is multiplied by their
watch-list status — coveted players cost more, instead of the
winner getting a free sort-order kick at the runner-up's price.

**Bid model:**

- New `watchListMultiplier` per bidder, derived from the team's
  watch-list entry for the player. Formula:
  `1 + min(0.25, priority / 100 * 0.3)` — 1.0 for unlisted players,
  up to ~1.25 for top-priority entries.
- Multiplier is applied to the **cash** valuation (after the existing
  fit × need × cap clamp, before the cap-room cap). Cap room remains
  the natural ceiling — teams still can't bid more than they can pay.
- `perceivedBid = cashValuation × preferenceMultiplier` — clean
  two-factor sort. Watch-list conviction lives entirely inside cash.
- New `FaBidderDetail.cashValuationBaseline` captures the pre-boost
  cash so the inspector can show "elevated $4.2M → $4.9M (+$0.7M)"
  without back-deriving the math.

**Why on cash, not on the sort key:**

The original prototype only multiplied watch into `perceivedBid`,
which meant watch-listed teams won more often but paid the
runner-up's price — the player was effectively getting a discount
because the team was determined. Moving the boost into cash means
high-conviction teams actually bid more dollars, and when two teams
both covet a player, the final second-price reflects it.

**Inspector — FA-sign detail panel:**

- BiddersTable drops the explicit `×watch` column. Cash bid now shows
  the boost inline: e.g. `$4.85M (+15%)` in emerald with a tooltip
  surfacing the baseline and dollar delta.
- `watch` column shows the reason chip (color-coded by `WatchListReason`)
  with hover for priority + description.
- WinnerExplanation calls out the cash elevation explicitly:
  "Watch-list boost: cash elevated $4.20M → $4.85M (+$0.65M, ×1.155)"
  with the reason chip and priority. The "without watch boost the
  runner-up would have outbid X" flip line still fires when the
  boost was the deciding factor — comparison now uses the winner's
  baseline cash vs the runner-up's actual cash.

**Tests:** 9 new in `fa-bidding-watch-list.test.ts` (bid formula,
boost ceiling, `cashValuation ≥ cashValuationBaseline` invariant,
determinism, monotonic priority→multiplier mapping, fa-sign
transaction persists fields, aggregate market impact). All 16
existing FA bidding tests still pass — total FA bidding coverage
25/25.

**Cap-band note:** allowing cash to exceed the previous [0.7, 1.2] ×
tier-standard band for watch-listed players is intentional — Doc 4
calls this out as the realistic price-discovery dynamic. Cap-band
inflation is bounded by each team's cap-room gate (which still
filters on `standardY1 + fillUpReserve`), so cap-tight teams stop
bidding before the fill-up backstop breaks.

**Not in this slice (deferred):**

- Periodic re-observation / list churn over time.
- Availability signals beyond FA auction (released-player priority,
  cap-cut signals, depth-chart shifts).
- Knowledge-layer read interface for the eventual game UI.

---

## [0.29.0] — 2026-05-15

### Added — Watch Lists: each team's curated target list (Doc 4)

Second slice of the Roster & Free Agent Scouting module. Every team
now builds a top-15 watch list from its own scouts' observations,
scored by `observedSkillScore × schemeFit × meanConfidence ×
positionalNeed`. The conceptual distinction this lands:

- **Scouted** = at least one of the team's scouts has made an
  attributed observation on the player (raw data, ~24–40 players per
  team after the initial sweep).
- **Tracked** = the team has filtered their observations into a top-15
  priority list — players they actually intend to pursue. Strict
  subset of scouted players; sets up slice 3 (availability-signal
  competition) cleanly.

**Engine — new `engine/src/scouting/watch-list.ts`:**

- `WatchListEntry` type: `priority` (0..100 composite), `reason`
  (`SCHEME_FIT` | `POSITIONAL_NEED` | `MISCAST_ELEVATION` |
  `ROLE_PLAYER`), `observedSkillScore` (confidence-weighted aggregate
  of the team's observations of this player's archetype-key skills),
  `schemeFit`, `meanConfidence`, `observationCount`, `addedOnTick`.
- `LeagueState.watchLists: Readonly<Record<TeamId, readonly
  WatchListEntry[]>>` — per-team directory.
- `generateInitialWatchLists(...)`: deterministic build at league
  creation. For each team: bucket the team's own observations by
  player, confidence-weight per-skill values across observations,
  score by composite formula, take top 15 sorted by priority.
- Reason derivation prioritizes `MISCAST_ELEVATION` (player's current
  team has poor scheme fit AND ours is strong — the highest-value
  target type per Doc 4), then `SCHEME_FIT`, then `POSITIONAL_NEED`,
  default `ROLE_PLAYER`.
- Positional need is a soft `sqrt(target / roster_count)` curve
  clamped to `[0.8, 1.3]` so the bonus doesn't dominate priority.

**Inspector:**

- TeamDetail gains a "Watch list (N)" panel between Scouting Staff and
  rosters. Compact table: priority, player name + tier + position,
  current team abbr (or `FA`), reason chip (color-coded by reason,
  hover for description), observed skill score, scheme fit, mean
  confidence, observation count.
- PlayerDetail gains a "Tracked by N teams" chip strip near the
  bottom (between Career Awards and Scout Observations). One chip per
  watching team, color-coded by that team's reason, sorted by priority
  descending. Surfaces the cross-team competition that the doc calls
  out as a load-bearing dynamic.

**Tests:** 8 new (determinism, structural shape, sort ordering,
self-team exclusion, observation backing, allowed reasons,
cross-team overlap regression, scheme-fit range). Full suite:
431 passing.

**Not in this slice (deferred):**

- Bidding / availability-signal competition that *uses* the watch
  lists — slice 3. The data structure is now in place; the action
  hookup is the next step.
- Periodic re-evaluation / list churn over time — current lists are
  one-shot at league creation.
- Watch-list signals tied to released / cap-cut / contract-expiring
  players — slice 3 territory.
- Knowledge-layer filter (eventual game UI shows only the viewer's
  list, not all 32) — lands with the game UI.

---

## [0.28.0] — 2026-05-15

### Added — NFL Scouting module foundation (Doc 4)

First slice of the Roster & Free Agent Scouting module. Lands the
scout entity, observation primitive, and inspector surfaces. No
NPC behavior change yet (watch lists, bidding, signal competition
come in later slices).

**Engine — new module `engine/src/scouting/`:**

- `Scout` type: identity (name, age, yearsExperience), `knownSpecialty`
  (PositionGroup the GM officially understands), hidden per-group
  `trueAccuracy` (0..1 per PositionGroup), 1–2 quirks from
  `ScoutQuirk` (`OVERVALUES_NAME_RECOGNITION`, `SHARP_ON_ROLE_PLAYERS`,
  `MISSES_SCHEME_FIT`, `PRACTICE_SQUAD_GEM_HUNTER`, `YOUNG_PLAYER_BIAS`,
  `VETERAN_LOYALIST`). Per North Star, `trueAccuracy` and `quirks` are
  ground-truth only — the dev inspector exposes them; the eventual game
  UI surfaces only `knownSpecialty` and discovers true accuracy through
  track-record.
- `PlayerObservation` type: one attributed (scout, player) report with
  partial `skills` + per-skill `confidence` maps. Stored as a flat
  `LeagueState.observations` array; future knowledge-layer filters will
  read through this with a per-viewer filter.
- `generateTeamScouts(prng, idSeed, owner, gm)`: per-team 3–5 scouts.
  Count tiered by Owner `financialCommitment` (1–3 → 3 scouts, 4–7 → 4,
  8–10 → 5). Mean per-group accuracy blends Owner `financialCommitment`
  with GM `talentEvaluationAccuracy`, scaled to 0.4..0.85. Specialty
  group gets a +0.02..+0.20 bonus; 30% chance of a "hidden depths"
  bonus on a non-specialty group (per Doc 4: scouts may be unknowingly
  elite at a different group than their official focus).
- `generateInitialObservations(...)`: at league creation, every scout
  produces observations on ~8 players in their `knownSpecialty` group
  across other teams (not own roster — NFL scouts evaluate opposing
  organizations; own-roster eval is what coaches and practice are for).
  Per-skill observed value = true + N(0, BASE_NOISE * (1 − accuracy) *
  quirk-noise-multiplier) + quirk-bias, clamped 0..100. Per-skill
  confidence = accuracy + quirk-confidence-delta.
- Quirk biases are testable in isolation via `composedQuirkEffect`.
- `TeamState.scoutIds` and `LeagueState.scouts` directory wired into
  `createLeague`. Save format breaks but pre-1.0 so MINOR is fine.

**Inspector:**

- TeamDetail gains a "Scouting staff" section between Trade Builder and
  rosters: each scout shown as a card with name, age, experience, known
  specialty chip, full per-PositionGroup accuracy strip (ground-truth
  value, color-coded; specialty marked with an emerald ring), and quirk
  chips (hover for the quirk's bias description).
- PlayerDetail gains a "Scout observations" section at the bottom,
  grouped by source team. Each observation row shows scout name, mean
  confidence, observation tick, and a wrap of 18 skill chips with
  `obs Δ` deltas color-coded (zinc within ±3, rose for high overshoots,
  emerald for low undershoots).

**Tests:** 17 new (scout generation determinism, accuracy floor and
ceiling, specialty bonus distribution, staff size tiering by financial
commitment, observation determinism, noise scales with `1 − accuracy`,
own-roster exclusion, quirk-bias directional effects, `createLeague`
smoke integration). Full suite: 423 passing.

**Not in this slice (deferred):**

- Watch lists, availability signal tracking — slice 2.
- Bidding / competition logic integrated into FA auction — slice 3.
- Periodic re-observation (current observations are one-shot at league
  creation) — slice 2 or 3.
- Knowledge-layer read interface for the future game UI — lands when
  the game UI does.
- College scouts — arrive with the Draft Module.

---

## [0.27.1] — 2026-05-15

### Added — `PlayerDetail` expand in FA pool + trade builder (web)

Extends the v0.27.0 click-to-expand surface to the other player tables
so "click a player anywhere and see all their stats/ratings" is
consistent across the inspector.

- **Free Agent Pool** — row click toggles the expanded `PlayerDetail`
  panel. Detail shows "free agent" in place of contract terms (the
  panel already handled the null-contract case).
- **Trade Builder roster columns** — row click still toggles selection
  (unchanged, since that's the primary affordance for building a
  trade). A new leading `▶` cell expands the detail panel; its
  `onClick` stops propagation so selection and expand are independent.
  Selection highlight (amber) and expand highlight (zinc) layer
  cleanly.

No engine changes.

---

## [0.27.0] — 2026-05-15

### Added — Click-to-expand player detail panel (web)

Every player row in the team-detail roster table is now click-to-expand
(matches the existing transaction-log expand pattern). The overall key
+ ceiling averages in the row weren't enough signal — the expanded
panel surfaces ground-truth detail the inspector previously hid behind
aggregates:

- **All 18 skill ratings**, grouped Physical / Position / Mental, each
  with current value, hidden ceiling, and a `key` / `core` / `minor`
  chip derived from the player's archetype `skillWeights`.
- **Identity + archetype** — tier, position, archetype label and
  description, age, experience, birthDate, scheme fit (when the
  player's team's HC is known).
- **Development archetype** (humanized: `Fast learner` etc.).
- **Mood detail** — bucket + raw value + personality archetype +
  setPoint / volatility / resilience + trade-request flag.
- **Conditioning** (raw 0..100) and **injury** detail.
- **Contract** terms (reuses `ContractTermsTable`), or "free agent" if
  none.
- **Per-season career stats** with position-relevant columns
  (passYds / TD / INT for QB, rushYds / TD for RB, etc.).
- **Career awards** as chips.

The release button stops propagation so clicking it doesn't toggle the
panel. Other player tables (free-agent pool, trade builder) are
unchanged this slice — the component is structured so dropping it into
those is a small follow-up.

This is a dev-inspector surface, not a player-facing one — the North
Star "no raw rating display" rule applies to the eventual game UI.

---

## [0.26.1] — 2026-05-15

### Changed — Bump GitHub Actions to Node 24-compatible majors (repo)

GitHub forces Node 24 as the default in Actions runners on 2026-06-02
and removes Node 20 from runners on 2026-09-16. The Pages deploy is
how each release is verified eyes-on, so losing it would disrupt the
ship cadence. Bumped each action in `.github/workflows/deploy.yml` to
its current major (all Node 24-capable):

- `actions/checkout` v4 → v6
- `pnpm/action-setup` v3 → v6 (pnpm version pin unchanged at 9.0.0)
- `actions/setup-node` v4 → v6 (`node-version: 20` retained — runner
  Node version is independent of the action's internal runtime)
- `actions/configure-pages` v5 → v6
- `actions/upload-pages-artifact` v3 → v5
- `actions/deploy-pages` v4 → v5

---

## [0.26.0] — 2026-05-14

Closes the long-horizon roster-shortfall residual that's been carried
as a known limitation since v0.20.0. The mechanism: a favored team
could win 4-6 auctions in sequence (each passing the cap-room filter
individually), then end the offseason at $254M cap / $0.4M room —
below `LEAGUE_MINIMUM_SALARY` ($900k) — leaving the fill-up backstop
unable to reach them. Result: teams stuck at 45-50/53 instead of 53.

### Fixed — Reserve fill-up cap room in the auction filter (engine)

`fa-bidding.ts` cap-room gate changed from:

```ts
if (capRoom < standardY1) continue;
```

to:

```ts
const remainingSlotsAfterSigning = Math.max(0, 53 - team.rosterIds.length - 1);
const fillUpReserve = remainingSlotsAfterSigning * LEAGUE_MINIMUM_SALARY;
if (capRoom < standardY1 + fillUpReserve) continue;
```

A team can no longer bid on an FA unless they retain enough cap room
to fill every remaining roster slot at league minimum. Cap-rich
teams keep winning; cap-pinched teams correctly drop out of bidding
earlier and let the fill-up pass complete their roster.

### Diagnosis

Approach mirrored the v0.20 diagnostic: instrument-then-fix instead
of guess-and-tweak. Wrote a one-off diagnostic that traced per-team
roster count + cap usage across every season for 10 seasons on the
`validate-1` seed. Every offending season fingerprinted the same:
`cap ≥ $254M, room ≤ $1M`. That's below the `LEAGUE_MINIMUM_SALARY`
fill-up threshold, so fill-up couldn't bring the team back to 53.

Pre-fix: 5 teams hit non-53 at least once across 10 seasons of
`validate-1`, with some seasons as bad as 42/53. Post-fix: 1
transient team-season (LV s1 at 51/53, recovers by s2) — a residual
fresh-league quirk where the initial cap-cuts state was already so
tight no reserve could help.

### Verified

- All 3 validate-progression seeds end at 53/53 across every team
  after 10 seasons (was 3+1 teams off-53 pre-fix).
- Roster-shortfall diagnostic across all 3 seeds: 0/0/0 violations
  at s10. Across ~960 team-seasons of testing: 1 transient s1
  off-by-2 case.
- Full engine suite: 407 tests passing (was 406).

### Known leftover

LV s1 in seed `validate-1` ends at 51/53 — fresh-league initial
state was too cap-pinched for even the new reserve to help. Self-
corrects by s2. Not pursuing further; the cost of fixing the
initial-generation cap pressure exceeds the value of catching one
team-season out of 960.

---

## [0.25.0] — 2026-05-14

Surfaces the alternative-candidates list deferred from v0.24. Every
trade transaction now carries up to 5 alternative trades that were
considered by the matchmaker but didn't fire, with the reason each
dropped out. Inspector renders these as a compact table beneath the
per-team perspective panels — "X teams also considered this trade."

### Added — AlternativeTradeCandidate persistence (engine)

`TransactionTrade` gained an optional `alternativeCandidates:
readonly AlternativeTradeCandidate[]` field. Each entry carries:
- `buyerId`, `sellerId`, `acquireId`, `returnId` — the players /
  teams in the rejected trade
- `buyerNetValue`, `sellerNetValue` — both teams' 5-factor nets in
  $M (summary-only; full per-factor breakdowns omitted to keep
  persistence light)
- `reason`: one of `'lower-priority'`, `'buyer-used'`, `'seller-used'`,
  `'failed-gate'` — why the candidate didn't fire

`TradeMetadata.alternativeCandidates` mirrors the field; the trade
primitive passes it verbatim onto the transaction (no behavioral
side-effects).

### Added — Alternative capture in `runProactiveTrades` (engine)

The execution loop now tracks every candidate's outcome
(fires / buyer-used / seller-used / failed-gate). When a trade fires,
`buildAlternatives` walks both already-processed outcomes and
yet-to-be-processed candidates to find those that share at least one
player with the firing trade. Top 5 by combined net value persist on
the executed transaction.

The "reason" attribution:
- Already-processed non-firing outcomes carry their actual reason.
- Upcoming candidates inherit their *future* reason: if their buyer
  or seller is the firing trade's buyer/seller, they'd be marked
  buyer-used / seller-used; otherwise they're `lower-priority` —
  the player they wanted is no longer available on that team.

### Added — Alternative buyers in `runWeeklyNpcTrades` (engine)

`findBuyer` previously picked the single best buyer and discarded the
rest. Now collects every qualified buyer (positional need + cap room
+ positive 5-factor buyer net) and surfaces the top 5 runners-up as
alternatives on the resulting transaction. All marked
`'lower-priority'` since this pipeline picks one winner per request.

### Added — Inspector alternatives section (web)

`TradeDetail` gains a new compact table below the per-team breakdowns
when `alternativeCandidates` is populated. Columns: buyer abbr,
seller abbr, acquired player, return piece, buyer net (green/red),
seller net (green/red), and a human-readable reason chip ("buyer in
other deal", "seller in other deal", "lost out", "cap/state shift").

Empty alternatives → section hidden. Pre-v0.25 trades have no
alternatives field and continue to render the v0.24 detail panel
unchanged.

1 new end-to-end test in `proactive-trades.test.ts`:
- multi-season run produces at least one trade with non-empty
  alternativeCandidates; each alternative has valid IDs + a reason
  in the expected union; alternatives capped at 5 per trade.

406 tests passing (was 405 at v0.24.0).

---

## [0.24.0] — 2026-05-14

Ships Doc 14's 5-factor trade-value evaluator and the trade detail
panel that closes the second half of the user's transaction-detail
ask from v0.22. Every trade transaction now carries both teams'
labeled 5-factor breakdowns, and the inspector renders them inline
on a clickable row.

### Added — Doc 14 five-factor trade-value evaluator (engine)

New `packages/engine/src/trade/value.ts`:
- `evaluatePlayerValue(team, player, league) → PlayerValueBreakdown` —
  per-team perceived value of a single player, in $M of cap-equivalent
  dollars. Each factor returns a labeled `multiplier` + `rationale`
  string the inspector renders verbatim.
- `evaluateTradePackage(team, incoming, outgoing, league) → TradePackageEvaluation` —
  multi-player package eval; returns per-asset breakdowns + `netValue`
  (positive = team perceives a gain).

The five factors (Doc 14 §Player Evaluation Framework):
1. **Ability** — skill summary vs tier baseline + career-award bumps
   (+5%/award capped at +25%). Pro Bowl + scout-report consensus
   slots deferred until those features land (Phase 4).
2. **Scheme fit** — `schemeFitForPlayer` mapped from raw [0.5, 1.7]
   to a [0.7, 1.4] multiplier. "Perfect fit" / "good fit" /
   "neutral" / "poor fit" labels.
3. **Age & contract** — age-curve multiplier (rookie upside ×1.10;
   prime 25-29 ×1.0; declining ×0.9; veteran ×0.75; aging ×0.55)
   combined with contract-structure multiplier (rental discount,
   multi-year cost-certainty premium, expensive-contract penalty
   step of 5% per $5M over tier-expected Y1 hit, capped at -25%).
4. **Positional** — Doc 14 hierarchy. QB ×2.0, EDGE ×1.6, LT ×1.4,
   CB/WR ×1.3, S/RT ×1.1, C/DT/LB/G ×1.0, RB/TE ×0.9, NT ×0.85,
   FB/K/P ×0.55-0.6, LS ×0.4.
5. **Timing** — buyer's `competitiveWindow` × player tier × age.
   CHAMPIONSHIP/CONTENDER pay win-now premium for veteran
   STAR/STARTERs (×1.15/1.10). REBUILDING pays a premium for young
   STAR/STARTERs (×1.15) and a discount for veterans (×0.80).
   STAGNANT/RETOOLING posture cautiously (×0.95).

`value = tierBase × ability × schemeFit × ageContract × positional × timing`,
all in $M. Tier bases: STAR $28M, STARTER $10M, BACKUP $3M, FRINGE
$0.9M.

### Changed — Trade pipelines gate on mutual perceived value (engine)

Both the v0.17 trade-request matcher (`runWeeklyNpcTrades`) and the
v0.21 proactive trades (`runProactiveTrades`) now compute each side's
5-factor `netValue` and gate trade execution on it:

- **Proactive trades**: a candidate fires only when **both** the
  buyer's and seller's `netValue > 0`. Priority is the sum of mutual
  gain in $M, so trades that improve both rosters the most rank
  first. The existing willing-seller heuristics (surplus / rebuilder
  / STAR-only-from-rebuilders) remain as candidate-search-space
  filters but the 5-factor gate is the principled accept/reject.
- **Request-driven trades**: the buyer's `netValue` must be positive
  (buyer won't accept a player they don't value). The seller's
  evaluation is recorded for the inspector but doesn't gate — the
  player has demanded a move, so the seller is in fire-sale mode
  honoring the request.

**Behavioral shift worth noting**: under the v0.21 heuristic, a
rebuilder seller would accept any "STARTER for BACKUP" trade. Under
the 5-factor gate, they correctly reject lopsided deals — a rebuilder
giving up a $12M-value STARTER for a $3M-value BACKUP perceives a
$9M loss. Until Doc 3 (draft picks) ships, Pass 1 positional-need
trades will be rare; Pass 2 scheme-fit swaps (same-tier same-position
swaps where both teams improve fit) carry the bulk of trade volume.
This more closely matches real NFL trade patterns.

### Added — Trade metadata on `TradePayload` + `TransactionTrade` (engine)

`TradePayload` gained an optional `metadata: TradeMetadata` field
that `executeTrade` propagates verbatim onto the resulting
transaction. Manual / pre-v0.24 trades omit it. `TradeMetadata`
carries:
- `initiatorTeamId?: TeamId` — which team kicked off the conversation
- `source?: 'proactive-need' | 'proactive-fit-swap' | 'request-driven' | 'manual'`
- `teamAValue?: TradePackageEvaluation`
- `teamBValue?: TradePackageEvaluation`

`TransactionTrade` mirrors these as optional fields so the
transaction log preserves the full reasoning. Pre-v0.24 saves load
unchanged.

### Added — Inspector trade detail panel (web)

`trade` rows in the transaction log are now clickable when the
v0.24 metadata is present (back-compat: pre-v0.24 trades stay flat).
Expanding shows:
- Header: both team abbreviations, source label (e.g. "Proactive —
  scheme-fit swap"), initiator team chip
- Two side-by-side perspective panels, one per team:
  - Net value chip (`net +$4.2M` in emerald / `net -$1.1M` in rose)
  - "Receiving" + "Giving up" asset lists, each with per-player
    total $M and a 5-factor breakdown line (`Ability ×0.97 skills 68
    vs STARTER baseline 70 ×0.98, …`)
  - Dead-money charge for that side

`hasTransactionDetail` now returns `true` for both `fa-sign` and
metadata-bearing `trade` rows.

### Plan note — alternative-candidates list deferred to v0.25

The original v0.24 plan included an `alternativeCandidates` field
showing "X teams considered this trade but didn't fire" alongside
each trade. Deferred to v0.25 — useful surface, but it adds
plumbing (persist rejected candidates across both pipelines) on top
of an already-substantial slice. The 5-factor evaluator + detail
panel ship first so we can see the value numbers in motion.

405 tests passing (was 396 at v0.23.0). 9 new tests in
`trade/value.test.ts` covering positional hierarchy, window premiums
(contender vs rebuilder), age curves, package netting, and
determinism. Proactive-trades unit test for the contrived
"STARTER-for-BACKUP" scenario now correctly expects **zero** trades
(the 5-factor gate rejects the lopsided deal) — documented inline.

---

## [0.23.0] — 2026-05-14

Adds multi-dimensional filtering to the transaction log. The existing
count cards become click-to-filter chips, plus new chip grids for
team and position selection, a min-price ($M) input that hides
non-price kinds, a live result counter, and a "Show next 100" button
that lazy-loads older matches when filters narrow a window. No engine
changes — pure inspector slice.

### Added — Kind filter chips (web)

The 10 transaction-kind count cards at the top of the panel are now
clickable toggles. Click "releases" — only releases show. Click
"trades" too — both show. Active chip = emerald border + tinted
background; inactive = dim zinc. Counts stay total (not filtered) so
the full picture is always visible. Clicking any chip auto-expands
the table view so users don't need to also click expand.

### Added — Team filter chip grid (web)

32 team-abbreviation chips in a wrapping grid below the kind row.
Click to toggle inclusion. A transaction matches if *any* of its
involved teams is selected — covers both teams in a trade, both
origin + signing in a PS poach. Shows the active count next to the
section header; per-section "clear" link when any are selected.

### Added — Position filter chip grid (web)

21 position chips (QB, RB, WR, TE, OL, EDGE, DT, LB, CB, S, K, P,
LS, etc.). Click to toggle. A transaction matches if any player
referenced by it plays one of the selected positions — covers
trades (multiple players) and locker-room incidents (primary + any
involved teammate).

### Added — Min cap hit / dead money filter (web)

Numeric input ($M). When > 0, filters to transactions whose largest
dollar dimension meets the threshold:
- `fa-sign`: `yearOneCapHit`
- `trade`: `max(deadMoneyTeamA, deadMoneyTeamB)`
- `release`: `deadMoney`
- `cap-cut`: `max(deadMoney, capSaving)`

Per the design choice locked in, **setting a min price > 0 hides
kinds that have no price dimension** (mood-shift, IR, expirations,
PS promotions, trade requests, locker-room incidents). The UI shows
a small hint next to the input when active.

### Added — Result counter + Show next 100 (web)

A live counter above the table: "Showing 37 of 412 matching
transactions (X hidden by filters)." The default visible window is
100 most-recent matches. If filters narrow the matching set to fewer
than 100, all match. If filters leave more than 100 matches, a "Show
next 100 (X remaining)" button at the bottom of the table pages in
the next chunk — keeps the render bounded without virtualization.

Resetting any filter or changing the price input resets the
visible-count to 100 (so the most recent 100 matches are always
foregrounded after a filter change).

### Added — Clear filters affordance (web)

Top-right "clear filters" link appears whenever any filter is
active. Resets kind, team, position, and price filters in one click.
Per-section "clear" links scope to that dimension only.

### Implementation notes

- All filters compose: kind ∧ team ∧ position ∧ min-price.
- Empty Set = "no filter" for that dimension — the default
  shows-everything case.
- Filtering happens up front over the full log (in a `useMemo`),
  then the most-recent slice is taken. Render cost stays O(visible
  rows), independent of total log size.
- Row keys now use `tick-kind-index` so the expanded-row state
  survives filter changes that shift the visible window.

No new tests — the filter logic is straightforward UI state. Engine
test suite (396 passing) untouched. Pre-existing FA-sign detail panel
from v0.22 continues to work; clicking a fa-sign row still expands
the bidder table + winner explanation.

### Plan shift — trade detail bumps to v0.24

The v0.23 plan in the resume notes was "trade-detail panel + Doc 14
5-factor evaluator." That work is real and still queued, but the
filter-UX gap was the more pressing issue once eyes-on revealed
that even a few seasons produce thousands of transactions that the
flat 100-row tail couldn't navigate. Trade detail + 5-factor lands
in v0.24.

---

## [0.22.0] — 2026-05-14

Adds rich FA-sign detail in the inspector — click any FA-sign row in
the transaction log to expand an inline panel showing the full bidder
table (cash valuations, preference multipliers, perceived bids, cap
room at signing time), the contract terms (years × base, signing
bonus, guarantees, Y1 cap hit, proration), and a "why this team won"
callout that breaks down the winner's preference multiplier into
labeled component contributions (archetype × market size, each owner
quirk, each HC quirk, HC playerRelationships). Trade-detail panel is
deferred to v0.23 — see "Known limitation".

### Added — PreferenceFactors breakdown (engine)

New `computePlayerPreferenceBreakdown(team, player, league)` exposes
the structured contribution of every factor that goes into a
preference multiplier. Returns `{ total, archetypeMarket, ownerQuirks,
hcQuirks, hcPlayerRelationships }` numeric components plus
human-readable `archetypeLabel`, `ownerQuirkLabels[]`,
`hcQuirkLabels[]` arrays. `computePlayerPreference` is now a thin
wrapper returning `.total` — single source of truth for the
computation.

### Added — Full bidder list on auction results (engine)

`FaAuctionResult` gained a `bidders: readonly FaBidderDetail[]`
field. Each entry carries `teamId`, `cashValuation`,
`preferenceMultiplier`, `perceivedBid`, `capRoomAtTime`, and the full
`preferenceFactors` breakdown. Sorted descending by `perceivedBid`
to match the auction ordering. The existing `runnersUp: readonly
TeamId[]` (top 3) is preserved for back-compat with the news feed.

### Added — Bidders + phase on `fa-sign` transactions (engine)

`TransactionFreeAgentSign` grew two optional fields:
- `bidders?: readonly FaSignBidder[]` — populated only by the offseason
  auction. Mid-season vet-min signings and pre-v0.22 saves omit it.
- `phaseAtSigning?: LeaguePhase` — populated on every fresh fa-sign
  (auction + free-agency + mid-season vet-min paths). Lets the
  inspector show "Offseason FA market" vs "In-season vet-min"
  directly rather than re-deriving from tick.

Both fields are optional so pre-v0.22 saves load unchanged. The
inspector tolerates absence with a fallback "No auction took place
— this was a direct / vet-min street signing" message.

### Added — Inspector FA-sign detail panel (web)

`TransactionLogPanel` rows for `fa-sign` transactions are now
clickable. Clicking expands an inline panel beneath the row with:
- Player + tier + position + age header
- Phase chip (e.g. "Offseason FA market", "In-season vet-min")
- Contract terms: years, total value, total guaranteed, signing
  bonus, proration/year, NTC, year-by-year base salary chips
- Bidders table sorted by perceived bid, winner highlighted in
  emerald — columns: cash bid, ×preference, =perceived, cap room
- "Why TEAM won" callout — surfaces the winner's preferenceFactors
  labels (e.g. "distraction × LARGE market +0.060, RING_CHASER
  owner (STAR), HC relationships +0.030") plus a vs-runner-up
  comparison (cash edge + preference edge)

Only `fa-sign` rows are expandable in v0.22; other kinds keep their
flat summary display. The chevron indicator (▶/▼) marks expandable
rows so users can see what's clickable at a glance.

5 new tests in `fa-bidding.test.ts`:
- `bidders` array on `FaAuctionResult` is sorted by perceived bid +
  has all the persisted fields
- end-to-end: `fa-sign` transactions persist `bidders` +
  `phaseAtSigning` after advanceSeason
- `computePlayerPreferenceBreakdown` total equals
  `computePlayerPreference` return value (parity guard)
- breakdown component sum (clamped) matches total
- labels emit human-readable strings for fired factors

396 tests passing (was 391 at v0.21.0).

### Known limitation

Trade-detail panel is **not in v0.22**. The user asked for both FA
and trade detail; FA detail ships first because (a) the engine math
is fully there already (`auctionFreeAgent` carries the bidder list,
`computePlayerPreferenceBreakdown` provides the labeled
contributions), and (b) trade detail wants Doc 14's 5-factor
trade-value evaluator behind it so the trade panel ships with
polished value numbers rather than the current heuristic priority
scores. Trade detail lands in v0.23 alongside the 5-factor model.

---

## [0.21.0] — 2026-05-14

Adds proactive NPC dealmaking — teams initiate trades to address
positional holes and scheme-fit mismatches without waiting on a
specific player to demand a move. Layers on top of the v0.17.0
trade-request matcher; both run weekly in-season, and the proactive
pass also runs once per offseason between cap-compliance and the FA
market (matching NFL "trade window before FA opens" timing). Also
fixes a long-hidden own-promotion bug in `applyPoach` that the new
trade interaction exposed.

### Added — Proactive trade primitive (engine)

New `packages/engine/src/transactions/proactive-trades.ts`:
- `runProactiveTrades(prng, league, tick) → LeagueState` — pure
  compute, no mutation of input.

Two parallel candidate generators feed a single prioritized execution
queue (buyer-once / seller-once caps per call):

- **Pass 1 — buyer-driven positional need.** Teams in
  `CHAMPIONSHIP/CONTENDER/EMERGING` competitive windows scan for
  positional holes (below blueprint count of STAR+STARTER). For each
  hole they look for sellers willing to part with a STAR/STARTER at
  that position. A seller is willing if they have *surplus* depth
  above blueprint OR they are in a rebuild window
  (`REBUILDING/STAGNANT/RETOOLING`). STAR trades additionally require
  the seller to be a rebuilder — contending teams don't ship their
  best player without an explicit player request.
- **Pass 2 — mutual scheme-fit swap** (the "Sweat-for-Johnson"
  archetype). For each pair of same-tier players at the same
  position where each player is a poor fit on their current team
  (schemeFit < 0.85) AND a good fit on the other (schemeFit > 1.1),
  propose a swap. Both teams improve. Fires regardless of
  competitive window.

Pass 2 candidates carry a priority boost of `1000 +
improvement * 1000` so a mutual-fit swap consistently outranks a
positional-need trade — Sweat-for-Johnson is the headline behavior
the design was after.

### Added — Cap-safety guard (engine)

`PROACTIVE_TRADE_CAP_SAFETY = $5M`. Both teams must retain at least
this much cap room before a proactive trade fires. Both sides accrue
dead money from the outgoing players' remaining proration, which
without this guard could push teams past `LEAGUE_MINIMUM_SALARY`
fill-up threshold and leave them short of 53 after the offseason
FA refill. Picked to be comfortably above LEAGUE_MIN ($900k) plus a
typical mid-tier remaining-proration band ($1–4M).

### Added — In-season + offseason integration (engine)

- `simulateSeason` weekly loop now calls `runProactiveTrades` after
  `runWeeklyNpcTrades` so request-driven trades resolve first and the
  proactive pass sees the latest state.
- `advanceSeason` calls `runProactiveTrades` between `applyCapCuts`
  and `refillRosters` so teams trade first (using post-cuts roster as
  the need snapshot), then go FA shopping with a clearer picture of
  remaining holes.

No-trade clauses are respected — a proactive trade is league-
initiated, not player-requested, so the player's NTC stands unless
they've explicitly demanded a move via `tradeRequestedOnTick`.

### Added — Inspector running-version chip (web)

`apps/web/src/App.tsx` header now displays the running version as a
small monospace chip next to the title (e.g. `v0.21.0`). Wired via a
Vite `define` (`__APP_VERSION__`) that reads `apps/web/package.json`
at build time, so the chip stays in sync with the version that was
just shipped. Useful to confirm a deploy actually picked up the
latest tag when eyeballing the inspector.

### Fixed — `applyPoach` own-promotion phantom PS entry (engine)

When a team poached their own PS player (`originTeamId ===
poachingTeamId`), the team-update object literal had two entries
keyed on the same TeamId — one filtering `practiceSquadIds`, one
extending `rosterIds`. The second silently overwrote the first
because JS object-literal evaluation evaluates keys left-to-right
and keeps the rightmost. The PS filter was lost, leaving a phantom
entry on the origin team's `practiceSquadIds` (the player was also
correctly on `rosterIds`, so the phantom usually didn't cause
visible harm — `applyContractExpirations` cleaned both lists at
year-end based on the player's current `teamId`).

Exposed by the new proactive trade interaction: a player got
self-poached (phantom PS entry leaks), then traded away mid-season.
The trade updated `player.teamId` to the new team, so the
year-end contract expiration cleaned up the *new* team's lists,
never returning to filter the phantom PS entry on the original team.
Result: a season-1 PS player ID re-appeared in season-2 PS data on
the original team.

Fix: fuse the own-promotion case into a single team-object update
with both `practiceSquadIds` and `rosterIds` set correctly.

### Diagnosis note

Both regressions were caught via the standard test suite (PS-
lifecycle + career-stats tests), then traced with a small one-off
diagnostic that dumped per-player provenance (start team, current
PS list, `player.teamId`, on-roster/on-PS flags, contract id). The
diagnostic surfaced the dual-residence (BAL.rosterIds AND
NE.practiceSquadIds) inconsistency that pointed straight at the
poach own-promotion code path. Diagnostic deleted before commit.

391 tests passing (was 382 at v0.20.0).

### Known limitation

The v0.20.0 long-horizon roster shortfall residual (1–3 teams off-53
on some seeds at 10+ seasons) still applies. Proactive trades use
the `PROACTIVE_TRADE_CAP_SAFETY` guard to avoid making it worse, but
they don't address the underlying mechanism. Carrying forward to a
follow-up release once we have eyes on the auction + proactive trade
behavior in the inspector.

---

## [0.20.0] — 2026-05-14

Replaces the v0.13.0 deterministic best-fit free-agent signer with a
second-price bidding auction. Every team computes a cash valuation +
player-preference multiplier per FA; the winner is whoever maximises
perceived value, and the price is set by the runner-up. Runners-up
flow through `fa-sign` transactions into the news feed, so the
narrative surface picks up who else was in on each deal.

### Added — Free-agent bidding auction (engine)

New `packages/engine/src/transactions/fa-bidding.ts`:
- `auctionFreeAgent(league, player) → FaAuctionResult` — pure compute
  over `league` state, no mutation. Returns winner, final Y1 price,
  valuation multiplier, and up to 3 runners-up.
- `computeTeamCashBid(team, player, league, blueprintByPos) → number`
  — cash valuation in dollars: scheme fit × positional need × cap
  room, the combined multiplier bounded to [0.7, 1.2] × tier-standard
  Y1 to keep individual bids inside a stable league cap band.
- `computePlayerPreference(team, player, league) → number` — clamped
  [0.85, 1.15], built from `moodProfile.archetype` × team
  `marketSize`, owner quirks (RING_CHASER, PANIC_SELLER,
  LOYALTY_BLIND, COMMUNITY_CHAMPION, MICRO_MANAGER), HC quirks
  (CULTURE_CARRIER, PRESS_CONFERENCE_DISASTER), and HC
  `spectrums.playerRelationships`.

Pricing rules:
- Multi-bidder: `min(runnerUp.cash × 1.02, winner.cash)` — second-
  price with a 2% nudge above the runner-up, capped at the winner's
  own cash so they never pay more than they were willing to.
- Lone bidder: `winner.cash × 0.85` — 85% discount, no one to bid
  them up.
- Tier-standard Y1 anchors: STAR=$10.5M, STARTER=$4M, BACKUP=$1.2M,
  FRINGE=$900k.

`refillRosters` now drives the FA market through `auctionFreeAgent`
instead of `pickPrimarySigningTeam`. The fill-up backstop behind the
auction is unchanged — any FA who can't find a bidder still gets a
1-year vet-min deal at the most-depleted team with cap room.

### Added — Auction-driven contract scaling (engine)

`makeFreeAgentContract` grew a 5th parameter `valuationMultiplier`
(default 1.0). When called from the auction it scales both the
per-year base salary and signing bonus around the tier-standard
shape, producing real dispersion across signings of the same tier.
Caller-driven sign primitives (mid-season vet-min, explicit
team-signs-player flows) keep multiplier 1.0 and produce identical
contracts to pre-v0.20.

### Added — Runners-up on `fa-sign` transactions (engine)

`TransactionFreeAgentSign` grew an optional `runnersUp?: readonly
TeamId[]` field. Populated only by the offseason auction; mid-season
vet-min signings omit it. Pre-v0.20 saves load unchanged — the field
is optional and consumers tolerate its absence.

### Added — Runner-up coverage in the news feed (engine)

`newsFromFreeAgentSign` now surfaces runners-up in both the body
("Reported runners-up: TEAM A, TEAM B.") and the `teamIds` array, so
the news feed can attribute interest to losing bidders alongside the
winner. Tier-gating, source attribution (`national_insider` for STARs,
`beat_writer` otherwise), and severity are unchanged.

### Diagnosis note — cap-distribution mechanism

The initial implementation kept a `0.55` floor on the cap factor so
cap-pinned teams still had some bidding power. This produced a
cascade: a handful of "preferred" teams (high cap room + great HC)
won auction after auction until they sat $0.6–0.9M over cap — below
`LEAGUE_MINIMUM_SALARY` — leaving the fill-up pass with no team able
to even sign a vet-min player. Result: rosters stuck in the low 40s.
Stripping the floor (`capFactor = clamp(capRoomFrac × 1.2, 0, 1.2)`)
lets cap-poor teams drop out of bidding wars naturally, mirroring the
pre-v0.20 best-fit signer's distribution behavior without sacrificing
the auction's pricing dynamics. Diagnosis used instrumented
per-signing cap tracing rather than parameter-tweaking. League cap
band post-fix on 10-season seeds: avg $204–211M (cap $255M), max
$253–255M.

### Known limitation

The 10-season validate-progression harness reports 1–3 teams off-53
on 2 of 3 seeds — a milder long-horizon residual of the same
cap-distribution mechanism. 5-season unit tests are clean and the
single-season offseason end-to-end is clean. Pinned for a follow-up
release once we have eyes on the auction's broader behavior.

382 tests passing (was 371 at v0.19.0).

---

## [0.19.0] — 2026-05-14

Two chemistry-system follow-ups close out a v0.17.0/v0.18.x open
thread: practice-squad players are no longer frozen at their
generation-time setPoint through the season, and the existing
transaction log now powers a curated narrative news feed surfaced
in the inspector.

### Added — Practice-squad mood (engine)

PS players had `Player.mood` and `Player.moodProfile` set at
generation, but `weeklyMoodUpdate` iterated only `rosterIds +
injuredReserveIds` — so their mood sat frozen through the in-season
window even as the rest of the league drifted. v0.19.0 adds a
dampened in-season pass that keeps PS players outside the active
locker room (no contagion, no incidents, no trade demands) while
still letting their mood evolve with team context.

Drivers applied to PS:
- Drift toward personal setPoint — same rate as active (preserves
  the v0.18.2 long-horizon stability invariant).
- Team result @ `PS_TEAM_RESULT_SCALE` (0.3) — they're in the building.
- HC `playerRelationships` + quirks @ `PS_HC_INFLUENCE_SCALE` (0.5).
- Owner spectrum + quirks @ `PS_OWNER_INFLUENCE_SCALE` (0.3).
- Weekly noise envelope @ `PS_NOISE_SCALE` (0.5).

Drivers explicitly NOT applied to PS:
- Depth-chart penalty, IR penalty, scheme-fit driver, composure
  modifier — none of these match the developmental periphery role.
- Locker-room contagion in OR out — per Doc 7's framing of PS as a
  separate room from the active 53.
- Incident roll — no media blow-ups, social posts, or sideline rants.
- Trade-request emission — PS players are FRINGE/BACKUP rookies and
  shouldn't generate trade demands.

`mood-shift` transactions still emit when a PS player crosses a
bucket boundary — useful debugging signal and symmetric with active.

Structural note: the Pass 3 PS noise loop sits *after* the active
team-iteration loop, not interleaved inside it. Keeping every
active-roster PRNG draw in the exact order it had in v0.18.2 was
necessary to preserve the long-horizon dispersion invariants — a
first attempt that interleaved PS draws shifted active noise and
broke the HC-dispersion regression test.

### Added — Chemistry → news feed (engine + web)

Doc 12 (League News & Transaction Feed) MVP. Wires the append-only
`transactionLog` into a curated narrative feed that surfaces chemistry
events (leaked locker-room incidents, trade demands) plus marquee
transactions (trades, STAR/STARTER releases, big-name signings).
Pure derivation — no new persisted state — keeping the raw transaction
log available as a debug surface alongside.

Engine — new `packages/engine/src/season/news.ts`:
- `deriveNewsFeed(league, opts) → readonly NewsItem[]`
- `NewsItem` carries severity 1–5, source attribution
  (`national_insider` / `beat_writer` / `anonymous_source` /
  `social_media`), headline + body, and the underlying transaction
  kind for filter chips.
- Filter options: `sinceTick`, `teamId`, `limit`. Newest-first
  ordering, deterministic by construction.

Source-routing rules:
- `locker-room-incident`: surfaced only if `mediaLeak=true`.
  `social_media_post` flavor → `social_media`; everything else →
  `anonymous_source`.
- `trade-request` requested: STAR → `national_insider` sev 5,
  STARTER → `anonymous_source` sev 3.
- `trade-request` resolved: `beat_writer` sev 2.
- `trade`: `national_insider`, severity from highest tier involved.
- `release` / `cap-cut` / `fa-sign`: tier-gated to STAR/STARTER; STAR
  → `national_insider`, STARTER → `beat_writer`. `fa-sign` skips
  `marketContract=false` (vet-min street signings aren't news).
- `ir-move` / `ps-promotion` / `contract-expiration` / `mood-shift`:
  routine bookkeeping, not surfaced.

Web — new `NewsFeedPanel` above the existing `TransactionLogPanel` in
the inspector. Source filter chips, severity-driven left-border color,
source attribution chips, expandable, caps at 40 visible items.
Default-expanded — news is the primary narrative surface.

### Deferred — the rest of Doc 12

This is the *narrative surfacing* MVP. Doc 12 envisions a full
multi-source media ecosystem (multiple outlets covering the same
event with varying accuracy), source reliability + bias discovery
mechanics, fan sentiment by market, a sortable transaction database
with multi-dimensional filtering, generated quotes attributed to
specific reporters, and draft/prospect coverage with viral hype
cycles. All explicitly deferred to future slices — see Drive ID
`1KmRs01SHC7Wn8JhYNUgaQKtmp3XgWQPPKVxYKLU5Y4Q` for the full design.

### Notes

371 tests passing (was 350 at v0.18.2). Existing saves work without
migration — both slices read from data already present on
`Player.moodProfile` and `LeagueState.transactionLog`.

---

## [0.18.2] — 2026-05-14

### Fixed — Mood survivor drift (resolves the v0.18.0 known issue)

v0.18.0's regression tests passed but the user's inspector playthrough
still showed mood trending up year over year. Granular instrumentation
located the bias: league mean stayed flat near setPoint mean across 12
simulated seasons, but individual players who survived 10 seasons on a
roster drifted **+2.5 mood points on average**, with the drift amplified
by *inverse* resilience — `distraction` archetype +2.08, `moody` +0.87,
`stabilizer` −0.44. That fingerprint pointed at a small persistent
positive driver firing every week that resilience-based drift couldn't
pull back fast enough.

Two fixes in `packages/engine/src/season/mood.ts`:

1. **`depthChartDelta` no longer rewards starters.** Removed the +0.2
   bonus for "clear starter with no same-tier peer" and the +0.1 bonus
   for buried FRINGE. Both were persistent positive biases firing every
   week for the bulk of the roster (~25 starters per team). Being a
   starter is already baked into the player's `setPoint` at generation,
   so the bonus was double-counting role satisfaction. Depth chart is
   now a *negative-only* driver — frustration when a STAR/STARTER is
   buried behind a peer.

2. **`offseasonMoodDrift` strength bumped `0.7` → `0.9`.** The 70% value
   let small in-season biases compound year over year — even a tiny
   +0.05/wk bias accumulates noticeably across a 10-year career when
   the offseason only resets 70% of it. 0.9 wipes the slate close enough
   to setPoint each year that careers don't drift.

Re-ran the per-tier and long-tenured instrumentation after the fixes:

| Metric                                 | Before | After |
|----------------------------------------|--------|-------|
| Survivor mood change (10 seasons)      | +2.52  | +0.64 |
| STAR delta vs setPoint                 | +1.39  | +0.23 |
| STARTER delta                          | +0.40  | +0.08 |
| `distraction` archetype delta          | +2.08  | +0.50 |
| League-mean trajectory (12 seasons)    | drifting | ±0.3 of setPoint mean, flat |

**Tradeoff captured:** HC `playerRelationships` dispersion compressed
from >3 to ~1.5 mood points between top and bottom quartiles. Direction
still holds (good HC trends up, bad HC trends down), just smaller
magnitude — most HC influence now accumulates within a single season,
then the offseason pulls it back toward setPoint. Loosened the
dispersion regression test to `>1` to match.

350 tests passing. Inspector visual check confirmed.

---

## [0.18.1] — 2026-05-13

### Fixed — Inspector deploy workflow

The `Deploy inspector to GitHub Pages` workflow had been failing on
every push to `main` since the inspector was first wired up. Root
cause: the workflow ran `pnpm --filter @gmsim/web build`, but the
web app's `tsconfig.json` declares a TypeScript project reference
to `packages/engine`. Web's `tsc -p` step expects the engine's
compiled `dist/*.d.ts` files to already exist, so without an
explicit engine build it failed immediately with a cascade of
`TS6305 Output file ... has not been built` errors.

Changed the workflow build step to `pnpm --filter @gmsim/web...
build` — the trailing `...` includes workspace dependencies in
topological order, so `packages/engine` builds and emits its
`dist/` before the web app's `tsc` runs. Verified locally from a
fully clean state.

No engine or web source changes — this is a CI / deploy
infrastructure patch only.

---

## [0.18.0] — 2026-05-13

### Known issue (flagged for follow-up)

Despite the rework and the bias fix below, the user's inspector
playthrough still showed mood trending up year-over-year. The
regression tests (league mean within ±5 of setPoint mean across 4
seeds × 8 seasons) pass, so the asserted invariants hold — but the
visible behavior in the inspector tells a different story. A future
session needs to instrument the actual league trajectory across
many seasons and identify whatever bias the unit tests aren't
catching.

### Changed — Mood rework: personality-driven, no more "everyone locked in"

After fast-forwarding several seasons on a v0.17.0 save every locker
room collapsed into a single "locked in" puddle with players pegged at
mood 100. NFL rooms don't work that way — even Manning had bad days
and Tyreek Hill is never truly content. v0.18.0 replaces the single
shared baseline with per-player personality and reins in the dynamics
that produced the saturation bug.

**New on `Player`**: `moodProfile: { archetype, setPoint, volatility,
resilience }` — rolled at generation, stable for life. Five archetypes
with NFL-faithful weights: **stabilizer** (5%, setPoint 80–90, low
volatility — Manning/Lewis-tier room anchors), **anchor** (20%, 70–80),
**normal** (50%, 60–75), **moody** (20%, 50–65), **distraction** (5%,
35–55, high volatility — the Hill/Ruggs/AJ Brown archetype). Initial
mood snaps to the player's setPoint, so generation-time distribution
is varied out of the box.

**Drift now targets setPoint, not a global baseline**. Weekly drift
applied per-player is `(setPoint - mood) * resilience * 0.05` — up
from the flat 0.02 coefficient that was being overwhelmed by positive
contagion. Positive contagion lift is capped at `setPoint + 15` per
recipient so a strong locker room can't push a moody player past where
their personality naturally sits.

**Weekly noise + locker-room incidents** (new pass 3 in
`weeklyMoodUpdate`). Each player rolls a small gaussian noise delta
scaled by volatility, and high-volatility players occasionally roll
into a `locker-room-incident` transaction — flavors are `media_blowup`,
`practice_conflict`, `social_media_post`, `coach_dispute`,
`off_field_issue`, or rare `positive_moment`. Each incident has a
`mediaLeak` flag; leak probability scales with market size, owner
involvement, owner quirks (`PR_OBSESSED`, `HEADLINE_HUNGRY`), and HC
quirk `PRESS_CONFERENCE_DISASTER`. The transaction carries optional
`involvedPlayerId` / `involvedCoachId` / `involvedOwnerId` slots so the
same schema stretches to teammate disputes, coach feuds, and owner
blowups for the future news / media surface (Doc 12).

**Offseason mood drift**. `offseasonMoodDrift(league)` pulls every
player ~70% back toward their setPoint between seasons and clears
stale trade requests. Wired into `advanceSeason` after roster refill.
Mood no longer compounds across seasons forever.

**Backfill migration**. `migrateLeagueForward(league)` rolls v0.17.0
saves up to v0.18.0 by backfilling `moodProfile` on every player
missing it (deterministic from `playerId`). Called at the top of both
`simulateSeason` and `advanceSeason`, so loading an old save is a
no-op for the user.

### Added — Scheme-fit driver on weekly mood drift

Players whose archetype suits their head coach's scheme get a small
weekly mood lift; miscast players drift down. `schemeFitForPlayer`
returns a multiplier in [0.85, 1.7] with catalog mean 1.144, mapped
to a per-week delta of `(fit - 1.15) * 0.7` — recentered on the
catalog mean so the driver is zero-mean across the league. Stacks
with the `playerRelationships` HC driver: a coach can be a great
communicator yet still run a scheme that miscasts a particular
player. Special-teams archetypes always return 1.0.

### Added — Owner driver on weekly mood drift

Players are also subtly attuned to who owns the team. Two spectrum
contributions (`patience` and `financialCommitment`, centered at
5.5) and a symmetric set of quirk bonuses: `LOYALTY_BLIND`,
`COMMUNITY_CHAMPION`, `TALENT_MAGNET`, `RING_CHASER` lift mood;
`MICRO_MANAGER`, `PANIC_SELLER`, `RELOCATION_THREAT`, `PR_OBSESSED`
drag it. `HEADLINE_HUNGRY` and `RELIC` are neutral. Quirk bonuses
net to zero across the league.

### Fixed — Driver bias audit pass

Original v0.18.0 build still saturated upward in long simulations.
A bias audit caught four asymmetric drivers and rebalanced each so
the league-mean mood tracks the league-mean setPoint:
- `CULTURE_CARRIER` (+0.6) is now paired with
  `PRESS_CONFERENCE_DISASTER` (-0.6) on HC quirks.
- `playerRelationships` coefficient bumped 0.2 → 0.3 so
  good-vs-bad coach dispersion has real bite.
- Scheme-fit recentered on catalog mean 1.15 (was 1.0) — the
  catalog skews positive and the v0.18.0 first cut inherited
  +0.15/wk upward bias.
- Locker-room contagion lift floor raised 75 → 84 (symmetric
  around the league-mean setPoint with the drag ceiling at 50);
  positive coefficient lowered 0.20 → 0.15 to match drag.

### Added — Inspector surface

Player mood column now shows a personality archetype chip alongside
the bucket label and raw value, with setPoint / volatility / resilience
in the hover. Stabilizers render emerald, distractions render rose, so
the rare high-impact personalities pop visually. Transaction log gains
a `locker-room-incident` counter; media-leaked entries are prefixed
with 📰 so they stand out from purely internal beef.

**New transaction kind**: `locker-room-incident` (engine + inspector).

### Files

`packages/engine/src/types/player.ts`, `players/generate.ts`,
`players/mood-profile.ts` (new), `season/migrations.ts` (new),
`season/mood.ts`, `season/mood.test.ts`, `season/chemistry.test.ts`,
`season/runner.ts`, `season/advance.ts`, `season/index.ts`,
`types/transaction.ts`, `apps/web/src/App.tsx`.

**347 tests passing** (1 skipped harness). Regression coverage:
league-mean mood within ±5 of league-mean setPoint across 4 seeds ×
8 seasons (tight enough to catch the saturation that the original
55–80 bound let through), top-quartile vs bottom-quartile HC
playerRelationships dispersion >3 mood points, distraction vs
stabilizer mean gap >15 points, scheme-fit good vs bad direction
holds across 6 quiet weeks, offseason-drift unit test,
incident-fires-at-all test.

---

## [0.17.0] — 2026-05-13

### Added — Team Chemistry MVP (7 slices through NPC trade-finder)

Seven slices of Doc 7's Team Chemistry System. Every player now carries
a hidden 0..100 `mood` value that drifts weekly during the regular
season, feeds back into game-sim strength so chemistry actually matters
on the field, triggers trade demands when a STAR / STARTER mood
collapses, spreads through the locker room in both directions
(frustrated players drag teammates down; veteran leaders lift the room),
rolls up into a single `teamChemistry` score per team for media /
inspector surfaces, and — closing the loop — an NPC trade-finder
matches dissatisfied stars to interested buyers and actually executes
the deals. 337 tests passing.

**New on `Player`**: `mood: number` — hidden, 0..100, baseline 75.
Never displayed numerically in the eventual player-facing UI; the dev
inspector exposes both bucket label and raw value for tuning.

**New module**: `season/mood.ts` exports `weeklyMoodUpdate`,
`moodBucket`, `MOOD_BUCKETS`, `MOOD_BASELINE`. The update is a pure
function — no PRNG dependence — called from `simulateSeason` after
each week's IR / poach / FA passes so the depth-chart check sees
post-roster-churn state.

**Drift inputs** (each player, each week):
- Regression toward 75 baseline (×0.02 / week).
- Last-week W/L (+0.6 / -0.6) plus a streak amplifier at 3+ in
  either direction.
- HC `playerRelationships` spectrum centered at 5.5 (±0.9 / week);
  `CULTURE_CARRIER` quirk adds +0.4 on top.
- IR penalty scaled by tier (STAR -1.2 → FRINGE -0.1).
- Depth-chart penalty when a player is "buried" behind same-position
  peers occupying the team's starter slots for that position.
- `composure` skill dampens negative deltas at 80+, amplifies at ≤30.

**New transaction kind**: `mood-shift` — appended to `transactionLog`
when a player crosses a bucket boundary. Buckets: `wants_out` (0..19),
`frustrated` (20..39), `unsettled` (40..59), `content` (60..79),
`happy` (80..100).

**Inspector**:
- New "mood" column on `PositionGroupTable` showing bucket label
  with tone + raw value.
- `mood-shift` events surface in the transaction-log panel with a
  violet tone and a "X. Lastname unsettled → frustrated (mood 35)"
  summary.

**On-field impact**: `moodMultiplier(mood)` scales each player's
contribution to `teamStrength` and `unitStrengths` by an asymmetric
0.94..1.015× factor (penalty grows faster than bonus, matching "winning
covers many sins"). Effect is narrow on purpose — chemistry shifts box
scores without dominating talent gaps. Plays through both team-strength
(game outcome roll) and unit-strength (per-stat scaling), so frustrated
stars also drag passing/rushing/defense unit lines.

**NPC trade-finder**: `runWeeklyNpcTrades(prng, league, tick)` runs
after the weekly mood pass and tries to honor open trade requests.
For each player whose `tradeRequestedOnTick !== null` (oldest request
first):

- Scores the other 31 teams by STAR + STARTER deficit at the
  requester's position; the deepest-need buyer with cap room wins.
- Return piece is the buyer's lowest-tier player at that position,
  enforcing the "you're losing a star, we're losing depth" trope.
- Executes via `executeTrade` with `overrideNoTrade: true` — once a
  player has demanded a trade, NTC pressure is moot.
- Post-trade: requester's mood resets to baseline (75) and the
  request flag clears. "Wish granted."
- Caps: ≤1 trade per seller AND ≤1 per buyer per week, so a single
  team can't absorb a league-wide fire sale in one Sunday.

Trade-finder runs only on existing trade requests in v0.17.0 — no
proactive NPC dealmaking yet (that's Doc 14 follow-up territory).

**Team-wide aggregation**: `teamChemistry(team, league)` rolls roster
moods (active 53 + IR) into a single 0..100 score weighted by tier —
STAR mood weighs 4× a FRINGE's, since the room feels what its best
player feels. Returns bucket label (`toxic` / `divided` / `neutral` /
`cohesive` / `locked_in`) plus narrative counters: `unhappyCount`
(mood < 20) and `tradeRequestCount`. Pure compute over `Player.mood`;
no storage to keep in sync. Surfaces as a chip on each TeamCard +
expanded "locker room: X (score) · N unhappy · M trade reqs" line in
TeamDetail. Intentionally does NOT feed into `teamStrength` — the
per-player `moodMultiplier` already routes mood through to the field,
so adding an aggregate term would double-count.

**Locker-room contagion (bidirectional)**: a second pass after primary
mood drift computes both directions in one loop:

- *Negative pressure* — teammates whose staged mood is below 50
  contribute frustration weighted by their `leadership` (loud,
  respected players spread it further). Applied as drag, scaled by
  `(1 - composure × 0.7)` so stoic players resist while volatile ones
  spiral with the room.
- *Positive lift* — veterans (`experienceYears ≥ 4`) whose staged mood
  is above 75 AND whose `(leadership + workEthic) / 2` clears 60
  contribute leadership lift. `workEthic` proxies for Doc 7's
  "integrity" trait since Player doesn't carry one directly. Applied
  as boost, scaled by `(0.3 + coachability × 0.7)` so coachable
  teammates absorb more vet leadership than skeptics.

Asymmetric requirements match the doc: bad apples come from anywhere,
but stabilising voices come from veterans specifically. Mood-shift and
trade-request transactions fire against the post-contagion mood so a
player dragged into the wants-out band by their teammates still
generates the demand.

**Trade requests**: when a STAR or STARTER's mood drops to or below
`TRADE_REQUEST_THRESHOLD` (15), they demand a trade through their agent.
`Player.tradeRequestedOnTick` records the active request; a
`trade-request` transaction (`state: 'requested'`) lands in the log.
The demand is withdrawn once mood recovers to
`TRADE_REQUEST_RESOLVE_THRESHOLD` (40), emitting a `state: 'resolved'`
follow-up. BACKUP / FRINGE tiers never trigger — their agents lack
the leverage. The trade primitive doesn't act on the flag automatically;
this is observable state that a future NPC trade-finder will consume.
Inspector roster row shows a "wants out" chip on players with an
active request.

### Deliberately out of scope (later slices)
- Locker-room contagion (chemistry problems spread).
- Team-wide chemistry aggregation.
- Veteran-leadership recovery + scheme-fit driver.
- Offseason mood behavior (currently mood persists; no offseason
  drift toward baseline yet).
- Practice-squad players' mood (skipped — different dynamic).

---

## [0.16.0] — 2026-05-10

### Added — Trade builder UI in TeamDetail

Inspector panel for composing + executing trades against the v0.14.0
`executeTrade` primitive. From any team detail:

- Pick a trade partner from a dropdown of the other 31 teams.
- Two side-by-side roster columns: my outgoing players + partner's
  outgoing players. Click a row to toggle that player into the trade.
- Live "dead money" preview per side as players are toggled.
- "Execute trade" button calls `executeTrade(...)` with
  `overrideNoTrade: true` (so the inspector lets you push deals
  through any clause). On error (e.g., player no longer on roster),
  surfaces the message inline via alert.
- Roster columns sort by skill summary so the highest-impact pieces
  are at the top.

This amplifies the v0.14.0 engine work — trades were previously
only callable from code; now they're a click in the inspector.

### Changed

- Web bundle: 264KB → 271KB (gzip 81.6KB → 83.1KB).

---

## [0.15.0] — 2026-05-10

### Added — Transaction log + inspector surface

Every roster / contract transaction now lands in
`league.transactionLog`, an append-only history of typed entries.
Surfaces in the inspector for at-a-glance visibility into what
changed and when. 296 tests passing.

**New types**: `Transaction` is a discriminated union over
`release | fa-sign | trade | ir-move | ps-promotion |
contract-expiration | cap-cut`. Each entry carries `tick`,
`seasonNumber`, the players + teams involved, and kind-specific
context (dead money, year-1 cap hit, severity + weeks out, etc).

**Engine wiring**: every transaction primitive appends an entry to
`league.transactionLog`:
- `releasePlayer` → `release`
- `executeTrade` → `trade`
- `signFreeAgent` + offseason FA market signings → `fa-sign`
- mid-season FA signings → `fa-sign` (with `marketContract: false`)
- PS poaching / promotion → `ps-promotion`
- IR moves during games → `ir-move`
- offseason contract expirations → `contract-expiration`
- offseason cap cuts → `cap-cut`

`simulateSeason` threads the log through weekly poach + FA passes
alongside players / teams / contracts so all in-season transactions
land coherently in the post-season league state.

**Inspector**: new top-level `Transaction log` panel below the FA
pool. Shows total + per-kind counts, expandable to a 100-entry
recent table with color-coded kinds (red for releases / cap cuts,
green for signings / promotions, amber for trades, orange for IR).
Each row summarizes the transaction in plain language with team
abbreviations + player names.

### Changed

- `LeagueState.transactionLog` is a new required field. Any external
  consumer constructing a `LeagueState` from scratch must initialize it
  (`createLeague` already does).
- 289 → 296 tests.

---

## [0.14.0] — 2026-05-10

### Added — Doc 14 Trades MVP

`executeTrade(league, payload)` swaps players between two teams.
Mirrors NFL trade-cap mechanics: each trading team accelerates the
remaining signing-bonus proration of their traded-away players to
current-year dead money, and the receiving team gets a fresh
contract preserving the player's remaining base salaries +
guarantees but with `signingBonus = 0` (the originator paid the
bonus). `Player.teamId` and `Player.contractId` swap on each
traded player; rosters update on both sides.

Validations:
- Both teams must exist and differ.
- Each listed player must be on the listed team's active roster.
- Players with `noTradeClause` reject unless `overrideNoTrade: true`.

Public API: `executeTrade`, `TradePayload`. Multi-player swaps
supported on each side. Draft picks, third-team brokers, and cash
considerations land alongside the draft module — out of scope here.

Tests (`trade.test.ts`, 11 new): single-player swap, multi-player
swap, contract preservation w/ signingBonus zeroed, dead-money
accrual on both trading teams, NTC blocked w/ override path, same-
team rejection, missing-team rejection, cap impact direction,
determinism.

### Changed

- 278 → 289 tests.

---

## [0.13.0] — 2026-05-09

### Added — Doc 7 Roster Management (slices 1–9), playoff injuries, mid-season FA, top-51, stats-driven dev

Phase 2's "auto-renewal placeholder" → real roster-management pipeline.
Doc 7 now drives the full offseason and in-season transaction loop, plus
two long-deferred items (playoff injury propagation; stats-driven dev).
Tests grew 220 → 278.

**Player releases + dead money.** New `releasePlayer(league, playerId)`
drops the contract, marks the player a free agent, and accrues
`deadMoneyOnPreJune1Release` to the team's new `deadMoneyByYear`
field (per-year future cap charges, indexed by season offset). The
charge shifts left each `advanceSeason` and is folded into
`teamCapUsage`. Inspector shows `☠ $XM` chips on team cards.

**Free-agent pool + offseason FA market.** Auto-renewal removed.
`advanceSeason` now runs `applyContractExpirations` →
`applyCapCuts` → `refillRosters` (tier-ordered FA market with
multi-year contracts) → `refillPracticeSquad`. The market scores
each FA by `positional need × scheme fit × cap room` and signs at
tier-appropriate AAVs (STAR 4yr / STARTER 3yr / BACKUP 2yr / FRINGE
1yr min). Cap-aware: signings respect the cap ceiling. Cap usage
after 5 seasons settles around $200-220M average — the ~$425M
auto-renewal bug is gone.

**Injured Reserve.** New `TeamState.injuredReserveIds`. MAJOR-severity
injuries during a season now move the player off `rosterIds` onto
IR (so game-sim strength + re-injury rolls correctly skip them).
Offseason `advanceSeason` activates IR back to active. Inspector
shows `⛑ IR (n)` line in team detail.

**Practice squad (16 per team).** New `TeamState.practiceSquadIds`,
`PRACTICE_SQUAD_SIZE = 16`, `PRACTICE_SQUAD_SALARY = $250K`, and
`refillPracticeSquad`. Each team starts with 16 PS rookies on
1-year PS-min contracts; PS contracts expire each offseason and
PS slots refill with fresh undrafted rookies. PS contracts are
cleanly excluded from `teamCapUsage` (which iterates `rosterIds`).
`processRetirements` extended with an off-roster pass so PS
players + unsigned FAs don't accumulate past age 40.

**PS poaching.** New `runWeeklyPoaching(prng, league, signedOnTick)`
runs each week after games + IR moves. Teams below 53 active with
cap room scan all 32 teams' PS lists for the best-fit player at
their biggest positional deficit; promote with a 1-year league-min
active contract.

**PS protection list (4 per team per week).** Each team's top-4 PS
players (by skill × scheme fit) are shielded from external
poaching. Owning teams can still promote their own protected
players — protection only blocks outside claims.

**Mid-season FA signings.** New `runWeeklyFreeAgentSignings` runs
after weekly poaching. Teams still below 53 with cap room sign
the best-fit street FA at any of their positional deficits to a
1-year league-min deal.

**Interactive release in inspector.** Each player row in TeamDetail
now has a `release` button that shows an inline `+$Xsav / dead $Y`
preview before confirming. Confirm calls `releasePlayer` and
threads new league state up to App.

**Free-agent pool panel.** New top-level inspector section showing
total FA count + per-tier breakdown, expandable to a 50-row table
of top FAs sorted by tier desc + skill.

### Added — Playoff injury propagation (deferred from v0.7.0)

`runPlayoffs` now returns `{ playoffs, players }` instead of just the
bracket. Each playoff game's `result.injuries` propagates onto
`Player.injury` with playoff-specific `occurredOnTick` (WC=+17,
DIV=+18, CONF=+19, SB=+20). IR moves intentionally skipped —
playoffs end immediately and the offseason heal clears state.
`simulateSeason` now writes the post-playoff player map back into
the league.

### Added — Top-51 cap rule

Real NFL behavior: only the 51 highest cap hits count during the
offseason; all 53 count during regular season + playoffs. New
`TOP_51_OFFSEASON = 51` constant. `teamCapUsage` branches on
`league.phase` — REGULAR_SEASON / PLAYOFFS use all-53; everything
else uses top-51. Dead money always counted regardless of phase.
`simulateSeason` overrides `phase: 'REGULAR_SEASON'` on weekly
leagues used for game sim, poaching, and mid-season FA so in-game
cap checks correctly see all 53.

### Added — Stats-driven development (deferred from resume notes)

Players who outperform their position-group median grow faster on
technical/mental skills; below-median performers grow slightly
slower. New `computePerformanceMultipliers(league, seasonStats)`
returns per-player multipliers in `[0.95, 1.30]`:
- QB: `passingYards + 25×passingTds − 25×interceptionsThrown`
- SKILL: `rushingYards + receivingYards + 50×TDs`
- DL/LB/DB: `tackles + 30×sacks + 60×interceptions`
- OL/ST: no individual stats yet → neutral 1.0×

Multiplier mapping vs position-group median: `≥1.5×` → 1.30,
`≥1.1×` → 1.10, `≥0.5×` → 1.00, `<0.5×` → 0.95.
`advancePlayerDevelopment` takes an optional `performanceMultiplier`
(default `1.0`) and applies it to technical/mental growth rates only.
Aging decline on physical skills is unchanged.

### Changed

- `runPlayoffs` return type changed to `RunPlayoffsResult` —
  `{ playoffs: PlayoffsState, players: Record<string, Player> }`.
  Single in-tree caller (`simulateSeason`) updated. Affects external
  consumers of the public export.
- FA-market AAVs trimmed ~25% (STAR base $7M + $14M signing; STARTER
  $3M + $3M; BACKUP $1.1M + $200K) so steady-state cap leaves room
  for fill-up signings to reach 53.
- `advance.test.ts` semantic tests updated — "renewed at 1 year
  remaining" replaced with "expired and re-signed via FA market"
  matching the new flow.

---

## [0.12.0] — 2026-05-09

### Changed — stat realism + per-unit skill alignment

Box-score-level stats now track NFL averages over the 2014-2024 decade
and respond to roster talent (a STAR QB on a great OL produces
meaningfully more passing yards than a FRINGE QB on a weak OL).

**Per-unit team strengths.** New `unitStrengths(team, league)` returns
`passOffense / rushOffense / passDefense / rushDefense` (each on the
0-100 scale). `rollStats` consumes these so per-game yardage,
turnovers, and sacks shift by relevant unit advantage:
- passingYards mean = `220 + passAdv × 1.6 + pointsScored × 1.6`
- rushingYards mean = `110 + rushAdv × 1.0 + pointsScored × 0.6`
- turnovers mean = `1.3 + (oppPassDef − ownPassOff) × 0.018`
- sacks mean = `2.4 + (ownPassDef − oppPassOff) × 0.035`

Across a season this typically produces a ~1,300-yard spread between
the worst-passOffense and best-passOffense team's QB1 — realistic NFL
variance.

**Stat distribution fixes.**
- Pass + rush TDs are now derived from points scored (`~64% of points
  → offensive TDs; ~62% of those are passing`), not from yardage. Old
  formula gave starting QBs 50+ pass TDs/season — now ~25, matching
  NFL avg.
- INTs use `fractionalRound(turnovers × 0.5, gameSeed)` — a
  deterministic mean-preserving round that avoids `Math.round`'s
  round-half-up bias (which inflated INTs by ~50%).
- Pass attempts derived from `passingYards / 7.6` (up from 7.0) for
  ~30 attempts/game.
- Tackles bumped from 55 to 62 per team per game to match top-end NFL
  numbers (~150 tackles for a season leader).

**Bug fix.** `isNonEmpty` now retains stat lines that have only
yardage (no targets/attempts/tackles). Previously a 7th receiver
picking up rounding-slack yards (e.g., 4 receiving yards on 0
targets) was filtered out, silently dropping league-wide totals.

### Audit numbers (3 seeds × 1 simulated season)
| Stat | NFL avg / leader | New |
|---|---|---|
| QB starter pass yds | ~3,800 / 5,476 record | 4,266 / 5,200 |
| QB starter pass TDs | ~25 / 55 record | 24.7 / 32 |
| QB starter INTs | ~10 / 17 typical leader | 11.5 / 17 |
| Top RB rush yds | ~1,400 / 2,027 record | 1,677 / 1,770 |
| Top RB rush TDs | ~13 / 28 record | 14 / 15 |
| Top WR rec yds | ~1,500 / 1,964 record | 1,555 / 1,568 |
| Top sacks | ~17 / 22 record | 21 / 21 |
| Top tackles | ~150 | 156 / 168 |

---

## [0.11.0] — 2026-05-09

### Added — Phase 2: Career awards snapshot

- **`CareerAward` type** (`packages/engine/src/types/awards.ts`). `{ kind, seasonNumber }` with `AwardKind = 'MVP' | 'OPOY' | 'DPOY' | 'OROY' | 'DROY' | 'COY'`.
- **`Player.careerAwards: readonly CareerAward[]`** and **`HeadCoach.careerAwards: readonly CareerAward[]`**. New fields. Initialized empty for league-creation players, retirement-replacement rookies, and all coaches.
- **`advanceSeason` snapshots awards.** Each season's MVP/OPOY/DPOY/OROY/DROY winners get an entry appended to their `Player.careerAwards`; the COY winner gets one on `HeadCoach.careerAwards`. So a 4-year MVP appears as `[{kind:'MVP', seasonNumber:1}, ..., {kind:'MVP', seasonNumber:4}]`.
- **Inspector — career award badges.** Roster table player names now show an amber chip like "★ 3× MVP" if the player has any career awards. Hovering shows the per-season breakdown ("Year 1: MVP\nYear 3: MVP\n..."). Same chip on head coach lines in team cards.
- **7 new tests** (212 total, 1 skipped harness). Fresh leagues start empty; MVP winner's careerAwards has exactly one MVP entry tagged with the season just played; COY accrues to the coach (not players); multi-season counts league-wide equal seasons advanced (every season produces exactly one of each award); rookies start empty; multi-seed determinism.

### Deferred

- **Retiree award history is dropped** (same caveat as `careerStats`). A future retired-players archive preserves it.

---

## [0.10.0] — 2026-05-09

### Added — Phase 2: Season awards

- **`seasonAwards(league)`** (`packages/engine/src/season/awards.ts`). Pure & deterministic derivation of year-end awards from the just-played schedule + records + season stats. Returns null for every category when `league.schedule` is null.
  - **MVP** — top QB by `passingYards + 30·passingTds + 2500·winPct(team)`. Heavily favors winning QBs (a 4500/35 QB on a 12-5 team beats a 5000/40 QB on a losing team).
  - **OPOY** — top non-QB skill-position player by yards from scrimmage + TD bonus + record bonus.
  - **DPOY** — top defender by `150·sacks + 100·INT + 1.5·tackles + 1500·winPct`.
  - **OROY / DROY** — same scoring as OPOY/DPOY filtered to `experienceYears === 0`.
  - **Coach of the Year** — head coach of the team with the best win pct, point-differential tiebreaker.
- **Inspector — Awards panel.** New section under Season Leaders showing all six winners with player/coach name, team, and a stat-line summary.
- **10 new tests** (205 total, 1 skipped harness). Empty/cleared leagues return all-null; complete slates produced for every played season; MVP is always a QB; OPOY is non-QB skill; DPOY is defensive; ROY winners are first-year; COY references a real team's head coach; multi-seed determinism.

### Deferred

- **Award histories.** Awards are not yet snapshotted into `Player.careerAwards` or `TeamSeasonRecord.awards`, so they vanish when `advanceSeason` clears the schedule. A history snapshot is the natural follow-up alongside Doc 12 (League News & Transaction Feed).
- **Improvement-based COY.** Real NFL Coach-of-the-Year often goes to whoever exceeded prior-year expectations. Phase 2 just uses raw record because we don't yet have prior-year baselines for all teams.

---

## [0.9.0] — 2026-05-09

### Added — Phase 2: Career stats history

- **`CareerSeasonStats` type** (`packages/engine/src/types/stats.ts`). Same shape as `PlayerSeasonStats` plus the `seasonNumber` it was recorded in.
- **`Player.careerStats: readonly CareerSeasonStats[]`**. New field on the player record. Initialized empty for league-creation players and rookie replacements; appended to in `advanceSeason`.
- **`advanceSeason` snapshots stats**. After computing season stats via `seasonStatsForLeague`, each player who recorded non-zero output gets a new entry appended to `careerStats` tagged with the season just played. Players with zero output don't get sentinel entries — `careerStats.length` is the number of seasons they actually contributed in.
- **Inspector — career column**. Team detail roster table gained a `career` column showing position-relevant aggregated totals across every recorded season (e.g. "18,420 pass yds, 142 TD (5y)" for a long-tenured QB).
- **8 new tests** (195 total, 1 skipped harness). Fresh leagues start empty, entries strictly monotonic in `seasonNumber`, snapshotted entry equals aggregator output for the season just played, rookies (from retirement replacement) start with empty careerStats, multi-season determinism, NFL-realistic 5-season top-QB career yards (8k–35k).

### Deferred

- **Retiree career history is dropped.** When a player retires, their entire `careerStats` history goes with them since they're removed from `league.players`. A future "retired-players archive" slice (probably alongside Hall-of-Fame mechanics) preserves this.
- **Awards / season recap derivation** (MVP / OPOY / DPOY / Coach of the Year) — natural follow-on now that career and season stats both exist. Deferred.

---

## [0.8.0] — 2026-05-09

### Added — Phase 2: Per-player stats persistence

- **`PlayerGameStats` + `PlayerSeasonStats` types** (`packages/engine/src/types/stats.ts`). 15-stat surface covering passing (attempts, completions, yards, TDs, INTs thrown), rushing (attempts, yards, TDs), receiving (targets, receptions, yards, TDs), and defense (tackles, sacks, INTs). Intentionally narrow — enough to feed a leaders board and scouting/dev signal, not a play-by-play sheet.
- **`deriveGamePlayerStats(game, league)`** (`packages/engine/src/games/stats.ts`). Pure & deterministic (no PRNG). Distributes team-level `GameResult` numbers across the rosters that played using largest-remainder integer splits: QB1/QB2 share pass volume 93/7; RBs share carries by tier; WR/TE/RB receivers share targets via a Pareto-ish distribution `[0.28, 0.20, 0.16, 0.13, 0.10, 0.08, 0.05]` ranked by `receivingWeight × keySkillAvg`; defensive tackles split LB/DB/DL 55/30/15%, sacks EDGE 60% / interior 40%, INTs DBs 80% / LBs 20%. Stat conventions match conventional NFL box scores: `team.turnovers` = offense committed, `team.sacks` = defense generated.
- **`seasonStatsForLeague(league)`** (`packages/engine/src/season/stats.ts`). Walks every played regular-season + playoff game and aggregates per-player season totals. Plus `playerSeasonStats(league, playerId)` for single-player lookup. Per the `GameResult` design comment, stats are NOT stored on the game itself — they're derived at attribute time. The inspector `useMemo`s the aggregator so 272-game walks happen once per league change.
- **Inspector — Season Leaders panel.** Top-5 boards for passing yards, passing TDs, rushing yards, receiving yards, sacks, and INTs across the league. Visible whenever a season has been simulated.
- **Inspector — per-player season stat column.** Team detail roster table gained a `season` column showing the position-relevant key stat (passing yds + TDs for QB; rushing yds + TDs for RB; rec/yds/TDs for WR/TE; sacks + tackles for DL; tackles + sacks + INTs for LB; tackles + INTs for DB).
- **15 new tests** (187 total, 1 skipped harness). Per-game reconciliation (passing/rushing/receiving yards, defensive sacks each sum to team totals), determinism, top-QB-has-non-zero-output, NFL-realistic passing leader range (2,500–7,000 yds), gamesPlayed in [17, 22], league-wide passing equals league-wide receiving, empty/cleared leagues return empty maps.

### Deferred

- **No PRNG noise in distribution** — same game + same rosters → same stat lines. Play-by-play resolution remains out of scope.
- **No "did the player play?" gating.** Injured players can still receive stat lines; the game sim doesn't yet skip them when assembling lineups.
- **No special-teams stats** (K/P/LS produce no output) and **no OL stats** (sacks allowed, pancakes).

---

## [0.7.0] — 2026-05-07

### Added — Phase 2: Retirement + injury propagation

- **Retirement + rookie replacement** (`packages/engine/src/season/retirement.ts`). Age-based retirement rolls in `advanceSeason`: 0% under 34, 5% at 34, 15% at 35, 30% at 36, 50% at 37, 70% at 38, 90% at 39, 100% at 40+. Every retiree's slot is backfilled with a freshly-generated rookie at the same position, weighted by the team's HC scheme. Retirees' contracts are dropped; rookies get fresh rookie-scale contracts (`yearsRemaining = realYears`). Placeholder for the full draft + UDFA pool dynamics that land in Phase 3 (Doc 3).
- **Injury propagation** (`packages/engine/src/season/runner.ts`). `simulateSeason` now copies `GameResult.injuries` onto `Player.injury` after each game so subsequent weeks see updated injury state. A weekly recovery sweep clears injuries whose `estimatedReturnTick` has passed. `advanceSeason` clears every remaining injury — offseason heals.
- **`generatePlayer` extensions.** Two new options for mid-sim generation: `forceAgeStage` (skip the weighted age roll, e.g. for rookie-only generation) and `simYear` (anchor `birthDate` to the current sim year instead of the league epoch). `ageToBirthDate` parameterized accordingly.
- **`generateContract.fresh` option.** When true, sets `yearsRemaining = realYears` and `signedOnTick = currentTick` for brand-new contracts (used by retirement replacement). League-creation default still rolls `yearsRemaining` uniformly so initial contracts look mid-stream.
- **21 new tests** (172 total, 1 skipped harness). Retirement: probability curve invariants, deterministic outcomes, age cap (no one over 40), 53-man roster stability, contract drop on retirement, fresh contracts on rookies. Injuries: end-of-season presence, occurredOnTick within window, estimatedReturnTick after occurredOnTick, intra-season recovery, offseason healing, determinism.
- **Validation harness** rerun: average roster age dropped from ~37 → ~29 across 3 seeds × 10 seasons (NFL-realistic). Skill-bound violations remain 0. Dynasty emergence intact.

### Deferred

- **Playoff injury propagation** is intentionally skipped — injuries during playoffs don't affect anything else this Phase since the season ends right after.
- **Cap discipline.** Auto-renewal placeholder + fresh rookie contracts together push some teams' max cap usage to ~$425M (was $365M). Real free agency / cap mechanics fix this.
- **Real medical staff / IR / multi-week recovery modeling.** Player.injury is a single struct; multiple injuries, treatment, training-staff effects are deferred.

---

## [0.6.0] — 2026-05-07

### Added — Phase 2: Season-end progression

- **Player development** (`packages/engine/src/season/development.ts`). `advancePlayerDevelopment(prng, player, league)` advances one league year of progression: experience years +1; physical, technical, mental, and stable skills evolve at per-stage growth rates (rookie technical/mental gains 6–12 pts/yr, prime gains 1–3 pts/yr, stable traits crawl, physical skills grow only as rookies and decline through veteran/aging stages). Development archetypes (`FAST_LEARNER`, `LATE_DEVELOPER`, `EARLY_BLOOMER`, `SLOW_STEADY`) modulate per-stage growth. Tier is re-derived from new current ratings each year so a developing FRINGE can rise to STARTER.
- **`advanceSeason(league)`** (`packages/engine/src/season/advance.ts`). Run at the end of a played season to produce the next year's offseason: appends a `TeamSeasonRecord` (W-L-T, division finish, playoff outcome — including which round a team lost in if any) to every team's `seasonHistory`, recomputes competitive window from win pct, advances every player via `advancePlayerDevelopment`, decrements every contract's `yearsRemaining`, auto-renews expired contracts at the player's current tier (Phase 2 placeholder for real free agency), increments `seasonNumber` and `tick` by one league-year, clears `schedule`, and flips `phase` to `OFFSEASON_PRE_FA`. Fully deterministic.
- **Web inspector — multi-season simulation.** Replaced the single Simulate Season toggle with a stateful league + Simulate / Advance / +1y / +5y / +10y controls. Header shows current season number and phase. Player ages now track current sim year via `ageOfPlayer()`. Team detail drawer gained a season history table showing W-L, division finish, and postseason result for each prior year. Team cards flag dynasties (3+ playoff appearances or 2+ Super Bowl wins).
- **15 new tests** (151 total, 1 skipped harness). Multi-season determinism (same seed + same advance calls → identical state across teams, players, contracts), age + experience progression invariants, contract decay + expired-contract auto-renewal, season history accumulation, roster size stability across 5+ seasons, cap usage stays in plausible band.
- **Validation harness** (`validate-progression.test.ts`, `describe.skip` by default). Prints multi-season stats — cap drift band, age distribution, dynasty emergence — for hand-eyeing progression changes. Across 3 seeds × 10 seasons: 0 skill-bound violations, dynasties emerge organically (e.g., LAC 4 SBs / 8 playoffs in one seed, GB 2 SBs / 3 playoffs in another), average team cap usage $234M–$261M (cap $255M).

### Deferred

- **Injury propagation** (`GameResult.injuries` → `Player.injury`) lands when stats persistence ships. `advanceSeason` ignores in-game injuries for now.
- **Real free agency.** Auto-renewal at current tier is a placeholder so contracts don't expire into thin air. Replaced in Phase 2 follow-up by the FA market dynamics from Doc 4 / Doc 7.
- **Retirement + draft replenishment.** With no retirement and no draft, rosters age uniformly across multi-season runs (avg 37 after 10 seasons in the validation harness). Both come together in the Player Lifecycle slice.
- **Coaching focus allocation.** Player Development doc's coaching resource interface is skipped; every player gets baseline coaching attention.

---

## [0.5.0] — 2026-05-07

### Added — Phase 2: Game simulation, schedule, season runner, playoffs

- **Game outcome simulator** (`packages/engine/src/games/`). `simulateGame(prng, opts)` produces a `GameResult` with scores, team-game stats (yards, turnovers, sacks, third-down %, red-zone TD %), per-game injuries, and a categorical variance label (controlled / moderate / pure per the Game Sim doc 70/25/5 mix). Logistic conversion of strength delta to win probability calibrated to NFL upset rates (Δ=3 → ~55%, Δ=10 → ~72%, Δ=20+ → 90%+). Home field advantage of 3 strength points; neutral-site flag for the Super Bowl.
- **Team strength calculator.** Single-number derivation from roster talent (top players weighted by position group: QB 35%, OL 15%, DL/DB/SKILL 12% each, LB 10%, ST 4%) + average scheme fit + coaching contribution + organizational stability.
- **Schedule generation.** 17 weeks × 16 games per week = 272 games; every team plays exactly 17 games. Pair-meeting cap of 2 enforced. Phase 2 takes the always-succeeds path: random perfect matchings each week with a soft-penalty retry against over-met pairings. NFL formula precision (division doubling, cross-conference rotation) deferred to a later refinement.
- **Season runner.** `simulateSeason(league)` returns a new league with `schedule.regularSeason` fully played, then runs the playoff bracket and populates `schedule.playoffs`. Deterministic for the same league + seed.
- **Playoffs.** Top 4 division winners (seeds 1-4) + 3 wildcards (seeds 5-7) per conference. Wild Card (3 games per conf, seed 1 bye) → Divisional (2 per conf, top seed hosts lowest remaining) → Conference Championship → Super Bowl (neutral site). Champion crowned in `playoffs.championId`.
- **Standings module.** `computeRecords`, `sortByRecord`, `divisionStandings`, `playoffSeeds`. Tiebreaker ladder: win % → division win % → conference win % → point differential → team ID.
- **Injury simulation.** Per-position per-game injury rates calibrated against the Game Sim doc's season rates (RB 1.1%/game ≈ 17% per season; LB 0.8%/game ≈ 13% per season; QB 0.3%/game ≈ 5% per season). Severity distribution 50/35/15 minor/moderate/major, with weeks-out ranges that match the doc.
- **Inspector — season view.** New "Simulate Season" button; when active, every team card shows W-L record; team detail header shows season record; a new top-level Season Results panel shows champion, both conferences' playoff seeds, and division standings.
- **24 new tests** (160 total). Game determinism, score plausibility, home-field advantage statistical signal across 400 trials, neutral-site removal of HFA, schedule validity (17 games/team, no team plays twice in a week, no pair >2 meetings), season runner integration (every game played, records sum to 17, league-wide W = L), playoff structure (3+2+1 per conference + 1 SB, every game played, champion crowned).

### Added — Phase 1: Contracts + Salary Cap accounting

- **Contracts module** (`packages/engine/src/contracts/`). Generates a contract for every player at league creation, tier-sized: STAR gets 4-year deals with $18-38M signing bonus + $8-14M base salary; STARTER gets 3-4 year mid-market deals; BACKUP gets 2-3 year minimum-plus deals; FRINGE gets 1-2 year vet-minimum deals. Contracts include realistic guarantee tapers (year 1-2 of star deals fully guaranteed, later years injury-only or non-guaranteed).
- **Cap accounting helpers**: `signingBonusProrationPerYear`, `capHitForYear`, `currentCapHit`, `teamCapUsage`, `summarizeTeamCap`, `deadMoneyOnPreJune1Release`. Implements NFL proration math (signing bonus spread evenly across contract length, capped at 5 years; void years extend the proration window).
- **`createLeague` extended** to populate `LeagueState.contracts` and assign every Player.contractId. League-wide contract count = league-wide player count = 1,696. Same seed reproduces identical contracts down to per-year base salaries.
- **`Player.tier`** is now a first-class field on the Player type, set at generation and used by contract generation. Avoids the boundary-drift problem of re-deriving tier from current skills.
- **Inspector cap displays.** Each team card now has a current-year cap usage bar (over-cap teams flagged in red); team detail drawer shows cap-vs-ceiling delta and per-player current-year cap hit + years remaining in each row of the position-group tables.
- **23 new tests.** Cap math (proration, capHitForYear over years 0..N+1, currentCapHit derivation, dead money on release), contract determinism, contract length matches tier template, league-wide cap usage stays within plausible NFL range, total contract count matches player count.

### Fixed

- **Skill-roll formula tier-separation bug.** Previous formulation `weightedMean = min(95, ceilingBaseline × weight)` saturated at 95 for any (tier, weight) pair where `tier_baseline × weight ≥ 95`, making STAR and STARTER players' weighted skills indistinguishable. Replaced with linear bias: `weightedMean = ceilingBaseline + (weight - 1) × 7`, clamped to [25, 99]. Tier separation now holds across all skills, which in turn produces realistic cap distributions (avg ~$235M per team under a $255M cap rather than the previous $880M+ runaway).

### Added — Phase 1: Scheme Identity, Player Archetypes, and Roster generation

- **Scheme Identity module** (`packages/engine/src/scheme/`). Per-scheme metadata for all 7 offensive schemes (West Coast, Air Raid, Pro Style, Run-Heavy, Spread, RPO-Based, Multiple/Hybrid) and 6 defensive schemes (4-3, 3-4, Nickel-Heavy, Cover 2 Shell, Aggressive Blitz, Hybrid Multiple): philosophy, pace, pass/run balance, pressure rate, coverage shell, real-world coordinator examples.
- **Player Archetype catalog** (`packages/engine/src/archetypes/`). 33 archetypes across QB/RB/FB/WR/TE/OL/DL/LB/DB/ST. Each defines compatible positions, scheme-fit multipliers per scheme (e.g., `QB_DUAL_THREAT` is +70% in RPO and -30%-40% in traditional pocket schemes per the Player Archetypes design doc), and skill-priority weights used for skill rolling.
- **Scheme fit calculator** (`packages/engine/src/scheme/fit.ts`). `schemeFitForPlayer(player, { offensiveScheme, defensiveScheme })` returns the fit multiplier — pure data lookup, fast, deterministic. Used downstream by trade evaluation, performance calc, free agency targeting.
- **Player generation** (`packages/engine/src/players/`). `generatePlayer(prng, opts)` produces a fully-populated Player: archetype-weighted by team scheme, age-cohort distribution (rookie/developing/prime/veteran/aging weighted 10/20/50/15/5%), talent tier (star/starter/backup/fringe weighted 5/35/40/20%), hidden current and ceiling skill ratings (gaussian rolls biased by archetype skill weights × tier baseline × age realization curve), and a development archetype.
- **Skill realization model.** Physical skills (speed, strength) barely grow after entering NFL per the Player Development design doc; technical and mental skills grow substantially through prime; rookies have meaningful current-vs-ceiling gaps in technical/mental categories. Veteran players show physical decline but retain technical mastery.
- **Roster generation** (`generateRoster`). 53-player roster blueprint (3 QB / 3 RB / 1 FB / 6 WR / 3 TE / 10 OL / 8 DL / 6 LB / 10 DB / 3 ST) with scheme-weighted archetype selection so RPO teams cluster around dual-threat QBs, 3-4 teams have more nose tackles, Vic Fangio-style defenses end up with more zone-coverage corners, etc.
- **`createLeague` extended.** Every team now has a fully populated 53-man roster with players in `LeagueState.players` (1,696 players league-wide) and player IDs on `TeamState.rosterIds`. Same seed produces an identical league down to every skill rating.
- **24 new engine tests.** Player determinism, archetype validity per position, current-never-exceeds-ceiling invariant across 100 trials, age-distribution shape, scheme-fit math, scheme-skewed roster archetype distribution (RPO vs Air Raid produces statistically different QB archetype mixes), full-league roster integration, roster-wide scheme-fit averages.
- **Web inspector — roster drawer.** Click any team card to open a per-position-group roster table showing name, age, archetype label, average key-skill (current and hidden ceiling), and per-player scheme-fit multiplier with extremes color-coded.

### Changed

- **`Player.archetype` typed strictly.** Promoted `ArchetypeId` from a string to a literal union in `types/player.ts` so player records can't carry stale archetype IDs. Archetype catalog re-exports the type to avoid duplication.
- **Engine subpath exports.** Added `@gmsim/engine/scheme`, `@gmsim/engine/archetypes`, and `@gmsim/engine/players` for scoped imports.

[Unreleased]: #unreleased
[0.5.0]: #050--2026-05-07
[0.4.0]: #040--2026-05-07
[0.3.0]: #030--2026-05-07

### Added — Phase 1: Personnel Generation slice

- **Owner / GM / Head Coach generation** (`packages/engine/src/personnel/`). Each role samples an archetype with probable spectrum ranges, rolls spectrum scores within those ranges, picks 2-4 quirks from a role-specific pool, and rolls six gaussian-biased personality traits. Identical seeds produce identical personnel (deterministic via the seeded PRNG with stable forks per sub-system).
- **Hiring tendency logic.** GM archetype probability is weighted by owner profile (analytics-leaning owners gravitate toward Analytics Architects; spendthrift + low-knowledge owners produce Cap Disasters; impatient owners produce Win-Now Aggressors; etc.). HC archetype probability is similarly weighted by combined owner + GM profiles.
- **Scheme assignment.** Head coaches receive an offensive scheme (West Coast / Air Raid / Pro Style / Run-Heavy / Spread / RPO / Hybrid) and defensive scheme (4-3 / 3-4 / Nickel-Heavy / Cover 2 Shell / Aggressive Blitz / Hybrid). Assignment is biased by the coach's offensive-defensive identity spectrum and archetype (innovators favor RPO/Spread; rigid coaches over-index on Pro Style / Power).
- **Fan-base profile generation** (`fan-base.ts`). Each market size has baseline ranges per L/L-01 resolution (Large markets less patient + more analytics-aware, Small markets more loyal + more traditional). Franchise history archetypes apply additive modifiers (Lovable Loser +3 patience, Recent Dynasty +2 urgency, etc.). All values clamped to [1, 10].
- **Team Personality formula** (`team-personality.ts`). Implements the L/L-01 weighted blend (50% Owner + 20% GM + 20% HC + 10% Fans) across all six dimensions: risk tolerance, analytics orientation, patience, financial aggressiveness, championship urgency, and organizational stability. Each dimension averages multiple component spectrums per the spec before blending.
- **`createLeague(seed)` entry point** (`packages/engine/src/league/`). Generates all 32 teams' personnel + Team Personalities + fan bases + initial competitive windows from a single seed. Output is a fully-populated `LeagueState` ready for downstream system consumption.
- **Phase 1 web inspector.** Replaced the Phase 0 placeholder with a dev-only view that surfaces every team's owner/GM/HC/quirks/scheme/Team Personality, with a re-rollable seed input and a league-wide distribution summary that flags any L/L-01 constraint violations (>4 teams at a dimension's extreme).
- **42 new engine tests.** Owner/GM/HC determinism, archetype range respect, quirk distribution, hiring tendency statistical signal (analytics owners → analytics GMs is detectable; meddler owners → old-school GMs is detectable), Team Personality math (owner extreme dominates, involvement+ego pull stability down), fan-base modifiers, and full-league determinism + uniqueness + L/L-01 distribution constraints across 50 seeds per dimension.

### Changed

- **Collapsed `@gmsim/data` into `@gmsim/engine`** (`packages/engine/src/data/`). The split was speculative and created a cyclic workspace dependency once the engine started consuming static team identity data. Static reference content (32 NFL teams, name pools) is now an internal engine concern, exposed via the `@gmsim/engine/data` subpath export. `@gmsim/data` package was deleted.

### Notes

- Per design doc, **all spectrum scores, quirks, and personality traits are hidden from the player.** The current web view exposes them because it's a dev verification tool, not a player-facing surface. The Phase 4 Scouting Report UI/UX module will replace the inspector with attributed observations per North Star.
- The `OWNER_ARCHETYPES` / `GM_ARCHETYPES` / `HC_ARCHETYPES` catalogs are an initial designer-defined set fulfilling the Personnel Generation doc's open thread on "realistic spectrum range constraints per archetype category." They are tunable; the hiring weights are likewise tunable in `gm.ts` and `hc.ts`.

---

## [0.1.0] — 2026-05-07

### Added

- **Monorepo scaffolding.** pnpm workspaces + Turborepo, three publishable packages (`@gmsim/engine`, `@gmsim/data`, `@gmsim/web`), shared TypeScript config, Prettier + EditorConfig.
- **Engine type system** (`packages/engine/src/types`) covering `LeagueState`, `TeamIdentity`, `TeamState`, `Player`, `Owner`, `Gm`, `HeadCoach`, `Contract`, `TeamPersonality`, plus branded ID types (`TeamId`, `PlayerId`, etc.) and stable string-literal enums for divisions, positions, market sizes, scheme archetypes, franchise histories, and competitive windows.
- **Seeded PRNG** (`packages/engine/src/prng`) — sfc32 algorithm with cyrb128 seed mixing. Supports `next/nextInt/nextRange/pick/shuffle/weighted/gaussian/normal`. Independent forks via `fork(label)` so subsystem changes don't shift random outcomes elsewhere. Serializable for save/load.
- **All 32 NFL teams** (`packages/data/src/team-base/teams.ts`) with conference, division, and market-size classification matching the design doc requirement (8 LARGE / 14 MEDIUM / 10 SMALL).
- **Web app shell** (`apps/web`) — Vite + React 18 + Tailwind. Renders a deterministic PRNG self-check and the league grouped by division as a sanity check that engine + data + UI wiring all resolve.
- **Anchor docs** — `docs/NORTH_STAR.md` (information attribution, hidden complexity, authentic discovery) and `docs/LIVING_LEAGUE.md` (32-team simultaneous simulation, NPC AI requirements, stress-test checkpoints).
- **Design docs index** — `docs/design-docs/README.md` lists all 17 module docs + 2 anchor docs + 2 resolution docs + 4 research docs with their Drive IDs, organized by implementation phase.
- **Test suites.** `@gmsim/engine` has 10 PRNG tests (determinism, fork independence, serialize/deserialize round-trip, statistical weighting, property-based bounds checks via fast-check). `@gmsim/data` has 5 tests asserting team count, conference split, division balance, market-size distribution, abbreviation uniqueness.
- **Versioning workflow** — Conventional Commits convention documented in `CONTRIBUTING.md`; this changelog; `scripts/sync-versions.mjs` for in-sync bumping across all workspace packages.

### Notes

- No game logic yet. This is scaffolding only — the goal of Phase 0 was to lock the architecture so Phase 1 can implement game systems against stable seams.
- Real NFL team names are used because the project is single-player and internal. If distribution scope ever changes, `packages/data/src/team-base/teams.ts` is the only file affected.
- North Star compliance is enforced at the type level: ground-truth `Player` records are not interchangeable with the (not-yet-built) UI snapshot type. The knowledge layer (`packages/engine/src/knowledge`) is empty but reserved.

[0.2.0]: #020--2026-05-07
[0.1.0]: #010--2026-05-07
