/**
 * Game View — the player-facing scouting report, rendered EXCLUSIVELY from the
 * knowledge layer (`@gmsim/engine/knowledge` → `ProspectSnapshot`).
 *
 * This component is the North Star boundary's proof: its only data prop is a
 * `ProspectSnapshot`, so it structurally cannot read ground truth, numeric
 * ratings, bands, or perceived grades — none of that exists on the type. What
 * it shows is what the GAME would show: public record (size, combine, college
 * production, injuries) plus attributed, qualitative, source-bylined reads.
 *
 * Keep it that way: if this view ever needs more, extend the knowledge layer
 * (`packages/engine/src/knowledge`) — do not widen the props.
 */

import type { ProspectSnapshot, AttributedRemark } from '@gmsim/engine';
import { getSchoolById, positionGroupFor } from '@gmsim/engine';
import type { ClassYear, CollegeSeasonStats } from '@gmsim/engine/types';

const CLASS_YEAR_LABELS: Record<ClassYear, string> = {
  TRUE_FR: 'True FR',
  RS_FR: 'RS FR',
  SO: 'SO',
  JR: 'JR',
  SR: 'SR',
  RS_SR: 'RS SR',
};

function formatHeight(inches: number): string {
  const ft = Math.floor(inches / 12);
  const rest = Math.round((inches - ft * 12) * 8) / 8;
  return `${ft}'${rest}"`;
}

function formatInches(inches: number): string {
  return `${(Math.round(inches * 8) / 8).toFixed(2).replace(/\.?0+$/, '')}"`;
}

/** One compact production line per college season, keyed to the position group. */
function statLine(pos: ProspectSnapshot['projectedPosition'], s: CollegeSeasonStats): string {
  const group = positionGroupFor(pos);
  switch (group) {
    case 'QB':
      return `${s.passingYards.toLocaleString()} pass yds · ${s.passingTds} TD / ${s.interceptionsThrown} INT · ${s.rushingYards} rush`;
    case 'SKILL':
      return pos === 'RB' || pos === 'FB'
        ? `${s.rushingYards.toLocaleString()} rush yds · ${s.rushingTds} TD · ${s.receptions} rec, ${s.receivingYards} yds`
        : `${s.receptions} rec · ${s.receivingYards.toLocaleString()} yds · ${s.receivingTds} TD`;
    case 'OL':
      return `${s.games} games · ${s.starts} starts`;
    default:
      return `${s.tackles} tkl · ${s.sacks} sk · ${s.interceptions} INT · ${s.passesDefended} PD`;
  }
}

const CONFIDENCE_STYLE: Record<AttributedRemark['confidence'], string> = {
  firm: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  moderate: 'border-zinc-600/40 bg-zinc-700/20 text-zinc-300',
  tentative: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
};

