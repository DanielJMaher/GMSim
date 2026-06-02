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
  createLeague: (opts: { seed: string; statEngine?: 'topdown' | 'bottomup' }) => EngineLeague;
  simulateSeason: (league: EngineLeague) => EngineLeague;
  advanceSeason: (league: EngineLeague) => EngineLeague;
  matchupFacets: (team: unknown, league: EngineLeague) => unknown;
  simulateGameDrives: (
    prng: unknown,
    homeFacets: unknown,
    awayFacets: unknown,
  ) => { driveLog: SimDrive[] };
  simulateGameWithDrives: (
    prng: unknown,
    homeTeam: unknown,
    awayTeam: unknown,
    league: EngineLeague,
  ) => { homeScore: number; awayScore: number; playerStats: Map<string, PlayerStatLine> };
}

export interface PlayerStatLine {
  passAttempts: number; passCompletions: number; passingYards: number; passingTds: number;
  interceptionsThrown: number; rushingAttempts: number; rushingYards: number; rushingTds: number;
  targets: number; receptions: number; receivingYards: number; receivingTds: number;
  sacks: number; interceptions: number;
}

export interface SimDrive {
  offense: string;
  result: string;
  plays: number;
  yards: number;
}

interface EnginePlayer {
  id: string;
  draftRound: number | null;
  draftOverallPick: number | null;
  experienceYears: number;
  tier: string;
  talentGrade: string;
  position: string;
  positionGroup: string;
  teamId: string | null;
  careerAwards: readonly { kind: string; seasonNumber: number }[];
  current: Record<string, number>;
  ceiling: Record<string, number>;
}
interface EngineLeague {
  players: Record<string, EnginePlayer>;
  teams: Record<string, unknown>;
  seasonNumber: number;
}

/**
 * Run the matchup-driven drive sim across `numGames` matchups in a generated
 * league and pool every drive — the Magistrate aggregates these vs the real
 * NFL drive bar.
 */
export async function simulateDriveLogs(seed: string, numGames: number): Promise<SimDrive[]> {
  const eng = await loadEngine();
  const league = eng.createLeague({ seed });
  const teamIds = Object.keys(league.teams);
  const n = teamIds.length;
  const out: SimDrive[] = [];
  for (let g = 0; g < numGames; g++) {
    const home = teamIds[g % n]!;
    const away = teamIds[(g * 7 + 1) % n] === home ? teamIds[(g * 7 + 2) % n]! : teamIds[(g * 7 + 1) % n]!;
    const hf = eng.matchupFacets(league.teams[home], league);
    const af = eng.matchupFacets(league.teams[away], league);
    const res = eng.simulateGameDrives(new eng.Prng(`${seed}:g${g}`), hf, af);
    out.push(...res.driveLog);
  }
  return out;
}

// ── Star separation (stage 1b): emergent per-player season stat lines ─────

export interface SeasonPlayerStat extends PlayerStatLine {
  id: string;
  position: string;
  talentGrade: string;
  teamGames: number;
}

/**
 * Run the bottom-up (`simulateGameWithDrives`) sim across a generated league's
 * season schedule and pool every player's EMERGENT season stat line. The
 * star-separation check reads this to confirm elite players out-produce — the
 * whole point of the bottom-up rewrite.
 */
