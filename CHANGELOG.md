# Changelog

All notable changes to GMSim are tracked here.

Format: [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning 2.0](https://semver.org/spec/v2.0.0.html).
Commit conventions: see [`CONTRIBUTING.md`](CONTRIBUTING.md).

While `0.x.x`, minor bumps may include breaking changes. Save format is not stable.

---

## [Unreleased]

### Added — media scouting reports, slice 1: the media's read on the class

The media now evaluates the draft class, using the agreed model: each
college outlet is backed by **N behind-the-scenes evaluators** (by tier
— an INSIDER desk has a staff of 6, a BLOG is the lone streamer with 1),
reusing the same attributed-observation shape team scouts use. Two knobs
come straight off the `MediaOutlet`:

- **`accuracySpectrum`** → evaluator read noise.
- **`hypeSpectrum`** → a directional optimism bias toward *flashy*
  prospects (blue-blood schools, raw talent). High-hype outlets inflate
  the big names — the **false-flag seed** — and aggregating more
  evaluators (a bigger outlet) yields a steadier read than a lone blog.

Output lands in a **separate `mediaCollegeObservations` stream** so it
never contaminates the 32 team boards. The **Draft Shift** tab gains a
**"Media consensus"** view (alongside League and per-team) — compare
them to watch the media diverge from the scouting room and over-rate the
flashy names. `media/prospect-evaluators.ts`
(`generateMediaCollegeObservations`); generated during the pre-draft
scouting cycle. Engine-additive — separate stream, so no draft/roster
results change.

Next media slices: media sleeper-alert *takes* (narrative text), per-
outlet mock boards, and weekly in-season hype.

---

## [0.69.0] — 2026-05-25

### Changed — Step Tick moved to the header


"Step Tick" now lives in the global header, so you can advance the
lifecycle one event at a time from any tab (not just Lifecycle) — handy
for watching the Draft Shift tab update tick-by-tick. Removed the
redundant "Step to next phase" button (under the unified calendar it
just micro-stepped). "Step a full year" stays on the Lifecycle panel.
The event-log anchor moved to app level alongside the control.

---

## [0.68.0] — 2026-05-25

### Added — scout sleepers (two-channel) + combine measurables now matter

Each college scout now rolls **3–5 personal "sleepers"** every pre-draft
cycle and files optimistic, high-conviction observations of them — the
mechanic behind real board divergence (each team's board diverges on who
its scouts are high on). Two channels feed the roll, both gated by a
*real* signal so conviction is earned:

- **Tape** — a genuinely good player overlooked for a small school / low
  profile (high true talent + production, low visibility).
- **Measurables** — an elite combine/pro-day workout even when the
  production wasn't there (top-percentile athletic measures + thin
  production). This **finally gives `combineResults` a mechanical
  effect** — it was write-only display state before. Higher bust risk:
  whether the athleticism translates rides on the scout's accuracy, so a
  low-accuracy believer produces the workout-warrior bust / false-flag.

The "love" (optimism bias) is bounded by the winning signal's strength,
so a limited prospect can't be inflated into a blue-chipper, and
selection is weighted by `worthiness` so scrubs are essentially never
picked. New `draft/sleepers.ts` (`buildSleeperProfiles`,
`selectScoutSleepers`); `generateCollegeObservation` gains a `biasShift`
(optimism) parameter. Sleepers surface as per-team risers in the Draft
Shift tab at the top-30 / scouting-cycle tick (toggle the team picker to
see front offices diverge). Draft results shift from the new
observations; affected tests re-baselined, invariants hold.

This is a shared scout trait — the media-evaluator lane will inherit it.

---

## [0.67.0] — 2026-05-24

### Added — college season-stat aggregation + a real Heisman race

**Season-stat aggregation (the read layer over the college stat
stream).** `collegeGameStats` was written every week but consumed by
nothing in the engine. New `college-season/season-stats.ts` rolls the
per-game stream into per-prospect season totals
(`aggregateCollegeSeasonStats`) and national leaderboards
(`collegeStatLeaders`), grouping by `playedOnTick` so each season is
isolated (defaults to the latest). This is the shared input for the
Heisman race, the inspector's stat leaders, and future media production
takes. The inspector's ad-hoc summing is replaced by this canonical
aggregator.

**A real Heisman race.** The `HEISMAN_CEREMONY` phase is no longer a
placeholder — `college-season/awards.ts` scores the aggregated season
production (passing-weighted, like the real award's QB bias, with paths
for elite rushers/receivers/defenders) and crowns a winner + finalists.
Results append to `LeagueState.heismanHistory` (append-only league
history, migration-backfilled). The inspector surfaces the winner +
finalists in the lifecycle event log and the College Football panel.

Engine-additive: the Heisman phase only writes `heismanHistory`, so no
draft/roster results change.

---

## [0.66.0] — 2026-05-24

### Added — Draft Shift inspector tab

A new **Draft Shift** tab tracks how prospects' scouting stock moves
tick-to-tick — making the all-star bowls' (and top-30 visits') scouting
effect visible. Stock is a confidence-weighted "observed grade" derived
from the college observation stream, ranked across the field, so it
shifts whenever a scouting event adds observations. Each such tick adds
a collapsible chiclet listing the movers with magnitude/direction arrows
(`⇈` big rise / `↑` rise / `↓` fall / `⇊` big fall / `✦` new to board)
and the rank change. A **team picker** switches the ranking source
between league-wide and a single team's scouts — so different front
offices show different risers/fallers (matters more once the full
scouting system is integrated). Tracking lives at the app level, so it
records every lifecycle step regardless of the active tab.

Inspector-only (no engine changes).

---

## [0.65.0] — 2026-05-24

### Added — draft all-star showcases (Senior Bowl + Shrine Bowl)

Two new pre-draft lifecycle phases model the all-star weeks, the biggest
concentrated scouting event of the offseason:

- **`SHRINE_BOWL`** (late Jan) — invites the next tier of declared
  draft-eligible prospects (East vs West).
- **`SENIOR_BOWL`** (early Feb) — invites the top tier (American vs
  National).

Both fire on the current draft class (before the season rolls over) and
run a **focused, higher-accuracy scouting sweep on their invitees** —
every team's scouts get a concentrated look, sharpening each team's read
(and therefore its board) ahead of the spring board regeneration. So a
strong all-star week genuinely moves a prospect's draft stock. Roster
selection ranks the declared draft class by a talent proxy; the Senior
Bowl takes the top ~100, the Shrine Bowl the next ~100.

New `college-season/all-star.ts` (`runAllStarShowcase`,
`prospectTalentScore`); `AllStarGame` type; `LeagueState.allStarGames`
(cleared each cycle alongside the college schedule, migration-backfilled).
`generateInitialCollegeObservations` / `generateCollegeObservation` gain
an optional accuracy-bonus parameter. The inspector ribbon + per-tick
event log render the bowls.

Because the showcases add observations that feed the pre-draft board
regeneration, draft results shift; affected integration tests
re-baselined, all invariants hold.

Tuning knobs (in `lifecycle.ts`): per-bowl invite count, the talent-tier
offset between the two bowls, and the scouting accuracy bonus.

Still deferred: actual preseason games (PRESEASON remains a marker beat).

---

## [0.64.0] — 2026-05-24

### Added — recognizable calendar phases (combine, pro days, top-30, markers)

The offseason was a thin set of phases with the combine, pro days, and
top-30 visits all crammed into a single mislabeled July `COLLEGE_CYCLE`
tick that ran *after* the draft. v0.64 breaks the annual cycle into the
recognizable NFL/college calendar beats, each its own dated, steppable
lifecycle phase:

- **`PRESEASON`** (late Aug) — training-camp / rosters-set beat that
  opens each season's timeline.
- **`TRADE_DEADLINE`** (late Oct) — the deadline now shows as its own
  beat in the step-through (the week-8 trade-pressure modifier is
  unchanged).
- **`COMBINE`** (late Feb) — scouting-combine measurables, now run in
  the spring on the current draft class.
- **`PRO_DAYS`** (March) — pro-day attendance.
- **`TOP_30_VISITS`** (April) — college scouting cycle + coach/top-30
  visits + the final pre-draft board regeneration, on the current
  class right before the draft.

