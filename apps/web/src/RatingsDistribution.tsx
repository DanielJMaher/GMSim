/**
 * Ratings distribution tab (inspector, dev lens) — league-wide histogram of
 * player overalls (`depthScore`, the archetype-key-skill composite the sim
 * and depth chart both rank by). X = overall (1-pt bins), Y = player count.
 * Filters: position, team (or the FA pool), and an include-FA toggle.
 * The calibration lens for talent-spread / washout work: the league-wide
 * shape should look like a pyramid, not a plateau.
 */

import { useMemo, useState } from 'react';
import { depthScore } from '@gmsim/engine';
import { Position } from '@gmsim/engine/types';
import type { LeagueState, TeamId } from '@gmsim/engine/types';

const ALL_POSITIONS = Object.values(Position);

type TeamFilter = TeamId | 'ALL' | 'FA';

const CHART_W = 800;
const CHART_H = 260;
const MARGIN = { top: 10, right: 10, bottom: 26, left: 40 };

/** Round a max-count up to a friendly axis ceiling (1/2/5 × 10^k). */
function niceCeil(n: number): number {
  if (n <= 5) return 5;
  const mag = Math.pow(10, Math.floor(Math.log10(n)));
  for (const m of [1, 2, 5, 10]) {
    if (n <= m * mag) return m * mag;
  }
  return 10 * mag;
}

