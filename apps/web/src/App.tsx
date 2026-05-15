import React, { useMemo, useState } from 'react';
import {
  createLeague,
  getArchetypeById,
  schemeFitForPlayer,
  summarizeTeamCap,
  currentCapHit,
  simulateSeason,
  advanceSeason,
  computeRecords,
  divisionStandings,
  playoffSeeds,
  winPct,
  ageOfPlayer,
  seasonStatsForLeague,
  seasonAwards,
  freeAgents,
  releasePlayer,
  deadMoneyOnPreJune1Release,
  executeTrade,
  signingBonusProrationPerYear,
  moodBucket,
  teamChemistry,
  deriveNewsFeed,
} from '@gmsim/engine';
import type {
  TeamRecord,
  SeasonAwards,
  MoodBucket,
  ChemistryBucket,
  NewsItem,
  NewsSource,
} from '@gmsim/engine';
import type { MoodArchetype, LockerRoomIncidentFlavor } from '@gmsim/engine/types';
import type {
  LeagueState,
  TeamState,
  TeamPersonality,
  TeamSeasonRecord,
  Player,
  PlayerId,
  PlayerSeasonStats,
  CareerAward,
  TeamId,
  Contract,
  Transaction,
} from '@gmsim/engine/types';
import { Division, PositionGroup, Position, Conference } from '@gmsim/engine/types';

/**
 * Phase 1 dev inspector. NOT player-facing — this surface intentionally
 * exposes raw spectrum scores, archetype labels, and skill ratings so
 * we can verify the generation pipeline is producing varied, plausible
 * leagues.
 *
 * The player-facing UI (Phase 4 — Scouting Report UI/UX) will replace
 * this with North Star-compliant attributed observations. See
 * `docs/NORTH_STAR.md`.
 */
const DEFAULT_SEED = 'phase-2-season';

export function App() {
  const [seedDraft, setSeedDraft] = useState(DEFAULT_SEED);
  const [league, setLeague] = useState<LeagueState>(() => createLeague({ seed: DEFAULT_SEED }));
  const [selectedTeamId, setSelectedTeamId] = useState<TeamId | null>(null);

  const seasonSimmed = league.schedule !== null;
  const records = useMemo(() => (seasonSimmed ? computeRecords(league) : null), [league, seasonSimmed]);
  const seasonStats = useMemo(
    () => (seasonSimmed ? seasonStatsForLeague(league) : null),
    [league, seasonSimmed],
  );
  const awards = useMemo(
    () => (seasonSimmed ? seasonAwards(league) : null),
    [league, seasonSimmed],
  );
  const teams = Object.values(league.teams).sort((a, b) =>
    a.identity.division === b.identity.division
      ? a.identity.location.localeCompare(b.identity.location)
      : a.identity.division.localeCompare(b.identity.division),
  );

  const divisions = Object.values(Division);
  const selectedTeam = selectedTeamId ? league.teams[selectedTeamId] : null;

  function reroll() {
    setLeague(createLeague({ seed: seedDraft || 'default' }));
    setSelectedTeamId(null);
  }

  function simulate() {
    setLeague(simulateSeason(league));
  }

  function advance() {
    setLeague(advanceSeason(league));
  }

  /**
   * Run N full year-cycles. Each iteration ensures the current season
   * is simulated (if not already), then advances. We reverse the order
   * on the last iteration so the user lands on a state with the most
   * recent season's schedule populated and results visible.
   */
  function fastForward(n: number) {
    let l = league;
    for (let i = 0; i < n; i++) {
      if (l.schedule) l = advanceSeason(l);
      l = simulateSeason(l);
    }
    setLeague(l);
  }

  return (
    <main className="min-h-screen p-6 lg:p-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            GMSim{' '}
            <span className="ml-2 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 align-middle font-mono text-xs text-zinc-400">
              v{__APP_VERSION__}
            </span>
            <span className="ml-2 text-base font-normal text-zinc-500">
              Season {league.seasonNumber}
              {seasonSimmed ? ' (in progress)' : ' (preseason)'}
            </span>
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Phase 2 dev inspector — exposes raw engine state for verification.
            Not player-facing.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              reroll();
            }}
          >
            <label className="text-xs uppercase tracking-wide text-zinc-500" htmlFor="seed">
              seed
            </label>
            <input
              id="seed"
              value={seedDraft}
              onChange={(e) => setSeedDraft(e.target.value)}
              className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 font-mono text-sm focus:border-emerald-500 focus:outline-none"
            />
            <button
              type="submit"
              className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-sm text-emerald-300 hover:bg-emerald-500/20"
            >
              Re-roll
            </button>
          </form>
          {seasonSimmed ? (
            <button
              onClick={advance}
              className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-sm text-amber-300 hover:bg-amber-500/20"
            >
              Advance to Year {league.seasonNumber + 1}
            </button>
          ) : (
            <button
              onClick={simulate}
              className="rounded border border-sky-500/40 bg-sky-500/10 px-3 py-1 text-sm text-sky-300 hover:bg-sky-500/20"
            >
              Simulate Season {league.seasonNumber}
            </button>
          )}
          <div className="flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900/40 px-2 py-1 text-xs text-zinc-500">
            <span className="uppercase tracking-wide">skip</span>
            {[1, 5, 10].map((n) => (
              <button
                key={n}
                onClick={() => fastForward(n)}
                className="rounded border border-zinc-700 bg-zinc-950 px-2 py-0.5 font-mono text-zinc-300 hover:border-emerald-500/40 hover:text-emerald-300"
              >
                +{n}y
              </button>
            ))}
          </div>
        </div>
      </header>

      <LeagueOverview league={league} />

      <FreeAgentPoolPanel league={league} />

      <NewsFeedPanel league={league} />

      <TransactionLogPanel league={league} />

      {seasonSimmed && records && <SeasonResultsView league={league} records={records} />}

      {seasonSimmed && seasonStats && (
        <SeasonLeadersView league={league} stats={seasonStats} />
      )}

      {seasonSimmed && awards && <AwardsView league={league} awards={awards} />}

      {selectedTeam && (
        <TeamDetail
          team={selectedTeam}
          league={league}
          records={records}
          seasonStats={seasonStats}
          onClose={() => setSelectedTeamId(null)}
          onLeagueChange={setLeague}
        />
      )}

      {divisions.map((division) => (
        <DivisionSection
          key={division}
          division={division}
          league={league}
          records={records}
          teams={teams.filter((t) => t.identity.division === division)}
          selectedTeamId={selectedTeamId}
          onSelect={setSelectedTeamId}
        />
      ))}
    </main>
  );
}

/**
 * A team is flagged as a "dynasty" in the inspector when it has 3+
 * playoff appearances in its history, or 2+ Super Bowl wins. Loose
 * heuristic — just a visual cue for spotting emergent dynasties when
 * fast-forwarding multiple seasons.
 */
function dynastyBadge(history: readonly TeamSeasonRecord[]): string | null {
  const sbWins = history.filter((r) => r.championshipResult === 'won_super_bowl').length;
  if (sbWins >= 2) return `${sbWins}× champ`;
  const playoffApps = history.filter((r) => r.madePlayoffs).length;
  if (playoffApps >= 3) return `${playoffApps}× playoffs`;
  return null;
}

