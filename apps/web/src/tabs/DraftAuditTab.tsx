/**
 * Draft Audit tab — the calibration lens: every draft-eligible prospect
 * with the REAL grade next to what teams and media believe, sortable,
 * with a per-position-group correlation summary.
 * Split out of App.tsx — pure code motion, no behavior change.
 */
import { useMemo, useState } from 'react';
import type { LeagueState, TeamId, CollegePlayer } from '@gmsim/engine/types';
import { PositionGroup } from '@gmsim/engine/types';
import { getSchoolById, positionGroupFor } from '@gmsim/engine';
import { POSITION_GROUPS_ORDERED, prospectRealGradeFromCp } from '../lib/format';

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

export function DraftAuditPanel({ league }: { league: LeagueState }) {
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
        <span
          className="text-xs text-zinc-500"
          title="The live draft class only — past classes aren't retained (the pool advances each offseason), so there's no year picker here."
        >
          Season {league.seasonNumber} class · {rows.length} draft-eligible · showing {sorted.length}
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
