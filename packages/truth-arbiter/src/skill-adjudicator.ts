import { auditLeague, type AuditPlayer, type AthleticBaseline } from './engine-bridge.js';

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
// % of pool allowed to have ANY maxed (99) attribute. These are CEILINGS
// (potential) across ~70 attributes, so this compounds: even at a Madden-like
// per-attribute 99 rate (~1.5/1k) a few % of players will have one 99-potential
// trait (the burner, the cannon arm, the mauler). Realized `current` (sim mode)
// is the stricter, Madden-comparable check. Per-attribute PER1K_99_TARGET is the
// strict guard; this headline is the compounded ceiling expectation.
const ANY99_PCT_TARGET = 4.0;

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

// ── Linked-rating (attribute-correlation) realism (Daniel 2026-06-02) ─────
// The engine rolls every attribute independently (`prng.normal` per skill), so
// within a talent grade there's ~zero correlation between linked ratings — a
// 99-speed / 75-acceleration player is common, which is unrealistic.
// Real-world basis (Madden School / combine): the 40-yard dash drives BOTH
// Speed and Acceleration; the 3-cone couples Acceleration+Agility; the 20-yd
// shuttle couples Agility+Change-of-Direction → those four form one tightly
// correlated "athleticism" cluster. Other skill families cluster similarly
// (a QB accurate short is usually accurate medium; a rusher with one move has
// the family). The fix (engine) is a shared per-player latent per cluster +
// a small idiosyncratic perturbation; this audit measures whether the linkage
// is there. Targets are mean pairwise Pearson r WITHIN the relevant position
// group (so grade structure isn't the only thing creating correlation).
interface CorrCluster {
  name: string;
  attrs: readonly string[];
  groups: readonly string[];
  target: number;
}
// Targets are WITHIN-GRADE (grade-residualized) mean pairwise r — the attribute
// linkage that remains after removing the shared talent-grade factor. The engine
// currently lacks this (independent rolls → ~0 within grade); the generation fix
// adds it. KEY CALIBRATION (Daniel 2026-06-02): linkage is MODERATE on purpose —
// it must preserve individual strengths/weaknesses, not make everyone uniform:
//   • athleticism is the ONLY tight cluster (~0.7) — combine tests are
//     physically linked regardless of overall grade.
//   • pass-rush is SPLIT: fundamentals (get-off / bend / hands) modestly link,
//     but the named MOVES link only loosely — rushers have go-to moves and are
//     bad at others; we must NOT make every finesse rusher good at every move.
//   • coverage EXCLUDES ballSkills — elite coverage ≠ INT production (Sauce
//     Gardner covers great, picks few). man vs zone also diverge (great zone /
//     poor man), so the target is moderate.
//   • qb-accuracy is loose — QBs have hot/cold zones (great deep-right, poor
//     deep-left; JJ McCarthy), so accuracy cells must be allowed to diverge.
//   • receiving-hands is loose — reliable hands can still be bad in
//     traffic / contested.
// ballSkills, tackling, ball-carrier, mental, ST etc. are intentionally NOT yet
// clustered (open scope) — and strength↔speed should be NEGATIVE (size), which a
// within-cluster positive model doesn't capture.
const CORR_CLUSTERS: readonly CorrCluster[] = [
  { name: 'athleticism', groups: ['SKILL', 'DB'], target: 0.7,
    attrs: ['speed', 'acceleration', 'agility', 'changeOfDirection'] },
  { name: 'qb-accuracy', groups: ['QB'], target: 0.4,
    attrs: ['accuracyShort', 'accuracyMedium', 'accuracyDeep', 'accuracyLeft', 'accuracyMiddle', 'accuracyRight'] },
  { name: 'pass-rush-fundamentals', groups: ['DL', 'LB'], target: 0.45,
    attrs: ['getOff', 'bend', 'handTechnique'] },
  { name: 'pass-rush-moves', groups: ['DL', 'LB'], target: 0.25,
    attrs: ['bullRush', 'longArm', 'pushPull', 'swimMove', 'ripMove', 'spinRush', 'crossChop', 'ghostMove'] },
  { name: 'coverage', groups: ['DB', 'LB'], target: 0.4,
    attrs: ['manCoverage', 'zoneCoverage', 'pressCoverage'] },
  { name: 'blocking', groups: ['OL'], target: 0.5,
    attrs: ['runBlockPower', 'runBlockFinesse', 'passBlockPower', 'passBlockFinesse', 'impactBlock', 'leadBlock'] },
  { name: 'receiving-hands', groups: ['SKILL'], target: 0.4,
    attrs: ['catching', 'catchInTraffic', 'contestedCatch'] },
  { name: 'route-running', groups: ['SKILL'], target: 0.55,
    attrs: ['routeShort', 'routeMedium', 'routeDeep'] },
];
const CORR_FLAG_SLACK = 0.15; // flag when within-grade r is this far below target

