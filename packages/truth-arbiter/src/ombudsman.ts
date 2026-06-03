import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DATA_DIR } from './config.js';
import type { NdbPlayer, NdbPlayerData } from './ndb.js';

/**
 * The Ombudsman — media-spread realism authority (2026-06-02, Daniel-directed).
 *
 * Studies how much real draft media DISAGREES about a prospect — per prospect
 * and per position group — so GMSim's media can generate realistic disagreement
 * (the whole point of the "which sources to trust" layer). Data: NFLDraftBuzz's
 * per-source rank charts (`run ndb`), which give each prospect's rank across
 * ~9-10 outlets → spread (stdev) and range.
 *
 * Reports the real spread structure:
 *   1. by CONSENSUS TIER — spread grows steeply with rank (blue-chips are a
 *      lock; mid-board is chaos);
 *   2. by POSITION GROUP, rank-controlled (top-32 vs 33-120) — which positions
 *      analysts genuinely disagree on once you remove the rank effect;
 *   3. the most polarizing vs most-consensus prospects (eyeball check).
 *
 * (Next: compare GMSim's generated media spread against these targets.)
 *
 *   pnpm --filter @gmsim/truth-arbiter run ombudsman
 */

const GROUPS = ['QB', 'SKILL', 'OL', 'DL', 'LB', 'DB', 'ST'] as const;
type Group = (typeof GROUPS)[number];
const NDB_GROUP: Record<string, Group> = {
  QB: 'QB',
  RB: 'SKILL', WR: 'SKILL', TE: 'SKILL', FB: 'SKILL',
  OL: 'OL', OT: 'OL', IOL: 'OL', OG: 'OL', C: 'OL', G: 'OL', T: 'OL',
  DL: 'DL', EDGE: 'DL', DT: 'DL', DE: 'DL', IDL: 'DL',
  LB: 'LB', ILB: 'LB', OLB: 'LB',
  CB: 'DB', S: 'DB', FS: 'DB', SS: 'DB', DB: 'DB',
  K: 'ST', P: 'ST', LS: 'ST',
};

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}
function fmt(x: number): string {
  return Number.isNaN(x) ? '—' : x.toFixed(1);
}

async function main(): Promise<void> {
  const data = JSON.parse(
    await readFile(resolve(DATA_DIR, 'ndb-players.json'), 'utf8'),
  ) as NdbPlayerData;
  const players = data.players;
  if (players.length === 0) {
    console.error('No NFLDraftBuzz data — run `pnpm --filter @gmsim/truth-arbiter run ndb` first.');
    process.exit(1);
  }

  /* eslint-disable no-console */
  console.log(`\n=== The Ombudsman — real media spread (NFLDraftBuzz ${data.years.join(',')}) ===`);
  console.log(`${players.length} prospects, avg ${mean(players.map((p) => p.sourceRanks.length)).toFixed(1)} sources each. spread = stdev of a prospect's rank across outlets.\n`);

  // 1. by consensus tier
  const tiers: [string, (p: NdbPlayer) => boolean][] = [
    ['1-10', (p) => p.consensusRank <= 10],
    ['11-32', (p) => p.consensusRank > 10 && p.consensusRank <= 32],
    ['33-64', (p) => p.consensusRank > 32 && p.consensusRank <= 64],
    ['65-120', (p) => p.consensusRank > 64 && p.consensusRank <= 120],
  ];
  console.log('spread by CONSENSUS TIER (the dominant effect — disagreement explodes down-board):');
  console.log(`  ${'tier'.padEnd(8)} ${'n'.padStart(5)} ${'meanSpread'.padStart(11)} ${'meanRange'.padStart(10)}`);
  for (const [label, pred] of tiers) {
    const tp = players.filter(pred);
    console.log(`  ${label.padEnd(8)} ${String(tp.length).padStart(5)} ${fmt(mean(tp.map((p) => p.spread))).padStart(11)} ${fmt(mean(tp.map((p) => p.rankRange))).padStart(10)}`);
  }

  // 2. by position group, rank-controlled
  console.log('\nspread by POSITION GROUP, rank-controlled (isolates which positions are genuinely polarizing):');
  console.log(`  ${'grp'.padEnd(6)} ${'top32 sd'.padStart(9)} ${'(n)'.padStart(5)} ${'33-120 sd'.padStart(10)} ${'(n)'.padStart(5)}`);
  for (const g of GROUPS) {
    const gp = players.filter((p) => (NDB_GROUP[p.position] ?? 'ST') === g);
    const t32 = gp.filter((p) => p.consensusRank <= 32);
    const t120 = gp.filter((p) => p.consensusRank > 32 && p.consensusRank <= 120);
    if (gp.length === 0) continue;
    console.log(`  ${g.padEnd(6)} ${fmt(mean(t32.map((p) => p.spread))).padStart(9)} ${('(' + t32.length + ')').padStart(5)} ${fmt(mean(t120.map((p) => p.spread))).padStart(10)} ${('(' + t120.length + ')').padStart(5)}`);
  }

  // 3. most polarizing vs most consensus (within top-64, where it's meaningful)
  const top64 = players.filter((p) => p.consensusRank <= 64);
  const byPolar = [...top64].sort((a, b) => b.spread - a.spread);
  console.log('\nmost POLARIZING (top-64):');
  for (const p of byPolar.slice(0, 6)) {
    const lo = Math.min(...p.sourceRanks.map((s) => s.rank));
    const hi = Math.max(...p.sourceRanks.map((s) => s.rank));
    console.log(`  ${p.name.padEnd(22)} ${p.position.padEnd(4)} consensus ${String(p.consensusRank).padStart(5)}  sd ${p.spread.toFixed(1).padStart(5)}  (ranked ${lo}–${hi} across sources)`);
  }
  console.log('most CONSENSUS (top-64):');
  for (const p of byPolar.slice(-4).reverse()) {
    console.log(`  ${p.name.padEnd(22)} ${p.position.padEnd(4)} consensus ${String(p.consensusRank).padStart(5)}  sd ${p.spread.toFixed(1).padStart(5)}`);
  }
  console.log('');
  /* eslint-enable no-console */
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
