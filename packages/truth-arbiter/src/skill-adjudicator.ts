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

// ── Rating-ceiling realism (Daniel 2026-06-02) ───────────────────────────
// The engine rolls each player's hidden attribute CEILINGS independently, so
// the count of "can hit 99" players scales with the pool — nothing enforces
// real-world scarcity. Anchors:
//   • Madden NFL 26 (~2,035 players): ~5 at 99 OVR (~0.25%); exactly ONE
//     player at 99 SPEED (Tyreek Hill), a handful at 97-98. A literal 99 in
//     any single attribute is league-unique-rare.
//   • PFF grade scale (per-facet): mean ~65, sd ~8, Elite 90+ (~0.1%).
// So only a tiny fixed handful of players should be CAPABLE of a 99 in a
// given attribute — "not everyone can be the fastest player in the league."
// These are per-1,000-player rates so they scale with pool size. Ceilings
// (potential) get head-room over Madden's realized counts; the `current`
// table in sim mode is the Madden-comparable one.
const PER1K_99_TARGET = 1.5; // ceiling == 99 per 1,000 players
const PER1K_97_TARGET = 6;
const PER1K_95_TARGET = 15;
const ANY99_PCT_TARGET = 1.0; // % of pool allowed ANY maxed (99) attribute

type SkillField = 'ceiling' | 'current';

interface AttrTail {
  attr: string;
  n99: number;
  n97: number;
  n95: number;
  mean: number;
  sd: number;
}

function attrTails(players: AuditPlayer[], field: SkillField): AttrTail[] {
  if (players.length === 0) return [];
  const keys = Object.keys(players[0]![field]);
  const rows: AttrTail[] = [];
  for (const attr of keys) {
    let n99 = 0;
    let n97 = 0;
    let n95 = 0;
    let sum = 0;
    let sumsq = 0;
    let n = 0;
    for (const p of players) {
      const v = p[field][attr];
      if (v === undefined) continue;
      n++;
      sum += v;
      sumsq += v * v;
      if (v >= 99) n99++;
      if (v >= 97) n97++;
      if (v >= 95) n95++;
    }
    const mean = n ? sum / n : 0;
    const sd = n ? Math.sqrt(Math.max(0, sumsq / n - mean * mean)) : 0;
    rows.push({ attr, n99, n97, n95, mean, sd });
  }
  rows.sort((a, b) => b.n99 - a.n99 || b.n97 - a.n97 || b.n95 - a.n95);
  return rows;
}

function printCeilingRealism(players: AuditPlayer[], field: SkillField, label: string): void {
  const N = players.length || 1;
  const per1k = (c: number): number => (c / N) * 1000;

  let anyMax = 0;
  for (const p of players) {
    if (Object.values(p[field]).some((v) => v >= 99)) anyMax++;
  }
  const anyPct = (anyMax / N) * 100;

  console.log(`\n=== Rating ${field} realism — ${label} (${players.length} players) ===`);
  console.log(
    `  anchor: Madden ~1 player at 99 SPD / 2035; ~5 at 99 OVR (~0.25%). PFF facet mean~65 sd~8.`,
  );
  console.log(
    `  players with ANY ${field}==99 attribute: ${anyMax} (${anyPct.toFixed(1)}%)` +
      `  [target ≲ ${ANY99_PCT_TARGET}%]${anyPct > ANY99_PCT_TARGET ? '  <-- TOO MANY' : ''}`,
  );

  const rows = attrTails(players, field).filter((r) => r.n95 > 0);
  console.log(
    `\n  per-attribute scarcity — worst first; flag = ${field}==99 over ${PER1K_99_TARGET}/1k` +
      ` (≥97 ${PER1K_97_TARGET}/1k, ≥95 ${PER1K_95_TARGET}/1k):`,
  );
  console.log(
    `  ${'attr'.padEnd(18)} ${'99'.padStart(5)} ${'>=97'.padStart(5)} ${'>=95'.padStart(5)}` +
      ` ${'99/1k'.padStart(7)} ${'mean'.padStart(6)} ${'sd'.padStart(5)}`,
  );
  for (const r of rows) {
    const p99 = per1k(r.n99);
    const flag = p99 > PER1K_99_TARGET ? '  <-- TOO MANY' : '';
    console.log(
      `  ${r.attr.padEnd(18)} ${String(r.n99).padStart(5)} ${String(r.n97).padStart(5)}` +
        ` ${String(r.n95).padStart(5)} ${p99.toFixed(1).padStart(7)} ${r.mean.toFixed(1).padStart(6)}` +
        ` ${r.sd.toFixed(1).padStart(5)}${flag}`,
    );
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

  // Rating-ceiling realism — the "not everyone can be the fastest" guardrail.
  // Ceilings are the generation knob (audited in both modes); current is the
  // realized, Madden-comparable distribution (sim mode only).
  printCeilingRealism(
    audit.players,
    'ceiling',
    sim ? `ceilings, rostered after ${years} seasons` : 'freshly generated',
  );
  if (sim) {
    printCeilingRealism(audit.players, 'current', `realized after ${years} seasons (Madden-comparable)`);
  }

  if (sim) {
    // Use the final season's named accolades — the per-season total averaged
    // over the whole sim undercounts because players who retired/were purged
    // no longer carry their awards in the league.
    console.log(`\n=== final-season accolades vs target ===`);
    console.log(`  ${'award'.padEnd(13)} ${'named'.padStart(7)} ${'target'.padStart(7)} ${'Δ'.padStart(7)}`);
    for (const k of Object.keys(ACCOLADE_TARGET)) {
      const named = audit.lastSeasonAccolades[k] ?? 0;
      const t = ACCOLADE_TARGET[k]!;
      const flag = Math.abs(named - t) > t * 0.2 ? `  <-- DRIFT` : '';
      console.log(`  ${k.padEnd(13)} ${String(named).padStart(7)} ${String(t).padStart(7)} ${(named - t).toFixed(0).padStart(7)}${flag}`);
    }
  }
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
