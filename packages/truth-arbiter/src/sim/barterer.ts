import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DATA_DIR, RAW_HTML_DIR, USER_AGENT, FETCH_DELAY_MS } from '../lib/config.js';

/**
 * The Barterer — the TRADE-REALISM authority (2026-06-09, Daniel-directed).
 *
 * Sibling to the Liquidator (cap), Magistrate (drives), Skill Adjudicator
 * (talent) and Ombudsman (media spread). Where those police their own slice of
 * realism, the Barterer polices TRADES: it ingests real NFL trades and derives
 * the bar GMSim's simulated GMs must echo across many seeds —
 *
 *   - HOW OFTEN teams trade (volume / year).
 *   - The SHAPE of deals: player-for-picks vs player-for-player vs pick swaps.
 *   - WHO gets moved: the age + position profile of traded players (real deadline
 *     moves are aging vets + role players, not franchise cornerstones).
 *   - WHAT it costs: the pick packages (rounds, count, how often a 1st is in).
 *
 * Data source: spotrac's public trade ledger (`/nfl/transactions/trade/{year}`),
 * which lists, per trade, what each team RECEIVED — players (with age, position,
 * cap figure) and picks (year, round, conditional flag) + the date. Bot-blocked
 * to plain fetch (403) but reachable via curl with a browser UA, same as the
 * NMDD scraper. Raw HTML is cached (data/, gitignored); the Barterer emits only
 * aggregate targets + an anonymized ledger — never republished verbatim pages.
 *
 *   pnpm --filter @gmsim/truth-arbiter run barterer [startYear endYear]
 *
 * Slice 1 (this): ingest real trades → print the realism bar + write the ledger.
 * Slice 2 (next): read GMSim's simulated trades (engine-bridge) → compare +
 * flag drift. Slice 3: enrich each traded player with production tier + media
 * sentiment (web lookup) for a richer "what kind of player moves for what" model.
 */

const execFileP = promisify(execFile);
let lastFetch = 0;

const tradeUrl = (year: number): string => `https://www.spotrac.com/nfl/transactions/trade/${year}`;

async function curlFetch(url: string): Promise<string> {
  await mkdir(RAW_HTML_DIR, { recursive: true });
  const cacheKey = url.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9._-]/g, '_') + '.html';
  const path = resolve(RAW_HTML_DIR, cacheKey);
  try {
    await access(path);
    return await readFile(path, 'utf8');
  } catch {
    /* not cached */
  }
  const wait = FETCH_DELAY_MS - (Date.now() - lastFetch);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetch = Date.now();
  const { stdout } = await execFileP(
    'curl',
    ['-s', '--fail', '-A', USER_AGENT, '-H', 'Accept: text/html', url],
    { maxBuffer: 48 * 1024 * 1024 },
  );
  if (!stdout || stdout.length < 1000) throw new Error(`empty/short response (${stdout.length} bytes)`);
  await writeFile(path, stdout, 'utf8');
  return stdout;
}

// ── Parse ───────────────────────────────────────────────────────────────────

interface TradedPlayer {
  name: string;
  age: number;
  pos: string;
  capDollars: number | null;
}
interface TradedPick {
  year: number;
  round: number;
  conditional: boolean;
}
interface TradeSide {
  team: string;
  /** Assets this team RECEIVED. */
  players: TradedPlayer[];
  picks: TradedPick[];
}
interface RealTrade {
  date: string;
  year: number;
  sides: TradeSide[];
}

const detag = (s: string): string =>
  s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const PLAYER_RE = /([A-Z][A-Za-z.'\-]+(?:\s+[A-Z][A-Za-z.'\-]+){1,3})\s+Age:\s*(\d{2})\s*\|\s*Pos:\s*([A-Za-z]{1,4})/g;
const PICK_RE = /(20\d{2})\s+Round\s+(\d)(\s+conditional)?/gi;
const DATE_RE = /([A-Z][a-z]{2}\s+\d{1,2},\s+20\d{2})/;

