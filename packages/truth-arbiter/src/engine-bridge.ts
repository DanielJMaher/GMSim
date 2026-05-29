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
  current: Record<string, number>;
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

interface EngineModule {
  Prng: new (seed: string) => unknown;
  generateInitialCollegePool: (
    prng: unknown,
    opts: { simYear?: number; idPrefix?: string },
  ) => readonly GeneratedProspect[];
}

async function loadEngine(): Promise<EngineModule> {
  if (!existsSync(ENGINE_DIST)) {
    throw new Error(
      `Engine build not found at ${ENGINE_DIST}.\n` +
        `Run: pnpm --filter @gmsim/engine build`,
    );
  }
  return (await import(pathToFileURL(ENGINE_DIST).href)) as EngineModule;
}

/**
 * Generate a population of GMSim prospects across `seeds` college pools.
 * Returns the raw prospects; the Arbiter selects a "drafted" subset by talent.
 */
export async function generateProspectPopulation(
  seeds: readonly string[],
): Promise<GeneratedProspect[]> {
  const eng = await loadEngine();
  const all: GeneratedProspect[] = [];
  for (const seed of seeds) {
    const pool = eng.generateInitialCollegePool(new eng.Prng(seed), {
      simYear: 2026,
      idPrefix: `arb_${seed}`,
    });
    all.push(...pool);
  }
  return all;
}
