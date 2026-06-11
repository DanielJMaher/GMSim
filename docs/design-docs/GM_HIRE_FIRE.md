# GM Hire/Fire & The Front-Office Lifecycle

**Status:** Design document — authored 2026-06-11 (Daniel-directed, design before code).
**Serves:** Living League (32-team ecosystem), North Star, Personnel Generation (#6),
Coaching Staff Hiring & Management (#8), Dynasty & Rebuild Cycles (#9).
**Unblocks:** GM media-trust learning over seasons (`perceivedOutletReliability`
tenure-survivor effect, blocked since v0.108) and the coaching carousel (Doc #8).

---

## 1. Why this module exists

Today every GM and head coach in the league is immortal. Owners have `patience`,
`ego`, and `legacyMotivation` spectrums that drive *whom they hire at league
creation* and nothing afterwards. Teams accumulate `seasonHistory` that nobody
reads. The result is the front-office equivalent of the climbing-histogram
defect Living Careers just killed for players: a league where 4-13 happens four
years running and nothing changes feels dead, no matter how alive the players are.

NFL-feel demands the opposite: results create pressure, pressure creates
firings, firings create a carousel, and the carousel changes how teams behave
(new GM archetype → new draft/trade/FA personality via TeamPersonality
recompute). This module is the engine's mortality system for regimes.

---

## 2. Real-NFL empirical baselines (the data)

Compiled 2026-06-11 from Sportico's GM-turnover study (23 GM firings analyzed),
tenure analyses (sportsbettingdime, Williamson), ESPN's GM-evaluation piece,
The Ringer's 2026 "GM Power Era" analysis, and per-case records from
Pro-Football-Reference team pages / firing trackers (PFN, NBC, CBS).

### 2.1 Aggregate rates

| Metric | Real value | Source/basis |
|---|---|---|
| HC changes per season | ~6.5 (20.3% of teams) | 65 changes over 10 seasons |
| Mean tenure of a *new* HC hire | 3.2–3.3 seasons | decade-scale analyses |
| One-and-done HCs | 32 since 1970 ≈ 0.6/yr | rare, needs catastrophe |
| GM changes per season | ~3.5–4.5 (53% of teams over 5 yrs) | Sportico |
| Median tenure, active GMs | ~3 seasons (right-skewed; lifers 10–20+) | Sportico |
| GM firings landing in Dec–Jan | 70% | Sportico |
| Subsequent GM hires in Dec–Jan | 91% | Sportico |
| GM hires who are first-time GMs | 88% | Sportico |
| GM hires from outside the org | 66% | Sportico |
| GM hires from scouting background | 72% | Sportico |
| Joint HC+GM "clean house" | ~1–2/yr (2026 cycle: 1 of 10 HC firings) | Ringer, trackers |
| GM survives a given HC firing | ~80–90% (2026 cycle: 8 of 10) | Ringer |

The 2026 cycle is the sharpest recent snapshot: **ten** HC firings, only
**two** GM searches. Beane (BUF) survived McDermott's firing and was *promoted*;
Schoen (NYG) survived Daboll's in-season firing; Ossenfort (ARI) survived
Gannon's. Only Fontenot (ATL) went down with his coach. Miami fired GM Grier
in-season (October) months *before* firing McDaniel — the rare GM-first
sequence. The Ringer calls this the "GM power era": when something must go,
owners burn the coach and keep the roster-builder.

### 2.2 Case table — GM season-by-season records vs. coach firings

Each row is one GM tenure. **Bold** = season a coach was fired. `*` = in-season
firing. The question this table answers: *where inside a GM's W/L sequence do
coach firings land, and when does the GM finally go?*

| GM (team, yrs) | Season records during tenure | Coach events | GM outcome |
|---|---|---|---|
| Ryan Pace (CHI 2015–21, 7 yr) | 6-10, 3-13, **5-11**, 12-4, 8-8, 8-8, **6-11** | Fox fired yr 3; Nagy (his hire) fired yr 7 | fired **with** coach #2, yr 7 |
| Steve Keim (ARI 2013–22, 10 yr) | 10-6, 11-5, 13-3, 7-8-1, 8-8, **3-13**, 5-10-1, 8-8, 11-6, **4-13** | Arians retired yr 5; Wilks one-and-done yr 6; Kingsbury fired yr 10 | out **with** coach #3, yr 10 |
| Dave Gettleman (NYG 2018–21, 4 yr) | 5-11, **4-12**, 6-10, **4-13** | Shurmur fired yr 2; Judge (his hire) fired yr 4 | out **with** coach #2, yr 4 — never above 6 wins, no credit banked |
| Jason Licht (TB 2014–, 11+ yr) | 2-14, **6-10**, 9-7, 5-11, **5-11**, 7-9, 11-5 (SB win)… | Lovie fired yr 2; Koetter fired yr 5 | **survived two firings + 5 losing seasons** (patient ownership), then vindicated |
| Tom Telesco (LAC 2013–23, 11 yr) | 9-7, 9-7, 4-12, **5-11**, 9-7, 12-4, 5-11, **7-9**, 9-8, 10-7, **5-9\*** | McCoy fired yr 4; Lynn fired yr 8; Staley fired in-season yr 11 | joint in-season clean house, yr 11 — periodic 9–12-win seasons kept resetting his clock |
| Jon Robinson (TEN 2016–22, 7 yr) | 9-7, **9-7** (playoff win), 9-7, 9-7, 11-5, 12-5, 7-5\* | Mularkey fired *after a playoff win* (ceiling), Vrabel hired | GM fired **in-season at 7-5** — process/roster-decay firing, not record |
| Scott Fitterer (CAR 2021–23, 3 yr) | **5-12\***, 7-10, **2-15\*** | Rhule (inherited) fired in-season yr 2; Reich (his hire) fired in-season yr 3 | fired after season 3 — two in-season coach firings in 3 years took the GM with them |
| Joe Douglas (NYJ 2019–24, 6 yr) | 7-9, **2-14**, 4-13, 7-10, 7-10, **2-3\*** → fired Nov | Gase fired yr 2; Saleh fired in-season yr 6 | GM fired in-season weeks after coach #2 went down; zero playoffs in 5 full seasons |
| Nick Caserio (HOU 2021–) | **4-13**, **3-13-1**, 10-7… | Culley one-and-done; Lovie Smith one-and-done | GM **survived consecutive one-and-done coach firings**, vindicated yr 3 |
| Ran Carthon (TEN 2023–24, 2 yr) | **6-11**, 3-14 | Vrabel fired after GM's yr 1 | GM fired after yr 2 — grace period broken by owner churn |
| Mickey Loomis (NO 2002–) | 20+ seasons | multiple coach cycles | the lifer tail — sustained success + owner trust makes GMs effectively permanent |
| Brandon Beane (BUF 2017–) | 9-7, 6-10, 10-6, 13-3, 11-6, 13-3, 11-6, … **McDermott fired yr 9** | sustained playoffs, no SB | GM **promoted** while coach fired — peak "GM power era" |

### 2.3 Rules extracted (what the engine must reproduce)

1. **The coach's seat heats ~2–3× faster than the GM's at the same win level.**
   Coach kill zone: two consecutive seasons under ~7 wins, or a big
   expectation miss. GM kill zone: 4–5 seasons without playoffs, or the
   failure of his *second* coach.
2. **The firing ladder is ordered: HC before GM.** A GM survives the first HC
   firing of his tenure ~80–90% of the time and picks the successor. When the
   GM's own pick (coach #2) fails, the GM goes with him (joint clean house) or
   within ~12 months (Pace, Gettleman, Telesco, Keim, Fitterer, Douglas).
   GM-fired-while-coach-survives is the rare path (~1 every 2–3 yrs:
   Robinson/Vrabel, Grier-before-McDaniel).
3. **Credit banks and decays.** Playoff wins and championships buy whole
   years; a 9+ win season partially resets the coach clock and strongly
   resets the GM clock (Telesco 11 yrs, Keim 10 yrs on periodic spikes).
   Sustained excellence without a ring eventually burns the *coach* anyway
   (Mularkey after a playoff win; McDermott after a decade of playoffs) but
   spares — even promotes — the GM.
4. **Grace periods are real.** HC year 1 is near-immune (~0.6 one-and-dones/yr
   league-wide, and those need ≤4 wins + bottom-decile feel). GM years 1–2 are
   near-immune: the league consensus is a GM gets **three drafts and/or one QB
   change** before judgment (ESPN). Grace breaks only via owner churn,
   scandal, or org chaos (Carthon).
5. **In-season firings cluster late and signal collapse.** HC in-season
   firings ~1–3/yr at ≤.300 win% by midseason (Saleh 2-3, Rhule 1-4, Reich
   1-10, Daboll 2-8, Eberflus 4-8). GM in-season firings ~0–1/yr, late
   Oct–Dec, and usually precede or accompany a coach firing.
6. **Timing is windowed.** 70% of GM firings land Dec–Jan (Black Monday
   window); 91% of replacement hires land in the same window, *before* the
   combine — the new GM runs the combine and draft.
7. **Expectation-relative, not absolute.** Firings key off (expected − actual),
   where expectation comes from roster quality, prior season, and competitive
   window — not a fixed win number. 9-win firings exist but are rare (<5%).
8. **Tenure distributions are right-skewed.** New-hire HC mean ~3.2 yrs;
   active-GM median ~3 yrs with a long lifer tail (10–20+). A league where no
   GM ever reaches 15 years is as wrong as one where nobody gets fired.
9. **Replacement-pool shape:** ~88% first-time GMs, ~66% external hires, ~72%
   scouting background; retread HCs are common but retread GMs are not.

---

## 3. Design

### 3.1 New state

**Tenure + employment (ground truth):**

```ts
// types/personnel.ts
interface CareerStint {
  teamId: TeamId;
  role: 'GM' | 'HC';
  fromSeason: number;
  toSeason: number | null;        // null = current
  wins: number; losses: number; ties: number;
  playoffAppearances: number;
  championships: number;
  end: 'FIRED' | 'JOINT_FIRED' | 'FIRED_IN_SEASON' | 'RESIGNED' | 'RETIRED' | null;
}
// Gm and HeadCoach both gain:
//   careerStints: readonly CareerStint[];   // append-only résumé
//   status: 'EMPLOYED' | 'UNEMPLOYED' | 'RETIRED';

// types/team.ts — TeamState gains:
interface FrontOfficeState {
  gmHiredSeason: number;
  hcHiredSeason: number;
  hcHiredByGmId: GmId | null;     // "his guy" coupling — drives the ladder
  gmCoachFiringsSurvived: number; // how many HC firings this GM has burned
  seatPressure: { gm: number; hc: number };  // 0..100, hidden ground truth
}
```

Fired personnel **stay in `LeagueState.gms`/`coaches` forever** (status flips
to `UNEMPLOYED`) — they are the retread market, their stints are media fodder,
and deleting entities breaks determinism and history. Owners are not fired;
ownership transitions are out of scope (future module).

### 3.2 The owner's annual evaluation (Black Monday tick)

Runs once per season for all 32 teams, in a new lifecycle step **`BLACK_MONDAY`**
inserted immediately after the final `REGULAR_SEASON_WEEK` (real-world: the day
after Week 18). Pure function of `LeagueState` + PRNG; lands in
**`npc-ai/front-office.ts`** per the npc-ai invariant.

```
expectedWins = 0.55 × (priorWins regressed 35% to 8.5)
             + windowBump(competitiveWindow)        // OPEN/PEAK expect 10+,
                                                    // BUILDING expects 6-7
disappointment = expectedWins − actualWins − playoffCredit
                 (playoffCredit: appearance +1.5, SB win +6, SB loss +4, conf +2.5)

hcSeat  += clamp(disappointment, 0, ∞) × ownerImpatience × marketHeat − creditDecay
gmSeat  += same input × 0.40                          // rule 1: ~2.5× slower
           (+ later: draft-hit-rate process term)
```

- `ownerImpatience` maps `Owner.patience` 1–10 onto roughly ×1.8 (patience 1)
  … ×0.5 (patience 10) — the Dynasty doc's "impatient triggers at 2–3 seasons,
  patient at 4–6" falls out of this scaling.
- `marketHeat`: LARGE market + `fanBase.patienceLevel` modifier (~±20%).
- Winning **subtracts** (banked credit): each win above expectation and each
  playoff result reduces seat pressure with slow decay (~25%/yr), so a 12-win
  season protects a coach for more than one bad year (Keim/Telesco pattern).
- **Grace clamps:** HC season 1 → hcSeat capped below firing threshold unless
  wins ≤ 4 (one-and-done escape hatch). GM seasons 1–2 → gmSeat capped unless
  org catastrophe. Owner quirks pierce or reinforce: `PANIC_SELLER` weakens
  grace, `LOYALTY_BLIND` strengthens it.

### 3.3 The firing ladder (per team, in order)

1. **Evaluate HC.** Fire when `hcSeat > threshold(owner)` (threshold ~70,
   ±owner quirks, small PRNG jitter so identical situations don't synchronize
   across the league).
2. **If HC fired, evaluate GM accountability:**
   - HC was **not** the GM's hire (inherited) → GM survives, ~95%.
   - HC was the GM's **first** hire fired → GM survives ~85%
     (`gmCoachFiringsSurvived` → 1).
   - HC was the GM's **second+** hire fired → **the GM goes.** Checked
     against every such case we could find (2008–2026): when the second
     own-hire failed with the GM in **years 4–7 of his tenure, zero GMs
     survived it** — Gettleman (yr 4), Maccagnan (yr 4, fired weeks after
     *hiring* #2), Baalke-JAX (yr 4), Baalke-SF (yr 6), Pace (yr 7) all went
     same-day/same-cycle; McKenzie (yr 6) staggered ~10 months and was fired
     in-season the next year. Keim (yr 10) and Dimitroff (yr 13) hit coach
     #2's failure later and *still* died with him. The only two survivors in
     the dataset sit **outside** the 4–7 band, and both are explained by the
     seat-pressure inputs, not by a separate mercy roll:
     - **Early-teardown hatch** (GM yr ≤3): Caserio survived *consecutive
       one-and-done* firings in yrs 1–2 because expectedWins were at the
       floor (BUILDING window) — gmSeat never accumulated.
     - **Banked-credit hatch** (GM yr 8+): Telesco survived Lynn's firing in
       yr 8 on a fresh 12-4 + playoff win — creditBank swallowed the hit
       (then died jointly with coach #3).
     Mechanically: second+-own-hire firing forces a joint fire at ~75%;
     survivors become **lame ducks** (gmSeat floored near threshold) and are
     fired within the next 12 months unless one of the two hatches applies
     (low accumulated gmSeat or high creditBank). Net effect the Headhunter
     gates on: survival of a 2nd-own-hire firing during GM years 4–7 ≈ 0
     (≤5% of such events).
3. **GM-only firing:** requires `gmSeat > threshold × 1.3` *without* an HC
   firing this cycle — the rare Robinson path. New GM then evaluates the
   inherited HC with elevated pressure next season (new-GM-wants-his-guy).
4. All outcomes append `CareerStint` closures, transactionLog + news entries,
   and recompute `TeamPersonality` (already specified to re-derive on
   hire/fire).

### 3.4 Hiring (resolves before `COMBINE`)

GM seat fills first, then HC — the new GM participates in the coach choice.

- **Candidate pool:** generated first-timers (~85%) + unemployed retreads
  (~15%, weighted by résumé recency/quality). HC pool is retread-heavier
  (~35%). Doc #8's full tiered market (coordinators, college coaches,
  poaching, contracts/budgets) is a later slice; this slice needs only enough
  pool to make hires feel distinct.
- **Owner-weighted archetypes:** reuse `generateGm(prng, seed, owner)` /
  `sampleGmArchetypeForOwner` — this hook already exists and is the payoff
  moment: an impatient owner fires a patient rebuilder and hires a
  `WIN_NOW_AGGRESSOR`, and the team's draft/trade/FA behavior visibly turns.
- New GMs arrive with **fresh miscalibrated `perceivedOutletReliability`**
  priors. Combined with survivors learning over seasons, this creates the
  media-trust ecology this module unblocks: old GMs are sharp about who to
  trust, new GMs chase the wrong voices and sometimes bust for it.
- Pure league-shaped API: the engine fires/hires on all 32 teams identically.
  When a future game layer seats the player as a GM, the same evaluation
  becomes the player's own job security — no special-casing now.

### 3.5 In-season firings (slice 2)

HC: triggered during `REGULAR_SEASON_WEEK` ticks when win% ≤ ~.300 past week
~8 with high seat pressure → interim HC (generated, slight game-sim penalty,
no TeamPersonality recompute until permanent hire). GM: rare roll (~0–1/yr
league-wide), late-season only, usually correlated with a pending HC firing.
Doc #8 lists in-season changes as an open thread — this section resolves it.

### 3.6 North Star / knowledge layer

`seatPressure`, the evaluation, and the ladder are **ground truth** — never
surfaced numerically in a game UI. The game-facing read is media coverage:
hot-seat narratives, "sources say ownership is evaluating," firing/hiring news
with outlet attribution and outlet-dependent accuracy (some outlets will call
a firing that never comes). That lands with the media slice (S3) through the
knowledge layer. The **inspector** shows real seat pressure from S1, and when
the media's *perceived* hot-seat read exists, shows the `perceived / real`
pair per the standing inspector convention.

### 3.7 Determinism & scale

All rolls through the league PRNG inside the tick; evaluation order is fixed
team order. O(32) per season tick with O(pool) hiring — no benchmark risk.
Migration backfills `FrontOfficeState` (hired season = league start), empty
`careerStints`, `status: 'EMPLOYED'` on existing saves.

---

## 4. Calibration: The Headhunter (7th data agent)

`run headhunter` — simulate 30 seasons × multiple seeds, audit the firing
ecology against §2. Gate targets:

| Check | Target envelope |
|---|---|
| HC changes / season | 5.5 – 7.5 |
| GM changes / season | 3.0 – 5.0 |
| Joint clean-houses / season | 0.5 – 2.0 |
| GM survives a given HC firing | 75 – 90% |
| GM survives 2nd-own-hire firing while in GM yrs 4–7 | ≈0 (≤5% of such events) |
| One-and-done HCs / season | ≤ 1.5 |
| HC in-season firings / season (S2) | 1 – 3 |
| Mean tenure of completed HC stints | ~4.9 yrs equilibrium (3.5 – 6.0) — *amended v0.140: the original 2.8–4.0 misread the "new hire lasts 3.2 yrs" stat, which is biased toward short stints; at 20% annual turnover, mean tenure at firing is 1/0.203 ≈ 4.9* |
| Median active-GM tenure | 3 – 5 yrs |
| Lifer existence | ≥1 GM reaching 12+ yrs per 30-yr sim |
| Win% in HC's firing season | mean ~.330 – .420 |
| Firings of 9+ win coaches | present but < 5% of firings |
| GM firings in Black-Monday window (vs in-season) | ~70 – 90% |
| Churn sanity | no team with >4 HCs in 5 seasons absent bottom-decile results |

The distribution *shape* checks (right-skew, lifer tail) matter as much as the
means — same lesson as the Actuary's age histograms.

---

## 5. Slice plan

- **S1 — Regime mortality (deep substrate):** tenure/stint state + migration,
  Black Monday evaluation + firing ladder, offseason hiring market,
  TeamPersonality recompute, transaction/news entries, inspector **Front
  Office tab** (per-team GM/HC, tenure, records-during-tenure, real seat
  pressure, league carousel history), Headhunter audit + gates wiring.
- **S2 — In-season firings:** HC collapse trigger + interim coaches, rare
  in-season GM firing, Black Monday news beat.
- **S3 — The hot seat as media object:** attributed hot-seat coverage through
  the knowledge layer (Living Voice integration), perceived/real seat pair in
  inspector, firing press conferences / hiring introductions flavor.
- **S4 — Carousel depth (Doc #8 proper):** coordinator tier, coach poaching,
  contracts/budgets, GM media-trust learning visibly diverging by tenure.

---

## 6. Open threads

- Ownership change (sales, succession) as a regime-reset trigger — separate
  future module; the evaluation reads `Owner` so it slots in cleanly.
- GM/HC contract years (lame-duck pressure, extensions as credit signal) —
  noted in Dynasty doc ("final year of contract" desperation); deferred.
- Draft-hit-rate as an explicit GM process term (engine has the data via
  draft history; adds the "fired despite wins" Robinson path more honestly
  than a pure-record model). Candidate for S2/S3.
- Coach quality affecting game sim (currently coach spectrums influence
  scheme/AI, not week-to-week outcomes) — firing a coach should *matter* on
  the field; interacts with the named drive-sim usage/efficiency slice.

## Sources

- Sportico — [As NFL GM Turnover Looms](https://www.sportico.com/leagues/football/2023/nfl-owners-front-office-hiring-1234699871/) (23-firing study: tenure, windows, backgrounds)
- The Ringer — [The NFL's GM Power Era Has Arrived](https://www.theringer.com/2026/01/21/nfl/nfl-head-coaching-carousel-general-manager-power-era-brandon-beane-promoted-sean-mcdermott-fired) (2026 cycle: 10 HC firings / 2 GM searches)
- ESPN — [Why evaluating GMs is so hard](https://www.espn.com/nfl/story/_/id/40492244/howie-roseman-eagles-influence-nfl-why-evaluating-gms-hard-super-bowl-analytics) ("three drafts and/or one QB change")
- sportsbettingdime — [Managerial Reign in Sports](https://www.sportsbettingdime.com/guides/research/managerial-reign-in-sports/) (tenure vs win%)
- PFN / NBC / CBS firing trackers ([2024–25](https://www.profootballnetwork.com/list-nfl-head-coaches-fired-2025/), [2025–26](https://www.profootballnetwork.com/nfl-head-coaches-fired-2025-brian-daboll-2/), [tracker](https://www.nbcsports.com/nfl/profootballtalk/rumor-mill/news/2025-nfl-head-coach-and-general-manager-change-tracker)) (case records)
- Case table records: Pro-Football-Reference team season pages.