export async function simulateSeasonPlayerStats(
  seed: string,
  gamesPerTeam = 17,
): Promise<SeasonPlayerStat[]> {
  const eng = await loadEngine();
  const league = eng.createLeague({ seed });
  const teamIds = Object.keys(league.teams);
  const n = teamIds.length;
  const totals = new Map<string, SeasonPlayerStat>();
  const teamGames = new Map<string, number>();

  const blank = (p: EnginePlayer): SeasonPlayerStat => ({
    id: p.id, position: p.position, talentGrade: p.talentGrade, teamGames: 0,
    passAttempts: 0, passCompletions: 0, passingYards: 0, passingTds: 0, interceptionsThrown: 0,
    rushingAttempts: 0, rushingYards: 0, rushingTds: 0, targets: 0, receptions: 0,
    receivingYards: 0, receivingTds: 0, sacks: 0, interceptions: 0,
  });

  for (let round = 0; round < gamesPerTeam; round++) {
    for (let i = 0; i < n; i++) {
      const home = teamIds[i]!;
      const away = teamIds[(i + round + 1) % n]!;
      if (home === away) continue;
      teamGames.set(home, (teamGames.get(home) ?? 0) + 1);
      teamGames.set(away, (teamGames.get(away) ?? 0) + 1);
      const res = eng.simulateGameWithDrives(
        new eng.Prng(`${seed}:r${round}:g${i}`),
        league.teams[home],
        league.teams[away],
        league,
      );
      for (const [pid, l] of res.playerStats) {
        const p = league.players[pid];
        if (!p) continue;
        let t = totals.get(pid);
        if (!t) { t = blank(p); totals.set(pid, t); }
        t.passAttempts += l.passAttempts; t.passCompletions += l.passCompletions;
        t.passingYards += l.passingYards; t.passingTds += l.passingTds;
        t.interceptionsThrown += l.interceptionsThrown; t.rushingAttempts += l.rushingAttempts;
        t.rushingYards += l.rushingYards; t.rushingTds += l.rushingTds; t.targets += l.targets;
        t.receptions += l.receptions; t.receivingYards += l.receivingYards;
        t.receivingTds += l.receivingTds; t.sacks += l.sacks; t.interceptions += l.interceptions;
      }
    }
  }
  for (const t of totals.values()) {
    const p = league.players[t.id];
    t.teamGames = p?.teamId ? (teamGames.get(p.teamId) ?? 0) : 0;
  }
  return [...totals.values()];
}

// ── Stage 2: ELITE→Pro Bowl conversion by talent grade ───────────────────

export interface GradeConversion {
  grade: string;
  /** Rostered players at that grade going into the measured season. */
  n: number;
  /** How many made that season's Pro Bowl (any accolade). */
  proBowl: number;
  /** How many made first-team All-Pro. */
  allPro1: number;
}

function awardCount(p: EnginePlayer, kind: string): number {
  let c = 0;
  for (const a of p.careerAwards) if (a.kind === kind) c++;
  return c;
}

/**
 * Forward-sim `years` seasons, then for the FINAL season measure — by the
 * player's talent grade going INTO that season — what fraction earned a Pro
 * Bowl / All-Pro. This is the Stage-2 payoff metric: bottom-up emergent stats
 * should lift ELITE→Pro Bowl conversion well above the top-down ~56%.
 *
 * Accolades are appended during `advanceSeason` (off the just-played season's
 * stats, using the pre-development grade), so we snapshot grade + award counts
 * after the final `simulateSeason` and diff after the final `advanceSeason`.
 */
export async function simulateConversionByGrade(
  seeds: readonly string[],
  years: number,
  statEngine?: 'topdown' | 'bottomup',
): Promise<GradeConversion[]> {
  const eng = await loadEngine();
  const tally = new Map<string, { n: number; pb: number; ap1: number }>();

  for (const seed of seeds) {
    let league = statEngine ? eng.createLeague({ seed, statEngine }) : eng.createLeague({ seed });
    for (let y = 0; y < years - 1; y++) {
      league = eng.simulateSeason(league);
      league = eng.advanceSeason(league);
    }
    league = eng.simulateSeason(league);
    const before = new Map<string, { grade: string; pb: number; ap1: number }>();
    for (const p of Object.values(league.players)) {
      if (!p.teamId) continue;
      before.set(p.id, { grade: p.talentGrade, pb: awardCount(p, 'PRO_BOWL'), ap1: awardCount(p, 'ALL_PRO_1ST') });
    }
    league = eng.advanceSeason(league);
    for (const p of Object.values(league.players)) {
      const b = before.get(p.id);
      if (!b) continue;
      const t = tally.get(b.grade) ?? { n: 0, pb: 0, ap1: 0 };
      t.n += 1;
      if (awardCount(p, 'PRO_BOWL') > b.pb) t.pb += 1;
      if (awardCount(p, 'ALL_PRO_1ST') > b.ap1) t.ap1 += 1;
      tally.set(b.grade, t);
    }
  }

  const order = ['ELITE', 'STAR', 'HIGH_STARTER', 'STARTER', 'WEAK_STARTER', 'ROTATIONAL', 'BACKUP', 'FRINGE'];
  return order
    .filter((g) => tally.has(g))
    .map((g) => {
      const t = tally.get(g)!;
      return { grade: g, n: t.n, proBowl: t.pb, allPro1: t.ap1 };
    });
}

