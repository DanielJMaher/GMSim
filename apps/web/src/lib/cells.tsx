/**
 * Small shared display components used across multiple tabs: a
 * truth-vs-combine measurable cell (Draft, Scout Reports), a
 * perceived/real grade pair (Draft, Draft Shift, Scout Reports), and a
 * contract terms summary table (News, League). Split out of App.tsx —
 * pure code motion, no behavior change.
 */
import { signingBonusProrationPerYear, draftGradeFromOverall, draftGradeLabel, formatDraftGrade } from '@gmsim/engine';
import type { Contract } from '@gmsim/engine/types';

export function MeasureCell({
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
export function ContractTermsTable({ contract }: { contract: Contract }) {
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

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <div className="font-mono text-zinc-300">{value}</div>
    </div>
  );
}
export function GradeCell({
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
export function DraftGradeCell({
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