export function RatingsDistributionPanel({ league }: { league: LeagueState }) {
  const [positionFilter, setPositionFilter] = useState<Position | 'ALL'>('ALL');
  const [teamFilter, setTeamFilter] = useState<TeamFilter>('ALL');
  const [includeFA, setIncludeFA] = useState(true);

  const teamsList = useMemo(
    () =>
      Object.values(league.teams).sort((a, b) =>
        a.identity.abbreviation.localeCompare(b.identity.abbreviation),
      ),
    [league.teams],
  );

  const { bins, minOv, maxCount, scores, faCount } = useMemo(() => {
    const scores: number[] = [];
    let faCount = 0;
    for (const p of Object.values(league.players)) {
      if (positionFilter !== 'ALL' && p.position !== positionFilter) continue;
      const isFA = p.teamId === null;
      if (teamFilter === 'FA') {
        if (!isFA) continue;
      } else if (teamFilter !== 'ALL') {
        if (p.teamId !== teamFilter) continue;
      } else if (isFA && !includeFA) {
        continue;
      }
      if (isFA) faCount += 1;
      scores.push(depthScore(p));
    }
    if (scores.length === 0) {
      return { bins: [] as number[], minOv: 0, maxCount: 0, scores, faCount };
    }
    const rounded = scores.map((s) => Math.round(s));
    const minOv = Math.min(...rounded);
    const maxOv = Math.max(...rounded);
    const bins = new Array<number>(maxOv - minOv + 1).fill(0);
    for (const r of rounded) bins[r - minOv] = (bins[r - minOv] ?? 0) + 1;
    return { bins, minOv, maxCount: Math.max(...bins), scores, faCount };
  }, [league.players, positionFilter, teamFilter, includeFA]);

  const stats = useMemo(() => {
    if (scores.length === 0) return null;
    const sorted = [...scores].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : sorted[mid] ?? 0;
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    return {
      n: scores.length,
      mean,
      median,
      min: sorted[0] ?? 0,
      max: sorted[sorted.length - 1] ?? 0,
    };
  }, [scores]);

  const innerW = CHART_W - MARGIN.left - MARGIN.right;
  const innerH = CHART_H - MARGIN.top - MARGIN.bottom;
  const yCeil = niceCeil(maxCount);
  const barW = bins.length > 0 ? innerW / bins.length : 0;
  // Label every 5th overall, or every 10th when the range is wide.
  const xLabelStep = bins.length > 45 ? 10 : 5;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(yCeil * f));

  return (
    <section className="rounded border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
          Overall Distribution
        </h2>
        <label className="flex items-center gap-1 text-zinc-400">
          <span className="uppercase tracking-wide text-[10px]">Pos</span>
          <select
            value={positionFilter}
            onChange={(e) => setPositionFilter(e.target.value as Position | 'ALL')}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 font-mono text-xs focus:border-lime-500 focus:outline-none"
          >
            <option value="ALL">All positions</option>
            {ALL_POSITIONS.map((pos) => (
              <option key={pos} value={pos}>
                {pos}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-zinc-400">
          <span className="uppercase tracking-wide text-[10px]">Team</span>
          <select
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value as TeamFilter)}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 font-mono text-xs focus:border-lime-500 focus:outline-none"
          >
            <option value="ALL">All teams</option>
            <option value="FA">Free agents only</option>
            {teamsList.map((t) => (
              <option key={t.identity.id} value={t.identity.id}>
                {t.identity.abbreviation} — {t.identity.fullName}
              </option>
            ))}
          </select>
        </label>
        <label
          className={`flex items-center gap-1 ${teamFilter === 'ALL' ? 'text-zinc-400' : 'text-zinc-600'}`}
          title="Free agents have no team; uncheck to see only rostered players. Only applies when Team = All."
        >
          <input
            type="checkbox"
            checked={includeFA}
            disabled={teamFilter !== 'ALL'}
            onChange={(e) => setIncludeFA(e.target.checked)}
            className="accent-lime-500"
          />
          <span className="uppercase tracking-wide text-[10px]">Include FA</span>
        </label>
        {stats && (
          <span className="ml-auto font-mono text-[11px] text-zinc-500">
            n={stats.n}
            {faCount > 0 && ` (${faCount} FA)`} · mean {stats.mean.toFixed(1)} · median{' '}
            {stats.median.toFixed(1)} · range {stats.min.toFixed(0)}–{stats.max.toFixed(0)}
          </span>
        )}
      </div>

      {bins.length === 0 ? (
        <div className="py-12 text-center text-xs text-zinc-600">
          No players match the current filters.
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          className="w-full"
          role="img"
          aria-label="Histogram of player overall ratings"
        >
          {/* y gridlines + labels */}
          {yTicks.map((t) => {
            const y = MARGIN.top + innerH - (t / yCeil) * innerH;
            return (
              <g key={t}>
                <line
                  x1={MARGIN.left}
                  x2={MARGIN.left + innerW}
                  y1={y}
                  y2={y}
                  className="stroke-zinc-800"
                  strokeWidth={1}
                />
                <text
                  x={MARGIN.left - 6}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-zinc-500 font-mono text-[10px]"
                >
                  {t}
                </text>
              </g>
            );
          })}

          {/* bars */}
          {bins.map((count, i) => {
            if (count === 0) return null;
            const ov = minOv + i;
            const h = (count / yCeil) * innerH;
            return (
              <rect
                key={ov}
                x={MARGIN.left + i * barW + 0.5}
                y={MARGIN.top + innerH - h}
                width={Math.max(barW - 1, 1)}
                height={h}
                className="fill-lime-500/70 hover:fill-lime-300"
              >
                <title>{`Overall ${ov}: ${count} player${count === 1 ? '' : 's'}`}</title>
              </rect>
            );
          })}

          {/* x axis labels */}
          {bins.map((_, i) => {
            const ov = minOv + i;
            if (ov % xLabelStep !== 0) return null;
            const x = MARGIN.left + i * barW + barW / 2;
            return (
              <g key={`x${ov}`}>
                <line
                  x1={x}
                  x2={x}
                  y1={MARGIN.top + innerH}
                  y2={MARGIN.top + innerH + 4}
                  className="stroke-zinc-600"
                  strokeWidth={1}
                />
                <text
                  x={x}
                  y={MARGIN.top + innerH + 16}
                  textAnchor="middle"
                  className="fill-zinc-500 font-mono text-[10px]"
                >
                  {ov}
                </text>
              </g>
            );
          })}
          <line
            x1={MARGIN.left}
            x2={MARGIN.left + innerW}
            y1={MARGIN.top + innerH}
            y2={MARGIN.top + innerH}
            className="stroke-zinc-600"
            strokeWidth={1}
          />
        </svg>
      )}
    </section>
  );
}
