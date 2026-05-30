import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PACKAGE_ROOT } from './config.js';

/** Diagnose Pro Bowl slot under-fill: rostered count per position vs slots. */
const ENGINE_DIST = resolve(PACKAGE_ROOT, '../engine/dist/index.js');

// Mirror of ACCOLADE_SLOTS proBowl counts (season/awards.ts).
const SLOTS: Record<string, number> = {
  QB: 6, RB: 6, FB: 1, WR: 12, TE: 6, LT: 4, RT: 4, LG: 3, RG: 3, C: 3,
  EDGE: 8, DT: 5, NT: 1, OLB: 4, ILB: 4, CB: 8, S: 6, NICKEL: 2, K: 2, P: 2, LS: 1,
};

async function main(): Promise<void> {
  if (!existsSync(ENGINE_DIST)) throw new Error(`build engine first: ${ENGINE_DIST}`);
  const eng = (await import(pathToFileURL(ENGINE_DIST).href)) as {
    Prng: new (s: string) => unknown;
    createLeague: (o: { seed: string }) => { players: Record<string, { position: string; teamId: string | null }> };
  };
  const league = eng.createLeague({ seed: 'slot-diag' });
  const counts: Record<string, number> = {};
  for (const p of Object.values(league.players)) {
    if (!p.teamId) continue;
    counts[p.position] = (counts[p.position] ?? 0) + 1;
  }
  console.log(`\n  ${'pos'.padEnd(7)} ${'rostered'.padStart(9)} ${'slots'.padStart(6)} ${'short?'.padStart(7)}`);
  let totalShort = 0;
  for (const [pos, slots] of Object.entries(SLOTS)) {
    const c = counts[pos] ?? 0;
    const short = Math.max(0, slots - c);
    totalShort += short;
    console.log(`  ${pos.padEnd(7)} ${String(c).padStart(9)} ${String(slots).padStart(6)} ${(short ? `-${short}` : '').padStart(7)}`);
  }
  console.log(`\n  total slots short (rostered < slots): ${totalShort}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
