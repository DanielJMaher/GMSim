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
  createLeague: (opts: { seed: string }) => EngineLeague;
  simulateSeason: (league: EngineLeague) => EngineLeague;
  advanceSeason: (league: EngineLeague) => EngineLeague;
}

interface EnginePlayer {
  id: string;
  draftRound: number | null;
  draftOverallPick: number | null;
  experienceYears: number;
  tier: string;
  careerAwards: readonly unknown[];
}
interface EngineLeague {
  players: Record<string, EnginePlayer>;
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

// ── Phase B: forward-sim career outcomes ─────────────────────────────────

/** One drafted player's realized NFL career (tracked across a forward sim). */
export interface DraftedCareer {
  round: number;
  overallPick: number | null;
  /** Sim year the player was drafted (0-based). */
  draftedYear: number;
  /** experienceYears at last sighting (career length; right-censored at sim end). */
  careerYears: number;
  /** Best talent tier the player developed to (tier evolves via development). */
  peakTier: string;
  /** Career individual awards (MVP/OPOY/DPOY/OROY/DROY) — the rare elite signal. */
  awards: number;
  /** Disappeared from the league before sim end with a short career. */
  washedOutEarly: boolean;
}

const TIER_RANK: Record<string, number> = { FRINGE: 0, BACKUP: 1, STARTER: 2, STAR: 3 };
const RANK_TO_TIER = ['FRINGE', 'BACKUP', 'STARTER', 'STAR'] as const;

/**
 * Forward-simulate a league `years` seasons and track the realized career of
 * every player DRAFTED in-sim (registered as a true rookie, experienceYears 0).
 * This is the first SLOW Arbiter check — a full season sim per year.
 */
export async function simulateDraftedCareers(seed: string, years: number): Promise<DraftedCareer[]> {
  const eng = await loadEngine();
  let league = eng.createLeague({ seed });
  interface Rec {
    round: number;
    overallPick: number | null;
    draftedYear: number;
    careerYears: number;
    peakTierRank: number;
    awards: number;
    lastSeen: number;
  }
  const tracked = new Map<string, Rec>();
  for (let y = 0; y < years; y++) {
    league = eng.simulateSeason(league);
    league = eng.advanceSeason(league);
    for (const p of Object.values(league.players)) {
      if (p.draftRound == null) continue;
      let rec = tracked.get(p.id);
      if (!rec) {
        if (p.experienceYears > 0) continue; // only true in-sim rookies
        rec = {
          round: p.draftRound,
          overallPick: p.draftOverallPick ?? null,
          draftedYear: y,
          careerYears: 0,
          peakTierRank: 0,
          awards: 0,
          lastSeen: y,
        };
        tracked.set(p.id, rec);
      }
      rec.peakTierRank = Math.max(rec.peakTierRank, TIER_RANK[p.tier] ?? 0);
      rec.awards = p.careerAwards.length;
      rec.careerYears = p.experienceYears;
      rec.lastSeen = y;
    }
  }
  return [...tracked.values()].map((r) => ({
    round: r.round,
    overallPick: r.overallPick,
    draftedYear: r.draftedYear,
    careerYears: r.careerYears,
    peakTier: RANK_TO_TIER[r.peakTierRank] ?? 'FRINGE',
    awards: r.awards,
    washedOutEarly: r.lastSeen < years - 1 && r.careerYears <= 3,
  }));
}
