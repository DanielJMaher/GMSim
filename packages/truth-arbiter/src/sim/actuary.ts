import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DATA_DIR } from '../lib/config.js';
import { splitCsvLine } from '../lib/csv.js';

/**
 * THE ACTUARY — the AGING / development-realism authority (agent #7,
 * 2026-06-10, Daniel-directed).
 *
 * Sibling to the Liquidator (cap), Magistrate (drives), Skill Adjudicator
 * (talent tiers), Ombudsman (media spread) and Barterer (trades). The Actuary
 * polices CAREERS: how players grow, peak, decline, get hurt, and exit, per
 * position — the realism bar for the engine's progression/regression system.
 *
 * Trigger (2026-06-10): the inspector Histograms tab showed the rostered
 * overall distribution ratcheting upward season over season. Instrumentation
 * confirmed the engine's development system never declines technical/mental
 * skills at any age, applies no per-position curves, and has no cliff — while
 * real RBs lose ~9-15%/yr from age 25 and everyone cliffs at 33-34.
 *
 * Data sources (open nflverse mirrors, disk-cached in data/, gitignored):
 *   - stats_player release: stats_player_reg_<year>.csv (2003-2024) —
 *     regular-season per-player production incl. defense.
 *   - players release: players.csv — birth dates + draft year (entry ages).
 *
 * What it emits:
 *   - A printed report (the calibration lens): qualifying-season and
 *     draft-entry age distributions, median YoY per-game production change by
 *     position x age, chained aging curves + peak ages, attrition by age,
 *     injury-shortened-season risk by age, career-shape taxonomy frequencies.
 *   - data/aging-baselines.json — the structured artifact the engine's
 *     aging-curve parameters (players/aging-curves.ts, slice S2) are derived
 *     from, with per-cell sample sizes + extrapolation flags.
 *
 * METRIC-SPACE COUPLING (important): the per-position production formulas
 * below deliberately MIRROR `packages/engine/src/season/development.ts`
 * `scorePerformance` (QB: yds + 25*td - 25*int; skill: yds + 50*td;
 * defense: tackles + 30*sacks + 60*ints). Slice A2 will run the sim and
 * compute THIS SAME table from sim seasonStats, so real and simulated aging
 * are compared apples-to-apples in production space. If the engine formulas
 * change, change these together.
 *
 * Methodology notes:
 *   - YoY deltas are WITHIN-PLAYER (survivor pairs with qualifying seasons in
 *     both years), which controls for roster survivorship far better than
 *     cross-sectional means.
 *   - "Qualifying" = games >= 8 AND a per-position volume floor — this is the
 *     "avoid injury-shortened seasons" filter; availability itself is
 *     measured separately (injury-shortened risk + attrition).
 *   - Cells need n >= 12 pairs to be treated as reliable. There is almost no
 *     data below age 22 (age-20 contributor seasons are ~0.13% of the league)
 *     so sub-22 chained-curve cells are flagged `extrapolated` — the engine
 *     must extrapolate early growth from the 22-24 slope, not read it here.
 *
 *   pnpm --filter @gmsim/truth-arbiter run actuary          # cached data
 *   pnpm --filter @gmsim/truth-arbiter run actuary fresh    # force re-download
 *
 * Slice A1 (this): real baselines + report + artifact.
 * Slice A2 (with engine slice S2): sim-side probe — same YoY table from sim
 * seasonStats vs these baselines, drift markers, joins `run gates`.
 */

const YEARS: readonly number[] = Array.from({ length: 2024 - 2003 + 1 }, (_, i) => 2003 + i);

const STATS_URL = (year: number): string =>
  `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_reg_${year}.csv`;
const PLAYERS_URL =
  'https://github.com/nflverse/nflverse-data/releases/download/players/players.csv';
const PLAYERS_PATH = resolve(DATA_DIR, 'players_master.csv');
const BASELINES_PATH = resolve(DATA_DIR, 'aging-baselines.json');

/** Actuary position buckets (production-measurable; OL has no stats). */
const POS = ['QB', 'RB', 'WR', 'TE', 'EDGE', 'IDL', 'LB', 'CB', 'S'] as const;
type Pos = (typeof POS)[number];

/** Minimum YoY pairs for a cell to be considered reliable. */
const MIN_PAIRS = 12;
/** Minimum games in a season to qualify (the injury-shortened filter). */
const MIN_GAMES = 8;

