# Living League

Source of truth for the simulation's scope and scale. The player is one of 32 GMs. The other 31 organizations are not a backdrop — they are autonomous, opinionated, and persistent.

Distilled from `Football GM Simulator — Living League: 32-Team Ecosystem Design Document` (Drive ID `1vDnynFESV5120fZb1EZHUnz4F-VaXzQGy8c_W4Dm-5w`).

---

## Core requirement

Every system the player uses for their own team must be designed and built to operate simultaneously, independently, and authentically across all 32 teams.

This is not an optimization pass. It is a foundational architectural constraint applied from the first commit. A system that works for the player's team but runs poorly or generically for 31 NPC teams is a failed system.

## What each of the 32 teams independently has

- Scouting infrastructure (college + NFL) with its own strengths, blind spots, and budget
- Draft board driven by their scheme, coaching staff preferences, and scouting quality
- Dynamic trade value chart with situational modifiers reactive to league events
- Offensive and defensive scheme identity that evolves with coaching changes
- Full coaching staff with personalities, tendencies, and trees
- GM with philosophy, risk tolerance, and decision-making patterns
- Free agency approach (overpaying for names vs disciplined value vs cap-strapped chaos)
- Genuine, dynamic roster needs
- Fan base with patience level, expectations, market relationship
- Media market that scales coverage and pressure
- Locker room chemistry tracked independently

## Organizational personality is a living system

Every team has an organizational personality computed from the Personnel Generation System and the 32-Team Personality formula:

```
Team Personality = (50% Owner) + (20% GM) + (20% HC) + (10% Fan Base)
```

Personality is **not static**. It evolves with coaching changes, GM firings, ownership transitions, fan sentiment, and competitive results. The player **never sees** team personality scores. They are discovered through observation of organizational behavior over time.

## Generational change events

Some events trigger modifier cascades across multiple systems simultaneously:

- Owner death or sale → ownership philosophy propagates through all modifiers
- Long-tenured GM fired → resets multiple modifier states
- Franchise QB retires → competitive window closes; pivot across scouting/draft/FA/trade
- Dynasty coaching staff breaks up → scheme identity shifts; roster needs reset

Generational change handling is **part of every dependent system's contract**, not a special case bolted on later.

## NPC AI is its own module

All NPC team decisions (draft, trade, FA, hire/fire) route through `packages/engine/src/npc-ai`. This module reads each team's Personnel Generation profile + Team Personality + current modifier state and produces decisions consistent with that team's identity. Scattering AI logic across feature modules makes "the NPCs feel generic" undebuggable.

## Stress-test checkpoints

No system is considered complete until each of the following can be answered yes:

1. **Scale** — Runs correctly for all 32 teams simultaneously?
2. **Uniqueness** — Each team's output reflects their personality, scheme, and modifier state, or does it feel generic?
3. **Reactivity** — Responds correctly when other teams' actions create ripple effects?
4. **Performance** — Acceptable speed under full 32-team load?
5. **Immersion** — NPC output feels organic, not placeholder?
6. **North Star** — Player learns through observation, not via labels?
7. **Human Motivation** — NPC decisions reflect realistic human pressures (fired GM panic, owner ego, contract-year desperation), not pure rational optimization?
8. **Generational Change** — Handles ownership/QB/coaching transitions correctly?

## High-risk systems for early stress testing

Some systems carry disproportionate complexity at 32-team scale and need stress tests baked into their initial test suite:

- Draft pipeline (32 parallel scouting + war room + decision engines)
- Dynamic trade value charts with reactive modifiers
- Free agency simultaneous bidding + cap management + personality-driven decisions
- Coaching/GM carousel producing realistic, non-repetitive league-wide hiring patterns
- Media ecosystem generating attributed, personality-consistent coverage without becoming repetitive
- Trade market with 31 AI teams evaluating proposals contextually
- Generational change cascades

## Engineering enforcement

- **Engine API is league-shaped, not team-shaped.** All engine functions operate on the league as a whole. There is no "player team" privilege at the engine level. UI scopes the player's view; the engine doesn't.
- **NPC behavior is testable in isolation.** `packages/engine/src/npc-ai` is structured so that an NPC team's draft, trade, and FA decisions can be unit-tested with a fixed Personality profile and modifier state.
- **32-team performance is a CI gate.** Engine tests include a "full season league tick" benchmark with a wall-clock budget. Regression in that benchmark fails CI.
