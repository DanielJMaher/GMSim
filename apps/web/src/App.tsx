import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  seasonStatsForTeam,
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
  PlayerSkills,
  PlayerSeasonStats,
  CareerAward,
  TeamId,
  Contract,
  Transaction,
  Scout,
  ScoutQuirk,
  PlayerObservation,
  WatchListEntry,
  WatchListReason,
  CollegePlayer,
  ClassYear,
  CharacterFlag,
  DraftBoardEntry,
  DraftBoardReason,
  CombineMeasurables,
  CollegeScout,
  ScoutRegion,
  DraftPickRecord,
  MediaOutletId,
} from '@gmsim/engine/types';
import { Division, PositionGroup, Position, Conference } from '@gmsim/engine/types';
import { getSchoolById, positionGroupFor, computeConsensusBoard, consensusRankIndex, computeTeamNeeds, hasDesperateQbNeed, aggregateCollegeSeasonStats, collegeStatLeaders, computeMediaConsensusBoard, computeOutletMockBoard, computeOutletQualityByGroup, collegeTeamStrength, bucketProspectsBySchool, getAbility, describeAbilityHint, draftGradeFromOverall, draftGradeLabel, formatDraftGrade, prospectProjectedOverall, narrateBackstory, backstoryFromProspect, assembleProspectDossier, prospectSnapshot, careerShapeFor, declineMultiplierFor, curveForPosition } from '@gmsim/engine';
import type { CareerShape } from '@gmsim/engine';
import { GameViewReport } from './GameView';
import { DepthChartCard } from './DepthChart';
import { RatingsDistributionPanel } from './RatingsDistribution';
import { FrontOfficePanel } from './FrontOffice';
import type { ProspectDossier, DossierViewer, AttributedPoint } from '@gmsim/engine';
import type { OutletGroupQuality } from '@gmsim/engine';
import type { CollegeSeasonStatLine, CollegeStatCategory } from '@gmsim/engine/types';
import type { PositionNeed } from '@gmsim/engine';
import {
  tickPhase,
  phaseCalendarLabel,
  phaseCalendarDate,
  formatCalendarDate,
  buildSeasonTimeline,
  TRADE_DEADLINE_WEEK_INDEX,
} from '@gmsim/engine';
import type { LifecyclePhase, CalendarDate, TimelineStep, MediaReport } from '@gmsim/engine';
import type { CollegeGame, CollegeGameKind, CollegePlayerGameStats } from '@gmsim/engine/types';

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

type InspectorTab = 'league' | 'draft' | 'scout-reports' | 'draft-shift' | 'draft-audit' | 'college-games' | 'free-agency' | 'front-office' | 'histograms' | 'news' | 'lifecycle';

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

// ─── COLLEGE POOL PANEL (Doc 3 — Draft Module slice 1) ─────────────────────

const CLASS_YEAR_LABELS: Record<ClassYear, string> = {
  TRUE_FR: 'True FR',
  RS_FR: 'RS FR',
  SO: 'SO',
  JR: 'JR',
  SR: 'SR',
  RS_SR: 'RS SR',
};

const CLASS_YEAR_ORDER: readonly ClassYear[] = [
  'TRUE_FR', 'RS_FR', 'SO', 'JR', 'SR', 'RS_SR',
];

const VOICE_LABELS: Record<CollegePlayer['personalityVoice'], string> = {
  QUIET_WORKER: 'Quiet worker',
  ALPHA_LEADER: 'Alpha leader',
  BRASH: 'Brash',
  ANALYTICAL: 'Analytical',
  INSTINCTIVE: 'Instinctive',
  CHARISMATIC: 'Charismatic',
};

const FLAG_LABELS: Record<CharacterFlag, string> = {
  OFF_FIELD_INCIDENT: 'Off-field',
  COACH_CONFLICT: 'Coach conflict',
  INJURY_PRONE: 'Injury prone',
  LATE_BLOOMER: 'Late bloomer',
  TRANSFER_PORTAL: 'Transfer',
  CAPTAIN: 'Captain',
  ACADEMIC_HONORS: 'Academic',
  MEDIA_DARLING: 'Media darling',
  PRACTICE_LEGEND: 'Practice legend',
  WORKOUT_WARRIOR: 'Workout warrior',
  TAPE_STAR_POOR_TESTER: 'Tape star',
  SYSTEM_PRODUCT: 'System product',
  LEGACY: 'Legacy',
};

