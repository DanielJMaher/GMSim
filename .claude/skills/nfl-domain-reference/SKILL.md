---
name: nfl-domain-reference
description: The NFL domain knowledge pack as GMSim actually uses it — salary cap mechanics, CBA cash floor, contract structure, rookie wage scale, draft economics, roster rules, and the specific real-data bars (with numbers) the engine is calibrated against. Load when working on ANY engine system that models NFL reality, or when you need the real-world number a sim output must match.
---

# NFL domain reference (as applied in GMSim)

A mid-level engineer knows TypeScript; they do not know why a signing bonus prorates or why the #1 pick is usually a quarterback. This pack covers the domain *as this repo models it*, with the repo's own evidence anchors. The governing law: **real-NFL bars are the spec** — every calibration claim cites real data, never "looks right."

## When NOT to use this skill

- How the engine implements these rules (module layout, invariants) → `gmsim-architecture-contract`
- The tunable constants encoding these numbers → `gmsim-levers-and-calibration`
- Running the measurement agents that compare sim vs real → `gmsim-diagnostics-and-tooling`

## Where the real data lives

`packages/truth-arbiter/data/` (gitignored artifacts + cached corpora): `games.csv` (nflverse game results + starting QBs, 2011–2025), `draft_picks.csv` (1980→present), `nfldata-trades.csv` (2002→present), OTC (OverTheCap) contract data consumed by The Liquidator. Probe scripts named `_*.mjs` in the same directory compute the real bars cited below — they are the reproducible source.

## The salary cap

- One league-wide ceiling; identical for all 32 teams. GMSim default birth cap **$255M** (≈2024). Real history: 2005 $85.5M → 2015 $143.28M → 2025 $279.2M → 2026 $301.2M. 20-year CAGR ≈ 5.6–6.1% ⇒ GMSim grows the cap **6%/yr** (derivation comment at `SALARY_CAP_ANNUAL_GROWTH`, `packages/engine/src/contracts/constants.ts`).
- **Top-51 rule:** in the offseason only the 51 largest cap hits count; all 53 count in-season (plus dead money always). Modeled in `contracts/cap.ts` (`teamCapUsage`, `TOP_51_OFFSEASON`).
- **Real teams spend ~90%+ of the cap.** GMSim equilibrium (v0.176): in-season 84–86.5% of a growing cap, cash pace ~90%.

## Contract anatomy

