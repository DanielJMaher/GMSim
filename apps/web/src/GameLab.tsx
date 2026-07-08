/**
 * Game Lab — the inspector's window into the game sim itself: single-game box
 * scores + play-by-play drive charts, and an aggregate W/L calibration view.
 *
 * This is the calibration lens for the efficiency-expression slice
 * (docs/design-docs/EFFICIENCY_EXPRESSION.md §10): the drive-length skew, the
 * red-zone behavior, and the W-L box-score splits read right off it, next to the
 * real-NFL bars. It reads GROUND-TRUTH sim output (the engine's own
 * `DriveGameResult`) — the sanctioned inspector exception, not a player-facing
 * surface. Deterministic: a (matchup, seed) reproduces the game, so nothing is
 * stored — we just re-sim on demand.
 */

import { useMemo, useState } from 'react';
import { Prng, simulateGameWithDrives } from '@gmsim/engine';
import type { LeagueState, TeamState, TeamId, PlayerId } from '@gmsim/engine/types';
import type { DriveGameResult, DriveResult, PlayerStatLine } from '@gmsim/engine';

// ── Real-NFL bars (nflverse REG; the campaign / Scorekeeper) ─────────────────
const REAL = {
  playsPerDrive: 5.5, // ~symmetric between W and L
  passYdsW: 249.9,
  passYdsL: 240.4,
  passDelta: 9.5,
  rushDelta: 35.1,
  attW: 31.9,
  attL: 36.7,
  attDelta: -4.8,
  compW: 66.5,
  compL: 60.6,
};
// drive-outcome mix, % of drives (Magistrate real bar)
const REAL_MIX: Record<string, number> = {
  TD: 21.7,
  FG: 14.6,
  PUNT: 37.2,
  TURNOVER: 11.5,
  DOWNS: 4.7,
  MISSED_FG: 2.6,
  SAFETY: 0.3,
};

const RESULT_STYLE: Record<DriveResult, { label: string; bar: string; text: string }> = {
  TD: { label: 'TD', bar: 'bg-emerald-500', text: 'text-emerald-300' },
  FG: { label: 'FG', bar: 'bg-lime-500', text: 'text-lime-300' },
  MISSED_FG: { label: 'FG miss', bar: 'bg-amber-600', text: 'text-amber-300' },
  PUNT: { label: 'Punt', bar: 'bg-zinc-500', text: 'text-zinc-400' },
  TURNOVER: { label: 'TO', bar: 'bg-rose-500', text: 'text-rose-300' },
  DOWNS: { label: 'Downs', bar: 'bg-orange-500', text: 'text-orange-300' },
  SAFETY: { label: 'Safety', bar: 'bg-violet-500', text: 'text-violet-300' },
  END_HALF: { label: 'End half', bar: 'bg-zinc-700', text: 'text-zinc-500' },
};

interface Totals {
  passYds: number;
  rushYds: number;
  passAtt: number;
  passComp: number;
  intThrown: number;
  fumbles: number;
  sacks: number;
  tackles: number;
  defInt: number;
  fgm: number;
  fga: number;
  xp: number;
  punts: number;
  puntYds: number;
}

function emptyTotals(): Totals {
  return { passYds: 0, rushYds: 0, passAtt: 0, passComp: 0, intThrown: 0, fumbles: 0, sacks: 0, tackles: 0, defInt: 0, fgm: 0, fga: 0, xp: 0, punts: 0, puntYds: 0 };
}

function teamTotals(rosterIds: readonly PlayerId[], stats: Map<string, PlayerStatLine>): Totals {
  const t = emptyTotals();
  for (const id of rosterIds) {
    const l = stats.get(id);
    if (!l) continue;
    t.passYds += l.passingYards;
    t.rushYds += l.rushingYards;
    t.passAtt += l.passAttempts;
    t.passComp += l.passCompletions;
    t.intThrown += l.interceptionsThrown;
    t.fumbles += l.fumblesLost;
    t.sacks += l.sacks;
    t.tackles += l.tackles;
    t.defInt += l.interceptions;
    t.fgm += l.fieldGoalsMade;
    t.fga += l.fieldGoalsAttempted;
    t.xp += l.extraPointsMade;
    t.punts += l.punts;
    t.puntYds += l.puntYards;
  }
  return t;
}

function teamName(league: LeagueState, id: string): string {
  return league.teams[id as TeamId]?.identity.abbreviation ?? '?';
}

