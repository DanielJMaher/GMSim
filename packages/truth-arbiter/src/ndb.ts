import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse } from 'node-html-parser';
import { DATA_DIR, RAW_HTML_DIR, USER_AGENT, FETCH_DELAY_MS } from './config.js';

/**
 * NFLDraftBuzz per-prospect scout-spread scraper (The Ombudsman's data layer,
 * 2026-06-02).
 *
 * Each NFLDraftBuzz player page embeds a chart of how EACH tracked source
 * (ESPN, CBS, PFF, The Athletic, WalterFootball, …) ranked the prospect. That
 * per-source rank list IS the media spread the Ombudsman needs — range/stdev of
 * a prospect's rank across outlets, which we then aggregate per position group
 * and per consensus tier to learn how much sources realistically disagree.
 *
 * Two-step, behind Cloudflare → curl (disk-cached):
 *   1. list pages /positions/ALL/{page}/{year} → collect /Player/ URLs (top ~120)
 *   2. each /Player/ page → parse the source-rank chart
 *
 *   pnpm --filter @gmsim/truth-arbiter run ndb            # all years
 *   pnpm --filter @gmsim/truth-arbiter run ndb 2024       # one year
 */

// NFLDraftBuzz only embeds the per-source rank chart from 2021 on (older player
// pages exist but carry no multi-source spread), so the spread data is 2021-2025.
const NDB_YEARS: readonly number[] = [2021, 2022, 2023, 2024, 2025];
const LIST_MAX_PAGES = 12; // ~12 players/page → top ~140
const OUT_PATH = resolve(DATA_DIR, 'ndb-players.json');

let lastFetch = 0;
async function curlFetch(url: string): Promise<string> {
  await mkdir(RAW_HTML_DIR, { recursive: true });
  const keyName = url.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9._-]/g, '_') + '.html';
  const path = resolve(RAW_HTML_DIR, keyName);
  try {
    await access(path);
    return await readFile(path, 'utf8');
  } catch {
    /* not cached */
  }
  const wait = FETCH_DELAY_MS - (Date.now() - lastFetch);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetch = Date.now();
  const { stdout } = await promisify(execFile)(
    'curl',
    ['-s', '--fail', '-A', USER_AGENT, '-H', 'Accept: text/html', url],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  if (!stdout || stdout.length < 1000) throw new Error(`empty/short (${stdout.length}b)`);
  await writeFile(path, stdout, 'utf8');
  return stdout;
}

export interface SourceRank {
  source: string;
  rank: number;
}
export interface NdbPlayer {
  year: number;
  name: string;
  /** NFLDraftBuzz position label (QB, WR, OL, DL, EDGE, CB, S, LB, RB, TE, …). */
  position: string;
  /** Per-source rank — the spread. */
  sourceRanks: SourceRank[];
  consensusRank: number; // mean of sourceRanks
  spread: number; // population stdev of sourceRanks
  rankRange: number; // max - min
}
export interface NdbPlayerData {
  years: number[];
  players: NdbPlayer[];
}

function splitArr(inner: string): string[] {
  return inner
    .split(',')
    .map((s) => s.replace(/[^\x20-\x7e]/g, '').replace(/['"]/g, '').trim())
    .filter(Boolean);
}

/** Parse the embedded source-rank chart (labels = "Source - (date)", data = ranks). */
export function extractSourceRanks(html: string): SourceRank[] {
  const labelRe = /labels:\s*\[([^\]]*)\]/g;
  let m: RegExpExecArray | null;
  let scoutLabels: string[] | null = null;
  while ((m = labelRe.exec(html))) {
    const arr = splitArr(m[1]!);
    if (arr.some((l) => /\(\d\d-\d\d-\d\d\)/.test(l))) {
      scoutLabels = arr;
      break;
    }
  }
  if (!scoutLabels) return [];
  // The matching ranks = the first integer-only data array of equal length.
  const dataRe = /data:\s*\[([^\]]*)\]/g;
  let d: RegExpExecArray | null;
  let ranks: string[] | null = null;
  while ((d = dataRe.exec(html))) {
    const arr = splitArr(d[1]!);
    if (arr.length === scoutLabels.length && arr.every((v) => /^\d+$/.test(v))) {
      ranks = arr;
      break;
    }
  }
  if (!ranks) return [];
  return scoutLabels.map((l, i) => ({ source: l.split(' - ')[0]!.trim(), rank: Number(ranks![i]) }));
}

function stats(ranks: number[]): { mean: number; sd: number; range: number } {
  const mean = ranks.reduce((a, b) => a + b, 0) / ranks.length;
  const sd = Math.sqrt(ranks.reduce((a, b) => a + (b - mean) ** 2, 0) / ranks.length);
  return { mean, sd, range: Math.max(...ranks) - Math.min(...ranks) };
}

async function collectPlayerUrls(year: number): Promise<string[]> {
  const urls = new Set<string>();
  for (let page = 1; page <= LIST_MAX_PAGES; page++) {
    let html: string;
    try {
      html = await curlFetch(`https://www.nfldraftbuzz.com/positions/ALL/${page}/${year}`);
    } catch {
      break;
    }
    const root = parse(html);
    const before = urls.size;
    for (const a of root.querySelectorAll('a[href^="/Player/"]')) {
      const href = a.getAttribute('href') ?? '';
      if (/\/Player\/[A-Za-z].*-.*-/.test(href)) urls.add(href);
    }
    if (urls.size === before) break; // page added nothing new
  }
  return [...urls];
}

async function scrapeYear(year: number): Promise<NdbPlayer[]> {
  const urls = await collectPlayerUrls(year);
  const players: NdbPlayer[] = [];
  for (const href of urls) {
    const parts = href.replace('/Player/', '').split('-');
    if (parts.length < 3) continue;
    const position = parts[parts.length - 2] ?? '';
    const name = parts.slice(0, parts.length - 2).join(' ');
    if (!/^[A-Za-z/]{1,4}$/.test(position)) continue;
    let html: string;
    try {
      html = await curlFetch(`https://www.nfldraftbuzz.com${href}`);
    } catch {
      continue;
    }
    const sourceRanks = extractSourceRanks(html);
    if (sourceRanks.length < 3) continue; // need a few sources for a spread
    const ranks = sourceRanks.map((s) => s.rank);
    const s = stats(ranks);
    players.push({
      year, name, position, sourceRanks,
      consensusRank: Math.round(s.mean * 10) / 10,
      spread: Math.round(s.sd * 100) / 100,
      rankRange: s.range,
    });
  }
  players.sort((a, b) => a.consensusRank - b.consensusRank);
  return players;
}

async function main(): Promise<void> {
  const argYears = process.argv.slice(2).map(Number).filter((n) => !Number.isNaN(n));
  const years = argYears.length > 0 ? argYears : NDB_YEARS;

  await mkdir(DATA_DIR, { recursive: true });
  const players: NdbPlayer[] = [];
  for (const year of years) {
    const yr = await scrapeYear(year);
    players.push(...yr);
    const avgSrc = yr.length ? yr.reduce((a, p) => a + p.sourceRanks.length, 0) / yr.length : 0;
    console.log(`  ${year}: ${yr.length} players w/ spread (avg ${avgSrc.toFixed(1)} sources; top ${yr[0]?.name ?? '?'})`);
  }
  await writeFile(OUT_PATH, JSON.stringify({ years, players }, null, 2), 'utf8');
  console.log(`\nWrote ${players.length} players → ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
