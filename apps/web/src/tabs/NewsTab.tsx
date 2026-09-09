/**
 * News tab — the derived league news feed and the raw transaction log
 * (releases, signings, trades, restructures, IR moves, etc).
 * Split out of App.tsx — pure code motion, no behavior change.
 */
import React, { useMemo, useState } from 'react';
import { ageOfPlayer, deriveNewsFeed } from '@gmsim/engine';
import type { NewsItem, NewsSource } from '@gmsim/engine';
import type { LockerRoomIncidentFlavor } from '@gmsim/engine/types';
import type { LeagueState, TeamState, PlayerId, TeamId, Transaction } from '@gmsim/engine/types';
import { Position } from '@gmsim/engine/types';
import { WATCH_LIST_REASON } from '../lib/format';
import { ContractTermsTable } from '../lib/cells';

export function NewsFeedPanel({ league }: { league: LeagueState }) {
  const [expanded, setExpanded] = useState(true);
  const [sourceFilter, setSourceFilter] = useState<NewsSource | 'all'>('all');
  const allItems = useMemo(() => deriveNewsFeed(league), [league]);
  const filtered = useMemo(
    () => (sourceFilter === 'all' ? allItems : allItems.filter((n) => n.source === sourceFilter)),
    [allItems, sourceFilter],
  );
  const visible = useMemo(() => filtered.slice(0, 40), [filtered]);

  if (allItems.length === 0) {
    return (
      <section className="mb-8 rounded border border-zinc-800 bg-zinc-900/40 p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          News feed
        </h2>
        <p className="mt-2 text-xs text-zinc-600">
          The wire is quiet. Fast-forward a season to see trade demands,
          leaked locker-room incidents, blockbuster trades, and big-name
          signings populate the feed.
        </p>
      </section>
    );
  }

  return (
    <section className="mb-8 rounded border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          News feed
        </h2>
        <button
          onClick={() => setExpanded((x) => !x)}
          className="text-xs text-zinc-400 hover:text-zinc-200"
        >
          {expanded ? 'collapse' : 'expand'} ({allItems.length} item
          {allItems.length === 1 ? '' : 's'})
        </button>
      </div>
      {expanded && (
        <>
          <div className="mt-2 flex flex-wrap gap-2">
            {(
              [
                ['all', 'all sources'],
                ['national_insider', 'national'],
                ['beat_writer', 'beat'],
                ['anonymous_source', 'anon'],
                ['social_media', 'social'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSourceFilter(key)}
                className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                  sourceFilter === key
                    ? 'border-zinc-500 bg-zinc-700/40 text-zinc-100'
                    : 'border-zinc-800 bg-zinc-950/40 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-col gap-2">
            {visible.map((item, i) => (
              <NewsFeedRow key={`${item.tick}-${i}`} item={item} />
            ))}
            {filtered.length > visible.length && (
              <div className="py-2 text-center text-xs text-zinc-600">
                … {filtered.length - visible.length} older items hidden
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function NewsFeedRow({ item }: { item: NewsItem }) {
  return (
    <article
      className={`rounded border-l-2 ${newsSeverityBorderClass(item.severity)} bg-zinc-950/40 px-3 py-2`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className={`text-sm ${newsSeverityTextClass(item.severity)}`}>
          {item.headline}
        </div>
        <div className="shrink-0 font-mono text-[10px] text-zinc-500">
          s{item.seasonNumber} · t{item.tick}
        </div>
      </div>
      <p className="mt-1 text-xs text-zinc-400">{item.body}</p>
      <div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-500">
        <span className={newsSourceChipClass(item.source)}>{newsSourceLabel(item.source)}</span>
        <span className="text-zinc-700">·</span>
        <span className="font-mono">{item.sourceKind}</span>
      </div>
    </article>
  );
}

function newsSeverityBorderClass(severity: NewsItem['severity']): string {
  switch (severity) {
    case 5:
      return 'border-rose-500';
    case 4:
      return 'border-amber-500';
    case 3:
      return 'border-zinc-400';
    case 2:
      return 'border-zinc-600';
    case 1:
      return 'border-zinc-700';
  }
}

function newsSeverityTextClass(severity: NewsItem['severity']): string {
  switch (severity) {
    case 5:
      return 'font-semibold text-rose-200';
    case 4:
      return 'font-semibold text-amber-200';
    case 3:
      return 'text-zinc-100';
    case 2:
      return 'text-zinc-300';
    case 1:
      return 'text-zinc-400';
  }
}

function newsSourceLabel(source: NewsSource): string {
  switch (source) {
    case 'national_insider':
      return 'national insider';
    case 'beat_writer':
      return 'beat writer';
    case 'anonymous_source':
      return 'anon source';
    case 'social_media':
      return 'social';
  }
}

function newsSourceChipClass(source: NewsSource): string {
  switch (source) {
    case 'national_insider':
      return 'rounded border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-sky-300';
    case 'beat_writer':
      return 'rounded border border-zinc-600/40 bg-zinc-700/20 px-1.5 py-0.5 text-zinc-300';
    case 'anonymous_source':
      return 'rounded border border-violet-500/40 bg-violet-500/10 px-1.5 py-0.5 text-violet-300';
    case 'social_media':
      return 'rounded border border-pink-500/40 bg-pink-500/10 px-1.5 py-0.5 text-pink-300';
  }
}

const TRANSACTION_KINDS = [
  ['release', 'releases'],
  ['fa-sign', 'FA signings'],
  ['re-sign', 're-signs'],
  ['restructure', 'restructures'],
  ['trade', 'trades'],
  ['ir-move', 'IR moves'],
  ['ps-promotion', 'PS promos'],
  ['contract-expiration', 'expirations'],
  ['cap-cut', 'cap cuts'],
  ['mood-shift', 'mood shifts'],
  ['trade-request', 'trade reqs'],
  ['locker-room-incident', 'incidents'],
] as const;

type TransactionKind = Transaction['kind'];

/** Kinds that carry a dollar-denominated price. Min-price filter only applies to these. */
const PRICE_KINDS: ReadonlySet<TransactionKind> = new Set([
  'fa-sign',
  're-sign',
  'restructure',
  'trade',
  'release',
  'cap-cut',
]);

function transactionTeams(entry: Transaction): TeamId[] {
  switch (entry.kind) {
    case 'trade':
      return [entry.teamAId, entry.teamBId];
    case 'ps-promotion':
      return entry.originTeamId === entry.signingTeamId
        ? [entry.originTeamId]
        : [entry.originTeamId, entry.signingTeamId];
    case 'release':
    case 'fa-sign':
    case 're-sign':
    case 'restructure':
    case 'ir-move':
    case 'contract-expiration':
    case 'cap-cut':
    case 'mood-shift':
    case 'trade-request':
    case 'locker-room-incident':
    case 'hc-fired':
    case 'gm-fired':
    case 'hc-hired':
    case 'gm-hired':
    case 'hc-interim':
    case 'roster-floor-violation':
    case 'contract-id-collision':
    case 'emergency-qb-game':
    case 'retirement-dead-money':
    case 'preseason-cut-dead-money':
    case 'franchise-tag':
    case 'cap-compliance-unclearable':
      return [entry.teamId];
  }
}

function transactionPlayers(entry: Transaction): PlayerId[] {
  switch (entry.kind) {
    case 'trade':
      return [...entry.playersAToB, ...entry.playersBToA];
    case 'locker-room-incident':
      return entry.involvedPlayerId
        ? [entry.playerId, entry.involvedPlayerId]
        : [entry.playerId];
    case 'release':
    case 'fa-sign':
    case 're-sign':
    case 'restructure':
    case 'ir-move':
    case 'ps-promotion':
    case 'contract-expiration':
    case 'cap-cut':
    case 'mood-shift':
    case 'trade-request':
    case 'contract-id-collision':
    case 'emergency-qb-game':
    case 'retirement-dead-money':
    case 'preseason-cut-dead-money':
    case 'franchise-tag':
      return [entry.playerId];
    case 'hc-fired':
    case 'gm-fired':
    case 'hc-hired':
    case 'gm-hired':
    case 'hc-interim':
    case 'roster-floor-violation':
    case 'cap-compliance-unclearable':
      return [];
  }
}

/**
 * Largest dollar dimension on the transaction (cap hit or dead money),
 * used for the min-price filter. Null for kinds without a price.
 */
function transactionPrice(entry: Transaction): number | null {
  switch (entry.kind) {
    case 'fa-sign':
      return entry.yearOneCapHit;
    case 'trade':
      return Math.max(entry.deadMoneyTeamA, entry.deadMoneyTeamB);
    case 'release':
    case 'retirement-dead-money':
    case 'preseason-cut-dead-money':
      return entry.deadMoney;
    case 'cap-cut':
      return Math.max(entry.deadMoney, entry.capSaving);
    case 'restructure':
      return entry.convertedAmount;
    case 'franchise-tag':
      return entry.tagNumber;
    default:
      return null;
  }
}

export function TransactionLogPanel({ league }: { league: LeagueState }) {
  const [expanded, setExpanded] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  // Filter state — empty Set means "no filter applied on this dimension."
  const [kindFilter, setKindFilter] = useState<Set<TransactionKind>>(new Set());
  const [teamFilter, setTeamFilter] = useState<Set<TeamId>>(new Set());
  const [positionFilter, setPositionFilter] = useState<Set<Position>>(new Set());
  const [minPriceMillionsInput, setMinPriceMillionsInput] = useState('');
  const [visibleCount, setVisibleCount] = useState(100);

  const minPriceMillions = Number.parseFloat(minPriceMillionsInput) || 0;
  const log = league.transactionLog;

  const kindCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const entry of log) counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
    return counts;
  }, [log]);

  const filtered = useMemo(() => {
    return log.filter((entry) => {
      if (kindFilter.size > 0 && !kindFilter.has(entry.kind)) return false;
      if (teamFilter.size > 0) {
        const teams = transactionTeams(entry);
        if (!teams.some((t) => teamFilter.has(t))) return false;
      }
      if (positionFilter.size > 0) {
        const players = transactionPlayers(entry);
        const matchedPos = players.some((pid) => {
          const pos = league.players[pid]?.position;
          return pos !== undefined && positionFilter.has(pos);
        });
        if (!matchedPos) return false;
      }
      if (minPriceMillions > 0) {
        if (!PRICE_KINDS.has(entry.kind)) return false;
        const price = transactionPrice(entry);
        if (price === null || price < minPriceMillions * 1e6) return false;
      }
      return true;
    });
  }, [log, kindFilter, teamFilter, positionFilter, minPriceMillions, league.players]);

  const recent = useMemo(() => {
    return [...filtered].slice(-visibleCount).reverse();
  }, [filtered, visibleCount]);

  const teamList = useMemo(
    () =>
      Object.values(league.teams)
        .map((t) => t.identity)
        .sort((a, b) => a.abbreviation.localeCompare(b.abbreviation)),
    [league.teams],
  );

  const anyFilter =
    kindFilter.size > 0 ||
    teamFilter.size > 0 ||
    positionFilter.size > 0 ||
    minPriceMillions > 0;

  function toggleKind(kind: TransactionKind) {
    setKindFilter((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
    setExpanded(true);
    setVisibleCount(100);
  }
  function toggleTeam(teamId: TeamId) {
    setTeamFilter((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
    setVisibleCount(100);
  }
  function togglePosition(pos: Position) {
    setPositionFilter((prev) => {
      const next = new Set(prev);
      if (next.has(pos)) next.delete(pos);
      else next.add(pos);
      return next;
    });
    setVisibleCount(100);
  }
  function resetAll() {
    setKindFilter(new Set());
    setTeamFilter(new Set());
    setPositionFilter(new Set());
    setMinPriceMillionsInput('');
    setVisibleCount(100);
  }

  if (log.length === 0) {
    return (
      <section className="mb-8 rounded border border-zinc-800 bg-zinc-900/40 p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Transaction log
        </h2>
        <p className="mt-2 text-xs text-zinc-600">
          Empty — fast-forward a season to see releases, FA signings, trades,
          IR moves, and PS promotions accumulate.
        </p>
      </section>
    );
  }

  return (
    <section className="mb-8 rounded border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Transaction log
        </h2>
        <div className="flex items-center gap-3">
          {anyFilter && (
            <button
              onClick={resetAll}
              className="text-xs text-zinc-400 hover:text-rose-300"
            >
              clear filters
            </button>
          )}
          <button
            onClick={() => setExpanded((x) => !x)}
            className="text-xs text-zinc-400 hover:text-zinc-200"
          >
            {expanded ? 'collapse' : 'expand'} ({log.length} total)
          </button>
        </div>
      </div>

      {/* Kind filter chips (replaces the old count grid). Always visible. */}
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {TRANSACTION_KINDS.map(([kind, label]) => {
          const active = kindFilter.has(kind);
          const count = kindCounts[kind] ?? 0;
          return (
            <button
              key={kind}
              onClick={() => toggleKind(kind)}
              className={`rounded border p-2 text-left transition-colors ${
                active
                  ? 'border-emerald-500/50 bg-emerald-500/10'
                  : 'border-zinc-800 bg-zinc-950/50 hover:border-zinc-700'
              } ${count === 0 ? 'opacity-40' : ''}`}
            >
              <div className={`text-xs ${active ? 'text-emerald-300' : 'text-zinc-500'}`}>
                {label}
              </div>
              <div className="font-mono text-sm">{count}</div>
            </button>
          );
        })}
      </div>

      {expanded && (
        <>
          {/* Team filter */}
          <div className="mt-3">
            <div className="mb-1 flex items-baseline justify-between">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                Teams {teamFilter.size > 0 && <span className="text-emerald-400">({teamFilter.size})</span>}
              </div>
              {teamFilter.size > 0 && (
                <button
                  onClick={() => setTeamFilter(new Set())}
                  className="text-[10px] text-zinc-500 hover:text-zinc-300"
                >
                  clear
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {teamList.map((t) => {
                const active = teamFilter.has(t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => toggleTeam(t.id)}
                    className={`rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                      active
                        ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
                        : 'border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:border-zinc-700'
                    }`}
                  >
                    {t.abbreviation}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Position filter */}
          <div className="mt-3">
            <div className="mb-1 flex items-baseline justify-between">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                Positions {positionFilter.size > 0 && <span className="text-emerald-400">({positionFilter.size})</span>}
              </div>
              {positionFilter.size > 0 && (
                <button
                  onClick={() => setPositionFilter(new Set())}
                  className="text-[10px] text-zinc-500 hover:text-zinc-300"
                >
                  clear
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {Object.values(Position).map((pos) => {
                const active = positionFilter.has(pos);
                return (
                  <button
                    key={pos}
                    onClick={() => togglePosition(pos)}
                    className={`rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                      active
                        ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
                        : 'border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:border-zinc-700'
                    }`}
                  >
                    {pos}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Min price filter */}
          <div className="mt-3 flex items-baseline gap-2">
            <label className="text-[10px] uppercase tracking-wider text-zinc-500">
              Min cap hit / dead money
            </label>
            <div className="flex items-center gap-1">
              <span className="text-xs text-zinc-500">$</span>
              <input
                type="number"
                min={0}
                step={0.5}
                value={minPriceMillionsInput}
                onChange={(e) => {
                  setMinPriceMillionsInput(e.target.value);
                  setVisibleCount(100);
                }}
                placeholder="0"
                className="w-20 rounded border border-zinc-800 bg-zinc-950 px-2 py-0.5 font-mono text-xs focus:border-emerald-500 focus:outline-none"
              />
              <span className="text-xs text-zinc-500">M</span>
              {minPriceMillions > 0 && (
                <span className="ml-2 text-[10px] text-zinc-600">
                  (hides mood-shift, IR, expirations, etc.)
                </span>
              )}
            </div>
          </div>

          {/* Result counter */}
          <div className="mt-3 flex items-baseline justify-between text-xs text-zinc-500">
            <div>
              Showing <span className="font-mono text-zinc-300">{recent.length}</span> of{' '}
              <span className="font-mono text-zinc-300">{filtered.length}</span>{' '}
              {anyFilter ? 'matching' : 'total'} transactions
              {anyFilter && filtered.length !== log.length && (
                <span className="text-zinc-600"> ({log.length - filtered.length} hidden by filters)</span>
              )}
            </div>
          </div>

          <div className="mt-2 max-h-80 overflow-y-auto rounded border border-zinc-800 bg-zinc-950/40">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-zinc-900/95 text-zinc-500">
                <tr>
                  <th className="px-2 py-1 font-medium">tick</th>
                  <th className="px-2 py-1 font-medium">season</th>
                  <th className="px-2 py-1 font-medium">kind</th>
                  <th className="px-2 py-1 font-medium">summary</th>
                </tr>
              </thead>
              <tbody>
                {recent.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-2 py-4 text-center text-zinc-600">
                      No transactions match the current filters.
                    </td>
                  </tr>
                )}
                {recent.map((entry, i) => {
                  const isExpandable = hasTransactionDetail(entry);
                  // Stable key across re-renders: tick + kind + index-within-log.
                  // Index from the full log identifies a single transaction even
                  // when filters / scrolling change the visible slice.
                  const rowKey = `${entry.tick}-${entry.kind}-${i}`;
                  const isOpen = expandedRow === rowKey;
                  return (
                    <React.Fragment key={rowKey}>
                      <tr
                        className={`border-t border-zinc-800/60 ${
                          isExpandable
                            ? 'cursor-pointer hover:bg-zinc-900/60'
                            : ''
                        } ${isOpen ? 'bg-zinc-900/40' : ''}`}
                        onClick={() => {
                          if (!isExpandable) return;
                          setExpandedRow(isOpen ? null : rowKey);
                        }}
                      >
                        <td className="px-2 py-1 font-mono text-zinc-500">
                          {isExpandable && (
                            <span className="mr-1 text-zinc-600">
                              {isOpen ? '▼' : '▶'}
                            </span>
                          )}
                          {entry.tick}
                        </td>
                        <td className="px-2 py-1 font-mono text-zinc-500">
                          s{entry.seasonNumber}
                        </td>
                        <td
                          className={`px-2 py-1 font-mono text-[10px] ${kindColor(entry.kind)}`}
                        >
                          {entry.kind}
                        </td>
                        <td className="px-2 py-1 text-zinc-300">
                          {summarizeTransaction(entry, league)}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="border-t border-zinc-800/60 bg-zinc-950/60">
                          <td colSpan={4} className="px-3 py-3">
                            <TransactionDetail entry={entry} league={league} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {filtered.length > recent.length && (
                  <tr className="border-t border-zinc-800/60 text-center">
                    <td colSpan={4} className="py-2">
                      <button
                        onClick={() => setVisibleCount((n) => n + 100)}
                        className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-300 hover:border-emerald-500/40 hover:text-emerald-300"
                      >
                        Show next 100 ({filtered.length - recent.length} remaining)
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function kindColor(kind: Transaction['kind']): string {
  switch (kind) {
    case 'release':
    case 'cap-cut':
    case 'retirement-dead-money':
    case 'preseason-cut-dead-money':
      return 'text-rose-400';
    case 'fa-sign':
    case 'ps-promotion':
      return 'text-emerald-400';
    case 're-sign':
    case 'franchise-tag':
      return 'text-cyan-400';
    case 'restructure':
      return 'text-teal-400';
    case 'trade':
      return 'text-amber-400';
    case 'ir-move':
      return 'text-orange-400';
    case 'mood-shift':
      return 'text-violet-400';
    case 'trade-request':
      return 'text-fuchsia-400';
    case 'locker-room-incident':
      return 'text-pink-400';
    case 'contract-expiration':
      return 'text-zinc-500';
    case 'hc-fired':
    case 'gm-fired':
      return 'text-red-400';
    case 'hc-hired':
    case 'gm-hired':
      return 'text-sky-400';
    case 'hc-interim':
      return 'text-amber-400';
    case 'roster-floor-violation':
    case 'contract-id-collision':
    case 'emergency-qb-game':
    case 'cap-compliance-unclearable':
      return 'text-red-500';
  }
}

function summarizeTransaction(entry: Transaction, league: LeagueState): string {
  const teamLabel = (id: TeamId): string => league.teams[id]?.identity.abbreviation ?? id;
  const playerLabel = (id: PlayerId): string => {
    const p = league.players[id];
    return p ? `${p.firstName.charAt(0)}. ${p.lastName} (${p.position})` : id;
  };
  switch (entry.kind) {
    case 'release':
      return `${teamLabel(entry.teamId)} released ${playerLabel(entry.playerId)} · dead $${(entry.deadMoney / 1e6).toFixed(1)}M`;
    case 'fa-sign':
      return `${teamLabel(entry.teamId)} signed ${playerLabel(entry.playerId)} · cap $${(entry.yearOneCapHit / 1e6).toFixed(1)}M${entry.marketContract ? ' (FA market)' : ' (vet-min)'}`;
    case 're-sign':
      return `${teamLabel(entry.teamId)} re-signed ${playerLabel(entry.playerId)} · cap $${(entry.yearOneCapHit / 1e6).toFixed(1)}M × ${entry.years}yr (kept off the market)`;
    case 'restructure':
      return `${teamLabel(entry.teamId)} restructured ${playerLabel(entry.playerId)} · converted $${(entry.convertedAmount / 1e6).toFixed(1)}M base → bonus, freed $${(entry.capRelief / 1e6).toFixed(1)}M over ${entry.years}yr`;
    case 'trade':
      return `${teamLabel(entry.teamAId)} ↔ ${teamLabel(entry.teamBId)} · ${entry.playersAToB.length}+${entry.playersBToA.length} players`;
    case 'ir-move':
      return `${teamLabel(entry.teamId)} placed ${playerLabel(entry.playerId)} on IR · ${entry.injurySeverity} ${entry.weeksOut}wk`;
    case 'ps-promotion':
      return entry.ownPromotion
        ? `${teamLabel(entry.signingTeamId)} promoted own PS ${playerLabel(entry.playerId)}`
        : `${teamLabel(entry.signingTeamId)} poached ${playerLabel(entry.playerId)} from ${teamLabel(entry.originTeamId)}`;
    case 'contract-expiration':
      return `${teamLabel(entry.teamId)} ${entry.fromActiveRoster ? 'roster' : 'PS'} contract expired for ${playerLabel(entry.playerId)}`;
    case 'cap-cut':
      return `${teamLabel(entry.teamId)} cap-cut ${playerLabel(entry.playerId)} · save $${(entry.capSaving / 1e6).toFixed(1)}M / dead $${(entry.deadMoney / 1e6).toFixed(1)}M`;
    case 'mood-shift':
      return `${teamLabel(entry.teamId)} · ${playerLabel(entry.playerId)} ${entry.fromBucket} → ${entry.toBucket} (mood ${Math.round(entry.mood)})`;
    case 'trade-request':
      return entry.state === 'requested'
        ? `${teamLabel(entry.teamId)} · ${entry.tier} ${playerLabel(entry.playerId)} demanded a trade (mood ${Math.round(entry.mood)})`
        : `${teamLabel(entry.teamId)} · ${playerLabel(entry.playerId)} withdrew trade demand (mood ${Math.round(entry.mood)})`;
    case 'locker-room-incident': {
      const leak = entry.mediaLeak ? '📰 ' : '';
      const delta = entry.moodDelta >= 0 ? `+${entry.moodDelta.toFixed(1)}` : entry.moodDelta.toFixed(1);
      return `${leak}${teamLabel(entry.teamId)} · ${playerLabel(entry.playerId)} ${formatIncidentFlavor(entry.flavor)} (mood ${delta})`;
    }
    case 'hc-fired':
      return `${teamLabel(entry.teamId)} fired HC ${league.coaches[entry.coachId]?.name ?? entry.coachId}${entry.inSeason ? ' MIDSEASON' : ''} · ${entry.seasonsServed}yr ${entry.wins}-${entry.losses}${entry.ties > 0 ? `-${entry.ties}` : ''}${entry.jointWithGm ? ' · CLEAN HOUSE' : ''}`;
    case 'gm-fired':
      return `${teamLabel(entry.teamId)} fired GM ${league.gms[entry.gmId]?.name ?? entry.gmId}${entry.inSeason ? ' MIDSEASON' : ''} · ${entry.seasonsServed}yr ${entry.wins}-${entry.losses}${entry.ties > 0 ? `-${entry.ties}` : ''}${entry.jointWithHc ? ' · with HC' : ''}`;
    case 'hc-hired':
      return `${teamLabel(entry.teamId)} hired HC ${league.coaches[entry.coachId]?.name ?? entry.coachId}${entry.promotedInterim ? ' (interim promoted)' : entry.retread ? ' (retread)' : ''}`;
    case 'gm-hired':
      return `${teamLabel(entry.teamId)} hired GM ${league.gms[entry.gmId]?.name ?? entry.gmId}${entry.retread ? ' (retread)' : ''}`;
    case 'hc-interim':
      return `${teamLabel(entry.teamId)} named ${league.coaches[entry.coachId]?.name ?? entry.coachId} interim HC (week ${entry.weekIndex + 1})`;
    case 'roster-floor-violation':
      return `⚠ ${teamLabel(entry.teamId)} ROSTER FLOOR VIOLATION · ${entry.rosterSize}/53, unmet $${(entry.unmetNeed / 1e6).toFixed(1)}M`;
    case 'contract-id-collision':
      return `⚠ ${teamLabel(entry.teamId)} CONTRACT ID COLLISION · ${playerLabel(entry.playerId)} · ${entry.attemptedId} → ${entry.resolvedId} (uniquified)`;
    case 'emergency-qb-game':
      return `⚠ ${teamLabel(entry.teamId)} fielded ${playerLabel(entry.playerId)} as EMERGENCY QB (no available passer)`;
    case 'retirement-dead-money':
      return `${teamLabel(entry.teamId)} · ${playerLabel(entry.playerId)} retired · dead $${(entry.deadMoney / 1e6).toFixed(1)}M`;
    case 'preseason-cut-dead-money':
      return `${teamLabel(entry.teamId)} cut ${playerLabel(entry.playerId)} in the preseason trim · dead $${(entry.deadMoney / 1e6).toFixed(1)}M`;
    case 'franchise-tag':
      return `${teamLabel(entry.teamId)} franchise-tagged ${playerLabel(entry.playerId)} · $${(entry.tagNumber / 1e6).toFixed(1)}M/1yr (${entry.formulaBranch === 'position-average' ? 'position market' : '120% prior salary'})`;
    case 'cap-compliance-unclearable':
      return `⚠ ${teamLabel(entry.teamId)} CAP COMPLIANCE GAVE UP (${entry.reason === 'floor' ? 'at 53-man floor' : 'unclearable'}) · ${entry.rosterSize} players, $${(entry.overage / 1e6).toFixed(2)}M over`;
  }
}

function hasTransactionDetail(entry: Transaction): boolean {
  if (entry.kind === 'fa-sign') return true;
  // Trades only expand if the v0.24 metadata was persisted — pre-v0.24
  // trade transactions still render as a flat row.
  if (entry.kind === 'trade') {
    return entry.teamAValue !== undefined || entry.teamBValue !== undefined;
  }
  return false;
}

function TransactionDetail({
  entry,
  league,
}: {
  entry: Transaction;
  league: LeagueState;
}) {
  if (entry.kind === 'fa-sign') {
    return <FaSignDetail entry={entry} league={league} />;
  }
  if (entry.kind === 'trade') {
    return <TradeDetail entry={entry} league={league} />;
  }
  return null;
}

function FaSignDetail({
  entry,
  league,
}: {
  entry: Extract<Transaction, { kind: 'fa-sign' }>;
  league: LeagueState;
}) {
  const player = league.players[entry.playerId];
  const team = league.teams[entry.teamId];
  const contract = league.contracts[entry.contractId];
  const bidders = entry.bidders ?? [];
  const phaseLabel = formatPhaseLabel(entry.phaseAtSigning, entry.marketContract);
  const winningBidder = bidders.find((b) => b.teamId === entry.teamId) ?? null;

  return (
    <div className="space-y-3 text-xs">
      <div className="flex flex-wrap items-baseline gap-3">
        <div className="font-semibold text-zinc-200">
          {team?.identity.abbreviation ?? entry.teamId} signs{' '}
          {player ? `${player.firstName} ${player.lastName}` : entry.playerId}
        </div>
        <div className="text-zinc-500">
          {player ? `${player.tier} ${player.position} · age ${ageOfPlayer(player, league.tick)}` : ''}
        </div>
        <div className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
          {phaseLabel}
        </div>
      </div>

      {/* Contract terms */}
      {contract && (
        <div className="rounded border border-zinc-800 bg-zinc-950/60 p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
            Contract
          </div>
          <ContractTermsTable contract={contract} />
        </div>
      )}

      {/* Bidders */}
      {bidders.length > 0 ? (
        <div className="rounded border border-zinc-800 bg-zinc-950/60 p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
            Bidders ({bidders.length}) — sorted by perceived bid
          </div>
          <BiddersTable
            bidders={bidders}
            league={league}
            winnerTeamId={entry.teamId}
          />
        </div>
      ) : (
        <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2 text-zinc-500">
          No auction took place — this was a {entry.marketContract ? 'direct' : 'vet-min street'} signing.
        </div>
      )}

      {/* Why this team won */}
      {winningBidder && bidders.length > 1 && (
        <WinnerExplanation
          winner={winningBidder}
          bidders={bidders}
          league={league}
        />
      )}
    </div>
  );
}

function TradeDetail({
  entry,
  league,
}: {
  entry: Extract<Transaction, { kind: 'trade' }>;
  league: LeagueState;
}) {
  const teamA = league.teams[entry.teamAId];
  const teamB = league.teams[entry.teamBId];
  const initiator = entry.initiatorTeamId ? league.teams[entry.initiatorTeamId] : null;
  const sourceLabel = formatTradeSourceLabel(entry.source);

  return (
    <div className="space-y-3 text-xs">
      <div className="flex flex-wrap items-baseline gap-3">
        <div className="font-semibold text-zinc-200">
          {teamA?.identity.abbreviation ?? entry.teamAId} ↔{' '}
          {teamB?.identity.abbreviation ?? entry.teamBId}
        </div>
        {sourceLabel && (
          <div className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
            {sourceLabel}
          </div>
        )}
        {initiator && (
          <div className="text-zinc-500">
            initiated by <span className="font-mono text-zinc-300">{initiator.identity.abbreviation}</span>
          </div>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <TradeSideBreakdown
          team={teamA}
          fallbackId={entry.teamAId}
          deadMoney={entry.deadMoneyTeamA}
          evaluation={entry.teamAValue}
          league={league}
        />
        <TradeSideBreakdown
          team={teamB}
          fallbackId={entry.teamBId}
          deadMoney={entry.deadMoneyTeamB}
          evaluation={entry.teamBValue}
          league={league}
        />
      </div>

      {entry.alternativeCandidates && entry.alternativeCandidates.length > 0 && (
        <AlternativeCandidatesTable
          alternatives={entry.alternativeCandidates}
          league={league}
        />
      )}
    </div>
  );
}

function AlternativeCandidatesTable({
  alternatives,
  league,
}: {
  alternatives: NonNullable<
    Extract<Transaction, { kind: 'trade' }>['alternativeCandidates']
  >;
  league: LeagueState;
}) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
        {alternatives.length} other trade{alternatives.length === 1 ? '' : 's'} considered
      </div>
      <table className="w-full text-[10px]">
        <thead className="text-zinc-500">
          <tr>
            <th className="px-1 py-0.5 text-left font-medium">buyer</th>
            <th className="px-1 py-0.5 text-left font-medium">seller</th>
            <th className="px-1 py-0.5 text-left font-medium">acquires</th>
            <th className="px-1 py-0.5 text-left font-medium">return</th>
            <th className="px-1 py-0.5 text-right font-medium">buyer net</th>
            <th className="px-1 py-0.5 text-right font-medium">seller net</th>
            <th className="px-1 py-0.5 text-left font-medium">why</th>
          </tr>
        </thead>
        <tbody>
          {alternatives.map((alt, i) => {
            const buyer = league.teams[alt.buyerId];
            const seller = league.teams[alt.sellerId];
            const acquire = league.players[alt.acquireId as PlayerId];
            const ret = league.players[alt.returnId as PlayerId];
            return (
              <tr key={i} className="border-t border-zinc-800/50">
                <td className="px-1 py-0.5 font-mono text-zinc-300">
                  {buyer?.identity.abbreviation ?? alt.buyerId}
                </td>
                <td className="px-1 py-0.5 font-mono text-zinc-300">
                  {seller?.identity.abbreviation ?? alt.sellerId}
                </td>
                <td className="px-1 py-0.5">
                  {acquire
                    ? `${acquire.firstName.charAt(0)}. ${acquire.lastName} (${acquire.tier} ${acquire.position})`
                    : alt.acquireId}
                </td>
                <td className="px-1 py-0.5 text-zinc-500">
                  {ret
                    ? `${ret.firstName.charAt(0)}. ${ret.lastName} (${ret.tier} ${ret.position})`
                    : alt.returnId}
                </td>
                <td
                  className={`px-1 py-0.5 text-right font-mono ${
                    alt.buyerNetValue >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {alt.buyerNetValue >= 0 ? '+' : ''}${alt.buyerNetValue.toFixed(1)}M
                </td>
                <td
                  className={`px-1 py-0.5 text-right font-mono ${
                    alt.sellerNetValue >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {alt.sellerNetValue >= 0 ? '+' : ''}${alt.sellerNetValue.toFixed(1)}M
                </td>
                <td className="px-1 py-0.5 text-zinc-500">
                  {formatAlternativeReason(alt.reason)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatAlternativeReason(reason: string): string {
  switch (reason) {
    case 'buyer-used':
      return 'buyer in other deal';
    case 'seller-used':
      return 'seller in other deal';
    case 'lower-priority':
      return 'lost out';
    case 'failed-gate':
      return 'cap/state shift';
    default:
      return reason;
  }
}

function formatTradeSourceLabel(source: string | undefined): string | null {
  switch (source) {
    case 'proactive-need':
      return 'Proactive — positional need';
    case 'proactive-fit-swap':
      return 'Proactive — scheme-fit swap';
    case 'request-driven':
      return 'Player trade request';
    case 'manual':
      return 'Manual';
    default:
      return null;
  }
}

type TradeValueEvaluation = NonNullable<
  Extract<Transaction, { kind: 'trade' }>['teamAValue']
>;

function TradeSideBreakdown({
  team,
  fallbackId,
  deadMoney,
  evaluation,
  league,
}: {
  team: TeamState | undefined;
  fallbackId: TeamId;
  deadMoney: number;
  evaluation: TradeValueEvaluation | undefined;
  league: LeagueState;
}) {
  const abbr = team?.identity.abbreviation ?? fallbackId;
  const net = evaluation?.netValue ?? 0;
  const netClass =
    net > 0 ? 'text-emerald-300' : net < 0 ? 'text-rose-300' : 'text-zinc-400';

  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/60 p-2">
      <div className="mb-1 flex items-baseline justify-between">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500">
          {abbr} perspective
        </div>
        {evaluation && (
          <div className={`font-mono text-xs ${netClass}`}>
            net {net >= 0 ? '+' : ''}${net.toFixed(1)}M
          </div>
        )}
      </div>

      {evaluation ? (
        <>
          <TradeAssetList
            label="Receiving"
            assets={evaluation.received}
            league={league}
          />
          <TradeAssetList
            label="Giving up"
            assets={evaluation.given}
            league={league}
          />
        </>
      ) : (
        <div className="text-zinc-600">
          No 5-factor evaluation recorded (pre-v0.24 trade).
        </div>
      )}

      <div className="mt-1 text-[10px] text-zinc-500">
        Dead-money charge: ${(deadMoney / 1e6).toFixed(2)}M
      </div>
    </div>
  );
}

function TradeAssetList({
  label,
  assets,
  league,
}: {
  label: string;
  assets: readonly { playerId: string; breakdown: NonNullable<TradeValueEvaluation>['received'][number]['breakdown'] }[];
  league: LeagueState;
}) {
  if (assets.length === 0) return null;
  return (
    <div className="mt-1">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <div className="mt-0.5 space-y-1">
        {assets.map((a) => {
          const player = league.players[a.playerId as PlayerId];
          const f = a.breakdown.factors;
          return (
            <div key={a.playerId} className="rounded border border-zinc-800/60 bg-zinc-900/30 p-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <div className="font-medium text-zinc-200">
                  {player
                    ? `${player.firstName.charAt(0)}. ${player.lastName} (${player.tier} ${player.position})`
                    : a.playerId}
                </div>
                <div className="font-mono text-xs text-zinc-300">
                  ${a.breakdown.total.toFixed(1)}M
                </div>
              </div>
              <div className="mt-1 grid grid-cols-1 gap-x-3 gap-y-0.5 text-[10px] text-zinc-500 sm:grid-cols-2">
                <FactorLine factor={f.ability} label="Ability" />
                <FactorLine factor={f.schemeFit} label="Scheme fit" />
                <FactorLine factor={f.ageContract} label="Age/contract" />
                <FactorLine factor={f.positional} label="Positional" />
                <FactorLine factor={f.timing} label="Timing" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FactorLine({
  factor,
  label,
}: {
  factor: { multiplier: number; rationale: string };
  label: string;
}) {
  return (
    <div className="flex items-baseline gap-1 truncate">
      <span className="text-zinc-600">{label}</span>
      <span className="font-mono text-zinc-400">×{factor.multiplier.toFixed(2)}</span>
      <span className="truncate text-zinc-500">{factor.rationale}</span>
    </div>
  );
}
function BiddersTable({
  bidders,
  league,
  winnerTeamId,
}: {
  bidders: readonly NonNullable<
    Extract<Transaction, { kind: 'fa-sign' }>['bidders']
  >[number][];
  league: LeagueState;
  winnerTeamId: TeamId;
}) {
  return (
    <table className="w-full text-[10px]">
      <thead className="text-zinc-500">
        <tr>
          <th className="px-1 py-0.5 text-left font-medium">team</th>
          <th
            className="px-1 py-0.5 text-right font-medium"
            title="Final dollar bid. Includes any watch-list boost — coveted players cost more."
          >
            cash bid
          </th>
          <th className="px-1 py-0.5 text-right font-medium">×pref</th>
          <th
            className="px-1 py-0.5 text-right font-medium"
            title="cash × preference. Watch-list boost lives inside cash, not as a separate factor."
          >
            =perceived
          </th>
          <th
            className="px-1 py-0.5 text-left font-medium"
            title="Watch-list status: how aggressively this team's scouting pipeline elevated its bid. Empty = player not on this team's list."
          >
            watch
          </th>
          <th className="px-1 py-0.5 text-right font-medium">cap room</th>
        </tr>
      </thead>
      <tbody>
        {bidders.map((b) => {
          const team = league.teams[b.teamId];
          const isWinner = b.teamId === winnerTeamId;
          const reasonDef = b.watchListReason ? WATCH_LIST_REASON[b.watchListReason] : null;
          const watchBoostDollars =
            b.watchListMultiplier > 1 ? b.cashValuation - b.cashValuationBaseline : 0;
          const cashBoostTitle =
            b.watchListMultiplier > 1
              ? `Includes ×${b.watchListMultiplier.toFixed(3)} watch-list boost (+$${(watchBoostDollars / 1e6).toFixed(2)}M over baseline $${(b.cashValuationBaseline / 1e6).toFixed(2)}M)`
              : `Cash bid (no watch-list boost)`;
          return (
            <tr
              key={b.teamId}
              className={`border-t border-zinc-800/50 ${
                isWinner ? 'bg-emerald-500/10' : ''
              }`}
            >
              <td className="px-1 py-0.5 font-mono">
                {isWinner && <span className="mr-1 text-emerald-400">★</span>}
                {team?.identity.abbreviation ?? b.teamId}
              </td>
              <td
                className={`px-1 py-0.5 text-right font-mono ${
                  b.watchListMultiplier > 1 ? 'text-emerald-300' : ''
                }`}
                title={cashBoostTitle}
              >
                ${(b.cashValuation / 1e6).toFixed(2)}M
                {b.watchListMultiplier > 1 && (
                  <span className="ml-1 text-[9px] text-emerald-400/70">
                    (+{((b.watchListMultiplier - 1) * 100).toFixed(0)}%)
                  </span>
                )}
              </td>
              <td className="px-1 py-0.5 text-right font-mono">
                ×{b.preferenceMultiplier.toFixed(3)}
              </td>
              <td className="px-1 py-0.5 text-right font-mono text-zinc-300">
                ${(b.perceivedBid / 1e6).toFixed(2)}M
              </td>
              <td className="px-1 py-0.5">
                {reasonDef && b.watchListPriority !== null ? (
                  <span
                    title={`${reasonDef.description} · priority ${b.watchListPriority.toFixed(1)}`}
                    className={`rounded border px-1 py-0.5 text-[9px] font-mono uppercase tracking-wider ${reasonDef.className}`}
                  >
                    {reasonDef.label}
                  </span>
                ) : (
                  <span className="text-zinc-700">—</span>
                )}
              </td>
              <td className="px-1 py-0.5 text-right font-mono text-zinc-500">
                ${(b.capRoomAtTime / 1e6).toFixed(1)}M
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function WinnerExplanation({
  winner,
  bidders,
  league,
}: {
  winner: NonNullable<
    Extract<Transaction, { kind: 'fa-sign' }>['bidders']
  >[number];
  bidders: readonly NonNullable<
    Extract<Transaction, { kind: 'fa-sign' }>['bidders']
  >[number][];
  league: LeagueState;
}) {
  const runnerUp = bidders.find((b) => b.teamId !== winner.teamId);
  const factors = winner.preferenceFactors;
  const labelParts: string[] = [];
  if (factors.archetypeLabel) {
    labelParts.push(
      `${factors.archetypeLabel} ${formatSigned(factors.archetypeMarket)}`,
    );
  }
  for (const l of factors.ownerQuirkLabels) labelParts.push(l);
  for (const l of factors.hcQuirkLabels) labelParts.push(l);
  if (Math.abs(factors.hcPlayerRelationships) > 0.001) {
    labelParts.push(
      `HC relationships ${formatSigned(factors.hcPlayerRelationships)}`,
    );
  }
  if (factors.startingOpportunityLabel) {
    labelParts.push(
      `${factors.startingOpportunityLabel} ${formatSigned(factors.startingOpportunity)}`,
    );
  }
  const winnerTeam = league.teams[winner.teamId];
  const winnerAbbr = winnerTeam?.identity.abbreviation ?? winner.teamId;

  // Compare to runner-up to highlight why the winner edged them out.
  const cashEdge = runnerUp ? winner.cashValuation - runnerUp.cashValuation : 0;
  const prefEdge = runnerUp
    ? winner.preferenceMultiplier - runnerUp.preferenceMultiplier
    : 0;
  const watchBoostDollars =
    winner.watchListMultiplier > 1 ? winner.cashValuation - winner.cashValuationBaseline : 0;

  const watchReasonDef = winner.watchListReason
    ? WATCH_LIST_REASON[winner.watchListReason]
    : null;

  // Hypothetical: strip the winner's watch boost (reduce their cash to
  // baseline) — would they still beat the runner-up's perceivedBid? If
  // not, watch boost materially changed the outcome.
  const watchListFlipped =
    runnerUp !== undefined &&
    winner.watchListMultiplier > 1 &&
    winner.cashValuationBaseline * winner.preferenceMultiplier <
      runnerUp.cashValuation * runnerUp.preferenceMultiplier;

  return (
    <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-2">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-emerald-400/80">
        Why {winnerAbbr} won
      </div>
      <div className="space-y-1 text-zinc-300">
        <div>
          Preference multiplier{' '}
          <span className="font-mono text-zinc-200">
            ×{winner.preferenceMultiplier.toFixed(3)}
          </span>
          {labelParts.length > 0 ? (
            <>: {labelParts.join(', ')}</>
          ) : (
            ' (neutral — no specific factors fired)'
          )}
        </div>
        {winner.watchListPriority !== null && watchReasonDef && (
          <div>
            Watch-list boost: cash elevated{' '}
            <span className="font-mono text-zinc-200">
              ${(winner.cashValuationBaseline / 1e6).toFixed(2)}M → $
              {(winner.cashValuation / 1e6).toFixed(2)}M
            </span>{' '}
            (+${(watchBoostDollars / 1e6).toFixed(2)}M,{' '}
            ×{winner.watchListMultiplier.toFixed(3)}){' '}
            <span
              title={watchReasonDef.description}
              className={`rounded border px-1 py-0.5 text-[9px] font-mono uppercase tracking-wider ${watchReasonDef.className}`}
            >
              {watchReasonDef.label}
            </span>
            <span className="ml-1 text-zinc-500">
              priority {winner.watchListPriority.toFixed(1)}
            </span>
          </div>
        )}
        {watchListFlipped && (
          <div className="text-emerald-300/80">
            ⤷ Without the watch-list boost the runner-up would have outbid {winnerAbbr}.
          </div>
        )}
        {runnerUp && (
          <div className="text-zinc-500">
            vs runner-up {league.teams[runnerUp.teamId]?.identity.abbreviation ?? runnerUp.teamId}:{' '}
            cash {cashEdge >= 0 ? '+' : ''}${(cashEdge / 1e6).toFixed(2)}M,{' '}
            preference {prefEdge >= 0 ? '+' : ''}{prefEdge.toFixed(3)}
          </div>
        )}
      </div>
    </div>
  );
}

function formatSigned(n: number): string {
  return n >= 0 ? `+${n.toFixed(3)}` : n.toFixed(3);
}

function formatPhaseLabel(
  phase: string | undefined,
  marketContract: boolean,
): string {
  if (!phase) return marketContract ? 'FA market' : 'vet-min';
  switch (phase) {
    case 'OFFSEASON_PRE_FA':
    case 'FREE_AGENCY':
      return 'Offseason FA market';
    case 'REGULAR_SEASON':
      return marketContract ? 'In-season signing' : 'In-season vet-min';
    case 'PLAYOFFS':
      return 'Playoff signing';
    default:
      return phase.toLowerCase().replace(/_/g, ' ');
  }
}

function formatIncidentFlavor(flavor: LockerRoomIncidentFlavor): string {
  switch (flavor) {
    case 'media_blowup':
      return 'media blow-up';
    case 'practice_conflict':
      return 'practice conflict';
    case 'social_media_post':
      return 'social media post';
    case 'coach_dispute':
      return 'coach dispute';
    case 'off_field_issue':
      return 'off-field issue';
    case 'positive_moment':
      return 'positive moment';
  }
}
