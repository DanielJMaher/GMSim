import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DATA_DIR } from './config.js';
import { splitCsvLine, csvNum } from './csv.js';
import type { CareerOutcome, DraftPickRecord } from './types.js';

/**
 * Real NFL career outcomes from the open nflverse draft_picks dataset, merged
 * into the corpus. This is the "did the pick pan out" truth (Career AV, Pro
 * Bowls, All-Pros, starter tenure, games) — the basis for validating the
 * engine's development model, not just its generation.
 */

const DRAFT_PICKS_CSV_URL =
  'https://github.com/nflverse/nflverse-data/releases/download/draft_picks/draft_picks.csv';
const DRAFT_PICKS_CSV_PATH = resolve(DATA_DIR, 'draft_picks.csv');

interface OutcomeRow {
  season: number | null;
  pick: number | null;
  playerName: string;
  outcome: CareerOutcome;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function loadCsv(force = false): Promise<string> {
  await mkdir(DATA_DIR, { recursive: true });
  if (!force && (await exists(DRAFT_PICKS_CSV_PATH))) {
    return readFile(DRAFT_PICKS_CSV_PATH, 'utf8');
  }
  const res = await fetch(DRAFT_PICKS_CSV_URL);
  if (!res.ok) throw new Error(`draft_picks csv → HTTP ${res.status}`);
  const csv = await res.text();
  await writeFile(DRAFT_PICKS_CSV_PATH, csv, 'utf8');
  return csv;
}

function parseCsv(csv: string): OutcomeRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
  const header = splitCsvLine(lines[0]!);
  const c = (name: string): number => header.indexOf(name);
  const iSeason = c('season');
  const iPick = c('pick');
  const iName = c('pfr_player_name');
  const iPfr = c('pfr_player_id');
  const iHof = c('hof');
  const iAllpro = c('allpro');
  const iPb = c('probowls');
  const iStarts = c('seasons_started');
  const iWav = c('w_av');
  const iCarav = c('car_av');
  const iGames = c('games');

  const rows: OutcomeRow[] = [];
  for (let r = 1; r < lines.length; r++) {
    const f = splitCsvLine(lines[r]!);
    const pfrId = f[iPfr]?.trim() || null;
    rows.push({
      season: csvNum(f[iSeason]),
      pick: csvNum(f[iPick]),
      playerName: f[iName]?.trim() ?? '',
      outcome: {
        carAv: csvNum(f[iCarav]),
        wAv: csvNum(f[iWav]),
        probowls: csvNum(f[iPb]),
        allpro: csvNum(f[iAllpro]),
        seasonsStarted: csvNum(f[iStarts]),
        games: csvNum(f[iGames]),
        hof: (f[iHof]?.trim() ?? '') === '1' || (f[iHof]?.trim().toLowerCase() ?? '') === 'true',
        pfrId,
      },
    });
  }
  return rows;
}

function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function surname(s: string): string {
  return normName(s).split(' ').pop() ?? '';
}

export interface OutcomeMergeStats {
  matched: number;
  total: number;
}

/**
 * Merge career outcomes into corpus picks (mutates `picks`). Join is by
 * (draft year + overall pick) — unique — with a surname guard against any
 * numbering drift.
 */
export async function mergeOutcomes(picks: DraftPickRecord[]): Promise<OutcomeMergeStats> {
  const rows = parseCsv(await loadCsv());
  const byKey = new Map<string, OutcomeRow>();
  for (const row of rows) {
    if (row.season !== null && row.pick !== null) byKey.set(`${row.season}:${row.pick}`, row);
  }

  const stats: OutcomeMergeStats = { matched: 0, total: picks.length };
  for (const p of picks) {
    const row = p.overallPick !== null ? byKey.get(`${p.year}:${p.overallPick}`) : undefined;
    if (row && surname(p.playerName) === surname(row.playerName)) {
      p.career = row.outcome;
      stats.matched++;
    } else {
      p.career = null;
    }
  }
  return stats;
}
