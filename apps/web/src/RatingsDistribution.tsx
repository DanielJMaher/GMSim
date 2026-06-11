/**
 * Histograms tab (inspector, dev lens) — league-wide distributions over the
 * player pool: overall (`depthScore`, the archetype-key-skill composite the
 * sim and depth chart both rank by) and age (`ageOfPlayer`, sim-clock
 * derived). X = value (1-pt bins), Y = player count. Shared filters:
 * position, team (or the FA pool), and an include-FA toggle.
 * The calibration lens for talent-spread / washout / aging work: the
 * league-wide overall shape should look like a pyramid, not a plateau.
 */

import { useMemo, useState } from 'react';
import { depthScore, ageOfPlayer } from '@gmsim/engine';
import { Position } from '@gmsim/engine/types';
import type { LeagueState, TeamId } from '@gmsim/engine/types';

const ALL_POSITIONS = Object.values(Position);

type TeamFilter = TeamId | 'ALL' | 'FA';

const CHART_W = 800;
const CHART_H = 260;
const MARGIN = { top: 10, right: 10, bottom: 26, left: 40 };

/**
 * One histogram card: 1-pt integer bins over `values`, count on Y. Axes are
 * PINNED (`xMin`/`xMax`/`yMax`) so the chart doesn't rescale when filters
 * change — distributions stay visually comparable across positions/teams.
 * Out-of-range values clamp into the edge bins; bars taller than `yMax`
 * clip at the top of the chart (hover shows the true count).
 */
function HistogramCard({
  title,
  unit,
  values,
  barClasses,
  xMin,
  xMax,
  yMax,
}: {
  title: string;
  unit: string;
  values: readonly number[];
  barClasses: string;
  xMin: number;
  xMax: number;
  yMax: number;
}) {
  const bins = useMemo(() => {
    const out = new Array<number>(xMax - xMin + 1).fill(0);
    for (const v of values) {
      const r = Math.min(xMax, Math.max(xMin, Math.round(v)));
      out[r - xMin] = (out[r - xMin] ?? 0) + 1;
    }
    return out;
  }, [values, xMin, xMax]);
  const minVal = xMin;

  const stats = useMemo(() => {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : sorted[mid] ?? 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return { mean, median, min: sorted[0] ?? 0, max: sorted[sorted.length - 1] ?? 0 };
  }, [values]);

  const innerW = CHART_W - MARGIN.left - MARGIN.right;
  const innerH = CHART_H - MARGIN.top - MARGIN.bottom;
  const yCeil = yMax;
  const barW = innerW / bins.length;
  // Label every 5th value, or every 10th when the range is wide.
  const xLabelStep = bins.length > 45 ? 10 : 5;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(yCeil * f));

  return (
    <div>
      <div className="mb-1 flex items-baseline gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{title}</h3>
        {stats && (
          <span className="font-mono text-[11px] text-zinc-500">
            mean {stats.mean.toFixed(1)} · median {stats.median.toFixed(1)} · range{' '}
            {stats.min.toFixed(0)}–{stats.max.toFixed(0)}
          </span>
        )}
      </div>
      {values.length === 0 ? (
        <div className="py-12 text-center text-xs text-zinc-600">
          No players match the current filters.
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          className="w-full"
          role="img"
          aria-label={`Histogram of player ${unit}`}
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

          {/* bars (clipped at the pinned yMax; hover shows the true count) */}
          {bins.map((count, i) => {
            if (count === 0) return null;
            const v = minVal + i;
            const h = (Math.min(count, yCeil) / yCeil) * innerH;
            return (
              <rect
                key={v}
                x={MARGIN.left + i * barW + 0.5}
                y={MARGIN.top + innerH - h}
                width={Math.max(barW - 1, 1)}
                height={h}
                className={barClasses}
              >
                <title>{`${unit} ${v}: ${count} player${count === 1 ? '' : 's'}${count > yCeil ? ' (clipped)' : ''}`}</title>
              </rect>
            );
          })}

          {/* x axis labels */}
          {bins.map((_, i) => {
            const v = minVal + i;
            if (v % xLabelStep !== 0) return null;
            const x = MARGIN.left + i * barW + barW / 2;
            return (
              <g key={`x${v}`}>
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
                  {v}
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
    </div>
  );
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

  const { overalls, ages, faCount } = useMemo(() => {
    const overalls: number[] = [];
    const ages: number[] = [];
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
      overalls.push(depthScore(p));
      ages.push(ageOfPlayer(p, league.seasonNumber));
    }
    return { overalls, ages, faCount };
  }, [league.players, league.seasonNumber, positionFilter, teamFilter, includeFA]);

  return (
    <section className="rounded border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
          Histograms
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
        <span className="ml-auto font-mono text-[11px] text-zinc-500">
          n={overalls.length}
          {faCount > 0 && ` (${faCount} FA)`}
        </span>
      </div>

      <div className="space-y-6">
        <HistogramCard
          title="Overall"
          unit="Overall"
          values={overalls}
          barClasses="fill-lime-500/70 hover:fill-lime-300"
          xMin={0}
          xMax={100}
          yMax={200}
        />
        <HistogramCard
          title="Age"
          unit="Age"
          values={ages}
          barClasses="fill-sky-500/70 hover:fill-sky-300"
          xMin={18}
          xMax={50}
          yMax={1000}
        />
      </div>
    </section>
  );
}
