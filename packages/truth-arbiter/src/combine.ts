import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DATA_DIR } from './config.js';
import type { CombineResults, DraftPickRecord } from './types.js';

/**
 * Combine athletic testing from the open nflverse combine dataset, merged
 * into the draft corpus. This sidesteps both blockers we hit scraping
 * workout numbers directly: nfl.com renders them client-side, and
 * Pro-Football-Reference is behind a Cloudflare challenge. nflverse
 * publishes the same data as a clean, openly-licensed CSV.
 */

const COMBINE_CSV_URL =
  'https://github.com/nflverse/nflverse-data/releases/download/combine/combine.csv';
const COMBINE_CSV_PATH = resolve(DATA_DIR, 'combine.csv');

interface CombineRow {
  draftYear: number | null;
  draftOvr: number | null;
  pfrId: string | null;
  playerName: string;
  pos: string | null;
  school: string | null;
  results: CombineResults;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Download + disk-cache the nflverse combine CSV. */
async function loadCsv(force = false): Promise<string> {
  await mkdir(DATA_DIR, { recursive: true });
  if (!force && (await exists(COMBINE_CSV_PATH))) {
    return readFile(COMBINE_CSV_PATH, 'utf8');
  }
  const res = await fetch(COMBINE_CSV_URL);
  if (!res.ok) throw new Error(`combine csv → HTTP ${res.status}`);
  const csv = await res.text();
  await writeFile(COMBINE_CSV_PATH, csv, 'utf8');
  return csv;
}

/** Minimal CSV split that respects double-quoted fields. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQ = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQ = true;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function n(s: string | undefined): number | null {
  if (s === undefined) return null;
  const t = s.trim();
  if (t === '' || t === 'NA') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

function parseCombineCsv(csv: string): CombineRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
  const header = splitCsvLine(lines[0]!);
  const col = (name: string): number => header.indexOf(name);
  const iYear = col('draft_year');
  const iOvr = col('draft_ovr');
  const iPfr = col('pfr_id');
  const iName = col('player_name');
  const iPos = col('pos');
  const iSchool = col('school');
  const iForty = col('forty');
  const iBench = col('bench');
  const iVert = col('vertical');
  const iBroad = col('broad_jump');
  const iCone = col('cone');
  const iShuttle = col('shuttle');

  const rows: CombineRow[] = [];
  for (let r = 1; r < lines.length; r++) {
    const f = splitCsvLine(lines[r]!);
    rows.push({
      draftYear: n(f[iYear]),
      draftOvr: n(f[iOvr]),
      pfrId: f[iPfr]?.trim() || null,
      playerName: f[iName]?.trim() ?? '',
      pos: f[iPos]?.trim() || null,
      school: f[iSchool]?.trim() || null,
      results: {
        forty: n(f[iForty]),
        bench: n(f[iBench]),
        vertical: n(f[iVert]),
        broadJump: n(f[iBroad]),
        cone: n(f[iCone]),
        shuttle: n(f[iShuttle]),
        pfrId: f[iPfr]?.trim() || null,
      },
    });
  }
  return rows;
}

/** Normalize a name for fuzzy matching (lowercase, drop punctuation/suffix). */
function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface MergeStats {
  matched: number;
  total: number;
  byOvr: number;
  byName: number;
}

/**
 * Merge combine results into corpus picks (mutates `picks`). Primary join is
 * (draft year + overall pick) — unique and robust. Falls back to a
 * normalized-name match within the year (disambiguated by position) for the
 * rare pick whose cumulative overall number doesn't line up.
 */
export async function mergeCombine(picks: DraftPickRecord[]): Promise<MergeStats> {
  const rows = parseCombineCsv(await loadCsv());

  const byOvrKey = new Map<string, CombineRow>();
  const byNameYear = new Map<string, CombineRow[]>();
  for (const row of rows) {
    if (row.draftYear !== null && row.draftOvr !== null) {
      byOvrKey.set(`${row.draftYear}:${row.draftOvr}`, row);
    }
    if (row.draftYear !== null) {
      const k = `${row.draftYear}:${normName(row.playerName)}`;
      (byNameYear.get(k) ?? byNameYear.set(k, []).get(k)!).push(row);
    }
  }

  const stats: MergeStats = { matched: 0, total: picks.length, byOvr: 0, byName: 0 };
  for (const p of picks) {
    let row: CombineRow | undefined;

    const ovrHit = p.overallPick !== null ? byOvrKey.get(`${p.year}:${p.overallPick}`) : undefined;
    // Trust the overall-pick join only if the surname agrees (guards against
    // any cumulative-numbering drift between our scrape and nflverse).
    if (ovrHit && surnameMatches(p.playerName, ovrHit.playerName)) {
      row = ovrHit;
      stats.byOvr++;
    } else {
      const candidates = byNameYear.get(`${p.year}:${normName(p.playerName)}`) ?? [];
      if (candidates.length === 1) {
        row = candidates[0];
        stats.byName++;
      } else if (candidates.length > 1) {
        // Disambiguate by position (e.g. two same-name prospects same year).
        row = candidates.find((c) => samePos(c.pos, p.position)) ?? undefined;
        if (row) stats.byName++;
      }
    }

    p.combine = row ? row.results : null;
    if (row) stats.matched++;
  }
  return stats;
}

function surnameMatches(a: string, b: string): boolean {
  const last = (s: string) => normName(s).split(' ').pop() ?? '';
  return last(a) === last(b);
}

function samePos(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return a.toUpperCase() === b.toUpperCase();
}
