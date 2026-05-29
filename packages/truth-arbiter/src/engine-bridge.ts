import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PACKAGE_ROOT } from './config.js';

/**
 * The engine ships its TypeScript source as the package entry (for Vite /
 * vitest), so a plain-Node tool can't import it by package name. We import
 * its built JS output directly by path instead. Requires the engine to be
 * built first: `pnpm --filter @gmsim/engine build`.
 */
const ENGINE_DIST = resolve(PACKAGE_ROOT, '../engine/dist/index.js');

/** The prospect fields we read for verification (subset of CollegePlayer). */
export interface GeneratedProspect {
  nflProjectedPosition: string;
  position: string;
  tier: string;
  classYear: string;
  archetype: string;
  current: Record<string, number>;
  ceiling: Record<string, number>;
  measurables: {
    heightInches: number;
    weightLbs: number;
    armLengthInches: number;
    handSizeInches: number;
    fortyYardSeconds: number;
    benchPress225Reps: number;
    verticalInches: number;
    broadJumpInches: number;
    threeConeSeconds: number;
    shuttleSeconds: number;
  };
}

interface EngineArchetype {
  skillWeights: Record<string, number | undefined>;
}
interface EngineModule {
  Prng: new (seed: string) => unknown;
  generateInitialCollegePool: (
    prng: unknown,
    opts: { simYear?: number; idPrefix?: string },
  ) => readonly GeneratedProspect[];
  getArchetypeById: (id: string) => EngineArchetype | undefined;
  boardPositionalFactor: (position: string) => number;
}

let cached: EngineModule | null = null;
async function loadEngine(): Promise<EngineModule> {
  if (cached) return cached;
  if (!existsSync(ENGINE_DIST)) {
    throw new Error(
      `Engine build not found at ${ENGINE_DIST}.\n` +
        `Run: pnpm --filter @gmsim/engine build`,
    );
  }
  cached = (await import(pathToFileURL(ENGINE_DIST).href)) as EngineModule;
  return cached;
}

/** The archetype's defining ("key") skills — weight ≥ 1.2, the engine's own
 *  threshold for a position-defining skill (see games/strength keySkillAvg). */
export async function keySkillsFor(archetypeId: string): Promise<string[]> {
  const eng = await loadEngine();
  const arch = eng.getArchetypeById(archetypeId);
  if (!arch) return [];
  return Object.entries(arch.skillWeights)
    .filter(([, w]) => (w ?? 1) >= 1.2)
    .map(([k]) => k);
}

/** Position draft-value multiplier (QB/EDGE/CB premium), from the engine. */
export async function positionValue(position: string): Promise<number> {
  const eng = await loadEngine();
  return eng.boardPositionalFactor(position);
}

/**
 * Generate one GMSim college pool (all class years). The Arbiter drafts from
 * a single pool's graduating cohort — the realistic unit of one draft —
 * rather than skimming the cream off many pooled classes.
 */
export async function generatePool(seed: string): Promise<GeneratedProspect[]> {
  const eng = await loadEngine();
  return [...eng.generateInitialCollegePool(new eng.Prng(seed), {
    simYear: 2026,
    idPrefix: `arb_${seed}`,
  })];
}