// ── The Liquidator: GMSim seed-contract cap structure ────────────────────

export interface LeagueContractRow {
  position: string;
  /** Total contract value ÷ real years (avg per year). */
  apy: number;
  /** APY as a fraction of the league salary cap — comparable across eras. */
  apyCapPct: number;
  /** Guaranteed money (signing bonus + guaranteed base) as a fraction of value. */
  guaranteedPct: number;
  years: number;
  tier: string;
  talentGrade: string;
}

interface RawContract {
  realYears: number;
  baseSalaries: number[];
  signingBonus: number;
  rosterBonuses: number[];
  workoutBonuses: number[];
  guarantees: { baseGuaranteedPct: number }[];
}

/**
 * Extract every rostered player's contract as a cap-structure row from a fresh
 * GMSim league — the surface The Liquidator compares against real OTC data.
 */
export async function loadLeagueContracts(seed: string): Promise<LeagueContractRow[]> {
  const eng = await loadEngine();
  const league = eng.createLeague({ seed }) as unknown as {
    salaryCap: number;
    players: Record<string, { position: string; contractId: string | null; teamId: string | null; tier: string; talentGrade: string }>;
    contracts: Record<string, RawContract>;
  };
  const cap = league.salaryCap;
  const rows: LeagueContractRow[] = [];
  for (const p of Object.values(league.players)) {
    if (!p.teamId || !p.contractId) continue;
    const c = league.contracts[p.contractId];
    if (!c) continue;
    const sum = (a: number[]): number => a.reduce((s, v) => s + v, 0);
    const value = sum(c.baseSalaries) + c.signingBonus + sum(c.rosterBonuses) + sum(c.workoutBonuses);
    const apy = c.realYears > 0 ? value / c.realYears : 0;
    let guaranteed = c.signingBonus; // signing bonus is fully guaranteed
    for (let i = 0; i < c.realYears; i++) {
      guaranteed += (c.baseSalaries[i] ?? 0) * ((c.guarantees[i]?.baseGuaranteedPct ?? 0) / 100);
    }
    rows.push({
      position: p.position,
      apy,
      apyCapPct: cap > 0 ? apy / cap : 0,
      guaranteedPct: value > 0 ? guaranteed / value : 0,
      years: c.realYears,
      tier: p.tier,
      talentGrade: p.talentGrade,
    });
  }
  return rows;
}

// ── The Liquidator (Slice 2): GMSim free-agent signing cap structure ─────

export interface FreeAgentSigningRow {
  position: string;
  /** Total contract value ÷ real years (avg per year). */
  apy: number;
  /** APY as a fraction of the league salary cap — comparable to real OTC. */
  apyCapPct: number;
  /** Guaranteed money (signing bonus + guaranteed base) as a fraction of value. */
  guaranteedPct: number;
  years: number;
  tier: string;
  /** True for offseason-auction deals; false for mid-season vet-min street signings. */
  marketContract: boolean;
}

/**
 * Forward-sim a fresh GMSim league `years` seasons and pool every free-agent
 * signing's contract as a cap-structure row — the surface The Liquidator
 * compares against real OTC veteran-market deals. Each offseason's FA refill
 * appends `fa-sign` transactions; the new contracts still exist in
 * `league.contracts` immediately after that offseason, so we resolve each
 * newly-logged signing right after the advance that created it.
 */