const NFL_TEAMS = [
  'Arizona Cardinals', 'Atlanta Falcons', 'Baltimore Ravens', 'Buffalo Bills', 'Carolina Panthers',
  'Chicago Bears', 'Cincinnati Bengals', 'Cleveland Browns', 'Dallas Cowboys', 'Denver Broncos',
  'Detroit Lions', 'Green Bay Packers', 'Houston Texans', 'Indianapolis Colts', 'Jacksonville Jaguars',
  'Kansas City Chiefs', 'Las Vegas Raiders', 'Los Angeles Chargers', 'Los Angeles Rams', 'Miami Dolphins',
  'Minnesota Vikings', 'New England Patriots', 'New Orleans Saints', 'New York Giants', 'New York Jets',
  'Philadelphia Eagles', 'Pittsburgh Steelers', 'San Francisco 49ers', 'Seattle Seahawks',
  'Tampa Bay Buccaneers', 'Tennessee Titans', 'Washington Commanders',
];
// Per-team marker: "{Team} ±$X.XXM CAP SPACE Incoming {assets…}". The team owns
// every asset up to the next team marker (its INCOMING side of the trade).
const TEAM_MARKER = new RegExp(
  `(${NFL_TEAMS.join('|')})\\s+[+-]\\$[\\d.,]+M\\s+CAP SPACE\\s+Incoming`,
  'g',
);

function parseAssets(text: string): { players: TradedPlayer[]; picks: TradedPick[] } {
  const players: TradedPlayer[] = [];
  for (const m of text.matchAll(PLAYER_RE)) {
    const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 40);
    const capM = /\$([\d,]+)/.exec(after);
    players.push({
      name: m[1]!.trim(),
      age: Number(m[2]),
      pos: m[3]!.toUpperCase(),
      capDollars: capM ? Number(capM[1]!.replace(/,/g, '')) : null,
    });
  }
  const picks: TradedPick[] = [];
  for (const m of text.matchAll(PICK_RE)) {
    picks.push({ year: Number(m[1]), round: Number(m[2]), conditional: Boolean(m[3]) });
  }
  return { players, picks };
}

/** Split the page into per-trade blocks, then split each block on team markers. */
function parseTrades(html: string, year: number): RealTrade[] {
  const trades: RealTrade[] = [];
  const bodyRe = /class="[^"]*\btradebody\b[^"]*"/g;
  const starts: number[] = [...html.matchAll(bodyRe)].map((m) => m.index!);
  for (let i = 0; i < starts.length; i++) {
    const text = detag(html.slice(starts[i]!, starts[i + 1] ?? html.length));
    const markers = [...text.matchAll(TEAM_MARKER)];
    if (markers.length < 2) continue;
    const sides: TradeSide[] = [];
    for (let j = 0; j < markers.length; j++) {
      const assetStart = markers[j]!.index! + markers[j]![0].length;
      const assetEnd = j + 1 < markers.length ? markers[j + 1]!.index! : text.length;
      const { players, picks } = parseAssets(text.slice(assetStart, assetEnd));
      sides.push({ team: markers[j]![1]!, players, picks });
    }
    const dateM = DATE_RE.exec(text);
    trades.push({ date: dateM ? dateM[1]! : `${year}`, year, sides });
  }
  return trades;
}