- Components: per-year **base salary**, **signing bonus** (cash up front, prorated for cap over `min(realYears + voidYears, 5)` years), roster/workout bonuses, guarantees (full / injury-only / percentage). Engine type: `types/contract.ts`.
- **Proration + dead money:** releasing/trading a player accelerates all *unamortized* signing bonus onto the current cap (`unamortizedSigningBonus`, `deadMoneyOnPreJune1Release` in `contracts/cap.ts`).
- **Void years:** fictional contract years that stretch proration; when the real years lapse, the unamortized share hits the cap anyway (the "void charge"). GMSim STAR deals carry 1 void year; the charge books at expiry (`voidDeadMoney` on the expiration transaction).
- **Escalating structure:** real veteran deals are back-loaded — Year-1 cap hit ≈ 0.8–0.9× APY, big years late (often never paid: releases eat the tail). GMSim per-tier `baseShape` yields Y1/APY ≈ 0.877. Consequence worth memorizing: **headline APY exceeds realized cap cost league-wide** — that's the real market, and why GMSim's anchors are +10% over the flat-deal era.
- **Restructures:** converting base salary to signing bonus mid-deal moves cap charges to future years (cash-neutral for the player). A win-now, cap-pinned move; rebuilding teams never do it. `transactions/restructures.ts`.
- **Cash vs cap:** the CBA polices actual spending — each club must spend ≥ **89% of the caps in cash over rolling 4-year periods** (`CASH_FLOOR_PCT`/`CASH_FLOOR_WINDOW` in `contracts/cash.ts`; GMSim's window = 3 booked seasons + the season in progress, each priced against ITS OWN cap).
- **Vet minimum:** ~$900k at the $255M anchor cap; grows with the cap (`leagueMinimumSalary()`).

## The rookie wage scale

CBA slot money is **position-independent**: the #1 pick costs the same whether QB or guard (~$40M/4yr at the anchor cap; end of R1 ~$13M; R7 ~$3.9M). Slots are cap-proportional and 4 real years. This is WHY draft position value = *surplus* (market price of the position's production minus the fixed slot cost) and why a franchise QB on a rookie deal is the most valuable asset in the sport. Engine: `contracts/rookie-scale.ts`; positional surplus reasoning: header of `draft/position-value.ts`.

## Draft economics — the calibrated bars (wage-scale era, 2011–2026)

| Bar | Real | Source |
|---|---|---|
| #1 overall QB share | **75%** | draft_picks.csv via Goatinator |
| #2 / #3 overall QB share | 44% / 25% | same |
| Top-10 mix | QB 22 · OL 19 · EDGE 14 · WR 14 · DB 11 · LB 8 · RB 6 · DL 4 · TE 3 (%) | same |
| Top-10 slots traded into | 22% (16% draft-window) | nfldata-trades.csv |
| Trade-up sweeteners | 82% current-year picks; 22% of packages include a future | same |

Domain logic behind the QB bars: bottom teams *let their middling QB walk and draft the replacement* — real primary-QB change rates by record: **≤6 wins 43.3%, 7–9 29.5%, ≥10 12.0%** (probe `_qb_churn_by_record.mjs`). Retention overall: primary QBs stay **78.4%**, move 12.9%, gone 8.7% (2011–2024).

## Veteran market

Top-of-market APY by position (OTC 2025, anchor for `POSITION_SALARY_FACTOR` / `POSITION_DRAFT_VALUE`): QB ~$55M · EDGE ~$50M · WR ~$42M · DT ~$32M · CB ~$31M · OT ~$30M · S ~$25M · G ~$24M · LB ~$21M · RB ~$20.6M · TE ~$19M · K ~$7M. A top QB signs for ~5× a top RB. Top-QB APY as %-of-cap runs a stable ~21–24% in the real league (GMSim residual: episodic under STAR scarcity).

## Roster & season structure

53-man active roster + 16 practice squad per team (PS salaries don't count vs GMSim's cap usage — see `makePracticeSquadContract` comment); IR players keep counting. 32 teams, 17-game regular season, playoffs → Super Bowl. Coaching carousel: ~6–7 HC changes league-wide per season; firings concentrate on Black Monday with midseason firings installing interims.

## On-field statistical bars (nflverse REG 2011–2025, via the Scorekeeper)

Points/game **22.8 ± 10.1** (p5 7, p95 40) · pass yds/game 245.4 ± 75.4 · pass att 34.3, comp 63.3% · **winners vs losers: pass +9.5, rush +35.1, giveaways −0.9**. That pass/rush asymmetry is game script: *trailing teams pass more* (garbage-time passing decouples pass volume from winning); winners run out the clock. GMSim's biggest open gap lives exactly here (pass delta 32.8) — see `gmsim-wl-pass-delta-campaign`.

## Vocabulary (one-line definitions)

**APY** average per year of a contract's total value · **Dead money** cap charge for a player no longer on the roster · **June 1 designation** split of dead money across two seasons (modeled only as pre-June-1 in GMSim) · **Franchise/bridge QB** long-term answer vs stopgap veteran · **GOAT slots** picks #1–#3, a different market from the rest of the draft · **War room / big board** a team's internal draft ranking · **UDFA** undrafted free agent · **Black Monday** the day after the regular season when firings cluster.

## Provenance and maintenance

- Real bars regenerate from probes: `node packages/truth-arbiter/data/_qb_churn_by_record.mjs`, `_qb_retention_real.mjs`; Goatinator/Scorekeeper print their real-side tables on every run (no sim needed: run without `sim` args).
- Cap history endpoints: web (Spotrac CBA history / RealGM), embedded at `SALARY_CAP_ANNUAL_GROWTH`'s comment — re-derive if the real cap diverges from 6%/yr for several years.
- OTC anchors: header comments in `draft/position-value.ts` and `contracts/tiers.ts` (`POSITION_SALARY_FACTOR` — "Re-run pnpm --filter @gmsim/truth-arbiter run liquidator to recheck").
- All numbers date-stamped: as of 2026-07-04, v0.177.0.