export async function loadFreeAgentSignings(
  seed: string,
  years: number,
): Promise<FreeAgentSigningRow[]> {
  const eng = await loadEngine();
  let league = eng.createLeague({ seed }) as unknown as LiquidatorLeague;
  const cap = league.salaryCap;
  const rows: FreeAgentSigningRow[] = [];

  const sum = (a: number[]): number => a.reduce((s, v) => s + v, 0);

  for (let y = 0; y < years; y++) {
    const before = league.transactionLog.length;
    league = eng.simulateSeason(league as unknown as EngineLeague) as unknown as LiquidatorLeague;
    league = eng.advanceSeason(league as unknown as EngineLeague) as unknown as LiquidatorLeague;
    for (let i = before; i < league.transactionLog.length; i++) {
      const tx = league.transactionLog[i];
      if (!tx || tx.kind !== 'fa-sign') continue;
      const c = league.contracts[tx.contractId];
      if (!c) continue;
      const player = league.players[tx.playerId];
      if (!player) continue;
      const value = sum(c.baseSalaries) + c.signingBonus + sum(c.rosterBonuses) + sum(c.workoutBonuses);
      const apy = c.realYears > 0 ? value / c.realYears : 0;
      let guaranteed = c.signingBonus;
      for (let j = 0; j < c.realYears; j++) {
        guaranteed += (c.baseSalaries[j] ?? 0) * ((c.guarantees[j]?.baseGuaranteedPct ?? 0) / 100);
      }
      rows.push({
        position: player.position,
        apy,
        apyCapPct: cap > 0 ? apy / cap : 0,
        guaranteedPct: value > 0 ? guaranteed / value : 0,
        years: c.realYears,
        tier: player.tier,
        marketContract: tx.marketContract,
      });
    }
  }
  return rows;
}

interface LiquidatorLeague {
  salaryCap: number;
  seasonNumber: number;
  transactionLog: {
    kind: string;
    contractId: string;
    playerId: string;
    marketContract: boolean;
  }[];
  players: Record<string, { position: string; tier: string }>;
  contracts: Record<string, RawContract>;
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
  /** Career Pro Bowl selections (2b) — directly comparable to real probowls. */
  proBowls: number;
  /** Fine 8-grade at draft (rookie) and the best grade reached (diagnostic). */
  draftGrade: string;
  peakGrade: string;
  /** Which independent league seed this career came from (for seed-variance). */
  seed: string;
  /** Disappeared from the league before sim end with a short career. */
  washedOutEarly: boolean;
}

const TIER_RANK: Record<string, number> = { FRINGE: 0, BACKUP: 1, STARTER: 2, STAR: 3 };
const RANK_TO_TIER = ['FRINGE', 'BACKUP', 'STARTER', 'STAR'] as const;
const GRADE_RANK: Record<string, number> = {
  ELITE: 0, STAR: 1, HIGH_STARTER: 2, STARTER: 3, WEAK_STARTER: 4, ROTATIONAL: 5, BACKUP: 6, FRINGE: 7,
};
const RANK_TO_GRADE = [
  'ELITE', 'STAR', 'HIGH_STARTER', 'STARTER', 'WEAK_STARTER', 'ROTATIONAL', 'BACKUP', 'FRINGE',
] as const;

interface CareerRec {
  round: number;
  overallPick: number | null;
  draftedYear: number;
  careerYears: number;
  peakTierRank: number;
  draftGradeRank: number;
  peakGradeRank: number;
  awards: number;
  proBowls: number;
  lastSeen: number;
}

