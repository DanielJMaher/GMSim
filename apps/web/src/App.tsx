import { useMemo, useState } from 'react';
import { createLeague, getArchetypeById, schemeFitForPlayer } from '@gmsim/engine';
import type {
  LeagueState,
  TeamState,
  TeamPersonality,
  Player,
  TeamId,
} from '@gmsim/engine/types';
import { Division, PositionGroup } from '@gmsim/engine/types';

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
export function App() {
  const [seed, setSeed] = useState('phase-1-rosters');
  const [seedDraft, setSeedDraft] = useState(seed);
  const [selectedTeamId, setSelectedTeamId] = useState<TeamId | null>(null);

  const league = useMemo(() => createLeague({ seed }), [seed]);
  const teams = Object.values(league.teams).sort((a, b) =>
    a.identity.division === b.identity.division
      ? a.identity.location.localeCompare(b.identity.location)
      : a.identity.division.localeCompare(b.identity.division),
  );

  const divisions = Object.values(Division);
  const selectedTeam = selectedTeamId ? league.teams[selectedTeamId] : null;

  return (
    <main className="min-h-screen p-6 lg:p-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">GMSim</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Phase 1 dev inspector — exposes raw engine state for verification.
            Not player-facing.
          </p>
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSeed(seedDraft || 'default');
            setSelectedTeamId(null);
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
      </header>

      <LeagueOverview league={league} />

      {selectedTeam && (
        <TeamDetail
          team={selectedTeam}
          league={league}
          onClose={() => setSelectedTeamId(null)}
        />
      )}

      {divisions.map((division) => (
        <DivisionSection
          key={division}
          division={division}
          league={league}
          teams={teams.filter((t) => t.identity.division === division)}
          selectedTeamId={selectedTeamId}
          onSelect={setSelectedTeamId}
        />
      ))}
    </main>
  );
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

function DivisionSection({
  division,
  league,
  teams,
  selectedTeamId,
  onSelect,
}: {
  division: Division;
  league: LeagueState;
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
  selected,
  onClick,
}: {
  team: TeamState;
  league: LeagueState;
  selected: boolean;
  onClick: () => void;
}) {
  const owner = league.owners[team.ownerId]!;
  const gm = league.gms[team.gmId]!;
  const hc = league.coaches[team.headCoachId]!;
  const tp = league.teamPersonalities[team.identity.id]!;

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
          <span className="text-xs text-zinc-600">{team.identity.marketSize.toLowerCase()}</span>
        </div>
        <div className="text-xs text-zinc-500">
          {team.franchiseHistory.toLowerCase().replace(/_/g, ' ')} ·{' '}
          {team.competitiveWindow.toLowerCase()}
        </div>
      </header>

      <PersonnelLine label="OWNER" name={owner.name} quirks={owner.quirks} />
      <PersonnelLine label="GM" name={gm.name} quirks={gm.quirks} />
      <PersonnelLine
        label="HC"
        name={hc.name}
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

      <div className="mt-2 text-xs text-zinc-600">{team.rosterIds.length} players</div>
    </article>
  );
}

function PersonnelLine({
  label,
  name,
  quirks,
  extras,
}: {
  label: string;
  name: string;
  quirks: readonly string[];
  extras?: readonly string[];
}) {
  return (
    <div className="mb-1">
      <span className="mr-2 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
        {label}
      </span>
      <span>{name}</span>
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
  onClose,
}: {
  team: TeamState;
  league: LeagueState;
  onClose: () => void;
}) {
  const hc = league.coaches[team.headCoachId]!;
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
          <h2 className="text-lg font-medium">{team.identity.fullName}</h2>
          <p className="text-xs text-zinc-500">
            {team.rosterIds.length}-man roster · scheme:{' '}
            {hc.offensiveScheme.replace(/_/g, ' ').toLowerCase()} /{' '}
            {hc.defensiveScheme.replace(/_/g, ' ').toLowerCase()}
          </p>
        </div>
        <button
          onClick={onClose}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
        >
          close
        </button>
      </header>

      <div className="space-y-4">
        {groups
          .filter((g) => g.players.length > 0)
          .map((group) => (
            <PositionGroupTable key={group.group} group={group} hc={hc} />
          ))}
      </div>
    </section>
  );
}

function PositionGroupTable({
  group,
  hc,
}: {
  group: { group: PositionGroup; label: string; players: Player[] };
  hc: { offensiveScheme: string; defensiveScheme: string };
}) {
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
              <th className="px-2 py-1 font-medium">archetype</th>
              <th className="px-2 py-1 font-medium" title="Average of relevant skills">
                key skill
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
              return (
                <tr key={p.id} className="border-t border-zinc-800/60">
                  <td className="px-2 py-1 font-mono text-zinc-400">{p.position}</td>
                  <td className="px-2 py-1">
                    {p.firstName} {p.lastName}
                  </td>
                  <td className="px-2 py-1 text-zinc-500">{computeAge(p.birthDate)}</td>
                  <td className="px-2 py-1 text-zinc-400">{archetypeLabel}</td>
                  <td className="px-2 py-1 font-mono">{cur}</td>
                  <td className="px-2 py-1 font-mono text-zinc-500">{ceil}</td>
                  <td className={`px-2 py-1 font-mono ${fitTone}`}>{fit.toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
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

function computeAge(birthDate: string): number {
  const birthYear = Number(birthDate.slice(0, 4));
  return 2026 - birthYear;
}