function RemarkList({
  title,
  remarks,
  accent,
}: {
  title: string;
  remarks: readonly AttributedRemark[];
  accent: 'pro' | 'con';
}) {
  if (remarks.length === 0) return null;
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">{title}</div>
      <ul className="space-y-1">
        {remarks.map((r, i) => (
          <li key={`${r.sourceId}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
            <span className={accent === 'pro' ? 'text-emerald-200' : 'text-rose-200'}>
              {r.text.charAt(0).toUpperCase() + r.text.slice(1)}.
            </span>
            <span className="text-[10px] text-zinc-500">— {r.sourceName}</span>
            <span
              className={`rounded border px-1 text-[9px] uppercase tracking-wider ${CONFIDENCE_STYLE[r.confidence]}`}
              title="How firmly the source holds this read. You learn whom to trust by watching who turns out right."
            >
              {r.confidence}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The report card a player (GM) would actually see. Data prop is the
 * knowledge-layer snapshot and nothing else.
 */
export function GameViewReport({ snapshot }: { snapshot: ProspectSnapshot }) {
  const s = snapshot;
  const school = getSchoolById(s.schoolId);
  const m = s.measurables;
  const combine = m.combine;

  return (
    <div className="rounded border border-emerald-500/30 bg-zinc-950/60">
      {/* Header — identity is public record. */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-800 bg-emerald-500/5 px-3 py-2">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span className="text-base font-semibold text-zinc-100">
            {s.firstName} {s.lastName}
          </span>
          <span className="flex items-baseline gap-1">
            <span className="text-emerald-300">{s.projectedPosition}</span>
            {s.isPerceivedConversion && (
              <span
                className="rounded border border-violet-500/40 bg-violet-500/10 px-1 text-[10px] uppercase tracking-wide text-violet-300"
                title={`Our evaluators project a move off his college spot (${s.collegePosition} → ${s.projectedPosition}).`}
              >
                conv ← {s.collegePosition}
              </span>
            )}
          </span>
          <span className="text-zinc-400">
            {school?.name ?? s.schoolId} · {CLASS_YEAR_LABELS[s.classYear]}
          </span>
          <span className="text-zinc-500">
            age {s.ageYears} · {formatHeight(m.heightInches)}, {Math.round(m.weightLbs)} lb
          </span>
        </div>
        <span
          className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-emerald-300"
          title="Rendered from the knowledge layer only — every claim below is attributed to a source. No ratings, no ground truth."
        >
          game view
        </span>
      </div>

      {/* Byline */}
      <div className="border-b border-zinc-800/60 px-3 py-1 text-[11px] text-zinc-500">
        <span className="text-zinc-300">{s.viewerLabel}</span>
        {' · report by '}
        <span className="text-emerald-300">{s.bylineSourceName}</span>
        {' · '}
        {s.observationCount} {s.observationCount === 1 ? 'read' : 'reads'} on file
        {m.proDayAttendedByViewer === true && (
          <span className="ml-2 rounded border border-teal-500/30 bg-teal-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-teal-300">
            attended pro day
          </span>
        )}
      </div>

      <div className="space-y-3 p-3 text-xs">
        {/* The write-up IS the evaluation — prose, not numbers. */}
        <p className="leading-relaxed text-zinc-200">{s.writeup}</p>

        <RemarkList title="Strengths" remarks={s.strengths} accent="pro" />
        <RemarkList title="Concerns" remarks={s.concerns} accent="con" />

        {/* Scheme fit — one qualitative line. */}
        <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2 text-zinc-300">
          <span className="mr-2 text-[10px] uppercase tracking-wider text-zinc-500">Scheme fit</span>
          {s.schemeFit}
        </div>

        {/* Verified measurables — public record (combine numbers are televised). */}
        <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Verified measurables</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[11px] text-zinc-300 sm:grid-cols-3 lg:grid-cols-6">
            <span>HT {formatHeight(m.heightInches)}</span>
            <span>WT {Math.round(m.weightLbs)} lb</span>
            <span>ARM {formatInches(m.armLengthInches)}</span>
            <span>HAND {formatInches(m.handSizeInches)}</span>
            {combine?.fortyYardSeconds !== undefined && <span>40YD {combine.fortyYardSeconds.toFixed(2)}s</span>}
            {combine?.verticalInches !== undefined && <span>VERT {formatInches(combine.verticalInches)}</span>}
            {combine?.benchPress225Reps !== undefined && <span>BENCH {combine.benchPress225Reps}</span>}
            {combine?.threeConeSeconds !== undefined && <span>3CONE {combine.threeConeSeconds.toFixed(2)}s</span>}
          </div>
          {!combine && <div className="mt-1 text-[10px] text-zinc-600">No combine numbers on file.</div>}
        </div>

        {/* College production — public record. */}
        {s.collegeStats.length > 0 && (
          <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">College production</div>
            <ul className="space-y-0.5 font-mono text-[11px] text-zinc-300">
              {s.collegeStats.map((cs, i) => (
                <li key={i}>
                  <span className="mr-2 text-zinc-500">{CLASS_YEAR_LABELS[cs.classYear]}</span>
                  {statLine(s.projectedPosition, cs)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Injuries — public record. */}
        {s.injuries.length > 0 && (
          <div className="rounded border border-rose-500/20 bg-zinc-950/40 p-2">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Injury history</div>
            <ul className="space-y-0.5 text-[11px] text-rose-200/80">
              {s.injuries.map((inj, i) => (
                <li key={i}>
                  {inj.label} — {CLASS_YEAR_LABELS[inj.classYear]} ({inj.severity.toLowerCase()},{' '}
                  {inj.gamesMissed} games missed)
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
