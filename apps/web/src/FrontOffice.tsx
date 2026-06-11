/**
 * Front Office tab (inspector, dev lens) — the regime-mortality surface
 * (GM hire/fire S1, v0.138). Per-team GM/HC tenure, stint records, and the
 * REAL hidden seat pressure (ground truth — this is the sanctioned
 * calibration lens; the game UI never sees these numbers). Plus the
 * league-wide carousel history (every firing/hiring off the transaction
 * log) and the unemployed retread pool.
 *
 * When the hot-seat MEDIA read lands (S3), this panel grows the
 * perceived/real pair per the standing inspector convention.
 */

import { useMemo } from 'react';
import { FIRING_THRESHOLD } from '@gmsim/engine/npc-ai';
import type { LeagueState, TeamState } from '@gmsim/engine/types';
import type { CareerStint, Gm, HeadCoach } from '@gmsim/engine/types';
import type {
  Transaction,
  TransactionHcFired,
  TransactionGmFired,
  TransactionHcHired,
  TransactionGmHired,
} from '@gmsim/engine/types';

type CarouselTxn =
  | TransactionHcFired
  | TransactionGmFired
  | TransactionHcHired
  | TransactionGmHired;

function isCarouselTxn(t: Transaction): t is CarouselTxn {
  return (
    t.kind === 'hc-fired' || t.kind === 'gm-fired' || t.kind === 'hc-hired' || t.kind === 'gm-hired'
  );
}

function seatClasses(seat: number): string {
  if (seat >= FIRING_THRESHOLD) return 'text-red-400';
  if (seat >= FIRING_THRESHOLD * 0.6) return 'text-amber-400';
  if (seat <= 0) return 'text-emerald-400';
  return 'text-zinc-300';
}

function fmtSeat(seat: number): string {
  return seat.toFixed(0);
}

function fmtRecord(s: { wins: number; losses: number; ties: number }): string {
  return s.ties > 0 ? `${s.wins}-${s.losses}-${s.ties}` : `${s.wins}-${s.losses}`;
}

function openStint(
  stints: readonly CareerStint[],
  teamId: string,
  role: CareerStint['role'],
): CareerStint | undefined {
  return stints.find((s) => s.toSeason === null && s.teamId === teamId && s.role === role);
}

function lastClosedStint(stints: readonly CareerStint[]): CareerStint | undefined {
  return [...stints]
    .filter((s) => s.toSeason !== null)
    .sort((a, b) => (b.toSeason ?? 0) - (a.toSeason ?? 0))[0];
}