// ── fetch + cache ───────────────────────────────────────────────────────────

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function loadCached(url: string, path: string, force: boolean): Promise<string> {
  await mkdir(DATA_DIR, { recursive: true });
  if (!force && (await exists(path))) return readFile(path, 'utf8');
  process.stdout.write(`  fetching ${url.split('/').pop()}…`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const csv = await res.text();
  await writeFile(path, csv, 'utf8');
  console.log(` ${(csv.length / 1024 / 1024).toFixed(1)}MB`);
  return csv;
}

// ── parsing ─────────────────────────────────────────────────────────────────

interface CsvTable {
  idx: Record<string, number>;
  rows: string[][];
}

function parseCsv(text: string): CsvTable {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = splitCsvLine(lines[0] ?? '');
  const idx: Record<string, number> = {};
  header.forEach((h, i) => {
    idx[h] = i;
  });
  return { idx, rows: lines.slice(1).map(splitCsvLine) };
}

function mapPos(p: string): Pos | null {
  switch (p) {
    case 'QB':
      return 'QB';
    case 'RB':
      return 'RB';
    case 'WR':
      return 'WR';
    case 'TE':
      return 'TE';
    case 'DE':
    case 'OLB':
      return 'EDGE';
    case 'DT':
    case 'NT':
      return 'IDL';
    case 'ILB':
    case 'MLB':
    case 'LB':
      return 'LB';
    case 'CB':
      return 'CB';
    case 'FS':
    case 'SS':
    case 'S':
      return 'S';
    default:
      return null;
  }
}

/** Age on Sep 1 of `season` (the NFL convention). */
function ageAt(birthDate: string, season: number): number {
  const b = new Date(birthDate + 'T00:00:00Z');
  let a = season - b.getUTCFullYear();
  if (b.getUTCMonth() > 8 || (b.getUTCMonth() === 8 && b.getUTCDate() > 1)) a--;
  return a;
}

interface SeasonEntry {
  pos: Pos;
  age: number;
  games: number;
  /** Per-game production score (engine scorePerformance metric space). */
  pg: number;
  qual: boolean;
}

// ── stats helpers ───────────────────────────────────────────────────────────

function median(arr: readonly number[]): number {
  if (arr.length === 0) return NaN;
  const s = [...arr].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const pad = (s: unknown, w: number): string => String(s).padStart(w);

// ── baselines artifact shape ────────────────────────────────────────────────

interface AgingBaselines {
  meta: {
    generatedAt: string;
    seasons: [number, number];
    rowsIngested: number;
    players: number;
    minGames: number;
    minPairs: number;
    formulaNote: string;
  };
  qualifyingAgeDistribution: Record<string, { n: number; share: number }>;
  entryAgeDistribution: Record<string, { n: number; share: number }>;
  minQualifyingAgeByPos: Record<string, number>;
  positions: Record<
    string,
    {
      peakAge: number;
      /** age -> median YoY per-game production ratio (e.g. 0.91 = -9%). */
      yoy: Record<string, { medianRatio: number; n: number; reliable: boolean }>;
      /** age -> chained index (100 = peak). */
      chained: Record<string, { index: number; extrapolated: boolean }>;
      /** age-at-s -> P(no qualifying season s+1). */
      attrition: Record<string, { rate: number; n: number }>;
    }
  >;
  injuryShortenedByAge: Record<string, { rate: number; n: number }>;
  careerShapes: Record<string, Record<string, { n: number; share: number }>>;
}

// ── main ────────────────────────────────────────────────────────────────────

async function buildRealBaselines(force: boolean, quiet = false): Promise<AgingBaselines> {
  const log: (...args: unknown[]) => void = quiet ? () => undefined : console.log;

  log('\nTHE ACTUARY — real-NFL aging baselines (2003-2024)');
  log('='.repeat(72));

  // 1) load players master (birth dates + draft years)
  const pmText = await loadCached(PLAYERS_URL, PLAYERS_PATH, force);
  const pm = parseCsv(pmText);
  const birth = new Map<string, string>();
  const iGsis = pm.idx['gsis_id'] ?? -1;
  const iBirth = pm.idx['birth_date'] ?? -1;
  const iDraftYear = pm.idx['draft_year'] ?? -1;
  const entryHist = new Map<number, number>();
  let entryN = 0;
  for (const r of pm.rows) {
    const id = r[iGsis];
    const bd = r[iBirth];
    if (id && bd) birth.set(id, bd);
    const dy = Number(r[iDraftYear]);
    if (bd && Number.isFinite(dy) && dy >= 2003 && dy <= 2024) {
      const a = ageAt(bd, dy);
      if (a >= 18 && a <= 30) {
        entryHist.set(a, (entryHist.get(a) ?? 0) + 1);
        entryN++;
      }
    }
  }

  // 2) load per-season stats, build careers
  const careers = new Map<string, Map<number, SeasonEntry>>();
  let rowsIngested = 0;
  for (const year of YEARS) {
    const text = await loadCached(
      STATS_URL(year),
      resolve(DATA_DIR, `stats_player_reg_${year}.csv`),
      force,
    );
    const { idx, rows } = parseCsv(text);
    const num = (r: string[], k: string): number => {
      const i = idx[k];
      if (i === undefined) return 0;
      const v = Number(r[i]);
      return Number.isFinite(v) ? v : 0;
    };
    for (const r of rows) {
      const id = r[idx['player_id'] ?? -1];
      const season = num(r, 'season');
      const pos = mapPos(r[idx['position'] ?? -1] ?? '');
      if (!id || !pos || !season) continue;
      const bd = birth.get(id);
      if (!bd) continue;
      const age = ageAt(bd, season);
      if (age < 18 || age > 45) continue;
      const games = num(r, 'games');

      const passY = num(r, 'passing_yards');
      const passTd = num(r, 'passing_tds');
      const passInt = num(r, 'passing_interceptions');
      const att = num(r, 'attempts');
      const rushY = num(r, 'rushing_yards');
      const rushTd = num(r, 'rushing_tds');
      const carries = num(r, 'carries');
      const recY = num(r, 'receiving_yards');
      const recTd = num(r, 'receiving_tds');
      const rec = num(r, 'receptions');
      const tgt = num(r, 'targets');
      const comb = num(r, 'def_tackles_solo') + num(r, 'def_tackle_assists');
      const sacks = num(r, 'def_sacks');
      const dInt = num(r, 'def_interceptions');
      const pd = num(r, 'def_pass_defended');

      let raw = 0;
      let qualVol = false;
      if (pos === 'QB') {
        raw = passY + 25 * passTd - 25 * passInt;
        qualVol = att >= 150;
      } else if (pos === 'RB' || pos === 'WR' || pos === 'TE') {
        raw = rushY + recY + 50 * (rushTd + recTd);
        qualVol = pos === 'RB' ? carries + rec >= 80 : pos === 'WR' ? tgt >= 40 : tgt >= 30;
      } else {
        raw = comb + 30 * sacks + 60 * dInt;
        qualVol =
          pos === 'EDGE'
            ? comb >= 20 || sacks >= 4
            : pos === 'IDL'
              ? comb >= 20
              : pos === 'LB'
                ? comb >= 40
                : comb >= 30 || dInt + pd >= 6;
      }
      const pg = games > 0 ? raw / games : 0;
      const qual = qualVol && games >= MIN_GAMES && pg > 0;

      let m = careers.get(id);
      if (!m) {
        m = new Map();
        careers.set(id, m);
      }
      m.set(season, { pos, age, games, pg, qual });
      rowsIngested++;
    }
  }
  log(`rows ingested: ${rowsIngested}  players: ${careers.size}  seasons: ${YEARS.length}`);

  // 3) aggregate
  const qualAgeHist = new Map<number, number>();
  const minAgeByPos = new Map<Pos, number>();
  let totalQual = 0;
  const yoy = new Map<Pos, Map<number, number[]>>(POS.map((p) => [p, new Map()]));
  const attrDen = new Map<Pos, Map<number, number>>(POS.map((p) => [p, new Map()]));
  const attrNum = new Map<Pos, Map<number, number>>(POS.map((p) => [p, new Map()]));
  const injDen = new Map<number, number>();
  const injNum = new Map<number, number>();

  for (const [, seasons] of careers) {
    for (const [season, cur] of seasons) {
      if (!cur.qual) continue;
      totalQual++;
      qualAgeHist.set(cur.age, (qualAgeHist.get(cur.age) ?? 0) + 1);
      const prevMin = minAgeByPos.get(cur.pos);
      if (prevMin === undefined || cur.age < prevMin) minAgeByPos.set(cur.pos, cur.age);

      const nxt = seasons.get(season + 1);
      const aMap = attrDen.get(cur.pos)!;
      aMap.set(cur.age, (aMap.get(cur.age) ?? 0) + 1);
      if (!nxt || !nxt.qual) {
        const nMap = attrNum.get(cur.pos)!;
        nMap.set(cur.age, (nMap.get(cur.age) ?? 0) + 1);
      }
      if (nxt) {
        injDen.set(cur.age, (injDen.get(cur.age) ?? 0) + 1);
        if (nxt.games <= MIN_GAMES) injNum.set(cur.age, (injNum.get(cur.age) ?? 0) + 1);
      }
      if (nxt && nxt.qual && nxt.pos === cur.pos) {
        const ageMap = yoy.get(cur.pos)!;
        const arr = ageMap.get(nxt.age) ?? [];
        arr.push(nxt.pg / cur.pg);
        ageMap.set(nxt.age, arr);
      }
    }
  }

  // ── report + artifact ─────────────────────────────────────────────────────
  const AGES_INTO: number[] = [];
  for (let a = 20; a <= 36; a++) AGES_INTO.push(a);
  const AGES_AT: number[] = [];
  for (let a = 20; a <= 35; a++) AGES_AT.push(a);

  const baselines: AgingBaselines = {
    meta: {
      generatedAt: new Date().toISOString(),
      seasons: [YEARS[0]!, YEARS[YEARS.length - 1]!],
      rowsIngested,
      players: careers.size,
      minGames: MIN_GAMES,
      minPairs: MIN_PAIRS,
      formulaNote:
        'Production formulas mirror engine season/development.ts scorePerformance ' +
        '(QB yds+25td-25int; skill yds+50td; def tackles+30sacks+60ints), per-game. ' +
        'YoY = within-player survivor pairs, both seasons qualifying.',
    },
    qualifyingAgeDistribution: {},
    entryAgeDistribution: {},
    minQualifyingAgeByPos: {},
    positions: {},
    injuryShortenedByAge: {},
    careerShapes: {},
  };

  log('\n=== Age distribution of qualifying contributor seasons ===');
  for (const a of [...qualAgeHist.keys()].sort((x, y) => x - y)) {
    const n = qualAgeHist.get(a)!;
    baselines.qualifyingAgeDistribution[String(a)] = { n, share: n / totalQual };
    log(`age ${pad(a, 2)}: ${pad(n, 5)}  (${((n / totalQual) * 100).toFixed(2)}%)`);
  }
  for (const p of POS) {
    const m = minAgeByPos.get(p);
    if (m !== undefined) baselines.minQualifyingAgeByPos[p] = m;
  }
  log(
    'min qualifying age by pos: ' + POS.map((p) => `${p}=${minAgeByPos.get(p) ?? '—'}`).join('  '),
  );

  log('\n=== Draft-entry age distribution (drafted 2003-2024, age at Sep 1 of rookie season) ===');
  for (const a of [...entryHist.keys()].sort((x, y) => x - y)) {
    const n = entryHist.get(a)!;
    baselines.entryAgeDistribution[String(a)] = { n, share: n / entryN };
    log(`age ${pad(a, 2)}: ${pad(n, 5)}  (${((n / entryN) * 100).toFixed(1)}%)`);
  }

  log('\n=== Median YoY per-game production change (%) by position x age (age = turning into) ===');
  log('pos   ' + AGES_INTO.map((a) => pad(a, 7)).join(''));
  for (const p of POS) {
    const cells = AGES_INTO.map((a) => {
      const arr = yoy.get(p)!.get(a);
      if (!arr || arr.length < MIN_PAIRS) return pad('—', 7);
      const m = (median(arr) - 1) * 100;
      return pad((m >= 0 ? '+' : '') + m.toFixed(1), 7);
    });
    log(p.padEnd(6) + cells.join(''));
  }
  log('pair counts:');
  for (const p of POS) {
    log(p.padEnd(6) + AGES_INTO.map((a) => pad(yoy.get(p)!.get(a)?.length ?? 0, 7)).join(''));
  }

  log('\n=== Chained aging curve (median YoY ratios; 100 = peak; * = extrapolated/no data) ===');
  log('pos   ' + AGES_INTO.map((a) => pad(a, 7)).join('') + '  peakAge');
  for (const p of POS) {
    let level = 1;
    const curve: { age: number; level: number; hasData: boolean }[] = [
      { age: 20, level: 1, hasData: false },
    ];
    for (let a = 21; a <= 36; a++) {
      const arr = yoy.get(p)!.get(a);
      const reliable = arr !== undefined && arr.length >= MIN_PAIRS;
      if (reliable) level *= median(arr);
      curve.push({ age: a, level, hasData: reliable });
    }
    const max = Math.max(...curve.map((c) => c.level));
    const peakAge = curve.find((c) => c.level === max)!.age;

    const posEntry: AgingBaselines['positions'][string] = {
      peakAge,
      yoy: {},
      chained: {},
      attrition: {},
    };
    // a cell is extrapolated until the first reliable ratio and after the last
    const firstData = curve.find((c) => c.hasData)?.age ?? 99;
    const lastData = [...curve].reverse().find((c) => c.hasData)?.age ?? 0;
    const cells = curve.map((c) => {
      const idx100 = (c.level / max) * 100;
      const extrapolated = c.age < firstData || c.age > lastData;
      posEntry.chained[String(c.age)] = { index: idx100, extrapolated };
      return pad(idx100.toFixed(0) + (extrapolated ? '*' : ''), 7);
    });
    for (const a of AGES_INTO) {
      const arr = yoy.get(p)!.get(a);
      if (arr && arr.length >= 3) {
        posEntry.yoy[String(a)] = {
          medianRatio: median(arr),
          n: arr.length,
          reliable: arr.length >= MIN_PAIRS,
        };
      }
    }
    for (const a of AGES_AT) {
      const d = attrDen.get(p)!.get(a) ?? 0;
      if (d >= 15) {
        posEntry.attrition[String(a)] = { rate: (attrNum.get(p)!.get(a) ?? 0) / d, n: d };
      }
    }
    baselines.positions[p] = posEntry;
    log(p.padEnd(6) + cells.join('') + pad(peakAge, 9));
  }

  log('\n=== Attrition: P(no qualifying season s+1 | qualified at s) by position x age (%) ===');
  log('pos   ' + AGES_AT.map((a) => pad(a, 7)).join(''));
  for (const p of POS) {
    const cells = AGES_AT.map((a) => {
      const e = baselines.positions[p]!.attrition[String(a)];
      return pad(e ? (e.rate * 100).toFixed(0) : '—', 7);
    });
    log(p.padEnd(6) + cells.join(''));
  }

  log(`\n=== P(next season played but games <= ${MIN_GAMES} | qualified at s) by age (%) ===`);
  for (const a of AGES_AT) {
    const d = injDen.get(a) ?? 0;
    if (d < 30) continue;
    const rate = (injNum.get(a) ?? 0) / d;
    baselines.injuryShortenedByAge[String(a)] = { rate, n: d };
    log(`age ${pad(a, 2)}: ${pad((rate * 100).toFixed(1), 5)}%   (n=${d})`);
  }

  // career shapes
  log('\n=== Career shapes (players with >= 6 qualifying seasons) ===');
  const shapeCounts = new Map<string, number>();
  const groupOf = (p: Pos): string => (p === 'QB' ? 'QB' : p === 'RB' || p === 'WR' || p === 'TE' ? 'SKILL' : 'DEF');
  let shaped = 0;
  for (const [, seasons] of careers) {
    const quals = [...seasons.values()].filter((s) => s.qual).sort((a, b) => a.age - b.age);
    if (quals.length < 6) continue;
    shaped++;
    const peak = Math.max(...quals.map((q) => q.pg));
    const norm = quals.map((q) => ({ age: q.age, v: q.pg / peak }));
    const peakIdx = norm.findIndex((q) => q.v === 1);
    const peakAge = norm[peakIdx]!.age;
    const first2 = (norm[0]!.v + norm[1]!.v) / 2;
    const last2 = (norm[norm.length - 1]!.v + norm[norm.length - 2]!.v) / 2;

    let runMax = 0;
    let dipped = false;
    let secondPeak = false;
    for (const q of norm) {
      if (dipped && q.v >= 0.9) {
        secondPeak = true;
        break;
      }
      if (runMax > 0.85 && q.v < 0.7 * runMax) dipped = true;
      runMax = Math.max(runMax, q.v);
    }

    let shape: string;
    if (secondPeak) shape = 'SECOND_PEAK';
    else if (peakIdx <= 1 && last2 <= 0.55) shape = 'METEOR';
    else if (peakAge >= 28 && first2 <= 0.6) shape = 'LATE_BLOOMER';
    else if (first2 >= 0.85 && last2 >= 0.75) shape = 'PHENOM_SUSTAINED';
    else if (last2 >= 0.8) shape = 'EVERGREEN';
    else shape = 'CLASSIC_ARC';

    const key = `${groupOf(quals[0]!.pos)}:${shape}`;
    shapeCounts.set(key, (shapeCounts.get(key) ?? 0) + 1);
  }
  log(`players classified: ${shaped}`);
  for (const g of ['QB', 'SKILL', 'DEF']) {
    const entries = [...shapeCounts.entries()]
      .filter(([k]) => k.startsWith(g + ':'))
      .map(([k, n]) => ({ shape: k.slice(g.length + 1), n }))
      .sort((a, b) => b.n - a.n);
    const tot = entries.reduce((s, e) => s + e.n, 0);
    baselines.careerShapes[g] = {};
    log(`\n${g} (n=${tot}):`);
    for (const e of entries) {
      baselines.careerShapes[g]![e.shape] = { n: e.n, share: e.n / tot };
      log(`  ${pad(((e.n / tot) * 100).toFixed(0), 3)}%  ${e.shape}  (${e.n})`);
    }
  }

  await writeFile(BASELINES_PATH, JSON.stringify(baselines, null, 2), 'utf8');
  log(`\nwrote ${BASELINES_PATH}`);
  log(
    '\nNOTE: sub-22 cells are extrapolation territory (age-20 contributor seasons',
  );
  log(
    'are ~0.13% of the league) — engine curves must extend the 22-24 slope, not read sub-22 data.',
  );
  log('done.');
  return baselines;
}

// ── A2: the sim-side probe ──────────────────────────────────────────────────
//
// Forward-sims a GMSim league and recomputes THE SAME yoY-production-by-age
// table from simulated careers (identical formulas, thresholds, and games
// filter), then compares shape against the real baselines: per-position peak
// age, decline-region sign agreement, the QB plateau, the 33+ cliff, and
// draft-entry ages. `<-- DRIFT` markers feed `run gates`.

/** Sim cells need fewer pairs than real (one league, fewer seasons). */
const MIN_PAIRS_SIM = 10;

function mapEnginePos(p: string): Pos | null {
  switch (p) {
    case 'QB':
      return 'QB';
    case 'RB':
    case 'FB':
      return 'RB';
    case 'WR':
      return 'WR';
    case 'TE':
      return 'TE';
    case 'EDGE':
      return 'EDGE';
    case 'DT':
    case 'NT':
      return 'IDL';
    case 'ILB':
    case 'OLB':
      return 'LB';
    case 'CB':
    case 'NICKEL':
      return 'CB';
    case 'S':
      return 'S';
    default:
      return null; // OL + specialists have no production curve
  }
}

interface SimSeasonEntry {
  age: number;
  pg: number;
  qual: boolean;
}

function simSeasonEntry(
  pos: Pos,
  birthYear: number,
  s: import('../lib/engine-bridge.js').AgingCareerSeason,
): SimSeasonEntry {
  const age = 2026 + (s.seasonNumber - 1) - birthYear;
  let raw = 0;
  let qualVol = false;
  if (pos === 'QB') {
    raw = s.passingYards + 25 * s.passingTds - 25 * s.interceptionsThrown;
    qualVol = s.passAttempts >= 150;
  } else if (pos === 'RB' || pos === 'WR' || pos === 'TE') {
    raw = s.rushingYards + s.receivingYards + 50 * (s.rushingTds + s.receivingTds);
    qualVol =
      pos === 'RB'
        ? s.rushingAttempts + s.receptions >= 80
        : pos === 'WR'
          ? s.targets >= 40
          : s.targets >= 30;
  } else {
    raw = s.tackles + 30 * s.sacks + 60 * s.interceptions;
    // Sim tackle volume for interior DL runs far below the real
    // combined-tackles scale (rank-weighted draw is LB-heavy), so the IDL
    // floor is lowered to the sim's scale — otherwise IDL has ~no
    // qualifying pairs at all.
    qualVol =
      pos === 'EDGE'
        ? s.tackles >= 20 || s.sacks >= 4
        : pos === 'IDL'
          ? s.tackles >= 10 || s.sacks >= 3
          : pos === 'LB'
            ? s.tackles >= 40
            : s.tackles >= 30 || s.interceptions >= 3;
  }
  const pg = s.gamesPlayed > 0 ? raw / s.gamesPlayed : 0;
  return { age, pg, qual: qualVol && s.gamesPlayed >= MIN_GAMES && pg > 0 };
}

async function simProbe(
  baselines: AgingBaselines,
  years: number,
  seeds: readonly string[],
): Promise<void> {
  const { simulateAgingCareers } = await import('../lib/engine-bridge.js');
  console.log(
    `\nTHE ACTUARY (A2) — sim-vs-real aging probe  (${seeds.length} seed(s) x ${years} seasons)`,
  );
  console.log('='.repeat(72));
  const t0 = Date.now();
  // Pool careers across independent league seeds — single-league per-cell
  // samples (n~15-25) swing several points run to run, which flip-flops
  // drift flags on noise rather than signal.
  const sim = { careers: [] as Awaited<ReturnType<typeof simulateAgingCareers>>['careers'], entryAges: [] as number[], seasons: years };
  for (const seed of seeds) {
    const one = await simulateAgingCareers(seed, years);
    sim.careers.push(...one.careers);
    sim.entryAges.push(...one.entryAges);
  }
  console.log(
    `simulated ${seeds.length} league(s) x ${years} seasons — ${sim.careers.length} careers, ${sim.entryAges.length} in-sim draftees  (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
  );

  // YoY table from simulated careers (same method as the real side).
  const yoySim = new Map<Pos, Map<number, number[]>>(POS.map((p) => [p, new Map()]));
  for (const career of sim.careers) {
    const pos = mapEnginePos(career.position);
    if (!pos) continue;
    const bySeason = new Map(career.seasons.map((s) => [s.seasonNumber, s] as const));
    for (const s of career.seasons) {
      const nxt = bySeason.get(s.seasonNumber + 1);
      if (!nxt) continue;
      const cur = simSeasonEntry(pos, career.birthYear, s);
      const after = simSeasonEntry(pos, career.birthYear, nxt);
      if (!cur.qual || !after.qual) continue;
      const arr = yoySim.get(pos)!.get(after.age) ?? [];
      arr.push(after.pg / cur.pg);
      yoySim.get(pos)!.set(after.age, arr);
    }
  }

  const AGES_INTO: number[] = [];
  for (let a = 22; a <= 35; a++) AGES_INTO.push(a);

  console.log('\n=== Median YoY production change (%): real vs sim, by position x age ===');
  console.log('pos        ' + AGES_INTO.map((a) => pad(a, 7)).join(''));
  const flags: string[] = [];
  for (const p of POS) {
    const realCells = AGES_INTO.map((a) => {
      const e = baselines.positions[p]?.yoy[String(a)];
      if (!e || !e.reliable) return pad('—', 7);
      const m = (e.medianRatio - 1) * 100;
      return pad((m >= 0 ? '+' : '') + m.toFixed(1), 7);
    });
    const simCells = AGES_INTO.map((a) => {
      const arr = yoySim.get(p)!.get(a);
      if (!arr || arr.length < MIN_PAIRS_SIM) return pad('—', 7);
      const m = (median(arr) - 1) * 100;
      return pad((m >= 0 ? '+' : '') + m.toFixed(1), 7);
    });
    const totalPairs = [...yoySim.get(p)!.values()].reduce((s, a) => s + a.length, 0);
    console.log(`${p.padEnd(5)} real ` + realCells.join(''));
    console.log(`${''.padEnd(5)}  sim ` + simCells.join('') + `   (pairs=${totalPairs})`);

    // Drift check 1: sim peak age within ±1 of real, or inside the real
    // near-peak plateau (chained index >= 93 — EDGE-style plateaus make the
    // exact peak year noisy in real data too). Skipped on thin samples.
    // Peak search caps at 31: every real peak is <= 27, and a single noisy
    // late survivor cell shouldn't be able to set the sim argmax.
    let level = 1;
    let simPeakAge = 22;
    let best = 1;
    let reliableCells = 0;
    const simChained = new Map<number, number>([[22, 1]]);
    for (let a = 23; a <= 31; a++) {
      const arr = yoySim.get(p)!.get(a);
      if (arr && arr.length >= MIN_PAIRS_SIM) {
        level *= median(arr);
        reliableCells++;
      }
      simChained.set(a, level);
      if (level > best) {
        best = level;
        simPeakAge = a;
      }
    }
    const realPeak = baselines.positions[p]?.peakAge ?? 25;
    // Plateau-tolerant comparison, both directions: the sim peak landing on
    // a near-peak real age is fine (EDGE holds 95-97% for years), and a flat
    // sim curve that's still within ~12% of its own max at the real peak age
    // is fine too (QB-style plateaus make the argmax year noise).
    const realChainedAtSimPeak = baselines.positions[p]?.chained[String(simPeakAge)]?.index ?? 0;
    const simChainedAtRealPeak = ((simChained.get(realPeak) ?? 0) / best) * 100;
    const peakNote =
      reliableCells < 4
        ? 'n/a (thin sim sample)'
        : Math.abs(simPeakAge - realPeak) <= 1 ||
            realChainedAtSimPeak >= 93 ||
            simChainedAtRealPeak >= 88
          ? 'ok'
          : `<-- DRIFT (sim peak ${simPeakAge} vs real ${realPeak})`;
    // Drift check 2: pool EVERY sim pair across the position's real decline
    // region (real reliable cells <= -3%) and take one median — per-cell
    // medians at n~150 carry ±4-5pp confidence intervals that flip-flop
    // "violations" on noise. The pooled median must be clearly negative.
    const declinePool: number[] = [];
    let checkable = 0;
    for (const a of AGES_INTO) {
      const real = baselines.positions[p]?.yoy[String(a)];
      if (!real || !real.reliable || (real.medianRatio - 1) * 100 > -3) continue;
      const arr = yoySim.get(p)!.get(a);
      if (!arr || arr.length < MIN_PAIRS_SIM) continue;
      checkable++;
      declinePool.push(...arr);
    }
    const pooledPct = declinePool.length > 0 ? (median(declinePool) - 1) * 100 : NaN;
    const declineNote =
      checkable === 0
        ? 'n/a (thin sim sample)'
        : pooledPct <= -1
          ? `ok (pooled decline-region median ${pooledPct.toFixed(1)}%/yr over ${checkable} ages)`
          : `<-- DRIFT (pooled decline-region median ${pooledPct.toFixed(1)}%/yr — should be clearly negative)`;
    console.log(`${''.padEnd(11)}peak ${simPeakAge} vs ${realPeak}: ${peakNote}; decline: ${declineNote}`);
    if (peakNote.includes('DRIFT')) flags.push(`${p} peak age`);
    if (declineNote.includes('DRIFT')) flags.push(`${p} decline region`);
  }

  // Drift check 3: QB plateau — sim QB mean YoY across ages 29-32 >= -5%.
  const qbPlateau: number[] = [];
  for (let a = 29; a <= 32; a++) {
    const arr = yoySim.get('QB')!.get(a);
    if (arr && arr.length >= MIN_PAIRS_SIM) qbPlateau.push((median(arr) - 1) * 100);
  }
  if (qbPlateau.length > 0) {
    const mean = qbPlateau.reduce((s, v) => s + v, 0) / qbPlateau.length;
    const ok = mean >= -5;
    console.log(
      `\nQB plateau 29-32: sim mean ${mean >= 0 ? '+' : ''}${mean.toFixed(1)}%/yr ${ok ? '(ok — real holds ~93-100% of peak)' : '<-- DRIFT (real QBs hold to 32)'}`,
    );
    if (!ok) flags.push('QB plateau');
  }

  // Drift check 4: the 33+ cliff — pooled across NON-QB positions (QBs
  // legitimately age gently into the mid-30s; sim 33+ survivors are QB-heavy,
  // which would dilute the cliff signal the check exists to catch).
  const cliffRatios: number[] = [];
  for (const p of POS) {
    if (p === 'QB') continue;
    for (let a = 33; a <= 35; a++) {
      const arr = yoySim.get(p)!.get(a);
      if (arr) cliffRatios.push(...arr);
    }
  }
  if (cliffRatios.length >= 10) {
    const m = (median(cliffRatios) - 1) * 100;
    const ok = m <= -8;
    console.log(
      `33+ cliff (pooled non-QB, n=${cliffRatios.length}): sim median ${m.toFixed(1)}%/yr ${ok ? '(ok — real runs -20..-32)' : '<-- DRIFT (no late-career cliff)'}`,
    );
    if (!ok) flags.push('33+ cliff');
  } else {
    console.log(`33+ cliff: thin sim sample (n=${cliffRatios.length}) — n/a`);
  }

  // Drift check 5: draft-entry ages.
  if (sim.entryAges.length > 0) {
    const n = sim.entryAges.length;
    const share = (lo: number, hi: number): number =>
      sim.entryAges.filter((a) => a >= lo && a <= hi).length / n;
    const young = share(0, 21);
    const core = share(22, 23);
    const realYoung =
      (baselines.entryAgeDistribution['20']?.share ?? 0) +
      (baselines.entryAgeDistribution['21']?.share ?? 0);
    const realCore =
      (baselines.entryAgeDistribution['22']?.share ?? 0) +
      (baselines.entryAgeDistribution['23']?.share ?? 0);
    const ok = young <= realYoung * 2 && core >= realCore * 0.75;
    console.log(
      `entry ages: sim ≤21 ${(young * 100).toFixed(1)}% (real ${(realYoung * 100).toFixed(1)}%), 22-23 ${(core * 100).toFixed(1)}% (real ${(realCore * 100).toFixed(1)}%) ${ok ? '(ok)' : '<-- DRIFT (classes enter too young)'}`,
    );
    if (!ok) flags.push('entry ages');
  }

  console.log(
    flags.length === 0
      ? '\nACTUARY A2: sim aging matches the real bar — no drift.'
      : `\nACTUARY A2: ${flags.length} drift flag(s): ${flags.join(', ')}`,
  );
  console.log(
    '\nKNOWN RESIDUALS (S4 role-stickiness territory — expected until then):\n' +
      '  - TE/S/CB production lags rating decline (TE1 target monopoly; tackle/INT\n' +
      '    stats are weakly rating-coupled), so their peaks/regions read late/flat.\n' +
      '  - QB decline cells read mildly positive while the plateau check passes.\n' +
      '  - 33+ cliff reads ~-4 vs real -20..-32: the rational depth chart benches\n' +
      '    cliffed vets out of the qualifying sample; real teams keep playing them.',
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === 'sim') {
    const years = Number(args[1]) > 0 ? Number(args[1]) : 10;
    // Split on comma OR whitespace — shells/pnpm can rejoin comma lists
    // into a single space-separated arg.
    const seeds = (args[2] ?? 'actuary-sim-1').split(/[\s,]+/).filter((s) => s.length > 0);
    const baselines = await buildRealBaselines(false, true);
    await simProbe(baselines, years, seeds);
  } else {
    await buildRealBaselines(args.includes('fresh'), false);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
