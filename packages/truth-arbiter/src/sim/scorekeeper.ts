import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from '../lib/config.js';
import { csvNum, csvRows } from '../lib/csv.js';
import { simulateBoxScores, type SkSimResult } from '../lib/engine-bridge.js';

/**
 * The Scorekeeper — the GAME-RESULTS realism authority (2026-06-12,
 * Daniel-directed; 8th data-agent). The Magistrate guards the drive level
 * (points/plays/yards per drive); the Scorekeeper guards the level above:
 * per-game team box scores, their internal coherence, and the relationship
 * between stats and winning. A league where box scores don't add up — or
 * where passing yards predict wins — doesn't feel like the NFL no matter
 * how clean its drives are.
 *
 * Real bar (open nflverse data, REG 2011-2025, 7,838 team-games):
 *   - nfldata games.csv      — every game's score/result/home team
 *   - stats_team_week_*.csv  — per-team-game box scores
 *
 * Checks:
 *   1. per-game envelope    — points, pass/rush yards, attempts, comp%,
 *                             sacks suffered, giveaways (mean + spread)
 *   2. double-entry         — passing == receiving per team-game (real data
 *                             holds this in 7,837/7,838 rows)
 *   3. stats↔win coupling   — winners out-rush losers by ~35 yds and win
 *                             the giveaway battle by ~0.9; passing volume
 *                             barely separates winners (game-script
 *                             signature). A sim where pass yards predict
 *                             wins is structurally wrong.
 *   4. season shape         — wins distribution (sd/p5/p95), Pythagorean
 *                             RMSE (exp 2.37), home win%.
 *
 *   pnpm --filter @gmsim/truth-arbiter run scorekeeper              # real bar only
 *   pnpm --filter @gmsim/truth-arbiter run scorekeeper sim 6 8      # + GMSim compare
 *   (internal)                          … scorekeeper worker <seed> <years>
 */

const GAMES_URL = 'https://github.com/nflverse/nfldata/raw/master/data/games.csv';
const GAMES_PATH = resolve(DATA_DIR, 'games.csv');
const teamWeekUrl = (y: number): string =>
  `https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_${y}.csv`;
const teamWeekPath = (y: number): string => resolve(DATA_DIR, `stats_team_week_${y}.csv`);
const SK_DIR = resolve(DATA_DIR, 'scorekeeper');

const START_YEAR = 2011;
const END_YEAR = 2025;
/** Pythagorean exponent (Football Outsiders convention). */
const PYTH_EXP = 2.37;

// ── Shared stats helpers ─────────────────────────────────────────────────────

interface DistStat {
  n: number;
  mean: number;
  sd: number;
  p5: number;
  p50: number;
  p95: number;
}

function dist(values: number[]): DistStat {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length || 1;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const q = (p: number): number => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] ?? 0;
  return { n: s.length, mean, sd, p5: q(0.05), p50: q(0.5), p95: q(0.95) };
}

/** Everything the Scorekeeper holds a side to. Same shape for real + sim. */
interface Bar {
  teamGames: number;
  points: DistStat;
  passYds: DistStat;
  rushYds: DistStat;
  attempts: DistStat;
  compPct: number;
  sacksSuffered: number;
  /** INTs + lost fumbles on the real side; GMSim's box `turnovers` is
   *  INTs-thrown only (drive sim doesn't attribute fumbles) — compare
   *  against `ints`, not this. */
  giveaways: number;
  /** Interceptions-thrown only — the apples-to-apples giveaway bar. */
  ints: number;
  homeWinPct: number;
  /** Season wins normalized to 17 games (ties = 0.5). */
  wins17: DistStat;
  pythRmse: number;
  coupling: { passDelta: number; rushDelta: number; giveawayDelta: number };
  doubleEntryViolations: number;
}

