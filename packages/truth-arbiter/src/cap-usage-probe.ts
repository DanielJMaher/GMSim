import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PACKAGE_ROOT } from './config.js';

/** One-off probe: average team cap usage at league creation (to recenter the
 *  position-weighted contract generator so total spend stays ~$240M). */
const ENGINE_DIST = resolve(PACKAGE_ROOT, '../engine/dist/index.js');

async function main(): Promise<void> {
  if (!existsSync(ENGINE_DIST)) throw new Error('build engine first');
  const eng = (await import(pathToFileURL(ENGINE_DIST).href)) as {
    createLeague: (o: { seed: string }) => { teams: Record<string, unknown>; salaryCap: number };
    summarizeTeamCap: (team: unknown, league: unknown) => { capUsed: number };
  };
  for (const seed of ['cap-a', 'cap-b', 'cap-c']) {
    const league = eng.createLeague({ seed });
    const used: number[] = [];
    for (const t of Object.values(league.teams)) used.push(eng.summarizeTeamCap(t, league).capUsed);
    used.sort((a, b) => a - b);
    const avg = used.reduce((s, v) => s + v, 0) / used.length;
    const over = used.filter((u) => u > league.salaryCap).length;
    console.log(
      `${seed}: cap $${(league.salaryCap / 1e6).toFixed(0)}M  avg used $${(avg / 1e6).toFixed(1)}M  ` +
        `min $${(used[0]! / 1e6).toFixed(0)}M  max $${(used[used.length - 1]! / 1e6).toFixed(0)}M  over-cap teams: ${over}/32`,
    );
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
