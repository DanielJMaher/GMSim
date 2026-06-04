import { readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CORPUS_PATH, PACKAGE_ROOT } from '../lib/config.js';
import {
  newEvalCtx,
  draftOneClass,
  group,
  GROUP_ORDER,
  mean,
  stdev,
  gradeOf,
  type EvalCtx,
} from './class-build.js';
import type { Corpus, DraftPickRecord } from '../lib/types.js';
import type { GeneratedProspect } from '../lib/engine-bridge.js';

/**
 * Per-class realism + class-to-class VARIANCE checks (6.1). Where arbiter.ts
 * scores aggregate realism, this grades a SINGLE generated class and — the key
 * capability — checks whether the generator's class-to-class variation matches
 * real year-to-year spread (deep-WR years, barren-QB years). A too-samey
 * generator is *less* realistic than one with lifelike variance.
 *
 * Also hosts the nickname registry: name a notable seed so you can re-run it
 * after generator tweaks and see how that class changed (regression tracking).
 *
 *   pnpm --filter @gmsim/truth-arbiter run class <seed|nickname>   # one class
 *   pnpm --filter @gmsim/truth-arbiter run class variance [N]      # variance
 *   pnpm --filter @gmsim/truth-arbiter run class name <nick> <seed>
 *   pnpm --filter @gmsim/truth-arbiter run class list
 */

const SEEDS_PATH = resolve(PACKAGE_ROOT, 'seeds.json');
const TOP_N = 32; // ≈ round 1
const DEFAULT_VARIANCE_N = 13; // match the real corpus year count

interface ClassMetrics {
  /** Share of the class at each position group (fraction 0..1). */
  share: Record<string, number>;
  /** Mean grade of the top TOP_N (R1-equivalent) — class top-end strength. */
  topGrade: number;
  /** % the grade falls from the top to the bottom band (talent gradient). */
  gradeDropPct: number;
}

// ── metrics ─────────────────────────────────────────────────────────────

function genMetrics(drafted: GeneratedProspect[], ctx: EvalCtx): ClassMetrics {
  const grouped = drafted.filter((g) => group(g.nflProjectedPosition));
  const total = grouped.length || 1;
  const share: Record<string, number> = {};
  for (const grp of GROUP_ORDER) {
    share[grp] = grouped.filter((g) => group(g.nflProjectedPosition) === grp).length / total;
  }
  const grades = drafted.map((g) => gradeOf(g, ctx)); // rank-ordered, best first
  const topGrade = mean(grades.slice(0, TOP_N));
  const lateGrade = mean(grades.slice(-TOP_N));
  const gradeDropPct = topGrade ? ((topGrade - lateGrade) / topGrade) * 100 : 0;
  return { share, topGrade, gradeDropPct };
}

function realYearMetrics(corpus: Corpus): Map<number, ClassMetrics> {
  const byYear = new Map<number, DraftPickRecord[]>();
  for (const p of corpus.picks) {
    (byYear.get(p.year) ?? byYear.set(p.year, []).get(p.year)!).push(p);
  }
  const out = new Map<number, ClassMetrics>();
  for (const [yr, picks] of byYear) {
    const grouped = picks.filter((p) => group(p.position));
    const total = grouped.length || 1;
    const share: Record<string, number> = {};
    for (const grp of GROUP_ORDER) {
      share[grp] = grouped.filter((p) => group(p.position) === grp).length / total;
    }
    const r1 = picks.filter((p) => p.round === 1 && p.scores.overall !== null).map((p) => p.scores.overall!);
    const late = picks.filter((p) => p.round >= 6 && p.scores.overall !== null).map((p) => p.scores.overall!);
    const topGrade = mean(r1);
    const gradeDropPct = topGrade ? ((topGrade - mean(late)) / topGrade) * 100 : 0;
    out.set(yr, { share, topGrade, gradeDropPct });
  }
  return out;
}

function draftSizeFor(corpus: Corpus): number {
  return Math.round(corpus.picks.length / corpus.years.length);
}

// ── nickname registry ───────────────────────────────────────────────────

interface SeedEntry {
  nickname: string;
  seed: string;
  addedAt: string;
}

async function loadSeeds(): Promise<SeedEntry[]> {
  try {
    await access(SEEDS_PATH);
    return JSON.parse(await readFile(SEEDS_PATH, 'utf8')) as SeedEntry[];
  } catch {
    return [];
  }
}

async function resolveSeed(token: string): Promise<string> {
  const seeds = await loadSeeds();
  const hit = seeds.find((s) => s.nickname.toLowerCase() === token.toLowerCase());
  return hit ? hit.seed : token;
}

// ── commands ────────────────────────────────────────────────────────────

