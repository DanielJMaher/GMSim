import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createLeague,
  simulateSeason,
  advanceSeason,
  computeRecords,
  seasonStatsForLeague,
  seasonAwards,
  tickPhase,
  phaseCalendarLabel,
  phaseCalendarDate,
} from '@gmsim/engine';
import type { LeagueState, TeamId } from '@gmsim/engine/types';
import { Division } from '@gmsim/engine/types';
import { GameLabPanel } from './GameLab';
import { FrontOfficePanel } from './FrontOffice';
import { RatingsDistributionPanel } from './RatingsDistribution';
import {
  LeagueOverview,
  DivisionSection,
  TeamDetail,
  SeasonResultsView,
  SeasonLeadersView,
  AwardsView,
} from './tabs/LeagueTab';
import {
  CollegePoolPanel,
  DraftBoardsPanel,
  MediaMockBoardsPanel,
  MediaReliabilityPanel,
  GmMediaTrustPanel,
  DraftReplayPanel,
  DraftTradesPanel,
  DraftResultsPanel,
} from './tabs/DraftTab';
import { FreeAgentPoolPanel } from './tabs/FreeAgencyTab';
import { NewsFeedPanel, TransactionLogPanel } from './tabs/NewsTab';
import { LifecyclePanel, snapshotAnchor, formatDateOrEmpty } from './tabs/LifecycleTab';
import type { TickAnchor } from './tabs/LifecycleTab';
import {
  DraftShiftPanel,
  bigBoardColumnLabel,
  mediaPerceivedScores,
  BIG_BOARD_MAX_COLS,
} from './tabs/DraftShiftTab';
import type { PerceivedColumn } from './tabs/DraftShiftTab';
import { CollegeGamesPanel } from './tabs/CollegeGamesTab';
import { DraftAuditPanel } from './tabs/DraftAuditTab';
import { ScoutReportsPanel } from './tabs/ScoutReportsTab';

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

type InspectorTab = 'league' | 'game-lab' | 'draft' | 'scout-reports' | 'draft-shift' | 'draft-audit' | 'college-games' | 'free-agency' | 'front-office' | 'histograms' | 'news' | 'lifecycle';

interface TabDef {
  id: InspectorTab;
  label: string;
  /** Active-tab classes — full strings so Tailwind JIT picks them up. */
  activeClasses: string;
}

const TAB_DEFS: readonly TabDef[] = [
  {
    id: 'league',
    label: 'League',
    activeClasses: 'border-emerald-400 bg-emerald-500/10 text-emerald-200',
  },
  {
    id: 'game-lab',
    label: 'Game Lab',
    activeClasses: 'border-blue-400 bg-blue-500/10 text-blue-200',
  },
  {
    id: 'draft',
    label: 'Draft',
    activeClasses: 'border-violet-400 bg-violet-500/10 text-violet-200',
  },
  {
    id: 'scout-reports',
    label: 'Scout Reports',
    activeClasses: 'border-indigo-400 bg-indigo-500/10 text-indigo-200',
  },
  {
    id: 'draft-shift',
    label: 'Big Board',
    activeClasses: 'border-cyan-400 bg-cyan-500/10 text-cyan-200',
  },
  {
    id: 'draft-audit',
    label: 'Draft Audit',
    activeClasses: 'border-teal-400 bg-teal-500/10 text-teal-200',
  },
  {
    id: 'college-games',
    label: 'CFB Games',
    activeClasses: 'border-orange-400 bg-orange-500/10 text-orange-200',
  },
  {
    id: 'free-agency',
    label: 'Free Agency',
    activeClasses: 'border-sky-400 bg-sky-500/10 text-sky-200',
  },
  {
    id: 'front-office',
    label: 'Front Office',
    activeClasses: 'border-fuchsia-400 bg-fuchsia-500/10 text-fuchsia-200',
  },
  {
    id: 'histograms',
    label: 'Histograms',
    activeClasses: 'border-lime-400 bg-lime-500/10 text-lime-200',
  },
  {
    id: 'news',
    label: 'News',
    activeClasses: 'border-amber-400 bg-amber-500/10 text-amber-200',
  },
  {
    id: 'lifecycle',
    label: 'Lifecycle',
    activeClasses: 'border-rose-400 bg-rose-500/10 text-rose-200',
  },
];