function pearson(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  if (n < 3) return NaN;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
  }
  const cov = sxy - (sx * sy) / n;
  const vx = sxx - (sx * sx) / n;
  const vy = syy - (sy * sy) / n;
  const d = Math.sqrt(vx * vy);
  return d === 0 ? NaN : cov / d;
}

/**
 * Per-(grade, attr) mean for grade-residualization. Subtracting it isolates
 * within-tier attribute linkage from the shared talent-grade factor (which on
 * its own makes every attribute correlate ~0.65).
 */
function gradeMeans(
  players: AuditPlayer[],
  attrs: readonly string[],
  field: SkillField,
): Map<string, Map<string, number>> {
  const acc = new Map<string, Map<string, { sum: number; n: number }>>();
  for (const p of players) {
    let byAttr = acc.get(p.talentGrade);
    if (!byAttr) {
      byAttr = new Map();
      acc.set(p.talentGrade, byAttr);
    }
    for (const a of attrs) {
      const v = p[field][a];
      if (v === undefined) continue;
      const cur = byAttr.get(a) ?? { sum: 0, n: 0 };
      cur.sum += v;
      cur.n += 1;
      byAttr.set(a, cur);
    }
  }
  const out = new Map<string, Map<string, number>>();
  for (const [g, byAttr] of acc) {
    const m = new Map<string, number>();
    for (const [a, s] of byAttr) m.set(a, s.n ? s.sum / s.n : 0);
    out.set(g, m);
  }
  return out;
}

/** Mean pairwise within-grade Pearson r across a cluster's attributes. */
function meanPairwiseCorr(players: AuditPlayer[], attrs: readonly string[], field: SkillField): number {
  const gm = gradeMeans(players, attrs, field);
  const resid = (p: AuditPlayer, a: string): number | undefined => {
    const v = p[field][a];
    if (v === undefined) return undefined;
    return v - (gm.get(p.talentGrade)?.get(a) ?? v);
  };
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < attrs.length; i++) {
    for (let j = i + 1; j < attrs.length; j++) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (const p of players) {
        const x = resid(p, attrs[i]!);
        const y = resid(p, attrs[j]!);
        if (x === undefined || y === undefined) continue;
        xs.push(x);
        ys.push(y);
      }
      const r = pearson(xs, ys);
      if (!Number.isNaN(r)) {
        sum += r;
        pairs++;
      }
    }
  }
  return pairs ? sum / pairs : NaN;
}