/** Track one independent league's drafted careers over `years` seasons. */
function simulateOneLeague(eng: EngineModule, seed: string, years: number): DraftedCareer[] {
  let league = eng.createLeague({ seed });
  const tracked = new Map<string, CareerRec>();
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
          draftGradeRank: GRADE_RANK[p.talentGrade] ?? 7,
          peakGradeRank: GRADE_RANK[p.talentGrade] ?? 7,
          awards: 0,
          proBowls: 0,
          lastSeen: y,
        };
        tracked.set(p.id, rec);
      }
      rec.peakTierRank = Math.max(rec.peakTierRank, TIER_RANK[p.tier] ?? 0);
      rec.peakGradeRank = Math.min(rec.peakGradeRank, GRADE_RANK[p.talentGrade] ?? 7);
      rec.awards = p.careerAwards.length;
      rec.proBowls = p.careerAwards.filter((a) => a.kind === 'PRO_BOWL').length;
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
    proBowls: r.proBowls,
    draftGrade: RANK_TO_GRADE[r.draftGradeRank] ?? 'FRINGE',
    peakGrade: RANK_TO_GRADE[r.peakGradeRank] ?? 'FRINGE',
    seed,
    washedOutEarly: r.lastSeen < years - 1 && r.careerYears <= 3,
  }));
}

/**
 * Forward-simulate `seeds.length` INDEPENDENT leagues `years` seasons each and
 * pool every in-sim-drafted player's realized career. Multiple seeds make the
 * outcome conclusions seed-robust, not a single-league artifact. The first
 * SLOW Arbiter check — a full season sim per year per seed.
 */
export async function simulateDraftedCareers(
  seeds: readonly string[],
  years: number,
): Promise<DraftedCareer[]> {
  const eng = await loadEngine();
  const all: DraftedCareer[] = [];
  for (const seed of seeds) all.push(...simulateOneLeague(eng, seed, years));
  return all;
}

// ── Skill Adjudicator (2c): league talent-grade + accolade audit ─────────

export interface AuditPlayer {
  position: string;
  positionGroup: string;
  talentGrade: string;
  /** Hidden max-potential ratings (the generation knob behind "everyone's a
   *  99"). Keyed by PlayerSkills attribute name. */
  ceiling: Record<string, number>;
  /** Hidden current ratings (realized after development in sim mode). */
  current: Record<string, number>;
}
export interface LeagueAudit {
  seasons: number;
  /** Rostered players at sim end (grade distribution after development). */
  players: AuditPlayer[];
  /** Total accolades over the sim, by kind (/ seasons = per-season rate).
   *  Undercounts: players who retired/were purged before sim end no longer
   *  carry their awards in `league.players`. Use `lastSeasonAccolades` for the
   *  true per-season naming rate. */
  accolades: Record<string, number>;
  /** Accolades named in the FINAL simulated season, by kind. No roster churn
   *  has removed those players yet, so this is the accurate per-season count. */
  lastSeasonAccolades: Record<string, number>;
}

/**
 * Forward-sim a league `years` seasons and return the audit surface the Skill
 * Adjudicator checks: the post-development talent-grade distribution + the
 * per-season accolade counts (Pro Bowl / All-Pro).
 */
export async function auditLeague(seed: string, years: number): Promise<LeagueAudit> {
  const eng = await loadEngine();
  let league = eng.createLeague({ seed });
  const accolades: Record<string, number> = {};
  for (let y = 0; y < years; y++) {
    league = eng.simulateSeason(league);
    league = eng.advanceSeason(league);
  }
  // Awards are stamped with the seasonNumber they were earned. The most recent
  // stamped season is the cleanest per-season count (no churn yet).
  let lastSeason = 0;
  for (const p of Object.values(league.players)) {
    for (const a of p.careerAwards) if (a.seasonNumber > lastSeason) lastSeason = a.seasonNumber;
  }
  const players: AuditPlayer[] = [];
  const lastSeasonAccolades: Record<string, number> = {};
  for (const p of Object.values(league.players)) {
    if (p.teamId) {
      players.push({
        position: p.position,
        positionGroup: p.positionGroup,
        talentGrade: p.talentGrade,
        ceiling: p.ceiling,
        current: p.current,
      });
    }
    for (const a of p.careerAwards) {
      accolades[a.kind] = (accolades[a.kind] ?? 0) + 1;
      if (a.seasonNumber === lastSeason) lastSeasonAccolades[a.kind] = (lastSeasonAccolades[a.kind] ?? 0) + 1;
    }
  }
  return { seasons: years, players, accolades, lastSeasonAccolades };
}
