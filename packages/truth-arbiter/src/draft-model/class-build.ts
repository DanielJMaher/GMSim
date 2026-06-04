import { generatePool, keySkillsFor, positionValue, type GeneratedProspect } from '../lib/engine-bridge.js';

/**
 * Shared "build one draft class" pipeline used by every Arbiter check.
 *
 * A class is drafted from a single pool's graduating cohort (all seniors +
 * the ~110 best "declared" juniors ≈ one real draft), ranked by draft value
 * (projected key-skill-ceiling grade × position premium), top DRAFT_SIZE
 * taken. This reproduces the real talent gradient (the bottom of the class is
 * a genuinely marginal prospect) — see arbiter.ts for the derivation.
 */

// Both vocabularies (nfl.com real + engine Position enum) → coarse groups.
const GROUP: Record<string, string> = {
  QB: 'QB',
  RB: 'RB', FB: 'RB',
  WR: 'WR',
  TE: 'TE',
  LT: 'OL', LG: 'OL', C: 'OL', RG: 'OL', RT: 'OL', OT: 'OL', OG: 'OL', G: 'OL', T: 'OL', OL: 'OL',
  EDGE: 'EDGE', DE: 'EDGE',
  DT: 'DT', NT: 'DT', DL: 'DT',
  LB: 'LB', OLB: 'LB', ILB: 'LB', MLB: 'LB',
  CB: 'CB', NICKEL: 'CB',
  S: 'S', SAF: 'S', FS: 'S', SS: 'S', DB: 'S',
  K: 'K', P: 'P', LS: 'LS',
};
export const GROUP_ORDER = ['QB', 'RB', 'WR', 'TE', 'OL', 'EDGE', 'DT', 'LB', 'CB', 'S'] as const;

export function group(pos: string | null): string | null {
  return pos ? (GROUP[pos.toUpperCase()] ?? null) : null;
}

export function mean(xs: readonly number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
export function stdev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Per-archetype key-skill cache + per-position draft-value cache. */
export interface EvalCtx {
  archKeys: Map<string, string[]>;
  posVal: Map<string, number>;
}

export function newEvalCtx(): EvalCtx {
  return { archKeys: new Map(), posVal: new Map() };
}

/** Fill the caches for any archetypes/positions in `pool` not seen yet. */
export async function ensureCtx(ctx: EvalCtx, pool: readonly GeneratedProspect[]): Promise<void> {
  for (const arch of new Set(pool.map((p) => p.archetype))) {
    if (!ctx.archKeys.has(arch)) ctx.archKeys.set(arch, await keySkillsFor(arch));
  }
  for (const pos of new Set(pool.map((p) => p.nflProjectedPosition))) {
    if (!ctx.posVal.has(pos)) ctx.posVal.set(pos, await positionValue(pos));
  }
}

/** Projected draft grade: mean of the archetype's key-skill CEILINGS. */
export function gradeOf(g: GeneratedProspect, ctx: EvalCtx): number {
  const keys = ctx.archKeys.get(g.archetype) ?? [];
  const vals = (keys.length ? keys.map((k) => g.ceiling[k]) : Object.values(g.ceiling)).filter(
    (x): x is number => typeof x === 'number',
  );
  return vals.length ? mean(vals) : 0;
}

export function draftValueOf(g: GeneratedProspect, ctx: EvalCtx): number {
  return gradeOf(g, ctx) * (ctx.posVal.get(g.nflProjectedPosition) ?? 1);
}

export const DECLARED_JUNIORS = 110;

/** Draft one class (rank-ordered, best first) from an already-generated pool. */
export function draftClassFromPool(
  pool: readonly GeneratedProspect[],
  ctx: EvalCtx,
  draftSize: number,
): GeneratedProspect[] {
  const seniors = pool.filter((p) => p.classYear === 'SR' || p.classYear === 'RS_SR');
  const declaredJuniors = pool
    .filter((p) => p.classYear === 'JR')
    .sort((a, b) => draftValueOf(b, ctx) - draftValueOf(a, ctx))
    .slice(0, DECLARED_JUNIORS);
  return [...seniors, ...declaredJuniors]
    .sort((a, b) => draftValueOf(b, ctx) - draftValueOf(a, ctx))
    .slice(0, draftSize);
}

/** Generate + draft one class for a seed. Returns rank-ordered prospects. */
export async function draftOneClass(
  seed: string,
  ctx: EvalCtx,
  draftSize: number,
): Promise<GeneratedProspect[]> {
  const pool = await generatePool(seed);
  await ensureCtx(ctx, pool);
  return draftClassFromPool(pool, ctx, draftSize);
}