export function App() {
  const [seedDraft, setSeedDraft] = useState(DEFAULT_SEED);
  // Living Voice (v0.124): the voice seed is decoupled from the world seed —
  // it drives only what scouts/outlets SAY. Empty draft = use the deterministic
  // derived default (so a plain re-roll stays reproducible); the "🎲 Voice"
  // button fills it with fresh entropy for "same world, different voice."
  const [voiceSeedDraft, setVoiceSeedDraft] = useState('');
  const [league, setLeague] = useState<LeagueState>(() => createLeague({ seed: DEFAULT_SEED }));
  const [selectedTeamId, setSelectedTeamId] = useState<TeamId | null>(null);
  const [activeTab, setActiveTab] = useState<InspectorTab>('league');

  // Big Board: a per-media-round time series of each prospect's perceived
  // grade, captured as you step the lifecycle so you can watch draft
  // stock move through the season + draft process. Media-only (the
  // simplest single consensus stream). Lives at App level so it captures
  // every step regardless of the active tab; resets on a re-roll.
  const [perceivedHistory, setPerceivedHistory] = useState<PerceivedColumn[]>([]);
  const phSeedRef = useRef<string | null>(null);
  const phTickRef = useRef<number | null>(null);

  useEffect(() => {
    if (phSeedRef.current !== league.seed) {
      phSeedRef.current = league.seed;
      phTickRef.current = null;
      setPerceivedHistory([]);
    }
    // The media stream is replaced each coverage round; every obs in a
    // round shares its observedOnTick, so a changed round-tick = a new
    // round to snapshot. Capture one column per round.
    const roundTick = league.mediaCollegeObservations[0]?.observedOnTick ?? null;
    if (roundTick === null || roundTick === phTickRef.current) return;
    phTickRef.current = roundTick;
    const column: PerceivedColumn = {
      key: `${league.seasonNumber}:${roundTick}`,
      phase: league.lifecyclePhase,
      label: bigBoardColumnLabel(league.lifecyclePhase, league.collegeCurrentWeek),
      dateLabel: formatDateOrEmpty(
        phaseCalendarDate(
          league.lifecyclePhase,
          league.currentWeek,
          league.seasonNumber,
          league.collegeCurrentWeek,
        ),
      ),
      scores: mediaPerceivedScores(league),
    };
    setPerceivedHistory((cols) => [...cols, column].slice(-BIG_BOARD_MAX_COLS));
  }, [league]);

  const seasonSimmed = league.schedule !== null;
  // A season is "complete" (ready to advance) only when every regular-season
  // game has a result — NOT merely when the schedule object exists. The
  // schedule is generated and filled in week-by-week (the first regular-season
  // tick creates it with week 1 already played), so `schedule !== null` flips
  // true at 16/272 games. The header action used to read that as "season done"
  // and offer "Advance to Year N+1" from week 1 onward, so a tick-stepping user
  // could skip the rest of the season's results in one click. Gating Advance on
  // the games actually being played restores the clean simulate→advance step.
  const seasonComplete = useMemo(
    () =>
      league.schedule !== null &&
      league.schedule.regularSeason.every((week) => week.every((g) => g.result !== null)),
    [league],
  );
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
    setLeague(
      createLeague({
        seed: seedDraft || 'default',
        ...(voiceSeedDraft ? { voiceSeed: voiceSeedDraft } : {}),
      }),
    );
    setSelectedTeamId(null);
  }

  function randomizeVoice() {
    // Entropy drawn at the UI boundary only — never inside the engine (CLAUDE.md
    // invariant #2). Same world seed, fresh voice → hear this exact league told
    // by different scouts.
    const vs = `voice-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    setVoiceSeedDraft(vs);
    setLeague(createLeague({ seed: seedDraft || 'default', voiceSeed: vs }));
    setSelectedTeamId(null);
  }

  function simulate() {
    setLeague(simulateSeason(league));
  }

  function advance() {
    setLeague(advanceSeason(league));
  }

  // Tick stepping lives at App level so "Step Tick" can sit in the
  // header and work from every tab. The anchor captures the pre-tick
  // snapshot the lifecycle event log diffs against.
  const tickAnchorRef = useRef<TickAnchor>(snapshotAnchor(league));
  function stepTick() {
    tickAnchorRef.current = snapshotAnchor(league);
    setLeague(tickPhase(league));
  }
  function stepFullYear() {
    tickAnchorRef.current = snapshotAnchor(league);
    let l = league;
    // ~47 ticks in a full unified-calendar year; 80 is a safe margin.
    for (let i = 0; i < 80; i++) {
      const next = tickPhase(l);
      if (next === l) break;
      l = next;
    }
    setLeague(l);
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
      <header className="mb-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            GMSim{' '}
            <span className="ml-2 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 align-middle font-mono text-xs text-zinc-400">
              v{__APP_VERSION__}
            </span>
            <span className="ml-2 text-base font-normal text-zinc-500">
              Season {league.seasonNumber}
              {!seasonSimmed ? ' (preseason)' : seasonComplete ? ' (complete)' : ' (in progress)'}
            </span>
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Phase 2 dev inspector — exposes raw engine state for verification.
            Not player-facing.
          </p>
        </div>
      </header>

      {/* Sticky control + tab bar — frozen to the top so you can step
          ticks while scrolled anywhere in the inspector. */}
      <div className="sticky top-0 z-30 mb-6 -mx-6 border-b border-zinc-800 bg-zinc-950/95 px-6 py-2 backdrop-blur lg:-mx-10 lg:px-10">
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
            <label className="text-xs uppercase tracking-wide text-zinc-500" htmlFor="voiceSeed">
              voice
            </label>
            <input
              id="voiceSeed"
              value={voiceSeedDraft}
              placeholder={league.voiceSeed}
              onChange={(e) => setVoiceSeedDraft(e.target.value)}
              title={`Living Voice seed — drives only what scouts & outlets SAY, not the world (players, ratings, results). Active: ${league.voiceSeed}`}
              className="w-28 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 font-mono text-sm text-violet-300 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={randomizeVoice}
              title="Same world seed, fresh voice — hear this exact league told by different scouts."
              className="rounded border border-violet-500/40 bg-violet-500/10 px-3 py-1 text-sm text-violet-300 hover:bg-violet-500/20"
            >
              🎲 Voice
            </button>
          </form>
          {seasonComplete ? (
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
              {seasonSimmed ? 'Finish' : 'Simulate'} Season {league.seasonNumber}
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
          {/* Step Tick lives in the header so it's available on every tab. */}
          <div className="flex items-center gap-2">
            <button
              onClick={stepTick}
              className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-sm text-rose-200 hover:bg-rose-500/20"
            >
              Step Tick
            </button>
            <span className="font-mono text-[10px] leading-tight text-zinc-500">
              {phaseCalendarLabel(
                league.lifecyclePhase,
                league.currentWeek,
                league.collegeCurrentWeek,
              )}
            </span>
          </div>
        </div>
        <TabNav
          active={activeTab}
          onChange={setActiveTab}
          leagueCounts={{
            collegeProspects: league.collegePool.length,
            freeAgents: Object.values(league.players).filter((p) => p.teamId === null).length,
            recentTransactions: league.transactionLog.length,
          }}
        />
      </div>

      {activeTab === 'league' && (
        <>
          <LeagueOverview league={league} />

          {seasonSimmed && records && <SeasonResultsView league={league} records={records} />}

          {seasonSimmed && seasonStats && (
            <SeasonLeadersView league={league} stats={seasonStats} />
          )}

          {seasonSimmed && awards && <AwardsView league={league} awards={awards} />}

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
        </>
      )}

      {activeTab === 'draft' && (
        <>
          <CollegePoolPanel league={league} />
          <DraftBoardsPanel league={league} />
          <MediaMockBoardsPanel league={league} />
          <MediaReliabilityPanel league={league} />
          <GmMediaTrustPanel league={league} />
          <DraftReplayPanel league={league} />
          <DraftTradesPanel league={league} />
          <DraftResultsPanel league={league} />
        </>
      )}

      {activeTab === 'game-lab' && <GameLabPanel league={league} />}

      {activeTab === 'scout-reports' && <ScoutReportsPanel league={league} />}

      {activeTab === 'draft-audit' && <DraftAuditPanel league={league} />}

      {activeTab === 'draft-shift' && (
        <DraftShiftPanel league={league} history={perceivedHistory} />
      )}

      {activeTab === 'college-games' && (
        <CollegeGamesPanel league={league} />
      )}

      {activeTab === 'free-agency' && (
        <FreeAgentPoolPanel league={league} />
      )}

      {activeTab === 'front-office' && <FrontOfficePanel league={league} />}

      {activeTab === 'histograms' && <RatingsDistributionPanel league={league} />}

      {activeTab === 'news' && (
        <>
          <NewsFeedPanel league={league} />
          <TransactionLogPanel league={league} />
        </>
      )}

      {activeTab === 'lifecycle' && (
        <LifecyclePanel
          league={league}
          anchor={tickAnchorRef.current}
          onStepFullYear={stepFullYear}
        />
      )}

      {/* TeamDetail modal renders over the active tab. */}
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
    </main>
  );
}

function TabNav({
  active,
  onChange,
  leagueCounts,
}: {
  active: InspectorTab;
  onChange: (t: InspectorTab) => void;
  leagueCounts: {
    collegeProspects: number;
    freeAgents: number;
    recentTransactions: number;
  };
}) {
  const countFor = (tab: InspectorTab): number | null => {
    switch (tab) {
      case 'draft':
        return leagueCounts.collegeProspects;
      case 'free-agency':
        return leagueCounts.freeAgents;
      case 'news':
        return leagueCounts.recentTransactions;
      case 'league':
        return null;
      case 'game-lab':
        return null;
      case 'scout-reports':
        return null;
      case 'draft-shift':
        return null;
      case 'draft-audit':
        return null;
      case 'college-games':
        return null;
      case 'front-office':
        return null;
      case 'histograms':
        return null;
      case 'lifecycle':
        return null;
    }
  };
  return (
    <nav className="mt-2">
      <div className="flex flex-wrap gap-1">
        {TAB_DEFS.map((tab) => {
          const isActive = tab.id === active;
          const count = countFor(tab.id);
          return (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              className={`group flex items-baseline gap-2 rounded-t border-b-2 px-3 py-1.5 text-sm transition-colors ${
                isActive
                  ? tab.activeClasses
                  : 'border-transparent text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
              }`}
            >
              <span className="font-medium">{tab.label}</span>
              {count !== null && (
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-mono ${
                    isActive ? 'bg-zinc-900/60 text-zinc-300' : 'bg-zinc-900/40 text-zinc-500 group-hover:text-zinc-400'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
