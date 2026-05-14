# Changelog

All notable changes to GMSim are tracked here.

Format: [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning 2.0](https://semver.org/spec/v2.0.0.html).
Commit conventions: see [`CONTRIBUTING.md`](CONTRIBUTING.md).

While `0.x.x`, minor bumps may include breaking changes. Save format is not stable.

---

## [Unreleased]

### Added — Scheme-fit driver on weekly mood drift

Players whose archetype suits their head coach's scheme now get a small
weekly mood lift; miscast players drift down. `schemeFitForPlayer`
returns a multiplier in roughly [0.5, 1.7] centered at 1.0, mapped
directly to a per-week mood delta. A `QB_PRECISION_PASSER` in a
`WEST_COAST` scheme (fit 1.4) gains +0.4/wk; the same player in
`AIR_RAID` (fit 0.85) loses 0.15/wk. Stacks with the
`playerRelationships` HC driver — a great communicator can still run a
scheme that miscasts particular players, and both signals matter.

Special-teams archetypes are scheme-neutral (fit 1.0) so they're
unaffected. Composure dampens the negative side as it does for the
other drivers.

346 tests passing (+2 scheme-fit regressions).

---

## [0.18.0] — 2026-05-13

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

**344 tests passing** (1 skipped harness). Regression coverage:
6-season saturation check (league mean stays in 55–80, <2% pinned at
extremes), distraction-vs-stabilizer mean gap >15 points,
offseason-drift unit test, incident-fires-at-all test.

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
