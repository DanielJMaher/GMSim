/**
 * Scout Reports tab — pick a team's scouting staff or a media outlet
 * and a prospect, and read the full attributed dossier that source
 * holds on him (measurables, production, injuries, write-up).
 * Split out of App.tsx — pure code motion, no behavior change.
 */
import { useMemo, useState } from 'react';
import type { LeagueState, PlayerId, TeamId, CollegePlayer, MediaOutletId } from '@gmsim/engine/types';
import { Position } from '@gmsim/engine/types';
import { getSchoolById, assembleProspectDossier, prospectSnapshot } from '@gmsim/engine';
import { GameViewReport } from '../GameView';
import type { ProspectDossier, DossierViewer, AttributedPoint } from '@gmsim/engine';
import { formatHeight, formatInches, CLASS_YEAR_LABELS } from '../lib/format';
import { MeasureCell, GradeCell } from '../lib/cells';

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

export function ScoutReportsPanel({ league }: { league: LeagueState }) {
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
        <span
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] uppercase tracking-wide text-zinc-400"
          title="The live draft class. Reports cover the CURRENT class only — past classes aren't retained (the college pool advances + prunes each offseason), so there's no year picker here."
        >
          Season {league.seasonNumber} class
        </span>
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
