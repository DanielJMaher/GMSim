import { simulateSeasonPlayerStats, type SeasonPlayerStat } from '../lib/engine-bridge.js';

/**
 * Star-separation check (stage 1b validation).
 *
 * The bottom-up drive sim attributes each play's outcome to specific players by
 * skill-weighted share, so an elite player should be fed more and his stat line
 * should SEPARATE from a replacement-level teammate. This harness sims a league
 * season with `simulateGameWithDrives`, projects each player's emergent stats to
 * a 17-game season, and reports:
 *   - league leaders (with their talent grade) vs real NFL leader bars,
 *   - production-by-grade curves (does it climb monotonically with talent?).
 *
 *   pnpm --filter @gmsim/truth-arbiter run star [seed]
 */

const GRADE_ORDER = ['ELITE', 'STAR', 'HIGH_STARTER', 'STARTER', 'WEAK_STARTER', 'ROTATIONAL', 'BACKUP', 'FRINGE'];

function per17(total: number, games: number): number {
  return games > 0 ? (total / games) * 17 : 0;
}

function topN(rows: { name: string; grade: string; val: number; extra: string }[], n: number): void {
  rows.sort((a, b) => b.val - a.val);
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

  console.log('=== League leaders (projected to 17 games) vs real NFL bar ===');
  console.log('  Passing yards (real leader ~4800, QB1-tier ~4000):');
  topN(
    players.filter((p) => p.position === 'QB').map((p) => ({
      name: p.id, grade: p.talentGrade, val: per17(p.passingYards, p.teamGames),
      extra: `${p.position}  ${per17(p.passingTds, p.teamGames).toFixed(0)} TD / ${per17(p.interceptionsThrown, p.teamGames).toFixed(0)} INT`,
    })),
    6,
  );
  console.log('\n  Rushing yards (real leader ~1800, RB1-tier ~1200):');
  topN(
    players.filter((p) => p.rushingYards > 0).map((p) => ({
      name: p.id, grade: p.talentGrade, val: per17(p.rushingYards, p.teamGames),
      extra: `${p.position}  ${per17(p.rushingTds, p.teamGames).toFixed(0)} TD`,
    })),
    6,
  );
  console.log('\n  Receiving yards (real leader ~1700, WR1-tier ~1200):');
  topN(
    players.filter((p) => p.receivingYards > 0).map((p) => ({
      name: p.id, grade: p.talentGrade, val: per17(p.receivingYards, p.teamGames),
      extra: `${p.position}  ${per17(p.receptions, p.teamGames).toFixed(0)} rec / ${per17(p.receivingTds, p.teamGames).toFixed(0)} TD`,
    })),
    6,
  );
  console.log('\n  Sacks (real leader ~18, edge1-tier ~12):');
  topN(
    players.filter((p) => p.sacks > 0).map((p) => ({
      name: p.id, grade: p.talentGrade, val: per17(p.sacks, p.teamGames), extra: p.position,
    })),
    6,
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
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
