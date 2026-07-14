import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DATA_DIR, USER_AGENT, FETCH_DELAY_MS } from '../lib/config.js';

const execFileAsync = promisify(execFile);

/**
 * Madden ratings ingestion (Maddeninator M1) — source nfldraftbuzz.com/madden.
 *
 * The FULL-league source is the per-year, per-position-group listing
 * `/madden/year/{maddenYear}/{posGroup}` (the "SEE ALL" target). It is
 * franchise-agnostic (every player at a position league-wide, with team + OVR
 * + position-relevant attributes), which sidesteps the relocated-franchise
 * historical gap in the per-team pages (Rams/Chargers/Raiders pre-move years).
 *
 * YEAR MAPPING (verified 2026-07-14 by rookie spot-check: Cam Newton [2011
 * draft] present on /year/2012, Luck/RG3 [2012 draft] absent): the URL carries
 * the MADDEN GAME year, and Madden game N ships for NFL season N-1. So
 *   nflSeason = maddenYear - 1
 * and /madden/year/2012 ratings join to the 2011 NFL season.
 *
 *   pnpm --filter @gmsim/truth-arbiter run madden            # all years
 *   pnpm --filter @gmsim/truth-arbiter run madden 2024 2025  # a subset
 */

const BASE = 'https://www.nfldraftbuzz.com/madden/year';
// Madden game years → cover NFL seasons 2011-2025 (matches every existing bar
// window). The site's SEE-ALL position groups:
const POS_GROUPS = ['qb', 'rb', 'wr', 'te', 'ol', 'dl', 'lb', 'db', 'st'] as const;
export const MADDEN_YEARS = Array.from({ length: 15 }, (_, i) => 2012 + i); // 2012..2026

const MADDEN_DIR = resolve(DATA_DIR, 'madden');
const RAW_HTML_DIR = resolve(MADDEN_DIR, 'raw-html');

// nfldraftbuzz sits behind Cloudflare, which 403s node/undici's fetch on its
// TLS fingerprint (headers don't fix it) but serves curl's. So we shell out to
// curl, with the same disk-cache + polite-delay contract as `corpus/fetch.ts`.
let lastFetch = 0;
async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}
async function cachedCurl(url: string): Promise<string> {
  await mkdir(RAW_HTML_DIR, { recursive: true });
  const key = url.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9._-]/g, '_') + '.html';
  const path = resolve(RAW_HTML_DIR, key);
  if (await exists(path)) return readFile(path, 'utf8');
  const wait = FETCH_DELAY_MS - (Date.now() - lastFetch);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetch = Date.now();
  const { stdout } = await execFileAsync(
    'curl',
    ['-sL', '--fail', '-m', '30', '-A', USER_AGENT,
     '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
     '-H', 'Accept-Language: en-US,en;q=0.9', url],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  await writeFile(path, stdout, 'utf8');
  return stdout;
}

/** Site franchise nickname → the nflverse team code for a given NFL season.
 *  Handles the three relocations so team ratings join to games.csv correctly. */
const NICK_TO_CODE: Record<string, string> = {
  '49ers': 'SF', Bears: 'CHI', Bengals: 'CIN', Bills: 'BUF', Broncos: 'DEN',
  Browns: 'CLE', Buccaneers: 'TB', Cardinals: 'ARI', Chiefs: 'KC', Colts: 'IND',
  Commanders: 'WAS', Cowboys: 'DAL', Dolphins: 'MIA', Eagles: 'PHI', Falcons: 'ATL',
  Giants: 'NYG', Jaguars: 'JAX', Jets: 'NYJ', Lions: 'DET', Packers: 'GB',
  Panthers: 'CAR', Patriots: 'NE', Ravens: 'BAL', Saints: 'NO', Seahawks: 'SEA',
  Steelers: 'PIT', Texans: 'HOU', Titans: 'TEN', Vikings: 'MIN',
};
function teamCode(nick: string, nflSeason: number): string | null {
  if (nick === 'Rams') return nflSeason <= 2015 ? 'STL' : 'LA';
  if (nick === 'Chargers') return nflSeason <= 2016 ? 'SD' : 'LAC';
  if (nick === 'Raiders') return nflSeason <= 2019 ? 'OAK' : 'LV';
  return NICK_TO_CODE[nick] ?? null;
}