export function FrontOfficePanel({ league }: { league: LeagueState }) {
  const teams = useMemo(
    () =>
      Object.values(league.teams).sort((a, b) =>
        a.identity.abbreviation.localeCompare(b.identity.abbreviation),
      ),
    [league.teams],
  );

  const carousel = useMemo(
    () => league.transactionLog.filter(isCarouselTxn).slice(-80).reverse(),
    [league.transactionLog],
  );

  const unemployedGms = useMemo(
    () => Object.values(league.gms).filter((g) => g.status === 'UNEMPLOYED'),
    [league.gms],
  );
  const unemployedHcs = useMemo(
    () => Object.values(league.coaches).filter((c) => c.status === 'UNEMPLOYED'),
    [league.coaches],
  );

  const abbr = (teamId: string): string =>
    league.teams[teamId as keyof typeof league.teams]?.identity.abbreviation ?? teamId;

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-zinc-300">
          Regimes — seat pressure is ground truth (fire at ~{FIRING_THRESHOLD})
        </h2>
        <p className="mb-3 text-xs text-zinc-500">
          Negative seat = banked credit. “His guy” = the sitting GM hired the HC (the coupling
          that decides who burns when the coach fails). Records are the stint-to-date, playoff
          appearances in parens.
        </p>
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-900 text-[10px] uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-3 py-2">Team</th>
                <th className="px-3 py-2">GM</th>
                <th className="px-3 py-2">Yr</th>
                <th className="px-3 py-2">Stint</th>
                <th className="px-3 py-2">GM seat</th>
                <th className="px-3 py-2">Flags</th>
                <th className="px-3 py-2">HC</th>
                <th className="px-3 py-2">Yr</th>
                <th className="px-3 py-2">Stint</th>
                <th className="px-3 py-2">HC seat</th>
                <th className="px-3 py-2">His guy?</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {teams.map((team) => (
                <RegimeRow key={team.identity.id} team={team} league={league} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-300">
          The Carousel — firings &amp; hirings ({carousel.length} most recent)
        </h2>
        {carousel.length === 0 ? (
          <p className="text-xs text-zinc-600">
            No front-office changes yet — sim a season; Black Monday fires the day after Week 18.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {carousel.map((t, i) => (
              <CarouselItem key={`${t.tick}-${i}`} txn={t} league={league} abbr={abbr} />
            ))}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <UnemployedList
          title={`Unemployed GMs (${unemployedGms.length}) — retread pool`}
          people={unemployedGms}
          abbr={abbr}
        />
        <UnemployedList
          title={`Unemployed HCs (${unemployedHcs.length}) — retread pool`}
          people={unemployedHcs}
          abbr={abbr}
        />
      </div>
    </div>
  );
}

function RegimeRow({ team, league }: { team: TeamState; league: LeagueState }) {
  const gm = league.gms[team.gmId];
  const hc = league.coaches[team.headCoachId];
  const fo = team.frontOffice;
  const gmYr = league.seasonNumber - fo.gmHiredSeason + 1;
  const hcYr = league.seasonNumber - fo.hcHiredSeason + 1;
  const gmStint = gm ? openStint(gm.careerStints, team.identity.id, 'GM') : undefined;
  const hcStint = hc ? openStint(hc.careerStints, team.identity.id, 'HC') : undefined;
  const hisGuy = fo.hcHiredByGmId === team.gmId;

  return (
    <tr className="hover:bg-zinc-900/40">
      <td className="px-3 py-1.5 font-semibold text-zinc-200">{team.identity.abbreviation}</td>
      <td className="px-3 py-1.5 text-zinc-300">
        {gm?.name ?? '—'}
        {fo.gmVacant && <span className="ml-1 text-red-400">(fired — seat open)</span>}
      </td>
      <td className="px-3 py-1.5 font-mono text-zinc-400">{gmYr}</td>
      <td className="px-3 py-1.5 font-mono text-zinc-400">
        {gmStint ? `${fmtRecord(gmStint)} (${gmStint.playoffAppearances}p)` : '—'}
      </td>
      <td className={`px-3 py-1.5 font-mono ${seatClasses(fo.seatPressure.gm)}`}>
        {fmtSeat(fo.seatPressure.gm)}
      </td>
      <td className="px-3 py-1.5 text-[10px]">
        {fo.gmLameDuck && (
          <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-red-300">LAME DUCK</span>
        )}
        {fo.gmCoachFiringsSurvived > 0 && (
          <span className="ml-1 rounded bg-zinc-700/40 px-1.5 py-0.5 text-zinc-400">
            survived {fo.gmCoachFiringsSurvived} HC firing{fo.gmCoachFiringsSurvived > 1 ? 's' : ''}
          </span>
        )}
      </td>
      <td className="px-3 py-1.5 text-zinc-300">
        {hc?.name ?? '—'}
        {fo.hcVacant && <span className="ml-1 text-red-400">(fired — seat open)</span>}
      </td>
      <td className="px-3 py-1.5 font-mono text-zinc-400">{hcYr}</td>
      <td className="px-3 py-1.5 font-mono text-zinc-400">
        {hcStint ? `${fmtRecord(hcStint)} (${hcStint.playoffAppearances}p)` : '—'}
      </td>
      <td className={`px-3 py-1.5 font-mono ${seatClasses(fo.seatPressure.hc)}`}>
        {fmtSeat(fo.seatPressure.hc)}
      </td>
      <td className="px-3 py-1.5 text-zinc-400">{hisGuy ? '✓' : 'inherited'}</td>
    </tr>
  );
}

function CarouselItem({
  txn,
  league,
  abbr,
}: {
  txn: CarouselTxn;
  league: LeagueState;
  abbr: (teamId: string) => string;
}) {
  const team = abbr(txn.teamId);
  let body: string;
  let tone: string;
  switch (txn.kind) {
    case 'hc-fired': {
      const name = league.coaches[txn.coachId]?.name ?? txn.coachId;
      const ownHire =
        txn.ownHireIndex === 0
          ? 'inherited'
          : txn.ownHireIndex === 1
            ? "GM's hire #1"
            : `GM's hire #${txn.ownHireIndex}`;
      body = `${team} fire HC ${name} — ${txn.seasonsServed}yr, ${fmtRecord(txn)} (${ownHire}, GM yr ${txn.gmTenureSeasons}, seat ${txn.seatPressure.toFixed(0)})${txn.jointWithGm ? ' — CLEAN HOUSE' : ''}`;
      tone = txn.jointWithGm ? 'text-red-300' : 'text-amber-300';
      break;
    }
    case 'gm-fired': {
      const name = league.gms[txn.gmId]?.name ?? txn.gmId;
      body = `${team} fire GM ${name} — ${txn.seasonsServed}yr, ${fmtRecord(txn)} (seat ${txn.seatPressure.toFixed(0)})${txn.jointWithHc ? ' — with his coach' : ' — GM-only'}`;
      tone = 'text-red-300';
      break;
    }
    case 'hc-hired': {
      const name = league.coaches[txn.coachId]?.name ?? txn.coachId;
      body = `${team} hire HC ${name}${txn.retread ? ' (retread)' : ' (first-time HC)'}`;
      tone = 'text-emerald-300';
      break;
    }
    case 'gm-hired': {
      const name = league.gms[txn.gmId]?.name ?? txn.gmId;
      body = `${team} hire GM ${name}${txn.retread ? ' (retread)' : ' (first-time GM)'}`;
      tone = 'text-emerald-300';
      break;
    }
  }
  return (
    <li className="flex items-baseline gap-2 text-xs">
      <span className="shrink-0 font-mono text-[10px] text-zinc-600">S{txn.seasonNumber}</span>
      <span className={tone}>{body}</span>
    </li>
  );
}

function UnemployedList({
  title,
  people,
  abbr,
}: {
  title: string;
  people: readonly (Gm | HeadCoach)[];
  abbr: (teamId: string) => string;
}) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-zinc-300">{title}</h2>
      {people.length === 0 ? (
        <p className="text-xs text-zinc-600">Nobody on the street yet.</p>
      ) : (
        <ul className="space-y-1 text-xs text-zinc-400">
          {people.map((p) => {
            const last = lastClosedStint(p.careerStints);
            return (
              <li key={p.id} className="flex items-baseline gap-2">
                <span className="text-zinc-300">{p.name}</span>
                {last ? (
                  <span className="font-mono text-[11px] text-zinc-500">
                    last: {abbr(last.teamId)} S{last.fromSeason}–{last.toSeason} {fmtRecord(last)}
                    {last.championships > 0 ? ` 🏆×${last.championships}` : ''} ·{' '}
                    {last.end?.toLowerCase().replace(/_/g, ' ')}
                  </span>
                ) : (
                  <span className="text-[11px] text-zinc-600">no recorded stint</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
