/**
 * League tab — league overview, division standings, and the Team Detail
 * drawer (roster, scouting staff, trade builder, coach/GM panels).
 * Split out of App.tsx — pure code motion, no behavior change.
 */
import React, { useMemo, useState } from 'react';
import { getArchetypeById, schemeFitForPlayer, summarizeTeamCap, currentCapHit, divisionStandings, playoffSeeds, winPct, ageOfPlayer, seasonStatsForTeam, releasePlayer, deadMoneyOnPreJune1Release, executeTrade, signingBonusProrationPerYear, moodBucket, teamChemistry } from '@gmsim/engine';
import type { TeamRecord, SeasonAwards, MoodBucket, ChemistryBucket } from '@gmsim/engine';
import type { MoodArchetype } from '@gmsim/engine/types';
import type { LeagueState, TeamState, TeamPersonality, TeamSeasonRecord, Player, PlayerId, PlayerSkills, PlayerSeasonStats, CareerAward, TeamId, Contract, Scout, ScoutQuirk, PlayerObservation, WatchListEntry, WatchListReason, CollegeScout, ScoutRegion } from '@gmsim/engine/types';
import { Division, PositionGroup, Position, Conference } from '@gmsim/engine/types';
import { getAbility, describeAbilityHint, narrateBackstory, careerShapeFor, declineMultiplierFor, curveForPosition } from '@gmsim/engine';
import type { CareerShape } from '@gmsim/engine';
import { DepthChartCard } from '../DepthChart';
import type { MediaReport } from '@gmsim/engine';
import { formatHeight, avgKeySkill, avgKeyCeiling, POSITION_GROUPS_ORDERED, accuracyTone, skillDeltaTone, skillTone, skillWeightChip, careerStatColumns, SKILL_GROUPS, SKILL_LABELS, WATCH_LIST_REASON } from '../lib/format';
import { ContractTermsTable } from '../lib/cells';

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

export function LeagueOverview({ league }: { league: LeagueState }) {
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

export function DivisionSection({
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

export function TeamDetail({
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
        .sort((a, b) => a.identity.location.localeCompare(b.identity.location)),
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


const DEV_ARCHETYPE_LABELS: Record<Player['developmentArchetype'], string> = {
  FAST_LEARNER: 'Fast learner',
  SLOW_STEADY: 'Slow & steady',
  ADVERSITY_DRIVEN: 'Adversity-driven',
  EARLY_BLOOMER: 'Early bloomer',
  LATE_DEVELOPER: 'Late developer',
  CONFIDENCE_DEPENDENT: 'Confidence-dependent',
};

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

export function PlayerDetail({ player, league }: { player: Player; league: LeagueState }) {
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

// ─── SEASON RESULTS VIEW ─────────────────────────────────────────────────

export function SeasonResultsView({
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

export function SeasonLeadersView({
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

export function AwardsView({ league, awards }: { league: LeagueState; awards: SeasonAwards }) {
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
