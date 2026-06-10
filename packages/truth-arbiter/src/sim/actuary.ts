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

async function main(): Promise<void> {
  const force = process.argv.includes('fresh');

  console.log('\nTHE ACTUARY — real-NFL aging baselines (2003-2024)');
  console.log('='.repeat(72));

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
  console.log(`rows ingested: ${rowsIngested}  players: ${careers.size}  seasons: ${YEARS.length}`);

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

  console.log('\n=== Age distribution of qualifying contributor seasons ===');
  for (const a of [...qualAgeHist.keys()].sort((x, y) => x - y)) {
    const n = qualAgeHist.get(a)!;
    baselines.qualifyingAgeDistribution[String(a)] = { n, share: n / totalQual };
    console.log(`age ${pad(a, 2)}: ${pad(n, 5)}  (${((n / totalQual) * 100).toFixed(2)}%)`);
  }
  for (const p of POS) {
    const m = minAgeByPos.get(p);
    if (m !== undefined) baselines.minQualifyingAgeByPos[p] = m;
  }
  console.log(
    'min qualifying age by pos: ' + POS.map((p) => `${p}=${minAgeByPos.get(p) ?? '—'}`).join('  '),
  );

  console.log('\n=== Draft-entry age distribution (drafted 2003-2024, age at Sep 1 of rookie season) ===');
  for (const a of [...entryHist.keys()].sort((x, y) => x - y)) {
    const n = entryHist.get(a)!;
    baselines.entryAgeDistribution[String(a)] = { n, share: n / entryN };
    console.log(`age ${pad(a, 2)}: ${pad(n, 5)}  (${((n / entryN) * 100).toFixed(1)}%)`);
  }

  console.log('\n=== Median YoY per-game production change (%) by position x age (age = turning into) ===');
  console.log('pos   ' + AGES_INTO.map((a) => pad(a, 7)).join(''));
  for (const p of POS) {
    const cells = AGES_INTO.map((a) => {
      const arr = yoy.get(p)!.get(a);
      if (!arr || arr.length < MIN_PAIRS) return pad('—', 7);
      const m = (median(arr) - 1) * 100;
      return pad((m >= 0 ? '+' : '') + m.toFixed(1), 7);
    });
    console.log(p.padEnd(6) + cells.join(''));
  }
  console.log('pair counts:');
  for (const p of POS) {
    console.log(p.padEnd(6) + AGES_INTO.map((a) => pad(yoy.get(p)!.get(a)?.length ?? 0, 7)).join(''));
  }

  console.log('\n=== Chained aging curve (median YoY ratios; 100 = peak; * = extrapolated/no data) ===');
  console.log('pos   ' + AGES_INTO.map((a) => pad(a, 7)).join('') + '  peakAge');
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
    console.log(p.padEnd(6) + cells.join('') + pad(peakAge, 9));
  }

  console.log('\n=== Attrition: P(no qualifying season s+1 | qualified at s) by position x age (%) ===');
  console.log('pos   ' + AGES_AT.map((a) => pad(a, 7)).join(''));
  for (const p of POS) {
    const cells = AGES_AT.map((a) => {
      const e = baselines.positions[p]!.attrition[String(a)];
      return pad(e ? (e.rate * 100).toFixed(0) : '—', 7);
    });
    console.log(p.padEnd(6) + cells.join(''));
  }

  console.log(`\n=== P(next season played but games <= ${MIN_GAMES} | qualified at s) by age (%) ===`);
  for (const a of AGES_AT) {
    const d = injDen.get(a) ?? 0;
    if (d < 30) continue;
    const rate = (injNum.get(a) ?? 0) / d;
    baselines.injuryShortenedByAge[String(a)] = { rate, n: d };
    console.log(`age ${pad(a, 2)}: ${pad((rate * 100).toFixed(1), 5)}%   (n=${d})`);
  }

  // career shapes
  console.log('\n=== Career shapes (players with >= 6 qualifying seasons) ===');
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
  console.log(`players classified: ${shaped}`);
  for (const g of ['QB', 'SKILL', 'DEF']) {
    const entries = [...shapeCounts.entries()]
      .filter(([k]) => k.startsWith(g + ':'))
      .map(([k, n]) => ({ shape: k.slice(g.length + 1), n }))
      .sort((a, b) => b.n - a.n);
    const tot = entries.reduce((s, e) => s + e.n, 0);
    baselines.careerShapes[g] = {};
    console.log(`\n${g} (n=${tot}):`);
    for (const e of entries) {
      baselines.careerShapes[g]![e.shape] = { n: e.n, share: e.n / tot };
      console.log(`  ${pad(((e.n / tot) * 100).toFixed(0), 3)}%  ${e.shape}  (${e.n})`);
    }
  }

  await writeFile(BASELINES_PATH, JSON.stringify(baselines, null, 2), 'utf8');
  console.log(`\nwrote ${BASELINES_PATH}`);
  console.log(
    '\nNOTE: sub-22 cells are extrapolation territory (age-20 contributor seasons',
  );
  console.log(
    'are ~0.13% of the league) — engine curves must extend the 22-24 slope, not read sub-22 data.',
  );
  console.log('done.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
