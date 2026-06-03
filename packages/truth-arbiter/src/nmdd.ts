import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse } from 'node-html-parser';
import { DATA_DIR, RAW_HTML_DIR, USER_AGENT, FETCH_DELAY_MS } from './config.js';

const execFileP = promisify(execFile);

/**
 * NMDD sits behind Cloudflare, which fingerprints Node's `fetch` (undici) and
 * returns 403 even with a browser UA — but `curl` gets through. So we shell out
 * to curl (disk-cached, polite-delayed) instead of the project's `cachedFetch`.
 */
let lastFetch = 0;
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
    { maxBuffer: 32 * 1024 * 1024 },
  );
  if (!stdout || stdout.length < 1000) throw new Error(`empty/short response (${stdout.length} bytes)`);
  await writeFile(path, stdout, 'utf8');
  return stdout;
}

/**
 * NFLMockDraftDatabase consensus-big-board scraper (Truth Arbiter "class-talent"
 * facet + The Ombudsman data layer, 2026-06-02).
 *
 * NMDD aggregates ~180+ public big boards (ESPN, NFL.com, CBS, PFF, The
 * Athletic, WalterFootball, PFN, NFLDraftBuzz, …) into one consensus board per
 * draft class. Scraping it once captures the whole field of sources Daniel
 * named, with a consistent consensus RANK — far more robust than scraping each
 * site's idiosyncratic grade scale. We use it to learn the realistic shape of a
 * draft class: how steep the talent pyramid is (how few blue-chips) and the
 * position mix at the top.
 *
 * The consensus board page is server-rendered and reachable with the project's
 * browser UA (the per-player detail pages are gated, 403). Each page exposes the
 * top ~100 prospects: consensus rank, name, position, college, and (for past
 * classes) the team that drafted them.
 *
 *   pnpm --filter @gmsim/truth-arbiter run nmdd            # all years
 *   pnpm --filter @gmsim/truth-arbiter run nmdd 2024       # one year
 */

const NMDD_YEARS: readonly number[] = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
const OUT_PATH = resolve(DATA_DIR, 'nmdd-boards.json');

function boardUrl(year: number): string {
  return `https://www.nflmockdraftdatabase.com/big-boards/${year}/consensus-big-board-${year}`;
}

export interface NmddProspect {
  /** Consensus rank (1 = top prospect). */
  rank: number;
  name: string;
  /** NMDD position label (QB, RB, WR, TE, OT, IOL, EDGE, DT, LB, CB, S, …). */
  position: string;
  college: string | null;
  /** Team that drafted him (past classes), else null. */
  draftedBy: string | null;
}

export interface NmddBoard {
  year: number;
  prospects: NmddProspect[];
}

/** Parse one consensus-board page into ranked prospects. */
export function parseBoard(htmlText: string, year: number): NmddProspect[] {
  const root = parse(htmlText);
  const anchors = root
    .querySelectorAll(`a[href*="/players/${year}/"]`)
    .filter((a) => new RegExp(`/players/${year}/[a-z]`).test(a.getAttribute('href') ?? ''));

  const seen = new Set<string>();
  const out: NmddProspect[] = [];
  for (const a of anchors) {
    const name = a.text.trim();
    if (!name || name === 'Archive Prospect') continue; // trailing nav junk
    const href = a.getAttribute('href') ?? '';
    if (seen.has(href)) continue; // page repeats some links (nav/compare)
    seen.add(href);

    // Row container (anchor's grandparent) reads e.g. "1 Caleb Williams QB USC #1 CHI".
    const row = a.parentNode?.parentNode;
    const rowText = (row?.structuredText ?? a.text).replace(/\s+/g, ' ').trim();
    const after = rowText.slice(rowText.indexOf(name) + name.length).trim(); // "QB USC #1 CHI"
    const tokens = after.split(/\s+/);
    const position = tokens[0] ?? '';
    if (!/^[A-Za-z/]{1,4}$/.test(position)) continue; // skip non-prospect anchors

    // Rank = the "#N" consensus badge. The DOM renders prospects OUT of
    // consensus order (e.g. a #11 prospect can appear 5th in the markup), but
    // the badge order matches the real consensus, so we rank by it (falling
    // back to DOM order only if a badge is missing).
    const rankMatch = after.match(/#(\d+)/);
    const rank = rankMatch ? Number(rankMatch[1]) : out.length + 1;

    // college = tokens between position and the "#" badge; team = token after.
    let college: string | null = null;
    let draftedBy: string | null = null;
    const hashIdx = tokens.findIndex((t) => t.startsWith('#'));
    if (hashIdx > 1) college = tokens.slice(1, hashIdx).join(' ');
    if (hashIdx >= 0 && tokens[hashIdx + 1]) draftedBy = tokens[hashIdx + 1]!;

    out.push({ rank, name, position, college, draftedBy });
  }
  out.sort((a, b) => a.rank - b.rank);
  return out;
}

async function main(): Promise<void> {
  const argYears = process.argv.slice(2).map(Number).filter((n) => !Number.isNaN(n));
  const years = argYears.length > 0 ? argYears : NMDD_YEARS;

  await mkdir(DATA_DIR, { recursive: true });
  const boards: NmddBoard[] = [];
  for (const year of years) {
    try {
      const html = await curlFetch(boardUrl(year));
      const prospects = parseBoard(html, year);
      boards.push({ year, prospects });
      console.log(`  ${year}: ${prospects.length} prospects (top ${prospects[0]?.name ?? '?'} … ${prospects.at(-1)?.name ?? '?'})`);
    } catch (err) {
      console.warn(`  ! ${year}: ${(err as Error).message}`);
    }
  }

  await writeFile(OUT_PATH, JSON.stringify(boards, null, 2), 'utf8');
  console.log(`\nWrote ${boards.length} boards → ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
