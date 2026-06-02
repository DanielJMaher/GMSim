import { describe, it } from 'vitest';
import { createLeague } from '../league/generate.js';
import type { TeamId } from '../types/ids.js';
import type { PlayerSkills } from '../types/player.js';

/**
 * Instrument for "the big board is all EDGE + QB" (Daniel, 2026-06-02).
 * Isolates whether the positional flooding comes from raw OBSERVED skill
 * (perception inflating athletic positions — a Slice-3 side effect, since
 * physicals are now position-baselined high regardless of talent) vs the
 * positional-value FACTOR. Run skipped; un-skip to read.
 */
function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}
function realOverall(cur: PlayerSkills): number {
  const v = Object.values(cur) as number[];
  return v.reduce((a, b) => a + b, 0) / v.length;
}

describe.skip('board position realism', () => {
  it('top-40 positional breakdown + observed-vs-real by position', () => {
    const league = createLeague({ seed: 'board-pos-realism' });
    const cpById = new Map(league.collegePool.map((c) => [c.id as string, c] as const));
    const teamId = (Object.keys(league.draftBoards) as TeamId[])[0]!;
    const board = league.draftBoards[teamId]!;

    /* eslint-disable no-console */
    const histo = (entries: typeof board, label: string) => {
      const counts = new Map<string, number>();
      for (const e of entries) {
        const cp = cpById.get(e.collegePlayerId);
        if (!cp) continue;
        const pos = cp.nflProjectedPosition;
        counts.set(pos, (counts.get(pos) ?? 0) + 1);
      }
      const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      console.log(`\n${label}: ${sorted.map(([p, n]) => `${p}:${n}`).join('  ')}`);
    };

    const byPriority = [...board].sort((a, b) => b.priority - a.priority).slice(0, 40);
    const byObserved = [...board].sort((a, b) => b.observedSkillScore - a.observedSkillScore).slice(0, 40);
    histo(byPriority, 'TOP-40 by PRIORITY (what the board shows)');
    histo(byObserved, 'TOP-40 by raw OBSERVED skill (no posFactor)');

    // Per-position: mean observed (perceived) vs mean real overall, over the
    // whole board, to see which positions are systematically over-perceived.
    const byPos = new Map<string, { obs: number[]; real: number[] }>();
    for (const e of board) {
      const cp = cpById.get(e.collegePlayerId);
      if (!cp) continue;
      const rec = byPos.get(cp.nflProjectedPosition) ?? { obs: [], real: [] };
      rec.obs.push(e.observedSkillScore);
      rec.real.push(realOverall(cp.current));
      byPos.set(cp.nflProjectedPosition, rec);
    }
    console.log(`\nper-position observed vs real (board-wide):`);
    console.log(`  ${'pos'.padEnd(7)} ${'n'.padStart(4)} ${'obs'.padStart(6)} ${'real'.padStart(6)} ${'gap'.padStart(6)}`);
    const rows = [...byPos.entries()]
      .map(([pos, r]) => ({ pos, n: r.obs.length, obs: mean(r.obs), real: mean(r.real) }))
      .sort((a, b) => b.obs - a.obs);
    for (const r of rows) {
      console.log(
        `  ${r.pos.padEnd(7)} ${String(r.n).padStart(4)} ${r.obs.toFixed(1).padStart(6)} ${r.real.toFixed(1).padStart(6)} ${(r.obs - r.real).toFixed(1).padStart(6)}`,
      );
    }
    /* eslint-enable no-console */
  });
});