async function reportClass(token: string): Promise<void> {
  const corpus = JSON.parse(await readFile(CORPUS_PATH, 'utf8')) as Corpus;
  const seed = await resolveSeed(token);
  const ctx = newEvalCtx();
  const drafted = await draftOneClass(seed, ctx, draftSizeFor(corpus));
  const m = genMetrics(drafted, ctx);

  // Real averages across years for context.
  const years = [...realYearMetrics(corpus).values()];
  const realShare = (grp: string): number => mean(years.map((y) => y.share[grp] ?? 0));

  const label = token === seed ? seed : `"${token}" (${seed})`;
  console.log(`\n=== draft class ${label} — ${drafted.length} picks ===\n`);
  console.log(`  ${'group'.padEnd(6)} ${'class%'.padStart(7)} ${'realavg%'.padStart(9)} ${'Δpp'.padStart(7)}`);
  for (const grp of GROUP_ORDER) {
    const cp = (m.share[grp] ?? 0) * 100;
    const rp = realShare(grp) * 100;
    console.log(`  ${grp.padEnd(6)} ${cp.toFixed(1).padStart(7)} ${rp.toFixed(1).padStart(9)} ${(cp - rp).toFixed(1).padStart(7)}`);
  }
  console.log(`\n  top-${TOP_N} grade: ${m.topGrade.toFixed(1)}   talent drop top→bottom: ${m.gradeDropPct.toFixed(1)}%`);
}

async function reportVariance(n: number): Promise<void> {
  const corpus = JSON.parse(await readFile(CORPUS_PATH, 'utf8')) as Corpus;
  const draftSize = draftSizeFor(corpus);

  // Real year-to-year variation.
  const realYears = [...realYearMetrics(corpus).values()];
  const realShareSd = (grp: string): number => stdev(realYears.map((y) => (y.share[grp] ?? 0) * 100));
  const realTopGradeCoV = stdev(realYears.map((y) => y.topGrade)) / (mean(realYears.map((y) => y.topGrade)) || 1);

  // Generated class-to-class variation across N seeds.
  const ctx = newEvalCtx();
  const genM: ClassMetrics[] = [];
  for (let i = 0; i < n; i++) {
    const drafted = await draftOneClass(`var-${i}`, ctx, draftSize);
    genM.push(genMetrics(drafted, ctx));
  }
  const genShareSd = (grp: string): number => stdev(genM.map((m) => (m.share[grp] ?? 0) * 100));
  const genTopGradeCoV = stdev(genM.map((m) => m.topGrade)) / (mean(genM.map((m) => m.topGrade)) || 1);

  console.log(`\n=== class-to-class variance — generated (${n}) vs real (${realYears.length} yrs) ===`);
  console.log(`(SD of each position group's class share, in percentage points)\n`);
  console.log(`  ${'group'.padEnd(6)} ${'realSD'.padStart(7)} ${'genSD'.padStart(7)} ${'ratio'.padStart(7)}`);
  for (const grp of GROUP_ORDER) {
    const rs = realShareSd(grp);
    const gs = genShareSd(grp);
    const ratio = rs > 0 ? gs / rs : 0;
    const flag = ratio < 0.5 ? '  <-- too SAMEY' : ratio > 2 ? '  <-- too WILD' : '';
    console.log(`  ${grp.padEnd(6)} ${rs.toFixed(2).padStart(7)} ${gs.toFixed(2).padStart(7)} ${ratio.toFixed(2).padStart(7)}${flag}`);
  }
  console.log(
    `\n  top-end talent variance (CoV): real ${(realTopGradeCoV * 100).toFixed(1)}%  gen ${(genTopGradeCoV * 100).toFixed(1)}%` +
      `${genTopGradeCoV < realTopGradeCoV * 0.5 ? '  <-- gen classes too uniform year-to-year' : ''}`,
  );
}

async function nameSeed(nickname: string, seed: string): Promise<void> {
  const seeds = await loadSeeds();
  const existing = seeds.findIndex((s) => s.nickname.toLowerCase() === nickname.toLowerCase());
  const entry: SeedEntry = { nickname, seed, addedAt: new Date().toISOString() };
  if (existing >= 0) seeds[existing] = entry;
  else seeds.push(entry);
  await writeFile(SEEDS_PATH, JSON.stringify(seeds, null, 2), 'utf8');
  console.log(`Named seed "${seed}" → "${nickname}" (${seeds.length} saved). Re-run: run class "${nickname}"`);
}

async function listSeeds(): Promise<void> {
  const seeds = await loadSeeds();
  if (seeds.length === 0) {
    console.log('No named seeds yet. Add one: run class name "<nickname>" <seed>');
    return;
  }
  console.log(`\n=== named seeds (${seeds.length}) ===`);
  for (const s of seeds) console.log(`  ${s.nickname.padEnd(24)} ${s.seed.padEnd(16)} ${s.addedAt.slice(0, 10)}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];
  if (sub === 'variance') {
    await reportVariance(Number(args[1]) || DEFAULT_VARIANCE_N);
  } else if (sub === 'name') {
    if (!args[1] || !args[2]) throw new Error('usage: class name "<nickname>" <seed>');
    await nameSeed(args[1], args[2]);
  } else if (sub === 'list') {
    await listSeeds();
  } else if (sub) {
    await reportClass(sub);
  } else {
    console.error('usage: class <seed|nickname> | class variance [N] | class name "<nick>" <seed> | class list');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