// ── Real side ────────────────────────────────────────────────────────────────

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureCsv(url: string, path: string, label: string): Promise<string> {
  await mkdir(DATA_DIR, { recursive: true });
  if (await exists(path)) return readFile(path, 'utf8');
  process.stdout.write(`  fetching ${label}…`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${label} → HTTP ${res.status}`);
  const csv = await res.text();
  await writeFile(path, csv, 'utf8');
  process.stdout.write(` ${(csv.length / 1e6).toFixed(1)}MB\n`);
  return csv;
}

interface RealGame {
  season: number;
  week: number;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
}

async function loadRealGames(): Promise<RealGame[]> {
  const csv = await ensureCsv(GAMES_URL, GAMES_PATH, 'nfldata games.csv');
  const out: RealGame[] = [];
  for (const row of csvRows(csv)) {
    const season = csvNum(row.get('season'));
    const hs = csvNum(row.get('home_score'));
    const as = csvNum(row.get('away_score'));
    if (season === null || hs === null || as === null) continue;
    if (season < START_YEAR || season > END_YEAR) continue;
    if (row.get('game_type') !== 'REG') continue;
    out.push({
      season,
      week: csvNum(row.get('week')) ?? 0,
      homeTeam: row.get('home_team') ?? '',
      awayTeam: row.get('away_team') ?? '',
      homeScore: hs,
      awayScore: as,
    });
  }
  return out;
}

async function computeRealBar(): Promise<Bar> {
  const games = await loadRealGames();

  // Game-derived: points, home win%, season records, pythagorean.
  const points: number[] = [];
  let homeWins = 0;
  let decided = 0;
  const seasonTeam = new Map<string, { wins: number; games: number; pf: number; pa: number }>();
  const resultIndex = new Map<string, boolean | null>(); // season|week|team → won
  for (const g of games) {
    points.push(g.homeScore, g.awayScore);
    const tie = g.homeScore === g.awayScore;
    if (!tie) {
      decided++;
      if (g.homeScore > g.awayScore) homeWins++;
    }
    for (const [team, pf, pa] of [
      [g.homeTeam, g.homeScore, g.awayScore],
      [g.awayTeam, g.awayScore, g.homeScore],
    ] as const) {
      const k = `${g.season}|${team}`;
      const t = seasonTeam.get(k) ?? { wins: 0, games: 0, pf: 0, pa: 0 };
      t.games++;
      t.pf += pf;
      t.pa += pa;
      t.wins += pf > pa ? 1 : tie ? 0.5 : 0;
      seasonTeam.set(k, t);
      resultIndex.set(`${g.season}|${g.week}|${team}`, tie ? null : pf > pa);
    }
  }
  const wins17: number[] = [];
  const pythErr: number[] = [];
  for (const t of seasonTeam.values()) {
    const w = (t.wins / t.games) * 17;
    wins17.push(w);
    const pyth = (t.pf ** PYTH_EXP / (t.pf ** PYTH_EXP + t.pa ** PYTH_EXP)) * 17;
    pythErr.push(w - pyth);
  }

  // Team-week-derived: box-score envelope + coupling + double-entry.
  const passYds: number[] = [];
  const rushYds: number[] = [];
  const attempts: number[] = [];
  let compSum = 0;
  let attSum = 0;
  let sacksSum = 0;
  let givSum = 0;
  let intSum = 0;
  let rows = 0;
  let deViolations = 0;
  const winSide = {
    pass: [0, 0] as [number, number],
    rush: [0, 0] as [number, number],
    giv: [0, 0] as [number, number],
    wn: 0,
    ln: 0,
  };
  for (let y = START_YEAR; y <= END_YEAR; y++) {
    const csv = await ensureCsv(teamWeekUrl(y), teamWeekPath(y), `stats_team_week_${y}`);
    for (const row of csvRows(csv)) {
      if (row.get('season_type') !== 'REG') continue;
      const py = csvNum(row.get('passing_yards')) ?? 0;
      const ry = csvNum(row.get('rushing_yards')) ?? 0;
      const recv = csvNum(row.get('receiving_yards')) ?? 0;
      const att = csvNum(row.get('attempts')) ?? 0;
      const comp = csvNum(row.get('completions')) ?? 0;
      const ints = csvNum(row.get('passing_interceptions')) ?? 0;
      const giv =
        ints +
        (csvNum(row.get('sack_fumbles_lost')) ?? 0) +
        (csvNum(row.get('rushing_fumbles_lost')) ?? 0) +
        (csvNum(row.get('receiving_fumbles_lost')) ?? 0);
      rows++;
      passYds.push(py);
      rushYds.push(ry);
      attempts.push(att);
      compSum += comp;
      attSum += att;
      sacksSum += csvNum(row.get('sacks_suffered')) ?? 0;
      givSum += giv;
      intSum += ints;
      if (py !== recv) deViolations++;
      const won = resultIndex.get(`${row.get('season')}|${csvNum(row.get('week'))}|${row.get('team')}`);
      if (won === true) {
        winSide.pass[0] += py;
        winSide.rush[0] += ry;
        winSide.giv[0] += giv;
        winSide.wn++;
      } else if (won === false) {
        winSide.pass[1] += py;
        winSide.rush[1] += ry;
        winSide.giv[1] += giv;
        winSide.ln++;
      }
    }
  }

  return {
    teamGames: rows,
    points: dist(points),
    passYds: dist(passYds),
    rushYds: dist(rushYds),
    attempts: dist(attempts),
    compPct: (100 * compSum) / Math.max(1, attSum),
    sacksSuffered: sacksSum / Math.max(1, rows),
    giveaways: givSum / Math.max(1, rows),
    ints: intSum / Math.max(1, rows),
    homeWinPct: (100 * homeWins) / Math.max(1, decided),
    wins17: dist(wins17),
    pythRmse: Math.sqrt(pythErr.reduce((a, b) => a + b * b, 0) / Math.max(1, pythErr.length)),
    coupling: {
      passDelta: winSide.pass[0]! / Math.max(1, winSide.wn) - winSide.pass[1]! / Math.max(1, winSide.ln),
      rushDelta: winSide.rush[0]! / Math.max(1, winSide.wn) - winSide.rush[1]! / Math.max(1, winSide.ln),
      giveawayDelta: winSide.giv[0]! / Math.max(1, winSide.wn) - winSide.giv[1]! / Math.max(1, winSide.ln),
    },
    doubleEntryViolations: deViolations,
  };
}

// ── Sim side (seed-parallel workers, cached like the Goatinator) ─────────────

interface SeedResult {
  seed: string;
  years: number;
  result: SkSimResult;
}

async function runWorkers(years: number, numSeeds: number): Promise<SeedResult[]> {
  await mkdir(SK_DIR, { recursive: true });
  const seeds = Array.from({ length: numSeeds }, (_, i) => `sk-${i + 1}`);
  const entry = fileURLToPath(import.meta.url);
  const pending = [];
  for (const seed of seeds) {
    const file = resolve(SK_DIR, `${seed}-${years}.json`);
    if (!(await exists(file))) pending.push(seed);
  }
  const concurrency = Math.min(8, Math.max(1, cpus().length - 2));
  console.log(
    `\nGMSim: ${numSeeds} seeds × ${years} seasons (${pending.length} to simulate, ${concurrency} workers, cached in data/scorekeeper/)…`,
  );
  let done = 0;
  const startedAt = Date.now();
  const runOne = (seed: string): Promise<void> =>
    new Promise((res, rej) => {
      const child = spawn(process.execPath, [entry, 'worker', seed, String(years)], {
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      child.on('exit', (code) => {
        done++;
        const mins = (Date.now() - startedAt) / 60000;
        console.log(`  [${done}/${pending.length}] ${seed} done (${mins.toFixed(1)}m elapsed)`);
        code === 0 ? res() : rej(new Error(`${seed} → exit ${code}`));
      });
    });
  const queue = [...pending];
  const lanes = Array.from({ length: concurrency }, async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      await runOne(next);
    }
  });
  await Promise.all(lanes);
  if (pending.length === 0) console.log('  all seeds already cached');

  const results: SeedResult[] = [];
  for (const seed of seeds) {
    const file = resolve(SK_DIR, `${seed}-${years}.json`);
    results.push(JSON.parse(await readFile(file, 'utf8')) as SeedResult);
  }
  return results;
}

async function workerMain(seed: string, years: number): Promise<void> {
  const result = await simulateBoxScores(seed, years);
  await mkdir(SK_DIR, { recursive: true });
  await writeFile(
    resolve(SK_DIR, `${seed}-${years}.json`),
    JSON.stringify({ seed, years, result } satisfies SeedResult),
  );
}

function computeSimBar(results: SeedResult[]): Bar {
  const games = results.flatMap((r) => r.result.games);
  const seasons = results.flatMap((r) => r.result.seasons);

  const points = games.map((g) => g.points);
  let homeWins = 0;
  let decided = 0;
  let compSum = 0;
  let attSum = 0;
  let sacksSum = 0;
  let givSum = 0;
  const winSide = {
    pass: [0, 0] as [number, number],
    rush: [0, 0] as [number, number],
    giv: [0, 0] as [number, number],
    wn: 0,
    ln: 0,
  };
  for (const g of games) {
    if (g.points !== g.oppPoints) {
      if (g.home) {
        decided++;
        if (g.points > g.oppPoints) homeWins++;
      }
      const w = g.points > g.oppPoints;
      winSide.pass[w ? 0 : 1] += g.passYds;
      winSide.rush[w ? 0 : 1] += g.rushYds;
      winSide.giv[w ? 0 : 1] += g.giveaways;
      if (w) winSide.wn++;
      else winSide.ln++;
    }
    compSum += g.passCompletions;
    attSum += g.passAttempts;
    sacksSum += g.sacksSuffered;
    givSum += g.giveaways;
  }
  const wins17: number[] = [];
  const pythErr: number[] = [];
  for (const t of seasons) {
    const w = (t.wins / Math.max(1, t.games)) * 17;
    wins17.push(w);
    const pyth = (t.pf ** PYTH_EXP / (t.pf ** PYTH_EXP + t.pa ** PYTH_EXP)) * 17;
    pythErr.push(w - pyth);
  }

  return {
    teamGames: games.length,
    points: dist(points),
    passYds: dist(games.map((g) => g.passYds)),
    rushYds: dist(games.map((g) => g.rushYds)),
    attempts: dist(games.map((g) => g.passAttempts)),
    compPct: (100 * compSum) / Math.max(1, attSum),
    sacksSuffered: sacksSum / Math.max(1, games.length),
    giveaways: givSum / Math.max(1, games.length),
    ints: givSum / Math.max(1, games.length), // GMSim box turnovers ARE the INTs
    homeWinPct: (100 * homeWins) / Math.max(1, decided),
    wins17: dist(wins17),
    pythRmse: Math.sqrt(pythErr.reduce((a, b) => a + b * b, 0) / Math.max(1, pythErr.length)),
    coupling: {
      passDelta: winSide.pass[0]! / Math.max(1, winSide.wn) - winSide.pass[1]! / Math.max(1, winSide.ln),
      rushDelta: winSide.rush[0]! / Math.max(1, winSide.wn) - winSide.rush[1]! / Math.max(1, winSide.ln),
      giveawayDelta: winSide.giv[0]! / Math.max(1, winSide.wn) - winSide.giv[1]! / Math.max(1, winSide.ln),
    },
    doubleEntryViolations: results.reduce((a, r) => a + r.result.doubleEntryViolations, 0),
  };
}

// ── Reports ──────────────────────────────────────────────────────────────────

const f1 = (v: number): string => v.toFixed(1);

function reportReal(bar: Bar): void {
  console.log(
    `\n=== THE SCOREKEEPER — real per-game stats & results (nflverse, REG ${START_YEAR}-${END_YEAR}) ===`,
  );
  console.log(`team-games: ${bar.teamGames}`);
  console.log(`  points/game:        ${f1(bar.points.mean)} ± ${f1(bar.points.sd)} (p5 ${bar.points.p5}, p95 ${bar.points.p95})`);
  console.log(`  pass yds/game:      ${f1(bar.passYds.mean)} ± ${f1(bar.passYds.sd)} (p5 ${bar.passYds.p5}, p95 ${bar.passYds.p95})`);
  console.log(`  rush yds/game:      ${f1(bar.rushYds.mean)} ± ${f1(bar.rushYds.sd)}`);
  console.log(`  pass att/game:      ${f1(bar.attempts.mean)} · comp ${f1(bar.compPct)}%`);
  console.log(`  sacks suffered:     ${f1(bar.sacksSuffered)} · giveaways ${f1(bar.giveaways)} (INTs only: ${f1(bar.ints)})`);
  console.log(`  home win%:          ${f1(bar.homeWinPct)}`);
  console.log(`  season wins (17g):  sd ${f1(bar.wins17.sd)} · p5 ${f1(bar.wins17.p5)} · p95 ${f1(bar.wins17.p95)}`);
  console.log(`  pythagorean RMSE:   ${bar.pythRmse.toFixed(2)} wins (exp ${PYTH_EXP})`);
  console.log(
    `  winners vs losers:  pass +${f1(bar.coupling.passDelta)} · rush +${f1(bar.coupling.rushDelta)} · giveaways ${f1(bar.coupling.giveawayDelta)}`,
  );
  console.log(`  double-entry:       passing != receiving in ${bar.doubleEntryViolations}/${bar.teamGames} rows`);
}

interface Check {
  label: string;
  real: number;
  sim: number;
  lo: number;
  hi: number;
}

function reportCompare(real: Bar, sim: Bar): void {
  console.log(`\n=== GMSim vs real — ${sim.teamGames} sim team-games ===`);
  const checks: Check[] = [
    { label: 'points/game mean', real: real.points.mean, sim: sim.points.mean, lo: real.points.mean - 2, hi: real.points.mean + 2 },
    { label: 'points/game sd', real: real.points.sd, sim: sim.points.sd, lo: real.points.sd - 3, hi: real.points.sd + 3 },
    { label: 'pass yds mean', real: real.passYds.mean, sim: sim.passYds.mean, lo: real.passYds.mean - 25, hi: real.passYds.mean + 25 },
    { label: 'pass yds sd', real: real.passYds.sd, sim: sim.passYds.sd, lo: real.passYds.sd - 20, hi: real.passYds.sd + 20 },
    { label: 'rush yds mean', real: real.rushYds.mean, sim: sim.rushYds.mean, lo: real.rushYds.mean - 20, hi: real.rushYds.mean + 20 },
    { label: 'rush yds sd', real: real.rushYds.sd, sim: sim.rushYds.sd, lo: real.rushYds.sd - 18, hi: real.rushYds.sd + 18 },
    { label: 'pass att mean', real: real.attempts.mean, sim: sim.attempts.mean, lo: real.attempts.mean - 4, hi: real.attempts.mean + 4 },
    { label: 'completion %', real: real.compPct, sim: sim.compPct, lo: real.compPct - 3, hi: real.compPct + 3 },
    { label: 'sacks suffered', real: real.sacksSuffered, sim: sim.sacksSuffered, lo: real.sacksSuffered - 0.8, hi: real.sacksSuffered + 0.8 },
    { label: 'INTs thrown/game', real: real.ints, sim: sim.ints, lo: real.ints - 0.35, hi: real.ints + 0.35 },
    { label: 'home win %', real: real.homeWinPct, sim: sim.homeWinPct, lo: real.homeWinPct - 5, hi: real.homeWinPct + 5 },
    { label: 'season wins sd', real: real.wins17.sd, sim: sim.wins17.sd, lo: real.wins17.sd - 0.9, hi: real.wins17.sd + 0.9 },
    { label: 'season wins p5', real: real.wins17.p5, sim: sim.wins17.p5, lo: real.wins17.p5 - 2, hi: real.wins17.p5 + 2 },
    { label: 'season wins p95', real: real.wins17.p95, sim: sim.wins17.p95, lo: real.wins17.p95 - 2, hi: real.wins17.p95 + 2 },
    { label: 'pythagorean RMSE', real: real.pythRmse, sim: sim.pythRmse, lo: 0.7, hi: 2.5 },
    { label: 'W-L pass delta', real: real.coupling.passDelta, sim: sim.coupling.passDelta, lo: -10, hi: 32 },
    { label: 'W-L rush delta', real: real.coupling.rushDelta, sim: sim.coupling.rushDelta, lo: 15, hi: 55 },
    { label: 'W-L giveaway delta', real: real.coupling.giveawayDelta, sim: sim.coupling.giveawayDelta, lo: -1.6, hi: -0.3 },
    { label: 'double-entry violations', real: 0, sim: sim.doubleEntryViolations, lo: 0, hi: 0 },
  ];
  console.log(`  ${'check'.padEnd(24)} ${'real'.padStart(8)} ${'gmsim'.padStart(8)}   band`);
  for (const c of checks) {
    const flag = c.sim < c.lo || c.sim > c.hi ? '  <-- DRIFT' : '';
    console.log(
      `  ${c.label.padEnd(24)} ${f1(c.real).padStart(8)} ${f1(c.sim).padStart(8)}   [${f1(c.lo)}, ${f1(c.hi)}]${flag}`,
    );
  }
  console.log(
    '\n  notes: GMSim box "giveaways" are INTs only (drive sim does not attribute',
  );
  console.log(
    '  fumbles to players) — compared against the real INT-only bar. The W-L',
  );
  console.log(
    '  coupling is the game-script signature: winners out-rush losers late;',
  );
  console.log('  pass volume must NOT strongly predict winning.');
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === 'worker') {
    await workerMain(process.argv[3] ?? 'sk-1', Number(process.argv[4]) || 6);
    return;
  }
  const real = await computeRealBar();
  reportReal(real);
  if (mode === 'sim') {
    const years = Number(process.argv[3]) || 6;
    const numSeeds = Number(process.argv[4]) || 8;
    const results = await runWorkers(years, numSeeds);
    reportCompare(real, computeSimBar(results));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
