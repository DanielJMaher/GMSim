/**
 * Lifecycle tab — the unified season/college calendar step-through:
 * NFL + college weeks interleaved by real date, postseason rounds, the
 * per-tick event log, and the college season mini-standings.
 * Split out of App.tsx — pure code motion, no behavior change.
 *
 * Exports snapshotAnchor/TickAnchor too — App.tsx owns the tick-anchor
 * ref (Step Tick lives in the header, not this tab) but the anchor
 * snapshot type and constructor are this tab's concern.
 */
import React, { useMemo } from 'react';
import { seasonAwards } from '@gmsim/engine';
import type { SeasonAwards } from '@gmsim/engine';
import type { LeagueState, PlayerId, Transaction, DraftPickRecord } from '@gmsim/engine/types';
import { getSchoolById, aggregateCollegeSeasonStats, collegeStatLeaders } from '@gmsim/engine';
import type { CollegeSeasonStatLine, CollegeStatCategory } from '@gmsim/engine/types';
import { phaseCalendarLabel, phaseCalendarDate, formatCalendarDate, buildSeasonTimeline, TRADE_DEADLINE_WEEK_INDEX } from '@gmsim/engine';
import type { LifecyclePhase, CalendarDate, TimelineStep, MediaReport } from '@gmsim/engine';
import type { CollegeGame, CollegeGameKind } from '@gmsim/engine/types';

// ─── Lifecycle step-through panel (v0.59; v0.63.1 unified calendar) ──────
//
// Pays off the v0.54 + v0.56 + v0.57 substrate: a single date-ordered
// timeline of every lifecycle tick — NFL and college weeks interleaved
// by real calendar date, then the postseason rounds and offseason
// chain — with the current position highlighted, calendar labels +
// approximate dates, and step controls (one tick / one phase). The
// ribbon is built straight from the engine's `buildSeasonTimeline`, so
// what you step through matches what you see.

export interface TickAnchor {
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
export function snapshotAnchor(league: LeagueState): TickAnchor {
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

export function LifecyclePanel({
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
    case 'restructure': {
      const team = league.teams[tx.teamId];
      return {
        section: 'Cap moves',
        icon: '💰',
        text: `${team?.identity.abbreviation ?? tx.teamId} restructures ${playerLabel(tx.playerId, league)} — $${formatMillions(tx.convertedAmount)}M base → bonus, frees $${formatMillions(tx.capRelief)}M`,
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

export function formatDateOrEmpty(date: CalendarDate | null): string {
  if (!date) return '';
  return `${date.month}/${date.day}`;
}
