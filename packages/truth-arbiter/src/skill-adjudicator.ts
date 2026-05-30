import { auditLeague, type AuditPlayer } from './engine-bridge.js';

/**
 * The Skill Adjudicator — the talent-tier + accolade guardrail.
 *
 * Audits the engine's 8-tier talent-grade distribution (overall + by position
 * group) against the locked design targets, and (in sim mode) the per-season
 * Pro Bowl / All-Pro rates. Run it after any generation or development tweak
 * to confirm we stayed inside the guardrails — e.g. "you're now minting 7
 * ELITE QBs; the target is ~1-2".
 *
 *   pnpm --filter @gmsim/truth-arbiter run adjudicate          # generated dist (fast)
 *   pnpm --filter @gmsim/truth-arbiter run adjudicate sim [N]  # post-development + accolades
 */

const GRADE_ORDER = [
  'ELITE', 'STAR', 'HIGH_STARTER', 'STARTER', 'WEAK_STARTER', 'ROTATIONAL', 'BACKUP', 'FRINGE',
] as const;

/** Design-target distribution (% of the generated talent pool). */
const TARGET_PCT: Record<string, number> = {
  ELITE: 1, STAR: 4, HIGH_STARTER: 13, STARTER: 22, WEAK_STARTER: 18, ROTATIONAL: 22, BACKUP: 12, FRINGE: 8,
};
const DRIFT_FLAG_PP = 3;

/** Per-season accolade targets (mirror real NFL counts). */
const ACCOLADE_TARGET: Record<string, number> = { PRO_BOWL: 91, ALL_PRO_1ST: 27, ALL_PRO_2ND: 25 };

const GROUP_ORDER = ['QB', 'SKILL', 'OL', 'DL', 'LB', 'DB', 'ST'];

function distribution(players: AuditPlayer[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of players) counts[p.talentGrade] = (counts[p.talentGrade] ?? 0) + 1;
  return counts;
}

function printGradeTable(players: AuditPlayer[], compareTarget: boolean): void {
  const counts = distribution(players);
  const n = players.length || 1;
  console.log(
    `  ${'grade'.padEnd(13)} ${'count'.padStart(6)} ${'pct'.padStart(7)}` + (compareTarget ? ` ${'target'.padStart(7)} ${'Δpp'.padStart(7)}` : ''),
  );
  for (const g of GRADE_ORDER) {
    const c = counts[g] ?? 0;
    const pct = (c / n) * 100;
    let line = `  ${g.padEnd(13)} ${String(c).padStart(6)} ${pct.toFixed(1).padStart(7)}`;
    if (compareTarget) {
      const t = TARGET_PCT[g] ?? 0;
      const d = pct - t;
      const flag = Math.abs(d) >= DRIFT_FLAG_PP ? `  <-- DRIFT` : '';
      line += ` ${t.toFixed(1).padStart(7)} ${d.toFixed(1).padStart(7)}${flag}`;
    }
    console.log(line);
  }
}

async function main(): Promise<void> {
  const sim = process.argv[2] === 'sim';
  const years = sim ? Number(process.argv[3]) || 6 : 0;

  if (sim) console.log(`\nForward-simulating ${years} seasons (post-development audit)…`);
  const audit = await auditLeague('adjudicator', years);

  console.log(
    `\n=== Skill Adjudicator — talent-grade distribution ` +
      `(${sim ? `rostered after ${years}-season development` : 'freshly generated'}) ===`,
  );
  // Compare to the design target only for the freshly-generated pool; after
  // development + roster selection the league is a selected subset.
  printGradeTable(audit.players, !sim);

  // Per-group top-tier population — the "how many elites/stars exist" guardrail.
  console.log(`\n  top-tier population by group (ELITE / STAR):`);
  for (const grp of GROUP_ORDER) {
    const gp = audit.players.filter((p) => p.positionGroup === grp);
    const elite = gp.filter((p) => p.talentGrade === 'ELITE').length;
    const star = gp.filter((p) => p.talentGrade === 'STAR').length;
    console.log(`    ${grp.padEnd(6)} ${String(elite).padStart(3)} ELITE  ${String(star).padStart(3)} STAR   (${gp.length} rostered)`);
  }

  if (sim) {
    console.log(`\n=== per-season accolades vs target ===`);
    console.log(`  ${'award'.padEnd(13)} ${'per-yr'.padStart(7)} ${'target'.padStart(7)} ${'Δ'.padStart(7)}`);
    for (const k of Object.keys(ACCOLADE_TARGET)) {
      const perYr = (audit.accolades[k] ?? 0) / years;
      const t = ACCOLADE_TARGET[k]!;
      const flag = Math.abs(perYr - t) > t * 0.2 ? `  <-- DRIFT` : '';
      console.log(`  ${k.padEnd(13)} ${perYr.toFixed(0).padStart(7)} ${String(t).padStart(7)} ${(perYr - t).toFixed(0).padStart(7)}${flag}`);
    }
  }
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
