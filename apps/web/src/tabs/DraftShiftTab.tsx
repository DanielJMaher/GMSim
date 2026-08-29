/**
 * Draft Shift tab — the Big Board: a per-media-round time series of
 * each prospect's perceived grade, so draft stock movement through the
 * season + draft process is visible at a glance.
 * Split out of App.tsx — pure code motion, no behavior change.
 *
 * Exports the Big Board column-building pieces (PerceivedColumn,
 * mediaPerceivedScores, bigBoardColumnLabel, BIG_BOARD_MAX_COLS) too —
 * App.tsx owns the perceivedHistory state (it must capture every tick
 * regardless of the active tab) but the column-shape and scoring logic
 * is this tab's concern.
 */
import { useMemo, useState } from 'react';
import type { LeagueState } from '@gmsim/engine/types';
import type { LifecyclePhase } from '@gmsim/engine';

// ─── Big Board tab (v0.79) ──────────────────────────────────────────────
//
// A per-media-round time series of each prospect's perceived grade,
// captured tick-by-tick as you step the lifecycle. Rows are prospects,
// columns are coverage rounds (preseason → bowls → combine → pro days →
// top-30), each cell the media consensus grade at that round, tinted by
// how much the grade MOVED since the prior round. Hover a cell for why
// it moved (the event that drove it). The point is to watch stock rise
// and fall through the season + draft process and gauge whether the
// movement feels real — e.g. workout warriors jumping at the combine.

/** Max coverage-round columns kept — a full season is ~12 weekly CFB
 * rounds plus the offseason rounds (preseason → top-30), so 22 keeps the
 * whole arc visible before older columns scroll off. */
export const BIG_BOARD_MAX_COLS = 22;
/** Max prospect rows shown (by most-recent grade). */
const BIG_BOARD_MAX_ROWS = 50;
/** Grade delta (points) that counts as a "big" move for the tint. */
const BIG_BOARD_BIG_MOVE = 5;

export interface PerceivedColumn {
  key: string;
  phase: LifecyclePhase;
  label: string;
  dateLabel: string;
  /** prospectId → media consensus grade (0-100) at this round. */
  scores: Map<string, number>;
}

/**
 * Confidence-weighted media consensus grade per prospect from the current
 * media observation stream. Mirrors the board's observed-grade math but
 * over the outlets' evaluator stream, returning a 0-100 score per
 * prospect (not a rank).
 */
export function mediaPerceivedScores(league: LeagueState): Map<string, number> {
  const agg = new Map<string, { wsum: number; csum: number }>();
  for (const obs of league.mediaCollegeObservations) {
    let sSum = 0;
    let sN = 0;
    let cSum = 0;
    let cN = 0;
    for (const v of Object.values(obs.skills)) {
      if (typeof v === 'number') {
        sSum += v;
        sN += 1;
      }
    }
    for (const v of Object.values(obs.confidence)) {
      if (typeof v === 'number') {
        cSum += v;
        cN += 1;
      }
    }
    const overall = sN > 0 ? sSum / sN : 0;
    const conf = cN > 0 ? cSum / cN : 0;
    if (conf <= 0) continue;
    const cur = agg.get(obs.collegePlayerId) ?? { wsum: 0, csum: 0 };
    cur.wsum += overall * conf;
    cur.csum += conf;
    agg.set(obs.collegePlayerId, cur);
  }
  const out = new Map<string, number>();
  for (const [id, { wsum, csum }] of agg) {
    if (csum > 0) out.set(id, Math.round(wsum / csum));
  }
  return out;
}

/** Short column header for a coverage round's phase. */
export function bigBoardColumnLabel(phase: LifecyclePhase, collegeWeek?: number | null): string {
  switch (phase) {
    case 'COLLEGE_WEEK':
      return collegeWeek === null || collegeWeek === undefined
        ? 'CFB Wk'
        : `CFB Wk ${collegeWeek + 1}`;
    case 'PRESEASON':
      return 'Preseason';
    case 'SHRINE_BOWL':
      return 'Shrine';
    case 'SENIOR_BOWL':
      return 'Senior Bowl';
    case 'COMBINE':
      return 'Combine';
    case 'PRO_DAYS':
      return 'Pro Days';
    case 'TOP_30_VISITS':
      return 'Top-30';
    case 'DRAFT_DECLARATION':
      return 'Declared';
    default:
      return phase;
  }
}

