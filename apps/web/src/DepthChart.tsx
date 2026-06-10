/**
 * Depth chart card (inspector, dev lens) — renders the engine's canonical
 * derived depth chart (`computeTeamDepthChart`): projected base-lineup
 * starters highlighted, bench ordered behind them, depth composite shown
 * (numbers are fine here — this is the inspector, not the game UI).
 */

import { useMemo } from 'react';
import { computeTeamDepthChart, depthScore } from '@gmsim/engine';
import type { LeagueState, TeamState, Position, PlayerId } from '@gmsim/engine/types';

const OFFENSE: readonly Position[] = ['QB', 'RB', 'FB', 'WR', 'TE', 'LT', 'LG', 'C', 'RG', 'RT'];
const DEFENSE: readonly Position[] = ['EDGE', 'DT', 'NT', 'ILB', 'OLB', 'CB', 'S', 'NICKEL'];
const SPECIAL: readonly Position[] = ['K', 'P', 'LS'];

function PositionRow({
  pos,
  league,
  playerIds,
  starterCount,
}: {
  pos: Position;
  league: LeagueState;
  playerIds: readonly PlayerId[];
  starterCount: number;
}) {
  if (playerIds.length === 0 && starterCount === 0) return null;
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-12 shrink-0 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
        {pos}
      </span>
      <div className="flex flex-wrap gap-x-2 gap-y-0.5">
        {playerIds.map((id, i) => {
          const p = league.players[id];
          if (!p) return null;
          const starter = i < starterCount;
          return (
            <span
              key={id}
              className={
                starter
                  ? 'rounded border border-emerald-500/40 bg-emerald-500/10 px-1 text-[11px] text-emerald-200'
                  : 'px-1 text-[11px] text-zinc-500'
              }
              title={`${p.firstName} ${p.lastName} — depth composite ${depthScore(p).toFixed(1)} · grade ${p.talentGrade}`}
            >
              {p.firstName.charAt(0)}. {p.lastName}
              <span className={`ml-1 font-mono text-[10px] ${starter ? 'text-emerald-400/80' : 'text-zinc-600'}`}>
                {depthScore(p).toFixed(0)}
              </span>
            </span>
          );
        })}
        {playerIds.length < starterCount && (
          <span className="rounded border border-rose-500/40 bg-rose-500/10 px-1 text-[10px] uppercase text-rose-300">
            {starterCount - playerIds.length} short
          </span>
        )}
      </div>
    </div>
  );
}

export function DepthChartCard({ team, league }: { team: TeamState; league: LeagueState }) {
  const chart = useMemo(
    () => computeTeamDepthChart(league, team.identity.id),
    [league, team.identity.id],
  );
  if (!chart) return null;

  const section = (label: string, positions: readonly Position[]) => (
    <div className="space-y-0.5">
      <div className="text-[10px] uppercase tracking-wider text-zinc-600">{label}</div>
      {positions.map((pos) => (
        <PositionRow
          key={pos}
          pos={pos}
          league={league}
          playerIds={chart.slots[pos].playerIds}
          starterCount={chart.slots[pos].starterCount}
        />
      ))}
    </div>
  );

  return (
    <section className="rounded border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Depth Chart
        </h3>
        <span
          className="text-[10px] text-zinc-600"
          title="Derived each render from the roster by the archetype-key-skill composite — the same signal the game sim ranks personnel by. Green = projected base-lineup starter (11 offense / 11 nickel defense / 3 ST)."
        >
          {chart.starterIds.length} projected starters · composite-ranked
        </span>
      </div>
      <div className="grid gap-3 text-xs lg:grid-cols-3">
        {section('Offense', OFFENSE)}
        {section('Defense', DEFENSE)}
        {section('Special Teams', SPECIAL)}
      </div>
    </section>
  );
}