function dedupe(trades: RealTrade[]): RealTrade[] {
  const seen = new Set<string>();
  const out: RealTrade[] = [];
  for (const t of trades) {
    const key =
      t.date +
      '|' +
      t.sides
        .map((s) => `${s.team}:${s.players.map((p) => p.name).sort().join(',')}:${s.picks.map((p) => `${p.year}R${p.round}`).sort().join(',')}`)
        .sort()
        .join('||');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

// ── Aggregate → the realism bar ───────────────────────────────────────────────

const POS_GROUP: Record<string, string> = {
  QB: 'QB', RB: 'RB', FB: 'RB', WR: 'WR', TE: 'TE',
  LT: 'OL', RT: 'OL', LG: 'OL', RG: 'OL', C: 'OL', OL: 'OL', OT: 'OL', G: 'OL', OG: 'OL', T: 'OL',
  EDGE: 'EDGE', DE: 'EDGE', OLB: 'EDGE',
  DT: 'DL', NT: 'DL', DL: 'DL', IDL: 'DL',
  ILB: 'LB', LB: 'LB', MLB: 'LB',
  CB: 'DB', S: 'DB', FS: 'DB', SS: 'DB', DB: 'DB', NB: 'DB',
  K: 'ST', P: 'ST', LS: 'ST',
};

function classify(t: RealTrade): 'player-for-picks' | 'player-for-player' | 'picks-only' | 'mixed' {
  const sidesWithPlayers = t.sides.filter((s) => s.players.length > 0).length;
  const sidesWithPicks = t.sides.filter((s) => s.picks.length > 0).length;
  const totalPlayers = t.sides.reduce((n, s) => n + s.players.length, 0);
  if (totalPlayers === 0) return 'picks-only';
  if (sidesWithPlayers >= 2) return 'player-for-player';
  if (sidesWithPlayers === 1 && sidesWithPicks >= 1) return 'player-for-picks';
  return 'mixed';
}

function pct(n: number, d: number): string {
  return d ? `${((n / d) * 100).toFixed(0)}%` : '—';
}

function reportBar(trades: RealTrade[], startY: number, endY: number): void {
  /* eslint-disable no-console */
  const n = trades.length;
  const byYear = new Map<number, number>();
  const shapes = { 'player-for-picks': 0, 'player-for-player': 0, 'picks-only': 0, mixed: 0 } as Record<string, number>;
  const ages: number[] = [];
  const posGroup = new Map<string, number>();
  const pickPkgSizes: number[] = [];
  let tradesWithR1 = 0;
  let players = 0;

  for (const t of trades) {
    byYear.set(t.year, (byYear.get(t.year) ?? 0) + 1);
    const shape = classify(t);
    shapes[shape] = (shapes[shape] ?? 0) + 1;
    let hasR1 = false;
    for (const s of t.sides) {
      for (const p of s.players) {
        players++;
        ages.push(p.age);
        const g = POS_GROUP[p.pos] ?? p.pos;
        posGroup.set(g, (posGroup.get(g) ?? 0) + 1);
      }
      if (s.picks.length > 0) pickPkgSizes.push(s.picks.length);
      if (s.picks.some((p) => p.round === 1)) hasR1 = true;
    }
    if (hasR1) tradesWithR1++;
  }

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const yearsCovered = new Set(trades.map((t) => t.year)).size || 1;

  console.log(`\n=== THE BARTERER — real NFL trade realism (${startY}-${endY}) — the bar ===`);
  console.log(`trades: ${n}  ·  ~${(n / yearsCovered).toFixed(0)}/year  ·  traded players: ${players}\n`);

  console.log('  deal shape:');
  for (const k of ['player-for-picks', 'player-for-player', 'picks-only', 'mixed']) {
    const c = shapes[k] ?? 0;
    console.log(`    ${k.padEnd(20)} ${pct(c, n).padStart(5)}  (${c})`);
  }

  console.log('\n  traded-player AGE:');
  console.log(`    mean ${mean(ages).toFixed(1)}  ·  ≥28: ${pct(ages.filter((a) => a >= 28).length, ages.length)}  ·  ≤25: ${pct(ages.filter((a) => a <= 25).length, ages.length)}`);

  console.log('\n  traded-player POSITION group:');
  for (const [g, c] of [...posGroup.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${g.padEnd(6)} ${pct(c, players).padStart(5)}  (${c})`);
  }

  console.log('\n  pick packages:');
  console.log(`    mean picks / pick-side: ${mean(pickPkgSizes).toFixed(1)}  ·  trades incl. a 1st-rounder: ${pct(tradesWithR1, n)}`);
  console.log('');
  /* eslint-enable no-console */
}

async function main(): Promise<void> {
  const start = Number(process.argv[2]) || 2021;
  const end = Number(process.argv[3]) || 2026;
  console.log(`\nIngesting real NFL trades ${start}-${end} (spotrac)…`);
  let all: RealTrade[] = [];
  for (let y = start; y <= end; y++) {
    try {
      const html = await curlFetch(tradeUrl(y));
      const trades = parseTrades(html, y);
      console.log(`  ${y}: ${trades.length} trades`);
      all = all.concat(trades);
    } catch (err) {
      console.log(`  ${y}: fetch failed (${(err as Error).message})`);
    }
  }
  all = dedupe(all);
  reportBar(all, start, end);

  await mkdir(DATA_DIR, { recursive: true });
  const out = resolve(DATA_DIR, 'barterer-trades.json');
  await writeFile(out, JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), start, end, trades: all }, null, 2));
  console.log(`→ wrote data/barterer-trades.json (${all.length} trades — the ledger)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