function printCorrelationRealism(players: AuditPlayer[], field: SkillField, label: string): void {
  console.log(`\n=== Linked-rating realism — ${field}, ${label} ===`);
  console.log(`  within-GRADE mean pairwise Pearson r (grade factor removed) per cluster's position group(s).`);
  console.log(`  ${'cluster'.padEnd(22)} ${'grp'.padStart(8)} ${'n'.padStart(5)} ${'attrs'.padStart(6)} ${'r'.padStart(7)} ${'target'.padStart(7)}`);
  for (const c of CORR_CLUSTERS) {
    const pop = players.filter((p) => c.groups.includes(p.positionGroup));
    const r = meanPairwiseCorr(pop, c.attrs, field);
    const flag = !Number.isNaN(r) && r < c.target - CORR_FLAG_SLACK ? '  <-- TOO LOOSE' : '';
    console.log(
      `  ${c.name.padEnd(22)} ${c.groups.join('+').padStart(8)} ${String(pop.length).padStart(5)}` +
        ` ${String(c.attrs.length).padStart(6)} ${(Number.isNaN(r) ? 'n/a' : r.toFixed(2)).padStart(7)}` +
        ` ${c.target.toFixed(2).padStart(7)}${flag}`,
    );
  }
  // Marquee example: speed vs acceleration (Daniel's "99 speed / 75 accel"),
  // grade-residualized like the clusters above.
  const speedPop = players.filter((p) => ['SKILL', 'DB'].includes(p.positionGroup));
  const sr = meanPairwiseCorr(speedPop, ['speed', 'acceleration'], field);
  console.log(
    `  speed↔acceleration (SKILL+DB, within-grade): r=${Number.isNaN(sr) ? 'n/a' : sr.toFixed(2)}` +
      ` (real: tightly linked even within a tier, ~0.7+)`,
  );
}

// ── Expected NON-linkage: anti-correlations + independence (Daniel 2026-06-02)
// Some pairs should NOT move together. Two guardrails, especially for after the
// generation fix lands (so we don't over-link):
//   • strength↔speed should be NEGATIVE — big strong players (DT/OL) are slow,
//     fast players (CB/WR) are light. Measured RAW across ALL positions (the
//     tradeoff is positional/size-driven, not within-tier), expect r ≲ -0.2.
//   • ballSkills↔coverage should be ~INDEPENDENT — Sauce Gardner covers elite
//     but picks few. Measured within-grade among DB+LB; flag if |r| drifts high.
interface RelationCheck {
  name: string;
  kind: 'negative' | 'independent';
  a: string;
  b: readonly string[];
  groups: readonly string[] | 'ALL';
  residualize: boolean;
  bound: number;
}
const RELATION_CHECKS: readonly RelationCheck[] = [
  { name: 'strength↔speed', kind: 'negative', a: 'strength', b: ['speed'], groups: 'ALL', residualize: false, bound: -0.2 },
  { name: 'ballSkills↔coverage', kind: 'independent', a: 'ballSkills', b: ['manCoverage', 'zoneCoverage', 'pressCoverage'], groups: ['DB', 'LB'], residualize: true, bound: 0.3 },
];

/** Mean Pearson r of attribute `a` against each of `bs` (grade-residualized if asked). */
function corrOneToMany(
  players: AuditPlayer[],
  a: string,
  bs: readonly string[],
  field: SkillField,
  residualize: boolean,
): number {
  const gm = residualize ? gradeMeans(players, [a, ...bs], field) : null;
  const val = (p: AuditPlayer, k: string): number | undefined => {
    const v = p[field][k];
    if (v === undefined) return undefined;
    return gm ? v - (gm.get(p.talentGrade)?.get(k) ?? v) : v;
  };
  let sum = 0;
  let pairs = 0;
  for (const b of bs) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const p of players) {
      const x = val(p, a);
      const y = val(p, b);
      if (x === undefined || y === undefined) continue;
      xs.push(x);
      ys.push(y);
    }
    const r = pearson(xs, ys);
    if (!Number.isNaN(r)) {
      sum += r;
      pairs++;
    }
  }
  return pairs ? sum / pairs : NaN;
}

