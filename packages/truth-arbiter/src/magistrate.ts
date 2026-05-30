import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DATA_DIR } from './config.js';
import { splitCsvLine, csvNum } from './csv.js';

/**
 * The Magistrate — the DRIVE-LEVEL realism authority for the game sim.
 *
 * First slice: ingest real NFL drive results from the open nflverse
 * play-by-play dataset (2014-2024) and compute the league drive-metric TARGETS
 * (outcome mix, points/plays/yards per drive, yards/play, 3rd-down %, red-zone
 * TD %). These are the bar the matchup-driven sim must hit; the Magistrate will
 * later read the sim's drive log and enforce it stays within tolerance.
 *
 *   pnpm --filter @gmsim/truth-arbiter run magistrate [startYear endYear]
 */

const pbpUrl = (year: number): string =>
  `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${year}.csv`;
const pbpPath = (year: number): string => resolve(DATA_DIR, `pbp_${year}.csv`);

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function loadSeason(year: number): Promise<string> {
  await mkdir(DATA_DIR, { recursive: true });
  const path = pbpPath(year);
  if (await exists(path)) return readFile(path, 'utf8');
  process.stdout.write(`  fetching ${year} pbp…`);
  const res = await fetch(pbpUrl(year));
  if (!res.ok) throw new Error(`pbp ${year} → HTTP ${res.status}`);
  const csv = await res.text();
  await writeFile(path, csv, 'utf8');
  process.stdout.write(` ${(csv.length / 1e6).toFixed(0)}MB\n`);
  return csv;
}

interface DriveAgg {
  drives: number;
  outcomes: Record<string, number>;
  plays: number; // total offensive (pass/run) plays
  driveYards: number; // summed offensive yards
  drivePlayCountSum: number; // from drive_play_count (incl. all plays)
  thirdConv: number;
  thirdFail: number;
  rzDrives: number; // drives that reached the red zone (inside 20)
  rzTd: number;
}

function emptyAgg(): DriveAgg {
  return {
    drives: 0, outcomes: {}, plays: 0, driveYards: 0, drivePlayCountSum: 0,
    thirdConv: 0, thirdFail: 0, rzDrives: 0, rzTd: 0,
  };
}

/** Stream-aggregate one season's pbp into drive metrics. */
function aggregateSeason(csv: string, agg: DriveAgg): void {
  const nl = csv.indexOf('\n');
  const header = splitCsvLine(csv.slice(0, nl));
  const col = (name: string): number => header.indexOf(name);
  const iGame = col('game_id');
  const iFixedDrive = col('fixed_drive');
  const iResult = col('fixed_drive_result');
  const iPlayCount = col('drive_play_count');
  const iInside20 = col('drive_inside20');
  const iPlayType = col('play_type');
  const iYards = col('yards_gained');
  const iDown = col('down');
  const i3Conv = col('third_down_converted');
  const i3Fail = col('third_down_failed');

  const seenDrives = new Set<string>();
  let from = nl + 1;
  while (from < csv.length) {
    let to = csv.indexOf('\n', from);
    if (to === -1) to = csv.length;
    const line = csv.slice(from, to);
    from = to + 1;
    if (line.length === 0) continue;
    const f = splitCsvLine(line);

    // Play-level: offensive plays for yards/play + 3rd-down conversion.
    const playType = f[iPlayType];
    if (playType === 'pass' || playType === 'run') {
      agg.plays++;
      agg.driveYards += csvNum(f[iYards]) ?? 0;
    }
    if (csvNum(f[iDown]) === 3) {
      if (f[i3Conv] === '1') agg.thirdConv++;
      else if (f[i3Fail] === '1') agg.thirdFail++;
    }

    // Drive-level: one record per (game, fixed_drive).
    const fd = f[iFixedDrive];
    const result = f[iResult];
    if (!fd || !result) continue;
    const key = `${f[iGame]}:${fd}`;
    if (seenDrives.has(key)) continue;
    seenDrives.add(key);
    agg.drives++;
    agg.outcomes[result] = (agg.outcomes[result] ?? 0) + 1;
    agg.drivePlayCountSum += csvNum(f[iPlayCount]) ?? 0;
    if (f[iInside20] === '1') {
      agg.rzDrives++;
      if (result === 'Touchdown') agg.rzTd++;
    }
  }
}

/** Bucket nflverse drive results into headline categories. */
function bucket(result: string): string {
  switch (result) {
    case 'Touchdown': return 'TD';
    case 'Field goal': return 'FG';
    case 'Missed field goal': return 'Missed FG';
    case 'Punt': return 'Punt';
    case 'Turnover': return 'Turnover';
    case 'Opp touchdown': return 'Turnover'; // defensive score off the drive
    case 'Turnover on downs': return 'Downs';
    case 'Safety': return 'Safety';
    case 'End of half': case 'End of game': return 'End of half/game';
    default: return result || '(none)';
  }
}

function pointsPerDrive(outcomes: Record<string, number>, drives: number): number {
  let pts = 0;
  for (const [res, n] of Object.entries(outcomes)) {
    if (res === 'Touchdown') pts += 6.95 * n; // ~TD + XP/2pt average
    else if (res === 'Field goal') pts += 3 * n;
    else if (res === 'Safety') pts += 2 * n; // points for the defense
  }
  return drives ? pts / drives : 0;
}

async function main(): Promise<void> {
  const start = Number(process.argv[2]) || 2015;
  const end = Number(process.argv[3]) || 2024;
  const agg = emptyAgg();
  console.log(`\nIngesting real NFL drives ${start}-${end} (nflverse pbp)…`);
  for (let y = start; y <= end; y++) {
    aggregateSeason(await loadSeason(y), agg);
  }

  // Aggregate buckets.
  const buckets: Record<string, number> = {};
  for (const [res, n] of Object.entries(agg.outcomes)) {
    buckets[bucket(res)] = (buckets[bucket(res)] ?? 0) + n;
  }

  console.log(`\n=== REAL NFL drive realism (${start}-${end}) — the bar ===`);
  console.log(`drives: ${agg.drives.toLocaleString()}\n`);
  console.log(`  outcome mix:`);
  const order = ['TD', 'FG', 'Missed FG', 'Punt', 'Turnover', 'Downs', 'Safety', 'End of half/game'];
  for (const b of order) {
    if (buckets[b] === undefined) continue;
    console.log(`    ${b.padEnd(18)} ${((buckets[b]! / agg.drives) * 100).toFixed(1).padStart(6)}%`);
  }
  console.log('');
  console.log(`  points / drive:        ${pointsPerDrive(agg.outcomes, agg.drives).toFixed(2)}`);
  console.log(`  plays / drive:         ${(agg.drivePlayCountSum / agg.drives).toFixed(1)}`);
  console.log(`  yards / drive (off):   ${(agg.driveYards / agg.drives).toFixed(1)}`);
  console.log(`  yards / play (off):    ${(agg.driveYards / agg.plays).toFixed(2)}`);
  const scoring = ((buckets['TD'] ?? 0) + (buckets['FG'] ?? 0)) / agg.drives;
  console.log(`  scoring drive %:       ${(scoring * 100).toFixed(1)}%`);
  console.log(`  3rd-down conversion %: ${((agg.thirdConv / (agg.thirdConv + agg.thirdFail)) * 100).toFixed(1)}%`);
  console.log(`  red-zone TD %:         ${((agg.rzTd / agg.rzDrives) * 100).toFixed(1)}%`);
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