function CollegePoolPanel({ league }: { league: LeagueState }) {
  const [expanded, setExpanded] = useState(false);
  const [expandedProspectId, setExpandedProspectId] = useState<PlayerId | null>(null);
  const pool = league.collegePool;
  const observations = league.collegeObservations;
  const collegeScouts = league.collegeScouts;

  // Consensus board derived from the league-wide 32 boards. Doc 3:
  // teams don't internally consume a consensus — engine never reads
  // this — but the inspector treats it as the most useful "what's
  // the league as a whole thinking" view of the prospect pool.
  const consensus = useMemo(
    () => computeConsensusBoard(league.draftBoards),
    [league.draftBoards],
  );
  const consensusRanks = useMemo(() => consensusRankIndex(consensus), [consensus]);
  // League's perceived grade per prospect (mean observed-skill across the
  // 32 boards) — shown vs the prospect's real overall on each row.
  const perceivedGrades = useMemo(() => consensusPerceivedGrades(league), [league]);

  const classCounts = useMemo(() => {
    const counts = new Map<ClassYear, number>();
    for (const cp of pool) counts.set(cp.classYear, (counts.get(cp.classYear) ?? 0) + 1);
    return counts;
  }, [pool]);

  const observationsByProspect = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of observations) m.set(o.collegePlayerId, (m.get(o.collegePlayerId) ?? 0) + 1);
    return m;
  }, [observations]);

  const collegeScoutCount = Object.keys(collegeScouts).length;

  const summary = useMemo(() => {
    let conversionCandidates = 0;
    let archetypeMisreads = 0;
    let withCharacterFlags = 0;
    let withBloodlines = 0;
    let starRatingHigh = 0;
    let smallSchoolGems = 0;
    for (const cp of pool) {
      if (cp.isConversionCandidate) conversionCandidates++;
      if (cp.archetypeMisreadFlag) archetypeMisreads++;
      if (cp.characterFlags.length > 0) withCharacterFlags++;
      if (cp.bloodline.hasNflFamily) withBloodlines++;
      if (cp.recruiting.starRating >= 4) starRatingHigh++;
      if (cp.recruiting.background === 'SMALL_SCHOOL_GEM' || cp.recruiting.background === 'WALK_ON_STORY') {
        smallSchoolGems++;
      }
    }
    return {
      conversionCandidates,
      archetypeMisreads,
      withCharacterFlags,
      withBloodlines,
      starRatingHigh,
      smallSchoolGems,
    };
  }, [pool]);

  const draftEligible = useMemo(
    () => pool.filter((cp) => cp.isDraftEligible),
    [pool],
  );

  // Consensus-ordered featured list. Prospects with no consensus
  // entry (i.e., not on any team's top-N board) fall to the bottom.
  // Per Doc 3 the boards filter to draft-eligible prospects, so the
  // consensus-eligible set ≈ the draftable cohort.
  const featured = useMemo(() => {
    const cpById = new Map(pool.map((cp) => [cp.id, cp] as const));
    const orderedFromConsensus: CollegePlayer[] = [];
    for (const entry of consensus) {
      const cp = cpById.get(entry.collegePlayerId);
      if (!cp) continue;
      if (!cp.isDraftEligible) continue;
      orderedFromConsensus.push(cp);
    }
    return orderedFromConsensus.slice(0, expanded ? 60 : 15);
  }, [consensus, pool, expanded]);

  return (
    <section className="mb-8 rounded border border-violet-500/30 bg-violet-500/5 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-violet-300">
          Consensus Board — Live Draft Class (aggregated from 32 boards)
        </h2>
        <span className="text-xs text-zinc-500">
          {pool.length} prospects · {draftEligible.length} draft-eligible
          {' · '}
          <span className="text-violet-400">{consensus.length} on consensus</span>
          {' · '}
          <span className="text-violet-400">{collegeScoutCount} college scouts</span>
          {' · '}
          <span className="text-violet-400">{observations.length} reports</span>
        </span>
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2 md:grid-cols-6">
        {CLASS_YEAR_ORDER.map((year) => (
          <div key={year} className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">
              {CLASS_YEAR_LABELS[year]}
            </div>
            <div className="font-mono text-sm text-zinc-200">{classCounts.get(year) ?? 0}</div>
          </div>
        ))}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-3">
        <CollegePoolStat label="Conversion candidates" value={summary.conversionCandidates} />
        <CollegePoolStat label="Archetype misreads" value={summary.archetypeMisreads} />
        <CollegePoolStat label="With character flags" value={summary.withCharacterFlags} />
        <CollegePoolStat label="NFL bloodlines" value={summary.withBloodlines} />
        <CollegePoolStat label="4–5 star recruits" value={summary.starRatingHigh} />
        <CollegePoolStat label="Small-school / walk-ons" value={summary.smallSchoolGems} />
      </div>

      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Consensus top {featured.length} · ranked by mean priority across teams that carry the prospect
        </h3>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="rounded border border-zinc-700 bg-zinc-900/40 px-2 py-0.5 text-[11px] text-zinc-300 hover:border-violet-500/40 hover:text-violet-300"
        >
          {expanded ? 'show fewer' : 'show more'}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-zinc-500">
            <tr className="border-b border-zinc-800">
              <th className="px-2 py-1 text-right" title="Consensus rank — 1-based across the prospects on ≥1 team's board">#</th>
              <th className="px-2 py-1 text-left">Prospect</th>
              <th className="px-2 py-1 text-left">Class</th>
              <th className="px-2 py-1 text-left">School</th>
              <th className="px-2 py-1 text-left">Pos</th>
              <th className="px-2 py-1 text-left">NFL proj</th>
              <th className="px-2 py-1 text-right" title="perceived (league avg observed) / real overall">Grade</th>
              <th className="px-2 py-1 text-right" title="Draft grade (NFL.com 8-pt scale) — perceived (league consensus) / real (ground truth)">Draft grd</th>
              <th className="px-2 py-1 text-center" title="Teams (of 32) with this prospect on their top-50 board">Boards</th>
              <th className="px-2 py-1 text-center" title="Mean priority across teams that carry the prospect">Avg pri</th>
              <th className="px-2 py-1 text-center" title="Mean board rank across teams that carry the prospect">Avg rk</th>
              <th className="px-2 py-1 text-center">★</th>
              <th className="px-2 py-1 text-center">Tier</th>
              <th className="px-2 py-1 text-center" title="Reports filed by college scouts on this prospect">Reports</th>
              <th className="px-2 py-1 text-center" title="Combine 40-yard dash (italic = skipped)">40</th>
              <th className="px-2 py-1 text-left">Flags</th>
            </tr>
          </thead>
          <tbody>
            {featured.map((cp) => {
              const combine = league.combineResults[cp.id];
              const isOpen = expandedProspectId === cp.id;
              const consRank = consensusRanks.get(cp.id) ?? null;
              const consEntry = consRank !== null ? consensus[consRank - 1] ?? null : null;
              return (
                <React.Fragment key={cp.id}>
                  <CollegeProspectRow
                    prospect={cp}
                    reportCount={observationsByProspect.get(cp.id) ?? 0}
                    consensusRank={consRank}
                    consensusEntry={consEntry}
                    perceivedGrade={perceivedGrades.get(cp.id) ?? null}
                    isOpen={isOpen}
                    onClick={() =>
                      setExpandedProspectId(isOpen ? null : cp.id)
                    }
                    {...(combine ? { combine } : {})}
                  />
                  {isOpen && (
                    <tr className="border-t border-zinc-800 bg-zinc-950/60">
                      <td colSpan={16} className="px-3 py-3">
                        <CollegeProspectDetail prospect={cp} league={league} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[10px] text-zinc-600">
        Consensus is diagnostic-only — the engine doesn't internally consume it (Doc 3:
        "no global consensus anything"). Boards column = teams (of 32) with this prospect
        on their top-50 board. Click a row for the full prospect dossier.
      </p>
    </section>
  );
}

function CollegePoolStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1">
      <span className="text-zinc-500">{label}: </span>
      <span className="font-mono text-zinc-200">{value}</span>
    </div>
  );
}

function CollegeProspectRow({
  prospect,
  reportCount,
  combine,
  consensusRank,
  consensusEntry,
  perceivedGrade,
  isOpen,
  onClick,
}: {
  prospect: CollegePlayer;
  reportCount: number;
  combine?: CombineMeasurables;
  consensusRank: number | null;
  consensusEntry: { appearances: number; averagePriority: number; averageRank: number } | null;
  perceivedGrade: number | null;
  isOpen: boolean;
  onClick: () => void;
}) {
  const school = getSchoolById(prospect.schoolId);
  const tierColor =
    prospect.tier === 'STAR' ? 'text-amber-300'
      : prospect.tier === 'STARTER' ? 'text-emerald-300'
        : prospect.tier === 'BACKUP' ? 'text-zinc-300'
          : 'text-zinc-500';
  const conversionTag = prospect.isConversionCandidate ? (
    <span className="ml-1 rounded bg-violet-500/20 px-1 text-[9px] font-mono text-violet-300" title="Conversion candidate">
      conv
    </span>
  ) : null;
  const misreadTag = prospect.archetypeMisreadFlag ? (
    <span className="ml-1 rounded bg-amber-500/20 px-1 text-[9px] font-mono text-amber-300" title="Assumed archetype differs from true archetype">
      misread
    </span>
  ) : null;
  const tierBadge = school ? (
    <span className={`ml-1 text-[9px] uppercase ${
      school.tier === 'POWER' ? 'text-emerald-400'
      : school.tier === 'GROUP_OF_5' ? 'text-sky-400'
      : school.tier === 'FCS' ? 'text-zinc-400' : 'text-zinc-600'}`}>
      {school.tier === 'GROUP_OF_5' ? 'G5' : school.tier === 'POWER' ? 'P5' : school.tier}
    </span>
  ) : null;
  const flagSummary = prospect.characterFlags.slice(0, 3).map((f) => FLAG_LABELS[f]).join(', ');
  return (
    <tr
      className={`cursor-pointer border-b border-zinc-900 hover:bg-zinc-900/30 ${isOpen ? 'bg-zinc-900/40' : ''}`}
      onClick={onClick}
    >
      <td className="px-2 py-1 text-right font-mono text-zinc-300">
        {consensusRank !== null ? consensusRank : <span className="text-zinc-700">—</span>}
      </td>
      <td className="px-2 py-1">
        <div className="font-medium text-zinc-100">
          <span className="mr-1 text-zinc-600">{isOpen ? '▼' : '▶'}</span>
          {prospect.firstName} {prospect.lastName}
        </div>
        <div className="text-[10px] text-zinc-500">
          {prospect.recruiting.hometown.city}, {prospect.recruiting.hometown.state}
          {prospect.bloodline.hasNflFamily && (
            <span className="ml-1 text-amber-400" title={`NFL ${prospect.bloodline.relation?.toLowerCase()}: ${prospect.bloodline.relativeName}`}>
              ⚜
            </span>
          )}
        </div>
      </td>
      <td className="px-2 py-1 font-mono text-zinc-400">{CLASS_YEAR_LABELS[prospect.classYear]}</td>
      <td className="px-2 py-1">
        <span className="text-zinc-300">{school?.name ?? prospect.schoolId}</span>
        {tierBadge}
      </td>
      <td className="px-2 py-1 font-mono text-zinc-300">{prospect.collegePosition}</td>
      <td className="px-2 py-1 font-mono">
        <span className={prospect.isConversionCandidate ? 'text-violet-300' : 'text-zinc-400'}>
          {prospect.nflProjectedPosition}
        </span>
        {conversionTag}
        {misreadTag}
      </td>
      <td className="px-2 py-1 text-right">
        <GradeCell
          perceived={perceivedGrade}
          real={prospectRealGradeFromCp(prospect)}
        />
      </td>
      <td className="px-2 py-1 text-right">
        <DraftGradeCell
          perceivedOverall={perceivedGrade}
          realOverall={prospectProjectedOverall(prospect)}
        />
      </td>
      <td className="px-2 py-1 text-center font-mono text-zinc-300">
        {consensusEntry ? (
          <span
            className={
              consensusEntry.appearances >= 20
                ? 'text-emerald-300'
                : consensusEntry.appearances >= 10
                  ? 'text-zinc-300'
                  : 'text-zinc-500'
            }
          >
            {consensusEntry.appearances}/32
          </span>
        ) : (
          <span className="text-zinc-700">—</span>
        )}
      </td>
      <td className="px-2 py-1 text-center font-mono text-zinc-300">
        {consensusEntry ? consensusEntry.averagePriority.toFixed(0) : <span className="text-zinc-700">—</span>}
      </td>
      <td className="px-2 py-1 text-center font-mono text-zinc-400">
        {consensusEntry ? consensusEntry.averageRank.toFixed(1) : <span className="text-zinc-700">—</span>}
      </td>
      <td className="px-2 py-1 text-center font-mono text-zinc-300">{prospect.recruiting.starRating}</td>
      <td className={`px-2 py-1 text-center font-mono ${tierColor}`}>{prospect.tier}</td>
      <td className={`px-2 py-1 text-center font-mono ${reportCount === 0 ? 'text-zinc-700' : reportCount >= 8 ? 'text-violet-300' : 'text-zinc-400'}`}>
        {reportCount}
      </td>
      <td className="px-2 py-1 text-center font-mono text-xs">
        {combine?.fortyYardSeconds !== undefined ? (
          <span className="text-emerald-300">{combine.fortyYardSeconds.toFixed(2)}</span>
        ) : combine ? (
          <span className="italic text-zinc-600" title="Prospect skipped this drill">DNP</span>
        ) : (
          <span className="text-zinc-700">—</span>
        )}
      </td>
      <td className="px-2 py-1 text-[10px] text-zinc-400">{flagSummary || <span className="text-zinc-600">—</span>}</td>
    </tr>
  );
}

function CollegeProspectDetail({
  prospect,
  league,
}: {
  prospect: CollegePlayer;
  league: LeagueState;
}) {
  const school = getSchoolById(prospect.schoolId);
  const trueArchetype = getArchetypeById(prospect.archetype);
  const assumedArchetype = getArchetypeById(prospect.assumedArchetype);
  const combine = league.combineResults[prospect.id];

  // Map of all college scouts → owning team for observation attribution.
  const scoutToTeam = useMemo(() => {
    const m = new Map<string, TeamState>();
    for (const team of Object.values(league.teams)) {
      for (const sid of team.collegeScoutIds) m.set(sid, team);
    }
    return m;
  }, [league.teams]);

  // All observations of this prospect, sorted by mean confidence desc.
  const prospectObservations = useMemo(() => {
    const obs = league.collegeObservations.filter((o) => o.collegePlayerId === prospect.id);
    const withMean = obs.map((o) => {
      const confs = Object.values(o.confidence).filter((c): c is number => typeof c === 'number');
      const mean = confs.length === 0 ? 0 : confs.reduce((s, c) => s + c, 0) / confs.length;
      return { obs: o, meanConf: mean };
    });
    withMean.sort((a, b) => b.meanConf - a.meanConf);
    return withMean;
  }, [league.collegeObservations, prospect.id]);

  // Which teams have this prospect on their draft board, and at what rank/priority/reason.
  const boardPlacements = useMemo(() => {
    const out: Array<{ team: TeamState; rank: number; entry: DraftBoardEntry }> = [];
    for (const team of Object.values(league.teams)) {
      const board = league.draftBoards[team.identity.id] ?? [];
      const idx = board.findIndex((e) => e.collegePlayerId === prospect.id);
      if (idx >= 0) {
        out.push({ team, rank: idx + 1, entry: board[idx]! });
      }
    }
    out.sort((a, b) => b.entry.priority - a.entry.priority);
    return out;
  }, [league.teams, league.draftBoards, prospect.id]);

  // Media takes about this prospect that carry a fuller scout report (v0.118) —
  // the Scribe's prose beneath the headline.
  const mediaScoutReports = useMemo(
    () =>
      league.mediaReports
        .filter(
          (r): r is Extract<MediaReport, { kind: 'player-take' }> =>
            r.kind === 'player-take' && r.subjectPlayerId === prospect.id && !!r.scoutReport,
        )
        .map((r) => ({ report: r, outlet: league.mediaOutlets[r.outletId] })),
    [league.mediaReports, league.mediaOutlets, prospect.id],
  );

  const m = prospect.measurables;
  const intang = prospect.hiddenIntangibles;

  return (
    <div className="space-y-3 text-xs">
      {/* Header strip */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-zinc-800 pb-2">
        <div className="text-sm font-semibold text-zinc-100">
          {prospect.firstName} {prospect.lastName}
        </div>
        <div className="text-zinc-400">
          {school?.name ?? prospect.schoolId} ({school?.conferenceId ?? '?'},{' '}
          {school?.tier === 'GROUP_OF_5' ? 'G5' : school?.tier ?? '?'})
        </div>
        <div className="text-zinc-500">
          {CLASS_YEAR_LABELS[prospect.classYear]} · {prospect.tier.toLowerCase()} ·{' '}
          {trueArchetype?.label ?? prospect.archetype}
        </div>
        <div className="text-zinc-600">
          born {prospect.birthDate} ·{' '}
          {prospect.recruiting.hometown.city}, {prospect.recruiting.hometown.state}
        </div>
        {prospect.bloodline.hasNflFamily && (
          <div className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
            NFL legacy: {prospect.bloodline.relation?.toLowerCase()} {prospect.bloodline.relativeName}
            {prospect.bloodline.relativeWasStar && ' ★'}
          </div>
        )}
      </div>

      {trueArchetype?.description && (
        <div className="text-zinc-500">{trueArchetype.description}</div>
      )}

      {/* Backstory — the Narrator's prose from the prospect's bio facts (v0.119) */}
      <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
        <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Backstory</div>
        <div className="text-zinc-300">{narrateBackstory(backstoryFromProspect(prospect))}</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {[
            prospect.transferred && 'Transfer',
            prospect.redshirted && 'Redshirt',
          ]
            .filter((x): x is string => Boolean(x))
            .map((label) => (
              <span
                key={label}
                className="rounded border border-teal-500/30 bg-teal-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-teal-300"
              >
                {label}
              </span>
            ))}
        </div>
      </div>

      {/* Recruiting / Personality / Archetype tension */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Recruiting</div>
          <div className="font-mono text-amber-300">
            {'★'.repeat(prospect.recruiting.starRating)}
            <span className="text-zinc-700">{'★'.repeat(5 - prospect.recruiting.starRating)}</span>
          </div>
          <div className="text-zinc-400">
            National rank: {prospect.recruiting.nationalRank ?? <span className="text-zinc-600">unranked</span>}
          </div>
          <div className="text-zinc-400">
            Background:{' '}
            <span className="font-mono uppercase tracking-wider text-zinc-300">
              {prospect.recruiting.background}
            </span>
          </div>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
            Personality (inspector view — hidden)
          </div>
          <div className="text-zinc-300">Voice: {VOICE_LABELS[prospect.personalityVoice]}</div>
          <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono text-zinc-400">
            <span>leader {intang.leadershipPresence}</span>
            <span>interview {intang.interviewSkill}</span>
            <span>work {intang.workEthic}</span>
            <span>coach {intang.coachability}</span>
            <span>compete {intang.competitiveness}</span>
            <span>fb char {intang.footballCharacter}</span>
          </div>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Archetype</div>
          <div className="text-zinc-300">
            True: <span className="font-mono">{trueArchetype?.label ?? prospect.archetype}</span>
          </div>
          <div className="text-zinc-300">
            Assumed:{' '}
            <span className="font-mono">{assumedArchetype?.label ?? prospect.assumedArchetype}</span>
          </div>
          {prospect.archetypeMisreadFlag ? (
            <div className="mt-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
              MISREAD — assumed differs from true
            </div>
          ) : (
            <div className="mt-1 text-[10px] text-zinc-600">aligned</div>
          )}
        </div>
      </div>

      {/* Position projection */}
      <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
        <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
          Position projection
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 text-zinc-300">
          <span>
            College:{' '}
            <span className="font-mono text-zinc-200">{prospect.collegePosition}</span>
          </span>
          <span>
            NFL projection:{' '}
            <span
              className={`font-mono ${prospect.isConversionCandidate ? 'text-violet-300' : 'text-zinc-200'}`}
            >
              {prospect.nflProjectedPosition}
            </span>
          </span>
          {prospect.isConversionCandidate && (
            <span className="rounded border border-violet-500/40 bg-violet-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-violet-300">
              conversion candidate
            </span>
          )}
          {prospect.alternatePositions.length > 0 && (
            <span className="text-zinc-500">
              alts:{' '}
              <span className="font-mono text-zinc-400">
                {prospect.alternatePositions.join(', ')}
              </span>
            </span>
          )}
        </div>
      </div>

      {/* Skills (current / ceiling) */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {SKILL_GROUPS.filter(
          (g) => !g.forGroups || g.forGroups.includes(positionGroupFor(prospect.nflProjectedPosition)),
        ).map((groupDef) => (
          <div key={groupDef.label} className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
              {groupDef.label}
            </div>
            <table className="w-full">
              <tbody>
                {groupDef.skills.map((skill) => {
                  const cur = prospect.current[skill];
                  const ceil = prospect.ceiling[skill];
                  return (
                    <tr key={skill}>
                      <td className="py-0.5 pr-2 text-zinc-400">{SKILL_LABELS[skill]}</td>
                      <td className={`py-0.5 pr-1 text-right font-mono ${skillTone(cur)}`}>{cur}</td>
                      <td
                        className="py-0.5 pr-2 text-right font-mono text-zinc-600"
                        title="Hidden ceiling — never shown to player"
                      >
                        /{ceil}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* Measurables + combine side by side */}
      <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
        <div className="mb-1 flex items-baseline justify-between text-[10px] uppercase tracking-wider text-zinc-500">
          <span>Measurables (truth vs combine)</span>
          <span className="normal-case text-zinc-600">
            italic = drill skipped; emerald = combine reported
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 sm:grid-cols-3 lg:grid-cols-5">
          <MeasureCell label="Height" truth={formatHeight(m.heightInches)} combine={combine?.heightInches !== undefined ? formatHeight(combine.heightInches) : undefined} attended={combine?.attended} />
          <MeasureCell label="Weight" truth={`${Math.round(m.weightLbs)} lb`} combine={combine?.weightLbs !== undefined ? `${Math.round(combine.weightLbs)} lb` : undefined} attended={combine?.attended} />
          <MeasureCell label="Arm" truth={formatInches(m.armLengthInches)} combine={combine?.armLengthInches !== undefined ? formatInches(combine.armLengthInches) : undefined} attended={combine?.attended} />
          <MeasureCell label="Hand" truth={formatInches(m.handSizeInches)} combine={combine?.handSizeInches !== undefined ? formatInches(combine.handSizeInches) : undefined} attended={combine?.attended} />
          <MeasureCell label="40-yd" truth={`${m.fortyYardSeconds.toFixed(2)}s`} combine={combine?.fortyYardSeconds !== undefined ? `${combine.fortyYardSeconds.toFixed(2)}s` : undefined} attended={combine?.attended} />
          <MeasureCell label="Bench" truth={`${m.benchPress225Reps}`} combine={combine?.benchPress225Reps !== undefined ? `${combine.benchPress225Reps}` : undefined} attended={combine?.attended} />
          <MeasureCell label="Vertical" truth={formatInches(m.verticalInches)} combine={combine?.verticalInches !== undefined ? formatInches(combine.verticalInches) : undefined} attended={combine?.attended} />
          <MeasureCell label="Broad" truth={formatInches(m.broadJumpInches)} combine={combine?.broadJumpInches !== undefined ? formatInches(combine.broadJumpInches) : undefined} attended={combine?.attended} />
          <MeasureCell label="3-cone" truth={`${m.threeConeSeconds.toFixed(2)}s`} combine={combine?.threeConeSeconds !== undefined ? `${combine.threeConeSeconds.toFixed(2)}s` : undefined} attended={combine?.attended} />
          <MeasureCell label="Shuttle" truth={`${m.shuttleSeconds.toFixed(2)}s`} combine={combine?.shuttleSeconds !== undefined ? `${combine.shuttleSeconds.toFixed(2)}s` : undefined} attended={combine?.attended} />
        </div>
      </div>

      {/* Character flags */}
      {prospect.characterFlags.length > 0 && (
        <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
            Character flags
          </div>
          <div className="flex flex-wrap gap-1">
            {prospect.characterFlags.map((f) => (
              <span
                key={f}
                className="rounded border border-fuchsia-500/30 bg-fuchsia-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-fuchsia-300"
              >
                {FLAG_LABELS[f]}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Media scouting reports — the Scribe's prose beneath each take (v0.118) */}
      {mediaScoutReports.length > 0 && (
        <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
            Media scouting reports
          </div>
          <div className="space-y-2">
            {mediaScoutReports.map(({ report, outlet }) => {
              const sr = report.scoutReport!;
              return (
                <div key={report.id} className="border-l-2 border-zinc-700 pl-2">
                  <div className="text-[10px] uppercase tracking-wider text-sky-400/80">
                    {outlet?.name ?? report.outletId}
                  </div>
                  <div className="text-zinc-300">{report.headline}</div>
                  <div className="mt-1 text-zinc-400">{sr.summary}</div>
                  <ul className="mt-0.5 space-y-0.5">
                    {sr.strengths.map((s, i) => (
                      <li key={i} className="text-emerald-300/80">
                        + {s}
                      </li>
                    ))}
                    <li className="text-amber-300/80">– {sr.concern}</li>
                  </ul>
                  {sr.comp && <div className="mt-0.5 italic text-zinc-500">{sr.comp}</div>}
                  <div className="mt-0.5 text-zinc-300">→ {sr.bottomLine}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* College stats per year */}
      {prospect.collegeStats.length > 0 && (
        <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
            College production (year-by-year)
          </div>
          <table className="w-full font-mono text-[10px]">
            <thead className="text-zinc-500">
              <tr>
                <th className="text-left font-normal">Yr</th>
                <th className="text-left font-normal">School</th>
                <th className="text-right font-normal">G</th>
                <th className="text-right font-normal">GS</th>
                <th className="text-right font-normal" title="Position-specific headline stats">stats</th>
              </tr>
            </thead>
            <tbody>
              {prospect.collegeStats.map((cs, idx) => (
                <tr key={idx} className="text-zinc-300">
                  <td>{CLASS_YEAR_LABELS[cs.classYear]}</td>
                  <td className="text-zinc-400">{getSchoolById(cs.schoolId)?.name ?? cs.schoolId}</td>
                  <td className="text-right">{cs.games}</td>
                  <td className="text-right">{cs.starts}</td>
                  <td className="text-right text-zinc-400">{collegeStatHeadline(prospect.collegePosition, cs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Injury history */}
      {prospect.injuryHistory.length > 0 && (
        <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
            Injury history
          </div>
          <ul className="space-y-0.5 text-[11px]">
            {prospect.injuryHistory.map((inj, idx) => (
              <li key={idx} className="flex justify-between gap-3 text-zinc-300">
                <span>
                  <span className="font-mono text-zinc-500">{CLASS_YEAR_LABELS[inj.classYear]}</span>{' '}
                  {inj.label}
                </span>
                <span className="text-zinc-500">
                  {inj.severity.toLowerCase()} · missed {inj.gamesMissed}g
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Coach visits cross-team */}
      <CoachVisitsSection prospect={prospect} league={league} />

      {/* Scout observations cross-team */}
      <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
        <div className="mb-1 flex items-baseline justify-between text-[10px] uppercase tracking-wider text-zinc-500">
          <span>Scout reports ({prospectObservations.length})</span>
          {prospectObservations.length > 10 && (
            <span className="normal-case text-zinc-600">showing top 10 by confidence</span>
          )}
        </div>
        {prospectObservations.length === 0 ? (
          <div className="text-zinc-600">No scout reports filed — coverage gap.</div>
        ) : (
          <table className="w-full text-[10px]">
            <thead className="text-zinc-500">
              <tr>
                <th className="text-left font-normal">Scout</th>
                <th className="text-left font-normal">Team</th>
                <th className="text-right font-normal">Conf</th>
                <th className="text-right font-normal" title="Observed speed">spd</th>
                <th className="text-right font-normal" title="Observed football IQ">iq</th>
                <th className="text-right font-normal" title="Observed technical skill">tech</th>
                <th className="text-right font-normal" title="Sim tick observed">tick</th>
              </tr>
            </thead>
            <tbody>
              {prospectObservations.slice(0, 10).map(({ obs, meanConf }, idx) => {
                const scout = league.collegeScouts[obs.scoutId];
                const team = scoutToTeam.get(obs.scoutId);
                return (
                  <tr key={`${obs.scoutId}-${idx}`} className="text-zinc-300">
                    <td>{scout?.name ?? obs.scoutId}</td>
                    <td className="text-zinc-400">{team?.identity.abbreviation ?? '?'}</td>
                    <td className="text-right font-mono text-zinc-300">{meanConf.toFixed(2)}</td>
                    <td className="text-right font-mono text-zinc-400">{obs.skills.speed ?? '—'}</td>
                    <td className="text-right font-mono text-zinc-400">{obs.skills.footballIq ?? '—'}</td>
                    <td className="text-right font-mono text-zinc-400">{obs.skills.technicalSkill ?? '—'}</td>
                    <td className="text-right font-mono text-zinc-600">{obs.observedOnTick}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Draft board placements across the league */}
      <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
        <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
          On {boardPlacements.length}/32 team draft boards
        </div>
        {boardPlacements.length === 0 ? (
          <div className="text-zinc-600">No team currently has this prospect on their top-50 board.</div>
        ) : (
          <table className="w-full text-[10px]">
            <thead className="text-zinc-500">
              <tr>
                <th className="text-left font-normal">Team</th>
                <th className="text-right font-normal">Rank</th>
                <th className="text-right font-normal">Priority</th>
                <th className="text-right font-normal">Fit</th>
                <th className="text-left font-normal">Reason</th>
              </tr>
            </thead>
            <tbody>
              {boardPlacements.map(({ team, rank, entry }) => (
                <tr key={team.identity.id} className="text-zinc-300">
                  <td>{team.identity.abbreviation}</td>
                  <td className="text-right font-mono">#{rank}</td>
                  <td className="text-right font-mono text-amber-300">{entry.priority.toFixed(1)}</td>
                  <td className="text-right font-mono text-zinc-400">{entry.schemeFit.toFixed(2)}</td>
                  <td className={`text-[10px] uppercase ${REASON_COLORS[entry.reason]}`}>
                    {REASON_LABELS[entry.reason]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function MeasureCell({
  label,
  truth,
  combine,
  attended,
}: {
  label: string;
  truth: string;
  combine: string | undefined;
  attended: boolean | undefined;
}) {
  const skipped = attended === true && combine === undefined;
  return (
    <div className="flex items-baseline justify-between border-l border-zinc-800/60 pl-2">
      <span className="text-[10px] text-zinc-500">{label}</span>
      <span className="font-mono">
        <span className="text-zinc-400">{truth}</span>
        {combine !== undefined ? (
          <span className="ml-1 text-emerald-400" title="Combine reported">[{combine}]</span>
        ) : skipped ? (
          <span className="ml-1 italic text-zinc-600" title="Drill skipped at combine">[DNP]</span>
        ) : null}
      </span>
    </div>
  );
}

function CoachVisitsSection({
  prospect,
  league,
}: {
  prospect: CollegePlayer;
  league: LeagueState;
}) {
  // Map coach id → owning team for attribution.
  const coachToTeam = useMemo(() => {
    const m = new Map<string, TeamState>();
    for (const team of Object.values(league.teams)) {
      m.set(team.headCoachId, team);
    }
    return m;
  }, [league.teams]);

  const visits = useMemo(
    () =>
      league.coachVisitObservations
        .filter((v) => v.collegePlayerId === prospect.id)
        .sort((a, b) => b.observedOnTick - a.observedOnTick),
    [league.coachVisitObservations, prospect.id],
  );

  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
      <div className="mb-1 flex items-baseline justify-between text-[10px] uppercase tracking-wider text-zinc-500">
        <span>Coach visits ({visits.length})</span>
        <span className="normal-case text-zinc-600">
          intangibles + scheme fit only · higher accuracy than scouts
        </span>
      </div>
      {visits.length === 0 ? (
        <div className="text-zinc-600">No coach has filed a visit on this prospect yet.</div>
      ) : (
        <table className="w-full text-[10px]">
          <thead className="text-zinc-500">
            <tr>
              <th className="text-left font-normal">Coach</th>
              <th className="text-left font-normal">Team</th>
              <th className="text-right font-normal">Conf</th>
              <th className="text-right font-normal" title="Observed leadership">lead</th>
              <th className="text-right font-normal" title="Observed football IQ">iq</th>
              <th className="text-right font-normal" title="Observed coachability">coach</th>
              <th className="text-right font-normal" title="Observed technical skill (scheme fit proxy)">scheme</th>
              <th className="text-right font-normal" title="Sim tick observed">tick</th>
            </tr>
          </thead>
          <tbody>
            {visits.map((v, idx) => {
              const coach = league.coaches[v.coachId];
              const team = coachToTeam.get(v.coachId);
              const conf = v.confidence.leadership ?? v.confidence.footballIq ?? 0;
              return (
                <tr key={`${v.coachId}-${idx}`} className="text-zinc-300">
                  <td>{coach?.name ?? v.coachId}</td>
                  <td className="text-zinc-400">{team?.identity.abbreviation ?? '?'}</td>
                  <td className="text-right font-mono text-emerald-300">{conf.toFixed(2)}</td>
                  <td className="text-right font-mono text-zinc-300">{v.skills.leadership ?? '—'}</td>
                  <td className="text-right font-mono text-zinc-300">{v.skills.footballIq ?? '—'}</td>
                  <td className="text-right font-mono text-zinc-300">{v.skills.coachability ?? '—'}</td>
                  <td className="text-right font-mono text-zinc-300">{v.skills.technicalSkill ?? '—'}</td>
                  <td className="text-right font-mono text-zinc-600">{v.observedOnTick}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function collegeStatHeadline(
  position: Position,
  s: CollegePlayer['collegeStats'][number],
): string {
  switch (position) {
    case Position.QB:
      return `${s.passCompletions}/${s.passAttempts}, ${s.passingYards} yd, ${s.passingTds} TD, ${s.interceptionsThrown} INT`;
    case Position.RB:
    case Position.FB:
      return `${s.rushingAttempts} att, ${s.rushingYards} yd, ${s.rushingTds} TD`;
    case Position.WR:
    case Position.TE:
      return `${s.receptions} rec, ${s.receivingYards} yd, ${s.receivingTds} TD`;
    case Position.EDGE:
    case Position.DT:
    case Position.NT:
    case Position.OLB:
      return `${s.tackles} tkl, ${s.sacks} sk, ${s.forcedFumbles} FF`;
    case Position.ILB:
      return `${s.tackles} tkl, ${s.sacks} sk, ${s.interceptions} INT`;
    case Position.CB:
    case Position.NICKEL:
    case Position.S:
      return `${s.tackles} tkl, ${s.interceptions} INT, ${s.passesDefended} PD`;
    default:
      return `${s.games} g / ${s.starts} GS`;
  }
}

// ─── TEAM NEEDS STRIP (v0.55) ──────────────────────────────────────────────
//
// Compact display of a team's top-N positional needs, computed from
// `computeTeamNeeds`. Reused in DraftBoardsPanel (per-team) and
// DraftReplayPanel (on-clock team at each pick).

function TeamNeedsStrip({
  needs,
  topN = 5,
  label = 'Needs (now)',
  tone = 'amber',
  qbDesperate = false,
}: {
  needs: readonly PositionNeed[];
  topN?: number;
  label?: string;
  tone?: 'amber' | 'sky';
  /** Show the binary desperate-QB badge the engine's draft logic acts on —
   *  the scored top-N can bury QB under sheer volume of other holes. */
  qbDesperate?: boolean;
}) {
  const top = needs.slice(0, topN);
  const accent =
    tone === 'amber'
      ? 'text-amber-200 border-amber-500/40 bg-amber-500/10'
      : 'text-sky-200 border-sky-500/40 bg-sky-500/10';
  return (
    <div className="flex flex-wrap items-baseline gap-1.5 text-[11px]">
      <span className="uppercase tracking-wide text-[10px] text-zinc-500">{label}</span>
      {qbDesperate && (
        <span
          className="rounded border border-rose-500/50 bg-rose-500/15 px-1.5 py-0.5 font-mono text-[10px] uppercase text-rose-300"
          title="hasDesperateQbNeed — no starter-quality QB and no recent first-round QB on the roster. This binary flag (not the scored list below) drives the QB reach and the need-aware slot premium, so it can be true even when QB doesn't crack the top-5 scored needs."
        >
          QB-desperate
        </span>
      )}
      {top.map((n, i) => (
        <span
          key={n.position}
          className={`rounded border px-1.5 py-0.5 font-mono ${accent}`}
          title={`${n.position} — score ${n.score.toFixed(2)} (pos-value ×${n.positionValue.toFixed(2)}) · starters ${n.starterCount}/${n.blueprintTarget}${n.bestStarterAge !== null ? ` · best age ${n.bestStarterAge}` : ''}`}
        >
          <span className="mr-1 text-zinc-500">{i + 1}.</span>
          {n.position}
          <span className="ml-1 text-[9px] text-zinc-400">{n.score.toFixed(1)}</span>
        </span>
      ))}
    </div>
  );
}

// ─── DRAFT BOARDS PANEL (Doc 3 — Draft Module slice 3) ─────────────────────

const REASON_LABELS: Record<DraftBoardReason, string> = {
  BLUE_CHIP: 'Blue chip',
  SCHEME_FIT: 'Scheme fit',
  POSITIONAL_NEED: 'Need',
  CONVERSION_PROJECTION: 'Conversion',
  DEVELOPMENTAL: 'Developmental',
};

const REASON_COLORS: Record<DraftBoardReason, string> = {
  BLUE_CHIP: 'text-amber-300',
  SCHEME_FIT: 'text-emerald-300',
  POSITIONAL_NEED: 'text-sky-300',
  CONVERSION_PROJECTION: 'text-violet-300',
  DEVELOPMENTAL: 'text-zinc-300',
};

type PositionFilter = PositionGroup | 'ALL';

const POSITION_FILTER_OPTIONS: ReadonlyArray<{ value: PositionFilter; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: PositionGroup.QB, label: 'QB' },
  { value: PositionGroup.SKILL, label: 'Skill (RB/WR/TE)' },
  { value: PositionGroup.OL, label: 'OL' },
  { value: PositionGroup.DL, label: 'DL' },
  { value: PositionGroup.LB, label: 'LB' },
  { value: PositionGroup.DB, label: 'DB' },
  { value: PositionGroup.ST, label: 'ST' },
];

function DraftBoardsPanel({ league }: { league: LeagueState }) {
  const teamsList = useMemo(() => Object.values(league.teams), [league.teams]);
  const [selectedTeamId, setSelectedTeamId] = useState(teamsList[0]?.identity.id ?? null);
  const [topN, setTopN] = useState(20);
  const [positionFilter, setPositionFilter] = useState<PositionFilter>('ALL');

  // View selector: 'current' shows the live `league.draftBoards`
  // (regenerated post-advance for the next draft). A number selects
  // the historical snapshot `league.draftBoardSnapshots[season]` —
  // the board the team actually used to make that season's picks.
  // Diagnosis is much clearer reading from the snapshot when
  // comparing against the draft-results table.
  const snapshotSeasons = useMemo(() => {
    const out: number[] = Object.keys(league.draftBoardSnapshots).map(Number);
    out.sort((a, b) => b - a);
    return out;
  }, [league.draftBoardSnapshots]);
  // User-selected view, or null = auto-default to most-recent
  // snapshot (falling back to 'current' if no snapshots exist).
  // Derived as `viewMode` below so the panel re-resolves when
  // snapshots appear mid-session (e.g., after the first
  // simulate + advance) — the old useState lazy initializer
  // captured an empty snapshotSeasons on first mount and stayed
  // stuck on 'current' forever.
  const [userViewMode, setUserViewMode] = useState<'current' | number | null>(null);
  const viewMode: 'current' | number =
    userViewMode ?? snapshotSeasons[0] ?? 'current';
  const setViewMode = setUserViewMode;
  // Filter the board to prospects who did NOT get drafted in this
  // view's season. For 'current' the toggle is a no-op (no draft
  // has fired yet for the upcoming pool). For a snapshot, it
  // shows "who fell through your board" — useful diagnostic.
  const [undraftedOnly, setUndraftedOnly] = useState(false);

  const board: readonly DraftBoardEntry[] =
    selectedTeamId
      ? viewMode === 'current'
        ? league.draftBoards[selectedTeamId] ?? []
        : league.draftBoardSnapshots[viewMode]?.[selectedTeamId] ?? []
      : [];

  const prospectById = useMemo(() => {
    const m = new Map(league.collegePool.map((cp) => [cp.id, cp] as const));
    return m;
  }, [league.collegePool]);

  // Map for resolving names — covers both pool prospects (still in
  // college) AND drafted prospects (promoted to league.players with
  // PlayerId preserved). Without the players-side lookup, drafted
  // entries on a snapshot board would render as raw CP_... ids.
  const nameAndPosLookup = useMemo(() => {
    const m = new Map<string, { firstName: string; lastName: string; position: Position; schoolId?: string }>();
    for (const cp of league.collegePool) {
      m.set(cp.id, { firstName: cp.firstName, lastName: cp.lastName, position: cp.nflProjectedPosition, schoolId: cp.schoolId });
    }
    for (const p of Object.values(league.players)) {
      if (!m.has(p.id)) {
        m.set(p.id, { firstName: p.firstName, lastName: p.lastName, position: p.position });
      }
    }
    return m;
  }, [league.collegePool, league.players]);

  // Set of prospects drafted in the snapshot's season (empty when
  // viewing 'current'). Used by the undrafted-only toggle.
  const draftedInThisSeason = useMemo(() => {
    if (viewMode === 'current') return new Set<string>();
    const s = new Set<string>();
    for (const p of league.draftHistory) {
      if (p.seasonNumber === viewMode) s.add(p.collegePlayerId);
    }
    return s;
  }, [league.draftHistory, viewMode]);

  // Attach the original board rank to each entry BEFORE filtering so
  // the "#" column shows real overall rank — filtered re-ranks would
  // lie about board position.
  const rankedEntries = useMemo(() => {
    return board.map((entry, idx) => ({ entry, rank: idx + 1 }));
  }, [board]);

  const filteredRanked = useMemo(() => {
    let entries = rankedEntries;
    if (positionFilter !== 'ALL') {
      entries = entries.filter(({ entry }) => {
        const meta = nameAndPosLookup.get(entry.collegePlayerId);
        if (!meta) return false;
        return positionGroupFor(meta.position) === positionFilter;
      });
    }
    if (undraftedOnly && viewMode !== 'current') {
      entries = entries.filter(({ entry }) => !draftedInThisSeason.has(entry.collegePlayerId));
    }
    return entries;
  }, [rankedEntries, positionFilter, nameAndPosLookup, undraftedOnly, viewMode, draftedInThisSeason]);

  // Reason counts reflect the filtered set — flips dynamically with the
  // position filter so badges read "how many BLUE_CHIPs at QB" when
  // QB is selected.
  const reasonCounts = useMemo(() => {
    const counts: Record<DraftBoardReason, number> = {
      BLUE_CHIP: 0, SCHEME_FIT: 0, POSITIONAL_NEED: 0, CONVERSION_PROJECTION: 0, DEVELOPMENTAL: 0,
    };
    for (const { entry } of filteredRanked) counts[entry.reason]++;
    return counts;
  }, [filteredRanked]);

  const selectedTeam = selectedTeamId ? league.teams[selectedTeamId] : null;
  const selectedHc = selectedTeam ? league.coaches[selectedTeam.headCoachId] : null;
  const selectedTeamNeeds = useMemo(
    () => (selectedTeam ? computeTeamNeeds(selectedTeam, league) : []),
    [selectedTeam, league],
  );

  return (
    <section className="mb-8 rounded border border-violet-500/40 bg-violet-500/10 p-4">
      <div className="mb-3 flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-violet-200">
          Draft Boards —{' '}
          {viewMode === 'current'
            ? 'current (upcoming draft)'
            : `season ${viewMode} snapshot (at draft time)`}
        </h2>
        <div className="flex items-center gap-3 text-xs flex-wrap">
          <label className="flex items-center gap-1 text-zinc-400">
            <span className="uppercase tracking-wide text-[10px]">View</span>
            <select
              value={String(viewMode)}
              onChange={(e) => {
                const v = e.target.value;
                setViewMode(v === 'current' ? 'current' : Number(v));
              }}
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 font-mono text-xs focus:border-violet-500 focus:outline-none"
            >
              <option value="current">Current (upcoming)</option>
              {snapshotSeasons.map((s) => (
                <option key={s} value={String(s)}>
                  Season {s} snapshot
                </option>
              ))}
            </select>
          </label>
          {viewMode !== 'current' && (
            <button
              onClick={() => setUndraftedOnly((v) => !v)}
              className={`rounded border px-2 py-0.5 font-mono text-[10px] transition-colors ${
                undraftedOnly
                  ? 'border-violet-500/50 bg-violet-500/20 text-violet-200'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-violet-500/30'
              }`}
              title={undraftedOnly
                ? "Showing only board entries who weren't drafted in this season. Click to show all."
                : "Showing the full snapshot board. Click to hide entries who got drafted in this season."}
            >
              {undraftedOnly ? 'undrafted only' : 'show all'}
            </button>
          )}
          <label className="flex items-center gap-1 text-zinc-400">
            <span className="uppercase tracking-wide text-[10px]">Team</span>
            <select
              value={selectedTeamId ?? ''}
              onChange={(e) => setSelectedTeamId(e.target.value as TeamId)}
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 font-mono text-xs focus:border-violet-500 focus:outline-none"
            >
              {teamsList.map((t) => (
                <option key={t.identity.id} value={t.identity.id}>
                  {t.identity.abbreviation} — {t.identity.fullName}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-zinc-400">
            <span className="uppercase tracking-wide text-[10px]">Pos</span>
            <select
              value={positionFilter}
              onChange={(e) => setPositionFilter(e.target.value as PositionFilter)}
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 font-mono text-xs focus:border-violet-500 focus:outline-none"
            >
              {POSITION_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-zinc-400">
            <span className="uppercase tracking-wide text-[10px]">Top</span>
            {[10, 20, 50].map((n) => (
              <button
                key={n}
                onClick={() => setTopN(n)}
                className={`rounded border px-2 py-0.5 font-mono ${
                  topN === n
                    ? 'border-violet-400 bg-violet-500/30 text-violet-100'
                    : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-violet-500/40 hover:text-violet-300'
                }`}
              >
                {n}
              </button>
            ))}
          </label>
        </div>
      </div>

      {selectedHc && (
        <p className="mb-2 text-xs text-zinc-500">
          Scheme: <span className="font-mono text-emerald-300">{selectedHc.offensiveScheme}</span>
          {' / '}
          <span className="font-mono text-emerald-300">{selectedHc.defensiveScheme}</span>
          {' · '}
          HC: <span className="text-zinc-300">{selectedHc.name}</span>
        </p>
      )}

      {selectedTeamNeeds.length > 0 && (
        <div className="mb-3">
          <TeamNeedsStrip
            needs={selectedTeamNeeds}
            qbDesperate={selectedTeam ? hasDesperateQbNeed(selectedTeam, league.players) : false}
          />
        </div>
      )}

      <div className="mb-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-5">
        {(['BLUE_CHIP', 'SCHEME_FIT', 'POSITIONAL_NEED', 'CONVERSION_PROJECTION', 'DEVELOPMENTAL'] as DraftBoardReason[]).map((r) => (
          <div key={r} className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1">
            <span className={REASON_COLORS[r]}>{REASON_LABELS[r]}</span>
            <span className="ml-2 font-mono text-zinc-300">{reasonCounts[r]}</span>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-zinc-500">
            <tr className="border-b border-zinc-800">
              <th className="px-2 py-1 text-right">#</th>
              <th className="px-2 py-1 text-left">Prospect</th>
              <th className="px-2 py-1 text-left">School</th>
              <th className="px-2 py-1 text-left">NFL proj</th>
              <th className="px-2 py-1 text-right">Priority</th>
              <th className="px-2 py-1 text-right" title="perceived / real overall">Grade</th>
              <th className="px-2 py-1 text-right" title="Draft grade (NFL.com 8-pt scale) — perceived (team board) / real (ground truth)">Draft grd</th>
              <th className="px-2 py-1 text-right">Fit</th>
              <th className="px-2 py-1 text-right">Conf</th>
              <th className="px-2 py-1 text-center">N</th>
              <th className="px-2 py-1 text-left">Reason</th>
            </tr>
          </thead>
          <tbody>
            {filteredRanked.slice(0, topN).map(({ entry, rank }) => {
              const cp = prospectById.get(entry.collegePlayerId);
              const fromPlayers = league.players[entry.collegePlayerId];
              const meta = nameAndPosLookup.get(entry.collegePlayerId);
              // Snapshot view can reference prospects who've since
              // been drafted (no longer in collegePool). Fall back to
              // the rookie's NFL record for name + position.
              if (!cp && !fromPlayers) return null;
              const wasDraftedHere = draftedInThisSeason.has(entry.collegePlayerId);
              const draftPick = wasDraftedHere
                ? league.draftHistory.find(
                    (p) =>
                      p.collegePlayerId === entry.collegePlayerId &&
                      p.seasonNumber === viewMode,
                  )
                : undefined;
              return (
                <tr
                  key={entry.collegePlayerId}
                  className={`border-b border-zinc-900 hover:bg-zinc-900/30 ${
                    wasDraftedHere ? 'opacity-70' : ''
                  }`}
                >
                  <td className="px-2 py-1 text-right font-mono text-zinc-500">{rank}</td>
                  <td className="px-2 py-1">
                    <div className="font-medium text-zinc-100">
                      {meta ? `${meta.firstName} ${meta.lastName}` : entry.collegePlayerId}
                      {wasDraftedHere && draftPick && (
                        <span
                          className="ml-2 rounded bg-amber-500/20 px-1 text-[9px] font-mono text-amber-300"
                          title={`Drafted at #${draftPick.overallPick} by ${league.teams[draftPick.teamId]?.identity.abbreviation ?? '?'}`}
                        >
                          → #{draftPick.overallPick}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      {cp ? (
                        <>
                          {cp.classYear} · {cp.recruiting.starRating}★
                          {cp.bloodline.hasNflFamily && (
                            <span
                              className="ml-1 text-amber-400"
                              title={`NFL legacy: ${cp.bloodline.relativeName}`}
                            >
                              ⚜
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-zinc-600">drafted prospect</span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-1 text-zinc-300">
                    {cp
                      ? getSchoolById(cp.schoolId)?.name ?? cp.schoolId
                      : meta?.schoolId
                        ? getSchoolById(meta.schoolId)?.name ?? meta.schoolId
                        : '—'}
                  </td>
                  <td className="px-2 py-1 font-mono">
                    <span
                      className={
                        cp?.isConversionCandidate ? 'text-violet-300' : 'text-zinc-400'
                      }
                    >
                      {cp
                        ? cp.collegePosition !== cp.nflProjectedPosition
                          ? `${cp.collegePosition}→${cp.nflProjectedPosition}`
                          : cp.nflProjectedPosition
                        : meta?.position ?? '?'}
                    </span>
                    {cp && entry.assignedPosition && entry.assignedPosition !== cp.nflProjectedPosition && (
                      <span
                        className="ml-1 rounded bg-sky-500/20 px-1 text-[9px] font-mono text-sky-300"
                        title={`This team would convert him to ${entry.assignedPosition} (roster need at that spot)`}
                      >
                        ⇄{entry.assignedPosition}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-right font-mono text-amber-300">{entry.priority.toFixed(1)}</td>
                  <td className="px-2 py-1 text-right">
                    <GradeCell
                      perceived={Math.round(entry.observedSkillScore)}
                      real={prospectRealGrade(league, entry.collegePlayerId)}
                    />
                  </td>
                  <td className="px-2 py-1 text-right">
                    <DraftGradeCell
                      perceivedOverall={entry.observedSkillScore}
                      realOverall={cp ? prospectProjectedOverall(cp) : null}
                    />
                  </td>
                  <td className="px-2 py-1 text-right font-mono text-zinc-300">{entry.schemeFit.toFixed(2)}</td>
                  <td className="px-2 py-1 text-right font-mono text-zinc-300">{entry.meanConfidence.toFixed(2)}</td>
                  <td className="px-2 py-1 text-center font-mono text-zinc-400">{entry.observationCount}</td>
                  <td className={`px-2 py-1 text-[10px] uppercase tracking-wide ${REASON_COLORS[entry.reason]}`}>
                    {REASON_LABELS[entry.reason]}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[10px] text-zinc-600">
        {viewMode === 'current'
          ? "Current view = boards regenerated post-advance for the UPCOMING draft, not the one that just fired. Switch to a season snapshot to see the board the team actually used to make picks."
          : "Snapshot view = the team's board AS IT WAS the moment that season's draft fired. Faded rows + → #N badges mark prospects who got drafted in this draft (with their pick number); the rest fell through the board."}
      </p>
    </section>
  );
}

// ─── DRAFT REPLAY PANEL (v0.50) ───────────────────────────────────────────
//
// Step-through view of a completed draft. Surfaces the picking team's
// internal board, the consensus board (derived from all 32 boards),
// the picked player's ground-truth stats, and — the primary diagnostic
// — the reach delta between the team's evaluation and the league
// consensus at each pick. Daniel's "are boards reaching too far down
// consensus?" hypothesis is exactly what this panel exists to make
// answerable.

function DraftReplayPanel({ league }: { league: LeagueState }) {
  // Available seasons = those with both a snapshot AND picks in history.
  // Pre-v0.50 saves can have draft history without snapshots; new
  // drafts will populate snapshots going forward.
  const availableSeasons = useMemo(() => {
    const seasonsInHistory = new Set<number>();
    for (const p of league.draftHistory) seasonsInHistory.add(p.seasonNumber);
    const out: number[] = [];
    for (const s of Object.keys(league.draftBoardSnapshots)) {
      const n = Number(s);
      if (seasonsInHistory.has(n)) out.push(n);
    }
    return out.sort((a, b) => b - a); // newest first
  }, [league.draftHistory, league.draftBoardSnapshots]);

  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const effectiveSeason = selectedSeason ?? availableSeasons[0] ?? null;

  const picks = useMemo(() => {
    if (effectiveSeason === null) return [];
    return league.draftHistory
      .filter((p) => p.seasonNumber === effectiveSeason)
      .sort((a, b) => a.overallPick - b.overallPick);
  }, [league.draftHistory, effectiveSeason]);

  const [pickIndex, setPickIndex] = useState(0);
  const safePickIndex = Math.max(0, Math.min(pickIndex, picks.length - 1));
  const currentPick: DraftPickRecord | null =
    picks.length > 0 ? picks[safePickIndex] ?? null : null;

  // Toggle: filter the picking team's board to prospects still
  // available at this slot (i.e., not taken by any earlier pick).
  // The board shown by default is the FULL pre-draft snapshot, which
  // is misleading mid-draft — "Frank Ross #3 picked over Aaron Nelson
  // #2" is fine when #2 was taken first by an earlier team. Toggle
  // OFF shows the original pre-draft snapshot.
  const [filterToAvailable, setFilterToAvailable] = useState(true);

  // Set of prospects picked at any slot STRICTLY before this one.
  // Used to filter the picking team's board view when the toggle is on.
  const pickedBeforeThisSlot = useMemo(() => {
    const s = new Set<PlayerId>();
    for (let i = 0; i < safePickIndex; i++) {
      const p = picks[i];
      if (p) s.add(p.collegePlayerId);
    }
    return s;
  }, [picks, safePickIndex]);

  const snapshot = useMemo(() => {
    if (effectiveSeason === null) return null;
    return league.draftBoardSnapshots[effectiveSeason] ?? null;
  }, [effectiveSeason, league.draftBoardSnapshots]);

  const consensus = useMemo(() => {
    if (!snapshot) return [];
    return computeConsensusBoard(snapshot);
  }, [snapshot]);

  const consensusRank = useMemo(() => consensusRankIndex(consensus), [consensus]);

  // Name + position lookup that resolves BOTH undrafted prospects
  // (still in collegePool) and drafted ones (promoted to
  // league.players with the same PlayerId). Without this we render
  // raw CP_... ids for every player picked in the current draft.
  const nameLookup = useMemo(() => {
    const m = new Map<PlayerId, ProspectNameRecord>();
    for (const cp of league.collegePool) {
      m.set(cp.id, {
        firstName: cp.firstName,
        lastName: cp.lastName,
        position: cp.nflProjectedPosition,
      });
    }
    for (const p of Object.values(league.players)) {
      if (!m.has(p.id)) {
        m.set(p.id, {
          firstName: p.firstName,
          lastName: p.lastName,
          position: p.position,
        });
      }
    }
    return m;
  }, [league.collegePool, league.players]);

  // Aggregate reach distribution across the whole draft — small
  // sparkline that lets Daniel scan the variance at a glance. Hook
  // call lifted above the early returns so the hook count stays
  // stable across renders (React Rules of Hooks).
  const reachDistribution = useMemo(() => {
    const buckets: Record<string, number> = {};
    let total = 0;
    let above = 0;
    let big = 0;
    for (const p of picks) {
      const r = consensusRank.get(p.collegePlayerId);
      if (r === undefined) continue;
      const reach = r - p.overallPick;
      total++;
      if (reach > 0) above++;
      if (reach >= 20) big++;
      const bucket =
        reach <= -30 ? '≤−30' :
        reach <= -10 ? '−29..−10' :
        reach < 0 ? '−9..−1' :
        reach === 0 ? '0' :
        reach < 10 ? '+1..+9' :
        reach < 30 ? '+10..+29' :
        '≥+30';
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }
    return { buckets, total, above, big };
  }, [picks, consensusRank]);

  if (availableSeasons.length === 0) {
    return (
      <section className="mb-8 rounded border border-zinc-800 bg-zinc-900/40 p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-zinc-300">
          Draft replay
        </h2>
        <p className="text-xs text-zinc-500">
          No replayable drafts yet. Drafts that fire after v0.50 capture board
          snapshots; simulate + advance the league to populate one.
        </p>
      </section>
    );
  }

  if (!currentPick || !snapshot) {
    return null;
  }

  const team = league.teams[currentPick.teamId];
  const teamNeeds = team ? computeTeamNeeds(team, league) : [];
  const prospect = league.collegePool.find((cp) => cp.id === currentPick.collegePlayerId);
  // Promotion preserves PlayerId, so the rookie record is reachable
  // through players[promotedPlayerId] even after the prospect's left
  // the college pool.
  const rookie = league.players[currentPick.promotedPlayerId];
  const teamBoard = snapshot[currentPick.teamId] ?? [];
  const teamRank = currentPick.boardRankAtPick;
  const consRank = consensusRank.get(currentPick.collegePlayerId) ?? null;
  // reachVsConsensusSlot = how many spots EARLIER than consensus the
  // pick was made. Positive = team reached past the consensus value;
  // negative = steal at this slot per consensus.
  const reachVsConsensusSlot =
    consRank !== null ? consRank - currentPick.overallPick : null;

  // Render the boards as a centered window around the picked player
  // (or top of board if the picked player isn't on this view's board).
  const WINDOW = 6;
  // Tag each board entry with its ORIGINAL rank (1-based) so the
  // displayed numbers stay stable when the toggle filters out
  // previously-picked prospects. Optionally drop already-picked
  // entries so the user sees what the team actually had to choose
  // from at this slot.
  const teamBoardWithRanks = teamBoard.map((entry, idx) => ({ entry, rank: idx + 1 }));
  const teamBoardFiltered = filterToAvailable
    ? teamBoardWithRanks.filter(
        ({ entry }) =>
          entry.collegePlayerId === currentPick.collegePlayerId ||
          !pickedBeforeThisSlot.has(entry.collegePlayerId),
      )
    : teamBoardWithRanks;
  // Recenter on the picked entry within the (possibly filtered) list.
  // The picked entry's POSITION in the filtered list is what we want
  // to band around, not its original board rank.
  const pickedPositionInFiltered = Math.max(
    1,
    teamBoardFiltered.findIndex(
      (e) => e.entry.collegePlayerId === currentPick.collegePlayerId,
    ) + 1,
  );
  const teamBoardWindow = bandAround(
    teamBoardFiltered,
    pickedPositionInFiltered,
    WINDOW,
  );
  const consensusWindow = bandAround(
    consensus.map((entry, idx) => ({ entry, rank: idx + 1 })),
    consRank ?? 1,
    WINDOW,
  );

  return (
    <section className="mb-8 rounded border border-sky-500/40 bg-sky-500/10 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-sky-200">
          Draft replay — Season {effectiveSeason} (step-through)
        </h2>
        <div className="flex items-center gap-1 text-xs">
          <span className="text-zinc-500 uppercase tracking-wide text-[10px]">season</span>
          {availableSeasons.map((s) => (
            <button
              key={s}
              onClick={() => {
                setSelectedSeason(s);
                setPickIndex(0);
              }}
              className={`rounded border px-2 py-0.5 font-mono ${
                s === effectiveSeason
                  ? 'border-sky-400 bg-sky-500/30 text-sky-100'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-sky-500/40 hover:text-sky-300'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Pick navigator */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded border border-zinc-800 bg-zinc-950/50 p-2">
        <button
          onClick={() => setPickIndex(0)}
          disabled={safePickIndex === 0}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs font-mono text-zinc-300 hover:border-sky-500/40 disabled:opacity-30"
        >
          ⏮
        </button>
        <button
          onClick={() => setPickIndex(Math.max(0, safePickIndex - 1))}
          disabled={safePickIndex === 0}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs font-mono text-zinc-300 hover:border-sky-500/40 disabled:opacity-30"
        >
          ◀ Prev
        </button>
        <input
          type="number"
          min={1}
          max={picks.length}
          value={safePickIndex + 1}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) setPickIndex(Math.max(0, Math.min(picks.length - 1, n - 1)));
          }}
          className="w-16 rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs font-mono text-sky-200 focus:border-sky-500 focus:outline-none"
        />
        <span className="text-xs text-zinc-500">/ {picks.length}</span>
        <button
          onClick={() => setPickIndex(Math.min(picks.length - 1, safePickIndex + 1))}
          disabled={safePickIndex >= picks.length - 1}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs font-mono text-zinc-300 hover:border-sky-500/40 disabled:opacity-30"
        >
          Next ▶
        </button>
        <button
          onClick={() => setPickIndex(picks.length - 1)}
          disabled={safePickIndex >= picks.length - 1}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs font-mono text-zinc-300 hover:border-sky-500/40 disabled:opacity-30"
        >
          ⏭
        </button>
        <input
          type="range"
          min={1}
          max={picks.length}
          value={safePickIndex + 1}
          onChange={(e) => setPickIndex(Number(e.target.value) - 1)}
          className="flex-1 accent-sky-500"
        />
      </div>

      {/* Pick headline */}
      <div className="mb-3 rounded border border-sky-500/40 bg-sky-950/40 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="font-mono text-lg text-sky-100">
            #{currentPick.overallPick} · R{currentPick.round} ·{' '}
            <span className="text-amber-200">{team?.identity.abbreviation ?? currentPick.teamId}</span>{' '}
            picks{' '}
            <span className="text-zinc-100">{rookie ? `${rookie.firstName} ${rookie.lastName}` : currentPick.promotedPlayerId}</span>
          </div>
          <ReachBadge reach={reachVsConsensusSlot} />
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-400">
          <span>
            Team rank{' '}
            <span className="font-mono text-zinc-200">
              {teamRank === null ? 'off board' : `#${teamRank}`}
            </span>
          </span>
          <span>
            Consensus rank{' '}
            <span className="font-mono text-zinc-200">
              {consRank === null ? 'off everyone\'s board' : `#${consRank}`}
            </span>
          </span>
          {currentPick.boardReasonAtPick && (
            <span>
              Reason{' '}
              <span className="rounded bg-violet-500/20 px-1 font-mono text-[10px] uppercase text-violet-200">
                {currentPick.boardReasonAtPick}
              </span>
            </span>
          )}
          {currentPick.originalTeamId && currentPick.originalTeamId !== currentPick.teamId && (
            <span className="text-amber-300">
              From{' '}
              <span className="font-mono">
                {league.teams[currentPick.originalTeamId]?.identity.abbreviation
                  ?? currentPick.originalTeamId}
              </span>
            </span>
          )}
        </div>
        {currentPick.needsAtPick && currentPick.needsAtPick.length > 0 ? (
          // Pick-time snapshot (v0.147) — what the war room saw when it went
          // on the clock, NOT needs recomputed from the post-draft roster
          // (the drafted rookie satisfies the very need that justified him).
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="uppercase tracking-wide text-[10px] text-zinc-500">
              {team?.identity.abbreviation ?? 'Team'} needs at pick
            </span>
            {currentPick.qbDesperateAtPick && (
              <span
                className="rounded border border-rose-500/50 bg-rose-500/15 px-1.5 py-0.5 font-mono text-[10px] uppercase text-rose-300"
                title="hasDesperateQbNeed at pick time — the binary driver behind the QB reach and the need-aware slot premium."
              >
                QB-desperate
              </span>
            )}
            {currentPick.needsAtPick.map((pos) => (
              <span
                key={pos}
                className={`rounded border px-1.5 py-0.5 font-mono ${
                  rookie && pos === rookie.position
                    ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                    : 'border-sky-500/40 bg-sky-500/10 text-sky-200'
                }`}
                title={rookie && pos === rookie.position ? 'This pick filled the need' : undefined}
              >
                {pos}
              </span>
            ))}
          </div>
        ) : (
          teamNeeds.length > 0 && (
            <div className="mt-2">
              <TeamNeedsStrip
                needs={teamNeeds}
                tone="sky"
                label={`${team?.identity.abbreviation ?? 'Team'} needs (now — pre-snapshot draft)`}
              />
            </div>
          )
        )}
      </div>

      {/* 3-column body: player card | team board | consensus board */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <DraftReplayPlayerCard prospect={prospect ?? null} rookie={rookie ?? null} />
        <div>
          <div className="mb-1 flex justify-end">
            <button
              onClick={() => setFilterToAvailable((v) => !v)}
              className={`rounded border px-2 py-0.5 font-mono text-[10px] transition-colors ${
                filterToAvailable
                  ? 'border-violet-500/50 bg-violet-500/20 text-violet-200'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-violet-500/30'
              }`}
              title={filterToAvailable
                ? "Showing only prospects still on the board at this pick. Click to show the full pre-draft board."
                : "Showing the full pre-draft board. Click to filter out prospects already taken before this pick."}
            >
              {filterToAvailable ? 'available only' : 'show all'}
            </button>
          </div>
          <DraftReplayBoardColumn
            title={`${team?.identity.abbreviation ?? 'Team'} board${filterToAvailable ? ' (available at this pick)' : ''}`}
            accent="violet"
            window={teamBoardWindow}
            highlightId={currentPick.collegePlayerId}
            nameLookup={nameLookup}
            extractRankInfo={(entry) => ({
              label: entry.reason,
              value: `pri ${entry.priority.toFixed(0)}`,
            })}
          />
        </div>
        <DraftReplayBoardColumn
          title="Consensus"
          accent="emerald"
          window={consensusWindow}
          highlightId={currentPick.collegePlayerId}
          nameLookup={nameLookup}
          extractRankInfo={(entry) => ({
            label: `${entry.appearances}/32`,
            value: `avg ${entry.averagePriority.toFixed(0)}`,
          })}
        />
      </div>

      {/* Draft-wide reach distribution */}
      <div className="mt-3 rounded border border-zinc-800 bg-zinc-950/40 p-2">
        <div className="mb-1 flex items-baseline justify-between text-[10px] text-zinc-500">
          <span className="uppercase tracking-wider">Reach distribution (this draft)</span>
          <span>
            <span className="font-mono text-zinc-300">{reachDistribution.above}</span>/{reachDistribution.total} picks reached
            past consensus · <span className="font-mono text-amber-300">{reachDistribution.big}</span> big reaches (≥20)
          </span>
        </div>
        <ReachHistogram buckets={reachDistribution.buckets} />
      </div>
    </section>
  );
}

function bandAround<T>(
  entries: readonly T[],
  centerRank: number,
  window: number,
): readonly T[] {
  if (entries.length === 0) return [];
  const center = Math.max(1, Math.min(entries.length, centerRank));
  const start = Math.max(0, center - 1 - window);
  const end = Math.min(entries.length, center - 1 + window + 1);
  return entries.slice(start, end);
}

function ReachBadge({ reach }: { reach: number | null }) {
  if (reach === null) {
    return (
      <span className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 font-mono text-xs text-zinc-400">
        Off consensus
      </span>
    );
  }
  // Positive reach = picked EARLIER than consensus rank (team reached
  // ahead of where consensus would have valued them).
  if (reach > 0) {
    const big = reach >= 20;
    return (
      <span
        className={`rounded border px-2 py-0.5 font-mono text-xs ${
          big
            ? 'border-amber-500 bg-amber-500/20 text-amber-200'
            : 'border-amber-700 bg-amber-700/20 text-amber-300'
        }`}
      >
        Reach +{reach}
      </span>
    );
  }
  if (reach < 0) {
    const big = reach <= -20;
    return (
      <span
        className={`rounded border px-2 py-0.5 font-mono text-xs ${
          big
            ? 'border-emerald-500 bg-emerald-500/20 text-emerald-200'
            : 'border-emerald-700 bg-emerald-700/20 text-emerald-300'
        }`}
      >
        Steal {reach}
      </span>
    );
  }
  return (
    <span className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 font-mono text-xs text-zinc-300">
      On consensus
    </span>
  );
}

function DraftReplayPlayerCard({
  prospect,
  rookie,
}: {
  prospect: CollegePlayer | null;
  rookie: Player | null;
}) {
  const school = prospect ? getSchoolById(prospect.schoolId) : null;
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/50 p-3 text-xs">
      <div className="mb-2 text-[10px] uppercase tracking-wider text-zinc-500">Player</div>
      {rookie && (
        <div className="mb-1 font-mono text-sm text-zinc-100">
          {rookie.firstName} {rookie.lastName}
        </div>
      )}
      <div className="space-y-1 text-[11px] text-zinc-400">
        {prospect && (
          <>
            <div>
              <span className="text-zinc-500">Position</span>{' '}
              <span className="font-mono text-zinc-200">{prospect.nflProjectedPosition}</span>
              {prospect.isConversionCandidate && (
                <span className="ml-1 rounded bg-cyan-500/20 px-1 text-[9px] uppercase text-cyan-200">
                  conv from {prospect.collegePosition}
                </span>
              )}
            </div>
            <div>
              <span className="text-zinc-500">School</span>{' '}
              <span className="text-zinc-300">{school?.name ?? prospect.schoolId}</span>
              <span className="text-zinc-600"> · {prospect.classYear}</span>
            </div>
            <div>
              <span className="text-zinc-500">Tier</span>{' '}
              <TierBadge tier={prospect.tier} />
              <span className="ml-2 text-zinc-500">Arch</span>{' '}
              <span className="font-mono text-zinc-300">{prospect.archetype}</span>
            </div>
            {prospect.assumedArchetype !== prospect.archetype && (
              <div className="text-amber-400">
                Assumed archetype: {prospect.assumedArchetype}{' '}
                <span className="text-amber-600">(misread)</span>
              </div>
            )}
          </>
        )}
        {rookie && (
          <div className="mt-2 border-t border-zinc-800 pt-2">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
              Ground-truth skills (dev view)
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10px]">
              <SkillRow label="speed" v={rookie.current.speed} ceiling={rookie.ceiling.speed} />
              <SkillRow label="accel" v={rookie.current.acceleration} ceiling={rookie.ceiling.acceleration} />
              <SkillRow label="strength" v={rookie.current.strength} ceiling={rookie.ceiling.strength} />
              <SkillRow label="tech" v={rookie.current.technicalSkill} ceiling={rookie.ceiling.technicalSkill} />
              <SkillRow label="iq" v={rookie.current.footballIq} ceiling={rookie.ceiling.footballIq} />
              <SkillRow label="decision" v={rookie.current.decisionMaking} ceiling={rookie.ceiling.decisionMaking} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SkillRow({
  label,
  v,
  ceiling,
}: {
  label: string;
  v: number;
  ceiling: number;
}) {
  return (
    <div className="flex items-baseline justify-between gap-1">
      <span className="text-zinc-500">{label}</span>
      <span className="text-zinc-200">
        {v}
        {ceiling > v && <span className="text-zinc-600"> → {ceiling}</span>}
      </span>
    </div>
  );
}

function TierBadge({ tier }: { tier: 'STAR' | 'STARTER' | 'BACKUP' | 'FRINGE' }) {
  const cls =
    tier === 'STAR' ? 'bg-amber-500/20 text-amber-200 border-amber-500/40' :
    tier === 'STARTER' ? 'bg-sky-500/20 text-sky-200 border-sky-500/40' :
    tier === 'BACKUP' ? 'bg-zinc-700/40 text-zinc-300 border-zinc-700' :
    'bg-zinc-900 text-zinc-500 border-zinc-800';
  return (
    <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${cls}`}>
      {tier}
    </span>
  );
}

interface ProspectNameRecord {
  firstName: string;
  lastName: string;
  position: Position;
}

function DraftReplayBoardColumn<T extends { collegePlayerId: PlayerId }>({
  title,
  accent,
  window,
  highlightId,
  nameLookup,
  extractRankInfo,
}: {
  title: string;
  accent: 'violet' | 'emerald';
  window: readonly { entry: T; rank: number }[];
  highlightId: PlayerId;
  nameLookup: ReadonlyMap<PlayerId, ProspectNameRecord>;
  extractRankInfo: (entry: T) => { label: string; value: string };
}) {
  const titleClass =
    accent === 'violet' ? 'text-violet-200 border-violet-500/40' : 'text-emerald-200 border-emerald-500/40';
  return (
    <div className={`rounded border bg-zinc-950/50 p-3 text-xs ${titleClass}`}>
      <div className="mb-2 text-[10px] uppercase tracking-wider">{title}</div>
      <div className="space-y-0.5">
        {window.length === 0 && (
          <div className="text-[11px] text-zinc-600">No board data.</div>
        )}
        {window.map(({ entry, rank }) => {
          const isPicked = entry.collegePlayerId === highlightId;
          const name = nameLookup.get(entry.collegePlayerId);
          const info = extractRankInfo(entry);
          return (
            <div
              key={String(entry.collegePlayerId) + rank}
              className={`flex items-baseline justify-between gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] ${
                isPicked
                  ? 'bg-amber-500/30 text-amber-100 ring-1 ring-amber-500'
                  : 'text-zinc-400'
              }`}
            >
              <span className="flex items-baseline gap-1">
                <span className="w-6 text-right text-zinc-500">#{rank}</span>
                <span className="truncate text-zinc-300">
                  {name ? `${name.firstName} ${name.lastName}` : String(entry.collegePlayerId)}
                </span>
                {name && (
                  <span className="text-[9px] text-zinc-600">{name.position}</span>
                )}
              </span>
              <span className="text-[9px] text-zinc-500">
                {info.label}
                <span className="ml-1 text-zinc-400">{info.value}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReachHistogram({ buckets }: { buckets: Record<string, number> }) {
  const ORDER = ['≤−30', '−29..−10', '−9..−1', '0', '+1..+9', '+10..+29', '≥+30'];
  const maxVal = Math.max(1, ...Object.values(buckets));
  return (
    <div className="flex items-end gap-1">
      {ORDER.map((label) => {
        const count = buckets[label] ?? 0;
        const height = (count / maxVal) * 28; // px
        const isSteal = label.startsWith('−') || label === '≤−30';
        const isReach = label.startsWith('+') || label === '≥+30';
        const cls = isSteal
          ? 'bg-emerald-500/60'
          : isReach
            ? 'bg-amber-500/60'
            : 'bg-zinc-600';
        return (
          <div key={label} className="flex flex-1 flex-col items-center text-[9px]">
            <div className="mb-0.5 font-mono text-zinc-300">{count}</div>
            <div
              className={`w-full rounded-t ${cls}`}
              style={{ height: `${Math.max(1, height)}px` }}
            />
            <div className="mt-0.5 text-zinc-500">{label}</div>
          </div>
        );
      })}
    </div>
  );
}

// ─── DRAFT TRADES PANEL (v0.52 — surface trade-up firings) ──────────────

function DraftTradesPanel({ league }: { league: LeagueState }) {
  // Group trade-ups by seasonNumber. Each season may produce 0..3
  // trade-ups (per MAX_TRADE_UPS_PER_DRAFT in v0.45).
  const tradesBySeason = useMemo(() => {
    const m = new Map<number, typeof league.tradeUpHistory>();
    for (const tu of league.tradeUpHistory) {
      const arr = m.get(tu.seasonNumber);
      if (arr) {
        (arr as unknown as Array<typeof tu>).push(tu);
      } else {
        m.set(tu.seasonNumber, [tu] as unknown as typeof league.tradeUpHistory);
      }
    }
    return [...m.entries()].sort((a, b) => b[0] - a[0]); // newest first
  }, [league.tradeUpHistory]);

  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const effectiveSeason = selectedSeason ?? (tradesBySeason[0]?.[0] ?? null);

  const trades =
    effectiveSeason !== null
      ? tradesBySeason.find(([s]) => s === effectiveSeason)?.[1] ?? []
      : [];

  // Resolve pick metadata for display (round + season + slot # when
  // known). Slot # is only assigned once the draft fires, so future
  // picks come from `league.draftPicks` (slot = undefined) and
  // already-fired picks come from `league.draftHistory` (slot known).
  // History takes precedence so a pick consumed in a later draft
  // still surfaces its slot.
  const pickInfoById = useMemo(() => {
    const m = new Map<string, { round: number; seasonNumber: number; originalTeamId?: TeamId; overallPick?: number }>();
    for (const p of league.draftPicks) {
      m.set(p.id, {
        round: p.round,
        seasonNumber: p.seasonNumber,
        originalTeamId: p.originalTeamId,
      });
    }
    for (const p of league.draftHistory) {
      if (p.pickAssetId) {
        m.set(p.pickAssetId, {
          round: p.round,
          seasonNumber: p.seasonNumber,
          overallPick: p.overallPick,
          ...(p.originalTeamId ? { originalTeamId: p.originalTeamId } : {}),
        });
      }
    }
    return m;
  }, [league.draftPicks, league.draftHistory]);

  const nameByCpId = useMemo(() => {
    const m = new Map<string, { firstName: string; lastName: string; position: Position }>();
    for (const cp of league.collegePool) {
      m.set(cp.id, { firstName: cp.firstName, lastName: cp.lastName, position: cp.nflProjectedPosition });
    }
    for (const p of Object.values(league.players)) {
      if (!m.has(p.id)) {
        m.set(p.id, { firstName: p.firstName, lastName: p.lastName, position: p.position });
      }
    }
    return m;
  }, [league.collegePool, league.players]);

  // The pick actually MADE at each (season, overall-slot) — so a trade-up can
  // show who the team selected with the slot it moved up to grab, not just who
  // it targeted (usually the same, but the board can shift between the trade
  // and the pick).
  const pickAtSlot = useMemo(() => {
    const m = new Map<string, DraftPickRecord>();
    for (const p of league.draftHistory) m.set(`${p.seasonNumber}#${p.overallPick}`, p);
    return m;
  }, [league.draftHistory]);

  if (tradesBySeason.length === 0) {
    return (
      <section className="mb-8 rounded border border-zinc-800 bg-zinc-900/40 p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-zinc-300">
          Draft trades
        </h2>
        <p className="text-xs text-zinc-500">
          No draft trade-ups have fired yet. Trade-ups can only happen when two
          teams' top board entries converge on the same prospect AND the
          trading-up team can construct a Doc 5 chart-fair offer (top-10 slots
          only; max 3 per draft).
        </p>
      </section>
    );
  }

  return (
    <section className="mb-8 rounded border border-amber-500/40 bg-amber-500/10 p-4">
      <div className="mb-3 flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-200">
          Draft trade-ups — Season {effectiveSeason} ({trades.length} {trades.length === 1 ? 'trade' : 'trades'})
        </h2>
        <div className="flex items-center gap-1 text-xs">
          <span className="text-zinc-500 uppercase tracking-wide text-[10px]">season</span>
          {tradesBySeason.map(([s, ts]) => (
            <button
              key={s}
              onClick={() => setSelectedSeason(s)}
              className={`rounded border px-2 py-0.5 font-mono ${
                s === effectiveSeason
                  ? 'border-amber-400 bg-amber-500/30 text-amber-100'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-amber-500/40 hover:text-amber-300'
              }`}
            >
              {s} <span className="text-[9px] text-zinc-500">·{ts.length}</span>
            </button>
          ))}
        </div>
      </div>

      {trades.length === 0 ? (
        <p className="text-xs text-zinc-500">No trade-ups in this season's draft — quiet draft.</p>
      ) : (
        <div className="space-y-3">
          {trades.map((tu) => {
            const acquiringTeam = league.teams[tu.tradingUpTeamId];
            const droppingTeam = league.teams[tu.onClockTeamId];
            const target = nameByCpId.get(tu.targetCollegePlayerId);
            const swapInfo = pickInfoById.get(tu.swapAssetId);
            // Who they actually drafted with the slot they moved up to.
            const selPick = pickAtSlot.get(`${tu.seasonNumber}#${tu.overallPick}`);
            const selPlayer = selPick ? league.players[selPick.promotedPlayerId] : undefined;
            return (
              <div
                key={`${tu.seasonNumber}-${tu.overallPick}-${tu.tradingUpTeamId}`}
                className="rounded border border-amber-500/40 bg-zinc-950/40 p-3 text-xs"
              >
                <div className="mb-1 flex items-baseline justify-between flex-wrap gap-2">
                  <div className="font-mono text-amber-200">
                    Slot #{tu.overallPick} · R{tu.round} ·{' '}
                    <span className="text-amber-100">
                      {acquiringTeam?.identity.abbreviation ?? tu.tradingUpTeamId}
                    </span>{' '}
                    moves up
                  </div>
                  <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] text-amber-200">
                    chart ratio {tu.ratio.toFixed(2)}
                  </span>
                </div>
                <div className="mb-2 text-[11px] text-zinc-400">
                  Target:{' '}
                  <span className="text-zinc-200">
                    {target ? `${target.firstName} ${target.lastName}` : tu.targetCollegePlayerId}
                  </span>
                  {target && (
                    <span className="ml-1 text-[10px] text-zinc-500">({target.position})</span>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <div className="rounded border border-emerald-500/30 bg-zinc-950/40 p-2">
                    <div className="mb-1 text-[10px] uppercase tracking-wider text-emerald-300">
                      {acquiringTeam?.identity.abbreviation ?? tu.tradingUpTeamId} acquires
                    </div>
                    <div className="text-zinc-300">
                      Slot #{tu.overallPick} (R{tu.round})
                    </div>
                    <div className="mt-1 text-[11px]">
                      {selPlayer ? (
                        <span className="text-emerald-200">
                          selected: {selPlayer.firstName} {selPlayer.lastName}
                          <span className="ml-1 text-[10px] text-zinc-500">({selPlayer.position})</span>
                          {selPick?.convertedFromPosition && (
                            <span className="ml-1 text-[10px] text-sky-300">←{selPick.convertedFromPosition}</span>
                          )}
                          {selPick && selPick.collegePlayerId !== tu.targetCollegePlayerId && (
                            <span className="ml-1 text-[10px] text-amber-300/80" title="Not the prospect the trade-up targeted — the board moved by the time the pick fired.">
                              (off-target)
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-zinc-600">selected: — (pick not yet made)</span>
                      )}
                    </div>
                  </div>
                  <div className="rounded border border-rose-500/30 bg-zinc-950/40 p-2">
                    <div className="mb-1 text-[10px] uppercase tracking-wider text-rose-300">
                      {droppingTeam?.identity.abbreviation ?? tu.onClockTeamId} receives
                    </div>
                    <ul className="space-y-0.5 text-zinc-300">
                      <li>
                        <span className="font-mono text-[10px] text-zinc-500">·</span>{' '}
                        {acquiringTeam?.identity.abbreviation ?? '?'}'s{' '}
                        R{swapInfo?.round ?? '?'}
                        {swapInfo?.overallPick !== undefined && (
                          <span className="ml-1 font-mono text-amber-200">
                            #{swapInfo.overallPick}
                          </span>
                        )}{' '}
                        <span className="text-[10px] text-zinc-500">(this draft)</span>
                      </li>
                      {(tu.currentDraftPickIds ?? []).map((cid) => {
                        const info = pickInfoById.get(cid);
                        return (
                          <li key={cid}>
                            <span className="font-mono text-[10px] text-zinc-500">·</span>{' '}
                            {acquiringTeam?.identity.abbreviation ?? '?'}'s{' '}
                            {info ? (
                              <>
                                R{info.round}
                                {info.overallPick !== undefined && (
                                  <span className="ml-1 font-mono text-amber-200">
                                    #{info.overallPick}
                                  </span>
                                )}
                              </>
                            ) : (
                              cid
                            )}{' '}
                            <span className="text-[10px] text-zinc-500">(this draft)</span>
                          </li>
                        );
                      })}
                      {tu.futurePickIds.map((fid) => {
                        const info = pickInfoById.get(fid);
                        return (
                          <li key={fid}>
                            <span className="font-mono text-[10px] text-zinc-500">·</span>{' '}
                            {acquiringTeam?.identity.abbreviation ?? '?'}'s{' '}
                            {info ? (
                              <>
                                {info.seasonNumber} R{info.round}
                                {info.overallPick !== undefined && (
                                  <span className="ml-1 font-mono text-amber-200">
                                    #{info.overallPick}
                                  </span>
                                )}
                              </>
                            ) : (
                              fid
                            )}{' '}
                            {info && info.overallPick === undefined ? (
                              <span className="text-[10px] text-zinc-600">(TBD)</span>
                            ) : (
                              <span className="text-[10px] text-zinc-500">pick</span>
                            )}
                          </li>
                        );
                      })}
                      {(tu.currentDraftPickIds ?? []).length === 0 &&
                        tu.futurePickIds.length === 0 && (
                          <li className="text-[10px] text-zinc-600">
                            (no extra sweeteners — swap only)
                          </li>
                        )}
                    </ul>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-3 text-[10px] text-zinc-600">
        Trade-ups fire inside <code>runDraft</code> when a team further down
        the round wants the on-clock team's top-board prospect badly enough
        to construct a chart-fair offer (v0.45 firing; v0.49 dynamic modifier
        asymmetry tunes acceptance). The on-clock team accepts at ratio ≥ 1.0
        (Doc 5 chart). Caps: 3 trade-ups per draft, top-10 slots only.
      </p>
    </section>
  );
}

// ─── DRAFT RESULTS PANEL (Doc 3 — Draft Module slice 5a) ───────────────────

function DraftResultsPanel({ league }: { league: LeagueState }) {
  // Group draftHistory by seasonNumber so the user can flip back through years.
  const seasons = useMemo(() => {
    const m = new Map<number, DraftPickRecord[]>();
    for (const p of league.draftHistory) {
      const arr = m.get(p.seasonNumber);
      if (arr) arr.push(p);
      else m.set(p.seasonNumber, [p]);
    }
    return [...m.entries()].sort((a, b) => b[0] - a[0]); // newest first
  }, [league.draftHistory]);

  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const effectiveSeason = selectedSeason ?? (seasons[0]?.[0] ?? null);

  // Consensus rank per pick for the selected season — derived from
  // the v0.50 draftBoardSnapshots captured at draft time. Null when
  // the season's snapshot is missing (pre-v0.50 saves).
  const consensusRanksForSeason = useMemo(() => {
    if (effectiveSeason === null) return null;
    const snapshot = league.draftBoardSnapshots[effectiveSeason];
    if (!snapshot) return null;
    return consensusRankIndex(computeConsensusBoard(snapshot));
  }, [effectiveSeason, league.draftBoardSnapshots]);

  // Perceived projected overall per prospect at draft time — mean observed-skill
  // across all 32 boards in the season's snapshot. Feeds the perceived draft
  // grade (shown next to the rookie's real grade). Null when no snapshot.
  const perceivedOverallForSeason = useMemo(() => {
    if (effectiveSeason === null) return null;
    const snapshot = league.draftBoardSnapshots[effectiveSeason];
    if (!snapshot) return null;
    const agg = new Map<string, { s: number; n: number }>();
    for (const board of Object.values(snapshot)) {
      for (const e of board) {
        const cur = agg.get(e.collegePlayerId) ?? { s: 0, n: 0 };
        cur.s += e.observedSkillScore;
        cur.n += 1;
        agg.set(e.collegePlayerId, cur);
      }
    }
    const m = new Map<string, number>();
    for (const [id, { s, n }] of agg) m.set(id, s / n);
    return m;
  }, [effectiveSeason, league.draftBoardSnapshots]);

  if (seasons.length === 0) {
    return (
      <section className="mb-8 rounded border border-zinc-800 bg-zinc-900/40 p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-zinc-300">
          Draft results
        </h2>
        <p className="text-xs text-zinc-500">
          No draft has been run yet. Drafts fire each offseason during <code>advanceSeason</code>;
          simulate + advance the league to see picks here.
        </p>
      </section>
    );
  }

  const picks = effectiveSeason !== null ? seasons.find(([s]) => s === effectiveSeason)?.[1] ?? [] : [];

  return (
    <section className="mb-8 rounded border border-amber-500/40 bg-amber-500/10 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-200">
          Draft results — Season {effectiveSeason} ({picks.length} picks)
        </h2>
        <div className="flex items-center gap-1 text-xs">
          <span className="text-zinc-500 uppercase tracking-wide text-[10px]">season</span>
          {seasons.map(([s]) => (
            <button
              key={s}
              onClick={() => setSelectedSeason(s)}
              className={`rounded border px-2 py-0.5 font-mono ${
                s === effectiveSeason
                  ? 'border-amber-400 bg-amber-500/30 text-amber-100'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-amber-500/40 hover:text-amber-300'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-zinc-500">
            <tr className="border-b border-zinc-800">
              <th className="px-2 py-1 text-right">#</th>
              <th className="px-2 py-1 text-left">Team</th>
              <th className="px-2 py-1 text-left">Rookie</th>
              <th className="px-2 py-1 text-left">Pos</th>
              <th className="px-2 py-1 text-right" title="Draft grade (NFL.com 8-pt scale) — perceived (board consensus at draft time) / real (ground truth)">Draft grd</th>
              <th className="px-2 py-1 text-left">From</th>
              <th className="px-2 py-1 text-center">Board rank</th>
              <th
                className="px-2 py-1 text-center"
                title="Consensus rank (totalPriority-sorted aggregate across all 32 boards at draft time)"
              >
                Consensus
              </th>
              <th
                className="px-2 py-1 text-center"
                title="Reach = consensus rank − overall pick. Positive = reach, negative = steal."
              >
                Reach
              </th>
              <th className="px-2 py-1 text-left">Reason</th>
              <th className="px-2 py-1 text-right">Priority</th>
            </tr>
          </thead>
          <tbody>
            {picks.map((pick) => {
              const team = league.teams[pick.teamId];
              const player = league.players[pick.promotedPlayerId];
              const school = getSchoolById(
                // CollegePlayer was removed from pool by promotion. We
                // pull school via the rookie's id — fallback to '?'
                // if the player record is missing for any reason.
                (league.collegePool.find((cp) => cp.id === pick.collegePlayerId)?.schoolId)
                  ?? '__missing',
              );
              const consRank = consensusRanksForSeason?.get(pick.collegePlayerId) ?? null;
              const reach = consRank !== null ? consRank - pick.overallPick : null;
              return (
                <tr key={`${pick.seasonNumber}-${pick.overallPick}`} className="border-b border-zinc-900 hover:bg-zinc-900/30">
                  <td className="px-2 py-1 text-right font-mono text-zinc-400">{pick.overallPick}</td>
                  <td className="px-2 py-1 font-mono text-zinc-200">{team?.identity.abbreviation ?? '?'}</td>
                  <td className="px-2 py-1 text-zinc-100">
                    {player ? `${player.firstName} ${player.lastName}` : '—'}
                    {player && (
                      <span className="ml-1 text-[10px] text-zinc-500">{player.tier.toLowerCase()}</span>
                    )}
                  </td>
                  <td className="px-2 py-1 font-mono text-zinc-400">
                    {player?.position ?? '?'}
                    {pick.convertedFromPosition && (
                      <span
                        className="ml-1 rounded bg-sky-500/20 px-1 text-[9px] text-sky-300"
                        title={`Drafted as a ${pick.convertedFromPosition}, converting to ${player?.position ?? '?'} (team need)`}
                      >
                        ←{pick.convertedFromPosition}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-right">
                    <DraftGradeCell
                      perceivedOverall={perceivedOverallForSeason?.get(pick.collegePlayerId) ?? null}
                      realOverall={player ? prospectProjectedOverall(player) : null}
                    />
                  </td>
                  <td className="px-2 py-1 text-[10px] text-zinc-500">
                    {school?.name ?? '—'}
                  </td>
                  <td className="px-2 py-1 text-center font-mono">
                    {pick.boardRankAtPick !== null ? (
                      <span className={pick.boardRankAtPick <= 5 ? 'text-emerald-300' : pick.boardRankAtPick <= 15 ? 'text-zinc-300' : 'text-amber-300'}>
                        #{pick.boardRankAtPick}
                      </span>
                    ) : (
                      <span className="text-zinc-600" title="Off-board pick (BPA fallback)">off</span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-center font-mono">
                    {consRank !== null ? (
                      <span className="text-emerald-300">#{consRank}</span>
                    ) : (
                      <span className="text-zinc-600" title="Off consensus (not on any team's board at draft time)">off</span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-center font-mono text-[11px]">
                    {reach === null ? (
                      <span className="text-zinc-600">—</span>
                    ) : reach >= 20 ? (
                      <span className="text-amber-300" title="Big reach (≥+20)">+{reach}</span>
                    ) : reach > 0 ? (
                      <span className="text-amber-400/80">+{reach}</span>
                    ) : reach === 0 ? (
                      <span className="text-zinc-300">0</span>
                    ) : reach <= -20 ? (
                      <span className="text-emerald-300" title="Big steal (≤−20)">{reach}</span>
                    ) : (
                      <span className="text-emerald-400/80">{reach}</span>
                    )}
                  </td>
                  <td className={`px-2 py-1 text-[10px] uppercase tracking-wide ${
                    pick.boardReasonAtPick ? REASON_COLORS[pick.boardReasonAtPick] : 'text-zinc-600'
                  }`}>
                    {pick.boardReasonAtPick ? REASON_LABELS[pick.boardReasonAtPick] : '—'}
                  </td>
                  <td className="px-2 py-1 text-right font-mono text-amber-300">
                    {pick.boardPriorityAtPick !== null ? pick.boardPriorityAtPick.toFixed(1) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[10px] text-zinc-600">
        Draft order = inverse of prior season's standings. Each team picks BPA from their own
        scheme-fit-aware board. Slice 5a fires round 1 only; rounds 2–7 + trade-ups land in 5b.
      </p>
    </section>
  );
}

function FreeAgentPoolPanel({ league }: { league: LeagueState }) {
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
  ['re-sign', 're-signs'],
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
    case 'ir-move':
    case 'ps-promotion':
    case 'contract-expiration':
    case 'cap-cut':
    case 'mood-shift':
    case 'trade-request':
      return [entry.playerId];
    case 'hc-fired':
    case 'gm-fired':
    case 'hc-hired':
    case 'gm-hired':
    case 'hc-interim':
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
    case 're-sign':
      return 'text-cyan-400';
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
      <GmMediaTrust mediaTrust={gm.spectrums.mediaTrust} />
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

// GM media trust (#5): how hard this GM lets the media consensus pull his draft
// board. Hidden ground truth — dev lens only; explains why a team's board
// chases (or ignores) public risers vs the consensus/Big Board.
function GmMediaTrust({ mediaTrust }: { mediaTrust: number }) {
  const tone =
    mediaTrust >= 7
      ? 'text-amber-300'
      : mediaTrust <= 3
        ? 'text-sky-300'
        : 'text-zinc-400';
  const flavor =
    mediaTrust >= 7 ? 'chases the buzz' : mediaTrust <= 3 ? 'film-room, ignores noise' : 'balanced';
  return (
    <div
      className="ml-[3.25rem] -mt-0.5 text-[10px] text-zinc-600"
      title="Hidden GM trait (dev lens): how hard the media consensus pulls this GM's draft board (1-10). High = chases public risers/darlings on thinly-scouted prospects; low = trusts only firsthand scouting. Drives how far his board diverges from the consensus toward the media board."
    >
      media trust <span className={`font-mono ${tone}`}>{mediaTrust}/10</span>
      <span className="ml-1 text-zinc-700">· {flavor}</span>
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

      <DepthChartCard team={team} league={league} />

      <TradeBuilderPanel team={team} league={league} onLeagueChange={onLeagueChange} />

      <ScoutingStaffPanel team={team} league={league} />

      <CollegeScoutingStaffPanel team={team} league={league} />

      <WatchListPanel team={team} league={league} />

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

      {seasonStats && <DepartedContributorsPanel team={team} league={league} />}

      {team.seasonHistory.length > 0 && (
        <SeasonHistoryTable history={team.seasonHistory} />
      )}
    </section>
  );
}

// ─── DEPARTED CONTRIBUTORS (stats truth) ───────────────────────────────────
//
// Players who accrued stats FOR this team this season but are no longer on
// its roster (midseason trade, cut, offseason FA departure, retirement).
// Joined through the stat line's sim-time `teamId` (`seasonStatsForTeam`),
// never the current roster — without this section a departed starting QB's
// yards silently vanish from the team view while his receivers' yards stay
// (the "650-yard QB room" illusion: roster QBs show ~650 passing yds under
// WRs showing 1300+ receiving yds each).
function statImpact(s: PlayerSeasonStats): number {
  return (
    s.passingYards +
    s.rushingYards +
    s.receivingYards +
    s.tackles * 5 +
    s.sacks * 40 +
    s.interceptions * 40
  );
}

function seasonStatHeadline(s: PlayerSeasonStats): string {
  const parts: string[] = [];
  if (s.passAttempts > 0)
    parts.push(`${s.passingYards.toLocaleString()} pass yds, ${s.passingTds} TD`);
  if (s.rushingYards >= 100) parts.push(`${s.rushingYards.toLocaleString()} rush yds`);
  if (s.receivingYards >= 100)
    parts.push(`${s.receptions} rec, ${s.receivingYards.toLocaleString()} yds`);
  if (s.sacks >= 2) parts.push(`${s.sacks} sk`);
  if (s.interceptions >= 1) parts.push(`${s.interceptions} INT`);
  if (parts.length === 0) parts.push(`${s.tackles} tkl`);
  return `${parts.join(' · ')} (${s.gamesPlayed} g)`;
}

/** Where did he go? Latest transaction involving the player tells the story. */
function departureNote(pid: PlayerId, league: LeagueState): string {
  let note = '';
  for (const tx of league.transactionLog) {
    switch (tx.kind) {
      case 'fa-sign':
        if (tx.playerId === pid)
          note = `signed with ${league.teams[tx.teamId]?.identity.abbreviation ?? '?'}`;
        break;
      case 'trade': {
        if (tx.playersAToB.includes(pid))
          note = `traded to ${league.teams[tx.teamBId]?.identity.abbreviation ?? '?'}`;
        else if (tx.playersBToA.includes(pid))
          note = `traded to ${league.teams[tx.teamAId]?.identity.abbreviation ?? '?'}`;
        break;
      }
      case 'release':
      case 'cap-cut':
        if (tx.playerId === pid) note = 'released';
        break;
      case 'contract-expiration':
        if (tx.playerId === pid) note = 'contract expired — unsigned';
        break;
      default:
        break;
    }
  }
  if (note) return note;
  const p = league.players[pid];
  if (!p) return 'retired';
  return 'off roster';
}

function DepartedContributorsPanel({
  team,
  league,
}: {
  team: TeamState;
  league: LeagueState;
}) {
  const departed = useMemo(() => {
    const accrued = seasonStatsForTeam(league, team.identity.id);
    const roster = new Set<PlayerId>(team.rosterIds);
    const rows: { pid: PlayerId; s: PlayerSeasonStats }[] = [];
    for (const [pid, s] of accrued) {
      if (roster.has(pid)) continue;
      if (statImpact(s) < 150) continue; // only meaningful contributors
      rows.push({ pid, s });
    }
    rows.sort((a, b) => statImpact(b.s) - statImpact(a.s));
    return rows;
  }, [team, league]);

  if (departed.length === 0) return null;
  return (
    <div className="mt-4 rounded border border-amber-500/30 bg-zinc-900/40 p-3">
      <h3
        className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-500/80"
        title="Stats these players accrued WITH this team this season before leaving the roster (trade, cut, free agency, retirement). Without them the team's box score doesn't add up — e.g. receivers showing yards no rostered QB threw."
      >
        Departed contributors ({departed.length}) — their stats stay with this season
      </h3>
      <table className="min-w-full text-xs">
        <tbody>
          {departed.map(({ pid, s }) => {
            const p = league.players[pid];
            return (
              <tr key={pid} className="border-t border-zinc-800/60 text-zinc-400">
                <td className="px-2 py-1 font-mono text-zinc-500">{p?.position ?? '—'}</td>
                <td className="px-2 py-1 text-zinc-300">
                  {p ? `${p.firstName} ${p.lastName}` : '(retired player)'}
                </td>
                <td className="px-2 py-1 font-mono">{seasonStatHeadline(s)}</td>
                <td className="px-2 py-1 italic text-amber-500/70">{departureNote(pid, league)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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
  const [expandedPlayerId, setExpandedPlayerId] = useState<PlayerId | null>(null);
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
              const isOpen = expandedPlayerId === p.id;
              return (
                <React.Fragment key={p.id}>
                  <tr
                    className={`cursor-pointer border-t border-zinc-800/60 hover:bg-amber-500/5 ${selected.has(p.id) ? 'bg-amber-500/15' : ''}`}
                    onClick={() => onToggle(p.id)}
                  >
                    <td
                      className="px-1 py-0.5 text-zinc-600 hover:text-zinc-300"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedPlayerId(isOpen ? null : p.id);
                      }}
                      title="Show detail"
                    >
                      {isOpen ? '▼' : '▶'}
                    </td>
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
                  {isOpen && (
                    <tr className="border-t border-zinc-800/60 bg-zinc-950/80">
                      <td colSpan={6} className="px-3 py-3">
                        <PlayerDetail player={p} league={league} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
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

// `forGroups` limits a granular group to relevant position groups (keeps a
// QB's detail from listing pass-rush moves). Undefined = show for everyone.
const SKILL_GROUPS: ReadonlyArray<{
  label: string;
  skills: ReadonlyArray<keyof PlayerSkills>;
  forGroups?: ReadonlyArray<PositionGroup>;
}> = [
  {
    label: 'Physical',
    skills: ['speed', 'acceleration', 'agility', 'changeOfDirection', 'strength', 'jumping', 'stamina', 'durability'],
  },
  {
    label: 'Mental',
    skills: ['footballIq', 'playRecognition', 'decisionMaking', 'composure', 'leadership', 'competitiveness', 'workEthic', 'coachability'],
  },
  {
    label: 'Technique (umbrella)',
    skills: ['technicalSkill', 'handsBallSkills', 'blockingTechnique', 'passRushTechnique', 'coverageTechnique', 'tacklingTechnique'],
  },
  {
    label: 'QB passing',
    forGroups: [PositionGroup.QB],
    skills: ['throwPower', 'accuracyShort', 'accuracyMedium', 'accuracyDeep', 'accuracyLeft', 'accuracyMiddle', 'accuracyRight', 'throwOnRun', 'throwUnderPressure', 'spectacularThrow', 'breakSack', 'playAction'],
  },
  {
    label: 'Ball carrier',
    forGroups: [PositionGroup.QB, PositionGroup.SKILL],
    skills: ['carrying', 'ballCarrierVision', 'jukeMove', 'spinMove', 'stiffArm', 'trucking', 'breakTackle', 'elusiveness'],
  },
  {
    label: 'Receiving',
    forGroups: [PositionGroup.SKILL],
    skills: ['routeShort', 'routeMedium', 'routeDeep', 'releaseVsPress', 'releaseVsOff', 'catching', 'catchInTraffic', 'contestedCatch'],
  },
  {
    label: 'Blocking',
    forGroups: [PositionGroup.OL, PositionGroup.SKILL],
    skills: ['runBlockPower', 'runBlockFinesse', 'passBlockPower', 'passBlockFinesse', 'impactBlock', 'leadBlock'],
  },
  {
    label: 'Pass rush',
    forGroups: [PositionGroup.DL, PositionGroup.LB],
    skills: ['getOff', 'bend', 'handTechnique', 'bullRush', 'longArm', 'pushPull', 'swimMove', 'ripMove', 'spinRush', 'crossChop', 'ghostMove'],
  },
  {
    label: 'Run defense / tackling',
    forGroups: [PositionGroup.DL, PositionGroup.LB, PositionGroup.DB],
    skills: ['blockShedding', 'tackle', 'hitPower', 'pursuit'],
  },
  {
    label: 'Coverage',
    forGroups: [PositionGroup.DB, PositionGroup.LB],
    skills: ['manCoverage', 'zoneCoverage', 'pressCoverage', 'ballSkills'],
  },
  {
    label: 'Special teams',
    forGroups: [PositionGroup.ST],
    skills: ['kickPower', 'kickAccuracy', 'puntPower', 'puntAccuracy'],
  },
];

const SKILL_LABELS: Record<keyof PlayerSkills, string> = {
  speed: 'Speed',
  acceleration: 'Acceleration',
  agility: 'Agility',
  changeOfDirection: 'Change of direction',
  strength: 'Strength',
  jumping: 'Jumping',
  stamina: 'Stamina',
  durability: 'Durability',
  technicalSkill: 'Technical skill',
  footballIq: 'Football IQ',
  playRecognition: 'Play recognition',
  decisionMaking: 'Decision making',
  handsBallSkills: 'Hands / ball skills',
  blockingTechnique: 'Blocking technique',
  passRushTechnique: 'Pass-rush technique',
  coverageTechnique: 'Coverage technique',
  tacklingTechnique: 'Tackling technique',
  leadership: 'Leadership',
  competitiveness: 'Competitiveness',
  workEthic: 'Work ethic',
  coachability: 'Coachability',
  composure: 'Composure',
  // QB
  throwPower: 'Throw power',
  accuracyShort: 'Accuracy: short',
  accuracyMedium: 'Accuracy: medium',
  accuracyDeep: 'Accuracy: deep',
  accuracyLeft: 'Accuracy: left',
  accuracyMiddle: 'Accuracy: middle',
  accuracyRight: 'Accuracy: right',
  throwOnRun: 'Throw on run',
  throwUnderPressure: 'Throw under pressure',
  spectacularThrow: 'Spectacular throw',
  breakSack: 'Break sack',
  playAction: 'Play action',
  // Ball carrier
  carrying: 'Carrying',
  ballCarrierVision: 'Vision',
  jukeMove: 'Juke move',
  spinMove: 'Spin move',
  stiffArm: 'Stiff arm',
  trucking: 'Trucking',
  breakTackle: 'Break tackle',
  elusiveness: 'Elusiveness',
  // Receiving
  routeShort: 'Route: short',
  routeMedium: 'Route: medium',
  routeDeep: 'Route: deep',
  releaseVsPress: 'Release vs press',
  releaseVsOff: 'Release vs off',
  catching: 'Catching',
  catchInTraffic: 'Catch in traffic',
  contestedCatch: 'Contested catch',
  // Blocking
  runBlockPower: 'Run block: power',
  runBlockFinesse: 'Run block: finesse',
  passBlockPower: 'Pass block: power',
  passBlockFinesse: 'Pass block: finesse',
  impactBlock: 'Impact block',
  leadBlock: 'Lead block',
  // Pass rush
  bullRush: 'Bull rush',
  longArm: 'Long arm',
  pushPull: 'Push/pull',
  swimMove: 'Swim move',
  ripMove: 'Rip move',
  spinRush: 'Spin (rush)',
  crossChop: 'Cross chop',
  ghostMove: 'Ghost / euro',
  getOff: 'Get-off',
  bend: 'Bend',
  handTechnique: 'Hand technique',
  // Run D / tackling
  blockShedding: 'Block shedding',
  tackle: 'Tackle',
  hitPower: 'Hit power',
  pursuit: 'Pursuit',
  // Coverage
  manCoverage: 'Man coverage',
  zoneCoverage: 'Zone coverage',
  pressCoverage: 'Press coverage',
  ballSkills: 'Ball skills (def)',
  // Special teams
  kickPower: 'Kick power',
  kickAccuracy: 'Kick accuracy',
  puntPower: 'Punt power',
  puntAccuracy: 'Punt accuracy',
};

const QUIRK_LABELS: Record<ScoutQuirk, { label: string; description: string }> = {
  OVERVALUES_NAME_RECOGNITION: {
    label: 'name recognition',
    description: 'Pushes estimates upward for award-winners and stars.',
  },
  SHARP_ON_ROLE_PLAYERS: {
    label: 'role-player eye',
    description: 'Sharper on BACKUP / FRINGE tier; less reliable on stars.',
  },
  MISSES_SCHEME_FIT: {
    label: 'misses scheme fit',
    description: 'Higher noise on technique skills (blocking, pass-rush, coverage, tackling, technical).',
  },
  PRACTICE_SQUAD_GEM_HUNTER: {
    label: 'PS gem hunter',
    description: 'Very sharp on FRINGE tier — finds undervalued practice-squad talent.',
  },
  YOUNG_PLAYER_BIAS: {
    label: 'young-player bias',
    description: 'Sharper on <3yr exp; downgrades 8+yr veterans.',
  },
  VETERAN_LOYALIST: {
    label: 'veteran loyalist',
    description: 'Sharper on 8+yr veterans (with a small upward bias); blurrier on rookies.',
  },
};

const WATCH_LIST_REASON: Record<WatchListReason, { label: string; description: string; className: string }> = {
  SCHEME_FIT: {
    label: 'scheme fit',
    description: 'Strong archetype match for the team\'s scheme — high projected upside in this system.',
    className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  },
  POSITIONAL_NEED: {
    label: 'positional need',
    description: 'Team is thin at this position group — talent matters more than fit at this slot.',
    className: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  },
  MISCAST_ELEVATION: {
    label: 'miscast elevation',
    description: 'Talented player on a team whose scheme poorly suits them — they\'d elevate in ours. Highest-value target type per Doc 4.',
    className: 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300',
  },
  ROLE_PLAYER: {
    label: 'role player',
    description: 'Observed skill is high relative to tier — could fill a targeted role.',
    className: 'border-zinc-700 bg-zinc-900 text-zinc-300',
  },
};

const POSITION_GROUPS_ORDERED: readonly PositionGroup[] = [
  PositionGroup.QB,
  PositionGroup.SKILL,
  PositionGroup.OL,
  PositionGroup.DL,
  PositionGroup.LB,
  PositionGroup.DB,
  PositionGroup.ST,
];

function accuracyTone(value: number): string {
  if (value >= 0.8) return 'text-emerald-400';
  if (value >= 0.65) return 'text-zinc-200';
  if (value >= 0.5) return 'text-zinc-400';
  return 'text-zinc-600';
}

function skillDeltaTone(delta: number): string {
  const abs = Math.abs(delta);
  if (abs <= 3) return 'text-zinc-600';
  if (abs <= 8) return 'text-zinc-400';
  if (delta > 0) return 'text-emerald-400';
  return 'text-rose-400';
}

const DEV_ARCHETYPE_LABELS: Record<Player['developmentArchetype'], string> = {
  FAST_LEARNER: 'Fast learner',
  SLOW_STEADY: 'Slow & steady',
  ADVERSITY_DRIVEN: 'Adversity-driven',
  EARLY_BLOOMER: 'Early bloomer',
  LATE_DEVELOPER: 'Late developer',
  CONFIDENCE_DEPENDENT: 'Confidence-dependent',
};

function skillTone(value: number): string {
  if (value >= 85) return 'text-emerald-400';
  if (value >= 70) return 'text-zinc-200';
  if (value >= 55) return 'text-zinc-400';
  return 'text-zinc-600';
}

function skillWeightChip(weight: number): { className: string; label: string } | null {
  if (weight >= 1.4) return { className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300', label: 'key' };
  if (weight >= 1.2) return { className: 'border-zinc-600 bg-zinc-800/60 text-zinc-300', label: 'core' };
  if (weight < 0.85) return { className: 'border-zinc-800 bg-zinc-900 text-zinc-600', label: 'minor' };
  return null;
}

// Numeric count keys only — excludes the identity fields (playerId, teamId).
type StatColumn = { key: Exclude<keyof PlayerSeasonStats, 'playerId' | 'teamId'>; label: string };

function careerStatColumns(position: Position): readonly StatColumn[] {
  switch (position) {
    case Position.QB:
      return [
        { key: 'passAttempts', label: 'att' },
        { key: 'passCompletions', label: 'cmp' },
        { key: 'passingYards', label: 'yds' },
        { key: 'passingTds', label: 'TD' },
        { key: 'interceptionsThrown', label: 'INT' },
      ];
    case Position.RB:
    case Position.FB:
      return [
        { key: 'rushingAttempts', label: 'att' },
        { key: 'rushingYards', label: 'yds' },
        { key: 'rushingTds', label: 'TD' },
        { key: 'receptions', label: 'rec' },
        { key: 'receivingYards', label: 'recYds' },
      ];
    case Position.WR:
    case Position.TE:
      return [
        { key: 'targets', label: 'tgt' },
        { key: 'receptions', label: 'rec' },
        { key: 'receivingYards', label: 'yds' },
        { key: 'receivingTds', label: 'TD' },
      ];
    case Position.EDGE:
    case Position.DT:
    case Position.NT:
      return [
        { key: 'tackles', label: 'tkl' },
        { key: 'sacks', label: 'sk' },
      ];
    case Position.ILB:
    case Position.OLB:
      return [
        { key: 'tackles', label: 'tkl' },
        { key: 'sacks', label: 'sk' },
        { key: 'interceptions', label: 'INT' },
      ];
    case Position.CB:
    case Position.S:
    case Position.NICKEL:
      return [
        { key: 'tackles', label: 'tkl' },
        { key: 'interceptions', label: 'INT' },
      ];
    default:
      return [];
  }
}

function ScoutingStaffPanel({
  team,
  league,
}: {
  team: TeamState;
  league: LeagueState;
}) {
  const scouts = useMemo(
    () =>
      team.scoutIds
        .map((id) => league.scouts[id])
        .filter((s): s is Scout => s !== undefined),
    [team.scoutIds, league.scouts],
  );
  const obsCountByScout = useMemo(() => {
    const counts = new Map<string, number>();
    for (const obs of league.observations) {
      counts.set(obs.scoutId, (counts.get(obs.scoutId) ?? 0) + 1);
    }
    return counts;
  }, [league.observations]);
  if (scouts.length === 0) return null;
  return (
    <section className="mb-4 rounded border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Pro scouting staff ({scouts.length})
        </h3>
        <span className="text-[10px] text-zinc-600" title="Per-group accuracy + quirks are HIDDEN from the GM. Inspector exposes them for tuning.">
          inspector view — hidden state shown
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
        {scouts.map((scout) => (
          <ScoutCard
            key={scout.id}
            scout={scout}
            observationCount={obsCountByScout.get(scout.id) ?? 0}
          />
        ))}
      </div>
    </section>
  );
}

function CollegeScoutingStaffPanel({
  team,
  league,
}: {
  team: TeamState;
  league: LeagueState;
}) {
  const scouts = useMemo(
    () =>
      team.collegeScoutIds
        .map((id) => league.collegeScouts[id])
        .filter((s): s is CollegeScout => s !== undefined),
    [team.collegeScoutIds, league.collegeScouts],
  );
  const obsCountByScout = useMemo(() => {
    const counts = new Map<string, number>();
    for (const obs of league.collegeObservations) {
      counts.set(obs.scoutId, (counts.get(obs.scoutId) ?? 0) + 1);
    }
    return counts;
  }, [league.collegeObservations]);
  if (scouts.length === 0) return null;
  return (
    <section className="mb-4 rounded border border-violet-500/30 bg-violet-500/5 p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-violet-300">
          College scouting staff ({scouts.length})
        </h3>
        <span className="text-[10px] text-zinc-600" title="Per-group accuracy + quirks are HIDDEN from the GM. Inspector exposes them for tuning.">
          inspector view — hidden state shown
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
        {scouts.map((scout) => (
          <ScoutCard
            key={scout.id}
            scout={scout}
            observationCount={obsCountByScout.get(scout.id) ?? 0}
          />
        ))}
      </div>
    </section>
  );
}

function regionBadgeTone(region: ScoutRegion): string {
  switch (region) {
    case 'NORTHEAST':
      return 'border-sky-500/40 bg-sky-500/10 text-sky-300';
    case 'SOUTHEAST':
      return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
    case 'MIDWEST':
      return 'border-orange-500/40 bg-orange-500/10 text-orange-300';
    case 'SOUTHWEST':
      return 'border-rose-500/40 bg-rose-500/10 text-rose-300';
    case 'WEST':
      return 'border-violet-500/40 bg-violet-500/10 text-violet-300';
    case 'NATIONAL':
      return 'border-zinc-500/40 bg-zinc-500/10 text-zinc-300';
  }
}

function ScoutCard({
  scout,
  observationCount,
}: {
  scout: Scout | CollegeScout;
  observationCount: number;
}) {
  const preferredRegion = 'preferredRegion' in scout ? scout.preferredRegion : null;
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/60 p-2 text-xs">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <div className="font-medium text-zinc-200">{scout.name}</div>
        <div className="text-[10px] text-zinc-500">
          age {scout.age} · {scout.yearsExperience}y exp
        </div>
      </div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-[10px] text-zinc-500">
        <span>
          known specialty:{' '}
          <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1 py-0.5 font-mono uppercase tracking-wider text-emerald-300">
            {scout.knownSpecialty}
          </span>
          {preferredRegion && (
            <span
              className={`ml-1 rounded border px-1 py-0.5 font-mono uppercase tracking-wider ${regionBadgeTone(preferredRegion)}`}
              title="College scouts carry a regional preference — bonus accuracy when evaluating prospects from this region."
            >
              {preferredRegion}
            </span>
          )}
        </span>
        <span
          className="font-mono text-zinc-600"
          title="Total observations this scout has produced across all cycles."
        >
          {observationCount} report{observationCount === 1 ? '' : 's'}
        </span>
      </div>
      <div className="mb-1 flex flex-wrap gap-1">
        {POSITION_GROUPS_ORDERED.map((group) => {
          const acc = scout.trueAccuracy[group];
          const isSpecialty = group === scout.knownSpecialty;
          return (
            <span
              key={group}
              className={`rounded border border-zinc-800 bg-zinc-900 px-1 py-0.5 font-mono text-[10px] ${accuracyTone(acc)} ${
                isSpecialty ? 'ring-1 ring-emerald-500/30' : ''
              }`}
              title={`Hidden true accuracy in ${group}: ${acc.toFixed(2)}`}
            >
              {group} {acc.toFixed(2)}
            </span>
          );
        })}
      </div>
      {scout.quirks.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {scout.quirks.map((q) => {
            const def = QUIRK_LABELS[q];
            return (
              <span
                key={q}
                title={def.description}
                className="rounded border border-fuchsia-500/30 bg-fuchsia-500/10 px-1 py-0.5 text-[10px] uppercase tracking-wider text-fuchsia-300"
              >
                {def.label}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WatchListPanel({
  team,
  league,
}: {
  team: TeamState;
  league: LeagueState;
}) {
  const list = league.watchLists[team.identity.id] ?? [];
  if (list.length === 0) return null;
  const hc = league.coaches[team.headCoachId];
  return (
    <section className="mb-4 rounded border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Watch list ({list.length})
        </h3>
        <span className="text-[10px] text-zinc-600" title="Built from this team's own scouts' observations + scheme + needs. Inspector exposes every team's list; the eventual game UI shows only the viewer's team's list.">
          inspector view — all teams visible elsewhere
        </span>
      </div>
      <div className="overflow-x-auto rounded border border-zinc-800">
        <table className="min-w-full text-xs">
          <thead className="bg-zinc-900/60 text-left text-zinc-500">
            <tr>
              <th className="px-2 py-1 font-medium" title="Composite priority — observedSkill × schemeFit × meanConfidence × need.">
                pri
              </th>
              <th className="px-2 py-1 font-medium">player</th>
              <th className="px-2 py-1 font-medium">current</th>
              <th className="px-2 py-1 font-medium">reason</th>
              <th className="px-2 py-1 font-medium" title="Confidence-weighted aggregate of this player's archetype-relevant skills from our observations.">
                obs skill
              </th>
              <th className="px-2 py-1 font-medium" title="Scheme-fit multiplier for this player's archetype in our scheme.">
                fit
              </th>
              <th className="px-2 py-1 font-medium" title="Mean per-skill confidence across our observations of this player.">
                conf
              </th>
              <th className="px-2 py-1 font-medium" title="Number of independent observations our scouts have on this player.">
                #obs
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((entry) => (
              <WatchListRow key={entry.playerId} entry={entry} league={league} hcScheme={hc?.offensiveScheme ?? null} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function WatchListRow({
  entry,
  league,
  hcScheme,
}: {
  entry: WatchListEntry;
  league: LeagueState;
  hcScheme: string | null;
}) {
  const player = league.players[entry.playerId];
  const currentTeamId = player?.teamId ?? null;
  const currentTeam = currentTeamId ? league.teams[currentTeamId] : null;
  const reason = WATCH_LIST_REASON[entry.reason];
  const fitTone =
    entry.schemeFit >= 1.4
      ? 'text-emerald-400'
      : entry.schemeFit <= 0.85
        ? 'text-rose-400'
        : 'text-zinc-400';
  void hcScheme;
  return (
    <tr className="border-t border-zinc-800/60">
      <td className="px-2 py-1 font-mono text-zinc-300">{entry.priority.toFixed(1)}</td>
      <td className="px-2 py-1">
        {player ? (
          <>
            <span className="text-zinc-200">
              {player.firstName} {player.lastName}
            </span>
            <span className="ml-1 font-mono text-[10px] text-zinc-500">
              {player.tier.toLowerCase()} {player.position}
            </span>
          </>
        ) : (
          <span className="font-mono text-zinc-600">{entry.playerId}</span>
        )}
      </td>
      <td className="px-2 py-1 font-mono text-[10px] text-zinc-400">
        {currentTeam?.identity.abbreviation ?? 'FA'}
      </td>
      <td className="px-2 py-1">
        <span
          title={reason.description}
          className={`rounded border px-1 py-0.5 text-[9px] font-mono uppercase tracking-wider ${reason.className}`}
        >
          {reason.label}
        </span>
      </td>
      <td className="px-2 py-1 font-mono">{entry.observedSkillScore.toFixed(1)}</td>
      <td className={`px-2 py-1 font-mono ${fitTone}`}>{entry.schemeFit.toFixed(2)}</td>
      <td className={`px-2 py-1 font-mono ${accuracyTone(entry.meanConfidence)}`}>
        {entry.meanConfidence.toFixed(2)}
      </td>
      <td className="px-2 py-1 font-mono text-zinc-500">{entry.observationCount}</td>
    </tr>
  );
}

function TrackedByPanel({
  player,
  league,
}: {
  player: Player;
  league: LeagueState;
}) {
  const trackers = useMemo(() => {
    const out: { teamAbbr: string; reason: WatchListReason; priority: number }[] = [];
    for (const [teamId, list] of Object.entries(league.watchLists)) {
      const entry = list.find((e) => e.playerId === player.id);
      if (!entry) continue;
      const team = league.teams[teamId as TeamId];
      out.push({
        teamAbbr: team?.identity.abbreviation ?? teamId,
        reason: entry.reason,
        priority: entry.priority,
      });
    }
    return out.sort((a, b) => b.priority - a.priority);
  }, [league.watchLists, league.teams, player.id]);

  if (trackers.length === 0) return null;
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/60 p-2">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
        Tracked by {trackers.length} team{trackers.length === 1 ? '' : 's'}
      </div>
      <div className="flex flex-wrap gap-1">
        {trackers.map((t) => {
          const reason = WATCH_LIST_REASON[t.reason];
          return (
            <span
              key={t.teamAbbr}
              title={`${reason.label} · priority ${t.priority.toFixed(1)}`}
              className={`rounded border px-1.5 py-0.5 text-[10px] font-mono ${reason.className}`}
            >
              {t.teamAbbr}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ScoutObservationsPanel({
  player,
  league,
}: {
  player: Player;
  league: LeagueState;
}) {
  const observations = useMemo(
    () => league.observations.filter((o) => o.playerId === player.id),
    [league.observations, player.id],
  );
  if (observations.length === 0) return null;
  const grouped = groupObservationsByTeam(observations, league);
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/60 p-2">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
        Scout observations ({observations.length}) — inspector view, all teams
      </div>
      <div className="space-y-2">
        {grouped.map((entry) => (
          <div key={entry.teamId ?? 'unknown'} className="rounded border border-zinc-800/60 bg-zinc-950/40 p-2">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
              {entry.teamAbbr} ({entry.observations.length})
            </div>
            <div className="space-y-1">
              {entry.observations.map((obs, i) => (
                <ObservationRow key={i} player={player} observation={obs} scoutName={entry.scoutNames[i] ?? 'Unknown'} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ObservationRow({
  player,
  observation,
  scoutName,
}: {
  player: Player;
  observation: PlayerObservation;
  scoutName: string;
}) {
  const confidenceValues = Object.values(observation.confidence) as number[];
  const meanConfidence =
    confidenceValues.length === 0
      ? 0
      : confidenceValues.reduce((s, v) => s + v, 0) / confidenceValues.length;
  return (
    <div>
      <div className="mb-0.5 flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-zinc-300">{scoutName}</span>
        <span className={`font-mono ${accuracyTone(meanConfidence)}`} title="Mean per-skill confidence">
          conf {meanConfidence.toFixed(2)} · tick {observation.observedOnTick}
        </span>
      </div>
      <div className="flex flex-wrap gap-1 font-mono text-[10px]">
        {(Object.entries(observation.skills) as [keyof PlayerSkills, number][])
          .map(([skill, observed]) => {
            const truth = player.current[skill];
            const delta = observed - truth;
            return (
              <span
                key={skill}
                title={`${SKILL_LABELS[skill]}: observed ${observed}, truth ${truth}, Δ ${delta >= 0 ? '+' : ''}${delta}`}
                className="rounded border border-zinc-800 bg-zinc-900 px-1 py-0.5"
              >
                <span className="text-zinc-500">{skill.slice(0, 4)}</span>{' '}
                <span className="text-zinc-300">{observed}</span>
                <span className={`ml-0.5 ${skillDeltaTone(delta)}`}>
                  {delta >= 0 ? '+' : ''}
                  {delta}
                </span>
              </span>
            );
          })}
      </div>
    </div>
  );
}

function groupObservationsByTeam(
  observations: readonly PlayerObservation[],
  league: LeagueState,
): ReadonlyArray<{
  teamId: TeamId | null;
  teamAbbr: string;
  observations: readonly PlayerObservation[];
  scoutNames: readonly string[];
}> {
  const scoutTeam = new Map<string, TeamId>();
  for (const team of Object.values(league.teams)) {
    for (const sid of team.scoutIds) scoutTeam.set(sid, team.identity.id);
  }
  const byTeam = new Map<
    string,
    { teamId: TeamId | null; teamAbbr: string; observations: PlayerObservation[]; scoutNames: string[] }
  >();
  for (const obs of observations) {
    const teamId = scoutTeam.get(obs.scoutId) ?? null;
    const key = teamId ?? '__unknown__';
    let entry = byTeam.get(key);
    if (!entry) {
      const abbr = teamId ? league.teams[teamId]?.identity.abbreviation ?? '???' : '???';
      entry = { teamId, teamAbbr: abbr, observations: [], scoutNames: [] };
      byTeam.set(key, entry);
    }
    entry.observations.push(obs);
    entry.scoutNames.push(league.scouts[obs.scoutId]?.name ?? 'Unknown');
  }
  // Within each team, sort observations newest-first so the most recent
  // report bubbles up. Keep `scoutNames` aligned with the sort.
  for (const entry of byTeam.values()) {
    const pairs = entry.observations.map((o, i) => ({ o, name: entry.scoutNames[i] ?? 'Unknown' }));
    pairs.sort((a, b) => b.o.observedOnTick - a.o.observedOnTick);
    entry.observations = pairs.map((p) => p.o);
    entry.scoutNames = pairs.map((p) => p.name);
  }
  return Array.from(byTeam.values()).sort((a, b) => a.teamAbbr.localeCompare(b.teamAbbr));
}

function PlayerDetail({ player, league }: { player: Player; league: LeagueState }) {
  const archetype = getArchetypeById(player.archetype);
  const team = player.teamId ? league.teams[player.teamId] : null;
  const hc = team ? league.coaches[team.headCoachId] : null;
  const contract = player.contractId ? league.contracts[player.contractId] : null;
  const fit = hc
    ? schemeFitForPlayer(player, {
        offensiveScheme: hc.offensiveScheme as never,
        defensiveScheme: hc.defensiveScheme as never,
      })
    : null;
  const age = ageOfPlayer(player, league.seasonNumber);
  const bucket = moodBucket(player.mood);
  const statCols = careerStatColumns(player.position);

  // Scribe NFL-player takes about this player (v0.121) — most recent first.
  const mediaScoutReports = useMemo(
    () =>
      league.mediaReports
        .filter(
          (r): r is Extract<MediaReport, { kind: 'player-take' }> =>
            r.kind === 'player-take' && r.subjectPlayerId === player.id && !!r.scoutReport,
        )
        .slice(-6)
        .reverse()
        .map((r) => ({ report: r, outlet: league.mediaOutlets[r.outletId] })),
    [league.mediaReports, league.mediaOutlets, player.id],
  );

  return (
    <div className="space-y-3 text-xs">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <div className="font-semibold text-zinc-200">
          {player.firstName} {player.lastName}
        </div>
        <div className="text-zinc-500">
          {player.tier.toLowerCase()} · {player.position} ·{' '}
          {archetype?.label ?? player.archetype}
        </div>
        <div className="text-zinc-600">
          age {age} · {player.experienceYears}yr exp · born {player.birthDate}
        </div>
        {fit !== null && hc && (
          <div
            title={`Scheme fit in ${hc.offensiveScheme} / ${hc.defensiveScheme}`}
            className={`rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] ${
              fit >= 1.4 ? 'text-emerald-400' : fit <= 0.85 ? 'text-rose-400' : 'text-zinc-400'
            }`}
          >
            fit {fit.toFixed(2)}
          </div>
        )}
      </div>
      {archetype?.description && (
        <div className="text-zinc-500">{archetype.description}</div>
      )}

      {/* College backstory carried in from the draft (v0.119). */}
      {player.collegeBackstory && (
        <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
            College backstory
          </div>
          <div className="text-zinc-300">{narrateBackstory(player.collegeBackstory)}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {[
              player.collegeBackstory.transferred && 'Transfer',
              player.collegeBackstory.redshirted && 'Redshirt',
            ]
              .filter((x): x is string => Boolean(x))
              .map((label) => (
                <span
                  key={label}
                  className="rounded border border-teal-500/30 bg-teal-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-teal-300"
                >
                  {label}
                </span>
              ))}
          </div>
        </div>
      )}

      {/* Scribe NFL-player takes — in-season media reads (v0.121). */}
      {mediaScoutReports.length > 0 && (
        <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
            Media takes
          </div>
          <div className="space-y-2">
            {mediaScoutReports.map(({ report, outlet }) => {
              const sr = report.scoutReport!;
              return (
                <div key={report.id} className="border-l-2 border-zinc-700 pl-2">
                  <div className="text-[10px] uppercase tracking-wider text-sky-400/80">
                    {outlet?.name ?? report.outletId}
                    {report.weekNumber ? ` · Wk ${report.weekNumber}` : ''}
                  </div>
                  <div className={report.tone === 'CRITICAL' ? 'text-rose-300' : 'text-zinc-300'}>
                    {report.headline}
                  </div>
                  <div className="mt-1 text-zinc-400">{sr.summary}</div>
                  <ul className="mt-0.5 space-y-0.5">
                    {sr.strengths.map((s, i) => (
                      <li key={i} className="text-emerald-300/80">
                        + {s}
                      </li>
                    ))}
                    <li className="text-amber-300/80">– {sr.concern}</li>
                  </ul>
                  {sr.comp && <div className="mt-0.5 italic text-zinc-500">{sr.comp}</div>}
                  <div className="mt-0.5 text-zinc-300">→ {sr.bottomLine}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {SKILL_GROUPS.filter(
          (g) => !g.forGroups || g.forGroups.includes(player.positionGroup),
        ).map((groupDef) => (
          <div key={groupDef.label} className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
              {groupDef.label}
            </div>
            <table className="w-full">
              <tbody>
                {groupDef.skills.map((skill) => {
                  const cur = player.current[skill];
                  const ceil = player.ceiling[skill];
                  const weight = archetype?.skillWeights[skill] ?? 1.0;
                  const chip = skillWeightChip(weight);
                  return (
                    <tr key={skill}>
                      <td className="py-0.5 pr-2 text-zinc-400">{SKILL_LABELS[skill]}</td>
                      <td className={`py-0.5 pr-1 text-right font-mono ${skillTone(cur)}`}>
                        {cur}
                      </td>
                      <td
                        className="py-0.5 pr-2 text-right font-mono text-zinc-600"
                        title="Hidden ceiling — never shown to player"
                      >
                        /{ceil}
                      </td>
                      <td className="py-0.5 text-right">
                        {chip && (
                          <span
                            title={`Archetype skill weight: ${weight.toFixed(2)}`}
                            className={`rounded border px-1 py-0.5 text-[9px] font-mono uppercase tracking-wider ${chip.className}`}
                          >
                            {chip.label}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Development</div>
          <div className="text-zinc-300">
            {DEV_ARCHETYPE_LABELS[player.developmentArchetype]}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Mood</div>
          <div className={moodBucketTone(bucket)}>
            {bucket.replace('_', ' ')}{' '}
            <span className="font-mono text-zinc-500">({Math.round(player.mood)})</span>
          </div>
          <div className="mt-0.5 text-[10px] text-zinc-500">
            {moodArchetypeLabel(player.moodProfile.archetype)} · setPoint{' '}
            {player.moodProfile.setPoint} · vol {player.moodProfile.volatility} · res{' '}
            {player.moodProfile.resilience.toFixed(1)}
          </div>
          {player.tradeRequestedOnTick !== null && (
            <div className="mt-0.5 text-fuchsia-300">
              Requested trade on tick {player.tradeRequestedOnTick}
            </div>
          )}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Conditioning</div>
          <div className="font-mono text-zinc-300">{Math.round(player.conditioning)} / 100</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Injury</div>
          <InjuryCell player={player} league={league} />
        </div>
      </div>

      {contract ? (
        <div className="rounded border border-zinc-800 bg-zinc-950/60 p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
            Contract — current-year cap hit {formatMoney(currentCapHit(contract))}
          </div>
          <ContractTermsTable contract={contract} />
        </div>
      ) : (
        <div className="text-zinc-600">No contract on file — free agent.</div>
      )}

      {player.careerStats.length > 0 && statCols.length > 0 && (
        <div className="rounded border border-zinc-800 bg-zinc-950/60 p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
            Career stats — {player.careerStats.length} season
            {player.careerStats.length === 1 ? '' : 's'}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-[11px]">
              <thead className="text-zinc-500">
                <tr>
                  <th className="px-1 py-0.5 text-left font-medium">season</th>
                  <th className="px-1 py-0.5 text-right font-medium">G</th>
                  {statCols.map((c) => (
                    <th key={c.key} className="px-1 py-0.5 text-right font-medium">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...player.careerStats]
                  .sort((a, b) => a.seasonNumber - b.seasonNumber)
                  .map((row) => (
                    <tr key={row.seasonNumber} className="border-t border-zinc-900">
                      <td className="px-1 py-0.5 font-mono text-zinc-500">
                        s{row.seasonNumber}
                      </td>
                      <td className="px-1 py-0.5 text-right font-mono text-zinc-400">
                        {row.gamesPlayed}
                      </td>
                      {statCols.map((c) => {
                        const v = row[c.key];
                        return (
                          <td
                            key={c.key}
                            className="px-1 py-0.5 text-right font-mono text-zinc-300"
                          >
                            {v === 0 ? '·' : v.toLocaleString()}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {player.careerAwards.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
            Career awards
          </div>
          <div className="flex flex-wrap gap-1 font-mono">
            {[...player.careerAwards]
              .sort((a, b) => a.seasonNumber - b.seasonNumber)
              .map((a, i) => (
                <span
                  key={i}
                  className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-amber-300"
                >
                  s{a.seasonNumber} {a.kind}
                </span>
              ))}
          </div>
        </div>
      )}

      <TrackedByPanel player={player} league={league} />

      <ScoutObservationsPanel player={player} league={league} />
    </div>
  );
}

// Draft provenance / backstory badge (v0.92) — dev calibration lens for
// the pedigree the QB-need rule (and future narrative) reads. R1 picks
// stand out; later rounds muted; UDFAs dimmest.
function DraftPedigreeBadge({ player }: { player: Player }) {
  const round = player.draftRound;
  const pick = player.draftOverallPick;
  if (round === undefined) return null; // pre-provenance data
  const label = round === null ? 'UDFA' : `R${round}${pick ? ` #${pick}` : ''}`;
  const tone =
    round === null
      ? 'border-zinc-700/50 text-zinc-600'
      : round === 1
        ? 'border-violet-500/50 bg-violet-500/10 text-violet-300'
        : round <= 3
          ? 'border-zinc-600/50 text-zinc-400'
          : 'border-zinc-700/50 text-zinc-500';
  return (
    <span
      className={`ml-2 rounded border px-1 py-0.5 text-[9px] font-mono uppercase tracking-wider ${tone}`}
      title={`Draft provenance (backstory): ${
        round === null ? 'undrafted (UDFA)' : `round ${round}, overall pick ${pick ?? '?'}`
      }`}
    >
      {label}
    </span>
  );
}

// Hidden abilities / X-Factors (v0.102). Inspector dev-lens only — the
// game UI surfaces descriptive scout/media hints, never these flags.
// X-Factors get a louder treatment; Superstars a quieter one.
function AbilityBadges({ player }: { player: Player }) {
  const abilities = player.abilities ?? [];
  if (abilities.length === 0) return null;
  return (
    <>
      {abilities.map((id) => {
        const a = getAbility(id);
        if (!a) return null;
        const isX = a.tier === 'X_FACTOR';
        const tone = isX
          ? 'border-rose-500/60 bg-rose-500/15 text-rose-300'
          : 'border-sky-500/40 bg-sky-500/10 text-sky-300';
        const hint = describeAbilityHint(id);
        return (
          <span
            key={id}
            className={`ml-2 rounded border px-1 py-0.5 text-[9px] font-mono uppercase tracking-wider ${tone}`}
            title={`${isX ? 'X-FACTOR' : 'Superstar'} ability (hidden ground truth): ${a.label} — boosts ${a.facet}.\nScout/media read (knowledge-layer hint): "${hint ?? '—'}"`}
          >
            {isX ? '★ ' : ''}
            {a.label}
          </span>
        );
      })}
    </>
  );
}

// Combine measurements are reported to the nearest 1/8 inch. These format the
// raw (possibly float) inch values as eighths fractions — e.g. 77.625 → 6'5 5/8".
const EIGHTH_FRAC = ['', '1/8', '1/4', '3/8', '1/2', '5/8', '3/4', '7/8'] as const;

// Height in inches → feet'inches" to the nearest 1/8 (e.g. 77.6 → 6'5 5/8").
function formatHeight(inches: number): string {
  const totalEighths = Math.round(inches * 8);
  const ft = Math.floor(totalEighths / 96);
  const rem = totalEighths - ft * 96;
  const whole = Math.floor(rem / 8);
  const frac = EIGHTH_FRAC[rem % 8];
  return `${ft}'${whole}${frac ? ` ${frac}` : ''}"`;
}

// A plain inch measurement (arm, hand, vertical, broad) to the nearest 1/8
// (e.g. 34.13 → 34 1/8").
function formatInches(inches: number): string {
  const totalEighths = Math.round(inches * 8);
  const whole = Math.floor(totalEighths / 8);
  const frac = EIGHTH_FRAC[totalEighths % 8];
  return `${whole}${frac ? ` ${frac}` : ''}"`;
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
  const [expandedPlayerId, setExpandedPlayerId] = useState<PlayerId | null>(null);
  const colCount = seasonStats ? 15 : 14;
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
              <th className="px-2 py-1 font-medium" title="Hidden career shape + decline-rate multiplier (Living Careers). Shape bends the position aging curve: METEOR fades early/hard, EVERGREEN barely ages, 2ND_PEAK gets a resurgence window. ×mult scales decline speed (durability-nudged).">
                arc
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
              const isOpen = expandedPlayerId === p.id;
              return (
                <React.Fragment key={p.id}>
                <tr
                  className={`cursor-pointer border-t border-zinc-800/60 hover:bg-zinc-900/60 ${
                    isOpen ? 'bg-zinc-900/40' : ''
                  }`}
                  onClick={() => setExpandedPlayerId(isOpen ? null : p.id)}
                >
                  <td className="px-2 py-1 font-mono text-zinc-400">
                    <span className="mr-1 text-zinc-600">{isOpen ? '▼' : '▶'}</span>
                    {p.position}
                  </td>
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
                    <DraftPedigreeBadge player={p} />
                    <AbilityBadges player={p} />
                    <span className="ml-2 text-[10px] text-zinc-600" title="Height · weight · arm length (ground-truth size)">
                      {formatHeight(p.heightInches)} {p.weightLbs}lb
                    </span>
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
                  <td className="px-2 py-1 text-[10px]">
                    <CareerArcCell player={p} league={league} />
                  </td>
                  {seasonStats && (
                    <td className="px-2 py-1 text-zinc-300">
                      {formatKeyStat(p, seasonStats.get(p.id) ?? null)}
                    </td>
                  )}
                  <td className="px-2 py-1 text-zinc-400">
                    {formatCareerStat(p)}
                  </td>
                  <td className="px-2 py-1" onClick={(e) => e.stopPropagation()}>
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
                {isOpen && (
                  <tr className="border-t border-zinc-800/60 bg-zinc-950/60">
                    <td colSpan={colCount} className="px-3 py-3">
                      <PlayerDetail player={p} league={league} />
                    </td>
                  </tr>
                )}
                </React.Fragment>
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

const SHAPE_ABBREV: Record<CareerShape, { label: string; tone: string }> = {
  CLASSIC_ARC: { label: 'classic', tone: 'text-zinc-500' },
  METEOR: { label: 'meteor', tone: 'text-rose-400' },
  LATE_BLOOMER: { label: 'late', tone: 'text-sky-400' },
  SECOND_PEAK: { label: '2nd pk', tone: 'text-amber-400' },
  EVERGREEN: { label: 'evergrn', tone: 'text-emerald-400' },
  PHENOM_SUSTAINED: { label: 'phenom', tone: 'text-violet-400' },
};

/** Hidden career arc (Living Careers dev lens): shape + decline multiplier. */
function CareerArcCell({ player, league }: { player: Player; league: LeagueState }) {
  const shape = careerShapeFor(league, player);
  const mult = declineMultiplierFor(league, player);
  const curve = curveForPosition(player.position);
  const { label, tone } = SHAPE_ABBREV[shape];
  const multTone = mult >= 1.25 ? 'text-rose-400' : mult <= 0.75 ? 'text-emerald-400' : 'text-zinc-500';
  return (
    <span
      title={`Hidden career shape: ${shape} (bends the ${curve.bucket} aging curve — real peak ~${curve.realPeakAge}). Decline multiplier ×${mult.toFixed(2)} (seed-derived, durability-nudged; higher = ages faster).`}
    >
      <span className={tone}>{label}</span>{' '}
      <span className={`font-mono ${multTone}`}>×{mult.toFixed(2)}</span>
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

// ─── Lifecycle step-through panel (v0.59; v0.63.1 unified calendar) ──────
//
// Pays off the v0.54 + v0.56 + v0.57 substrate: a single date-ordered
// timeline of every lifecycle tick — NFL and college weeks interleaved
// by real calendar date, then the postseason rounds and offseason
// chain — with the current position highlighted, calendar labels +
// approximate dates, and step controls (one tick / one phase). The
// ribbon is built straight from the engine's `buildSeasonTimeline`, so
// what you step through matches what you see.

interface TickAnchor {
  transactionLogLen: number;
  mediaReportLen: number;
  phase: LifecyclePhase;
  currentWeek: number | null;
  collegeCurrentWeek: number | null;
  collegeGameStatsLen: number;
  seasonNumber: number;
}

/**
 * Snapshot of league state used as the "before this tick" anchor for the
 * event log. Lives at App level now (the Step Tick control moved to the
 * header so it's available on every tab); the lifecycle panel just reads
 * the current anchor.
 */
function snapshotAnchor(league: LeagueState): TickAnchor {
  return {
    transactionLogLen: league.transactionLog.length,
    mediaReportLen: league.mediaReports.length,
    phase: league.lifecyclePhase,
    currentWeek: league.currentWeek,
    collegeCurrentWeek: league.collegeCurrentWeek,
    collegeGameStatsLen: league.collegeGameStats.length,
    seasonNumber: league.seasonNumber,
  };
}

function LifecyclePanel({
  league,
  anchor,
  onStepFullYear,
}: {
  league: LeagueState;
  anchor: TickAnchor;
  onStepFullYear: () => void;
}) {
  const phase = league.lifecyclePhase;
  const currentWeek = league.currentWeek;
  const collegeCurrentWeek = league.collegeCurrentWeek;
  const label = phaseCalendarLabel(phase, currentWeek, collegeCurrentWeek);
  const date = phaseCalendarDate(phase, currentWeek, league.seasonNumber, collegeCurrentWeek);

  return (
    <section className="mt-6 rounded border border-zinc-800 bg-zinc-900/40 p-4">
      <h2 className="mb-3 text-lg font-semibold text-rose-200">Lifecycle</h2>

      <CurrentPhaseBadge
        phase={phase}
        currentWeek={currentWeek}
        collegeCurrentWeek={collegeCurrentWeek}
        label={label}
        date={date}
      />

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={onStepFullYear}
          className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1 text-sm text-zinc-300 hover:border-rose-500/40 hover:text-rose-200"
        >
          Step a full year
        </button>
      </div>

      <TickEventLog league={league} anchor={anchor} />

      <LifecycleTimeline
        phase={phase}
        currentWeek={currentWeek}
        collegeCurrentWeek={collegeCurrentWeek}
        seasonNumber={league.seasonNumber}
      />

      <CollegeSeasonSection league={league} />

      <p className="mt-3 text-xs text-zinc-500">
        Use <code className="text-zinc-300">Step Tick</code> in the header to
        advance one event at a time from any tab, or step a full year here.
        Bulk <code className="text-zinc-300">simulateSeason</code> +{' '}
        <code className="text-zinc-300">advanceSeason</code> (header) are just{' '}
        <code className="text-zinc-300">tickPhase</code> loops under the hood.
      </p>
    </section>
  );
}

// ─── Tick event log — beat-reporter view ────────────────────────────────
//
// Renders what happened during the most recent step (or steps, if the
// user clicked "Step to next phase" / "Step a full year"). Goal: read
// like a beat reporter's notes for the league week, not a transaction
// log dump. Names, positions, teams, dollar amounts, narrative tone.

function TickEventLog({
  league,
  anchor,
}: {
  league: LeagueState;
  anchor: TickAnchor;
}) {
  const events = useMemo(() => computeTickEvents(league, anchor), [league, anchor]);
  if (events.length === 0) {
    return (
      <div className="mt-4 rounded border border-zinc-800 bg-zinc-950/40 p-3 text-xs text-zinc-500">
        Click a step button to advance the league and see what happens.
      </div>
    );
  }
  const grouped = groupBy(events, (e) => e.section);
  return (
    <div className="mt-4 rounded border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-rose-300">
          Events this tick
        </h3>
        <span className="font-mono text-[10px] text-zinc-500">{events.length} items</span>
      </div>
      {grouped.map(([section, items]) => (
        <div key={section} className="mb-3 last:mb-0">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">
            {section}
          </div>
          <ul className="space-y-0.5">
            {items.slice(0, 30).map((ev, idx) => (
              <li key={`${section}-${idx}`} className="font-mono text-xs text-zinc-300">
                <span className="mr-2 text-zinc-600">{ev.icon}</span>
                {ev.text}
              </li>
            ))}
            {items.length > 30 && (
              <li className="font-mono text-xs text-zinc-500">
                ... + {items.length - 30} more
              </li>
            )}
          </ul>
        </div>
      ))}
    </div>
  );
}

interface TickEvent {
  section: string;
  icon: string;
  text: string;
}

function computeTickEvents(league: LeagueState, anchor: TickAnchor): TickEvent[] {
  const out: TickEvent[] = [];

  // ─ Phase-specific narrative ─────────────────────────────────────────
  const phase = league.lifecyclePhase;

  // v0.64 calendar beats — combine / pro days / top-30 visits / markers.
  if (phase === 'PRESEASON') {
    out.push({
      section: 'Preseason',
      icon: '🏈',
      text: 'Training camp wraps — 53-man rosters set. Regular season kicks off next.',
    });
  }
  if (phase === 'TRADE_DEADLINE') {
    out.push({
      section: 'Trade Deadline',
      icon: '⏰',
      text: 'The in-season trade deadline has passed — rosters are locked for contenders.',
    });
  }
  if (phase === 'COMBINE') {
    const n = Object.keys(league.combineResults).length;
    out.push({
      section: 'Scouting Combine',
      icon: '📋',
      text: `Combine measurables recorded for ${n} draft-eligible prospects.`,
    });
  }
  if (phase === 'PRO_DAYS') {
    const n = Object.keys(league.proDayAttendance).length;
    out.push({
      section: 'Pro Days',
      icon: '🏟️',
      text: `Pro-day workouts logged across ${n} prospects' campuses.`,
    });
  }
  if (phase === 'TOP_30_VISITS') {
    const n = league.coachVisitObservations.length;
    out.push({
      section: 'Top-30 Visits',
      icon: '🤝',
      text: `Pre-draft top-30 visits complete — ${n} coach/scout observations on file. Boards finalized for the draft.`,
    });
  }
  if (phase === 'SHRINE_BOWL' || phase === 'SENIOR_BOWL') {
    const name = phase === 'SHRINE_BOWL' ? 'Shrine Bowl' : 'Senior Bowl';
    const game = league.allStarGames.find((g) => g.name === name);
    if (game) {
      const n = game.squadA.length + game.squadB.length;
      out.push({
        section: name,
        icon: '⭐',
        text: `${name} — ${n} draft prospects showcased (${game.squadAName} vs ${game.squadBName}); every team's scouts got a sharpened look.`,
      });
    }
  }

  // Regular-season weeks: show games + injuries from this week.
  if (phase === 'REGULAR_SEASON_WEEK' && league.currentWeek !== null && league.schedule) {
    const week = league.schedule.regularSeason[league.currentWeek];
    if (week) {
      for (const game of week) {
        if (!game.result) continue;
        out.push(gameToEvent(game, league));
      }
    }
  }

  // College week (v0.63) — emit ALL college games played this tick.
  // The schedule has all weeks; we show only the one corresponding to
  // the just-played `collegeCurrentWeek`.
  if (
    phase === 'COLLEGE_WEEK' &&
    league.collegeCurrentWeek !== null &&
    league.collegeSchedule
  ) {
    const week = league.collegeSchedule.regularSeason[league.collegeCurrentWeek];
    if (week) {
      // For 50+ games per week, cap the visible set so the panel
      // doesn't overflow; emit a "+N more" line via the standard
      // grouped render.
      for (const game of week) {
        if (!game.result) continue;
        out.push(collegeGameToEvent(game));
      }
    }
  }

  // College postseason phases — emit games from the corresponding
  // section of the schedule.
  if (phase === 'COLLEGE_CONFERENCE_CHAMPIONSHIPS' && league.collegeSchedule) {
    for (const g of league.collegeSchedule.conferenceChampionships) {
      if (!g.result) continue;
      out.push(collegeGameToEvent(g));
    }
  }
  if (phase === 'HEISMAN_CEREMONY') {
    const heisman = league.heismanHistory[league.heismanHistory.length - 1];
    if (heisman && heisman.seasonNumber === league.seasonNumber) {
      const winnerName = collegeProspectName(league, heisman.winnerId);
      const school = getSchoolById(heisman.winnerSchoolId)?.name ?? heisman.winnerSchoolId;
      out.push({
        section: 'Heisman',
        icon: '🏆',
        text: `${winnerName} (${school}) wins the Heisman.`,
      });
      for (const f of heisman.finalists.slice(1, 4)) {
        out.push({
          section: 'Heisman finalists',
          icon: '🎓',
          text: `${collegeProspectName(league, f.playerId)} (${getSchoolById(f.schoolId)?.name ?? f.schoolId})`,
        });
      }
    } else {
      out.push({
        section: 'Heisman',
        icon: '🎓',
        text: 'Heisman ceremony — no qualifying production this season.',
      });
    }
  }
  if (phase === 'COLLEGE_BOWL_GAMES' && league.collegeSchedule) {
    for (const g of league.collegeSchedule.bowls) {
      if (!g.result) continue;
      out.push(collegeGameToEvent(g));
    }
  }
  if (
    (phase === 'CFP_FIRST_ROUND' ||
      phase === 'CFP_QUARTERFINALS' ||
      phase === 'CFP_SEMIFINALS' ||
      phase === 'CFP_FINAL') &&
    league.collegeSchedule?.cfp
  ) {
    const round =
      phase === 'CFP_FIRST_ROUND'
        ? league.collegeSchedule.cfp.firstRound
        : phase === 'CFP_QUARTERFINALS'
          ? league.collegeSchedule.cfp.quarterfinals
          : phase === 'CFP_SEMIFINALS'
            ? league.collegeSchedule.cfp.semifinals
            : league.collegeSchedule.cfp.final;
    for (const g of round) {
      if (!g.result) continue;
      out.push(collegeGameToEvent(g));
    }
    if (phase === 'CFP_FINAL' && league.collegeSchedule.cfp.championSchoolId) {
      const champ = getSchoolById(league.collegeSchedule.cfp.championSchoolId);
      if (champ) {
        out.push({
          section: 'CFP Champion',
          icon: '🏆',
          text: `${champ.name} are national champions of Season ${league.seasonNumber}.`,
        });
      }
    }
  }

  // Playoff rounds: show that round's games.
  if (
    (phase === 'WILD_CARD' ||
      phase === 'DIVISIONAL' ||
      phase === 'CONFERENCE' ||
      phase === 'SUPER_BOWL') &&
    league.schedule?.playoffs
  ) {
    const round = playoffRoundForPhase(phase, league.schedule.playoffs);
    for (const game of round) {
      if (!game.result) continue;
      out.push(gameToEvent(game, league));
    }
    if (phase === 'SUPER_BOWL' && league.schedule.playoffs.championId) {
      const champ = league.teams[league.schedule.playoffs.championId];
      if (champ) {
        out.push({
          section: 'Championship',
          icon: '🏆',
          text: `${champ.identity.fullName} are Super Bowl champions of Season ${league.seasonNumber}.`,
        });
      }
    }
  }

  // POST_SEASON_FINALIZE: awards announced this tick.
  if (phase === 'POST_SEASON_FINALIZE') {
    // seasonAwards reads the played schedule + season stats; since
    // POST_SEASON_FINALIZE leaves the schedule populated until
    // COLLEGE_CYCLE clears it, this still works mid-offseason.
    try {
      const awards = seasonAwards(league);
      for (const awd of awardsAsEvents(awards, league)) out.push(awd);
    } catch {
      // Defensive — if awards derivation fails for a partial state, skip.
    }
  }

  // DRAFT tick: this season's draft picks (top N for brevity).
  if (phase === 'DRAFT') {
    const picks = league.draftHistory.filter((p) => p.seasonNumber === league.seasonNumber);
    for (const pick of picks) {
      out.push(draftPickToEvent(pick, league));
    }
  }

  // READY_FOR_NEXT_SEASON: flavor line.
  if (phase === 'READY_FOR_NEXT_SEASON') {
    out.push({
      section: 'Offseason wraps',
      icon: '🏁',
      text: `League ready for kickoff of Season ${league.seasonNumber}. Step to begin Week 1.`,
    });
  }

  // ─ Generic transaction diff ─────────────────────────────────────────
  // Everything fired since the anchor, regardless of phase.
  const newTransactions = league.transactionLog.slice(anchor.transactionLogLen);
  for (const tx of newTransactions) {
    const ev = transactionToEvent(tx, league);
    if (ev) out.push(ev);
  }

  // ─ Media reports fired this tick (v0.62) ────────────────────────────
  const newMedia = league.mediaReports.slice(anchor.mediaReportLen);
  for (const report of newMedia) {
    const ev = mediaReportToEvent(report, league);
    if (ev) out.push(ev);
  }

  return out;
}

function mediaReportToEvent(report: MediaReport, league: LeagueState): TickEvent | null {
  const outlet = league.mediaOutlets[report.outletId];
  const outletName = outlet?.name ?? 'Unknown outlet';
  const toneTag = report.tone === 'POSITIVE' ? '' : report.tone === 'CRITICAL' ? ' [critical]' : report.tone === 'SPECULATIVE' ? ' [speculative]' : '';
  return {
    section: 'Media',
    icon: '📰',
    text: `${outletName}: ${report.headline}${toneTag}`,
  };
}

type ScheduledGameLike = NonNullable<LeagueState['schedule']>['regularSeason'][number][number];

function playoffRoundForPhase(
  phase: LifecyclePhase,
  playoffs: NonNullable<NonNullable<LeagueState['schedule']>['playoffs']>,
): readonly ScheduledGameLike[] {
  switch (phase) {
    case 'WILD_CARD':
      return playoffs.wildCard;
    case 'DIVISIONAL':
      return playoffs.divisional;
    case 'CONFERENCE':
      return playoffs.conference;
    case 'SUPER_BOWL':
      return playoffs.superBowl;
    default:
      return [];
  }
}

function gameToEvent(game: ScheduledGameLike, league: LeagueState): TickEvent {
  const result = game.result!;
  const home = league.teams[game.homeTeamId];
  const away = league.teams[game.awayTeamId];
  const homeAbbr = home?.identity.abbreviation ?? game.homeTeamId;
  const awayAbbr = away?.identity.abbreviation ?? game.awayTeamId;
  const homeWon = result.homeScore > result.awayScore;
  const winner = homeWon ? homeAbbr : awayAbbr;
  const loser = homeWon ? awayAbbr : homeAbbr;
  const winnerScore = homeWon ? result.homeScore : result.awayScore;
  const loserScore = homeWon ? result.awayScore : result.homeScore;
  const injuryNote =
    result.injuries.length > 0
      ? ` · ${result.injuries.length} inj${result.injuries.length === 1 ? '' : 's'}`
      : '';
  return {
    section: gameSectionLabel(game.kind),
    icon: '🏈',
    text: `${winner} ${winnerScore}, ${loser} ${loserScore}${injuryNote}`,
  };
}

function gameSectionLabel(kind: string): string {
  switch (kind) {
    case 'REGULAR':
      return 'Games';
    case 'WILD_CARD':
      return 'Wild Card';
    case 'DIVISIONAL':
      return 'Divisional';
    case 'CONFERENCE':
      return 'Conference Championships';
    case 'SUPER_BOWL':
      return 'Super Bowl';
    default:
      return 'Games';
  }
}

function collegeGameToEvent(game: CollegeGame): TickEvent {
  const result = game.result!;
  const home = getSchoolById(game.homeSchoolId);
  const away = getSchoolById(game.awaySchoolId);
  const homeName = home?.name ?? game.homeSchoolId;
  const awayName = away?.name ?? game.awaySchoolId;
  const homeWon = result.homeScore > result.awayScore;
  const winner = homeWon ? homeName : awayName;
  const loser = homeWon ? awayName : homeName;
  const winnerScore = homeWon ? result.homeScore : result.awayScore;
  const loserScore = homeWon ? result.awayScore : result.homeScore;
  const bowlNote = game.bowlName ? ` · ${game.bowlName}` : '';
  return {
    section: collegeGameSectionLabel(game.kind),
    icon: '🎓',
    text: `${winner} ${winnerScore}, ${loser} ${loserScore}${bowlNote}`,
  };
}

function collegeGameSectionLabel(kind: CollegeGameKind): string {
  switch (kind) {
    case 'REGULAR':
      return 'College Games';
    case 'CONFERENCE_CHAMPIONSHIP':
      return 'College Conference Championships';
    case 'BOWL':
      return 'Bowl Games';
    case 'CFP_FIRST_ROUND':
      return 'CFP First Round';
    case 'CFP_QUARTERFINAL':
      return 'CFP Quarterfinals';
    case 'CFP_SEMIFINAL':
      return 'CFP Semifinals';
    case 'CFP_FINAL':
      return 'CFP National Championship';
  }
}

/** Resolve a college prospect's display name from their id. */
function collegeProspectName(league: LeagueState, playerId: string): string {
  const prospect = league.collegePool.find((p) => p.id === playerId);
  return prospect ? `${prospect.firstName} ${prospect.lastName}` : playerId;
}

function awardsAsEvents(awards: SeasonAwards, league: LeagueState): TickEvent[] {
  const out: TickEvent[] = [];
  const playerAwards: ReadonlyArray<readonly [string, SeasonAwards['mvp']]> = [
    ['MVP', awards.mvp],
    ['Offensive POY', awards.opoy],
    ['Defensive POY', awards.dpoy],
    ['Offensive ROY', awards.oroy],
    ['Defensive ROY', awards.droy],
  ];
  for (const [name, award] of playerAwards) {
    if (!award) continue;
    const player = league.players[award.playerId];
    if (!player) continue;
    const team = player.teamId ? league.teams[player.teamId] : null;
    const teamLabel = team ? team.identity.abbreviation : '?';
    out.push({
      section: 'Season Awards',
      icon: '🏅',
      text: `${name}: ${player.firstName} ${player.lastName} (${teamLabel}, ${player.position})`,
    });
  }
  if (awards.coy) {
    const coach = league.coaches[awards.coy.coachId];
    const team = league.teams[awards.coy.teamId];
    if (coach && team) {
      out.push({
        section: 'Season Awards',
        icon: '🏅',
        text: `Coach of the Year: ${coach.name} (${team.identity.abbreviation})`,
      });
    }
  }
  return out;
}

function draftPickToEvent(pick: DraftPickRecord, league: LeagueState): TickEvent {
  const team = league.teams[pick.teamId];
  const teamAbbr = team?.identity.abbreviation ?? pick.teamId;
  const player = league.players[pick.promotedPlayerId];
  const pos = player?.position ?? '?';
  const name = player ? `${player.firstName} ${player.lastName}` : pick.promotedPlayerId;
  return {
    section: `Draft (Season ${pick.seasonNumber})`,
    icon: '📋',
    text: `R${pick.round} #${pick.overallPick} — ${teamAbbr} selects ${name} (${pos})`,
  };
}

function transactionToEvent(tx: Transaction, league: LeagueState): TickEvent | null {
  switch (tx.kind) {
    case 'trade': {
      const teamA = league.teams[tx.teamAId];
      const teamB = league.teams[tx.teamBId];
      const aAbbr = teamA?.identity.abbreviation ?? tx.teamAId;
      const bAbbr = teamB?.identity.abbreviation ?? tx.teamBId;
      const aToB = [...tx.playersAToB.map((id) => playerLabel(id, league)), ...formatPickList(tx.picksAToB, league)];
      const bToA = [...tx.playersBToA.map((id) => playerLabel(id, league)), ...formatPickList(tx.picksBToA, league)];
      const sourceLabel = tx.source ? ` [${tx.source}]` : '';
      return {
        section: 'Trades',
        icon: '🔄',
        text: `${aAbbr} ↔ ${bAbbr}: ${aAbbr} sends ${aToB.join(', ') || '(nothing)'} for ${bToA.join(', ') || '(nothing)'}${sourceLabel}`,
      };
    }
    case 'release': {
      const team = league.teams[tx.teamId];
      const dead = tx.deadMoney > 0 ? ` — dead $${formatMillions(tx.deadMoney)}M` : '';
      return {
        section: 'Releases',
        icon: '✂️',
        text: `${team?.identity.abbreviation ?? tx.teamId} releases ${playerLabel(tx.playerId, league)}${dead}`,
      };
    }
    case 'fa-sign': {
      const team = league.teams[tx.teamId];
      const market = tx.marketContract ? '' : ' (vet-min)';
      return {
        section: 'Free Agency',
        icon: '✍️',
        text: `${team?.identity.abbreviation ?? tx.teamId} signs ${playerLabel(tx.playerId, league)} — yr1 $${formatMillions(tx.yearOneCapHit)}M${market}`,
      };
    }
    case 'ir-move': {
      const team = league.teams[tx.teamId];
      return {
        section: 'Injuries',
        icon: '🏥',
        text: `${team?.identity.abbreviation ?? tx.teamId} places ${playerLabel(tx.playerId, league)} on IR — ${tx.weeksOut} wks (${tx.injurySeverity})`,
      };
    }
    case 'ps-promotion': {
      const signing = league.teams[tx.signingTeamId];
      const origin = league.teams[tx.originTeamId];
      const fromLabel = tx.ownPromotion ? 'from own PS' : `from ${origin?.identity.abbreviation ?? tx.originTeamId} PS`;
      return {
        section: 'Roster moves',
        icon: '⬆️',
        text: `${signing?.identity.abbreviation ?? tx.signingTeamId} promotes ${playerLabel(tx.playerId, league)} ${fromLabel}`,
      };
    }
    case 'cap-cut': {
      const team = league.teams[tx.teamId];
      return {
        section: 'Cap moves',
        icon: '💰',
        text: `${team?.identity.abbreviation ?? tx.teamId} cuts ${playerLabel(tx.playerId, league)} — cap saving $${formatMillions(tx.capSaving)}M`,
      };
    }
    case 'contract-expiration': {
      const team = league.teams[tx.teamId];
      return {
        section: 'Contract expirations',
        icon: '📄',
        text: `${team?.identity.abbreviation ?? tx.teamId}: ${playerLabel(tx.playerId, league)} hits FA`,
      };
    }
    case 'trade-request':
    case 'mood-shift':
      // These exist on the transaction union but are noisy for tick log.
      return null;
    default:
      return null;
  }
}

function playerLabel(playerId: PlayerId, league: LeagueState): string {
  const p = league.players[playerId];
  if (!p) return playerId;
  return `${p.firstName} ${p.lastName} (${p.position})`;
}

function formatPickList(
  picks: readonly string[] | undefined,
  league: LeagueState,
): string[] {
  if (!picks) return [];
  return picks.map((pickId) => {
    const pick = league.draftPicks.find((p) => p.id === pickId);
    if (!pick) return pickId;
    const yearLabel =
      pick.seasonNumber === league.seasonNumber
        ? `${pick.seasonNumber} R${pick.round}`
        : `${pick.seasonNumber} R${pick.round}`;
    return yearLabel;
  });
}

function formatMillions(cents: number): string {
  return (cents / 1_000_000).toFixed(1);
}

function groupBy<T, K extends string>(items: readonly T[], key: (t: T) => K): Array<[K, T[]]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    let bucket = map.get(k);
    if (!bucket) {
      bucket = [];
      map.set(k, bucket);
    }
    bucket.push(item);
  }
  return Array.from(map.entries());
}

function CurrentPhaseBadge({
  phase,
  currentWeek,
  collegeCurrentWeek,
  label,
  date,
}: {
  phase: LifecyclePhase;
  currentWeek: number | null;
  collegeCurrentWeek: number | null;
  label: string;
  date: CalendarDate | null;
}) {
  const isDeadlineWeek =
    phase === 'REGULAR_SEASON_WEEK' && currentWeek === TRADE_DEADLINE_WEEK_INDEX;
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded border border-rose-500/30 bg-rose-500/5 px-3 py-2">
      <div>
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">Phase</span>
        <span className="ml-2 font-mono text-sm text-rose-200">{phase}</span>
      </div>
      <div>
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">Label</span>
        <span className="ml-2 text-sm text-zinc-200">{label}</span>
      </div>
      {date && (
        <div>
          <span className="text-[10px] uppercase tracking-wide text-zinc-500">Date</span>
          <span className="ml-2 font-mono text-xs text-zinc-300">
            {formatCalendarDate(date)}
          </span>
        </div>
      )}
      {currentWeek !== null && (
        <div>
          <span className="text-[10px] uppercase tracking-wide text-zinc-500">NFL week</span>
          <span className="ml-2 font-mono text-xs text-zinc-300">{currentWeek}</span>
        </div>
      )}
      {collegeCurrentWeek !== null && (
        <div>
          <span className="text-[10px] uppercase tracking-wide text-zinc-500">🎓 college week</span>
          <span className="ml-2 font-mono text-xs text-emerald-300">{collegeCurrentWeek}</span>
        </div>
      )}
      {isDeadlineWeek && (
        <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-200">
          Trade deadline tick
        </span>
      )}
    </div>
  );
}

function LifecycleTimeline({
  phase,
  currentWeek,
  collegeCurrentWeek,
  seasonNumber,
}: {
  phase: LifecyclePhase;
  currentWeek: number | null;
  collegeCurrentWeek: number | null;
  seasonNumber: number;
}) {
  // One unified, date-ordered ribbon — the same `buildSeasonTimeline`
  // the engine dispatches off, so the visual order is exactly the tick
  // order. NFL (rose) and college (emerald) weeks interleave by date;
  // the offseason chain (zinc) trails the Super Bowl.
  const timeline = useMemo(() => buildSeasonTimeline(seasonNumber), [seasonNumber]);

  return (
    <TimelineGroup title="Season Calendar — every tick, in date order">
      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[9px] uppercase tracking-wide text-zinc-500">
        <LegendDot accent="rose" label="NFL" />
        <LegendDot accent="emerald" label="College" />
        <LegendDot accent="amber" label="Trade deadline" />
        <LegendDot accent="zinc" label="Offseason" />
      </div>
      <div className="flex flex-wrap gap-1">
        {timeline.map((step, i) => (
          <div key={i} className="w-[4.25rem]">
            <TimelineCell
              isCurrent={isStepCurrent(step, phase, currentWeek, collegeCurrentWeek)}
              label={timelineStepLabel(step)}
              sub={formatDateOrEmpty(step.date)}
              accent={timelineStepAccent(step)}
            />
          </div>
        ))}
      </div>
    </TimelineGroup>
  );
}

function LegendDot({
  accent,
  label,
}: {
  accent: 'rose' | 'emerald' | 'amber' | 'zinc';
  label: string;
}) {
  const dot =
    accent === 'rose'
      ? 'bg-rose-400'
      : accent === 'emerald'
        ? 'bg-emerald-400'
        : accent === 'amber'
          ? 'bg-amber-400'
          : 'bg-zinc-500';
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

function isStepCurrent(
  step: TimelineStep,
  phase: LifecyclePhase,
  currentWeek: number | null,
  collegeCurrentWeek: number | null,
): boolean {
  if (step.phase !== phase) return false;
  if (phase === 'REGULAR_SEASON_WEEK') return step.weekIndex === currentWeek;
  if (phase === 'COLLEGE_WEEK') return step.weekIndex === collegeCurrentWeek;
  return true;
}

function timelineStepLabel(step: TimelineStep): string {
  switch (step.phase) {
    case 'PRESEASON':
      return 'Preseason';
    case 'REGULAR_SEASON_WEEK':
      return `NFL W${(step.weekIndex ?? 0) + 1}`;
    case 'COLLEGE_WEEK':
      return `CFB W${(step.weekIndex ?? 0) + 1}`;
    case 'TRADE_DEADLINE':
      return 'Trade Deadline';
    case 'COMBINE':
      return 'Combine';
    case 'PRO_DAYS':
      return 'Pro Days';
    case 'TOP_30_VISITS':
      return 'Top-30 Visits';
    case 'DRAFT_DECLARATION':
      return 'Jr Declares';
    case 'SHRINE_BOWL':
      return 'Shrine Bowl';
    case 'SENIOR_BOWL':
      return 'Senior Bowl';
    case 'WILD_CARD':
      return 'Wild Card';
    case 'DIVISIONAL':
      return 'Divisional';
    case 'CONFERENCE':
      return 'NFL Conf';
    case 'SUPER_BOWL':
      return 'Super Bowl';
    case 'POST_SEASON_FINALIZE':
      return 'Season Wrap';
    case 'OFFSEASON_TRANSACTIONS':
      return 'Free Agency';
    case 'PRE_DRAFT':
      return 'Board Lock';
    case 'DRAFT':
      return 'NFL Draft';
    case 'POST_DRAFT_ROSTER':
      return 'UDFA · Cuts';
    case 'COLLEGE_CYCLE':
      return 'College Cycle';
    case 'READY_FOR_NEXT_SEASON':
      return 'Kickoff';
    default:
      // College postseason phases.
      return collegePostseasonShortLabel(step.phase);
  }
}

function timelineStepAccent(step: TimelineStep): 'rose' | 'amber' | 'emerald' | 'zinc' {
  switch (step.phase) {
    case 'PRESEASON':
      return 'rose';
    case 'TRADE_DEADLINE':
      return 'amber';
    case 'REGULAR_SEASON_WEEK':
      return step.weekIndex === TRADE_DEADLINE_WEEK_INDEX ? 'amber' : 'rose';
    case 'COLLEGE_WEEK':
    case 'COLLEGE_CONFERENCE_CHAMPIONSHIPS':
    case 'HEISMAN_CEREMONY':
    case 'COLLEGE_BOWL_GAMES':
    case 'CFP_FIRST_ROUND':
    case 'CFP_QUARTERFINALS':
    case 'CFP_SEMIFINALS':
    case 'CFP_FINAL':
    case 'DRAFT_DECLARATION':
    case 'SHRINE_BOWL':
    case 'SENIOR_BOWL':
      return 'emerald';
    case 'WILD_CARD':
    case 'DIVISIONAL':
    case 'CONFERENCE':
    case 'SUPER_BOWL':
      return 'rose';
    default:
      return 'zinc'; // offseason chain
  }
}

function collegePostseasonShortLabel(phase: LifecyclePhase): string {
  switch (phase) {
    case 'COLLEGE_CONFERENCE_CHAMPIONSHIPS':
      return 'Conf Champs';
    case 'HEISMAN_CEREMONY':
      return 'Heisman';
    case 'COLLEGE_BOWL_GAMES':
      return 'Bowls';
    case 'CFP_FIRST_ROUND':
      return 'CFP R1';
    case 'CFP_QUARTERFINALS':
      return 'CFP QF';
    case 'CFP_SEMIFINALS':
      return 'CFP SF';
    case 'CFP_FINAL':
      return 'CFP Final';
    default:
      return phase;
  }
}

/**
 * Live college-season snapshot — shows last completed week's
 * standings + a top-stats mini-board. Reads `league.collegeGameStats`
 * to compute season totals at-a-glance for the user.
 */
function CollegeSeasonSection({ league }: { league: LeagueState }) {
  const schedule = league.collegeSchedule;
  const collegeCurrentWeek = league.collegeCurrentWeek;
  const champ = schedule?.cfp?.championSchoolId
    ? getSchoolById(schedule.cfp.championSchoolId)
    : null;
  const heisman = league.heismanHistory[league.heismanHistory.length - 1] ?? null;

  // Engine aggregation over the per-game stream — the canonical source
  // now shared with the Heisman selector (no more ad-hoc UI summing).
  const seasonLines = useMemo(
    () => aggregateCollegeSeasonStats(league.collegeGameStats),
    [league.collegeGameStats],
  );
  const passingLeaders = useMemo(
    () => collegeLeaderItems(seasonLines, 'passingYards', league),
    [seasonLines, league],
  );
  const rushingLeaders = useMemo(
    () => collegeLeaderItems(seasonLines, 'rushingYards', league),
    [seasonLines, league],
  );
  const receivingLeaders = useMemo(
    () => collegeLeaderItems(seasonLines, 'receivingYards', league),
    [seasonLines, league],
  );

  if (!schedule || (collegeCurrentWeek === null && league.collegeGameStats.length === 0)) {
    return (
      <section className="mt-6 rounded border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-zinc-400">
        🎓 College season hasn't started yet — step into a `COLLEGE_WEEK` tick to begin.
      </section>
    );
  }

  return (
    <section className="mt-6 rounded border border-emerald-500/30 bg-emerald-500/5 p-3">
      <h3 className="mb-2 text-sm font-semibold text-emerald-200">
        🎓 College Football — Season {schedule.seasonNumber}
        {collegeCurrentWeek !== null && (
          <span className="ml-2 font-mono text-xs text-emerald-300">
            Week {collegeCurrentWeek + 1}
          </span>
        )}
        {champ && (
          <span className="ml-3 font-mono text-xs text-amber-200">
            🏆 Champion: {champ.name}
          </span>
        )}
      </h3>

      {heisman && (
        <div className="mb-2 font-mono text-xs text-amber-200">
          🏆 Heisman (S{heisman.seasonNumber}):{' '}
          {collegeProspectName(league, heisman.winnerId)} (
          {getSchoolById(heisman.winnerSchoolId)?.name ?? heisman.winnerSchoolId})
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <CollegeLeaderList title="Passing yards" items={passingLeaders} />
        <CollegeLeaderList title="Rushing yards" items={rushingLeaders} />
        <CollegeLeaderList title="Receiving yards" items={receivingLeaders} />
      </div>
    </section>
  );
}

function collegeLeaderItems(
  lines: readonly CollegeSeasonStatLine[],
  category: CollegeStatCategory,
  league: LeagueState,
): Array<{ name: string; school: string; value: number }> {
  return collegeStatLeaders(lines, category, 5).map((l) => ({
    name: collegeProspectName(league, l.playerId),
    school: getSchoolById(l.schoolId)?.name ?? l.schoolId,
    value: l[category],
  }));
}

function CollegeLeaderList({
  title,
  items,
}: {
  title: string;
  items: ReadonlyArray<{ name: string; school: string; value: number }>;
}) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">{title}</div>
      {items.length === 0 ? (
        <div className="font-mono text-xs text-zinc-600">No qualifying prospects yet.</div>
      ) : (
        <ol className="space-y-0.5">
          {items.map((it, i) => (
            <li key={i} className="flex items-baseline justify-between font-mono text-xs text-zinc-300">
              <span className="truncate">
                <span className="text-zinc-500">{i + 1}.</span> {it.name}{' '}
                <span className="text-zinc-500">({it.school})</span>
              </span>
              <span className="ml-2 tabular-nums text-emerald-300">{it.value}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function TimelineGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {title}
      </h3>
      {children}
    </div>
  );
}

const ACCENT_CLASSES: Record<
  'rose' | 'amber' | 'emerald' | 'zinc',
  string
> = {
  rose: 'border-rose-500/25 bg-rose-500/5 text-rose-300',
  amber: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  zinc: 'border-zinc-700 bg-zinc-900/40 text-zinc-400',
};

function TimelineCell({
  isCurrent,
  label,
  sub,
  accent,
  wide = false,
}: {
  isCurrent: boolean;
  label: string;
  sub?: string;
  accent: 'rose' | 'amber' | 'emerald' | 'zinc';
  wide?: boolean;
}) {
  const currentClasses = isCurrent
    ? 'border-rose-300 bg-rose-500/20 text-rose-50 ring-2 ring-rose-400/50'
    : ACCENT_CLASSES[accent];
  return (
    <div
      className={`flex flex-col items-center justify-center rounded border px-1.5 py-1 text-center transition-colors ${currentClasses} ${wide ? 'min-h-[3rem]' : 'min-h-[2.25rem]'}`}
    >
      <span
        className={`font-mono text-[10px] font-medium leading-tight ${wide ? 'text-[11px]' : ''}`}
      >
        {label}
      </span>
      {sub && (
        <span className="font-mono text-[9px] text-zinc-500 leading-none">
          {sub}
        </span>
      )}
    </div>
  );
}

function formatDateOrEmpty(date: CalendarDate | null): string {
  if (!date) return '';
  return `${date.month}/${date.day}`;
}

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
const BIG_BOARD_MAX_COLS = 22;
/** Max prospect rows shown (by most-recent grade). */
const BIG_BOARD_MAX_ROWS = 50;
/** Grade delta (points) that counts as a "big" move for the tint. */
const BIG_BOARD_BIG_MOVE = 5;

interface PerceivedColumn {
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
function mediaPerceivedScores(league: LeagueState): Map<string, number> {
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
// ─── College Game Results tab (v0.82) ──────────────────────────────────
//
// Collapsible weeks → collapsible games → team box score + per-prospect
// stat lines. Built as the calibration instrument for in-season media
// movement: each prospect line shows their REAL overall next to the box
// score, so a low-overall compiler putting up gaudy numbers (and the
// media's reaction to it) is visible at a glance. Opponent strength is
// shown because it's exactly what weights a prospect's weekly form.

interface GameSection {
  key: string;
  title: string;
  games: readonly CollegeGame[];
}

/** Compact box-score line for one prospect — only non-zero categories. */
function collegeStatLineText(s: CollegePlayerGameStats): string {
  const parts: string[] = [];
  if (s.passAttempts > 0) {
    let p = `${s.passCompletions}/${s.passAttempts}, ${s.passingYards} yd`;
    if (s.passingTds > 0) p += `, ${s.passingTds} TD`;
    if (s.interceptionsThrown > 0) p += `, ${s.interceptionsThrown} INT`;
    parts.push(p);
  }
  if (s.rushingAttempts > 0) {
    let p = `${s.rushingAttempts} car, ${s.rushingYards} yd`;
    if (s.rushingTds > 0) p += `, ${s.rushingTds} TD`;
    parts.push(p);
  }
  if (s.targets > 0 || s.receptions > 0) {
    let p = `${s.receptions}/${s.targets} rec, ${s.receivingYards} yd`;
    if (s.receivingTds > 0) p += `, ${s.receivingTds} TD`;
    parts.push(p);
  }
  const def: string[] = [];
  if (s.tackles > 0) def.push(`${s.tackles} tkl`);
  if (s.sacks > 0) def.push(`${s.sacks} sk`);
  if (s.interceptions > 0) def.push(`${s.interceptions} INT`);
  if (def.length > 0) parts.push(def.join(', '));
  return parts.join('  ·  ');
}

/** Rough single-game impact, to sort the standouts to the top of a game. */
function gameImpact(s: CollegePlayerGameStats): number {
  return (
    s.passingYards * 0.04 +
    s.passingTds * 4 +
    s.rushingYards * 0.1 +
    s.rushingTds * 6 +
    s.receivingYards * 0.1 +
    s.receivingTds * 6 +
    s.tackles +
    s.sacks * 6 +
    s.interceptions * 8
  );
}

function CollegeBoxStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-zinc-500">{label}</span>
      <span className="font-mono tabular-nums text-zinc-300">{value}</span>
    </div>
  );
}

function CollegeGameRow({
  game,
  stats,
  cpById,
  strengthOf,
  open,
  onToggle,
}: {
  game: CollegeGame;
  stats: readonly CollegePlayerGameStats[];
  cpById: ReadonlyMap<string, CollegePlayer>;
  strengthOf: (schoolId: string) => number;
  open: boolean;
  onToggle: () => void;
}) {
  const r = game.result;
  const homeName = getSchoolById(game.homeSchoolId)?.name ?? game.homeSchoolId;
  const awayName = getSchoolById(game.awaySchoolId)?.name ?? game.awaySchoolId;
  const homeStr = Math.round(strengthOf(game.homeSchoolId));
  const awayStr = Math.round(strengthOf(game.awaySchoolId));
  const homeWon = r ? r.homeScore >= r.awayScore : false;

  const sorted = [...stats].sort((a, b) => gameImpact(b) - gameImpact(a));
  const homeLines = sorted.filter((s) => s.schoolId === game.homeSchoolId);
  const awayLines = sorted.filter((s) => s.schoolId === game.awaySchoolId);

  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/40">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left hover:bg-zinc-900/40"
      >
        <span className="flex items-baseline gap-1.5 text-xs">
          <span className="text-zinc-500">{open ? '▾' : '▸'}</span>
          {game.kind === 'BOWL' && game.bowlName && (
            <span className="text-orange-300/80">{game.bowlName}:</span>
          )}
          <span className={homeWon ? 'text-zinc-500' : 'font-medium text-zinc-200'}>
            {awayName}
          </span>
          <span className="text-zinc-600">({awayStr})</span>
          <span className="text-zinc-600">@</span>
          <span className={homeWon ? 'font-medium text-zinc-200' : 'text-zinc-500'}>
            {homeName}
          </span>
          <span className="text-zinc-600">({homeStr})</span>
        </span>
        <span className="font-mono text-xs tabular-nums text-zinc-300">
          {r ? `${r.awayScore}–${r.homeScore}` : 'not played'}
        </span>
      </button>

      {open && r && (
        <div className="border-t border-zinc-800 px-2 py-2">
          <div className="mb-2 grid grid-cols-2 gap-3 text-[11px]">
            <div className="rounded border border-zinc-800 bg-zinc-900/30 p-1.5">
              <div className="mb-1 truncate font-medium text-zinc-300">{awayName}</div>
              <CollegeBoxStat label="Total yds" value={r.awayStats.totalYards} />
              <CollegeBoxStat label="Pass yds" value={r.awayStats.passingYards} />
              <CollegeBoxStat label="Rush yds" value={r.awayStats.rushingYards} />
              <CollegeBoxStat label="Turnovers" value={r.awayStats.turnovers} />
              <CollegeBoxStat label="Sacks" value={r.awayStats.sacks} />
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-900/30 p-1.5">
              <div className="mb-1 truncate font-medium text-zinc-300">{homeName}</div>
              <CollegeBoxStat label="Total yds" value={r.homeStats.totalYards} />
              <CollegeBoxStat label="Pass yds" value={r.homeStats.passingYards} />
              <CollegeBoxStat label="Rush yds" value={r.homeStats.rushingYards} />
              <CollegeBoxStat label="Turnovers" value={r.homeStats.turnovers} />
              <CollegeBoxStat label="Sacks" value={r.homeStats.sacks} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <CollegeGameProspects schoolName={awayName} lines={awayLines} cpById={cpById} />
            <CollegeGameProspects schoolName={homeName} lines={homeLines} cpById={cpById} />
          </div>
          {stats.length === 0 && (
            <div className="text-[11px] text-zinc-600">
              No pool prospects recorded production in this game.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CollegeGameProspects({
  schoolName,
  lines,
  cpById,
}: {
  schoolName: string;
  lines: readonly CollegePlayerGameStats[];
  cpById: ReadonlyMap<string, CollegePlayer>;
}) {
  if (lines.length === 0) return <div />;
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-zinc-600">{schoolName}</div>
      {lines.map((s) => {
        const cp = cpById.get(s.playerId);
        const name = cp ? `${cp.firstName} ${cp.lastName}` : s.playerId;
        const real = cp ? prospectRealGradeFromCp(cp) : null;
        return (
          <div key={s.playerId} className="text-[11px] leading-tight">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-zinc-300">
                {name}
                {cp && <span className="text-zinc-600"> · {cp.collegePosition}</span>}
              </span>
              {real !== null && (
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-zinc-500">
                  real {real}
                </span>
              )}
            </div>
            <div className="font-mono tabular-nums text-zinc-400">{collegeStatLineText(s)}</div>
          </div>
        );
      })}
    </div>
  );
}

function CollegeGamesPanel({ league }: { league: LeagueState }) {
  const schedule = league.collegeSchedule;

  const cpById = useMemo(
    () => new Map(league.collegePool.map((cp) => [cp.id as string, cp] as const)),
    [league.collegePool],
  );

  const statsByGame = useMemo(() => {
    const m = new Map<string, CollegePlayerGameStats[]>();
    for (const s of league.collegeGameStats) {
      const arr = m.get(s.gameId) ?? [];
      arr.push(s);
      m.set(s.gameId, arr);
    }
    return m;
  }, [league.collegeGameStats]);

  // Per-school strength — the same number that weights weekly form. Cached.
  const strengthOf = useMemo(() => {
    const bucketed = bucketProspectsBySchool(league.collegePool);
    const cache = new Map<string, number>();
    return (id: string): number => {
      let v = cache.get(id);
      if (v === undefined) {
        const tier = getSchoolById(id)?.tier ?? 'GROUP_OF_5';
        v = collegeTeamStrength(id, tier, bucketed);
        cache.set(id, v);
      }
      return v;
    };
  }, [league.collegePool]);

  const sections = useMemo<GameSection[]>(() => {
    if (!schedule) return [];
    const out: GameSection[] = [];
    schedule.regularSeason.forEach((games, i) => {
      if (games.length > 0) out.push({ key: `wk-${i}`, title: `Week ${i + 1}`, games });
    });
    if (schedule.conferenceChampionships.length > 0) {
      out.push({ key: 'conf', title: 'Conference Championships', games: schedule.conferenceChampionships });
    }
    if (schedule.bowls.length > 0) {
      out.push({ key: 'bowls', title: 'Bowl Games', games: schedule.bowls });
    }
    if (schedule.cfp) {
      const cfp = schedule.cfp;
      const rounds: GameSection[] = [
        { key: 'cfp-r1', title: 'CFP First Round', games: cfp.firstRound },
        { key: 'cfp-qf', title: 'CFP Quarterfinals', games: cfp.quarterfinals },
        { key: 'cfp-sf', title: 'CFP Semifinals', games: cfp.semifinals },
        { key: 'cfp-final', title: 'CFP National Championship', games: cfp.final },
      ];
      for (const r of rounds) if (r.games.length > 0) out.push(r);
    }
    return out;
  }, [schedule]);

  // Default-open the most recent section so stepping a week lands on it.
  const latestKey = sections.length > 0 ? sections[sections.length - 1]!.key : null;
  const [openWeeks, setOpenWeeks] = useState<Set<string>>(() => new Set());
  const [openGames, setOpenGames] = useState<Set<string>>(() => new Set());
  const lastLatchRef = useRef<string | null>(null);
  useEffect(() => {
    if (latestKey && lastLatchRef.current !== latestKey) {
      lastLatchRef.current = latestKey;
      setOpenWeeks((s) => new Set(s).add(latestKey));
    }
  }, [latestKey]);

  const toggleWeek = (k: string) =>
    setOpenWeeks((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const toggleGame = (k: string) =>
    setOpenGames((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  if (!schedule || sections.length === 0) {
    return (
      <section className="mb-8 rounded border border-orange-500/30 bg-orange-500/5 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-orange-300">
          College Game Results
        </h2>
        <p className="mt-2 text-xs text-zinc-500">
          No college games played yet this season. Step the lifecycle through the
          <span className="text-orange-300"> CFB Wk</span> ticks to populate the schedule.
        </p>
      </section>
    );
  }

  return (
    <section className="mb-8 rounded border border-orange-500/30 bg-orange-500/5 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-orange-300">
          College Game Results — Season {schedule.seasonNumber}
        </h2>
        <span className="text-xs text-zinc-500">
          Box scores + per-prospect lines · <span className="text-orange-400">(strength)</span> weights weekly form
        </span>
      </div>

      <div className="space-y-2">
        {sections.map((section) => {
          const open = openWeeks.has(section.key);
          const played = section.games.filter((g) => g.result).length;
          return (
            <div key={section.key} className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
              <button
                onClick={() => toggleWeek(section.key)}
                className="flex w-full items-center justify-between gap-2 text-left"
              >
                <span className="flex items-baseline gap-2 text-sm font-medium text-zinc-200">
                  <span className="text-zinc-500">{open ? '▾' : '▸'}</span>
                  {section.title}
                </span>
                <span className="text-[11px] text-zinc-500">
                  {played}/{section.games.length} played
                </span>
              </button>
              {open && (
                <div className="mt-2 space-y-1">
                  {section.games.map((game) => {
                    const gkey = `${section.key}:${game.id}`;
                    return (
                      <CollegeGameRow
                        key={gkey}
                        game={game}
                        stats={statsByGame.get(game.id) ?? []}
                        cpById={cpById}
                        strengthOf={strengthOf}
                        open={openGames.has(gkey)}
                        onToggle={() => toggleGame(gkey)}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function bigBoardColumnLabel(phase: LifecyclePhase, collegeWeek?: number | null): string {
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

// ─── Prospect grades: perceived vs real (v0.75) ─────────────────────────
//
// Every board shows a 0-100 PERCEIVED grade (what the scouts/media
// believe — observed) next to the REAL grade (ground truth: the mean of
// the prospect's true current skills). The gap is the whole story —
// amber = inflated (hype), cyan = slept on, green = the read is honest.

/** Real overall (0-100): mean of a prospect's true current skills. */
function prospectRealGradeFromCp(cp: CollegePlayer): number | null {
  const vals = Object.values(cp.current) as number[];
  if (vals.length === 0) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

/** Real overall by id. null if the prospect isn't in the pool anymore
 * (e.g. already drafted). */
function prospectRealGrade(league: LeagueState, prospectId: string): number | null {
  const cp = league.collegePool.find((p) => p.id === prospectId);
  return cp ? prospectRealGradeFromCp(cp) : null;
}

/** League's perceived grade per prospect — mean of teams' observed-skill
 * scores across the 32 boards (the consensus big-board belief). */
function consensusPerceivedGrades(league: LeagueState): Map<string, number> {
  const agg = new Map<string, { s: number; n: number }>();
  for (const board of Object.values(league.draftBoards)) {
    for (const e of board) {
      const cur = agg.get(e.collegePlayerId) ?? { s: 0, n: 0 };
      cur.s += e.observedSkillScore;
      cur.n += 1;
      agg.set(e.collegePlayerId, cur);
    }
  }
  const m = new Map<string, number>();
  for (const [id, { s, n }] of agg) m.set(id, Math.round(s / n));
  return m;
}

function GradeCell({
  perceived,
  real,
}: {
  perceived: number | null;
  real: number | null;
}) {
  let cls = 'text-zinc-300';
  if (perceived !== null && real !== null) {
    const d = perceived - real;
    cls = d > 5 ? 'text-amber-300' : d < -5 ? 'text-cyan-300' : 'text-emerald-300';
  }
  return (
    <span className="font-mono tabular-nums" title="perceived / real">
      <span className={cls}>{perceived ?? '—'}</span>
      <span className="text-zinc-600">/{real ?? '—'}</span>
    </span>
  );
}

// ─── Draft grade: NFL.com 8-point scale (2026-06-03) ────────────────────────
//
// The plain-English scouting grade every prospect carries, shown as
// PERCEIVED / REAL — the board's belief next to ground truth (per the
// inspector "perceived always shows real" convention). Inputs are PROJECTED
// overalls (0-100): perceived = consensus observed-skill score, real = the
// prospect's true projected overall. Amber = the board over-grades (hype),
// cyan = slept on, emerald = honest read. "—" perceived = not yet scouted.
function DraftGradeCell({
  perceivedOverall,
  realOverall,
}: {
  /** Board's perceived projected overall (mean observed-skill), or null if unscouted. */
  perceivedOverall: number | null;
  /** Ground-truth projected overall. */
  realOverall: number | null;
}) {
  const perceived = draftGradeFromOverall(perceivedOverall);
  const real = draftGradeFromOverall(realOverall);
  let cls = 'text-zinc-300';
  if (perceived !== null && real !== null) {
    const d = perceived - real;
    cls = d > 0.15 ? 'text-amber-300' : d < -0.15 ? 'text-cyan-300' : 'text-emerald-300';
  }
  const title =
    `Draft grade (perceived / real)\n` +
    `perceived: ${formatDraftGrade(perceived)} — ${draftGradeLabel(perceived)}\n` +
    `real: ${formatDraftGrade(real)} — ${draftGradeLabel(real)}`;
  return (
    <span className="font-mono tabular-nums" title={title}>
      <span className={cls}>{formatDraftGrade(perceived)}</span>
      <span className="text-zinc-600">/{formatDraftGrade(real)}</span>
    </span>
  );
}

// ─── Media Mock Boards (v0.72) ──────────────────────────────────────────
//
// The media-consensus mock board next to each outlet's own — so you can
// see where the hot-take blog reaches and the sharp insider stays
// grounded (divergence vs consensus is color-coded).

function MediaMockBoardsPanel({ league }: { league: LeagueState }) {
  const DEPTH = 40;
  // League (team) consensus rank per prospect — shown next to the MEDIA
  // consensus so the gap between what the media says and what the 32 team
  // boards say is legible (the realism check Daniel reads).
  const teamConsensusRank = useMemo(
    () => consensusRankIndex(computeConsensusBoard(league.draftBoards)),
    [league.draftBoards],
  );
  const collegeOutlets = useMemo(
    () =>
      Object.values(league.mediaOutlets)
        .filter((o) => o.focus === 'COLLEGE')
        .sort((a, b) => b.accuracySpectrum - a.accuracySpectrum),
    [league.mediaOutlets],
  );

  // Weight the consensus by outlet accuracy — sharper desks count more.
  const outletWeights = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of collegeOutlets) m.set(o.id, o.accuracySpectrum / 10);
    return m;
  }, [collegeOutlets]);

  const consensus = useMemo(
    () => computeMediaConsensusBoard(league.mediaCollegeObservations, DEPTH, outletWeights),
    [league.mediaCollegeObservations, outletWeights],
  );

  // Resolve prospect names — including prospects already drafted out of
  // the pool (via draft history → promoted NFL player).
  const nameById = useMemo(() => {
    const m = new Map<string, { name: string; school: string; pos: string }>();
    for (const cp of league.collegePool) {
      m.set(cp.id, {
        name: `${cp.firstName} ${cp.lastName}`,
        school: getSchoolById(cp.schoolId)?.name ?? cp.schoolId,
        pos: cp.nflProjectedPosition,
      });
    }
    for (const pick of league.draftHistory) {
      if (m.has(pick.collegePlayerId)) continue;
      const p = league.players[pick.promotedPlayerId];
      if (p) m.set(pick.collegePlayerId, { name: `${p.firstName} ${p.lastName}`, school: 'drafted', pos: p.position });
    }
    return m;
  }, [league.collegePool, league.draftHistory, league.players]);

  const outletPicks = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const o of collegeOutlets) {
      const board = computeOutletMockBoard(league.mediaCollegeObservations, o.id, 60);
      const byProspect = new Map<string, number>();
      for (const e of board) byProspect.set(e.prospectId, e.projectedOverallPick);
      map.set(o.id, byProspect);
    }
    return map;
  }, [league.mediaCollegeObservations, collegeOutlets]);

  if (consensus.length === 0) {
    return (
      <section className="mt-6 rounded border border-fuchsia-500/20 bg-fuchsia-500/[0.03] p-3 text-xs text-zinc-500">
        🎙️ Media mock boards — empty until the pre-draft media cycle runs
        (step through Top-30 Visits, or simulate + advance a season).
      </section>
    );
  }

  return (
    <section className="mt-6 rounded border border-fuchsia-500/25 bg-fuchsia-500/[0.04] p-4">
      <h2 className="mb-1 text-lg font-semibold text-fuchsia-200">Media Mock Boards</h2>
      <p className="mb-3 text-xs text-zinc-500">
        <span className="text-fuchsia-300">Media #</span> = media consensus rank;{' '}
        <span className="text-zinc-300">Team #</span> = the 32 team boards' consensus
        rank (green = media has him ≥12 spots EARLIER than the teams, red = later —
        i.e. media buzz vs the war-room read). Then each outlet's own mock (cols
        sorted by accuracy, sharpest first): green = the outlet likes him well
        ahead of media consensus, red = well behind.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="text-left text-zinc-500">
              <th className="px-2 py-1 font-medium" title="Media consensus rank (this board)">Media #</th>
              <th className="px-2 py-1 font-medium" title="Team consensus rank (aggregate of the 32 draft boards) — compare to Media #">Team #</th>
              <th className="px-2 py-1 font-medium">Prospect</th>
              <th className="px-2 py-1 font-medium">Pos</th>
              <th className="px-2 py-1 font-medium" title="perceived / real">Grade</th>
              {collegeOutlets.map((o) => (
                <th key={o.id} className="px-2 py-1 text-center font-medium" title={o.name}>
                  {abbreviateOutlet(o.name)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {consensus.map((entry) => {
              const info = nameById.get(entry.prospectId);
              const name = info?.name ?? entry.prospectId;
              const school = info?.school ?? '';
              const teamRank = teamConsensusRank.get(entry.prospectId) ?? null;
              // Media vs team-consensus gap: positive = media has him EARLIER
              // (higher) than the teams do → media buzz outrunning the board.
              const teamGap = teamRank !== null ? teamRank - entry.projectedOverallPick : null;
              return (
                <tr key={entry.prospectId} className="border-t border-zinc-800/60">
                  <td className="px-2 py-1 font-mono tabular-nums text-fuchsia-300">
                    {entry.projectedOverallPick}
                  </td>
                  <td
                    className={`px-2 py-1 font-mono tabular-nums ${
                      teamGap === null ? 'text-zinc-700'
                        : teamGap >= 12 ? 'text-emerald-400'
                          : teamGap <= -12 ? 'text-rose-400' : 'text-zinc-400'
                    }`}
                    title={teamGap === null ? 'Not on the team consensus board' : `media ${teamGap >= 0 ? '+' : ''}${teamGap} vs team consensus`}
                  >
                    {teamRank ?? '—'}
                  </td>
                  <td className="px-2 py-1">
                    <span className="text-zinc-200">{name}</span>{' '}
                    <span className="text-zinc-600">({school})</span>
                  </td>
                  <td className="px-2 py-1 font-mono text-zinc-400">{info?.pos ?? '—'}</td>
                  <td className="px-2 py-1">
                    <GradeCell
                      perceived={Math.round(entry.grade)}
                      real={prospectRealGrade(league, entry.prospectId)}
                    />
                  </td>
                  {collegeOutlets.map((o) => {
                    const pick = outletPicks.get(o.id)?.get(entry.prospectId);
                    return (
                      <td
                        key={o.id}
                        className={`px-2 py-1 text-center font-mono tabular-nums ${mockCellClass(
                          pick,
                          entry.projectedOverallPick,
                        )}`}
                      >
                        {pick ?? '—'}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function abbreviateOutlet(name: string): string {
  // Short column header — first word + any capitals, capped.
  const compact = name.replace(/[^A-Za-z0-9 ]/g, '');
  if (compact.length <= 10) return compact;
  return compact
    .split(' ')
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 5);
}

function mockCellClass(pick: number | undefined, consensusPick: number): string {
  if (pick === undefined) return 'text-zinc-700';
  const delta = consensusPick - pick; // > 0 = outlet has him earlier (likes more)
  if (delta >= 8) return 'text-emerald-400';
  if (delta >= 3) return 'text-emerald-300/70';
  if (delta <= -8) return 'text-rose-400';
  if (delta <= -3) return 'text-rose-300/70';
  return 'text-zinc-400';
}

// ─── Draft Audit (v0.90) ────────────────────────────────────────────────
//
// The calibration lens: every draft-eligible prospect, with the REAL grade
// next to what the TEAMS believe (consensus of the 32 boards, or one team)
// and what the MEDIA believes (consensus of the outlet stream). Sort by the
// gap to find who's over-/under-rated, and read the summary to answer the
// core question: are the teams accurately grading? is the media? (Dev lens —
// the game UI never reads ground truth.)

interface PerceivedRead {
  grade: number;
  obs: number;
}

/** Media's confidence-weighted perceived grade per prospect (full coverage,
 * not depth-capped) + how many outlet reads back it. */
function mediaPerceivedGrades(league: LeagueState): Map<string, PerceivedRead> {
  const agg = new Map<string, { wsum: number; csum: number; n: number }>();
  for (const o of league.mediaCollegeObservations) {
    const sv = Object.values(o.skills).filter((v): v is number => typeof v === 'number');
    const cv = Object.values(o.confidence).filter((v): v is number => typeof v === 'number');
    if (sv.length === 0 || cv.length === 0) continue;
    const overall = sv.reduce((a, b) => a + b, 0) / sv.length;
    const conf = cv.reduce((a, b) => a + b, 0) / cv.length;
    if (conf <= 0) continue;
    const cur = agg.get(o.collegePlayerId) ?? { wsum: 0, csum: 0, n: 0 };
    cur.wsum += overall * conf;
    cur.csum += conf;
    cur.n += 1;
    agg.set(o.collegePlayerId, cur);
  }
  const m = new Map<string, PerceivedRead>();
  for (const [id, { wsum, csum, n }] of agg) {
    if (csum > 0) m.set(id, { grade: Math.round(wsum / csum), obs: n });
  }
  return m;
}

/** Team perceived grade per prospect: either one team's board, or the
 * consensus (mean observedSkillScore across the 32 boards). */
function teamPerceivedGrades(
  league: LeagueState,
  teamId: TeamId | 'CONSENSUS',
): Map<string, PerceivedRead> {
  const m = new Map<string, PerceivedRead>();
  if (teamId !== 'CONSENSUS') {
    const board = league.draftBoards[teamId] ?? [];
    for (const e of board) {
      m.set(e.collegePlayerId, { grade: Math.round(e.observedSkillScore), obs: e.observationCount });
    }
    return m;
  }
  const agg = new Map<string, { s: number; n: number; obs: number }>();
  for (const board of Object.values(league.draftBoards)) {
    for (const e of board) {
      const cur = agg.get(e.collegePlayerId) ?? { s: 0, n: 0, obs: 0 };
      cur.s += e.observedSkillScore;
      cur.n += 1;
      cur.obs += e.observationCount;
      agg.set(e.collegePlayerId, cur);
    }
  }
  for (const [id, { s, n, obs }] of agg) m.set(id, { grade: Math.round(s / n), obs });
  return m;
}

/** Pearson correlation over paired samples; null if <3 points or no variance. */
function pearsonCorr(pairs: ReadonlyArray<readonly [number, number]>): number | null {
  const n = pairs.length;
  if (n < 3) return null;
  let mx = 0;
  let my = 0;
  for (const [x, y] of pairs) {
    mx += x;
    my += y;
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of pairs) {
    const dx = x - mx;
    const dy = y - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

interface AuditRow {
  cp: CollegePlayer;
  group: PositionGroup;
  real: number;
  team: PerceivedRead | null;
  media: PerceivedRead | null;
  teamDelta: number | null;
  mediaDelta: number | null;
}

type AuditSortKey = 'real' | 'team' | 'media' | 'teamDelta' | 'mediaDelta' | 'name';

function evaluatorSummary(rows: AuditRow[], which: 'team' | 'media') {
  const pairs: Array<[number, number]> = [];
  let absSum = 0;
  let biasSum = 0;
  let n = 0;
  for (const r of rows) {
    const read = which === 'team' ? r.team : r.media;
    if (!read) continue;
    pairs.push([read.grade, r.real]);
    absSum += Math.abs(read.grade - r.real);
    biasSum += read.grade - r.real;
    n += 1;
  }
  return {
    n,
    meanAbs: n ? absSum / n : null,
    bias: n ? biasSum / n : null,
    corr: pearsonCorr(pairs),
  };
}

function deltaClass(delta: number | null): string {
  if (delta === null) return 'text-zinc-700';
  if (delta >= 8) return 'text-amber-400';
  if (delta >= 4) return 'text-amber-300/70';
  if (delta <= -8) return 'text-cyan-400';
  if (delta <= -4) return 'text-cyan-300/70';
  return 'text-emerald-300/80';
}

function fmtSigned(v: number | null, digits = 0): string {
  if (v === null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}`;
}

function DraftAuditPanel({ league }: { league: LeagueState }) {
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState<PositionGroup | 'ALL'>('ALL');
  const [teamSel, setTeamSel] = useState<TeamId | 'CONSENSUS'>('CONSENSUS');
  const [sortKey, setSortKey] = useState<AuditSortKey>('real');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const teamPerceived = useMemo(() => teamPerceivedGrades(league, teamSel), [league, teamSel]);
  const mediaPerceived = useMemo(() => mediaPerceivedGrades(league), [league]);

  const rows = useMemo<AuditRow[]>(() => {
    const out: AuditRow[] = [];
    for (const cp of league.collegePool) {
      if (!cp.isDraftEligible) continue;
      const real = prospectRealGradeFromCp(cp);
      if (real === null) continue;
      const team = teamPerceived.get(cp.id) ?? null;
      const media = mediaPerceived.get(cp.id) ?? null;
      out.push({
        cp,
        group: positionGroupFor(cp.nflProjectedPosition),
        real,
        team,
        media,
        teamDelta: team ? team.grade - real : null,
        mediaDelta: media ? media.grade - real : null,
      });
    }
    return out;
  }, [league.collegePool, teamPerceived, mediaPerceived]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (groupFilter !== 'ALL' && r.group !== groupFilter) return false;
      if (!q) return true;
      const name = `${r.cp.firstName} ${r.cp.lastName}`.toLowerCase();
      const school = (getSchoolById(r.cp.schoolId)?.name ?? '').toLowerCase();
      return name.includes(q) || school.includes(q);
    });
  }, [rows, search, groupFilter]);

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const val = (r: AuditRow): number | string => {
      switch (sortKey) {
        case 'real':
          return r.real;
        case 'team':
          return r.team?.grade ?? -Infinity;
        case 'media':
          return r.media?.grade ?? -Infinity;
        case 'teamDelta':
          return r.teamDelta ?? -Infinity;
        case 'mediaDelta':
          return r.mediaDelta ?? -Infinity;
        case 'name':
          return `${r.cp.lastName} ${r.cp.firstName}`.toLowerCase();
      }
    };
    return [...filtered].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * dir;
      return ((av as number) - (bv as number)) * dir;
    });
  }, [filtered, sortKey, sortDir]);

  const teamStats = useMemo(() => evaluatorSummary(filtered, 'team'), [filtered]);
  const mediaStats = useMemo(() => evaluatorSummary(filtered, 'media'), [filtered]);

  const toggleSort = (key: AuditSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };

  const teamLabel = teamSel === 'CONSENSUS' ? 'Team (consensus)' : 'Team';
  const sortArrow = (key: AuditSortKey) => (sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');
  const teams = useMemo(
    () =>
      Object.values(league.teams).sort((a, b) =>
        a.identity.location.localeCompare(b.identity.location),
      ),
    [league.teams],
  );

  return (
    <section className="mb-8 rounded border border-teal-500/30 bg-teal-500/[0.04] p-4">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-teal-300">
          Draft Audit — who's grading prospects right?
        </h2>
        <span className="text-xs text-zinc-500">
          {rows.length} draft-eligible · showing {sorted.length}
        </span>
      </div>
      <p className="mb-3 text-xs text-zinc-500">
        Real grade vs what the teams believe vs what the media believes. Δ is
        perceived − real: <span className="text-amber-300">amber = over-rated</span>,{' '}
        <span className="text-cyan-300">cyan = under-rated</span>,{' '}
        <span className="text-emerald-300">green = close</span>. Sort by a Δ column to find the
        biggest misses. A <span className="font-mono">—</span> means that evaluator never graded
        him: the media covers the draftable pool (~top {200}), the teams everyone their
        scouts have laid eyes on — a deep small-schooler nobody scouted is a real blind spot,
        not a bug. (Dev lens — never the game UI.)
      </p>

      {/* Who's more accurate — the headline answer. */}
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {(
          [
            ['Teams', teamStats, 'text-violet-300'],
            ['Media', mediaStats, 'text-fuchsia-300'],
          ] as const
        ).map(([label, s, cls]) => (
          <div key={label} className="rounded border border-zinc-800 bg-zinc-950/40 p-2 text-xs">
            <span className={`font-semibold ${cls}`}>{label}</span>
            <span className="text-zinc-500"> over {s.n} graded · </span>
            <span className="text-zinc-300">
              mean |Δ| {s.meanAbs === null ? '—' : s.meanAbs.toFixed(1)}
            </span>
            <span className="text-zinc-500"> · bias {fmtSigned(s.bias, 1)} · </span>
            <span className="text-zinc-300">
              corr {s.corr === null ? '—' : s.corr.toFixed(2)}
            </span>
          </div>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name / school…"
          className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-200 placeholder:text-zinc-600"
        />
        <select
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value as PositionGroup | 'ALL')}
          className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-200"
        >
          <option value="ALL">All groups</option>
          {POSITION_GROUPS_ORDERED.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <select
          value={teamSel}
          onChange={(e) => setTeamSel(e.target.value as TeamId | 'CONSENSUS')}
          className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-200"
        >
          <option value="CONSENSUS">Team consensus (32 boards)</option>
          {teams.map((t) => (
            <option key={t.identity.id} value={t.identity.id}>
              {t.identity.location} {t.identity.nickname}
            </option>
          ))}
        </select>
      </div>

      <div className="max-h-[36rem] overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-zinc-950">
            <tr className="text-left text-zinc-500">
              <SortableTh label={`Prospect${sortArrow('name')}`} onClick={() => toggleSort('name')} />
              <th className="px-2 py-1 font-medium">Pos</th>
              <SortableTh label={`Real${sortArrow('real')}`} onClick={() => toggleSort('real')} center />
              <SortableTh
                label={`${teamLabel}${sortArrow('team')}`}
                onClick={() => toggleSort('team')}
                center
              />
              <SortableTh
                label={`Δteam${sortArrow('teamDelta')}`}
                onClick={() => toggleSort('teamDelta')}
                center
              />
              <SortableTh label={`Media${sortArrow('media')}`} onClick={() => toggleSort('media')} center />
              <SortableTh
                label={`Δmedia${sortArrow('mediaDelta')}`}
                onClick={() => toggleSort('mediaDelta')}
                center
              />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const school = getSchoolById(r.cp.schoolId)?.name ?? r.cp.schoolId;
              return (
                <tr key={r.cp.id} className="border-t border-zinc-800/60">
                  <td className="px-2 py-1">
                    <span className="text-zinc-200">
                      {r.cp.firstName} {r.cp.lastName}
                    </span>{' '}
                    <span className="text-zinc-600">({school})</span>
                  </td>
                  <td className="px-2 py-1 text-zinc-400">
                    {r.cp.nflProjectedPosition}
                    <span className="text-zinc-600"> · {r.group}</span>
                  </td>
                  <td className="px-2 py-1 text-center font-mono tabular-nums text-zinc-200">
                    {r.real}
                  </td>
                  <td
                    className="px-2 py-1 text-center font-mono tabular-nums text-zinc-300"
                    title={r.team ? `${r.team.obs} obs` : 'no team reads'}
                  >
                    {r.team?.grade ?? '—'}
                  </td>
                  <td className={`px-2 py-1 text-center font-mono tabular-nums ${deltaClass(r.teamDelta)}`}>
                    {fmtSigned(r.teamDelta)}
                  </td>
                  <td
                    className="px-2 py-1 text-center font-mono tabular-nums text-zinc-300"
                    title={r.media ? `${r.media.obs} outlet reads` : 'no media reads'}
                  >
                    {r.media?.grade ?? '—'}
                  </td>
                  <td className={`px-2 py-1 text-center font-mono tabular-nums ${deltaClass(r.mediaDelta)}`}>
                    {fmtSigned(r.mediaDelta)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SortableTh({
  label,
  onClick,
  center,
}: {
  label: string;
  onClick: () => void;
  center?: boolean;
}) {
  return (
    <th
      onClick={onClick}
      className={`cursor-pointer select-none px-2 py-1 font-medium hover:text-zinc-200 ${
        center ? 'text-center' : 'text-left'
      }`}
    >
      {label}
    </th>
  );
}

// ─── Media Reliability by Position Group (v0.89) ────────────────────────
//
// The heart of the media's purpose: WHICH outlet to trust, WHERE, and WHY.
// Each outlet carries hidden per-group accuracy + hype; this panel measures
// the RESULT — how well each outlet's read orders prospects vs the real
// board (rank correlation), per position group, and how it tilts them
// (bias). Green = trustworthy ordering here; red = noise/hype here. The
// hidden per-group knobs are shown in the cell tooltip for tuning (dev
// inspector only — never the game UI).

function correlationCellClass(corr: number | null): string {
  if (corr === null) return 'text-zinc-700';
  if (corr >= 0.6) return 'text-emerald-400';
  if (corr >= 0.3) return 'text-emerald-300/70';
  if (corr >= 0.0) return 'text-amber-300/80';
  return 'text-rose-400';
}

// ─── GM Media Trust (perceived vs real) ─────────────────────────────────
// "Perceived always shows real" (CLAUDE.md inspector convention). Each GM
// carries its own belief about how reliable each outlet is per position
// group (`perceivedOutletReliability`); the draft board blends a media read
// by THIS belief, not by the outlet's true accuracy. This panel shows the
// gap so Daniel can judge whether the miscalibration feels right: sharp
// evaluators land near truth, buzz-chasers over-rate loud outlets and chase
// the wrong voice. Dev-only — the game UI never shows these numbers.

/** Colour a perceived value by how far (and which way) it is off the truth. */
function gmTrustCellClass(perceived: number, real: number): string {
  const gap = perceived - real;
  if (Math.abs(gap) <= 1) return 'text-emerald-400'; // calibrated
  if (gap > 2.5) return 'text-rose-500'; // badly over-trusts a weaker outlet
  if (gap > 1) return 'text-rose-300/80'; // over-trusts
  if (gap < -2.5) return 'text-sky-500'; // badly sleeps on a sharp outlet
  return 'text-sky-300/70'; // under-trusts
}

function GmMediaTrustPanel({ league }: { league: LeagueState }) {
  const teams = useMemo(
    () =>
      Object.values(league.teams).sort((a, b) =>
        a.identity.abbreviation.localeCompare(b.identity.abbreviation),
      ),
    [league.teams],
  );
  const [teamId, setTeamId] = useState<TeamId | null>(teams[0]?.identity.id ?? null);
  const team = teamId ? league.teams[teamId] : undefined;
  const gm = team ? league.gms[team.gmId] : undefined;

  // Draft-relevant outlets (those that cover college), sorted by their REAL
  // headline accuracy so the calibration gradient reads top-to-bottom.
  const outlets = useMemo(
    () =>
      Object.values(league.mediaOutlets)
        .filter((o) => o.focus !== 'NFL')
        .sort((a, b) => b.accuracySpectrum - a.accuracySpectrum),
    [league.mediaOutlets],
  );

  const perceived = gm?.perceivedOutletReliability;

  // Overall calibration error: mean |perceived − real| across outlet × group.
  const calErr = useMemo(() => {
    if (!perceived) return null;
    let sum = 0;
    let n = 0;
    for (const o of outlets) {
      const per = perceived[o.id];
      if (!per) continue;
      for (const g of POSITION_GROUPS_ORDERED) {
        const p = per[g];
        const r = o.accuracyByGroup[g];
        if (p === undefined || r === undefined) continue;
        sum += Math.abs(p - r);
        n++;
      }
    }
    return n ? sum / n : null;
  }, [perceived, outlets]);

  if (!gm) return null;

  return (
    <section className="mt-6 rounded border border-fuchsia-500/25 bg-fuchsia-500/[0.04] p-4">
      <h2 className="mb-1 text-lg font-semibold text-fuchsia-200">
        GM Media Trust — perceived vs real
      </h2>
      <p className="mb-3 text-xs text-zinc-500">
        What this GM <em>believes</em> about each outlet's reliability (left) next to the outlet's{' '}
        <em>real</em> hidden accuracy (right), per position group.{' '}
        <span className="text-emerald-400">Green</span> = well-calibrated;{' '}
        <span className="text-rose-400">red</span> = over-trusts a weaker outlet (chases the wrong
        voice → reaches at the draft); <span className="text-sky-400">blue</span> = sleeps on a sharp
        outlet. Sharp evaluators (high talent-eval) land near truth; buzz-chasers (high media-trust)
        over-rate loud outlets. The board blends each media read by the PERCEIVED number, not the
        real one. <span className="text-zinc-600">(dev-only; never the game UI)</span>
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
        <select
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-200"
          value={teamId ?? ''}
          onChange={(e) => setTeamId(e.target.value as TeamId)}
        >
          {teams.map((t) => (
            <option key={t.identity.id} value={t.identity.id}>
              {t.identity.abbreviation} — {league.gms[t.gmId]?.name ?? 'GM'}
            </option>
          ))}
        </select>
        <span className="text-zinc-400">
          {gm.name} · media-trust{' '}
          <span className="font-mono text-zinc-200">{gm.spectrums.mediaTrust}</span> · talent-eval{' '}
          <span className="font-mono text-zinc-200">{gm.spectrums.talentEvaluationAccuracy}</span>
          {calErr !== null && (
            <>
              {' '}
              · mean miscalibration{' '}
              <span className="font-mono text-zinc-200">{calErr.toFixed(2)}</span>
            </>
          )}
        </span>
      </div>

      {!perceived ? (
        <p className="text-xs text-zinc-500">No perceived-reliability data (legacy GM).</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-left text-zinc-500">
                <th className="px-2 py-1 font-medium">Outlet</th>
                <th
                  className="px-2 py-1 text-center font-medium"
                  title="real headline accuracy / hype"
                >
                  acc·hype
                </th>
                {POSITION_GROUPS_ORDERED.map((g) => (
                  <th key={g} className="px-2 py-1 text-center font-medium">
                    {g}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {outlets.map((o) => {
                const per = perceived[o.id];
                return (
                  <tr key={o.id} className="border-t border-zinc-800/60">
                    <td className="px-2 py-1 text-zinc-200" title={o.name}>
                      {abbreviateOutlet(o.name)}
                    </td>
                    <td className="px-2 py-1 text-center font-mono tabular-nums text-zinc-500">
                      {o.accuracySpectrum}·{o.hypeSpectrum}
                    </td>
                    {POSITION_GROUPS_ORDERED.map((g) => {
                      const p = per?.[g];
                      const r = o.accuracyByGroup[g];
                      if (p === undefined || r === undefined) {
                        return (
                          <td key={g} className="px-2 py-1 text-center text-zinc-700">
                            —
                          </td>
                        );
                      }
                      return (
                        <td
                          key={g}
                          className="px-2 py-1 text-center font-mono tabular-nums"
                          title={`${g}: perceived ${p.toFixed(1)} vs real ${r} · hype ${o.hypeByGroup[g]}`}
                        >
                          <span className={gmTrustCellClass(p, r)}>{p.toFixed(1)}</span>
                          <span className="text-zinc-600">/{r}</span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function MediaReliabilityPanel({ league }: { league: LeagueState }) {
  const collegeOutlets = useMemo(
    () =>
      Object.values(league.mediaOutlets)
        .filter((o) => o.focus === 'COLLEGE')
        .sort((a, b) => b.accuracySpectrum - a.accuracySpectrum),
    [league.mediaOutlets],
  );

  // outletId → group → quality row.
  const qualityByOutlet = useMemo(() => {
    const map = new Map<string, Map<PositionGroup, OutletGroupQuality>>();
    for (const o of collegeOutlets) {
      const rows = computeOutletQualityByGroup(
        league.mediaCollegeObservations,
        league.collegePool,
        o.id,
      );
      const byGroup = new Map<PositionGroup, OutletGroupQuality>();
      for (const r of rows) byGroup.set(r.group, r);
      map.set(o.id, byGroup);
    }
    return map;
  }, [collegeOutlets, league.mediaCollegeObservations, league.collegePool]);

  if (league.mediaCollegeObservations.length === 0) {
    return (
      <section className="mt-6 rounded border border-cyan-500/20 bg-cyan-500/[0.03] p-3 text-xs text-zinc-500">
        🎯 Media reliability by position group — empty until the media cycle
        runs (step through Top-30 Visits, or simulate + advance a season).
      </section>
    );
  }

  return (
    <section className="mt-6 rounded border border-cyan-500/25 bg-cyan-500/[0.04] p-4">
      <h2 className="mb-1 text-lg font-semibold text-cyan-200">
        Media Reliability by Position Group
      </h2>
      <p className="mb-3 text-xs text-zinc-500">
        How well each outlet's read <em>orders</em> prospects vs the real
        board, per group (Spearman rank correlation). Green = trust its order
        here; red = noise or hype here. Small number = bias (+ reads high). An
        outlet can be sharp on QBs and a hype machine on OL — that's the
        pattern to learn. Hover a cell for the hidden per-group knobs + sample
        size. A cell is blank (—) when this round covered fewer than 4
        prospects in that group — the media only reads the top ~30–50 flashy
        names, so thin groups (QB, OL, ST) populate only late when coverage
        widens. For a per-prospect read on everyone, use the Draft Audit tab.{' '}
        <span className="text-zinc-600">(dev-only; never the game UI)</span>
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="text-left text-zinc-500">
              <th className="px-2 py-1 font-medium">Outlet</th>
              <th className="px-2 py-1 text-center font-medium" title="headline accuracy / hype">
                acc·hype
              </th>
              {POSITION_GROUPS_ORDERED.map((g) => (
                <th key={g} className="px-2 py-1 text-center font-medium">
                  {g}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {collegeOutlets.map((o) => {
              const byGroup = qualityByOutlet.get(o.id);
              return (
                <tr key={o.id} className="border-t border-zinc-800/60">
                  <td className="px-2 py-1 text-zinc-200" title={o.name}>
                    {abbreviateOutlet(o.name)}
                  </td>
                  <td className="px-2 py-1 text-center font-mono tabular-nums text-zinc-500">
                    {o.accuracySpectrum}·{o.hypeSpectrum}
                  </td>
                  {POSITION_GROUPS_ORDERED.map((g) => {
                    const q = byGroup?.get(g);
                    const corr = q?.rankCorrelation ?? null;
                    const accG = o.accuracyByGroup[g];
                    const hypeG = o.hypeByGroup[g];
                    const title = q
                      ? `${g}: corr ${corr === null ? 'n/a' : corr.toFixed(2)}, ` +
                        `bias ${q.meanBias >= 0 ? '+' : ''}${q.meanBias.toFixed(1)}, ` +
                        `n=${q.sampleSize} · hidden acc ${accG} / hype ${hypeG}`
                      : `${g}: not covered · hidden acc ${accG} / hype ${hypeG}`;
                    return (
                      <td
                        key={g}
                        className="px-2 py-1 text-center font-mono tabular-nums"
                        title={title}
                      >
                        {corr === null ? (
                          <span className="text-zinc-700">—</span>
                        ) : (
                          <>
                            <span className={correlationCellClass(corr)}>{corr.toFixed(2)}</span>
                            {q && Math.abs(q.meanBias) >= 1 && (
                              <span className="ml-1 text-[10px] text-zinc-600">
                                {q.meanBias >= 0 ? '+' : ''}
                                {q.meanBias.toFixed(0)}
                              </span>
                            )}
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
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

function DraftShiftPanel({
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

// ─── Scout Reports (v0.125) ─────────────────────────────────────────────────
//
// The scouting-report UI: pick a TEAM (its scouting staff) or a MEDIA OUTLET,
// and a PROSPECT, and read the full dossier that source holds on him — measur-
// ables, college production, injuries, and an attributed write-up (strengths /
// concerns each bylined to the specific scout whose read drove them, keyed to
// the player's underlying stats but only as accurately as that scout read them).
// Per the inspector convention each attributed read shows perceived / real.

function sentenceCase(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

/** Tiny dev-only "observed / real" chip for one attributed read. */
function ReadGap({ point }: { point: AttributedPoint }) {
  const d = point.observedValue - point.realValue;
  const cls = d > 8 ? 'text-amber-400' : d < -8 ? 'text-cyan-400' : 'text-zinc-500';
  return (
    <span
      className="ml-1 font-mono text-[10px] text-zinc-600"
      title={`scout read ${point.observedValue} vs real ${point.realValue} · conf ${point.confidence.toFixed(2)}`}
    >
      (<span className={cls}>{point.observedValue}</span>/{point.realValue})
    </span>
  );
}

type CollegeStatLayout = 'QB' | 'RB' | 'REC' | 'OL' | 'DEF' | 'ST';

function collegeStatLayoutFor(position: Position): CollegeStatLayout {
  switch (position) {
    case Position.QB:
      return 'QB';
    case Position.RB:
    case Position.FB:
      return 'RB';
    case Position.WR:
    case Position.TE:
      return 'REC';
    case Position.LT:
    case Position.LG:
    case Position.C:
    case Position.RG:
    case Position.RT:
      return 'OL';
    case Position.K:
    case Position.P:
    case Position.LS:
      return 'ST';
    default:
      return 'DEF';
  }
}

const COLLEGE_STAT_HEADERS: Record<CollegeStatLayout, readonly string[]> = {
  QB: ['Yr', 'G', 'Cmp/Att', 'Yds', 'TD', 'INT', 'RuYd', 'RuTD'],
  RB: ['Yr', 'G', 'Att', 'Yds', 'TD', 'Rec', 'RecYd'],
  REC: ['Yr', 'G', 'Tgt', 'Rec', 'Yds', 'TD'],
  OL: ['Yr', 'G', 'GS'],
  DEF: ['Yr', 'G', 'Tkl', 'Sck', 'INT', 'PD', 'FF'],
  ST: ['Yr', 'G', 'GS'],
};

function collegeStatRow(layout: CollegeStatLayout, s: ProspectDossier['collegeStats'][number]): readonly string[] {
  const yr = CLASS_YEAR_LABELS[s.classYear];
  switch (layout) {
    case 'QB':
      return [yr, `${s.games}`, `${s.passCompletions}/${s.passAttempts}`, `${s.passingYards}`, `${s.passingTds}`, `${s.interceptionsThrown}`, `${s.rushingYards}`, `${s.rushingTds}`];
    case 'RB':
      return [yr, `${s.games}`, `${s.rushingAttempts}`, `${s.rushingYards}`, `${s.rushingTds}`, `${s.receptions}`, `${s.receivingYards}`];
    case 'REC':
      return [yr, `${s.games}`, `${s.targets}`, `${s.receptions}`, `${s.receivingYards}`, `${s.receivingTds}`];
    case 'DEF':
      return [yr, `${s.games}`, `${s.tackles}`, `${s.sacks}`, `${s.interceptions}`, `${s.passesDefended}`, `${s.forcedFumbles}`];
    case 'OL':
    case 'ST':
      return [yr, `${s.games}`, `${s.starts}`];
  }
}

const SEVERITY_CLR: Record<string, string> = {
  MINOR: 'text-zinc-400',
  MODERATE: 'text-amber-400',
  MAJOR: 'text-rose-400',
};

function PointList({
  title,
  points,
  tone,
}: {
  title: string;
  points: readonly AttributedPoint[];
  tone: 'pos' | 'neg';
}) {
  const dot = tone === 'pos' ? 'text-emerald-400' : 'text-rose-400';
  const name = tone === 'pos' ? 'text-emerald-300/80' : 'text-rose-300/80';
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">{title}</div>
      {points.length === 0 ? (
        <div className="italic text-zinc-600">No notable {tone === 'pos' ? 'strengths' : 'concerns'} on file.</div>
      ) : (
        <ul className="space-y-1">
          {points.map((p, i) => (
            <li key={`${p.skillKey}-${i}`} className="flex flex-wrap items-baseline gap-x-1 text-zinc-300">
              <span className={dot}>•</span>
              <span>{sentenceCase(p.text)}</span>
              <ReadGap point={p} />
              <span className={`text-[10px] ${name}`}>— {p.sourceName}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ScoutReportsPanel({ league }: { league: LeagueState }) {
  const [sourceKind, setSourceKind] = useState<'team' | 'outlet'>('team');
  // 'inspector' = the dossier calibration lens (perceived/real); 'game' = the
  // player-facing report rendered EXCLUSIVELY from the knowledge layer.
  const [viewMode, setViewMode] = useState<'inspector' | 'game'>('inspector');
  const teams = useMemo(
    () => Object.values(league.teams).sort((a, b) => a.identity.location.localeCompare(b.identity.location)),
    [league.teams],
  );
  const outlets = useMemo(
    () => Object.values(league.mediaOutlets).sort((a, b) => a.name.localeCompare(b.name)),
    [league.mediaOutlets],
  );
  const [teamId, setTeamId] = useState<TeamId>(() => teams[0]?.identity.id ?? ('' as TeamId));
  const [outletId, setOutletId] = useState<string>(() => outlets[0]?.id ?? '');
  const [search, setSearch] = useState('');
  const [prospectId, setProspectId] = useState<string>('');

  const viewer: DossierViewer | null = useMemo(() => {
    if (sourceKind === 'team') return teamId ? { kind: 'team', teamId } : null;
    return outletId ? { kind: 'outlet', outletId: outletId as MediaOutletId } : null;
  }, [sourceKind, teamId, outletId]);

  // Prospects this source has reads on, in the source's own priority order.
  const candidateIds = useMemo(() => {
    if (sourceKind === 'team' && teamId) {
      return (league.draftBoards[teamId] ?? []).map((e) => e.collegePlayerId as string);
    }
    if (sourceKind === 'outlet' && outletId) {
      const prefix = `${outletId}::`;
      const seen = new Set<string>();
      for (const o of league.mediaCollegeObservations) {
        if ((o.scoutId as string).startsWith(prefix)) seen.add(o.collegePlayerId as string);
      }
      return [...seen];
    }
    return [];
  }, [sourceKind, teamId, outletId, league.draftBoards, league.mediaCollegeObservations]);

  const cpById = useMemo(() => {
    const map = new Map<string, CollegePlayer>();
    for (const cp of league.collegePool) map.set(cp.id as string, cp);
    return map;
  }, [league.collegePool]);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return candidateIds
      .map((id) => cpById.get(id))
      .filter((cp): cp is CollegePlayer => !!cp)
      .filter((cp) =>
        q.length === 0 ? true : `${cp.firstName} ${cp.lastName}`.toLowerCase().includes(q),
      )
      .slice(0, 120);
  }, [candidateIds, cpById, search]);

  const selectedId = list.some((cp) => (cp.id as string) === prospectId)
    ? prospectId
    : (list[0]?.id as string | undefined) ?? '';

  const dossier = useMemo(
    () => (viewer && selectedId ? assembleProspectDossier(league, viewer, selectedId as PlayerId) : null),
    [league, viewer, selectedId],
  );
  // Game view reads through the knowledge layer ONLY — `ProspectSnapshot` has
  // no ground-truth / numeric-rating / band fields by construction.
  const snapshot = useMemo(
    () => (viewer && selectedId ? prospectSnapshot(league, viewer, selectedId as PlayerId) : null),
    [league, viewer, selectedId],
  );

  return (
    <section className="space-y-3 text-xs">
      {/* Source + prospect selectors */}
      <div className="flex flex-wrap items-center gap-2 rounded border border-zinc-800 bg-zinc-950/40 p-2">
        <div className="flex overflow-hidden rounded border border-zinc-700">
          {(['team', 'outlet'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setSourceKind(k)}
              className={`px-2 py-1 text-[11px] uppercase tracking-wide ${
                sourceKind === k ? 'bg-indigo-500/20 text-indigo-200' : 'bg-zinc-900 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {k === 'team' ? 'Team' : 'Media Outlet'}
            </button>
          ))}
        </div>
        <div className="flex overflow-hidden rounded border border-zinc-700">
          {(['inspector', 'game'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setViewMode(k)}
              title={
                k === 'game'
                  ? 'The player-facing report — rendered from the knowledge layer only (no ratings, no ground truth).'
                  : 'The dev calibration lens — perceived next to real.'
              }
              className={`px-2 py-1 text-[11px] uppercase tracking-wide ${
                viewMode === k
                  ? k === 'game'
                    ? 'bg-emerald-500/20 text-emerald-200'
                    : 'bg-indigo-500/20 text-indigo-200'
                  : 'bg-zinc-900 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {k === 'inspector' ? 'Inspector' : 'Game View'}
            </button>
          ))}
        </div>
        {sourceKind === 'team' ? (
          <select
            value={teamId}
            onChange={(e) => {
              setProspectId('');
              setTeamId(e.target.value as TeamId);
            }}
            className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-zinc-200"
          >
            {teams.map((t) => (
              <option key={t.identity.id} value={t.identity.id}>
                {t.identity.location} {t.identity.nickname}
              </option>
            ))}
          </select>
        ) : (
          <select
            value={outletId}
            onChange={(e) => {
              setProspectId('');
              setOutletId(e.target.value);
            }}
            className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-zinc-200"
          >
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        )}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="search prospect…"
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 font-mono text-zinc-200 placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
        />
        <select
          value={selectedId}
          onChange={(e) => setProspectId(e.target.value)}
          className="min-w-[14rem] rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-zinc-200"
        >
          {list.length === 0 && <option value="">— no scouted prospects —</option>}
          {list.map((cp) => (
            <option key={cp.id} value={cp.id}>
              {cp.firstName} {cp.lastName} · {cp.nflProjectedPosition} · {getSchoolById(cp.schoolId)?.name ?? cp.schoolId}
            </option>
          ))}
        </select>
        <span className="text-[10px] text-zinc-600">
          {list.length} {sourceKind === 'team' ? 'on board' : 'covered'}
        </span>
      </div>

      {dossier ? (
        viewMode === 'game' && snapshot ? (
          <>
            <GameViewReport snapshot={snapshot} />
            {/* Inspector reality check — NOT part of the game view (standing
                perceived-always-shows-real convention; the game UI never sees this). */}
            <div className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-1.5 font-mono text-[11px] text-amber-300/90">
              <span className="mr-2 uppercase tracking-wider text-amber-500/80">Inspector reality check</span>
              real grade {dossier.realGrade ?? '—'} · perceived {dossier.perceivedGrade ?? '—'} · true
              projection {dossier.realProjectedPosition}
              {dossier.projectedPosition !== dossier.realProjectedPosition && ' (source read is off)'}
            </div>
          </>
        ) : (
          <DossierCard dossier={dossier} />
        )
      ) : (
        <div className="rounded border border-zinc-800 bg-zinc-950/40 p-6 text-center text-zinc-500">
          {sourceKind === 'outlet'
            ? 'No media reads yet — advance the season into the pre-draft cycle to generate outlet coverage.'
            : 'Select a team and prospect to view the report.'}
        </div>
      )}
    </section>
  );
}

function DossierCard({ dossier }: { dossier: ProspectDossier }) {
  const d = dossier;
  const school = getSchoolById(d.schoolId);
  const layout = collegeStatLayoutFor(d.projectedPosition);
  const m = d.measurables;
  const combine = m.combine;
  // Perceived projection — with a conversion tag (← college X) and the dev-only
  // real-projection check when the source's read differs from the truth.
  const isConv = d.isPerceivedConversion;
  const wrongRead = d.projectedPosition !== d.realProjectedPosition;

  return (
    <div className="rounded border border-indigo-500/30 bg-zinc-950/60">
      {/* Header */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-800 bg-indigo-500/5 px-3 py-2">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span className="text-base font-semibold text-zinc-100">
            {d.firstName} {d.lastName}
          </span>
          <span className="flex items-baseline gap-1">
            <span className="text-indigo-300">{d.projectedPosition}</span>
            {isConv && (
              <span
                className="rounded border border-violet-500/40 bg-violet-500/10 px-1 text-[10px] uppercase tracking-wide text-violet-300"
                title={`This source projects a position conversion from his college spot (${d.collegePosition} → ${d.projectedPosition}).`}
              >
                conv ← {d.collegePosition}
              </span>
            )}
            {wrongRead && (
              <span
                className="font-mono text-[10px] text-amber-400"
                title={`Inspector check: the source projects ${d.projectedPosition}, but his TRUE projection is ${d.realProjectedPosition}. The read is off.`}
              >
                [real {d.realProjectedPosition}]
              </span>
            )}
          </span>
          <span className="text-zinc-400">
            {school?.name ?? d.schoolId} · {CLASS_YEAR_LABELS[d.classYear]}
          </span>
          <span className="text-zinc-500">
            age {d.ageYears} · {formatHeight(m.heightInches)}, {Math.round(m.weightLbs)} lb
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">Grade</span>
          <GradeCell perceived={d.perceivedGrade} real={d.realGrade} />
        </div>
      </div>

      {/* Byline */}
      <div className="border-b border-zinc-800/60 px-3 py-1 text-[11px] text-zinc-500">
        <span className="text-zinc-300">{d.viewerLabel}</span>
        {' · report by '}
        <span className="text-indigo-300">{d.bylineSourceName}</span>
        {' · '}
        {d.observationCount} {d.observationCount === 1 ? 'read' : 'reads'} on file
        {m.proDayAttendedByViewer === true && (
          <span className="ml-2 rounded border border-teal-500/30 bg-teal-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-teal-300">
            attended pro day
          </span>
        )}
      </div>

      <div className="space-y-3 p-3">
        {/* Measurables */}
        <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
          <div className="mb-1 flex items-baseline justify-between text-[10px] uppercase tracking-wider text-zinc-500">
            <span>Measurables</span>
            <span className="normal-case text-zinc-600">truth · [combine]; DNP = skipped</span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 sm:grid-cols-3 lg:grid-cols-5">
            <MeasureCell label="Height" truth={formatHeight(m.heightInches)} combine={combine?.heightInches !== undefined ? formatHeight(combine.heightInches) : undefined} attended={combine?.attended} />
            <MeasureCell label="Weight" truth={`${Math.round(m.weightLbs)} lb`} combine={combine?.weightLbs !== undefined ? `${Math.round(combine.weightLbs)} lb` : undefined} attended={combine?.attended} />
            <MeasureCell label="Arm" truth={formatInches(m.armLengthInches)} combine={combine?.armLengthInches !== undefined ? formatInches(combine.armLengthInches) : undefined} attended={combine?.attended} />
            <MeasureCell label="Hand" truth={formatInches(m.handSizeInches)} combine={combine?.handSizeInches !== undefined ? formatInches(combine.handSizeInches) : undefined} attended={combine?.attended} />
            <MeasureCell label="40-yd" truth="—" combine={combine?.fortyYardSeconds !== undefined ? `${combine.fortyYardSeconds.toFixed(2)}s` : undefined} attended={combine?.attended} />
            <MeasureCell label="Bench" truth="—" combine={combine?.benchPress225Reps !== undefined ? `${combine.benchPress225Reps}` : undefined} attended={combine?.attended} />
            <MeasureCell label="Vertical" truth="—" combine={combine?.verticalInches !== undefined ? formatInches(combine.verticalInches) : undefined} attended={combine?.attended} />
            <MeasureCell label="Broad" truth="—" combine={combine?.broadJumpInches !== undefined ? formatInches(combine.broadJumpInches) : undefined} attended={combine?.attended} />
            <MeasureCell label="3-cone" truth="—" combine={combine?.threeConeSeconds !== undefined ? `${combine.threeConeSeconds.toFixed(2)}s` : undefined} attended={combine?.attended} />
            <MeasureCell label="Shuttle" truth="—" combine={combine?.shuttleSeconds !== undefined ? `${combine.shuttleSeconds.toFixed(2)}s` : undefined} attended={combine?.attended} />
          </div>
        </div>

        {/* College stats */}
        {d.collegeStats.length > 0 && (
          <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">College Production</div>
            <table className="w-full font-mono text-[11px]">
              <thead>
                <tr className="text-left text-zinc-500">
                  {COLLEGE_STAT_HEADERS[layout].map((h) => (
                    <th key={h} className="px-1 py-0.5 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.collegeStats.map((s, i) => (
                  <tr key={i} className="border-t border-zinc-800/60 text-zinc-300">
                    {collegeStatRow(layout, s).map((c, j) => (
                      <td key={j} className="px-1 py-0.5">{c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Injuries */}
        <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Key Injuries</div>
          {d.injuries.length === 0 ? (
            <div className="text-zinc-500">No major injuries on record.</div>
          ) : (
            <ul className="space-y-0.5">
              {d.injuries.map((inj, i) => (
                <li key={i} className="text-zinc-300">
                  <span className={SEVERITY_CLR[inj.severity] ?? 'text-zinc-400'}>{inj.label}</span>
                  <span className="text-zinc-500">
                    {' '}— {CLASS_YEAR_LABELS[inj.classYear]}, {inj.severity.toLowerCase()}
                    {inj.gamesMissed > 0 ? `, missed ${inj.gamesMissed}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Write-up: strengths / concerns / scheme fit / projection */}
        <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <PointList title="Strengths" points={d.pros} tone="pos" />
            <PointList title="Concerns" points={d.cons} tone="neg" />
          </div>
          <div className="mt-3 border-t border-zinc-800/60 pt-2">
            <div className="mb-0.5 text-[10px] uppercase tracking-wider text-zinc-500">Scheme Fit</div>
            <div className="text-zinc-300">{d.schemeFit}</div>
          </div>
          <div className="mt-2 border-t border-zinc-800/60 pt-2">
            <div className="mb-0.5 flex items-baseline justify-between">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Projection</span>
              <span className="text-[10px] text-indigo-300/70">— {d.bylineSourceName}</span>
            </div>
            <div className="leading-relaxed text-zinc-200">{d.writeup}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