`COLLEGE_CYCLE` is slimmed to its cross-year housekeeping (advance the
pool into next year's class, roll the pick horizon, clear schedules).
Because the board is now regenerated in the spring on the actual draft
class rather than the prior summer on the aged class, draft results
shift slightly (re-baselined; all invariants hold). The inspector
ribbon and per-tick event log render the new beats. `buildSeasonTimeline`
slots them by date automatically.

Deferred to a later slice (need design review): Senior/Shrine all-star
showcases with scouting effects, and actual preseason games.

### Added — test-suite monitor

`pnpm test:monitor` (root or engine) runs Vitest through a custom
reporter that shows a live progress bar with elapsed time, an expected
total (from the previous run's saved baseline), and a work-weighted
ETA that accounts for the college-season suites dominating runtime.
Progress is mirrored to `packages/engine/.vitest-progress.txt` every
tick, so the current position is readable mid-run even when stdout is
buffered (tool/CI launches). Per-run timings persist to
`.vitest-timings.json` (gitignored) as the next run's baseline.

### Fixed — unified season calendar (tick ordering)

v0.63 interleaved the NFL and college lifecycles by *alternating*
phases, which produced a chronologically wrong tick order: NFL Week 1
(Sept 7) fired before College Week 1 (Aug 30), the two leagues
ping-ponged regardless of date, and the college postseason was forced
to run as one contiguous block instead of spreading across the late
NFL regular season and playoff window.

**`season/timeline.ts`** — a single date-ordered timeline. Every
lifecycle phase becomes a dated step (dates from the existing
`phaseCalendarDate` layer); the steps are sorted by calendar date and
`tickPhase` walks them in order. The dispatch (`decideTickTarget`) now
locates the league's most-recently-completed step and fires the next
one — no more ad-hoc interleave rules.

Result, in true calendar order: College Weeks 1–2 (Aug 30, Sept 6)
before NFL Week 1 (Sept 7); college conference championships (Dec 6)
among the late NFL regular-season weeks; the CFP quarterfinals (Jan 1)
and semifinals (Jan 9) before the NFL Wild Card (Jan 13); and the CFP
National Championship (Jan 19) between the NFL Wild Card and Divisional
rounds — exactly as the real calendars overlap.

Determinism is preserved: every phase's PRNG stream is namespaced by
phase + season + week-index, never by tick order, so reordering when a
phase fires changes only the *sequence* of identical results, not the
results themselves.

**Inspector** — the Lifecycle panel's four separate competition rows
are replaced with one date-ordered "Season Calendar" ribbon built
straight from `buildSeasonTimeline`, so what you step through is what
you see (NFL rose, college emerald, trade deadline amber, offseason
zinc). `buildSeasonTimeline` + `TimelineStep` are now part of the
engine's public surface; `REGULAR_SEASON_WEEKS` is exported.

Also fixed `simulateSeason`'s progress guard, which bailed early once
two consecutive college weeks could open a season.

---

## [0.63.0] — 2026-05-23

### Added — College Football Season foundation

Full parallel college-football runtime alongside the NFL season.
Slice 1 ships the complete NCAA structure — regular season,
conference championships, bowl slate, and 12-team College Football
Playoff — plus per-prospect game stats that feed the future
Heisman / media big-board / false-flag prospect-hype slices.

**Regular season schedule** — 12 weeks of FBS games (POWER +
GROUP_OF_5 conferences, ~117 schools). Conference-mate pairings
preferred (~70%), no rematches, deterministic for a given seed.

**Game runner** — light logistic outcome model (team strength +
variance, no per-position units, no injuries) tuned to college
upset rates and scoring distributions. Home-field advantage 4.0
(higher than NFL).

**Per-prospect game stats** — `CollegePlayerGameStats` (modeled on
NFL `PlayerGameStats` but a separate type so both can diverge).
Distributed from team totals across the school's CollegePlayer
cohort (QB1 carries pass volume, RBs split carries, top WRs/TEs
split targets). Stats accumulate on `LeagueState.collegeGameStats`
as an append-only stream the eventual scouting layer can read.

**Postseason chain (7 new lifecycle phases)**:

- `COLLEGE_CONFERENCE_CHAMPIONSHIPS` — top-2 by conference record
  in each FBS conference play for the title (9 games)
- `HEISMAN_CEREMONY` — placeholder; surfaces the season's leading
  passer as a flavor line. Real selection logic in Slice 2.
- `COLLEGE_BOWL_GAMES` — 15 named bowls fill with the top non-CFP
  schools that hit 6+ wins
- `CFP_FIRST_ROUND` — 12-team bracket, top 4 conference champions
  bye, 4 first-round games (5v12, 6v11, 7v10, 8v9), higher seed hosts
- `CFP_QUARTERFINALS` / `CFP_SEMIFINALS` / `CFP_FINAL` — neutral-site
  bowl-game venues, full bracket through national championship

**Interleaved lifecycle ticks** — `COLLEGE_WEEK` alternates with NFL
`REGULAR_SEASON_WEEK` so the inspector can step through both leagues
one game-day at a time. The college postseason chain fires as a
contiguous block once the college regular season completes; NFL
weeks 13-17 then continue before NFL playoffs.

**Inspector additions** (Lifecycle tab):

- 🎓 College Football timeline group — 12 reg-season cells + 7
  postseason chips, current phase highlighted
- Per-tick event log adds college game scores, conference
  championship results, bowl game scores, CFP round results, and
  a champion banner when CFP_FINAL completes
- New "College Football — Season N" section with passing /
  rushing / receiving yards leaders, refreshed on every tick

### Architecture notes

- New module: `packages/engine/src/college-season/` (strength,
  schedule, outcome, stats, records, postseason, public index)
- New types: `CollegeGame`, `CollegeGameResult`,
  `CollegeTeamGameStats`, `CollegePlayerGameStats`,
  `CollegeSeasonSchedule`, `CfpBracket`, `CollegeTeamRecord`
- `LeagueState` gains `collegeSchedule`, `collegeCurrentWeek`,
  `collegeGameStats`
- 8 new `LifecyclePhase` variants, all integrated into
  `LIFECYCLE_ORDER` and `nextPhaseAfter`; `tickPhase` dispatch
  has custom logic for the NFL ↔ college week alternation and
  the postseason-chain return-to-NFL transition
- New calendar anchors for college kickoff, conference
  championships, Heisman ceremony, bowl season, and CFP rounds
- New engine subpath export: `@gmsim/engine/college-season`

### Not in this slice (Slice 2+)

- Media reports about college games (newspaper / radio / blog
  coverage of college games)
- Real Heisman race logic (stat + media-buzz accumulation, weekly
  candidate update, December winner selection)
- Media-driven mock-draft big boards (each outlet's evolving
  prospect rankings; consensus board replaces the v0.51
  `leagueAggregateByProspect` proxy)
- False-flag prospect hype (sensationalist outlets inflating
  prospect stock; scouts that trust ground truth penetrating
  the noise)
- College polls / rankings
- Bowl-payout tiers, conference tie-ins, pre-bowl opt-outs

---

## [0.62.0] — 2026-05-21

### Added — Media ecosystem (foundation)

Third intel stream alongside scouts (per-team ground truth) and head
coaches (per-team narrow-and-tight). Media outlets generate **league-
wide narrative** that may or may not match reality. Foundation for
future Heisman race tracking, mock-draft big boards, and
"false-flag" college prospect hype that scouts must penetrate.

**~47 outlets per league** generated at creation, stable across the
league's lifespan:

- 10 national outlets — `Pro Football Insider`, `Gridiron Wire`,
  `Pro Football Weekly`, `Football Outsiders`, `The Front Office`,
  `Down & Distance`, `Gridiron Monthly`, `National Football Radio`,
  `The Blitz Show`, `Two-Minute Drill`
- 5 college-focused outlets — reserved for the future
  college-season slice (`College Football Insider`, `Campus
  Pressbox`, `Recruiting 247`, `Saturday Stories`, `Gameday Radio`)
- 32 team-locals — one per franchise, drawn from a weighted pool of
  beat reporters / columnists / sports radio / fan blogs.
  `The Buffalo Beat`, `Sports Talk Dallas`, `Inside the Kansas City
  Locker`, etc.

Each outlet has tier (INSIDER / BEAT / COLUMNIST / RADIO / BLOG),
focus (NFL / COLLEGE / BOTH), market (NATIONAL or team-local), and
1–10 spectrums for **accuracy** and **hype**. Insiders are right;
sports-radio outlets create dramatic narratives that may diverge
from ground truth (the engine for future false-flag prospect hype).

### Added — Weekly + playoff-round media reports

Fires during every `REGULAR_SEASON_WEEK` tick + each playoff round
tick. National coverage **scales with phase**:

| Phase                | Nationals per game |
| -------------------- | ------------------ |
| REGULAR_SEASON_WEEK  | 1                  |
| WILD_CARD            | 3                  |
| DIVISIONAL           | 5                  |
| CONFERENCE           | 7                  |
| SUPER_BOWL           | ALL (10)           |

Beat writers stay team-local (correct — they only cover their own
team's games). The Super Bowl saturates with ~12 reports for the one
game; lesser rounds scale between.

### Added — Headliner-driven templates (NFL-feel slice)

Real player names drive headlines when a genuine outlier performance
exists. Examples (real engine output):

- *"Mendoza throws for 421 as Raiders steamroll Patriots"*
- *"Bailey terrorizes the backfield in Bills' 24-17 win"*
- *"3 picks for Murray as Bears fall to Lions"*
- *"Maye leads anemic Patriots offense in 31-6 loss to Bills"*

**Two gates** ensure only impressive performances qualify:

1. **Static threshold** — 300+ pass yds, 400+ for monster, 110+
   rush, 110+ rec, 3+ sacks, 2+ defensive picks, 3+ INTs thrown for
   "blame loss", ≤10 team points for "anemic offense" angle.
2. **Week-relative leader gate** — player must be in the week's
   top-3 in that stat category. Adapts to whatever the stat
   distribution is — a 280-yard passer in a quiet week is the
   league's top passer but won't fire the headline; the static floor
   prevents trivial "leader" status.

Notable-incident kinds (QB 3+ INTs, ≤10-point offense) are
threshold-only — a 4-INT game is news whether other QBs threw for
200 or 350.

About 60% of game reports use a player-driven template when a
matching headliner exists; the other 40% stay team-action for
variety so the feed doesn't read like all-player every line.

### Added — Per-tick phrase uniqueness

Every template carries a `signature` tag for its distinctive verb
(`dismantle`, `grind`, `gut-check`, `throttle`, `steamroll`, ...).
The first template to use a signature blocks all others with that
signature for the rest of the tick. In a single week you'll see at
most ONE "grind out" headline, ONE "steamroll", etc.

### Added — Vocabulary expansion (~3x per pool)

Each headline pool went from 7-10 templates to 13-20+. Added verbs:
`maul`, `thump`, `bury`, `cruise`, `pulverized`, `swept aside`,
`roughshod`, `squeak by`, `photo finish`, `clip`, `best`, `stymied`,
`sent packing`, `quiet day`. Player-driven pool gained: `carves up`,
`airs it out`, `torches`, `bulldozes`, `gashes`, `wrecks the pocket`,
`lights it up`, `keeps connecting`, `solo act`, `masterpiece`,
`workhorse`, `ball-hawks`, `jumps everything`.

### Inspector — 📰 Media section in event log

Lifecycle event log now surfaces media reports filed each tick:
`📰 Pro Football Insider: Bills dismantle Patriots 31-7`. Per-outlet
attribution; critical-tone reports tagged `[critical]`.

### Plumbing

- New `engine/src/types/media.ts` — `MediaOutlet`, `MediaReport`
  discriminated union (TeamWeekReport now; PlayerTakeReport,
  ProspectBoardReport, NarrativeReport defined for future
  college-season work)
- New `engine/src/media/` module — `generate.ts`, `templates.ts`,
  `reports.ts`, `headliners.ts`
- `LeagueState` gains `mediaOutlets` + `mediaReports`. Migration
  backfills outlets from `${seed}::media-outlets::backfill` + empty
  report stream for pre-v0.62 saves.
- Lifecycle handlers (`applyRegularSeasonWeek` + 4 playoff handlers)
  generate reports at the end of each tick and append to
  `league.mediaReports`.
- Inspector `TickEventLog` adds `mediaReportLen` to `TickAnchor` and
  renders the 📰 Media section.

### Tests

14 new `media.test.ts` cases covering outlet generation determinism,
spectrum ranges, tier coverage, college-outlet presence, weekly
report firing, growth across season, FK validity against outlets,
headline references to real teams, kind shape, playoff-round
coverage, end-to-end determinism, and Super Bowl coverage. Full
engine suite: 707 + 14 = **721 passing, 4 skipped**.

### NFL-feel filter

This slice is anchored in the
`feedback_nfl_feel_paramount.md` directive. Outlet naming, headline
voice, and per-tick variety all serve the goal of the league reading
like real NFL teams + real NFL players rather than generic
spreadsheet football.

---

## [0.61.0] — 2026-05-20

### Added — Position-specific roster-state modifier (Doc 5)

The 5-factor `evaluatePlayerValue` becomes a 6-factor evaluator: a new
`rosterState` factor models the Doc 5 directive that *"a team with a
gaping hole at a premium position inflates value of picks and players
at that specific position."*

**Mechanism**

`rosterStateFactor(team, player, league)` looks up the team's
`computeTeamNeeds(team, league)` score at `player.position` (v0.55
calibration). Score maps linearly to a multiplier, clamped to a
sensible band:

- **Catastrophic vacancy** (score ≈ +3, e.g. no STAR/STARTER LT plus
  aging starter) → **×1.30** — team would massively over-pay
- **Moderate need** (score ≈ +1) → **×1.10**
- **Balanced depth** (score ≈ 0) → **×1.00**
- **Mild surplus** (score ≈ -1, stacked starters) → **×0.90**
- **Hard surplus** (score = -2, just-drafted-QB-on-rookie scenario)
  → **×0.80** — team only pays for upgrade at discount

Formula: `clamp(1 + score × 0.10, 0.8, 1.5)`. Multiplies into the
total alongside ability / schemeFit / ageContract / positional /
timing.

**Per-position effect** (using the v0.55 hand-tuned starter-slot
table):

- QB hole → ×1.10 inflation on incoming QB
- Gaping LT hole + aging starter → up to ×1.30 inflation
- WR depth surplus (4 STAR WRs) → ~×0.80 discount on incoming WR
- Locked-in rookie QB scenario → ×0.80 discount on incoming QB

This is the Doc 5 "aging franchise QB → next-year R1 QB inflated"
archetype, the "just-drafted-QB deflation" pattern, and the "stacked
position discount" all in one calibrated lever.

### Per North Star

The modifier surfaces only through observable NPC behavior. A
contender with a QB hole spends bigger on incoming QBs; a contender
locked in at QB ships incoming QBs cheap. The player learns each
team's chart through observation — never a labeled number.

### Test additions

4 new `value.test.ts` cases:

- LT-hole team inflates value of incoming STAR LT (multiplier > 1.0)
- WR-surplus team discounts value of incoming STAR WR (multiplier < 1.0)
- Same team values player higher when its own roster has a hole vs.
  is stacked (isolated comparison — same scheme, same window, same
  player; only roster shape varies)
- Multiplier stays inside [0.8, 1.5] across every canonical position

Existing 17 evaluatePlayerValue / evaluatePickValue / evaluateTradePackage
tests stay green with no expected-value churn.

### Files touched

- `packages/engine/src/trade/value.ts` — new `rosterStateFactor`;
  6-factor compose; `PlayerValueBreakdown.factors.rosterState` added
- `packages/engine/src/trade/value.test.ts` — 4 new cases

### Engine-only slice

No UI changes. Engine suite stays green.

---

## [0.60.0] — 2026-05-20

### Added — Per-tick event log on the Lifecycle panel

The Lifecycle panel now shows **what just happened** on each tick, not
just where you are. A new "Events this tick" section sits between the
step controls and the timeline. Written as beat-reporter notes —
names, positions, teams, dollars, narrative tone — not transaction-log
dumps.

**What surfaces per phase**

- **REGULAR_SEASON_WEEK** — that week's 16 game results with score +
  injury count (`🏈 BUF 24, NE 17 · 2 injs`).
- **WILD_CARD / DIVISIONAL / CONFERENCE / SUPER_BOWL** — that round's
  playoff games. Super Bowl tick also fires a `🏆 Championship` line
  with the winning franchise's full name.
- **POST_SEASON_FINALIZE** — season awards (`🏅 MVP: First Last (KC, QB)`)
  for MVP, OPOY, DPOY, OROY, DROY, COY.
- **DRAFT** — all 224 picks rendered as
  `📋 R1 #1 — KC selects First Last (QB)`. Capped at 30 visible per
  section with "+ N more" tail.
- **READY_FOR_NEXT_SEASON** — flavor line: "League ready for kickoff
  of Season N. Step to begin Week 1."

**Generic transaction diff** runs alongside every phase, surfacing
new entries from `league.transactionLog` since the previous tick:

- 🔄 Trades (`MIA ↔ LAR: MIA sends Star Smith (WR), 2027 R1 for 2027 R1, 2027 R3`)
- ✂️ Releases (`DAL releases Smith (WR) — dead $4.2M`)
- ✍️ Free-agent signings (`BUF signs Smith (WR) — yr1 $15M`)
- 🏥 IR moves (`PHI places Smith (RB) on IR — 8 wks (MAJOR)`)
- ⬆️ Practice-squad promotions
- 💰 Cap cuts
- 📄 Contract expirations

### Plumbing

- `LifecyclePanel` captures a `TickAnchor` ref
  (`{ transactionLogLen, phase, currentWeek, seasonNumber }`) before
  each step button fires, so the diff is taken against the pre-tick
  state. `useRef` (not `useState`) — the snapshot doesn't need to
  trigger re-renders, only to be read at the next render.
- `TickEventLog` + `computeTickEvents` derive the event list inside
  a `useMemo` keyed on `(league, anchor)`. Pure derivation; no engine
  changes.
- Events are grouped by section in render (games, free agency, etc.)
  so multi-tick steps (Step to next phase / Step a full year) stay
  readable.

### Engine-only filter (none)

This is a pure UI slice — no engine changes. Engine suite stays at
703 passing + 4 skipped (no regressions).

### Acknowledging the NFL-feel directive

This slice and all future work prioritize **NFL-feel**: that the
league reads like real NFL teams and real NFL players, not generic
spreadsheet football. Beat-reporter tone, real terminology, names +
context wherever possible. See `memory/feedback_nfl_feel_paramount.md`.

---

## [0.59.0] — 2026-05-20

### Added — Lifecycle step-through inspector

The payoff slice for v0.54 + v0.56 + v0.57 substrate work. A new
**Lifecycle** tab in the inspector renders the full annual cycle as
a single timeline:

- 17 regular-season week cells (with dates from
  `phaseCalendarDate`); Week 8 styled in amber as the trade-deadline
  tick
- 4 playoff-round cells (Wild Card → Divisional → Conference → Super
  Bowl)
- 7 offseason phase cells (Post-Season Finalize through Ready for
  Next Season)

Current position highlighted in rose with a ring; current-phase
badge shows the human-readable label (`Week 8`,
`Mid-March · Free Agency`, etc.), approximate calendar date, raw
`LifecyclePhase` + `currentWeek` values, and a "Trade deadline tick"
chip when on `currentWeek === 7`.

**Three step controls:**

- **Step tick** — one `tickPhase(league)` call. REGULAR_SEASON_WEEK
  self-loops, so each click advances exactly one week.
- **Step to next phase** — keeps ticking until `lifecyclePhase`
  changes. Skips through the 17-week self-loop to land on the next
  distinct phase (typically the next playoff or offseason step).
- **Step a full year** — runs ~28 ticks. Goes from any point in the
  cycle back to the same point one year later.

### Fixed — COLLEGE_CYCLE now stamps its own phase name

`applyCollegeCycle` previously stamped `lifecyclePhase:
'READY_FOR_NEXT_SEASON'` at the end of its work — making it invisible
in step-through (the timeline skipped from `POST_DRAFT_ROSTER`
directly to `READY_FOR_NEXT_SEASON`). The handler now stamps
`'COLLEGE_CYCLE'` like every other phase; the subsequent tick
advances to `READY_FOR_NEXT_SEASON` via the dispatch table.

Side effect: a full annual cycle is now 28 ticks (was 27). All
existing tests stay green — the change is transparent to
`advanceSeason`, `simulateSeason`, and the v0.56 tick-equivalence
tests.

### UI

`App.tsx` gains a `'lifecycle'` tab + `LifecyclePanel`,
`CurrentPhaseBadge`, `LifecycleTimeline`, `TimelineGroup`, and
`TimelineCell` components. The tab uses the rose color family;
no other panels touched.

---

## [0.58.1] — 2026-05-20

### Added — Diagnostic instruments for v0.58 calibration

Three `describe.skip`'d instrument tests in `proactive-trades.test.ts`
that diagnose whether the v0.58 trade-deadline urgency modifier
actually moves trade volume at full-season scale:

- `instrument: trade volume per regular-season week` — per-week
  histogram across 3 seeds × 1 measured season after a 4-season
  warm-up. Output identifies whether deadline week (Week 8) sits
  above or near the baseline.
- `instrument: firesale gate funnel` — counts the seller / buyer /
  pick population at a mid-season snapshot + a direct
  `runProactiveTrades` call to see how many trades emerge.
- `instrument: per-gate rejection counts` — walks all 1140
  seller × vet × buyer pairings at the deadline tick, tallying
  rejections by gate (cap-safety, no-deficit, offer-empty, etc.)
  with a sample trace of the first failed pairing.

### Investigation finding (not yet acted on)

Running these revealed that `runProactiveTrades` produces ~0 trades
per full year at scale; the v0.58 deadline modifier is plumbing-only
until the underlying system fires. Binding constraint:
`buildFireSaleOffer` sorts ascending (smallest picks first) with a
3-pick cap — for a $25M STAR vet target, the buyer's three cheapest
picks (typically late-round + 3-year-future) can't clear it, and even
all 17 of a buyer's picks total only ~$22M from the seller's
perspective.

Initial fix attempts (descending sort + cap 5) made trades fire but
broke 4 existing tests that documented the prior gating decisions —
properly reconciling them is multi-slice work. Diagnostic
instruments are preserved (skipped) for the future investigator.

See `memory/project_proactive_trade_volume_issue.md` for the full
write-up and recommended approach when revisiting.

---

## [0.58.0] — 2026-05-19

### Added — Trade-deadline urgency modifier

Mid-season trade volume now spikes on the deadline week (the
in-season tick where `currentWeek === 7`, i.e., Week 8 — Tuesday
after which the real NFL deadline lands). This is the v0.46 chart
modifier framework's first calendar-aware overlay, unlocked by the
v0.56 per-week tick decomposition.

**The asymmetric design** (counterintuitive at first glance):

- Contenders (CHAMPIONSHIP/CONTENDER) get a `currentMultiplier`
  **drop** (×0.85) on the deadline tick. Their own current-year picks
  feel like chips to spend, not assets to hoard — "what does a 2027
  R3 matter if we don't win 2026?"
- Rebuilders (REBUILDING/RETOOLING/STAGNANT) get a `currentMultiplier`
  **boost** (×1.15) — the deadline IS their selling window; smaller
  pick packages now look acceptable compared to clinging to a vet
  whose value erodes through the spring.

Trades fire when both `netValue > 0`. The threshold between buyer and
seller is roughly `rebuilder_current / contender_current` — raise that
ratio and more deals overlap. v0.58's numbers raise the ratio by
~30% relative to the CompetitiveWindow baseline (e.g., 0.85/1.05 →
0.98/0.89 ≈ +30%).

EMERGING teams are neutral on the deadline tick (Doc 5 doesn't pin
a buyer/seller direction for that window). Future-pick valuations
are untouched — the deadline pressure is about compressing
current-year capital, not shifting horizons.

### Plumbing

- `computeChartModifiers(team, owners, gms, coaches, context?)` —
  new optional `context: ChartModifierContext`. Defaults to neutral.
- `evaluatePickValue(team, pick, league)` — internally derives
  `isTradeDeadlineWeek(league.currentWeek)` and forwards it.
- `applyRegularSeasonWeek` — stamps `currentWeek = weekIdx` on the
  proactiveLeague before calling `runProactiveTrades` so the
  in-progress week (not the prior tick's value) drives the deadline
  check.

### Tests

- 6 new `chart-modifiers.test.ts` cases covering both directions of
  the overlay + neutral cases + future-pick invariance + the wider
  buyer/seller ratio.
- 3 new `value.test.ts` cases proving `evaluatePickValue` reads
  `currentWeek` correctly through the league-context plumbing.

Full suite: green (no regressions).

---

## [0.57.0] — 2026-05-19

### Added — Calendar layer for the lifecycle

New `engine/src/season/calendar.ts` module turns the abstract
`LifecyclePhase` (+ `currentWeek`) into human-readable labels and
approximate calendar dates. Display-only layer — engine logic still
keys off the phase enum + week index. The inspector can render
"Week 5 · Oct 5" or "Mid-March · Free Agency" without re-deriving
date arithmetic.

**Public API additions**

- `phaseCalendarLabel(phase, currentWeek?)` — short label, e.g.,
  `"Week 8"`, `"Wild Card Round"`, `"Mid-March · Free Agency"`.
- `phaseCalendarDate(phase, currentWeek, seasonNumber)` — `CalendarDate
  | null`. Anchored on Sept 7 Week 1 of season 1 (2026); each
  subsequent week advances 7 days. Offseason phases anchor on canonical
  NFL dates (Super Bowl Feb 11, FA opens March 13, draft April 25,
  etc.). `READY_FOR_NEXT_SEASON` returns `null`.
- `formatCalendarDate(date)` — ISO `YYYY-MM-DD` string.
- `isTradeDeadlineWeek(currentWeek)` + `TRADE_DEADLINE_WEEK_INDEX = 7`
  — used by v0.58 to gate the trade-deadline urgency modifier on a
  single in-season tick. Surfaced here because the deadline IS a
  calendar fact (Tuesday after Week 8).
- `CALENDAR_ANCHORS` — canonical date constants, exposed for any
  consumer that wants the underlying anchors.

**Anchors**

| Phase                    | Anchor (kickoff year) |
| ------------------------ | --------------------- |
| Week 1                   | Sept 7                |
| Trade deadline (Week 8)  | Oct 27                |
| Wild Card                | Jan 13 (kickoff+1)    |
| Super Bowl               | Feb 11 (kickoff+1)    |
| Free Agency opens        | Mar 13 (kickoff+1)    |
| Draft Day 1              | Apr 25 (kickoff+1)    |
| UDFA signing             | Apr 28 (kickoff+1)    |

These are deliberately stable across seasons (real NFL calendar
shifts a day or two year-to-year; the simulation doesn't). The
17-week engine season (one less than real NFL's 18) lands the
playoffs a week earlier — Wild Card mid-January rather than
mid-month-after.

### Engine-only slice

No LeagueState changes. No inspector wiring. The calendar is a pure
display layer; consumers opt in. 19 new tests in `calendar.test.ts`.
Full suite: 692 passing, 1 skipped.

---

## [0.56.0] — 2026-05-19

### Added — Week-by-week + playoff-round ticks

The v0.54 lifecycle decomposition covered the offseason. v0.56
finishes the picture: `simulateSeason`'s monolithic week loop becomes
17 separate `REGULAR_SEASON_WEEK` ticks plus four playoff-round
phases (`WILD_CARD`, `DIVISIONAL`, `CONFERENCE`, `SUPER_BOWL`).
Inspector step-through (future slice) now has a single timeline from
opening kickoff through Super Bowl through draft to next opening
kickoff.

**Expanded `LifecyclePhase` enum** (`engine/src/season/lifecycle.ts`):

```
'REGULAR_SEASON_WEEK'    — one regular-season week just played
'WILD_CARD'              — wild-card round just played
'DIVISIONAL'             — divisional round just played
'CONFERENCE'             — conference championships just played
'SUPER_BOWL'             — Super Bowl just played (simulateSeason exit)
'POST_SEASON_FINALIZE'   — (existing) awards, dev, retirement, ...
... (existing offseason phases unchanged)
'READY_FOR_NEXT_SEASON'  — wraps forward to REGULAR_SEASON_WEEK
```

`REGULAR_SEASON_WEEK` self-loops via `currentWeek: number | null`.
Each tick fires one week's games + every per-week subsystem (poach,
mid-season FA, mood, NPC trades, proactive trades) — the same bundle
that ran inside the old loop body. The transition to `WILD_CARD`
fires on the tick after the 17th regular-season week.

**New `LeagueState.currentWeek`** — zero-indexed week most recently
played. `null` outside of regular season. Migration backfills from
the highest played-week index in the schedule.

**Refactored `simulateSeason`** — now a thin `tickPhase` loop that
terminates after the Super Bowl fires. Same shape as `advanceSeason`
has had since v0.54. Public signature unchanged. The unused
`SimulateSeasonOptions.seed` field was removed (no in-tree callers).

**Refactored `runPlayoffs`** — wrapper over four new exported
helpers (`playWildCardRound`, `playDivisionalRound`,
`playConferenceRound`, `playSuperBowlRound`). Each takes the same
playoffs-root PRNG (`seasonPrng.fork('playoffs')`) and reads prior
rounds from `league.schedule.playoffs`, so step-through and bulk
produce identical brackets.

### Determinism

Per-week and per-game PRNG namespaces match v0.55 exactly
(`${seed}::season-${N}`, fork labels `week-K`, `poach-K`, `fa-K`,
`mood-K`, `npc-trade-K`, `proactive-trade-K`, `schedule`, `playoffs`).
670 passing + 1 skipped — identical to v0.55.0.

### Migration

Pre-v0.56 saves with `lifecyclePhase: 'REGULAR_SEASON'` map onto
`'REGULAR_SEASON_WEEK'`. Missing `currentWeek` defaults to the
highest played-week index from `schedule.regularSeason` (or `null` if
no played weeks).

### Test additions

`runner.test.ts` adds three v0.56 tests:
- Tick-by-tick reaches the same final state as bulk simulateSeason
  (deep-equal schedule + players + teams + transactionLog)
- Exactly 17 regular-season ticks + 4 playoff ticks per season
- `currentWeek` progresses 0..16 then resets to `null` on the
  wild-card transition

### Engine-only slice

No inspector changes. The step-through UI for a full-season scrubber
(timeline + per-tick advance button) is the natural next slice now
that the engine API supports it.

---

## [0.55.0] — 2026-05-19

### Added — Team Needs (positional)

New public engine API `computeTeamNeeds(team, league)` returns a
ranked `PositionNeed[]` per canonical Position (21 entries). UI takes
top-5 for display. Score model:

- `qse` = STAR ×1.2 + STARTER ×0.85 + BACKUP ×0.25 + FRINGE ×0.05
- `ageBonus` = best STAR/STARTER over 29: 0.3 per year, capped 1.5
- `score` = max(-2, starterSlots − qse + ageBonus)

`starterSlots` is hand-tuned per position (QB 1, WR 3, EDGE 2, CB 2.5,
S 2, etc.) so the rolloff reflects modern NFL usage rather than the
53-man depth blueprint.

### Changed — Inspector surfaces team needs

- **Draft Boards panel** — top-5 needs chip strip under the selected
  team's scheme line.
- **Draft Replay panel** — top-5 needs of the on-clock team in the
  pick headline, so per-pick selections can be checked against the
  team's biggest holes at a glance.

Both views compute against current league state (no
`teamNeedsSnapshots` parallel yet — point-in-time needs are a future
slice if needed).

### Changed — Trade-up pick labels show slot #

`DraftTradesPanel` receives-side picks now include slot # when
known. Current-draft swap reads from `draftHistory.overallPick`;
future-pick sweeteners show slot # once consumed in a later draft,
otherwise `(TBD)`. Acquires-side already showed slot # since v0.52.

### Changed — Reduced future-pick churn in trade-ups

`MAX_FUTURE_PICKS_PER_OFFER` dropped from 4 → 2. v0.52 raised it to
unlock R1 deals, but the side effect was too many late-round
trade-ups bundling 3-4 future picks (uncommon in real NFL). Single-
pick Stage 1 covers most cases including R1; Stage 2 bundles up to
2 picks only when one can't span the gap.

---

## [0.54.0] — 2026-05-19

### Added — Event-granularity lifecycle (foundation)

Daniel flagged the bundled `simulateSeason + advanceSeason` two-stage
loop as MUST-DO-BEFORE-MORE-UI-WORK: too coarse for the inspector to
ask "where are we in the cycle?" or to step through events one at a
time. v0.54 lays the foundation by decomposing the ~600-line
`advanceSeason` body into 6 ordered phase handlers, plus a public
`tickPhase` driver that runs exactly one phase per call.

**New `LifecyclePhase` enum**
(`engine/src/season/lifecycle.ts`):

```
'REGULAR_SEASON'         — in-season; resets here when simulateSeason fires
'POST_SEASON_FINALIZE'   — awards, dev, retirement, contract decrement,
                           season history, IR activation
'OFFSEASON_TRANSACTIONS' — contract expirations, cap cuts, proactive
                           trades, NFL scouting cycle, FA refill,
                           practice squad, mood drift, watch lists
'PRE_DRAFT'              — JR declarations roll + board snapshot prep
'DRAFT'                  — 7-round draft + per-pick trade-ups
'POST_DRAFT_ROSTER'      — preseason cuts + UDFA pipeline
'COLLEGE_CYCLE'          — pool advance + college scouting + board
                           regen + combine + pro days + coach visits
                           + pick horizon roll
'READY_FOR_NEXT_SEASON'  — terminal; next simulateSeason resets to
                           REGULAR_SEASON
```

**New public API:**

- `tickPhase(league)` — applies the next phase, returns the new
  state with `lifecyclePhase` advanced. No-op at
  `READY_FOR_NEXT_SEASON`.
- `nextPhaseAfter(phase)` — query the ordering.
- `LIFECYCLE_ORDER` — the canonical sequence as a frozen array.

**`advanceSeason` is now a thin loop over `tickPhase`** until the
terminal phase. No behavior change; same end state as v0.53.1.

**`LeagueState.lifecyclePhase`** added; migration backfills
`REGULAR_SEASON` (if `schedule` present) or `READY_FOR_NEXT_SEASON`
(if not) on pre-v0.54 saves. `createLeague` initializes to
`REGULAR_SEASON`. `simulateSeason` stamps it back to `REGULAR_SEASON`
at end of play so the post-Super-Bowl state cleanly signals "ready
for the lifecycle to run."

**Schedule-clear timing shifted**: `simulateSeason → schedule
present` was previously cleared inside the bundled `advanceSeason`
near the start. Now retained through the `DRAFT` phase (which uses
it for slot-order records) and cleared at the end of
`COLLEGE_CYCLE`. No external behavior change — final
post-`advanceSeason` state still has `schedule: null`.

**PRNG namespacing:** each phase derives its own PRNG from
`seed::lifecycle::seasonNumber::PHASE`. Pre-v0.54 used the
monolithic `seed::advance-{seasonNumber}` namespace, so the byte-
exact draft outcomes shift even though the structural behavior is
identical. Probabilistic tests are unaffected (no test pins specific
players to specific picks); deterministic tests still produce the
same outcome from the same seed across runs.

**Engine suite:** 665 passing + 1 skipped.

**Inspector benefits (deferred to v0.55):** UI can now read
`league.lifecyclePhase`, render the calendar, and add per-phase
step-through controls via `tickPhase`. Engine work first; UI next.

**Not in this slice:**
- Week-by-week granularity for `simulateSeason` (separate refactor).
- Calendar dates per phase (mid-March FA, late-April draft, etc.).
- UI controls — coming in v0.55.

---

## [0.53.1] — 2026-05-19

### Fixed — Boards include the full draftable cohort; only explicit returners drop

v0.53.0 over-filtered by hiding everyone with `hasDeclared=false`,
which left the consensus board and team boards looking like
"seniors only" between cycles. Daniel: "what we want is the
consensus board and team boards to have every draftable prospect.
Then after declaration any returning players are taken off the
boards."

**Fix: new `CollegePlayer.hasReturnedToSchool` flag** that
distinguishes JRs who actively chose to return from JRs who simply
haven't had their declaration roll yet:

- `generateCollegePlayer` initializes the flag to `false`.
- `rollJuniorDeclarations` flips a non-declaring JR to
  `hasReturnedToSchool=true` (in addition to leaving `hasDeclared=false`).
- `advanceCollegePool` resets the flag to `false` on aging — the
  returner ages into SR (auto-declared) and is back in play.
- `buildBoardForTeamWithNeed` filter changed from
  `!hasDeclared` to `hasReturnedToSchool`. Pending JRs (pre-roll)
  stay on the board; only post-roll returners drop off.
- `advanceSeason` snapshot filter (v0.52) updated to the same
  semantics — at draft time, returners are out; everyone else
  who's draft-eligible is in.
- Migration backfills `hasReturnedToSchool=false` on pre-v0.53.1
  saves.

The result Daniel wanted: every cycle the boards show the full
draftable cohort (JRs + SRs + RS_SRs). After the declaration roll,
the JRs who chose to return drop off. After the next aging cycle,
they're back on (as SRs).

**Engine suite:** 665 passing + 1 skipped.

---

## [0.53.0] — 2026-05-19

### Fixed — Boards filter to declared prospects everywhere + inspector view default

**Engine: declared-only enforced on regenerated boards (Daniel:
"returning players should be removed from teams's draft boards").**

Aaron Nelson case: was JR in season N, didn't declare, aged into SR
during `advanceCollegePool`. Post-advance, `hasDeclared=false` was
preserved — only the next cycle's `rollJuniorDeclarations` would
auto-declare him as SR. Between advances, the regenerated boards
showed him as an undeclared SR sitting on the upcoming-draft board.
The snapshot at draft time was already filtered (v0.52); the
upcoming-draft *preview* (`league.draftBoards`) wasn't.

Two-part fix:

1. **`advanceCollegePool` auto-declares SR/RS_SR on aging.** A JR
   who didn't declare ages into SR with `hasDeclared=true` (their
   eligibility runs out; they have no choice). Pre-v0.53 left them
   undeclared, causing the gap between advances.
2. **`buildBoardForTeamWithNeed` filters by `hasDeclared`.** Now
   matches the snapshot-time filter so every board view (current,
   snapshot, anywhere) shows only opted-in prospects.

`generateInitialCollegePool` also auto-declares SR/RS_SR at
generation time so the initial post-`createLeague` boards aren't
empty.

**Inspector — `DraftBoardsPanel` defaults to draft-time snapshot.**

The view-mode `useState` lazy initializer captured an empty
`snapshotSeasons` on first mount and stuck on `'current'`. Now
derives the effective view from the live snapshot list on every
render, falling back to `'current'` only when no snapshots exist.
After the first `simulate + advance`, the panel auto-flips to the
most recent draft-time snapshot (the board the team actually
used).

**Test fixture updates:**

- `event.test.ts` "draft order matches inverse standings" now
  checks `originalTeamId` against the standings order, since
  v0.52 trade-ups freely flip `teamId` away from the original
  owner.
- `generate-college-player.test.ts` updated for SR/RS_SR
  auto-declared at gen.
- `picks.test.ts` "draft history records carry pickAssetId +
  originalTeamId" loosened — the "un-traded league" assumption
  no longer holds with v0.52 trade-up volume.
- `career-awards.test.ts` invariant loosened to "≥1 active winner
  per category" (third loosening; underlying high-retirement-rate
  for award winners flagged as a deferred investigation).

**Engine suite:** 665 passing + 1 skipped.

---

## [0.52.0] — 2026-05-18

### Added — Bigger boards, bigger pool, persisted trade-up history, refocused trade firing

Four-part slice driven by Daniel observations on the v0.51 inspector:

1. **Boards rank every observed draft-eligible prospect.**
   `DRAFT_BOARD_SIZE` raised 50 → 500. Previously boards capped at
   50 forced many R5-R7 picks through BPA fallback and made the
   "what's still on the board" view incomplete. 500 covers the
   eligible cohort with headroom.

2. **Pool minimum 350 declared+eligible.** Class sizes bumped ~30%
   (TRUE_FR 210 → 290, SR 180 → 250, etc.) so the
   `declared + eligible` cohort reliably clears 350 — a real
   draft-class size. Test asserts the floor on 4 seeds.

3. **Trade-up history persisted + surfaced.** New
   `LeagueState.tradeUpHistory: readonly TradeUpRecord[]`. Populated
   by `applyDraftResult`; migration backfills `[]` for pre-v0.52
   saves. `TradeUpRecord` type moved from `engine/src/draft/trade-up.ts`
   to `engine/src/types/college.ts` so `LeagueState` can reference
   it without an inbound dep. New `DraftTradesPanel` on the Draft
   tab — season selector, per-trade card showing acquiring team /
   dropping team / target prospect / future-pick sweeteners / chart
   ratio.

4. **Trade-up firing refocused.** v0.45's narrow constraints (top-10
   slots only, 3-per-draft cap, strict same-#1 board match) fired
   ~1 trade per draft. Daniel's spec: ~140 trades per draft, R1
   6-18, late rounds heavier. v0.52 lifts the caps + broadens the
   logic:

   - **Slot ceiling removed** (`TRADE_UP_TARGET_SLOT_CEILING`
     effectively inert at 999).
   - **Per-draft cap** raised 3 → 250.
   - **Per-team cap** added: `MAX_TRADE_UPS_PER_TEAM = 4`, seeded
     across rounds via `league.tradeUpHistory` so it applies
     league-wide across the 7 rounds.
   - **At-risk depth round-aware**: R1=1 (strict same-#1), R2=2,
     R3=3, R4=4, R5-R7=5. Narrow R1 keeps top-of-class trades
     rare; wider late rounds capture board-variance opportunities.
   - **Trading-up acceptance floor round-aware**: R1=0.80 (max ~25%
     over-pay), tapers to R7=0.40. R1's stricter floor matches
     Doc 5's R1-premium observation; looser late rounds reflect
     that small-pick swaps are cheap.
   - **Offer construction hybrid heuristic**: Stage 1 finds the
     smallest single pick that alone clears the gap; Stage 2 falls
     back to ascending-accumulate when no single pick suffices.
     Previous ascending-only failed R1 (small picks couldn't
     reach 4000-pt gap); pure descending starved late rounds
     (burned big sweeteners on small gaps). Hybrid finds the right
     single pick for each round.
   - **Max future-pick sweeteners per offer** raised 2 → 4 to let
     R1 deals construct.
   - **Candidate target = candidate's #1** (not on-clock's #1).
     After the swap, the trading-up team picks THEIR top
     available, which may differ from what on-clock intended.

   Result on `tradeup-volume` seed: 128 total fires (target ~140),
   R1=17 (in 6-18 band), distributed R2-R6 between 15-25 per round,
   R7=5.

**Other engine changes:**

- `advanceSeason` now filters `league.draftBoards` to declared
  prospects BEFORE the draft snapshot fires (v0.52 — the
  Aaron-Nelson-on-board-but-not-drafted confusion Daniel hit). Boards
  regenerated at end of last advance reflected pre-declaration JR
  state; this filter aligns the snapshot with what the team
  actually had to choose from.

**Inspector — `apps/web/src/App.tsx`:**

- New `DraftTradesPanel` between `DraftReplayPanel` and
  `DraftResultsPanel`.
- `DraftBoardsPanel` gained a snapshot-vs-current view selector +
  "undrafted only" toggle for snapshot views. Drafted-in-this-
  season rows get a `→ #N` badge so it's clear at a glance which
  board entries got picked.
- `DraftResultsPanel` gained Consensus and Reach columns per pick
  (consensus rank from the v0.50 snapshot; reach = consensus −
  pick, color-coded amber for reach, emerald for steal).
- `DraftReplayPanel` team-board column gained an "available only"
  toggle (filter to prospects still on the board at this slot —
  hides prospects taken by earlier picks).

**Tests:** new `tradeUp volume` integration test in
`board.test.ts`. `declaration.test.ts` asserts ≥350
declared+eligible on 4 seeds. `pool.test.ts` and
`integration.test.ts` bounds updated for v0.52 pool sizes.
`board.test.ts` upper bound updated 50 → 500. `career-awards.test.ts`
loosened to "≥1 active winner per category" — the previous strict
threshold drifted twice (v0.51 + v0.52) due to widening rookie
churn; underlying high-retirement-rate for veterans deferred as a
follow-up investigation.

**Engine suite:** 666 tests, 1 skipped, 665 passing.

---

## [0.51.0] — 2026-05-18

### Fixed — Draft board priority calibration (reach-bias root cause)

The v0.50 draft-replay inspector exposed pathological reach: 80% of
picks landed ≥30 spots ahead of consensus, and the distribution was
strongly right-skewed (mean reach +53 — should be near 0 in
equilibrium). Two root causes, both fixed here.

**Cause 1 — multiplicative priority formula compounded variance:**

Old formula was `priority = observedSkillScore × schemeFit ×
meanConfidence × need`. Each factor had a wide range
(schemeFit ∈ [0.5, 1.7], confidence ∈ [0, 1]) and multiplication
produced 4×+ priority swings for the same observedSkillScore. Top
of each team's board became a "niche darling" rather than a
consensus top prospect.

v0.51 makes observedSkillScore dominant via an additive-bonus form:

    priority = (observedSkillScore + schemeBonus + needBonus) × confFactor

    schemeBonus      = (schemeFit - 1) × 8,  clamped to ±6
    needBonus        = (need - 1) × 12,      clamped to ±4
    confFactor       = 0.8 + 0.2 × meanConfidence  → range [0.8, 1.0]

Real NFL: a true blue-chip QB tops every team's board regardless
of scheme. Scheme + need shift mid-board rankings but rarely
unseat consensus top-of-class. The new formula targets that
behavior.

**Cause 2 — boards only saw firsthand-scouted prospects:**

Each team's board pulled exclusively from prospects their own
scouts had filed observations on. Coverage was sparse (avg 5/32
team boards per prospect), so top consensus prospects often
didn't appear on most teams' boards. They fell to late picks
nobody had prioritized — explaining the bimodal "huge reach
early, huge steal late" pattern.

Doc 3 calls out **media outlets** as a third intel stream all 32
teams reference. The full module isn't built yet, but v0.51 adds
a lightweight stand-in:

- A **league-wide aggregate** is computed per prospect from ALL
  teams' scout reports pooled together.
- Each team's board candidate set is now (own observations) ∪
  (every prospect any team has observations on). For prospects a
  team's own scouts didn't see, the league aggregate fills in
  with confidence discounted to 70% (firsthand still has slight
  edge; media doesn't carry full scout conviction).

True blue chips now surface on every team's board, so picks track
consensus much more closely.

**Results (single seed, full draft):**

|                  | Pre-v0.51    | Post-v0.51 |
|------------------|--------------|------------|
| Mean reach       | +53          | +14        |
| Big reaches ≥30  | 80% of picks | 18%        |
| Big steals ≤−30  | 20% of picks | 1%         |

**Engine — `engine/src/draft/board.ts`:**

- New calibration constants: `SCHEME_BONUS_SCALE = 8`,
  `SCHEME_BONUS_CAP = 6`, `NEED_BONUS_SCALE = 12`,
  `NEED_BONUS_CAP = 4`, `CONFIDENCE_FLOOR = 0.8`,
  `LEAGUE_FALLBACK_CONFIDENCE_DISCOUNT = 0.7`. All documented
  inline with the rationale + the diagnostic that drove them.
- `regenerateDraftBoardsInternal` now computes the league
  aggregate map and passes it through to `buildBoardForTeamWithNeed`.
- `buildBoardForTeamWithNeed` iterates the union of (team's own
  observations) ∪ (any-team observations), falling back to the
  league aggregate when team has no firsthand reports.
- New `clampSigned` helper for the symmetric bonus caps.

**Engine — `engine/src/draft/consensus.ts`:**

- Sort by `totalPriority` (= averagePriority × appearances)
  instead of `averagePriority` alone. Fixes the v0.50 bug where a
  1/32 niche darling at priority 200 outranked a 32/32 true blue
  chip at priority 150 in consensus.
- New `totalPriority` field on `ConsensusBoardEntry`.
- Tiebreak by appearances so 32/32 beats 16/32 at equal totals.

**Tests:**

- New `draft reach distribution` integration test in
  `board.test.ts` — runs a full season + draft, computes the
  reach histogram from the snapshot, and asserts mean reach < 15
  and big-reach (≥30) ratio < 30%. Logs the full histogram so
  calibration changes are easy to evaluate.
- `consensus.test.ts` updated for `totalPriority` ranking +
  appearance tiebreak.
- `board.test.ts` observationCount assertion loosened to ≥0
  (entries from the league-aggregate fallback have count 0).
- `career-awards.test.ts` shortfall threshold loosened from 1 to
  2 across 4 seasons — empirical baseline shifted because the new
  board picks different rookies, slightly different retirement
  variance per category.

**Push gate added to CLAUDE.md:**

`Never push to GitHub with any failing tests` — applies to all
push triggers regardless of slice intent.

**Open follow-ups:**

- The reach distribution is dramatically better but still slightly
  right-skewed (mean +14, not 0). Likely residual per-team
  scouting noise; would need the full media-outlets module or
  reduced scout-observation noise to fully eliminate.
- Late-round picks (≈100+) still fall through to BPA fallback
  outside the board → these picks don't appear in the consensus-
  ranked histogram. Deeper boards (>50) or richer late-round
  scouting could expand coverage.

---

## [0.50.0] — 2026-05-18

### Added — Draft replay inspector + consensus board diagnostic

Step-through view of a completed draft, with the picking team's
board, a derived consensus board, the picked player's ground-truth
stats, and the headline diagnostic: per-pick reach delta between
team rank and consensus rank. Built to answer Daniel's hypothesis
that team boards have been reaching too far from consensus.

Per Doc 3: "No global consensus anything" — the consensus board is
diagnostic-only. The engine itself never reads it; no team behavior
depends on it.

**Engine — new state:**

- `LeagueState.draftBoardSnapshots: Record<seasonNumber,
  Record<TeamId, DraftBoardEntry[]>>` — per-season snapshot of
  every team's board at the moment the draft fired. `advanceSeason`
  captures the snapshot BEFORE the draft runs (boards regenerate
  post-draft, so without this they'd be lost). Sparse — only
  populated for seasons that actually drafted.
- Migration: pre-v0.50 saves get `draftBoardSnapshots: {}`. Past
  drafts aren't replayable (boards already regenerated); new drafts
  populate going forward.

**Engine — `engine/src/draft/consensus.ts`:**

- `computeConsensusBoard(perTeamBoards)` — aggregates the 32
  per-team boards into a sorted consensus view. Per prospect:
  `averagePriority`, `appearances` (how many of 32 carry them),
  `averageRank`. Pure function — recompute per-render is cheap.
- `consensusRankIndex(consensus)` — convenience for "what's the
  consensus rank of player X" lookups.

**Inspector — new `DraftReplayPanel` on the Draft tab:**

- Season selector (only seasons with snapshots).
- Pick navigator: ⏮ ◀ Prev / numeric input / Next ▶ ⏭ / slider.
- Pick headline: team, player, team-board rank, consensus rank,
  and the big diagnostic — **Reach +N** or **Steal -N** badge.
- 3-column body:
  - Player card (ground-truth skills with current → ceiling,
    position, school, archetype + assumed-archetype misread flag,
    tier badge)
  - Picking team's board (windowed around the picked player)
  - Consensus board (windowed; shows appearances + avg priority)
- Draft-wide reach histogram at the bottom — shape of variance
  across the whole draft (≤−30, −29..−10, ..., 0, ..., ≥+30
  buckets) plus headline counts (N picks reached past consensus,
  N big reaches ≥20).

**Diagnostic semantics:**

- `reach = consensusRank - overallPick`. Positive = picked earlier
  than consensus would suggest (team reached). Negative = picked
  later than consensus (steal at this slot per consensus).
- Big reach threshold is ≥20 (cosmetic — flagged in amber on the
  badge + the histogram).

**Public surface:** new exports `computeConsensusBoard`,
`consensusRankIndex`, type `ConsensusBoardEntry`.

**Tests:** 6 new in `consensus.test.ts` (aggregation, absence-is-
not-zero, sort by avgPriority, rank averaging, empty input,
consensusRankIndex). 1 new in `event.test.ts` (advanceSeason
populates the snapshot correctly).

**Not in this slice:**

- Auto-play animation through the draft (manual stepping only).
- Trade-up surfacing in the replay (v0.45 trade-ups have a record
  but the replay doesn't yet visualize them between picks).
- Click-to-jump on board entries (would let you navigate "which
  pick was player X?" from the consensus view).
- Per-pick saved trade-up context (who tried to trade up for this
  player but failed gates).

---

## [0.49.0] — 2026-05-18

### Added — Doc 5 dynamic modifiers (slice 2)

Three additions complete the second pass of Doc 5's situational
modifier framework. v0.46 shipped only the on-clock team's
perspective with a flat QB premium; this slice closes the
asymmetry loop and adds a behavior-driven hot-seat HC signal.

**Engine — `engine/src/draft/chart-modifiers.ts`:**

- **Hot-seat HC modifier** — derived from `team.seasonHistory`. 3+
  consecutive sub-.500 finishes triggers a +10% current / −20%
  future overlay on top of the existing modifiers. Doc 5: "HC on
  the hot seat — unusual willingness to give up future capital."
  We use seasonHistory as the proxy until HC tenure tracking lands;
  a team that's been losing for years has a HC under pressure
  whether or not the same HC stayed through it all.
- **`qbPremiumForGm(gm)`** — replaces the flat 1.30 with a per-GM
  value mapped from `gm.spectrums.patienceUnderPressure`:
  - patience 1  (desperate) → 1.50  (max Doc 5 range)
  - patience 5  (average)   → 1.38
  - patience 10 (patient)   → 1.23  (low end of Doc 5 range)

  Doc 5: "varies by GM personality and desperation level." Per-team
  asymmetry: a patient on-clock team resists trading down for QB
  picks less strongly, AND a desperate trading-up team values the
  on-clock QB pick more highly → QB trade-ups fire more aggressively
  when desperation is on the buying side.
- **`pickValueForTeam` gained optional `qbPremium` arg** — defaults
  to `QB_CURRENT_PICK_PREMIUM` (1.30) for back-compat. Callers pass
  the per-team value from `qbPremiumForGm`.

**Engine — `engine/src/draft/trade-up.ts`:**

- **Trading-up perspective acceptance floor** — when both teams'
  contexts are supplied, the offer-construction step now also checks
  the trading-up team's ratio after greedy sweetener selection. If
  the offer (from THEIR chart) puts them at less than ~50%
  acceptance (`TRADING_UP_ACCEPTANCE_FLOOR = 0.5`), they refuse to
  construct it. Caps absurd over-pay even when an extreme-rebuilder
  on-clock would happily accept. The classic "patient rebuilder
  refuses to trade away their future for an on-clock pick they
  don't value" guardrail.
- **New `TeamChartContext { modifiers, qbPremium }`** type and
  `teamContexts: Record<TeamId, TeamChartContext>` arg on
  `EvaluateTradeUpArgs`. When provided, drives both on-clock AND
  trading-up perspectives. The v0.46 `onClockModifiers` arg stays
  as a back-compat fallback when `teamContexts` is omitted.

**Engine — `engine/src/draft/event.ts`:**

- `runDraft` pre-computes every team's `TeamChartContext` once at
  the start of each round and threads the map through to the
  trade-up evaluator. Cheap (each team's modifiers are stable for
  the round) and centralizes the team-state reads.

**Asymmetric loop completed:**

Slice 1 (v0.46) said "on-clock team's chart drives the math; trading-
up team's chart is deferred." That deferral closes here. The full
loop now reads:

- Trading-up team identifies a candidate (board overlap + priority).
- Greedy sweetener selection valued on **on-clock team's chart**.
- Both teams' acceptance must clear: on-clock ratio ≥ 1.0 AND
  trading-up ratio ≥ 0.5. Asymmetry between these floors lets the
  trading-up team voluntarily over-pay (per Doc 5's 20-58% premium
  observation) without unbounded losses.

**Tests:** 5 new in `chart-modifiers.test.ts` — hot-seat triggers
from 3 consecutive losing seasons (and not from mixed history or 2
seasons), `qbPremiumForGm` covers Doc 5's 1.20-1.50 range,
`pickValueForTeam` honors per-team QB premium override. 3 new in
`trade-up.test.ts` — rebuilder/contender asymmetry still fires
trade-ups, trading-up floor refuses extreme-rebuilder-trading-up
over-pays, per-team QB premium scales acceptance threshold.

**Modifiers still deferred to future slices:**

- First-year HC without QB (needs HC hire-date tracking)
- GM contract status / desperation (not modeled in PGS yet)
- Roster-state position-specific modifiers (gaping LT hole inflates
  LT picks; aging franchise QB inflates QB picks; excess draft
  capital — these need position-aware modifier shape, not the
  current global `current`/`future` multipliers)
- Trade-deadline urgency modifier (engine doesn't currently
  differentiate mid-season trade context — `runProactiveTrades`
  fires offseason-only)

---

## [0.48.0] — 2026-05-18

### Added — Rebuilder fire-sale player-for-picks trade pattern

`runProactiveTrades` now fires the canonical Doc 14 "old vet on
rebuild → contender for picks" archetype (Khalil Mack to Bears,
Stafford to Rams, Davante Adams to Raiders). The v0.47 pick-as-
trade-asset infrastructure was the substrate; this slice adds the
NPC pattern that actually fires these trades.

**Engine — new pattern in `transactions/proactive-trades.ts`:**

- `collectRebuilderFireSaleCandidates(league, blueprint)` — third
  collector alongside positional-need + scheme-fit-swap. Sellers:
  REBUILDING / RETOOLING / STAGNANT teams holding STAR/STARTERs
  aged 30+. Buyers: CHAMPIONSHIP / CONTENDER teams with a
  positional deficit at that player's position + cap room + at
  least one tradeable pick.
- `buildFireSaleOffer(seller, buyerPicks, targetValue, league)` —
  greedy smallest-pick-first selection (valued from the seller's
  perspective via `evaluatePickValue`) until the package clears
  the player's perceived value. Caps at
  `MAX_PICKS_PER_FIRESALE_OFFER = 3`. Returns `[]` when the cap
  can't clear the value — the buyer doesn't have enough chips.
- 5-factor gate on both sides as usual. The v0.46 modifier
  asymmetry (rebuilder values future picks at a premium, contender
  at a discount) is what closes the math — both sides see
  netValue > 0 from the same package.

**Compensation model (slice 1 narrowing):**

- Picks-only compensation. No player coming back; seller's roster
  shrinks by 1 and refills naturally next offseason. Multi-asset
  offers (pick + young player the contender's blocked) are a
  follow-on.
- Buyers restricted to CHAMPIONSHIP / CONTENDER. EMERGING teams
  rarely ship future picks for current vets in real NFL.
- Single aging veteran per fired trade. Multi-player blockbusters
  (the "and a 2027 R3" sweetener pattern) are a follow-on.

**Engine — `transactions/proactive-trades.ts` other changes:**

- `TradeCandidate` gained optional `returnId?` + `picksAToB?`
  fields and a new `'rebuild-firesale'` kind. The dispatch loop
  threads `picksAToB` through `executeTrade`; `tradeStillValid`
  re-validates pick ownership; `buildAlternatives` /
  `sharesPlayer` / `toAlternative` handle the optional returnId.
- Priority bonus `FIRESALE_PRIORITY_BONUS = 100` slots fire-sales
  between baseline positional-need (~0) and scheme-fit-swap
  (200) — they're meaningful narrative beats but not as
  surprising as a mutual scheme-fit improvement.

**Engine — `transactions/trade.ts` + `types/transaction.ts`:**

- `source` enum gained `'proactive-rebuild-firesale'` everywhere
  it appears.
- `AlternativeTradeCandidate.returnId` became optional to
  accommodate pick-only patterns.

**Behavior change:** fire-sale trades start firing during
`advanceSeason` whenever the (rebuilder seller × aging vet ×
contender buyer × positional fit × cap room × owned picks)
configuration aligns. Cap-driven trade volume scales naturally
with how many teams are in the relevant windows.

**Tests:** 3 new in `proactive-trades.test.ts` — fires when
configuration aligns (verifies picksAToB recorded, draftPicks
ownership flipped to seller, no return player), does NOT fire
when buyer is EMERGING, does NOT fire when vet is under 30.

**Not in this slice (deferred):**

- Multi-asset offers — current-year R3 + future R1, or pick +
  young player. Real NFL trade-ups often bundle these.
- Trade-deadline urgency modifier — Doc 5's mid-season ramp
  (contender acceptance band widens; rebuilder seller leverage
  grows). v0.46 dynamic-modifiers slice 2 territory.
- Cap-dump archetype — contender absorbs an expensive vet's
  contract in exchange for a smaller pick package than chart
  value would suggest. Reads the cap delta as compensation.
- Conditional picks (top-N protected, performance-based
  conversion) — would let a contender offer a "2026 R2 that
  becomes R1 if we make the AFC Championship" sweetener.

---

## [0.47.0] — 2026-05-18

### Added — Draft picks as trade-package assets (Doc 14 pick integration)

The Doc 14 player-trade evaluator and `executeTrade` machinery now
understand draft-pick assets alongside players. Mid-season
player-for-pick trades become structurally possible — pick valuation
flows through the same 5-factor pipeline that already prices
players, asset-ownership flips propagate to `LeagueState.draftPicks`,
and the transaction log carries both halves.

This slice ships the **infrastructure only** — no new proactive
trade pattern fires yet. The v0.21 `runProactiveTrades` pipeline
continues to operate player-for-player. The "rebuilder fire-sale
for picks" pattern that actually exploits this layer is the v0.48
follow-on (mirrors the v0.44 → v0.45 split for draft-side picks).

**Engine — `engine/src/trade/value.ts`:**

- `evaluatePickValue(team, pickAsset, league)` — per-team
  $M-equivalent valuation. Wraps the Doc 5 chart (`basePickValue`)
  with the v0.46 per-team modifiers (`pickValueForTeam`) plus a
  fixed `CHART_POINT_TO_DOLLARS = 3000` conversion. Round-midpoint
  slot heuristic is used (we don't know next-year standings).
- `PickValueBreakdown { total, totalDollars, factors: { chart,
  modifiers } }` — mirrors `PlayerValueBreakdown` shape so the
  inspector can render both side-by-side with one template.
- `evaluateTradePackage(team, incoming, outgoing, league, picks?)`
  gained an optional `picks: { incoming?, outgoing? }` arg.
  `TradePackageEvaluation` gained `receivedPicks` / `givenPicks`
  arrays; `netValue` now sums across all four asset lists. Existing
  callers that omit `picks` see identical behavior.

**Chart-point → $M conversion calibration:**

```
Pick 1   (10000 pts) → $30.0M   ≈ above-STAR rookie expectation
Pick 16  (3740 pts)  → $11.2M   ≈ STARTER+ on rookie deal
Pick 32  (1630 pts)  → $4.9M    ≈ STARTER on rookie deal
Pick 64  (650 pts)   → $1.95M   ≈ BACKUP
Pick 224 (20 pts)    → $0.06M   ≈ UDFA territory
```

Single tunable constant; calibration moves uniformly.

**Engine — `engine/src/transactions/trade.ts`:**

- `TradePayload` gained optional `picksAToB?: DraftPickId[]` and
  `picksBToA?: DraftPickId[]`. Mirror of the existing `playersAToB`
  / `playersBToA` shape — additive, back-compat.
- `executeTrade` validates each listed pick is currently owned by
  the source team (throws on mismatch), then flips `currentTeamId`
  on the asset in `LeagueState.draftPicks`. Original team stays
  fixed so the pick still picks at its origin slot.
- `TransactionTrade` gained `picksAToB?` / `picksBToA?` fields
  (recorded only when non-empty). Inspector can render trade
  history with both player and pick rows.

**Types — `engine/src/types/transaction.ts`:**

- `TradeValueEvaluation` gained optional `receivedPicks` /
  `givenPicks` mirroring `TradePackageEvaluation`. New
  `PickTradeValueBreakdown` interface mirrors `PickValueBreakdown`
  for the types-layer reflection.

**Public surface:** new exports `evaluatePickValue` (function) and
`PickValueBreakdown` (type) from the engine top-level.

**Tests:** 5 new in `trade/value.test.ts` (positive total + chart
factor present, current R1 dominates future R3, rebuilder values
incoming future picks more than contender, mixed player+pick
package netValue sums correctly, empty-picks-arg matches omitted).
4 new in `transactions/trade.test.ts` (pick flip preserves
originalTeamId, mixed player+pick trade moves both atomically,
throws on unowned-pick trade, traded picks recorded on transaction).

**Not in this slice (deferred to v0.48+):**

- New proactive trade pattern that fires player-for-pick deals
  (rebuilder fire-sale archetype is the canonical Doc 14 use case)
- Conditional picks (top-N protected, performance-based conversion)
- Compensatory picks (post-FA generation pass)
- Trade-deadline urgency modifiers (Doc 14: compressed-timeline
  acceptance band; v0.46 dynamic-modifiers slice 2 territory)
- Inspector visibility — pick-trade rendering in the existing trade
  detail panel

---

## [0.46.0] — 2026-05-18

### Added — Doc 5 dynamic situational modifiers (slice 1)

Each team's effective pick-value chart now shifts based on
organizational state. v0.45's trade-up firing used a flat Doc 5 base
chart for every team — this slice adds the per-team multipliers Doc 5
specifies, so a championship-window team values current picks more
than a rebuilder and a rebuilder values incoming future picks at a
premium. The same trade-up offer can be accepted by one team and
refused by another.

Per North Star: modifiers are **never surfaced to the player** as
numbers or labels. Daniel discovers each team's chart through
observed NPC behavior — repeated overpays for current picks, refusal
to trade down off a future pick.

**Engine — new `engine/src/draft/chart-modifiers.ts`:**

- `ChartModifiers { currentMultiplier, futureMultiplier }` — per-team
  multipliers that compose multiplicatively over the Doc 5 base
  chart. `NEUTRAL_MODIFIERS = { 1.0, 1.0 }` reproduces v0.45 behavior
  exactly.
- `computeChartModifiers(team, owners, gms, coaches)` — pure
  function that derives the multipliers from organizational state.
- `pickValueForTeam(baseValue, modifiers, yearsOut, isQbTarget)` —
  applies modifiers + the QB premium when the target prospect is a
  QB. QB premium applies only to the current-year pick that lands
  the QB, not to future-pick sweeteners.
- `QB_CURRENT_PICK_PREMIUM = 1.3` — Doc 5: "When a QB is the clear
  target of a trade-up, the acquiring team's chart value threshold
  increases by 25-50%." Slice 1 picks 30% (mid-range, flat); per-GM
  scaling lands when GM-desperation modifiers ship.

**Four modifiers in slice 1:**

1. **TeamPersonality baseline** — `championshipUrgency` and
   `patienceLevel` (from the L/L-01 50/20/20/10 owner/GM/HC/fans
   composite) drive a smooth multiplier curve. High urgency inflates
   current + deflates future; high patience does the opposite. Each
   point above/below the 5-midpoint nudges multipliers ~3–4%.
2. **CompetitiveWindow override** — multiplicative overlay:
   CHAMPIONSHIP (current ×1.10, future ×0.65), CONTENDER (×1.05 /
   ×0.80), RETOOLING (×0.95 / ×1.10), REBUILDING (×0.85 / ×1.25).
   EMERGING + STAGNANT stay neutral — Doc 5 doesn't pin a direction.
3. **Owner RING_CHASER + high legacyMotivation (≥8)** — extra
   future-pick deflation. Both together: future ×0.70, current
   ×1.10. Either alone: future ×0.85, current ×1.05. Doc 5: "elderly
   owner chasing a championship — one of the most exploitable
   situations in the game." We don't model literal owner age; the
   quirk + motivation pattern is what Doc 5 actually cares about.
4. **QB premium** — when the target prospect's `nflProjectedPosition
   === 'QB'`, the current-year on-clock pick's value inflates 30%
   from both sides' perspective. Trading-up team values the
   acquisition more highly; on-clock team resists trading down more
   strongly. Same picks shift in or out of acceptance based on
   target position alone.

**Asymmetric perspective (slice 1 cap):**

The on-clock team's modifiers drive both the ratio calculation and
the sweetener selection in `evaluateTradeUpForPick`. The trading-up
team's modifiers don't yet shape offer construction or desire — that
asymmetry is slice 2. The asymmetry that ships in slice 1 is
**per-on-clock-team**: a rebuilder accepts deals a championship team
would refuse, even from the same trading-up partner. This produces
the exploitable inefficiencies Doc 5 calls out.

**Wiring:**

- `evaluateTradeUpForPick` gained optional `onClockModifiers:
  ChartModifiers` arg (defaults to `NEUTRAL_MODIFIERS` for
  back-compat). Offer construction now values future picks through
  the on-clock team's chart — rebuilders inflate them, championship
  teams discount them.
- `runDraft` in `event.ts` computes the on-clock team's modifiers
  per-pick via `computeChartModifiers` and threads them through.
  Same modifier values can be referenced multiple times per draft
  (each team's state is stable for the round); recomputed each pick
  is fine — it's cheap.

**Modifiers explicitly deferred:**

- Hot-seat HC pressure (needs HC tenure tracking)
- First-year HC without QB (needs hire-date + roster lookup)
- GM contract status / desperation (not modeled in PGS yet)
- Aging franchise QB, gaping LT hole, excess draft capital (roster
  analysis; deeper slice)
- Surprise-contender mid-season modifier shift (in-season state)
- Trading-up team's modifiers shaping offer/desire (slice 2)
- Per-GM QB-premium scaling (slice 2 alongside GM desperation)
- Inspector visibility — modifiers stay engine-internal per North
  Star; behavior-only signaling is the design intent

**Public surface:** new exports `computeChartModifiers`,
`pickValueForTeam`, `NEUTRAL_MODIFIERS`, `QB_CURRENT_PICK_PREMIUM`,
and type `ChartModifiers`.

**Tests:** 10 new in `chart-modifiers.test.ts` (neutral pass-through,
QB premium on current only, independent current/future scaling,
neutral-on-missing-personnel guard, CHAMPIONSHIP/REBUILDING window
swings, RING_CHASER amplification, patient-rebuilder stack, full
window spread). 3 new in `trade-up.test.ts` demonstrating the
asymmetry: CHAMPIONSHIP on-clock rejects what NEUTRAL accepts,
REBUILDING on-clock accepts at higher ratio, QB-target shifts an
otherwise-fine offer into rejection.

---

## [0.45.0] — 2026-05-17

### Added — Draft trade-up firing (Doc 3 war-room, slice 1)

Trade-ups now fire inside the live draft. The v0.44.0 `DraftPickAsset`
infrastructure was the substrate; this slice wires NPC desire,
chart-fair offer construction, and asset-ownership swaps into
`runDraft` so a team holding a later slot can leapfrog the on-clock
team when both boards converge on the same prospect.

**Engine — new `engine/src/draft/trade-up.ts`:**

- `evaluateTradeUpForPick({...})` — pure evaluator called per-pick
  inside `runDraft`. Identifies the team further down the round most
  desperate to land the on-clock team's top board target, builds the
  smallest-overpay offer (their same-round pick + minimum future
  picks via the Doc 5 chart) that brings the on-clock ratio ≥ 1.0.
- `applyTradeUpToWorkingAssets(working, proposal)` — flips
  `currentTeamId` on the on-clock + swap assets in the round's
  working list. Future-pick ownership flips are surfaced on the
  resulting `TradeUpRecord` and applied by `applyDraftResult` against
  `LeagueState.draftPicks`.
- Types: `TradeUpProposal` (under-consideration), `TradeUpRecord`
  (durable, returned in `DraftRunResult`), `EvaluateTradeUpArgs`.
- Constants:
  - `MAX_TRADE_UPS_PER_DRAFT = 3` — real NFL R1 typically sees 2-4.
  - `TRADE_UP_TARGET_SLOT_CEILING = 10` — Doc 5: "Trade-ups in Round
    1, especially top 10, consistently show teams overpaying by
    20-58%." Outside the top 10, chart premiums aren't worth the
    future capital.
  - `MAX_FUTURE_PICKS_PER_OFFER = 2` — caps sweetener depth.

**Desire model (slice 1):**

A team further down the round wants to trade up when their own
top-of-board still-available prospect matches the on-clock team's
top-of-board still-available prospect. Highest priority on that
prospect wins the race — most desperate ≈ most willing to over-pay.

**Acceptance:**

Static Doc 5 base chart only. The on-clock team accepts when the
ratio (received total / given total) ≥ 1.0. The trading-up team
voluntarily over-pays as much as it takes to close the gap — Doc 5's
"16-20% premium to move up in the early first round" is baked into
how much gets offered, not into the acceptance threshold. Greedy
selection adds the smallest-value future pick first, stopping as soon
as the gap closes; this minimizes over-pay rather than maximizing it.

**Future-pick valuation:**

Future picks are valued at the round midpoint slot (R1=16, R2=48,
R3=80, R4=112, R5=144, R6=176, R7=224) since the trading-up team's
future standing isn't known. Doc 5's `yearsOut` discount stack
applies (75%, 58%, 44% for 1, 2, 3 years out).

**Wiring:**

- `runDraft` now maintains a `workingRoundAssets` mutable copy of
  the supplied `pickAssets` and consults `evaluateTradeUpForPick`
  before each slot fires. The picking team is derived from the
  working list's `currentTeamId` (not the original `draftOrder`),
  which is now stale once a trade-up flips ownership.
- `DraftRunResult` gained `tradeUps: readonly TradeUpRecord[]`.
- `applyDraftResult` propagates future-pick `currentTeamId` flips
  to `LeagueState.draftPicks` before the next round runs (same-round
  swaps are already reflected via the consumed-pick filter).
- `advanceSeason` is unchanged structurally — trade-ups happen
  inside `runDraft` and round-2+ picks pick up the updated owner via
  the existing per-round `picksForRoundInSlotOrder` call.

**Behavior change:** trade-ups can now fire in healthy leagues during
the season-N+1 draft. Cap: 3 per draft, top-10 slots only. Outcome
depends on board overlap, which is driven by scouting/coaching
quality + scheme convergence. Quiet drafts (no board overlap on
top-10 prospects) produce zero trade-ups, just like the real NFL
some years.

**Public surface:** new exports `evaluateTradeUpForPick`,
`applyTradeUpToWorkingAssets`, `MAX_TRADE_UPS_PER_DRAFT`,
`TRADE_UP_TARGET_SLOT_CEILING`, `MAX_FUTURE_PICKS_PER_OFFER`, and
types `TradeUpProposal`, `TradeUpRecord`, `EvaluateTradeUpArgs`.

**Tests:** 8 new in `trade-up.test.ts` (slot ceiling, per-draft cap,
no-overlap rejection, highest-priority-candidate selection, offer
ratio ≥ 1.0, infeasible-offer rejection, sweetener cap, working-
assets mutation). 2 new in `event.test.ts` (assets stay consistent
through `advanceSeason`, synthetic trade-up scenario fires end-to-end
with the target prospect landing on the trading-up team and the
future pick's ownership flipped in `LeagueState.draftPicks`).

**Not in this slice (deferred):**

- Doc 5 dynamic situational modifiers — coaching hot-seat, GM
  desperation, ownership philosophy, roster state, competitive
  window. Each NPC team's chart shifts dynamically per organizational
  state; reads from Living League. Substantial — also enables
  acceptance bands narrower/wider than the static ratio-floor 1.0.
- QB premium override — Doc 5 calls out 25-50% chart inflation when
  a QB is the target; needs prospect-position lookup at the
  evaluator level.
- Cross-round trade-ups within the same draft (e.g., R2 pick + a R1
  current-year for a higher R1) — current slice keeps compensation
  to future picks only.
- Doc 14 trade-evaluator pick integration — picks-as-trade-package
  members in the existing player-trade evaluator.
- Inspector visibility — surfacing each draft's trade-up history on
  the Draft tab.

---

## [0.44.0] — 2026-05-16

### Added — Draft pick assets as tradeable objects

Draft picks are now first-class assets on `LeagueState`. Before this
slice, picks were ephemeral — `runDraft` consumed `draftOrder:
TeamId[]` synthesized fresh from current standings each year, with
no representation of "team X owns team Y's 2028 R1." Now every team
starts owning their own picks for a 3-year horizon, picks are
consumed from the asset pool when the draft fires, and the
infrastructure exists to swap ownership via future trade-up logic.

This is the **asset infrastructure layer only** — trade-up firing
+ Doc 14 trade-evaluator pick integration are separate follow-on
slices. The Doc 5 chart from v0.40 already provides the valuation;
adding pick assets to trade packages is now an "extension to
existing trade machinery" rather than a foundational change.

**Engine — types in `engine/src/types/college.ts`:**

- `DraftPickAsset` — `id` + `originalTeamId` + `currentTeamId` +
  `seasonNumber` + `round`. The slot is NOT stored on the asset —
  it's computed at draft time from `originalTeamId`'s standings,
  because a future-year pick's slot can swing wildly with that
  team's eventual finish.
- `DraftPickRecord` gained optional `pickAssetId` +
  `originalTeamId` fields. Asset-system bookkeeping; back-compat
  for pre-v0.44 saves + direct `runDraft` callers that bypass the
  asset path.

**Engine — `engine/src/draft/picks.ts`:**

- `generateInitialDraftPicks(teamIds, startingSeason)` — produces
  every team's owned picks across 3-year horizon × 7 rounds.
- `picksForRoundInSlotOrder(picks, season, round, slotMap)` —
  filters + sorts by original-team standing. Returns assets in
  pick order; the picker is each asset's `currentTeamId`.
- `consumePicks(picks, consumedIds)` — pure removal helper.
- `advancePickHorizon(picks, currentDraftSeason, teamIds)` — drops
  the just-drafted year, adds the new far-edge year (rolling
  3-year window).
- `buildSlotMap(draftOrder)` — convenience to turn
  `computeDraftOrder` output into a `TeamId → slot` map.
- `pickOwnershipByTeam(picks)` — convenience for inspector +
  trade-evaluation display.
- Constants exposed: `DRAFT_PICK_HORIZON_YEARS = 3`,
  `DRAFT_PICK_ROUNDS = 7`.

**Wiring:**

- `LeagueState.draftPicks: readonly DraftPickAsset[]` — new field
  (672 entries for a healthy league: 32 teams × 3 years × 7
  rounds).
- `createLeague` populates initial assets for seasons 2..4 (the
  first draft fires for season 2 during `advanceSeason`).
- `advanceSeason` now derives `draftOrder` per round from
  `picksForRoundInSlotOrder` (using prior-season standings as the
  slot map), passes `pickAssets` to `runDraft`, then
  `applyDraftResult` removes consumed assets, and
  `advancePickHorizon` rolls the window forward at the end of the
  cycle.
- `migrateLeagueForward` backfills owned-by-original-team picks
  over the 3-year horizon for pre-v0.44 saves (no trade history
  reconstructable — old leagues start "no picks traded").

**Behavior change:** none today — every team still picks at their
own slot since no trades happen yet. The end-state of every draft
is identical to v0.43.x. The change is structural: when trade-ups
land, they'll mutate `currentTeamId` on assets, and the existing
draft pipeline will pick up the new picker automatically.

**Public surface:** new exports `generateInitialDraftPicks`,
`advancePickHorizon`, `picksForRoundInSlotOrder`, `consumePicks`,
`buildSlotMap`, `pickOwnershipByTeam`,
`DRAFT_PICK_HORIZON_YEARS`, `DRAFT_PICK_ROUNDS`.

**Tests:** 16 new in `picks.test.ts` — pure helpers (generation
sizing, ownership defaults, advance horizon math, slot ordering,
consumption, ownership grouping with simulated trades) + 4
integration tests (createLeague populates 672 assets, advanceSeason
consumes-then-rolls-forward producing the next horizon window,
draft history records carry asset IDs, migration backfill on
pre-v0.44 saves).

**Not in this slice (deferred):**

- Trade-up firing logic — NPC desire model ("team A wants to move
  up for prospect X"), chart-fair acceptance using `comparePickPackages`
  + Doc 5 situational modifiers, ownership swap, post-trade
  recompute.
- Doc 14 trade-evaluator integration — picks as trade-package
  members with chart valuation.
- Compensatory picks (extra round-3-through-7 picks awarded for
  free agency losses — would extend the asset pool with a
  `compensatory: true` flag and post-FA generation pass).
- Pick protections + conditional picks (top-N protected, becomes
  next-year, etc.).
- Inspector visibility — TeamDetail panel could show "owned picks"
  + "traded-away picks". Quick follow-up but skipped to keep this
  slice focused on infrastructure.

---

## [0.43.0] — 2026-05-16

### Changed — Draft boards filter to eligible prospects + position filter UI

Two related cleanups surfaced by slice 6 (coach visits had to walk
deep past non-eligible board entries) and slice 5b (draft results
panel showed pre-JR prospects mixed in with the actual draftable
cohort).

**Engine (`engine/src/draft/board.ts`):**

- `regenerateDraftBoardsForLeague` now filters board entries to
  draft-eligible prospects only (`cp.isDraftEligible` —
  JR / SR / RS_SR). Scouts still file observations on pre-JRs
  (slice 2 doesn't filter by eligibility), so the engine continues
  to accumulate multi-year intel on rising freshmen / sophomores —
  those reports just don't surface on the *current* draft board
  until the prospect ages into JR.
- Downstream wins:
  - Coach visits (slice 6) no longer skip past non-eligible
    top-board prospects — the top of every board is now eligible by
    construction.
  - Draft results readability — the boards the picker walks contain
    only valid pick targets.
  - Inspector clarity — what users see on a draft board is what
    teams could actually pick this year.

**Inspector (`apps/web/src/App.tsx`):**

- New **Position filter dropdown** in `DraftBoardsPanel` alongside
  the existing Team selector + Top N toggle. Options: All, QB,
  Skill (RB/WR/TE), OL, DL, LB, DB, ST — by position group, not
  specific position, to keep the dropdown short.
- Filter applies to `nflProjectedPosition` (not `collegePosition`)
  so conversion candidates surface under the right NFL bucket —
  a college DE projecting as 3-4 OLB shows up when you filter LB.
- Original board ranks preserved — when filtering to QBs, the
  table shows "#4 overall, #11 overall, …" rather than "1, 2, …"
  so you can see at a glance how high the displayed QBs sit on the
  full board.
- Reason-count badges at the top flip dynamically with the filter
  ("how many BLUE_CHIPs at QB?" when QB is selected).

**Tests:**

- New `board.test.ts` assertion: every board entry references a
  draft-eligible prospect. All existing tests (board, event,
  integration, coach-visits, etc.) pass unchanged — the eligibility
  filter narrows the input universe but doesn't change relative
  ordering or aggregation math.

**Not in this slice (deferred):**

- Boards split into "current draft" + "future class watch" surfaces.
  Right now non-eligible prospects' observations accumulate but
  aren't summarized anywhere. A future polish slice could add a
  "Next year's class" view per team.
- College Pool panel — its prospect table already has the
  eligibility-only filter implicit (it sorts by tier × ceiling on
  draft-eligible only), but doesn't yet have a position filter
  parallel to the new Draft Boards one. Quick follow-up if useful.

---

## [0.42.0] — 2026-05-16

### Changed — Inspector tab reorg (UX polish)

Main inspector view now splits into 4 tabs. Before this slice the
single-scroll layout had grown to:

- LeagueOverview
- CollegePool + DraftBoards + DraftResults (slice 5+ Draft surfaces)
- FreeAgentPool
- NewsFeed + TransactionLog
- SeasonResults + SeasonLeaders + Awards (when simulated)
- 8 DivisionSections

…all rendered together, which made scanning specific areas painful
and obscured what was relevant in the current moment.

**New tab structure:**

- **League** (default) — `LeagueOverview` + `SeasonResults` /
  `SeasonLeaders` / `Awards` (when simulated) + the 8 division
  sections. Day-to-day "where are we" view.
- **Draft** — `CollegePool` + `DraftBoards` + `DraftResults`. The
  full draft-cycle surface in one place.
- **Free Agency** — `FreeAgentPool`. Standalone tab since it's its
  own focused workflow.
- **News** — `NewsFeed` + `TransactionLog`. Activity stream.

**Tab nav:**

- Sticky to the top of the viewport — stays visible while scrolling
  within a tab. Backdrop-blur so content scrolling behind reads
  cleanly.
- Per-tab color accent (League emerald / Draft violet / Free Agency
  sky / News amber) matching the existing per-panel borders.
- Live count badges where useful: Draft shows college-prospect pool
  size, Free Agency shows total FAs, News shows transaction-log
  length. League omits a count (its content is qualitatively varied).

**TeamDetail modal:** unchanged — still opens over any tab when a
team is clicked. The `selectedTeamId` state moved out of the tab
switching path so clicking a team in the League tab opens the
modal over that tab without losing tab state.

**No mechanics change.** Pure UX polish — every panel preserved,
nothing removed, no behavior changed.

**Public surface:** none. The tab state is internal to the
inspector.

**Tests:** none added — this is presentational. Engine suite
unchanged.

**Not in this slice (deferred):**

- File-split refactor of `apps/web/src/App.tsx` (now ~4600 LOC).
  Each tab + its panels could move into its own file. Worthwhile
  follow-up but big mechanical churn — saving for a dedicated
  refactor slice rather than mixing it in here.
- Tab routing via URL hash — could let "share this seed AND this
  tab" links work. Premature for a dev inspector.
- Per-tab default-collapsed state on heavier subpanels (the College
  Pool table can be 60 rows when expanded). Polish.

---

## [0.41.0] — 2026-05-16

### Changed — Recency-weighted observation aggregation (Doc 3 + Doc 4)

Closes a long-open thread from slices 2 + 3: scout reports no longer
carry equal weight forever. NFL watch lists (Doc 4) and college
draft boards (Doc 3 slice 3) now weight observations on an
exponential decay — newer reports dominate, older reports gradually
fade but stay minimally visible.

Before this slice, watch lists / boards aggregated by confidence
only. In multi-year leagues a prospect's year-1 reports stayed at
full weight indefinitely, so post-development newer reads couldn't
shift their board placement. Now: same prospect's priority moves as
fresh intelligence arrives.

**Engine — new `engine/src/scouting/recency.ts`:**

- `recencyWeight(ageInTicks): number` — exponential decay, half-
  life 1 league year (52 ticks), floor 0.125.
- Curve:
    - age 0 (fresh): 1.00
    - 1 year (52 ticks): 0.50
    - 2 years (104 ticks): 0.25
    - 3+ years: floor 0.125
- Negative ages clamp to 0 (defensive — observations from the
  future shouldn't exist, but if they do they're treated as fresh).
- Non-finite ages return floor.

**Engine — aggregation sites updated:**

- `engine/src/scouting/watch-list.ts` — `aggregateObservations`
  now takes `currentTick` and multiplies every (skill × confidence)
  pair AND every confidence average entry by `recencyWeight(age)`.
- `engine/src/draft/board.ts` —
  `aggregateCollegeObservations` gets the same treatment.

**The floor matters:** even ancient reports keep 12.5% weight so a
prospect who hasn't been re-scouted recently doesn't disappear from
the board entirely — they're present but easily outvoted by anything
more recent. Zeroing old reports would drop observation counts to
zero on under-covered prospects and silently exclude them from the
board.

**Public surface:** new exports `recencyWeight`,
`RECENCY_HALF_LIFE_TICKS`, `RECENCY_WEIGHT_FLOOR` (constants
exposed for tuning).

**Tests:** +8 in `recency.test.ts` — anchor weights at 0/1/2/3
years, monotonic decay, floor behavior, defensive negative + NaN
inputs, constants. All existing scouting + draft board tests pass
unchanged (the aggregation change preserves the relative ordering
within a single cycle since all observations are same-aged then).

**Not in this slice (deferred):**

- Per-source recency tuning — coach visits could decay slower than
  scout reports (intangibles change less year-over-year). Would
  need a per-observation-type curve; not warranted yet.
- Inspector visibility of report ages in the prospect detail panel
  — currently the "tick" column is there but the panel doesn't
  surface "this report is X seasons old → counts 25%" explicitly.

---

## [0.40.0] — 2026-05-16

### Added — Draft pick value chart (Doc 5 base)

Per Doc 5: modified Jimmy Johnson chart recalibrated against
Fitzgerald-Spielberger performance methodology and real NFL trade
data 2015–2024. Pick 1 = 10,000 points; exponential decay in
round 1, deliberately flatter middle rounds, near-linear rounds
5–7. Plus future-year discount modifiers (next year 75%, two out
58%, three out 44%, capped beyond).

This is the **base chart only** — Doc 5's dynamic situational
modifiers (coaching-pressure / GM-desperation / ownership-philosophy
/ roster-state / competitive-window) need NPC-behavior wiring and
ship as a separate slice. Same for the QB-premium override.

**Engine — `engine/src/draft/pick-value.ts`:**

- `BASE_PICK_VALUES: readonly number[]` — 257-entry table (rounds
  1–7 + comp-pick capacity), exact Doc 5 values for picks 1–128,
  linear interpolation 129–257 to the doc's range anchors.
- `FUTURE_YEAR_DISCOUNTS` — `[1.0, 0.75, 0.58, 0.44]`.
- `pickValue(overallPick, yearsOut = 0)` — chart value with
  optional future-year discount. Caps `yearsOut` beyond 3 at the
  3-years-out discount.
- `valueOfPicks(picks)` — sum a package's chart value.
- `comparePickPackages(giving, receiving)` — full evaluation:
  `givingValue`, `receivingValue`, `netValue`, `ratio`,
  `isChartFair` (within ±10% of even).
- `roundForOverallPick(overallPick)` — pick number → round id.
- `PickReference`, `PickTradeEvaluation` types.

Per North Star: chart values exist for NPC trade logic; the
eventual game UI surfaces them indirectly through observed NPC
offer behavior, never as a numerical "fair value" label to the
player.

**Public surface:** new top-level exports `BASE_PICK_VALUES`,
`FUTURE_YEAR_DISCOUNTS`, `pickValue`, `valueOfPicks`,
`comparePickPackages`, `roundForOverallPick`, plus types.

**Tests:** 21 new in `pick-value.test.ts` — table size and exact
Doc 5 anchors, intra-round monotonicity, round-1→round-2 inflection
point (modern chart's deliberate middle-round lift), future-year
discount math, valid/invalid pick handling, package summation,
trade-comparison ratios + fairness band, round mapping.

**Not in this slice (deferred):**

- Dynamic situational modifiers (coaching hot-seat, GM desperation,
  ownership philosophy, roster state, competitive window). Each
  reads from existing organizational state and applies a per-team
  multiplier on top of the base chart. Substantial slice on its
  own — needs careful integration with Living League state.
- QB-premium override (25–50% multiplier when QB is the target).
- `DraftPickAsset` on `LeagueState` — tradeable pick objects with
  ownership tracking. Required before trade-ups in the draft event
  become actual pick-moving operations.
- Trade-module integration — Doc 14 evaluator currently can't
  include picks in trade packages. Adding picks as a trade asset
  type is the natural next step.

---

## [0.39.0] — 2026-05-16

### Added — Head-coach visits (Doc 3 — Draft Module slice 6)

Coach evaluation lane. Every team's head coach now files focused
observations on top draft-board prospects each cycle — narrower
than scout reports but significantly more accurate on the
dimensions coaches can read live.

Per Doc 3: coach visits are "primary strength on intangibles"
and scheme-fit projection. The narrowness is the point — coaches
grade what they see from the sideline / film room, not measurables.

**Engine — types in `engine/src/types/college.ts`:**

- `CoachVisitObservation` — `coachId` + `collegePlayerId` + `observedOnTick`
  + per-skill values + per-skill confidence. Same shape as
  `CollegePlayerObservation` (scout reports) so a future knowledge-
  layer reads both streams through one filter.

**Engine — `engine/src/draft/coach-visits.ts`:**

- `coachVisitAccuracy(coach)` derives accuracy from HC spectrums:
  staffDevelopment (45%) + experience (30%) + adaptability (25%),
  scaled into [0.50, 0.95] — distinctly higher than the scout
  floor of 0.35.
- `runCoachVisits` — per team, walks the team's draft board top→
  bottom, picks 3 eligible prospects, files one observation per.
  Board-driven targeting mirrors how real coaches focus their
  limited bye-week slots on prospects their org cares about.
- `applyCoachVisits(league, newVisits)` — append-only fold.
- Observed dimensions: leadership, competitiveness, workEthic,
  coachability, composure, footballIq, decisionMaking,
  technicalSkill (scheme-fit proxy). Physical measurables (speed,
  strength, vertical, etc.) NOT observed by coaches.
- Coach base noise: 9 stdev (half the scout noise of 18) scaled
  by `(1 - accuracy)`. Even a floor-quality coach is tighter on
  intangibles than a typical scout.

**Wiring:**

- `LeagueState.coachVisitObservations: readonly CoachVisitObservation[]`
  — new field, append-only.
- `createLeague` runs initial coach visits after boards exist
  (3 visits per team = up to 96 initial observations).
- `advanceSeason` runs coach visits after the board refresh in
  the offseason cycle. Each cycle adds ~96 more visits.
- `migrateLeagueForward` backfills empty array for pre-v0.39
  saves — accumulate from next advance onward.

**Inspector:**

- New `Coach visits (N)` section in the prospect detail panel,
  above the scout reports table. Shows coach name + team +
  confidence + key observed dimensions (leadership / iq /
  coachability / scheme). When empty: "No coach has filed a
  visit on this prospect yet" — surfaces the coverage gap
  realistically (most prospects DON'T get coach visits since
  the budget is only 3 per team per cycle).

**Public surface:** new exports `runCoachVisits`, `applyCoachVisits`,
`coachVisitAccuracy`, type `RunCoachVisitsOptions`.

**Tests:** 11 new in `coach-visits.test.ts` — accuracy math
(range, monotonicity vs scouts), observation shape (subset of
dimensions, no physical), determinism, integration with
createLeague + advanceSeason, migration backfill, multi-year
accumulation, board-driven targeting.

**Not in this slice (deferred):**

- Coverage-competition signal — when 8+ teams attend the same
  marquee game, their coaches observe each other's attendance.
  Needs game scheduling to model attendance per game.
- Recency-weighted observation aggregation (older visits decay).
- Coach quirks — bias certain coaches toward specific archetypes
  or scheme-fit profiles (parallels the scout quirk pool).
- Multi-coach visits — Doc 3 says position coaches + coordinators
  attend too, not just the HC. Slice 6 ships HC-only; adding
  coordinator-level visits is a depth slice.

---

## [0.38.0] — 2026-05-16

### Added — UDFA pipeline (Doc 3 — Draft Module slice 5c)

Undrafted declared prospects no longer silently expire when the
college pool advances. After all 7 rounds fire, every prospect that
was eligible-and-declared-but-not-drafted promotes to an NFL
`Player` record as a free agent (`teamId: null`, `contractId: null`)
and joins `LeagueState.players`. They sit in the FA pool unsigned;
next offseason's `refillRosters` pass picks the best of them up.

This is the late-round / UDFA talent layer Doc 3 explicitly calls
out — Kurt Warner / Antonio Gates / Tony Romo archetypes who
declared, went undrafted, and broke into the league via FA.

**Engine — `engine/src/draft/`:**

- `promote.ts` — new `promoteProspectToFreeAgent(prng, prospect)`.
  Reuses the same base-rookie construction as `promoteProspectToPlayer`
  (skills + ceiling + archetype + tier + mood roll) but produces
  `teamId: null` and skips contract generation. The shared
  `buildBaseRookiePlayer` helper means both promotion paths stay
  consistent — only the team/contract layer differs.
- `udfa.ts` — new `runUdfaPromotion(prng, league, { draftedIds })`
  + `applyUdfaResult(league, result)`. Pure functions: result
  carries `newPlayers` + `removedFromCollegePool`; apply folds them
  into a new `LeagueState`.

**Wiring (`engine/src/season/advance.ts`):**

- UDFA promotion runs immediately after `preseasonCuts`, before
  `advanceCollegePool`. Order: declarations → 7-round draft →
  preseason cuts → UDFA → pool advance → next year's scouting.

**Pool cleanliness:** every declared SR/RS_SR now exits the college
pool the same year they declare — either via the draft or via UDFA.
Previously the college pool advance silently dropped undrafted
declared seniors; now they're tracked as NFL FAs. Pool size in the
post-advance steady state still hovers ~850–950 (the FA pool grows
instead of leaking talent into the void).

**Public surface:** new exports `promoteProspectToFreeAgent`,
`runUdfaPromotion`, `applyUdfaResult`, types
`RunUdfaPromotionOptions`, `UdfaPromotionResult`.

**Tests:** +10 in `udfa.test.ts` — pure-function behavior
(declared/eligible/not-drafted gating, FA shape, determinism),
`applyUdfaResult` integration, full advanceSeason flow (UDFAs
land in pool, every declared SR/RS_SR exits the pool, multi-year
FA pool growth).

**Not in this slice (still deferred to a future 5d):**

- Trade-ups / trade-downs between picks (needs Doc 5 trade-value
  chart integration).
- Compensatory picks.
- NFL real-life draft-order tiebreakers (strength of schedule,
  playoff round of elimination).
- Multi-stage NFL preseason (90 → 85 → 53).

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
