import { access, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DATA_DIR } from './config.js';

/**
 * Shared OverTheCap contract-corpus plumbing. The Liquidator (cap structure)
 * and the Barterer (trade-value tiering) both read the same nflverse mirror
 * of OTC's historical contracts; the download + position-bucket mapping live
 * here so the agents can't drift apart.
 *
 * The nflverse `historical_contracts.csv.gz` asset was abandoned mid-2022 —
 * only the parquet is still rebuilt (daily). We read the parquet with
 * hyparquet and materialize it as a CSV in the legacy column layout (money
 * fields in raw dollars), so the CSV-reading agents stay format-stable while
 * getting current data. Delete data/historical_contracts.csv to refresh.
 */

const CONTRACTS_PARQUET_URL =
  'https://github.com/nflverse/nflverse-data/releases/download/contracts/historical_contracts.parquet';

/** Materialized CSV — download + conversion happen at most once. */
export const CONTRACTS_CSV_PATH = resolve(DATA_DIR, 'historical_contracts.csv');

/** Columns written to the materialized CSV (legacy layout + gsis_id). */
const CSV_COLUMNS = [
  'player', 'position', 'team', 'is_active', 'year_signed', 'years',
  'value', 'apy', 'guaranteed', 'apy_cap_pct',
  'inflated_value', 'inflated_apy', 'inflated_guaranteed',
  'player_page', 'otc_id', 'gsis_id', 'date_of_birth',
  'height', 'weight', 'college',
  'draft_year', 'draft_round', 'draft_overall', 'draft_team',
] as const;

/** Parquet money columns are in $M; the legacy CSV carried raw dollars. */
const DOLLAR_COLUMNS = new Set([
  'value', 'apy', 'guaranteed', 'inflated_value', 'inflated_apy', 'inflated_guaranteed',
]);

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Ensure the materialized OTC contracts CSV exists locally. */
export async function ensureContractsCsv(): Promise<void> {
  if (await exists(CONTRACTS_CSV_PATH)) return;
  const parquetPath = resolve(DATA_DIR, 'historical_contracts.parquet');
  if (!(await exists(parquetPath))) {
    process.stdout.write('  fetching OTC contracts (nflverse mirror, parquet)…');
    const res = await fetch(CONTRACTS_PARQUET_URL);
    if (!res.ok) throw new Error(`contracts parquet → HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(parquetPath, buf);
    process.stdout.write(` ${(buf.length / 1e6).toFixed(1)}MB\n`);
  }
  const { parquetReadObjects } = await import('hyparquet');
  const { compressors } = await import('hyparquet-compressors');
  const file = (await readFile(parquetPath)).buffer as ArrayBuffer;
  const rows = (await parquetReadObjects({
    file,
    compressors,
    columns: [...CSV_COLUMNS],
  })) as Record<string, unknown>[];
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(
      CSV_COLUMNS.map((c) => {
        const v = row[c];
        if (v === null || v === undefined) return '';
        if (DOLLAR_COLUMNS.has(c) && typeof v === 'number') return String(Math.round(v * 1e6));
        return csvEscape(String(v));
      }).join(','),
    );
  }
  await writeFile(CONTRACTS_CSV_PATH, lines.join('\n') + '\n', 'utf8');
  process.stdout.write(`  materialized historical_contracts.csv (${rows.length} contracts)\n`);
}

/** GMSim position → OTC position bucket. */
export const OTC_BUCKET: Record<string, string> = {
  QB: 'QB', RB: 'RB', FB: 'FB', WR: 'WR', TE: 'TE',
  LT: 'LT', RT: 'RT', LG: 'LG', RG: 'RG', C: 'C',
  EDGE: 'ED', DT: 'IDL', NT: 'IDL',
  OLB: 'LB', ILB: 'LB',
  CB: 'CB', NICKEL: 'CB', S: 'S',
  K: 'K', P: 'P', LS: 'LS',
};