export interface MaddenPlayerSeason {
  playerId: string;
  name: string;
  position: string; // exact position pill (QB, LT, EDGE …)
  posGroup: (typeof POS_GROUPS)[number];
  franchise: string; // site nickname
  team: string | null; // season-resolved nflverse code
  maddenYear: number;
  nflSeason: number;
  ovr: number;
  attrs: Record<string, number>; // Madden attribute CODE → 0-99 (position-specific columns)
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

/** Parse one `/madden/year/{y}/{pg}` page into player-season rows. Column-
 *  tolerant: reads the header row, then aligns each data row by index. */
export function parseYearPos(
  html: string,
  maddenYear: number,
  posGroup: (typeof POS_GROUPS)[number],
): MaddenPlayerSeason[] {
  const nflSeason = maddenYear - 1;
  // The ratings table is the one whose header includes both Player and OVR.
  const headerMatch = [...html.matchAll(/<thead[\s\S]*?<\/thead>/g)]
    .map((m) => m[0])
    .find((t) => /<th[^>]*>\s*OVR\s*</i.test(t) && /<th[^>]*>\s*Player\s*</i.test(t));
  if (!headerMatch) return [];
  const headers = [...headerMatch.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => stripTags(m[1] ?? ''));
  const ovrIdx = headers.findIndex((h) => h.toUpperCase() === 'OVR');
  const playerIdx = headers.findIndex((h) => /player/i.test(h));
  if (ovrIdx < 0 || playerIdx < 0) return [];
  // Non-rating columns to drop (case-insensitive). ARCHETYPE is a text column
  // (e.g. "Strong Arm") that occasionally parses to a stray number.
  const skip = new Set(['#', 'PLAYER', 'TEAM', 'OVR', 'POS', 'ARCHETYPE', 'RANK', '']);

  const out: MaddenPlayerSeason[] = [];
  for (const row of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? []) {
    if (!row.includes('/madden/player/')) continue;
    const idM = row.match(/\/madden\/player\/(\d+)-([a-z0-9-]+)/);
    const playerId = idM?.[1];
    if (!playerId) continue;
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripTags(m[1] ?? ''));
    if (cells.length < headers.length - 1) continue; // malformed / spacer row
    const ovr = Number(cells[ovrIdx] ?? '');
    if (!Number.isFinite(ovr) || ovr < 30 || ovr > 99) continue;

    // Player cell is "POS Name" (position pill + name).
    const playerCell = cells[playerIdx] ?? '';
    const pm = playerCell.match(/^([A-Z]{1,3})\s+(.+)$/);
    const position = pm?.[1] ?? posGroup.toUpperCase();
    const name = pm?.[2] ?? playerCell;

    const nickM = row.match(/\/madden\/team\/([A-Za-z0-9]+)/);
    const franchise = nickM?.[1] ?? '';

    const attrs: Record<string, number> = {};
    for (let i = 0; i < headers.length && i < cells.length; i++) {
      const code = headers[i];
      if (!code || skip.has(code.toUpperCase()) || i === ovrIdx || i === playerIdx) continue;
      const v = Number(cells[i] ?? '');
      if (Number.isFinite(v) && v >= 0 && v <= 99) attrs[code.toUpperCase()] = v;
    }

    out.push({
      playerId,
      name,
      position,
      posGroup,
      franchise,
      team: teamCode(franchise, nflSeason),
      maddenYear,
      nflSeason,
      ovr,
      attrs,
    });
  }
  return out;
}

async function main(): Promise<void> {
  const argYears = process.argv.slice(2).map(Number).filter((n) => !Number.isNaN(n));
  const years = argYears.length > 0 ? argYears : MADDEN_YEARS;
  await mkdir(MADDEN_DIR, { recursive: true });

  const all: MaddenPlayerSeason[] = [];
  const codesByGroup = new Map<string, Set<string>>();

  for (const year of years) {
    const yearRows: MaddenPlayerSeason[] = [];
    for (const pg of POS_GROUPS) {
      const url = `${BASE}/${year}/${pg}`;
      let html: string;
      try {
        html = await cachedCurl(url);
      } catch (err) {
        console.warn(`  ! ${year}/${pg}: ${(err as Error).message}`);
        continue;
      }
      const rows = parseYearPos(html, year, pg);
      yearRows.push(...rows);
      const set = codesByGroup.get(pg) ?? new Set<string>();
      for (const r of rows) for (const c of Object.keys(r.attrs)) set.add(c);
      codesByGroup.set(pg, set);
    }
    const unresolved = yearRows.filter((r) => r.team === null).length;
    await writeFile(
      resolve(MADDEN_DIR, `madden-${year}.json`),
      JSON.stringify(yearRows),
      'utf8',
    );
    all.push(...yearRows);
    console.log(
      `  Madden ${year} (NFL ${year - 1}): ${yearRows.length} players` +
        (unresolved ? ` — ${unresolved} unresolved team` : ''),
    );
  }

  await writeFile(resolve(MADDEN_DIR, 'madden-all.json'), JSON.stringify(all), 'utf8');
  console.log(`\nTotal ${all.length} player-seasons across ${years.length} Madden years.`);
  console.log('Attribute codes seen (per position group):');
  for (const pg of POS_GROUPS) {
    console.log(`  ${pg}: ${[...(codesByGroup.get(pg) ?? [])].sort().join(' ')}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