function printRelationChecks(players: AuditPlayer[], field: SkillField): void {
  console.log(`\n=== Expected NON-linkage — ${field} ===`);
  console.log(`  pairs that should be negative or independent (guardrails the fix must not violate).`);
  console.log(`  ${'relation'.padEnd(22)} ${'kind'.padStart(12)} ${'n'.padStart(5)} ${'r'.padStart(7)} ${'expected'.padStart(12)}`);
  for (const c of RELATION_CHECKS) {
    const pop = c.groups === 'ALL' ? players : players.filter((p) => c.groups.includes(p.positionGroup));
    const r = corrOneToMany(pop, c.a, c.b, field, c.residualize);
    let flag = '';
    let expected = '';
    if (c.kind === 'negative') {
      expected = `r <= ${c.bound.toFixed(2)}`;
      if (Number.isNaN(r) || r > c.bound) flag = '  <-- NOT NEGATIVE ENOUGH';
    } else {
      expected = `|r| <= ${c.bound.toFixed(2)}`;
      if (!Number.isNaN(r) && Math.abs(r) > c.bound) flag = '  <-- SPURIOUSLY LINKED';
    }
    console.log(
      `  ${c.name.padEnd(22)} ${c.kind.padStart(12)} ${String(pop.length).padStart(5)}` +
        ` ${(Number.isNaN(r) ? 'n/a' : r.toFixed(2)).padStart(7)} ${expected.padStart(12)}${flag}`,
    );
  }
}

// ── RAS realism: per-position athletic distributions (Slice 3c) ───────────
// Closes the loop on the size/athletics work: do GENERATED players land on the
// real per-position athletic baselines (CB fast, DT slow/strong)? Compares each
// position's generated mean physical ceiling to the engine's combine-derived
// target (athletic-baselines.ts ← nflverse, the data RAS is built on). Drift
// here means generation broke the position differentiation. The cross-position
// strength↔speed tradeoff is covered by the NON-linkage check above; this is
// the per-position detail.
const ATHLETIC_ATTRS = ['speed', 'acceleration', 'agility', 'changeOfDirection', 'jumping', 'strength'] as const;
const ATHLETIC_DRIFT_FLAG = 5; // points of |generated mean − target|

function printPositionAthleticRealism(
  players: AuditPlayer[],
  targets: Record<string, AthleticBaseline>,
): void {
  const byPos = new Map<string, AuditPlayer[]>();
  for (const p of players) {
    const b = byPos.get(p.position);
    if (b) b.push(p);
    else byPos.set(p.position, [p]);
  }
  // Fastest target first, so the speed gradient reads top-to-bottom.
  const positions = [...byPos.keys()]
    .filter((pos) => targets[pos])
    .sort((a, b) => (targets[b]!.speed) - (targets[a]!.speed));

  console.log(`\n=== RAS realism — per-position athletic means (generated ceiling vs combine target) ===`);
  console.log(`  flag = |gen − target| > ${ATHLETIC_DRIFT_FLAG}. Confirms position differentiation (CB fast, DT slow/strong).`);
  console.log(`  ${'pos'.padEnd(7)} ${'N'.padStart(4)} ${ATHLETIC_ATTRS.map((a) => a.slice(0, 5).padStart(12)).join('')}`);
  for (const pos of positions) {
    const ps = byPos.get(pos)!;
    const tgt = targets[pos]!;
    let line = `  ${pos.padEnd(7)} ${String(ps.length).padStart(4)}`;
    for (const attr of ATHLETIC_ATTRS) {
      const vals = ps.map((p) => p.ceiling[attr]).filter((v): v is number => v !== undefined);
      const gen = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN;
      const t = tgt[attr];
      const flag = !Number.isNaN(gen) && Math.abs(gen - t) > ATHLETIC_DRIFT_FLAG ? '!' : ' ';
      line += `${(Number.isNaN(gen) ? '—' : `${gen.toFixed(0)}/${t.toFixed(0)}${flag}`).padStart(12)}`;
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

  // Linked-rating realism — do attributes that move together in real life
  // move together here? Audited on ceilings (the generation knob).
  printCorrelationRealism(
    audit.players,
    'ceiling',
    sim ? `rostered after ${years} seasons` : 'freshly generated',
  );
  printRelationChecks(audit.players, 'ceiling');
  printPositionAthleticRealism(audit.players, audit.athleticTargets);

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