/** Why a prospect's grade moved this round — derived from the event. */
function bigBoardMoveReason(phase: LifecyclePhase, delta: number | null): string {
  if (delta === null) return 'First media read of the class';
  const mag = `${delta > 0 ? '+' : ''}${delta}`;
  switch (phase) {
    case 'COMBINE':
      return delta >= 0
        ? `Combine: tested better than scouts expected (${mag})`
        : `Combine: workout disappointed (${mag})`;
    case 'PRO_DAYS':
      return `Pro day workout (${mag})`;
    case 'SHRINE_BOWL':
    case 'SENIOR_BOWL':
      return `All-star week — practices + interviews (${mag})`;
    case 'TOP_30_VISITS':
      return `Top-30 visits + final scouting sweep (${mag})`;
    case 'PRESEASON':
      return `Preseason buzz (${mag})`;
    case 'DRAFT_DECLARATION':
      return `Declared for the draft (${mag})`;
    case 'COLLEGE_WEEK':
      return delta >= 0
        ? `Game results — produced vs the schedule (${mag})`
        : `Game results — quiet week / tough matchup (${mag})`;
    default:
      return `Stock ${delta > 0 ? 'rose' : delta < 0 ? 'fell' : 'held'} (${mag})`;
  }
}

/** Tailwind classes tinting a cell by how much the grade moved. */
function bigBoardCellClass(delta: number | null): string {
  if (delta === null) return 'bg-zinc-800/40 text-zinc-300';
  if (delta >= BIG_BOARD_BIG_MOVE) return 'bg-emerald-500/30 text-emerald-100';
  if (delta > 0) return 'bg-emerald-500/10 text-emerald-200';
  if (delta <= -BIG_BOARD_BIG_MOVE) return 'bg-rose-500/30 text-rose-100';
  if (delta < 0) return 'bg-rose-500/10 text-rose-200';
  return 'bg-zinc-800/30 text-zinc-400';
}

interface BigBoardCell {
  score: number;
  /** Change vs the prospect's previous round; null = first appearance. */
  delta: number | null;
}

interface BigBoardMatrixRow {
  prospectId: string;
  name: string;
  position: string;
  /** Ground-truth overall (mean of true current skills) — the reality
   * check against the perceived grades. null if unresolved. */
  real: number | null;
  cells: (BigBoardCell | null)[];
  /** Most-recent non-null score, for default sorting. */
  latest: number;
}

type BigBoardSort = 'name' | 'latest' | number;

