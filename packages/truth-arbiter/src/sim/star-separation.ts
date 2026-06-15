import { simulateSeasonPlayerStats, type SeasonPlayerStat } from '../lib/engine-bridge.js';

/**
 * Star-separation check (stage 1b validation) — the LEADERBOARD gate.
 *
 * The bottom-up drive sim attributes each play's outcome to specific players by
 * skill-weighted share, so an elite player should be fed more and his stat line
 * should SEPARATE from a replacement-level teammate. This harness sims a league
 * season with `simulateGameWithDrives`, projects each player's emergent stats to
 * a 17-game season, and reports:
 *   - league leaders vs real NFL single-season LEADER bars (with a `<-- DRIFT`
 *     flag when the sim leader exceeds a realistic ceiling — this is what makes
 *     `run gates` catch leaderboard inflation; the team-aggregate Scorekeeper
 *     never sees it because per-team sacks/INTs can be on-bar while one player
 *     hoards them);
 *   - production-by-grade curves (does it climb monotonically with talent?).
 *
 *   pnpm --filter @gmsim/truth-arbiter run star [seed]
 */

const GRADE_ORDER = ['ELITE', 'STAR', 'HIGH_STARTER', 'STARTER', 'WEAK_STARTER', 'ROTATIONAL', 'BACKUP', 'FRINGE'];

/**
 * Per-stat ceilings for a single simulated season's LEAGUE LEADER. Set at (or
 * just under) the real NFL all-time single-season record: a 32-team season's
 * leader should be a high-end real year, not exceed the record every season. A
 * sim leader above the ceiling means the attribution is over-concentrating
 * (the v0.158 bug: a 25-sack edge / 24-sack NT, both above the 22.5 record).
 * Typical real leaders sit well below these — the band is the inflation alarm,
 * not a calibration target.
 */
interface LeaderBar {
  /** Real all-time single-season record (the hard ceiling). */
  ceiling: number;
  /** Typical real league-leader, for context in the printout. */
  typical: number;
}
const BARS = {
  passingYards: { ceiling: 5500, typical: 4800 }, // record 5477
  rushingYards: { ceiling: 2050, typical: 1800 }, // record 2105
  receivingYards: { ceiling: 1950, typical: 1700 }, // record 1964
  sacks: { ceiling: 22, typical: 18 }, // record 22.5
  defInts: { ceiling: 11, typical: 8 }, // modern high ~10-11 (Night Train's 14 is a 1952 outlier)
} satisfies Record<string, LeaderBar>;

let flagCount = 0;

function per17(total: number, games: number): number {
  return games > 0 ? (total / games) * 17 : 0;
}

/**
 * Print a leaderboard's top `n` and raise a `<-- DRIFT` flag (counted by
 * `run gates`) when the leader exceeds the real single-season ceiling.
 */
function leaderboard(
  label: string,
  bar: LeaderBar,
  rows: { grade: string; val: number; extra: string }[],
  n = 6,
): void {
  rows.sort((a, b) => b.val - a.val);
  const leader = rows[0]?.val ?? 0;
  const over = leader > bar.ceiling;
  console.log(
    `\n  ${label} (real leader ~${bar.typical}, record-ceiling ${bar.ceiling}):` +
      (over ? `  <-- DRIFT (leader ${leader.toFixed(0)} > ${bar.ceiling})` : ''),
  );
  if (over) flagCount++;
  for (const r of rows.slice(0, n)) {
    console.log(`    ${r.val.toFixed(0).padStart(5)}  ${r.grade.padEnd(13)} ${r.extra}`);
  }
}

function byGrade(
  players: SeasonPlayerStat[],
  predicate: (p: SeasonPlayerStat) => boolean,
  value: (p: SeasonPlayerStat) => number,
): void {
  const groups = new Map<string, number[]>();
  for (const p of players) {
    if (!predicate(p)) continue;
    const arr = groups.get(p.talentGrade) ?? [];
    arr.push(per17(value(p), p.teamGames));
    groups.set(p.talentGrade, arr);
  }
  for (const g of GRADE_ORDER) {
    const arr = groups.get(g);
    if (!arr || arr.length === 0) continue;
    arr.sort((a, b) => b - a);
    const avg = arr.reduce((s, v) => s + v, 0) / arr.length;
    const max = arr[0]!;
    console.log(`    ${g.padEnd(14)} n=${String(arr.length).padStart(3)}  avg ${avg.toFixed(0).padStart(5)}  best ${max.toFixed(0).padStart(5)}`);
  }
}

async function main(): Promise<void> {
  const seed = process.argv[2] ?? 'star-1';
  console.log(`\nSimulating a bottom-up season (seed ${seed})…`);
  const players = await simulateSeasonPlayerStats(seed);
  console.log(`  ${players.length} players with attributed stats.\n`);

  console.log('=== League leaders (projected to 17 games) vs real NFL leader bar ===');
  leaderboard(
    'Passing yards',
    BARS.passingYards,
    players.filter((p) => p.position === 'QB').map((p) => ({
      grade: p.talentGrade, val: per17(p.passingYards, p.teamGames),
      extra: `${p.position}  ${per17(p.passingTds, p.teamGames).toFixed(0)} TD / ${per17(p.interceptionsThrown, p.teamGames).toFixed(0)} INT`,
    })),
  );
  leaderboard(
    'Rushing yards',
    BARS.rushingYards,
    players.filter((p) => p.rushingYards > 0).map((p) => ({
      grade: p.talentGrade, val: per17(p.rushingYards, p.teamGames),
      extra: `${p.position}  ${per17(p.rushingTds, p.teamGames).toFixed(0)} TD`,
    })),
  );
  leaderboard(
    'Receiving yards',
    BARS.receivingYards,
    players.filter((p) => p.receivingYards > 0).map((p) => ({
      grade: p.talentGrade, val: per17(p.receivingYards, p.teamGames),
      extra: `${p.position}  ${per17(p.receptions, p.teamGames).toFixed(0)} rec / ${per17(p.receivingTds, p.teamGames).toFixed(0)} TD`,
    })),
  );
  leaderboard(
    'Sacks',
    BARS.sacks,
    players.filter((p) => p.sacks > 0).map((p) => ({
      grade: p.talentGrade, val: per17(p.sacks, p.teamGames), extra: p.position,
    })),
  );
  leaderboard(
    'Defensive INTs',
    BARS.defInts,
    players.filter((p) => p.interceptions > 0).map((p) => ({
      grade: p.talentGrade, val: per17(p.interceptions, p.teamGames), extra: p.position,
    })),
  );

  console.log('\n=== Production by talent grade (per-17 avg / best) — should climb with talent ===');
  console.log('  QB passing yards:');
  byGrade(players, (p) => p.position === 'QB' && p.passAttempts > 0, (p) => p.passingYards);
  console.log('  WR receiving yards:');
  byGrade(players, (p) => p.position === 'WR', (p) => p.receivingYards);
  console.log('  RB rushing yards:');
  byGrade(players, (p) => p.position === 'RB', (p) => p.rushingYards);
  console.log('  EDGE sacks:');
  byGrade(players, (p) => p.position === 'EDGE', (p) => p.sacks);
  console.log('  CB+S defensive INTs:');
  byGrade(players, (p) => p.position === 'CB' || p.position === 'S', (p) => p.interceptions);

  console.log(
    `\n  ${flagCount === 0 ? 'No leaderboard drift — every league leader is within the real single-season ceiling.' : `${flagCount} leaderboard(s) over the real ceiling (see <-- DRIFT above).`}\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
