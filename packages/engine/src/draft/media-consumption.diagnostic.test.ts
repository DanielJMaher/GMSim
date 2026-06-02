import { describe, it } from 'vitest';
import { createLeague } from '../league/generate.js';
import { tickPhase } from '../season/lifecycle.js';
import { regenerateDraftBoardsForLeague } from './board.js';
import type { LeagueState } from '../types/league.js';
import type { DraftBoardEntry } from '../types/college.js';
import type { TeamId, PlayerId } from '../types/ids.js';

/**
 * Instrument (not a guard) for "GMs consume the media" — the BASELINE read
 * before the per-GM perceived-outlet-trust work (Slice 2+).
 *
 * What we're checking (Daniel, 2026-06-02):
 *   - Media already blends into every team's board (board.ts:510). This
 *     measures HOW MUCH it moves boards today, and whether that movement
 *     tracks the GM's `mediaTrust` archetype the way it should.
 *   - THE GAP: every GM weights an outlet's read by that outlet's *true*
 *     `accuracyByGroup` (board.ts `weightObsByOutlet`). So the ONLY per-GM
 *     lever is the `mediaTrust` scalar — GMs are omniscient about WHICH
 *     outlets are sharp. There is no per-GM belief about an outlet's
 *     credibility, so two GMs with equal mediaTrust react identically to a
 *     loud-but-wrong outlet. Slice 2 replaces the true-accuracy weighting
 *     with a per-GM *perceived* reliability that can be miscalibrated.
 *
 * Run skipped; un-skip (`describe.only` / drop `.skip`) to read the numbers.
 */

function meanAbs(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + Math.abs(b), 0) / xs.length;
}

/** Regenerate every team's board, optionally feeding the media stream. */
function boards(league: LeagueState, withMedia: boolean): Record<TeamId, DraftBoardEntry[]> {
  return regenerateDraftBoardsForLeague({
    teams: league.teams,
    collegeScouts: league.collegeScouts,
    coaches: league.coaches,
    players: league.players,
    collegePool: league.collegePool,
    observations: league.collegeObservations,
    addedOnTick: league.tick,
    combineResults: league.combineResults,
    ...(withMedia
      ? {
          mediaObservations: league.mediaCollegeObservations,
          gms: league.gms,
          mediaOutlets: league.mediaOutlets,
        }
      : {}),
  });
}

function rankMap(board: readonly DraftBoardEntry[]): Map<PlayerId, number> {
  const m = new Map<PlayerId, number>();
  board.forEach((e, i) => m.set(e.collegePlayerId, i));
  return m;
}

function trustBucket(t: number): 'low(1-3)' | 'med(4-6)' | 'high(7-10)' {
  if (t <= 3) return 'low(1-3)';
  if (t <= 6) return 'med(4-6)';
  return 'high(7-10)';
}

describe.skip('media consumption — baseline instrument', () => {
  it('measures how much media moves boards, bucketed by GM mediaTrust', () => {
    // The media stream is empty at createLeague (REGULAR_SEASON_WEEK). Advance
    // to PRE_DRAFT — the final board before the draft, with media fully
    // populated (preseason/bowls/combine/pro-day coverage all filed).
    let league = createLeague({ seed: 'media-consume-instrument' });
    for (let i = 0; i < 80 && league.lifecyclePhase !== 'PRE_DRAFT'; i++) {
      league = tickPhase(league);
    }
    const noMedia = boards(league, false);
    const withMedia = boards(league, true);

    /* eslint-disable no-console */
    console.log(`\n=== MEDIA CONSUMPTION BASELINE (phase ${league.lifecyclePhase}) ===`);
    console.log(`media obs: ${league.mediaCollegeObservations.length}, outlets: ${Object.keys(league.mediaOutlets).length}`);

    // Aggregate per mediaTrust bucket: mean |score shift| on shared prospects,
    // mean |rank shift|, and how many top-32 board slots changed identity.
    const buckets = new Map<
      string,
      { teams: number; scoreShifts: number[]; rankShifts: number[]; top32Changed: number }
    >();

    for (const teamId of Object.keys(league.teams) as TeamId[]) {
      const team = league.teams[teamId]!;
      const gm = league.gms[team.gmId];
      if (!gm) continue;
      const bk = trustBucket(gm.spectrums.mediaTrust);
      const acc = buckets.get(bk) ?? { teams: 0, scoreShifts: [], rankShifts: [], top32Changed: 0 };

      const a = noMedia[teamId] ?? [];
      const b = withMedia[teamId] ?? [];
      const aRank = rankMap(a);
      const aScore = new Map<PlayerId, number>(a.map((e) => [e.collegePlayerId, e.observedSkillScore]));
      const bRank = rankMap(b);

      for (const e of b) {
        const prevScore = aScore.get(e.collegePlayerId);
        if (prevScore !== undefined) acc.scoreShifts.push(e.observedSkillScore - prevScore);
        const prevRank = aRank.get(e.collegePlayerId);
        if (prevRank !== undefined) acc.rankShifts.push(bRank.get(e.collegePlayerId)! - prevRank);
      }
      const aTop = new Set(a.slice(0, 32).map((e) => e.collegePlayerId));
      const bTop = b.slice(0, 32).map((e) => e.collegePlayerId);
      acc.top32Changed += bTop.filter((id) => !aTop.has(id)).length;

      acc.teams += 1;
      buckets.set(bk, acc);
    }

    console.log('trustBucket        teams  mean|Δscore|  mean|Δrank|  top32-newNames/team');
    for (const bk of ['low(1-3)', 'med(4-6)', 'high(7-10)']) {
      const a = buckets.get(bk);
      if (!a) {
        console.log(`${bk.padEnd(18)} (none)`);
        continue;
      }
      console.log(
        `${bk.padEnd(18)} ${String(a.teams).padStart(5)}  ${meanAbs(a.scoreShifts)
          .toFixed(3)
          .padStart(11)}  ${meanAbs(a.rankShifts).toFixed(2).padStart(10)}  ${(
          a.top32Changed / a.teams
        )
          .toFixed(2)
          .padStart(18)}`,
      );
    }
    console.log(
      '\nNote: the only per-GM lever above is the mediaTrust scalar — all GMs weight\n' +
        'each outlet by its TRUE accuracyByGroup (omniscient). Slice 2 makes that a\n' +
        'per-GM PERCEIVED reliability that can be wrong.',
    );
    /* eslint-enable no-console */
  });
});
