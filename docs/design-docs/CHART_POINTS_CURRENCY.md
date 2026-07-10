# One Currency — chart points as the valuation spine

**Status: APPROVED — Daniel, 2026-07-10** (one currency GO with the §4
expected-behavior flags standing for his later judgment). Alpha-track workstream 3b
(design-before-code; vision-central — touches NPC trade AI, fenced draft
machinery). Daniel's rulings: **one currency, go — but FLAG the expected
behaviors so he can judge them later** (§4 is that flag list); **scope = ALL
trades** (picks↔picks, picks↔prospect-slots, players↔picks); **fixing the
in-draft trade-up rate (4% vs real 16%) is a GOAL of this slice**, not a
side effect. Origin: Daniel 2026-07-10 — "slot #60 is worth X points; if an
NPC GM values a player at X+50, they'll pay ~50 points to move." Cross-refs:
`trade/value.ts` (`neutralPlayerTradeValue`, `CHART_POINT_TO_DOLLARS`), the
Barterer (envelope + the named player↔pick exchange-rate residual), Goatinator
(slot-premium/surplus machinery), `DRAFT_CLASS_VARIANCE.md` (separate slice).

---

## 1. The idea

Today three valuation systems coexist: board scores (perceived prospect value),
the pick-value chart (trade currency), and the Goatinator-era slot-premium/
surplus math. They interoperate through ad-hoc conversions — the Barterer's
standing finding (the market pays ~1–6% of our $-anchored player points in
pick currency) is the visible seam. The proposal: **express every tradeable
valuation in chart points.**

- A pick = its chart value (validated vs real swaps, p50 1.14×).
- A prospect, to a given team = board-derived points: chart value of the slot
  the team's board says the prospect deserves, bent by positional need/fit —
  so "he's worth pick 41 to us" is literally a number on the chart.
- A veteran = `neutralPlayerTradeValue` mapped through a DERIVED exchange rate
  (the Barterer residual becomes an explicit, calibrated constant instead of
  an implicit distortion).

Trade logic becomes arithmetic: an NPC at slot 60 (chart X) who values a
falling prospect at X+50 will pay up to ~50 points of sweetener; offers clear
when surpluses overlap. One auditable ledger for every deal.

## 2. Personality survives as curve bends (the design's load-bearing rule)

A single currency must NOT produce a single mind. Each GM's effective curve is
bent by persistent, hidden, per-GM parameters — aggression (pays over chart to
move), hoarding (discounts future picks less/more), positional conviction
(need multipliers beyond roster math), win-now horizon (future-pick discount
rate), plus the existing quirk system. The chart is the MARKET; the bends are
the PEOPLE. Two teams valuing the same prospect 80 points apart is the point.

## 3. Scope & mechanics

1. **Draft-day (the trade-up fix, Daniel 4c):** NPC↔NPC and NPC→player offers
   computed from point surpluses; the Goatinator's in-draft trade-up rate bar
   (real 16%) becomes the slice's headline gate. Offers-at-your-slot (draft-day
   audit, pre-alpha item) consumes this machinery.
2. **Offseason picks↔players:** the exchange-rate derivation (real trades,
   nfldata 1,675-trade corpus — the Barterer's own data) sets the player→points
   mapping; the Barterer envelope re-gates it.
3. **Unification with slot-premium:** the surplus math the draft AI already
   uses must SHARE this currency (one implementation, not two agreeing
   approximately) — otherwise they drift and the audit trail lies.

## 4. FLAGGED EXPECTED BEHAVIORS (Daniel judges these later — the 4a flag list)

1. **More trades, more rational trades.** Offer frequency rises (that's the
   goal); early versions may feel STERILE — every deal near-fair — until the
   personality bends (§2) are tuned wide enough. Judge: do lopsided deals still
   happen for legible reasons (desperation, conviction, bad GMs)?
2. **In-draft trade-up rate should land ~16%** (from 4%). Judge on the
   Goatinator; also FEEL it — your phone rings on draft day.
3. **A learnable market.** One transparent-ish currency means an attentive
   player can learn to fleece the chart. Mitigations: hidden per-GM bends,
   need-urgency, imperfect NPC boards. Judge: alpha testers exploiting trades
   trivially = bends too narrow.
4. **The chart becomes the market-maker.** If the chart is wrong anywhere,
   everything priced off it is wrong there too (single point of failure —
   also a single point of CALIBRATION; the chart is already validated vs
   real swaps).
5. **Veteran-for-pick markets re-price.** Fire-sales, deadline deals, and the
   pick-compensation scale all shift when the exchange rate becomes explicit —
   Barterer envelope + Liquidator must re-gate; expect a tuning turn.
6. **Draft-order value perception sharpens.** Tanking/rebuilding incentives get
   more coherent (picks have crisp value) — watch NPC deadline behavior for
   over-eager selloffs.

## 5. Gates

Goatinator full (trade-up rate = the headline; GOAT slots + composition must
HOLD — this slice must not disturb pick SELECTION, only trade clearing);
Barterer envelope on the new exchange rate; a new offer-frequency probe
(offers received per draft at the player's slots vs the real trade-window
rate); Scorekeeper untouched-check (no on-field coupling expected — verify).

## 6. Sequencing

Separate slice from class variance (Daniel #5). Natural order: exchange-rate
derivation (data-only) → draft-day clearing (feeds the alpha's
offers-at-your-slot) → offseason extension. The draft-day portion is the
alpha-relevant half.