function LeagueOverview({ league }: { league: LeagueState }) {
  const tps = Object.values(league.teamPersonalities);
  const summary = (key: keyof TeamPersonality) => {
    const values = tps.map((tp) => tp[key]);
    const high = values.filter((v) => v >= 9).length;
    const low = values.filter((v) => v <= 2).length;
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    return { high, low, avg };
  };
  const dims: { key: keyof TeamPersonality; label: string }[] = [
    { key: 'riskTolerance', label: 'Risk' },
    { key: 'analyticsOrientation', label: 'Analytics' },
    { key: 'patienceLevel', label: 'Patience' },
    { key: 'financialAggressiveness', label: 'Financial' },
    { key: 'championshipUrgency', label: 'Urgency' },
    { key: 'organizationalStability', label: 'Stability' },
  ];

  const playerCount = Object.keys(league.players).length;

  return (
    <section className="mb-8 rounded border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          League distribution (Team Personality)
        </h2>
        <span className="text-xs text-zinc-600">{playerCount} players generated</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {dims.map(({ key, label }) => {
          const s = summary(key);
          return (
            <div key={key} className="rounded border border-zinc-800 bg-zinc-950/50 p-2">
              <div className="text-xs text-zinc-500">{label}</div>
              <div className="mt-1 text-sm">
                avg <span className="font-mono">{s.avg.toFixed(1)}</span>
              </div>
              <div className="text-xs text-zinc-600">
                <span className={s.high > 4 ? 'text-amber-400' : ''}>{s.high} hi</span>{' '}
                / <span className={s.low > 4 ? 'text-amber-400' : ''}>{s.low} lo</span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-zinc-600">
        L/L-01 constraint: ≤4 teams should sit at any single dimension's extreme. Numbers
        in amber indicate this seed exceeded that. Click a team below to inspect its
        roster.
      </p>
    </section>
  );
}

function FreeAgentPoolPanel({ league }: { league: LeagueState }) {
  const [expanded, setExpanded] = useState(false);
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
              {topFAs.map((player) => (
                <tr key={player.id} className="border-t border-zinc-800/60">
                  <td className="px-2 py-1">
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
              ))}
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

function NewsFeedPanel({ league }: { league: LeagueState }) {
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
    case 'ir-move':
    case 'contract-expiration':
    case 'cap-cut':
    case 'mood-shift':
    case 'trade-request':
    case 'locker-room-incident':
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
    case 'ir-move':
    case 'ps-promotion':
    case 'contract-expiration':
    case 'cap-cut':
    case 'mood-shift':
    case 'trade-request':
      return [entry.playerId];
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
      return entry.deadMoney;
    case 'cap-cut':
      return Math.max(entry.deadMoney, entry.capSaving);
    default:
      return null;
  }
}

function TransactionLogPanel({ league }: { league: LeagueState }) {
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
      return 'text-rose-400';
    case 'fa-sign':
    case 'ps-promotion':
      return 'text-emerald-400';
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
    </div>
  );
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

function ContractTermsTable({ contract }: { contract: Contract }) {
  const totalBase = contract.baseSalaries.reduce((sum, b) => sum + b, 0);
  const totalRosterBonus = contract.rosterBonuses.reduce((sum, b) => sum + b, 0);
  const totalWorkoutBonus = contract.workoutBonuses.reduce((sum, b) => sum + b, 0);
  const totalValue =
    totalBase + contract.signingBonus + totalRosterBonus + totalWorkoutBonus;
  const totalGuaranteed = contract.guarantees.reduce((sum, g, y) => {
    if (g.type === 'FULLY_GUARANTEED') {
      return sum + (contract.baseSalaries[y] ?? 0) * (g.baseGuaranteedPct / 100);
    }
    return sum;
  }, 0) + contract.signingBonus; // signing bonus is always fully guaranteed
  const prorationPerYear = signingBonusProrationPerYear(contract);

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Stat label="Years" value={`${contract.realYears}${contract.voidYears > 0 ? ` + ${contract.voidYears} void` : ''}`} />
      <Stat label="Total value" value={`$${(totalValue / 1e6).toFixed(2)}M`} />
      <Stat label="Total guaranteed" value={`$${(totalGuaranteed / 1e6).toFixed(2)}M`} />
      <Stat label="Signing bonus" value={`$${(contract.signingBonus / 1e6).toFixed(2)}M`} />
      <Stat label="Proration / year" value={`$${(prorationPerYear / 1e6).toFixed(2)}M`} />
      <Stat label="NTC" value={contract.noTradeClause ? 'yes' : 'no'} />
      <div className="col-span-2 sm:col-span-4">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500">
          Year-by-year base salary
        </div>
        <div className="mt-1 flex flex-wrap gap-1 font-mono">
          {contract.baseSalaries.map((b, y) => (
            <span
              key={y}
              className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5"
            >
              Y{y + 1} ${(b / 1e6).toFixed(2)}M
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <div className="font-mono text-zinc-300">{value}</div>
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
          <th className="px-1 py-0.5 text-right font-medium">cash bid</th>
          <th className="px-1 py-0.5 text-right font-medium">×preference</th>
          <th className="px-1 py-0.5 text-right font-medium">=perceived</th>
          <th className="px-1 py-0.5 text-right font-medium">cap room</th>
        </tr>
      </thead>
      <tbody>
        {bidders.map((b) => {
          const team = league.teams[b.teamId];
          const isWinner = b.teamId === winnerTeamId;
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
              <td className="px-1 py-0.5 text-right font-mono">
                ${(b.cashValuation / 1e6).toFixed(2)}M
              </td>
              <td className="px-1 py-0.5 text-right font-mono">
                ×{b.preferenceMultiplier.toFixed(3)}
              </td>
              <td className="px-1 py-0.5 text-right font-mono text-zinc-300">
                ${(b.perceivedBid / 1e6).toFixed(2)}M
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
  const winnerTeam = league.teams[winner.teamId];
  const winnerAbbr = winnerTeam?.identity.abbreviation ?? winner.teamId;

  // Compare to runner-up to highlight why the winner edged them out.
  const cashEdge = runnerUp ? winner.cashValuation - runnerUp.cashValuation : 0;
  const prefEdge = runnerUp
    ? winner.preferenceMultiplier - runnerUp.preferenceMultiplier
    : 0;

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

function moodBucketTone(bucket: MoodBucket): string {
  switch (bucket) {
    case 'happy':
      return 'text-emerald-300';
    case 'content':
      return 'text-zinc-300';
    case 'unsettled':
      return 'text-amber-300';
    case 'frustrated':
      return 'text-orange-400';
    case 'wants_out':
      return 'text-rose-400';
  }
}

function moodArchetypeLabel(archetype: MoodArchetype): string {
  switch (archetype) {
    case 'stabilizer':
      return 'stab';
    case 'anchor':
      return 'anch';
    case 'normal':
      return 'norm';
    case 'moody':
      return 'mood';
    case 'distraction':
      return 'dist';
  }
}

function moodArchetypeChipClass(archetype: MoodArchetype): string {
  switch (archetype) {
    case 'stabilizer':
      return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
    case 'anchor':
      return 'border-emerald-800/40 bg-emerald-900/20 text-emerald-200/80';
    case 'normal':
      return 'border-zinc-700 bg-zinc-900/40 text-zinc-500';
    case 'moody':
      return 'border-amber-700/40 bg-amber-900/20 text-amber-300/80';
    case 'distraction':
      return 'border-rose-500/40 bg-rose-500/10 text-rose-300';
  }
}

function chemistryChipClass(bucket: ChemistryBucket): string {
  switch (bucket) {
    case 'locked_in':
      return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
    case 'cohesive':
      return 'border-emerald-700/40 bg-emerald-900/20 text-emerald-200';
    case 'neutral':
      return 'border-zinc-700 bg-zinc-900/40 text-zinc-400';
    case 'divided':
      return 'border-orange-500/40 bg-orange-500/10 text-orange-300';
    case 'toxic':
      return 'border-rose-500/40 bg-rose-500/10 text-rose-300';
  }
}

function DivisionSection({
  division,
  league,
  records,
  teams,
  selectedTeamId,
  onSelect,
}: {
  division: Division;
  league: LeagueState;
  records: Map<TeamId, TeamRecord> | null;
  teams: readonly TeamState[];
  selectedTeamId: TeamId | null;
  onSelect: (id: TeamId) => void;
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
        {division.replace('_', ' ')}
      </h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {teams.map((team) => (
          <TeamCard
            key={team.identity.id}
            team={team}
            league={league}
            record={records?.get(team.identity.id) ?? null}
            selected={team.identity.id === selectedTeamId}
            onClick={() => onSelect(team.identity.id)}
          />
        ))}
      </div>
    </section>
  );
}

function TeamCard({
  team,
  league,
  record,
  selected,
  onClick,
}: {
  team: TeamState;
  league: LeagueState;
  record: TeamRecord | null;
  selected: boolean;
  onClick: () => void;
}) {
  const owner = league.owners[team.ownerId]!;
  const gm = league.gms[team.gmId]!;
  const hc = league.coaches[team.headCoachId]!;
  const tp = league.teamPersonalities[team.identity.id]!;
  const chem = teamChemistry(team, league);

  return (
    <article
      onClick={onClick}
      className={`cursor-pointer rounded border p-3 text-sm transition ${
        selected
          ? 'border-emerald-500/60 bg-emerald-500/5'
          : 'border-zinc-800 bg-zinc-900/30 hover:border-zinc-700 hover:bg-zinc-900/60'
      }`}
    >
      <header className="mb-2">
        <div className="flex items-baseline justify-between">
          <h3 className="font-medium">{team.identity.fullName}</h3>
          <div className="flex items-baseline gap-2 text-xs">
            {record && (
              <span className="font-mono text-zinc-300">
                {record.wins}-{record.losses}
                {record.ties > 0 ? `-${record.ties}` : ''}
              </span>
            )}
            <span className="text-zinc-600">{team.identity.marketSize.toLowerCase()}</span>
          </div>
        </div>
        <div className="flex items-baseline gap-2 text-xs text-zinc-500">
          <span>
            {team.franchiseHistory.toLowerCase().replace(/_/g, ' ')} ·{' '}
            {team.competitiveWindow.toLowerCase()}
          </span>
          {(() => {
            const badge = dynastyBadge(team.seasonHistory);
            return badge ? (
              <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-amber-300">
                {badge}
              </span>
            ) : null;
          })()}
          <span
            className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${chemistryChipClass(chem.bucket)}`}
            title={`Weighted roster-mood roll-up (${Math.round(chem.score)}). ${chem.unhappyCount} unhappy · ${chem.tradeRequestCount} trade reqs.`}
          >
            {chem.bucket.replace('_', ' ')}
            {chem.tradeRequestCount > 0 && (
              <span className="ml-1 text-fuchsia-300">·{chem.tradeRequestCount}⚠</span>
            )}
          </span>
        </div>
      </header>

      <PersonnelLine label="OWNER" name={owner.name} quirks={owner.quirks} />
      <PersonnelLine label="GM" name={gm.name} quirks={gm.quirks} />
      <PersonnelLine
        label="HC"
        name={hc.name}
        nameSuffix={formatAwardBadge(hc.careerAwards)}
        nameSuffixTooltip={awardBadgeTooltip(hc.careerAwards)}
        quirks={hc.quirks}
        extras={[hc.offensiveScheme, hc.defensiveScheme]}
      />

      <div className="mt-3 grid grid-cols-3 gap-x-2 gap-y-1 text-xs">
        <Dim label="risk" value={tp.riskTolerance} />
        <Dim label="analytics" value={tp.analyticsOrientation} />
        <Dim label="patience" value={tp.patienceLevel} />
        <Dim label="financial" value={tp.financialAggressiveness} />
        <Dim label="urgency" value={tp.championshipUrgency} />
        <Dim label="stability" value={tp.organizationalStability} />
      </div>

      <CapBar team={team} league={league} />
    </article>
  );
}

function CapBar({ team, league }: { team: TeamState; league: LeagueState }) {
  const cap = summarizeTeamCap(team, league);
  const overCap = cap.capSpace < 0;
  const usagePct = Math.min(100, (cap.capUsed / cap.capCeiling) * 100);
  const injuredCount = countInjuredOnRoster(team, league);
  const deadMoney = team.deadMoneyByYear[0] ?? 0;
  return (
    <div className="mt-2">
      <div className="flex items-baseline justify-between text-[11px] text-zinc-500">
        <span>
          {team.rosterIds.length} players
          {injuredCount > 0 && (
            <span className="ml-2 text-rose-400" title={`${injuredCount} player(s) currently injured`}>
              {injuredCount} inj
            </span>
          )}
          {deadMoney > 0 && (
            <span
              className="ml-2 text-amber-400"
              title={`${formatMoney(deadMoney)} of dead money charges from prior releases counted against this season's cap`}
            >
              ☠ {formatMoney(deadMoney)}
            </span>
          )}
        </span>
        <span className={overCap ? 'text-rose-400' : 'text-zinc-400'}>
          {formatMoney(cap.capUsed)} / {formatMoney(cap.capCeiling)}{' '}
          <span className={overCap ? 'text-rose-400' : 'text-emerald-400'}>
            ({overCap ? '+' : ''}
            {formatMoney(Math.abs(cap.capSpace))})
          </span>
        </span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded bg-zinc-800">
        <div
          className={`h-1 ${overCap ? 'bg-rose-500/70' : 'bg-emerald-500/60'}`}
          style={{ width: `${usagePct}%` }}
        />
      </div>
    </div>
  );
}

function countInjuredOnRoster(team: TeamState, league: LeagueState): number {
  let count = 0;
  for (const id of team.rosterIds) {
    const p = league.players[id];
    if (p?.injury) count++;
  }
  return count;
}

function formatMoney(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${value}`;
}

function PersonnelLine({
  label,
  name,
  nameSuffix,
  nameSuffixTooltip,
  quirks,
  extras,
}: {
  label: string;
  name: string;
  nameSuffix?: string | null;
  nameSuffixTooltip?: string;
  quirks: readonly string[];
  extras?: readonly string[];
}) {
  return (
    <div className="mb-1">
      <span className="mr-2 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
        {label}
      </span>
      <span>{name}</span>
      {nameSuffix && (
        <span
          className="ml-2 rounded border border-amber-500/40 bg-amber-500/10 px-1 py-0.5 text-[9px] font-mono uppercase tracking-wider text-amber-300"
          title={nameSuffixTooltip}
        >
          {nameSuffix}
        </span>
      )}
      <div className="ml-12 mt-0.5 text-[11px] text-zinc-500">
        {quirks.map((q) => q.toLowerCase().replace(/_/g, ' ')).join(' · ')}
        {extras && extras.length > 0 && (
          <span className="text-zinc-600">
            {' · '}
            {extras.map((e) => e.toLowerCase().replace(/_/g, ' ')).join(' / ')}
          </span>
        )}
      </div>
    </div>
  );
}

function Dim({ label, value }: { label: string; value: number }) {
  const tone =
    value >= 9 ? 'text-emerald-400' : value <= 2 ? 'text-rose-400' : 'text-zinc-300';
  return (
    <div className="flex items-baseline justify-between border-b border-zinc-800/60 pb-0.5">
      <span className="text-zinc-600">{label}</span>
      <span className={`font-mono ${tone}`}>{value.toFixed(1)}</span>
    </div>
  );
}

// ─── TEAM DETAIL DRAWER ───────────────────────────────────────────────────

function TeamDetail({
  team,
  league,
  records,
  seasonStats,
  onClose,
  onLeagueChange,
}: {
  team: TeamState;
  league: LeagueState;
  records: Map<TeamId, TeamRecord> | null;
  seasonStats: Map<PlayerId, PlayerSeasonStats> | null;
  onClose: () => void;
  onLeagueChange: (l: LeagueState) => void;
}) {
  const hc = league.coaches[team.headCoachId]!;
  const cap = summarizeTeamCap(team, league);
  const overCap = cap.capSpace < 0;
  const record = records?.get(team.identity.id) ?? null;
  const players = team.rosterIds
    .map((id) => league.players[id]!)
    .sort((a, b) => {
      // Group by positionGroup, then by overall current skill desc
      if (a.positionGroup !== b.positionGroup) {
        return positionGroupOrder(a.positionGroup) - positionGroupOrder(b.positionGroup);
      }
      const aScore = avgKeySkill(a);
      const bScore = avgKeySkill(b);
      return bScore - aScore;
    });

  const groups: { group: PositionGroup; label: string; players: Player[] }[] = [
    { group: PositionGroup.QB, label: 'Quarterback', players: [] },
    { group: PositionGroup.SKILL, label: 'Skill positions', players: [] },
    { group: PositionGroup.OL, label: 'Offensive line', players: [] },
    { group: PositionGroup.DL, label: 'Defensive line', players: [] },
    { group: PositionGroup.LB, label: 'Linebackers', players: [] },
    { group: PositionGroup.DB, label: 'Defensive backs', players: [] },
    { group: PositionGroup.ST, label: 'Special teams', players: [] },
  ];
  for (const p of players) {
    const target = groups.find((g) => g.group === p.positionGroup);
    if (target) target.players.push(p);
  }

  return (
    <section className="mb-8 rounded border border-emerald-500/40 bg-zinc-950 p-4">
      <header className="mb-3 flex items-baseline justify-between">
        <div>
          <h2 className="text-lg font-medium">
            {team.identity.fullName}
            {record && (
              <span className="ml-3 font-mono text-sm text-zinc-300">
                {record.wins}-{record.losses}
                {record.ties > 0 ? `-${record.ties}` : ''}
              </span>
            )}
          </h2>
          <p className="text-xs text-zinc-500">
            {team.rosterIds.length}-man roster · scheme:{' '}
            {hc.offensiveScheme.replace(/_/g, ' ').toLowerCase()} /{' '}
            {hc.defensiveScheme.replace(/_/g, ' ').toLowerCase()}
          </p>
          <p className={`text-xs ${overCap ? 'text-rose-400' : 'text-emerald-400'}`}>
            cap: {formatMoney(cap.capUsed)} / {formatMoney(cap.capCeiling)} ·{' '}
            {overCap ? 'over by ' : 'space '}
            {formatMoney(Math.abs(cap.capSpace))}
          </p>
          {(() => {
            const tc = teamChemistry(team, league);
            return (
              <p className="text-xs text-zinc-400">
                locker room:{' '}
                <span
                  className={`rounded border px-1 py-0.5 font-mono text-[10px] uppercase tracking-wide ${chemistryChipClass(tc.bucket)}`}
                  title={`Weighted roster-mood roll-up. STAR mood weighs 4×, FRINGE 0.5×.`}
                >
                  {tc.bucket.replace('_', ' ')} ({Math.round(tc.score)})
                </span>
                <span className="ml-2 text-zinc-500">
                  {tc.unhappyCount} unhappy
                  {tc.tradeRequestCount > 0 && (
                    <span className="ml-1 text-fuchsia-300">
                      · {tc.tradeRequestCount} trade {tc.tradeRequestCount === 1 ? 'req' : 'reqs'}
                    </span>
                  )}
                </span>
              </p>
            );
          })()}
          {team.deadMoneyByYear.some((v) => v > 0) && (
            <p className="text-xs text-amber-400" title="Dead-money cap charges from prior releases / trades, by future season offset">
              ☠ dead money:{' '}
              {team.deadMoneyByYear
                .map((v, i) => `Y${i}=${formatMoney(v)}`)
                .join(' · ')}
            </p>
          )}
          {team.injuredReserveIds.length > 0 && (
            <p
              className="text-xs text-rose-400"
              title="Injured reserve — players moved off the active roster after a MAJOR injury this season. Restored at offseason."
            >
              ⛑ IR ({team.injuredReserveIds.length}):{' '}
              {team.injuredReserveIds
                .map((id) => {
                  const p = league.players[id];
                  if (!p) return id;
                  return `${p.firstName.charAt(0)}. ${p.lastName} (${p.position})`;
                })
                .join(', ')}
            </p>
          )}
          {team.practiceSquadIds.length > 0 && (
            <p
              className="text-xs text-sky-400"
              title="Practice squad — developmental players on 1-year PS-minimum contracts. Re-stocked each offseason. Not counted toward the salary cap."
            >
              🎓 PS ({team.practiceSquadIds.length}):{' '}
              {(() => {
                const positionCounts: Record<string, number> = {};
                for (const id of team.practiceSquadIds) {
                  const p = league.players[id];
                  if (p) positionCounts[p.position] = (positionCounts[p.position] ?? 0) + 1;
                }
                return Object.entries(positionCounts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([pos, n]) => `${n} ${pos}`)
                  .join(' · ');
              })()}
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
        >
          close
        </button>
      </header>

      <TradeBuilderPanel team={team} league={league} onLeagueChange={onLeagueChange} />

      <div className="space-y-4">
        {groups
          .filter((g) => g.players.length > 0)
          .map((group) => (
            <PositionGroupTable
              key={group.group}
              group={group}
              hc={hc}
              league={league}
              seasonStats={seasonStats}
              onLeagueChange={onLeagueChange}
            />
          ))}
      </div>

      {team.seasonHistory.length > 0 && (
        <SeasonHistoryTable history={team.seasonHistory} />
      )}
    </section>
  );
}

function TradeBuilderPanel({
  team,
  league,
  onLeagueChange,
}: {
  team: TeamState;
  league: LeagueState;
  onLeagueChange: (l: LeagueState) => void;
}) {
  const [open, setOpen] = useState(false);
  const [partnerId, setPartnerId] = useState<TeamId | null>(null);
  const [outgoing, setOutgoing] = useState<Set<PlayerId>>(new Set());
  const [incoming, setIncoming] = useState<Set<PlayerId>>(new Set());

  const partnerOptions = useMemo(
    () =>
      Object.values(league.teams)
        .filter((t) => t.identity.id !== team.identity.id)
        .sort((a, b) => a.identity.fullName.localeCompare(b.identity.fullName)),
    [league.teams, team.identity.id],
  );

  const partner = partnerId ? league.teams[partnerId] : null;

  function reset() {
    setOutgoing(new Set());
    setIncoming(new Set());
  }

  function toggle(setFn: (s: Set<PlayerId>) => void, current: Set<PlayerId>, id: PlayerId) {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setFn(next);
  }

  function executeAndApply() {
    if (!partner) return;
    if (outgoing.size === 0 && incoming.size === 0) return;
    try {
      const result = executeTrade(league, {
        teamAId: team.identity.id,
        teamBId: partner.identity.id,
        playersAToB: [...outgoing],
        playersBToA: [...incoming],
        overrideNoTrade: true,
      });
      onLeagueChange(result);
      reset();
    } catch (e) {
      // Surface error inline; reset on cancel.
      // eslint-disable-next-line no-alert
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  const outgoingDead = useMemo(() => {
    let total = 0;
    for (const id of outgoing) {
      const player = league.players[id];
      if (!player?.contractId) continue;
      const c = league.contracts[player.contractId];
      if (!c) continue;
      total += signingBonusProrationPerYear(c) * c.yearsRemaining;
    }
    return total;
  }, [outgoing, league]);

  const incomingDead = useMemo(() => {
    let total = 0;
    for (const id of incoming) {
      const player = league.players[id];
      if (!player?.contractId) continue;
      const c = league.contracts[player.contractId];
      if (!c) continue;
      total += signingBonusProrationPerYear(c) * c.yearsRemaining;
    }
    return total;
  }, [incoming, league]);

  return (
    <section className="my-4 rounded border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-400">
          Trade builder
        </h3>
        <button
          onClick={() => {
            setOpen((x) => !x);
            if (open) reset();
          }}
          className="text-xs text-zinc-400 hover:text-zinc-200"
        >
          {open ? 'close' : 'open'}
        </button>
      </div>
      {open && (
        <div className="mt-3 space-y-3">
          <div className="flex items-center gap-2 text-xs">
            <label className="text-zinc-500">Trade with:</label>
            <select
              value={partnerId ?? ''}
              onChange={(e) => {
                setPartnerId(e.target.value ? (e.target.value as TeamId) : null);
                reset();
              }}
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-zinc-300"
            >
              <option value="">— pick a team —</option>
              {partnerOptions.map((t) => (
                <option key={t.identity.id} value={t.identity.id}>
                  {t.identity.fullName}
                </option>
              ))}
            </select>
            {partner && (
              <button
                onClick={executeAndApply}
                disabled={outgoing.size === 0 && incoming.size === 0}
                className="ml-auto rounded border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300 hover:bg-amber-500/20 disabled:opacity-40"
              >
                execute trade ({outgoing.size}+{incoming.size})
              </button>
            )}
          </div>
          {partner && (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <TradeRosterColumn
                heading={`${team.identity.abbreviation} sends →`}
                team={team}
                league={league}
                selected={outgoing}
                onToggle={(id) => toggle(setOutgoing, outgoing, id)}
                deadMoney={outgoingDead}
              />
              <TradeRosterColumn
                heading={`${partner.identity.abbreviation} sends →`}
                team={partner}
                league={league}
                selected={incoming}
                onToggle={(id) => toggle(setIncoming, incoming, id)}
                deadMoney={incomingDead}
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function TradeRosterColumn({
  heading,
  team,
  league,
  selected,
  onToggle,
  deadMoney,
}: {
  heading: string;
  team: TeamState;
  league: LeagueState;
  selected: Set<PlayerId>;
  onToggle: (id: PlayerId) => void;
  deadMoney: number;
}) {
  const players = team.rosterIds
    .map((id) => league.players[id]!)
    .sort((a, b) => avgKeySkill(b) - avgKeySkill(a));
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
      <div className="mb-1 flex items-baseline justify-between text-[11px]">
        <span className="font-medium text-zinc-300">{heading}</span>
        <span className="text-amber-400" title="Dead money this team would absorb if they trade these players away">
          dead {formatMoney(deadMoney)}
        </span>
      </div>
      <div className="max-h-72 overflow-y-auto">
        <table className="w-full text-left text-[11px]">
          <tbody>
            {players.map((p) => {
              const c = p.contractId ? league.contracts[p.contractId] : null;
              const cap = c ? currentCapHit(c) : 0;
              return (
                <tr
                  key={p.id}
                  className={`cursor-pointer border-t border-zinc-800/60 hover:bg-amber-500/5 ${selected.has(p.id) ? 'bg-amber-500/15' : ''}`}
                  onClick={() => onToggle(p.id)}
                >
                  <td className="px-1 py-0.5 font-mono text-zinc-500">{p.position}</td>
                  <td className="px-1 py-0.5">
                    {p.firstName.charAt(0)}. {p.lastName}
                  </td>
                  <td className={`px-1 py-0.5 text-[10px] font-mono ${tierToneFor(p.tier)}`}>
                    {p.tier.toLowerCase()}
                  </td>
                  <td className="px-1 py-0.5 text-right font-mono text-zinc-400">
                    {formatMoney(cap)}
                  </td>
                  <td className="px-1 py-0.5 text-right text-zinc-500">
                    {c?.yearsRemaining ?? '-'}y
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function tierToneFor(tier: Player['tier']): string {
  if (tier === 'STAR') return 'text-emerald-400';
  if (tier === 'STARTER') return 'text-zinc-200';
  if (tier === 'BACKUP') return 'text-zinc-500';
  return 'text-zinc-600';
}

function SeasonHistoryTable({ history }: { history: readonly TeamSeasonRecord[] }) {
  // Show most-recent first; cap at 12 to keep the drawer compact when
  // simulations run long.
  const rows = [...history].slice(-12).reverse();
  return (
    <div className="mt-6">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Season History ({history.length} seasons)
      </h3>
      <div className="overflow-x-auto rounded border border-zinc-800">
        <table className="min-w-full text-xs">
          <thead className="bg-zinc-900/60 text-left text-zinc-500">
            <tr>
              <th className="px-2 py-1 font-medium">year</th>
              <th className="px-2 py-1 font-medium">record</th>
              <th className="px-2 py-1 font-medium">div</th>
              <th className="px-2 py-1 font-medium">postseason</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.seasonNumber} className="border-t border-zinc-800/60">
                <td className="px-2 py-1 font-mono text-zinc-400">{row.seasonNumber}</td>
                <td className="px-2 py-1 font-mono">
                  {row.wins}-{row.losses}
                  {row.ties > 0 ? `-${row.ties}` : ''}
                </td>
                <td className="px-2 py-1 text-zinc-400">
                  {row.divisionFinish === 1
                    ? '1st'
                    : row.divisionFinish === 2
                      ? '2nd'
                      : row.divisionFinish === 3
                        ? '3rd'
                        : `${row.divisionFinish}th`}
                </td>
                <td className="px-2 py-1">
                  {row.championshipResult ? (
                    <span
                      className={
                        row.championshipResult === 'won_super_bowl'
                          ? 'font-medium text-amber-300'
                          : 'text-zinc-400'
                      }
                    >
                      {formatChampionshipResult(row.championshipResult)}
                    </span>
                  ) : row.madePlayoffs ? (
                    <span className="text-zinc-500">made playoffs</span>
                  ) : (
                    <span className="text-zinc-700">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatChampionshipResult(r: NonNullable<TeamSeasonRecord['championshipResult']>): string {
  switch (r) {
    case 'won_super_bowl':
      return '🏆 won Super Bowl';
    case 'lost_super_bowl':
      return 'lost Super Bowl';
    case 'lost_conference':
      return 'lost conf. champ';
    case 'lost_divisional':
      return 'lost divisional';
    case 'lost_wildcard':
      return 'lost wild card';
  }
}

function PositionGroupTable({
  group,
  hc,
  league,
  seasonStats,
  onLeagueChange,
}: {
  group: { group: PositionGroup; label: string; players: Player[] };
  hc: { offensiveScheme: string; defensiveScheme: string };
  league: LeagueState;
  seasonStats: Map<PlayerId, PlayerSeasonStats> | null;
  onLeagueChange: (l: LeagueState) => void;
}) {
  const [pendingReleaseId, setPendingReleaseId] = useState<PlayerId | null>(null);
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {group.label} ({group.players.length})
      </h3>
      <div className="overflow-x-auto rounded border border-zinc-800">
        <table className="min-w-full text-xs">
          <thead className="bg-zinc-900/60 text-left text-zinc-500">
            <tr>
              <th className="px-2 py-1 font-medium">pos</th>
              <th className="px-2 py-1 font-medium">name</th>
              <th className="px-2 py-1 font-medium">age</th>
              <th className="px-2 py-1 font-medium">tier</th>
              <th className="px-2 py-1 font-medium">archetype</th>
              <th className="px-2 py-1 font-medium" title="Average of relevant skills">
                key
              </th>
              <th className="px-2 py-1 font-medium" title="Hidden ceiling — never shown to player">
                ceil
              </th>
              <th
                className="px-2 py-1 font-medium"
                title="Scheme fit multiplier in this team's HC scheme"
              >
                fit
              </th>
              <th className="px-2 py-1 font-medium">yrs</th>
              <th className="px-2 py-1 font-medium" title="Current-year cap hit">
                cap
              </th>
              <th className="px-2 py-1 font-medium" title="Active injury (severity, weeks until expected return)">
                inj
              </th>
              <th className="px-2 py-1 font-medium" title="Hidden mood — bucket label and raw 0..100. Drifts weekly during the season based on team results, HC fit, and depth-chart position.">
                mood
              </th>
              {seasonStats && (
                <th className="px-2 py-1 font-medium" title="Position-relevant season stat">
                  season
                </th>
              )}
              <th className="px-2 py-1 font-medium" title="Position-relevant career total across all played seasons">
                career
              </th>
              <th className="px-2 py-1 font-medium" title="Release the player — drops contract, accrues dead money, player becomes a free agent">
                action
              </th>
            </tr>
          </thead>
          <tbody>
            {group.players.map((p) => {
              const archetype = getArchetypeById(p.archetype);
              const archetypeLabel = archetype?.label ?? p.archetype;
              const fit = schemeFitForPlayer(p, {
                offensiveScheme: hc.offensiveScheme as never,
                defensiveScheme: hc.defensiveScheme as never,
              });
              const fitTone =
                fit >= 1.4 ? 'text-emerald-400' : fit <= 0.85 ? 'text-rose-400' : 'text-zinc-400';
              const cur = avgKeySkill(p);
              const ceil = avgKeyCeiling(p);
              const contract = p.contractId ? league.contracts[p.contractId] : null;
              const cap = contract ? currentCapHit(contract) : 0;
              const tierTone =
                p.tier === 'STAR'
                  ? 'text-emerald-400'
                  : p.tier === 'STARTER'
                    ? 'text-zinc-200'
                    : p.tier === 'BACKUP'
                      ? 'text-zinc-500'
                      : 'text-zinc-600';
              const awardBadge = formatAwardBadge(p.careerAwards);
              return (
                <tr key={p.id} className="border-t border-zinc-800/60">
                  <td className="px-2 py-1 font-mono text-zinc-400">{p.position}</td>
                  <td className="px-2 py-1">
                    {p.firstName} {p.lastName}
                    {awardBadge && (
                      <span
                        className="ml-2 rounded border border-amber-500/40 bg-amber-500/10 px-1 py-0.5 text-[9px] font-mono uppercase tracking-wider text-amber-300"
                        title={awardBadgeTooltip(p.careerAwards)}
                      >
                        {awardBadge}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-zinc-500">
                    {ageOfPlayer(p, league.seasonNumber)}
                  </td>
                  <td className={`px-2 py-1 font-mono text-[10px] ${tierTone}`}>
                    {p.tier.toLowerCase()}
                  </td>
                  <td className="px-2 py-1 text-zinc-400">{archetypeLabel}</td>
                  <td className="px-2 py-1 font-mono">{cur}</td>
                  <td className="px-2 py-1 font-mono text-zinc-500">{ceil}</td>
                  <td className={`px-2 py-1 font-mono ${fitTone}`}>{fit.toFixed(2)}</td>
                  <td className="px-2 py-1 text-zinc-500">{contract?.yearsRemaining ?? '-'}</td>
                  <td className="px-2 py-1 font-mono text-zinc-400">{formatMoney(cap)}</td>
                  <td className="px-2 py-1 text-[10px]">
                    <InjuryCell player={p} league={league} />
                  </td>
                  <td className={`px-2 py-1 text-[10px] ${moodBucketTone(moodBucket(p.mood))}`}>
                    {moodBucket(p.mood).replace('_', ' ')}{' '}
                    <span className="font-mono text-zinc-500">({Math.round(p.mood)})</span>
                    <span
                      className={`ml-1 rounded border px-1 py-0.5 text-[9px] font-mono uppercase tracking-wider ${moodArchetypeChipClass(p.moodProfile.archetype)}`}
                      title={`Personality: ${p.moodProfile.archetype} · setPoint ${p.moodProfile.setPoint} · volatility ${p.moodProfile.volatility} · resilience ${p.moodProfile.resilience}. Mood drifts toward setPoint; volatility scales weekly noise + incident odds.`}
                    >
                      {moodArchetypeLabel(p.moodProfile.archetype)}
                    </span>
                    {p.tradeRequestedOnTick !== null && (
                      <span
                        className="ml-1 rounded border border-fuchsia-500/40 bg-fuchsia-500/10 px-1 py-0.5 text-[9px] font-mono uppercase tracking-wider text-fuchsia-300"
                        title={`Demanded a trade on tick ${p.tradeRequestedOnTick}. Recovers once mood rises above the resolve threshold.`}
                      >
                        wants out
                      </span>
                    )}
                  </td>
                  {seasonStats && (
                    <td className="px-2 py-1 text-zinc-300">
                      {formatKeyStat(p, seasonStats.get(p.id) ?? null)}
                    </td>
                  )}
                  <td className="px-2 py-1 text-zinc-400">
                    {formatCareerStat(p)}
                  </td>
                  <td className="px-2 py-1">
                    <ReleaseActionCell
                      player={p}
                      contract={contract}
                      currentCap={cap}
                      pending={pendingReleaseId === p.id}
                      onPending={() => setPendingReleaseId(p.id)}
                      onCancel={() => setPendingReleaseId(null)}
                      onConfirm={() => {
                        onLeagueChange(releasePlayer(league, p.id));
                        setPendingReleaseId(null);
                      }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReleaseActionCell({
  player,
  contract,
  currentCap,
  pending,
  onPending,
  onCancel,
  onConfirm,
}: {
  player: Player;
  contract: Contract | null | undefined;
  currentCap: number;
  pending: boolean;
  onPending: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!contract) {
    return <span className="text-zinc-700">—</span>;
  }
  if (!pending) {
    return (
      <button
        onClick={onPending}
        className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:border-rose-500/50 hover:text-rose-300"
        title={`Release ${player.firstName} ${player.lastName}`}
      >
        release
      </button>
    );
  }
  const dead = deadMoneyOnPreJune1Release(contract);
  const saving = currentCap - dead;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-[10px]">
      <span
        className="text-zinc-500"
        title="Cap saving this year (current cap hit minus dead money)"
      >
        <span className={saving > 0 ? 'text-emerald-400' : saving < 0 ? 'text-rose-400' : 'text-zinc-400'}>
          {saving >= 0 ? '+' : ''}
          {formatMoney(saving)}
        </span>{' '}
        / dead {formatMoney(dead)}
      </span>
      <button
        onClick={onConfirm}
        className="rounded border border-rose-500/50 bg-rose-500/10 px-1.5 py-0.5 text-rose-300 hover:bg-rose-500/20"
      >
        confirm
      </button>
      <button
        onClick={onCancel}
        className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-zinc-400 hover:bg-zinc-800"
      >
        cancel
      </button>
    </span>
  );
}

function InjuryCell({ player, league }: { player: Player; league: LeagueState }) {
  const inj = player.injury;
  if (!inj) return <span className="text-zinc-700">—</span>;
  const seasonStartTick = league.tick;
  // During regular season league.tick stays at season start (advanceSeason
  // jumps it forward 17). estimatedReturnTick was stamped relative to that
  // base, so weeks-until = estimatedReturnTick - seasonStartTick gives a
  // "weeks-from-week-1" figure. Clamp to non-negative for safety.
  const weeksUntil = Math.max(0, inj.estimatedReturnTick - seasonStartTick);
  const tone =
    inj.severity === 'MAJOR'
      ? 'text-rose-400'
      : inj.severity === 'MODERATE'
        ? 'text-amber-400'
        : 'text-zinc-400';
  const sev = inj.severity === 'MINOR' ? 'min' : inj.severity === 'MODERATE' ? 'mod' : 'maj';
  return (
    <span className={tone} title={`${inj.type} (${inj.severity.toLowerCase()})`}>
      {sev} · w{weeksUntil}
    </span>
  );
}

/**
 * Compact summary of a player or coach's career awards, e.g. "★ 3× MVP"
 * or "★ 2× MVP, 1× DPOY". Returns null if the array is empty.
 */
function formatAwardBadge(awards: readonly CareerAward[]): string | null {
  if (awards.length === 0) return null;
  const counts = new Map<string, number>();
  for (const a of awards) counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1);
  // Order awards by importance for the chip display.
  const order = ['MVP', 'OPOY', 'DPOY', 'COY', 'OROY', 'DROY'];
  const parts = order
    .filter((k) => counts.has(k))
    .map((k) => `${counts.get(k)}× ${k}`);
  return `★ ${parts.join(', ')}`;
}

function awardBadgeTooltip(awards: readonly CareerAward[]): string {
  if (awards.length === 0) return '';
  return awards
    .slice()
    .sort((a, b) => a.seasonNumber - b.seasonNumber)
    .map((a) => `Year ${a.seasonNumber}: ${a.kind}`)
    .join('\n');
}

/**
 * Aggregate a position-relevant career total across every season in
 * `Player.careerStats`. Returns "—" if the player has no career
 * history (rookies, untracked positions).
 */
function formatCareerStat(player: Player): string {
  if (player.careerStats.length === 0) return '—';
  const sum = (key: keyof PlayerSeasonStats) =>
    player.careerStats.reduce((s, e) => s + (e[key] as number), 0);
  const seasons = player.careerStats.length;
  switch (player.position) {
    case Position.QB: {
      const yds = sum('passingYards');
      const tds = sum('passingTds');
      return `${yds.toLocaleString()} pass yds, ${tds} TD (${seasons}y)`;
    }
    case Position.RB:
    case Position.FB: {
      const yds = sum('rushingYards');
      const tds = sum('rushingTds');
      return `${yds.toLocaleString()} rush yds, ${tds} TD (${seasons}y)`;
    }
    case Position.WR:
    case Position.TE: {
      const rec = sum('receptions');
      const yds = sum('receivingYards');
      const tds = sum('receivingTds');
      return `${rec} rec / ${yds.toLocaleString()} yds, ${tds} TD (${seasons}y)`;
    }
    case Position.EDGE:
    case Position.DT:
    case Position.NT: {
      const sks = sum('sacks');
      const tkl = sum('tackles');
      return `${sks} sk, ${tkl} tkl (${seasons}y)`;
    }
    case Position.ILB:
    case Position.OLB: {
      const tkl = sum('tackles');
      const sks = sum('sacks');
      const ints = sum('interceptions');
      return `${tkl} tkl, ${sks} sk, ${ints} INT (${seasons}y)`;
    }
    case Position.CB:
    case Position.S:
    case Position.NICKEL: {
      const tkl = sum('tackles');
      const ints = sum('interceptions');
      return `${tkl} tkl, ${ints} INT (${seasons}y)`;
    }
    default:
      return '—';
  }
}

/**
 * The single most relevant season stat per position. Returns "—" if
 * the player has no recorded output (e.g. K/P/LS, untracked positions,
 * or backup who never saw the field).
 */
function formatKeyStat(player: Player, stats: PlayerSeasonStats | null): string {
  if (!stats) return '—';
  switch (player.position) {
    case Position.QB:
      return `${stats.passingYards.toLocaleString()} pass yds, ${stats.passingTds} TD`;
    case Position.RB:
    case Position.FB:
      return `${stats.rushingYards.toLocaleString()} rush yds, ${stats.rushingTds} TD`;
    case Position.WR:
    case Position.TE:
      return `${stats.receptions} rec / ${stats.receivingYards.toLocaleString()} yds, ${stats.receivingTds} TD`;
    case Position.EDGE:
    case Position.DT:
    case Position.NT:
      return `${stats.sacks} sk, ${stats.tackles} tkl`;
    case Position.ILB:
    case Position.OLB:
      return `${stats.tackles} tkl, ${stats.sacks} sk, ${stats.interceptions} INT`;
    case Position.CB:
    case Position.S:
    case Position.NICKEL:
      return `${stats.tackles} tkl, ${stats.interceptions} INT`;
    default:
      return '—';
  }
}

function positionGroupOrder(group: PositionGroup): number {
  const order: Record<PositionGroup, number> = {
    QB: 0,
    SKILL: 1,
    OL: 2,
    DL: 3,
    LB: 4,
    DB: 5,
    ST: 6,
  };
  return order[group];
}

function avgKeySkill(p: Player): number {
  // For dev-inspector, take average of skills with archetype weight ≥ 1.2
  // (the skills that actually matter for this player). Falls back to a
  // small default set if archetype is unknown.
  const archetype = getArchetypeById(p.archetype);
  const keys = archetype
    ? Object.entries(archetype.skillWeights)
        .filter(([, w]) => (w ?? 1) >= 1.2)
        .map(([k]) => k as keyof typeof p.current)
    : (['technicalSkill', 'footballIq', 'speed'] as (keyof typeof p.current)[]);
  if (keys.length === 0) return 0;
  const sum = keys.reduce((s, k) => s + p.current[k], 0);
  return Math.round(sum / keys.length);
}

function avgKeyCeiling(p: Player): number {
  const archetype = getArchetypeById(p.archetype);
  const keys = archetype
    ? Object.entries(archetype.skillWeights)
        .filter(([, w]) => (w ?? 1) >= 1.2)
        .map(([k]) => k as keyof typeof p.ceiling)
    : (['technicalSkill', 'footballIq', 'speed'] as (keyof typeof p.ceiling)[]);
  if (keys.length === 0) return 0;
  const sum = keys.reduce((s, k) => s + p.ceiling[k], 0);
  return Math.round(sum / keys.length);
}

// ─── SEASON RESULTS VIEW ─────────────────────────────────────────────────

function SeasonResultsView({
  league,
  records,
}: {
  league: LeagueState;
  records: Map<TeamId, TeamRecord>;
}) {
  const standings = divisionStandings(league, records);
  const seeds = playoffSeeds(league, records);
  const playoffs = league.schedule?.playoffs;
  const championId = playoffs?.championId;
  const champion = championId ? league.teams[championId] : null;

  return (
    <section className="mb-8 rounded border border-amber-500/30 bg-amber-500/5 p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-amber-300">
        Season {league.seasonNumber} Results
      </h2>
      {champion && (
        <p className="mb-4 text-lg">
          <span className="text-zinc-500">🏆 Champion:</span>{' '}
          <span className="font-medium text-amber-200">{champion.identity.fullName}</span>
        </p>
      )}

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        {Object.values(Conference).map((conf) => (
          <div key={conf} className="rounded border border-zinc-800 bg-zinc-950/40 p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              {conf} Playoff Seeds
            </h3>
            <ol className="space-y-0.5 text-sm">
              {seeds[conf].map((rec, idx) => {
                const team = league.teams[rec.teamId]!;
                return (
                  <li key={rec.teamId} className="flex justify-between">
                    <span>
                      <span className="mr-2 font-mono text-xs text-zinc-500">{idx + 1}.</span>
                      {team.identity.fullName}
                    </span>
                    <span className="font-mono text-xs text-zinc-400">
                      {rec.wins}-{rec.losses}
                      {rec.ties > 0 ? `-${rec.ties}` : ''}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>

      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        Division Standings
      </h3>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Object.values(Division).map((division) => {
          const recs = standings.get(division) ?? [];
          return (
            <div key={division} className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
                {division.replace('_', ' ')}
              </div>
              <ul className="space-y-0.5 text-xs">
                {recs.map((rec) => {
                  const team = league.teams[rec.teamId]!;
                  return (
                    <li key={rec.teamId} className="flex justify-between">
                      <span>{team.identity.location}</span>
                      <span className="font-mono text-zinc-400">
                        {rec.wins}-{rec.losses}
                        {rec.ties > 0 ? `-${rec.ties}` : ''}
                        <span className="ml-1 text-[10px] text-zinc-600">
                          ({(winPct(rec) * 100).toFixed(0)}%)
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── SEASON LEADERS PANEL ─────────────────────────────────────────────────

function SeasonLeadersView({
  league,
  stats,
}: {
  league: LeagueState;
  stats: Map<PlayerId, PlayerSeasonStats>;
}) {
  const lines = [...stats.values()];
  const categories: {
    label: string;
    stat: keyof PlayerSeasonStats;
    suffix: string;
  }[] = [
    { label: 'Passing yards', stat: 'passingYards', suffix: 'yds' },
    { label: 'Passing TDs', stat: 'passingTds', suffix: 'TD' },
    { label: 'Rushing yards', stat: 'rushingYards', suffix: 'yds' },
    { label: 'Receiving yards', stat: 'receivingYards', suffix: 'yds' },
    { label: 'Sacks', stat: 'sacks', suffix: 'sk' },
    { label: 'Interceptions', stat: 'interceptions', suffix: 'INT' },
  ];

  return (
    <section className="mb-8 rounded border border-emerald-500/30 bg-emerald-500/5 p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-emerald-300">
        Season {league.seasonNumber} Leaders
      </h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {categories.map(({ label, stat, suffix }) => {
          const top5 = [...lines]
            .filter((l) => (l[stat] as number) > 0)
            .sort((a, b) => (b[stat] as number) - (a[stat] as number))
            .slice(0, 5);
          return (
            <div key={stat} className="rounded border border-zinc-800 bg-zinc-950/40 p-3">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                {label}
              </h3>
              <ol className="space-y-0.5 text-sm">
                {top5.length === 0 && (
                  <li className="text-xs text-zinc-600">no entries</li>
                )}
                {top5.map((line, idx) => {
                  const player = league.players[line.playerId];
                  if (!player) return null;
                  const team = player.teamId ? league.teams[player.teamId] : null;
                  const value = line[stat] as number;
                  return (
                    <li
                      key={line.playerId}
                      className="flex items-baseline justify-between gap-2"
                    >
                      <span className="truncate">
                        <span className="mr-1 font-mono text-xs text-zinc-500">
                          {idx + 1}.
                        </span>
                        {player.firstName} {player.lastName}
                        {team && (
                          <span className="ml-1 font-mono text-[10px] text-zinc-500">
                            {team.identity.abbreviation} · {player.position}
                          </span>
                        )}
                      </span>
                      <span className="whitespace-nowrap font-mono text-xs text-zinc-200">
                        {value.toLocaleString()} {suffix}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── AWARDS PANEL ─────────────────────────────────────────────────────────

function AwardsView({ league, awards }: { league: LeagueState; awards: SeasonAwards }) {
  const rows: { label: string; entry: string | null }[] = [
    { label: 'MVP', entry: formatPlayerAward(league, awards.mvp) },
    { label: 'Offensive POY', entry: formatPlayerAward(league, awards.opoy) },
    { label: 'Defensive POY', entry: formatPlayerAward(league, awards.dpoy) },
    { label: 'Offensive ROY', entry: formatPlayerAward(league, awards.oroy) },
    { label: 'Defensive ROY', entry: formatPlayerAward(league, awards.droy) },
    { label: 'Coach of the Year', entry: formatCoachAward(league, awards.coy) },
  ];

  return (
    <section className="mb-8 rounded border border-amber-500/30 bg-amber-500/5 p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-amber-300">
        Season {league.seasonNumber} Awards
      </h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map(({ label, entry }) => (
          <div key={label} className="rounded border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-300/80">
              {label}
            </div>
            <div className="mt-1 text-sm text-zinc-100">
              {entry ?? <span className="text-zinc-600">—</span>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function formatPlayerAward(
  league: LeagueState,
  award: SeasonAwards['mvp'],
): string | null {
  if (!award) return null;
  const player = league.players[award.playerId];
  if (!player) return null;
  const team = player.teamId ? league.teams[player.teamId] : null;
  const teamLabel = team ? team.identity.abbreviation : '?';
  return `${player.firstName} ${player.lastName} (${teamLabel} · ${player.position}) — ${award.summary}`;
}

function formatCoachAward(
  league: LeagueState,
  award: SeasonAwards['coy'],
): string | null {
  if (!award) return null;
  const coach = league.coaches[award.coachId];
  const team = league.teams[award.teamId];
  if (!coach || !team) return null;
  return `${coach.name} (${team.identity.abbreviation}) — ${award.summary}`;
}
