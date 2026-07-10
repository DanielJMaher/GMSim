# The Scouting Process — the player's loop

**Status: APPROVED — Daniel, 2026-07-10 ("as recommended": S1 phase-based inbox,
S2 department-composite seeding, S3 attributed-opinion visit results, S4 visits
as the one hand-managed scarce resource).** Alpha-track workstream 2
(design-before-code; vision-central). Daniel's rulings shaping this doc:
**hands-on evaluator** (read the reports, modify MY board), **dangerous neglect**
(bad or unassigned scouts must punish), **staff management later** (but design the
seam). Parent: `GAME_UI_FOUNDATION.md` (D1 knowledge boundary, D2b exposure
principle); vision: `LIVING_VOICE.md` (read-to-learn — blurbs ENCODE ratings).

---

## 1. The fantasy

You are the GM in the draft room in February. Reports cross your desk — your
area scout swears by a small-school edge, your national guy is lukewarm, the
combine says the kid is a freak. You read, you weigh who's saying it, and you
move him up YOUR board. In April you live with it. The pleasure is *reading,
judging, and committing* — not managing a coverage spreadsheet. Allocation
exists (you point your people somewhere), but the center of gravity is the
**inbox and the board**.

## 2. The loop (one draft cycle, player view)

Calendar phases already exist engine-side; each becomes an inbox beat:

1. **In-season (weekly beats, exists):** media stream + early scout reads on the
   class. Light reading; names start meaning something.
2. **Cycle sweep (exists):** your scouts file their rounds per assignment
   (§4). The inbox fills with attributed, voiced remarks (`ProspectSnapshot`
   machinery). Your scouts' sleeper crushes arrive with conviction — knowing
   whether Rodriguez's conviction is worth anything is YOUR judgment.
3. **Combine (exists):** measurables land; risers/fallers vs tape. Interview
   slots (§5) spent here.
4. **Pro days (exists):** attendance choices (§5); bounded risers.
5. **Top-30 visits (exists as coach-visits):** the scarce deep look (§5) —
   character/medical/football-IQ signal you cannot get any other way.
6. **Draft day:** YOUR board is the instrument (§3). NPC teams draft off their
   own boards exactly as today.

Every beat = reports IN → you read → you touch the board. The verbs are
*read, compare, rank, flag, spend a look*.

## 3. The Board — the player's artifact (the heart)

- **Seeded, not blank:** your board initializes from your own department's
  composite (the same computation NPC boards use — your scouts' observations,
  confidence-weighted). A player who never touches it gets *their scouts'*
  board — quality gated by scout quality (§6).
- **Fully editable:** drag to reorder, tier breaks, per-prospect flags
  (`draft target` / `do not draft` / `needs a visit`), free-text notes.
  Flagging `needs a visit` queues §5 spending; flagging targets biases nothing
  engine-side — the board IS the plan, the player executes it on draft day.
- **Divergence is visible:** each row can show "your board #12 · scouts #19 ·
  media #31" — the read-to-learn payoff is SEEING your own judgment diverge
  from your sources and finding out in September who was right.
- **Storage:** the board (ordering, tiers, flags, notes) is UI/save-side state
  (`apps/game` save wrapper: `{ league, playerTeamId, playerBoard, … }`), NOT
  LeagueState — the engine keeps no player-team privilege (invariant #4). The
  one engine touchpoint: if the draft clock expires (or "sim my pick" is used),
  auto-pick consumes the player board top-down; that path lives in the UI
  calling the normal pick API with a chosen prospect.
- **Season-end reckoning (post-alpha hook):** archive the board at draft day;
  a year later, show it against reality (the Departed-panel pattern). This is
  what makes scouting a *skill you develop*.

## 4. Assignments — light verb, heavy consequence

Once per cycle, point each college scout at (region | conference | position
group) — one screen, five choices, thirty seconds. Consequences are real:
- Coverage follows assignment (the sweep's existing specialty/region structure
  becomes the player's input; NPC teams derive assignments as today).
- **Unassigned scouts follow their own noses** (current auto behavior) — the
  neglect default is "your department does whatever it wants," which is exactly
  the danger Daniel wants: it works about as well as your scouts are good.
- Mis-assignment bites: your DB specialist assigned to interior OL reads like a
  generalist (his hidden `trueAccuracy` map already models this).

## 5. Scarce deep looks — where danger concentrates

Convert three existing auto-events into spendable, capped choices (NPC policy =
today's auto behavior):
- **Top-30 visits (30):** the character/medical/interview deep read. The ONLY
  reliable access to the flags that consensus hides (character.ts machinery,
  bust markers). Real rule, real scarcity.
- **Pro-day trips (bounded):** sharpen a read on a flagged name; bounded riser
  rules already enforced (CLAUDE.md scouting conventions hold).
- **Combine interviews (bounded):** the mid-tier confidence bump.

**The danger model (Daniel: "gotta be dangerous"):** the media consensus board
is always available — and it is systematically bust-prone where consensus is
blind: character/medical (visit-gated), small-school tape (coverage-gated),
workout-warrior inflation (media hype machinery already models it). A player
who ignores scouting drafts off consensus and eats consensus's busts. A player
with bad scouts (§6) gets a noisy department board AND unreliable reads when
they do look. No mechanism softens this: no free truth, no training wheels.
The engine already simulates all of it — the design rule is DON'T add comfort.

## 6. Scout quality — the seam for staff management (later)

Scout entities already carry hidden per-group accuracy, known specialty,
quirks, hidden depths. Alpha: your staff is dealt to you (team-seeded) and
VISIBLE only as identity + known specialty + tenure; their reliability is
learnable only by tracking their calls (verb 4, emergent). Post-alpha: hiring/
firing/budget (Daniel: later, but important) — the seam is that staff quality
is already the input to everything above, so the later slice is pure
personnel-market mechanics, no rework of this loop.

## 7. Knowledge-boundary work this design requires (per D1)

New leak-gated view projections in `knowledge/`:
- `scoutingInbox(league, viewer, sincePhase)` — the beat's new attributed
  remarks (extends ProspectSnapshot assembly with a time/phase filter).
- `departmentBoard(league, teamId)` — the composite ordering (names + tiers +
  attributed rationale, NO numeric scores).
- `mediaBoard(league)` — consensus + per-outlet mock boards (exists via
  mock-board machinery; needs the game-safe projection).
- Deep-look results surface as high-confidence attributed remarks in the inbox
  (same shape, stronger sourcing) — no new display concept needed.

## 8. Alpha scope cut

**M1 (this design):** inbox by phase · the editable seeded board · assignments
screen · top-30 visit spending · the three-column divergence view.
**Post-alpha:** pro-day/interview granularity (auto-spend by flags in alpha if
UI time is short), the season-end board reckoning, staff management, scout
track-record dossiers.

## 9. Open decisions for Daniel

| # | Question | Recommendation |
|---|---|---|
| S1 | Inbox cadence: every calendar phase (6-8 beats/cycle) vs weekly during season | Phase-based for alpha — matches existing events, less grind |
| S2 | Board seeding: department composite vs media consensus vs blank | Department composite (your scouts are your default lens; their quality shows) |
| S3 | Visit results: hard signal ("character concern: CONFIRMED") vs one more attributed opinion | Attributed opinion with high confidence — no oracle, stays read-to-learn |
| S4 | Alpha caps: 30 visits / auto-spent pro days+interviews per flags | Yes — one scarce resource is enough tension for testers |
