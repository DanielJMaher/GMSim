import { mkdir, writeFile } from 'node:fs/promises';
import { cachedFetch } from './fetch.js';
import { parseRoundPage } from './parse-round.js';
import { mergeCombine } from './combine.js';
import { YEARS, ROUNDS, roundUrl, DATA_DIR, CORPUS_PATH } from './config.js';
import type { Corpus, DraftPickRecord } from './types.js';

/**
 * Scrape every round of every covered draft year into a structured corpus.
 * Raw HTML is disk-cached, so re-runs only re-parse (no re-fetching).
 *
 * Usage:
 *   pnpm --filter @gmsim/truth-arbiter scrape            # all years
 *   pnpm --filter @gmsim/truth-arbiter scrape 2014       # one year
 *   pnpm --filter @gmsim/truth-arbiter scrape 2014 2015  # a range/list
 */
async function main(): Promise<void> {
  const argYears = process.argv.slice(2).map(Number).filter((n) => !Number.isNaN(n));
  const years = argYears.length > 0 ? argYears : YEARS;

  const picks: DraftPickRecord[] = [];
  for (const year of years) {
    let overall = 0;
    for (const round of ROUNDS) {
      const url = roundUrl(year, round);
      let html: string;
      try {
        html = await cachedFetch(url);
      } catch (err) {
        console.warn(`  ! ${year} R${round}: ${(err as Error).message}`);
        continue;
      }
      const roundPicks = parseRoundPage(html, year, round);
      for (const p of roundPicks) {
        overall += 1;
        p.overallPick = overall; // cumulative across rounds = true overall pick
      }
      picks.push(...roundPicks);
      const withScores = roundPicks.filter((p) => p.scores.overall !== null).length;
      console.log(
        `  ${year} R${round}: ${roundPicks.length} picks (${withScores} with NGS scores)`,
      );
    }
  }

  // Join combine athletic testing from the open nflverse dataset.
  const merge = await mergeCombine(picks);
  console.log(
    `\nCombine merge: ${merge.matched}/${merge.total} picks matched ` +
      `(${merge.byOvr} by overall pick, ${merge.byName} by name).`,
  );

  const corpus: Corpus = {
    generatedAt: new Date().toISOString(),
    years,
    pickCount: picks.length,
    picks,
  };
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(CORPUS_PATH, JSON.stringify(corpus, null, 2), 'utf8');
  console.log(`\nWrote ${picks.length} picks → ${CORPUS_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
