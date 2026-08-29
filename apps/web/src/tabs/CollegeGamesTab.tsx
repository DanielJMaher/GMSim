/**
 * College Games tab — collapsible weeks -> collapsible games -> team
 * box score + per-prospect stat lines, the in-season media-movement
 * calibration instrument.
 * Split out of App.tsx — pure code motion, no behavior change.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LeagueState, CollegePlayer } from '@gmsim/engine/types';
import { getSchoolById, collegeTeamStrength, bucketProspectsBySchool } from '@gmsim/engine';
import type { CollegeGame, CollegePlayerGameStats } from '@gmsim/engine/types';
import { prospectRealGradeFromCp } from '../lib/format';

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

export function CollegeGamesPanel({ league }: { league: LeagueState }) {
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

