---
name: gmsim-docs-and-writing
description: GMSim's documents of record and house prose style — CHANGELOG narrative entries, commit-message anatomy, provenance-comment conventions, design docs (Drive vs repo), CLAUDE.md maintenance, and the project's external surface. Load when writing a CHANGELOG entry, commit message, code comment on a constant, design doc, or updating any doc of record.
---

# GMSim docs & writing

The documents of record, in precedence order: **Drive design docs** (design intent — authoritative; if code and doc disagree, the code is wrong or the doc needs explicit revision) → **repo docs** (`CLAUDE.md`, `docs/NORTH_STAR.md`, `docs/LIVING_LEAGUE.md`, `CONTRIBUTING.md`) → **CHANGELOG.md** (the ~7,600-line chronicle — the project's institutional memory) → **provenance comments** at definitions. There is no wiki; the CHANGELOG and the comments ARE the knowledge base, which is why their style is load-bearing.

## When NOT to use this skill

- What gates a change before it's written up → `gmsim-change-control`
- Mining the chronicle for past battles → `gmsim-failure-archaeology`

## CHANGELOG house style

Entries are **narratives with numbers**, not bullet fragments. The shipped form (study `[0.175.0]`–`[0.177.0]`):

- **Bold headline sentence** stating the change AND its stakes, often with the key metric inline ("#1-overall QB share regression 76→67%, real bar 75").
- Diagnosis before fix: what was wrong, the mechanism, how it was found (name the probe).
- The fix, with WHY it's the honest one (and what alternative was rejected, if one was).
- **Measured results**: before → after against the real bar; which gates ran; residuals NAMED explicitly ("named residual" is a term of art here — it converts a weakness into a tracked object).
- Sections: `### Added` / `### Changed` / `### Fixed` under `## [X.Y.Z] — YYYY-MM-DD`; work accumulates under `## [Unreleased]` until release cut.

Never oversell: dormant stays "dormant", episodic stays "episodic", accepted drift stays listed. The CHANGELOG is trusted precisely because it records what DIDN'T work.

## Commit-message anatomy

Title: `type(scope): summary (vX.Y.Z)` — em-dash sub-clauses welcome ("the cap grows, deals escalate, the market re-prices itself"). Body = compressed CHANGELOG entry: context/diagnosis → the change in parts → measured numbers → gates run, ending with the `Co-Authored-By` trailer when Claude authored it. Scopes and types per `CONTRIBUTING.md`. Mechanics: always `git commit -F <file>` for anything beyond one line (PowerShell quote-mangling — see `gmsim-change-control`).

## Provenance comments (the deepest house convention)

Every calibration constant and non-obvious decision carries its receipts AT THE DEFINITION:

- **Derivation**: where the number comes from, with the real-data citation ("2005 $85.5M → 2025 $279.2M = 6.10%/yr" at `SALARY_CAP_ANNUAL_GROWTH`).
- **The incident**: what bug/finding set this value, with date or version ("the v0.154 record-aware QB churn compared against `seasonNumber` itself, which never matches — the damper shipped dead… until this helper fixed the dating, 2026-07-04" at `lastSeasonWins`).
- **The validating instrument** ("Re-run `pnpm --filter @gmsim/truth-arbiter run liquidator` to recheck" at `POSITION_SALARY_FACTOR`).
- **Falsification honesty**: a comment claiming an unproven effect is a bug; v0.170 shipped a fix whose whole content was correcting a falsified lever comment in `skills.ts`. If measurement contradicts a comment, fixing the comment is a shippable change.

Comment style otherwise: explain constraints and WHY, never what the next line does; module headers tell the module's story (see `transactions/re-sign.ts`, `draft/position-value.ts` for the register).

## Design docs

- **Drive is authoritative** for module design; the index with file IDs is `docs/design-docs/README.md`. Read just-in-time when implementing (deliberately not mirrored into the repo — avoids drift). Access via the Google Drive tool with the listed ID.
- **Authored-in-repo** design docs exist for Daniel-directed designs (`docs/design-docs/LIVING_VOICE.md`, `GM_HIRE_FIRE.md`) — the design-before-code law's artifacts. New vision-central work: write the design there (or Drive), get Daniel's approval, THEN implement.
- `docs/NORTH_STAR.md` and `docs/LIVING_LEAGUE.md` change only with explicit intent — features conform to them, not vice versa.

## CLAUDE.md maintenance

CLAUDE.md is operational truth for sessions: commands, invariants, durable conventions ("Inspector & draft-scouting conventions", "Push gate", the timing-audit section). When a NEW durable rule or workflow lands (like the 2026-07-04 timing audit), it gets a CLAUDE.md section in the same slice. Keep entries imperative and short; deep rationale goes in skills/CHANGELOG, not there.

## External surface (the thin category)

The only public artifact is the inspector on GitHub Pages (auto-deployed on push). No papers, no releases, no ecosystem docs yet. If that changes: the CHANGELOG's no-oversell discipline extends outward — nothing is claimed publicly that an agent hasn't measured, and reproducibility means "seed + version reproduces the league exactly" (the determinism invariant is the reproducibility standard).

## Templates

**CHANGELOG entry skeleton:**
```markdown
- **<Headline with stakes and key metric>.** <Diagnosis: mechanism, how found —
  name the probe>. <Fix and why it's honest; rejected alternative if any>.
  Measured (<instrument, n>): <before → after vs real bar>; <gates run>;
  named residual: <what remains, plainly>.
```

**Provenance comment skeleton:**
```typescript
/**
 * <What this is>. <Derivation with real-data citation>. <Incident that set
 * it, with version/date>. <Validating instrument / re-check command>.
 */
```

## Provenance and maintenance

- Style exemplars drift-check: read the three newest CHANGELOG sections; if the register has shifted, follow the new one and update this skill.
- Drive index: `docs/design-docs/README.md` (verify IDs before fetching).
- The falsified-comment precedent: CHANGELOG `[0.170.0]`.