function playerName(league: LeagueState, id: PlayerId): string {
  const p = league.players[id];
  return p ? `${p.firstName.charAt(0)}. ${p.lastName}` : id;
}

// ── Single game ──────────────────────────────────────────────────────────────

function StatRow({ label, home, away, fmt = (x: number) => String(Math.round(x)) }: { label: string; home: number; away: number; fmt?: (x: number) => string }) {
  return (
    <tr className="border-t border-zinc-800/60">
      <td className="py-0.5 pr-3 text-right font-mono text-zinc-200">{fmt(home)}</td>
      <td className="px-2 text-center text-[10px] uppercase tracking-wider text-zinc-500">{label}</td>
      <td className="py-0.5 pl-3 font-mono text-zinc-200">{fmt(away)}</td>
    </tr>
  );
}

function PlayerLines({ league, title, ids, stats, kind }: { league: LeagueState; title: string; ids: readonly PlayerId[]; stats: Map<string, PlayerStatLine>; kind: 'pass' | 'rush' | 'rec' | 'def' | 'st' }) {
  const rows = ids
    .map((id) => ({ id, l: stats.get(id) }))
    .filter((r): r is { id: PlayerId; l: PlayerStatLine } => {
      const l = r.l;
      if (!l) return false;
      if (kind === 'pass') return l.passAttempts > 0;
      if (kind === 'rush') return l.rushingAttempts > 0;
      if (kind === 'rec') return l.receptions > 0;
      if (kind === 'def') return l.tackles > 0 || l.sacks > 0 || l.interceptions > 0;
      return l.fieldGoalsAttempted > 0 || l.punts > 0 || l.returnYards > 0;
    });
  if (rows.length === 0) return null;
  const line = (l: PlayerStatLine): string => {
    if (kind === 'pass') return `${l.passCompletions}/${l.passAttempts}, ${l.passingYards} yd, ${l.passingTds} TD, ${l.interceptionsThrown} INT`;
    if (kind === 'rush') return `${l.rushingAttempts} car, ${l.rushingYards} yd, ${l.rushingTds} TD${l.fumblesLost ? `, ${l.fumblesLost} FL` : ''}`;
    if (kind === 'rec') return `${l.receptions} rec, ${l.receivingYards} yd, ${l.receivingTds} TD`;
    if (kind === 'def') return `${l.tackles} tkl, ${l.sacks} sk, ${l.interceptions} INT`;
    return [l.fieldGoalsAttempted ? `${l.fieldGoalsMade}/${l.fieldGoalsAttempted} FG, ${l.extraPointsMade} XP` : '', l.punts ? `${l.punts} punt, ${l.puntYards} yd` : '', l.returnYards ? `${l.returnYards} ret yd` : ''].filter(Boolean).join(' · ');
  };
  return (
    <div className="mt-1">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{title}</div>
      <ul className="font-mono text-[11px] text-zinc-300">
        {rows.map((r) => (
          <li key={r.id}>
            <span className="text-zinc-400">{playerName(league, r.id)}</span> — {line(r.l)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DriveChart({ league, result, homeId, awayId }: { league: LeagueState; result: DriveGameResult; homeId: string; awayId: string }) {
  const drives = result.driveLog.filter((d) => d.result !== 'END_HALF');
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Play-by-play drives</div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-[9px] uppercase tracking-wider text-zinc-600">
            <th className="text-left">#</th>
            <th className="text-left">Off</th>
            <th className="text-left">Field</th>
            <th className="text-right">Start</th>
            <th className="text-right">Plays</th>
            <th className="text-right">Yds</th>
            <th className="text-left">Result</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {drives.map((d, i) => {
            const style = RESULT_STYLE[d.result];
            const start = Math.max(0, Math.min(100, d.start));
            const end = Math.max(0, Math.min(100, d.start + d.yards));
            const lo = Math.min(start, end);
            const w = Math.max(1, Math.abs(end - start));
            return (
              <tr key={i} className="border-t border-zinc-800/40">
                <td className="text-zinc-600">{i + 1}</td>
                <td className="pr-2 text-zinc-400">{teamName(league, d.offense === 'home' ? homeId : awayId)}</td>
                <td className="w-1/3 py-0.5">
                  <div className="relative h-2 w-full rounded-sm bg-zinc-800/60">
                    <div className={`absolute h-2 rounded-sm ${style.bar}`} style={{ left: `${lo}%`, width: `${w}%` }} />
                  </div>
                </td>
                <td className="text-right text-zinc-500">own {Math.round(d.start)}</td>
                <td className="text-right text-zinc-300">{d.plays}</td>
                <td className="text-right text-zinc-300">{d.yards}</td>
                <td className={`pl-2 ${style.text}`}>{style.label}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SingleGame({ league, homeId, awayId, seed }: { league: LeagueState; homeId: string; awayId: string; seed: string }) {
  const result = useMemo<DriveGameResult | null>(() => {
    const home = league.teams[homeId as TeamId];
    const away = league.teams[awayId as TeamId];
    if (!home || !away) return null;
    return simulateGameWithDrives(new Prng(`gamelab:${seed}:${homeId}:${awayId}`), home, away, league, {});
  }, [league, homeId, awayId, seed]);

  if (!result) return <div className="text-zinc-500">Pick two teams.</div>;
  const home = league.teams[homeId as TeamId]!;
  const away = league.teams[awayId as TeamId]!;
  const stats = result.playerStats ?? new Map<string, PlayerStatLine>();
  const ht = teamTotals(home.rosterIds, stats);
  const at = teamTotals(away.rosterIds, stats);
  const compPct = (t: Totals) => (t.passAtt ? (100 * t.passComp) / t.passAtt : 0);

  return (
    <div className="space-y-2">
      {/* Scoreline */}
      <div className="flex items-center justify-center gap-4 rounded border border-zinc-800 bg-zinc-950/50 py-2">
        <span className="text-lg font-semibold text-zinc-100">{home.identity.abbreviation}</span>
        <span className="font-mono text-2xl text-zinc-100">
          {result.homeScore} <span className="text-zinc-600">–</span> {result.awayScore}
        </span>
        <span className="text-lg font-semibold text-zinc-100">{away.identity.abbreviation}</span>
      </div>

      <div className="grid gap-2 lg:grid-cols-2">
        {/* Team box score */}
        <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
          <div className="mb-1 text-center text-[10px] uppercase tracking-wider text-zinc-500">
            {home.identity.abbreviation} · box · {away.identity.abbreviation}
          </div>
          <table className="mx-auto">
            <tbody>
              <StatRow label="Points" home={result.homeScore} away={result.awayScore} />
              <StatRow label="Pass yds" home={ht.passYds} away={at.passYds} />
              <StatRow label="Rush yds" home={ht.rushYds} away={at.rushYds} />
              <StatRow label="Total yds" home={ht.passYds + ht.rushYds} away={at.passYds + at.rushYds} />
              <StatRow label="Att / Cmp" home={ht.passAtt} away={at.passAtt} fmt={(x) => String(x)} />
              <StatRow label="Comp %" home={compPct(ht)} away={compPct(at)} fmt={(x) => x.toFixed(1)} />
              <StatRow label="Sacks (D)" home={ht.sacks} away={at.sacks} />
              <StatRow label="Turnovers" home={ht.intThrown + ht.fumbles} away={at.intThrown + at.fumbles} />
              <StatRow label="FG" home={ht.fgm} away={at.fgm} fmt={(x) => String(x)} />
              <StatRow label="Punts" home={ht.punts} away={at.punts} />
            </tbody>
          </table>
        </div>

        {/* Drive chart */}
        <DriveChart league={league} result={result} homeId={homeId} awayId={awayId} />
      </div>

      {/* Player lines, per team */}
      <div className="grid gap-2 lg:grid-cols-2">
        {[home, away].map((tm) => (
          <div key={tm.identity.id} className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-emerald-400">{tm.identity.fullName}</div>
            <PlayerLines league={league} title="Passing" ids={tm.rosterIds} stats={stats} kind="pass" />
            <PlayerLines league={league} title="Rushing" ids={tm.rosterIds} stats={stats} kind="rush" />
            <PlayerLines league={league} title="Receiving" ids={tm.rosterIds} stats={stats} kind="rec" />
            <PlayerLines league={league} title="Defense" ids={tm.rosterIds} stats={stats} kind="def" />
            <PlayerLines league={league} title="Special teams" ids={tm.rosterIds} stats={stats} kind="st" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Aggregate / calibration view ─────────────────────────────────────────────

interface SideAgg {
  plays: number;
  drives: number;
  pass: number;
  rush: number;
  att: number;
  comp: number;
  n: number;
}

function runAggregate(league: LeagueState, n: number): { W: SideAgg; L: SideAgg; mix: Map<string, number>; games: number } {
  const teams = Object.values(league.teams) as TeamState[];
  const W: SideAgg = { plays: 0, drives: 0, pass: 0, rush: 0, att: 0, comp: 0, n: 0 };
  const L: SideAgg = { plays: 0, drives: 0, pass: 0, rush: 0, att: 0, comp: 0, n: 0 };
  const mix = new Map<string, number>();
  let games = 0;
  for (let i = 0; i < n; i++) {
    const a = i % teams.length;
    const b = (a + 1 + ((i * 7) % (teams.length - 1))) % teams.length;
    const home = teams[a]!;
    const away = teams[b]!;
    const res = simulateGameWithDrives(new Prng(`agg:${i}`), home, away, league, {});
    if (res.homeScore === res.awayScore) continue; // skip the rare tie for a clean W/L split
    const stats = res.playerStats ?? new Map<string, PlayerStatLine>();
    for (const d of res.driveLog) {
      if (d.result === 'END_HALF') continue;
      mix.set(d.result, (mix.get(d.result) ?? 0) + 1);
    }
    const acc = (tm: TeamState, side: 'home' | 'away'): SideAgg => {
      const t = teamTotals(tm.rosterIds, stats);
      const dl = res.driveLog.filter((d) => d.offense === side && d.result !== 'END_HALF');
      return { plays: dl.reduce((s, d) => s + d.plays, 0), drives: dl.length, pass: t.passYds, rush: t.rushYds, att: t.passAtt, comp: t.passComp, n: 1 };
    };
    const h = acc(home, 'home');
    const aw = acc(away, 'away');
    const winner = res.homeScore > res.awayScore ? h : aw;
    const loser = res.homeScore > res.awayScore ? aw : h;
    for (const [dst, src] of [[W, winner], [L, loser]] as const) {
      dst.plays += src.plays;
      dst.drives += src.drives;
      dst.pass += src.pass;
      dst.rush += src.rush;
      dst.att += src.att;
      dst.comp += src.comp;
      dst.n += 1;
    }
    games += 1;
  }
  return { W, L, mix, games };
}

function Delta({ sim, real }: { sim: number; real: number }) {
  const good = Math.abs(sim - real) <= Math.max(2, Math.abs(real) * 0.3);
  return (
    <span className={good ? 'text-emerald-300' : 'text-amber-300'}>
      {sim >= 0 ? '+' : ''}
      {sim.toFixed(1)}
      <span className="ml-1 text-[10px] text-zinc-500">(real {real >= 0 ? '+' : ''}{real.toFixed(1)})</span>
    </span>
  );
}

function AggregateView({ league }: { league: LeagueState }) {
  const [n, setN] = useState(150);
  const [data, setData] = useState<ReturnType<typeof runAggregate> | null>(null);
  const [busy, setBusy] = useState(false);
  const run = () => {
    setBusy(true);
    // let the button paint before the synchronous sim burst
    setTimeout(() => {
      setData(runAggregate(league, n));
      setBusy(false);
    }, 10);
  };
  const per = (s: SideAgg, field: keyof SideAgg) => (s.n ? (s[field] as number) / s.n : 0);
  const ppd = (s: SideAgg) => (s.drives ? s.plays / s.drives : 0);
  const cp = (s: SideAgg) => (s.att ? (100 * s.comp) / s.att : 0);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-zinc-400">Sim</span>
        <input type="number" value={n} min={20} max={600} step={10} onChange={(e) => setN(Number(e.target.value))} className="w-20 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-zinc-200" />
        <span className="text-zinc-400">games (league-wide), split by W/L</span>
        <button onClick={run} disabled={busy} className="rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {busy ? 'Simming…' : 'Run'}
        </button>
      </div>
      {data && (
        <>
          <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">{data.games} games — winners vs losers (the drive-length skew reads here)</div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-zinc-600">
                  <th className="text-left">metric</th>
                  <th className="text-right">WIN</th>
                  <th className="text-right">LOSS</th>
                  <th className="text-right">Δ (sim vs real)</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                <tr className="border-t border-zinc-800/60">
                  <td className="text-zinc-400">plays/drive</td>
                  <td className="text-right text-zinc-200">{ppd(data.W).toFixed(2)}</td>
                  <td className="text-right text-zinc-200">{ppd(data.L).toFixed(2)}</td>
                  <td className="text-right"><Delta sim={ppd(data.W) - ppd(data.L)} real={0} /></td>
                </tr>
                <tr className="border-t border-zinc-800/60">
                  <td className="text-zinc-400">pass yds/g</td>
                  <td className="text-right text-zinc-200">{per(data.W, 'pass').toFixed(1)}</td>
                  <td className="text-right text-zinc-200">{per(data.L, 'pass').toFixed(1)}</td>
                  <td className="text-right"><Delta sim={per(data.W, 'pass') - per(data.L, 'pass')} real={REAL.passDelta} /></td>
                </tr>
                <tr className="border-t border-zinc-800/60">
                  <td className="text-zinc-400">rush yds/g</td>
                  <td className="text-right text-zinc-200">{per(data.W, 'rush').toFixed(1)}</td>
                  <td className="text-right text-zinc-200">{per(data.L, 'rush').toFixed(1)}</td>
                  <td className="text-right"><Delta sim={per(data.W, 'rush') - per(data.L, 'rush')} real={REAL.rushDelta} /></td>
                </tr>
                <tr className="border-t border-zinc-800/60">
                  <td className="text-zinc-400">pass att/g</td>
                  <td className="text-right text-zinc-200">{per(data.W, 'att').toFixed(1)}</td>
                  <td className="text-right text-zinc-200">{per(data.L, 'att').toFixed(1)}</td>
                  <td className="text-right"><Delta sim={per(data.W, 'att') - per(data.L, 'att')} real={REAL.attDelta} /></td>
                </tr>
                <tr className="border-t border-zinc-800/60">
                  <td className="text-zinc-400">comp %</td>
                  <td className="text-right text-zinc-200">{cp(data.W).toFixed(1)}</td>
                  <td className="text-right text-zinc-200">{cp(data.L).toFixed(1)}</td>
                  <td className="text-right"><Delta sim={cp(data.W) - cp(data.L)} real={REAL.compW - REAL.compL} /></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">drive-outcome mix (sim % · real %)</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px]">
              {[...data.mix.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([res, count]) => {
                  const total = [...data.mix.values()].reduce((s, x) => s + x, 0);
                  const simPct = (100 * count) / total;
                  const realPct = REAL_MIX[res];
                  return (
                    <span key={res} className={RESULT_STYLE[res as DriveResult]?.text ?? 'text-zinc-300'}>
                      {RESULT_STYLE[res as DriveResult]?.label ?? res} {simPct.toFixed(1)}%
                      {realPct !== undefined && <span className="text-zinc-500"> · {realPct.toFixed(1)}</span>}
                    </span>
                  );
                })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Panel ────────────────────────────────────────────────────────────────────

export function GameLabPanel({ league }: { league: LeagueState }) {
  const teams = useMemo(
    () => (Object.values(league.teams) as TeamState[]).slice().sort((a, b) => a.identity.abbreviation.localeCompare(b.identity.abbreviation)),
    [league],
  );
  const [mode, setMode] = useState<'single' | 'aggregate'>('single');
  const [homeId, setHomeId] = useState(teams[0]?.identity.id ?? '');
  const [awayId, setAwayId] = useState(teams[1]?.identity.id ?? '');
  const [seed, setSeed] = useState('1');

  return (
    <div className="space-y-3 rounded border border-cyan-500/20 bg-zinc-950/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded border border-zinc-700 text-xs">
          {(['single', 'aggregate'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1 ${mode === m ? 'bg-cyan-500/20 text-cyan-200' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              {m === 'single' ? 'Single game' : 'Aggregate (W/L)'}
            </button>
          ))}
        </div>
        {mode === 'single' && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select value={homeId} onChange={(e) => setHomeId(e.target.value)} className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-200">
              {teams.map((t) => (
                <option key={t.identity.id} value={t.identity.id}>
                  {t.identity.abbreviation} — {t.identity.fullName}
                </option>
              ))}
            </select>
            <span className="text-zinc-500">vs</span>
            <select value={awayId} onChange={(e) => setAwayId(e.target.value)} className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-200">
              {teams.map((t) => (
                <option key={t.identity.id} value={t.identity.id}>
                  {t.identity.abbreviation} — {t.identity.fullName}
                </option>
              ))}
            </select>
            <span className="text-zinc-500">seed</span>
            <input value={seed} onChange={(e) => setSeed(e.target.value)} className="w-16 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-zinc-200" />
          </div>
        )}
      </div>

      {mode === 'single' ? <SingleGame league={league} homeId={homeId} awayId={awayId} seed={seed} /> : <AggregateView league={league} />}
    </div>
  );
}
