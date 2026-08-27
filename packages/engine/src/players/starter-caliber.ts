import type { Player } from '../types/player.js';
import type { PlayerId } from '../types/ids.js';
import type { Position } from '../types/enums.js';
import { keySkillAverage } from '../archetypes/key-skill.js';
import { QUALITY_DEPTH_TARGET } from './roster-blueprint.js';

/** 32-team league — the multiplier that turns a per-team quality target
 *  into a league-wide starter-calibre headcount at a position. */
const LEAGUE_TEAMS = 32;

/**
 * Talent Allocation Track 1 (2026-08-04/05, `docs/design-docs/
 * TALENT_ALLOCATION.md` §10.3/§12/D8). Every quality-depth decision
 * (`proactive-trades.ts`'s need/surplus counting and `releaseSurplusStarters`,
 * `fa-bidding.ts`'s need factor and starting-opportunity guard) used to gate
 * on `player.tier === 'STAR' | 'STARTER'`, but `QUALITY_DEPTH_TARGET` — the
 * thing those mechanisms are trying to hit — is itself a top-30.1%-selectivity
 * count. D8 measured a 15x enrichment between the two partitions at the
 * position level (48.9% of QBs blocking a room were tier-INVISIBLE vs a 3.2%
 * population rate): the mechanism was gating on one definition of "good
 * enough" while the metric it was tuned against used a different, PER-
 * POSITION-RELATIVE one. `season/talent-score.ts`'s `withinPositionPercentiles`
 * already solves the position-relative ranking problem but pools at the
 * coarser `AgingBucket` group level (OL/IDL/LB/CB-group/ST combine several
 * `Position`s) — `QUALITY_DEPTH_TARGET` is keyed on the fine `Position`, so
 * reusing it directly would silently misapply at roughly half the 21
 * positions (an OL/IDL/LB/CB/ST player would be ranked against his whole
 * group, not his exact spot). This is the fine-position sibling.
 *
 * Definition: a player is starter-calibre at his position if he ranks in the
 * top `32 * QUALITY_DEPTH_TARGET[position]` of ALL ROSTERED players at that
 * exact position, league-wide — the same selectivity convention the original
 * QB-room probes used (top ~30.1% at QB, where `32 * 1` lands almost exactly
 * on the probes' independently-derived threshold). A target of 0 (FB, NT, P,
 * LS) yields a starter-calibre count of 0 — nobody at that position ever
 * registers as "quality", matching `QUALITY_DEPTH_TARGET`'s own convention.
 *
 * PERF: this is an O(n log n) computation over the whole rostered
 * population. Every consumer computes it ONCE per top-level entry point
 * (once per offseason pass, or once per free-agency period) and threads the
 * resulting set down — never per-team-per-position, which is what blew
 * `league-tick-benchmark.test.ts` in an earlier attempt at this fix.
 */
export function computeStarterCaliberIds(
  players: readonly Player[],
): ReadonlySet<PlayerId> {
  const byPosition = new Map<Position, Player[]>();
  for (const p of players) {
    if (p.teamId === null) continue; // rostered only — same convention as withinPositionPercentiles
    const arr = byPosition.get(p.position);
    if (arr) arr.push(p);
    else byPosition.set(p.position, [p]);
  }

  const out = new Set<PlayerId>();
  for (const [position, list] of byPosition) {
    const n = LEAGUE_TEAMS * (QUALITY_DEPTH_TARGET[position] ?? 0);
    if (n <= 0) continue;
    list.sort(
      (a, b) => keySkillAverage(b.current, b.archetype) - keySkillAverage(a.current, a.archetype),
    );
    for (const p of list.slice(0, n)) out.add(p.id);
  }
  return out;
}
