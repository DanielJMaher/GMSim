/**
 * Free Agency tab — the league-wide free agent pool.
 * Split out of App.tsx — pure code motion, no behavior change.
 */
import React, { useMemo, useState } from 'react';
import { ageOfPlayer, freeAgents } from '@gmsim/engine';
import type { LeagueState, Player, PlayerId } from '@gmsim/engine/types';
import { avgKeySkill } from '../lib/format';
import { PlayerDetail } from './LeagueTab';

export function FreeAgentPoolPanel({ league }: { league: LeagueState }) {
  const [expanded, setExpanded] = useState(false);
  const [expandedPlayerId, setExpandedPlayerId] = useState<PlayerId | null>(null);
  const fas = useMemo(() => freeAgents(league), [league]);
  const tierCounts = useMemo(() => {
    const counts = { STAR: 0, STARTER: 0, BACKUP: 0, FRINGE: 0 };
    for (const player of fas) counts[player.tier]++;
    return counts;
  }, [fas]);
  const topFAs = useMemo(() => {
    const tierRank: Record<Player['tier'], number> = {
      STAR: 0,
      STARTER: 1,
      BACKUP: 2,
      FRINGE: 3,
    };
    return [...fas]
      .sort((a, b) => {
        const t = tierRank[a.tier] - tierRank[b.tier];
        if (t !== 0) return t;
        return avgKeySkill(b) - avgKeySkill(a);
      })
      .slice(0, 50);
  }, [fas]);

  if (fas.length === 0) {
    return (
      <section className="mb-8 rounded border border-zinc-800 bg-zinc-900/40 p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Free agent pool
        </h2>
        <p className="mt-2 text-xs text-zinc-600">
          Empty — every player is on a roster. Fast-forward a season to see
          expirations + cap cuts surface fresh free agents.
        </p>
      </section>
    );
  }

  return (
    <section className="mb-8 rounded border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Free agent pool
        </h2>
        <button
          onClick={() => setExpanded((x) => !x)}
          className="text-xs text-zinc-400 hover:text-zinc-200"
        >
          {expanded ? 'collapse' : 'expand'} ({fas.length} total)
        </button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(['STAR', 'STARTER', 'BACKUP', 'FRINGE'] as const).map((tier) => (
          <div key={tier} className="rounded border border-zinc-800 bg-zinc-950/50 p-2">
            <div className="text-xs text-zinc-500">{tier.toLowerCase()}</div>
            <div className="font-mono text-sm">{tierCounts[tier]}</div>
          </div>
        ))}
      </div>
      {expanded && (
        <div className="mt-3 max-h-72 overflow-y-auto rounded border border-zinc-800 bg-zinc-950/40">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-zinc-900/95 text-zinc-500">
              <tr>
                <th className="px-2 py-1 font-medium">name</th>
                <th className="px-2 py-1 font-medium">pos</th>
                <th className="px-2 py-1 font-medium">tier</th>
                <th className="px-2 py-1 font-medium">arch</th>
                <th className="px-2 py-1 text-right font-medium">age</th>
                <th className="px-2 py-1 text-right font-medium">skill</th>
              </tr>
            </thead>
            <tbody>
              {topFAs.map((player) => {
                const isOpen = expandedPlayerId === player.id;
                return (
                  <React.Fragment key={player.id}>
                    <tr
                      className={`cursor-pointer border-t border-zinc-800/60 hover:bg-zinc-900/60 ${
                        isOpen ? 'bg-zinc-900/40' : ''
                      }`}
                      onClick={() => setExpandedPlayerId(isOpen ? null : player.id)}
                    >
                      <td className="px-2 py-1">
                        <span className="mr-1 text-zinc-600">{isOpen ? '▼' : '▶'}</span>
                        {player.firstName} {player.lastName}
                      </td>
                      <td className="px-2 py-1 font-mono text-zinc-400">{player.position}</td>
                      <td className="px-2 py-1 text-zinc-400">{player.tier.toLowerCase()}</td>
                      <td className="px-2 py-1 text-zinc-500">
                        {player.archetype.toLowerCase().replace(/_/g, ' ')}
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-zinc-400">
                        {ageOfPlayer(player, league.seasonNumber)}
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-zinc-300">
                        {avgKeySkill(player).toFixed(0)}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-t border-zinc-800/60 bg-zinc-950/60">
                        <td colSpan={6} className="px-3 py-3">
                          <PlayerDetail player={player} league={league} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {fas.length > topFAs.length && (
                <tr className="border-t border-zinc-800/60 text-center text-zinc-600">
                  <td colSpan={6} className="py-2">
                    … {fas.length - topFAs.length} more not shown
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