export function DraftShiftPanel({
  league,
  history,
}: {
  league: LeagueState;
  history: readonly PerceivedColumn[];
}) {
  const [sort, setSort] = useState<BigBoardSort>('latest');

  // Resolve names/position/real grade for every prospect — including
  // those already drafted out of the college pool (via draft history →
  // promoted NFL player). Without the drafted-side lookup, older columns
  // render raw CP_… ids once the class is drafted.
  const resolve = useMemo(() => {
    const m = new Map<string, { name: string; position: string; real: number | null }>();
    const mean = (s: Record<string, number>) => {
      const vals = Object.values(s);
      return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    };
    for (const cp of league.collegePool) {
      m.set(cp.id, {
        name: `${cp.firstName} ${cp.lastName}`,
        position: cp.nflProjectedPosition,
        real: mean(cp.current as unknown as Record<string, number>),
      });
    }
    for (const pick of league.draftHistory) {
      if (m.has(pick.collegePlayerId)) continue;
      const p = league.players[pick.promotedPlayerId];
      if (p) {
        m.set(pick.collegePlayerId, {
          name: `${p.firstName} ${p.lastName}`,
          position: p.position,
          real: mean(p.current as unknown as Record<string, number>),
        });
      }
    }
    return m;
  }, [league.collegePool, league.draftHistory, league.players]);

  const rows = useMemo<BigBoardMatrixRow[]>(() => {
    if (history.length === 0) return [];
    const ids = new Set<string>();
    for (const col of history) for (const id of col.scores.keys()) ids.add(id);

    const built: BigBoardMatrixRow[] = [];
    for (const id of ids) {
      let prev: number | null = null;
      let latest = -1;
      const cells = history.map((col) => {
        const s = col.scores.get(id);
        if (s === undefined) return null;
        const delta = prev === null ? null : s - prev;
        prev = s;
        latest = s;
        return { score: s, delta };
      });
      const meta = resolve.get(id);
      built.push({
        prospectId: id,
        name: meta?.name ?? id,
        position: meta?.position ?? '',
        real: meta?.real ?? null,
        cells,
        latest,
      });
    }

    built.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'latest') return b.latest - a.latest;
      const av = a.cells[sort]?.score ?? -1;
      const bv = b.cells[sort]?.score ?? -1;
      return bv - av;
    });
    return built.slice(0, BIG_BOARD_MAX_ROWS);
  }, [history, resolve, sort]);

  return (
    <section className="mt-6 rounded border border-cyan-500/20 bg-cyan-500/[0.03] p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-cyan-200">Big Board — Stock Tracker</h2>
        <span className="text-[10px] text-zinc-500">sort: click a column header</span>
      </div>

      <p className="mb-3 text-xs text-zinc-500">
        Each prospect's <strong>media consensus grade</strong> at every
        coverage round, captured as you step the lifecycle. A cell is tinted
        by how much the grade <strong>moved</strong> since the prior round —{' '}
        <span className="rounded bg-emerald-500/30 px-1 text-emerald-100">green up</span>,{' '}
        <span className="rounded bg-rose-500/30 px-1 text-rose-100">red down</span>. Hover a
        cell for what drove the move. Step through the COMBINE to watch
        workout warriors jump.
      </p>

      {rows.length === 0 ? (
        <div className="rounded border border-zinc-800 bg-zinc-950/40 p-3 text-xs text-zinc-500">
          No reads captured yet. Step the lifecycle (Lifecycle tab) through a
          media coverage round — the preseason, the Shrine/Senior bowls, the
          combine, pro days, and the top-30 sweep each add a column here.
        </div>
      ) : (
        <div className="overflow-x-auto rounded border border-zinc-800 bg-zinc-950/40">
          <table className="min-w-full border-collapse text-xs">
            <thead>
              <tr className="text-zinc-400">
                <th
                  onClick={() => setSort('name')}
                  className={`sticky left-0 z-10 cursor-pointer bg-zinc-950 px-3 py-1.5 text-left font-medium hover:text-cyan-200 ${sort === 'name' ? 'text-cyan-200' : ''}`}
                >
                  Player ▾
                </th>
                <th
                  className="whitespace-nowrap px-2 py-1.5 text-center font-medium text-zinc-400"
                  title="ground-truth overall (what we really have on them)"
                >
                  Real
                </th>
                {history.map((col, i) => (
                  <th
                    key={col.key}
                    onClick={() => setSort(i)}
                    className={`cursor-pointer whitespace-nowrap px-2 py-1.5 text-center font-medium hover:text-cyan-200 ${sort === i ? 'text-cyan-200' : ''}`}
                    title={`${col.label}${col.dateLabel ? ` · ${col.dateLabel}` : ''}`}
                  >
                    <div>{col.label}</div>
                    <div className="font-mono text-[9px] font-normal text-zinc-600">{col.dateLabel}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.prospectId} className="border-t border-zinc-800/60">
                  <td className="sticky left-0 z-10 bg-zinc-950/95 px-3 py-1 text-left">
                    <span className="text-zinc-200">{r.name}</span>
                    {r.position && <span className="ml-1.5 text-zinc-600">{r.position}</span>}
                  </td>
                  <td className="px-2 py-1 text-center font-mono tabular-nums text-zinc-400" title="ground-truth overall">
                    {r.real ?? '—'}
                  </td>
                  {r.cells.map((cell, i) => (
                    <td key={history[i]!.key} className="px-1 py-0.5 text-center">
                      {cell === null ? (
                        <span className="text-zinc-700">·</span>
                      ) : (
                        <span
                          className={`inline-block w-9 rounded py-0.5 font-mono tabular-nums ${bigBoardCellClass(cell.delta)}`}
                          title={`${history[i]!.label}: ${bigBoardMoveReason(history[i]!.phase, cell.delta)} → grade ${cell.score}`}
                        >
                          {cell.score}
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
