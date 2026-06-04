import { readFile } from 'node:fs/promises';
import { embedText, assertOllamaReady } from './ollama.js';
import { EMBEDDINGS_PATH } from '../lib/config.js';
import type { EmbeddingIndex } from '../lib/types.js';

/**
 * Semantic search over real prospect write-ups. Embeds a query and returns
 * the most similar real scouting reports — the retrieval primitive the
 * Truth Arbiter will use to answer "which real prospects does this
 * generated player resemble?".
 *
 * Usage: pnpm --filter @gmsim/truth-arbiter search "explosive edge bender with rare get-off"
 */
function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

async function main(): Promise<void> {
  const query = process.argv.slice(2).join(' ').trim();
  if (!query) {
    console.error('usage: search "<query text>"');
    process.exit(1);
  }
  await assertOllamaReady();
  const index = JSON.parse(await readFile(EMBEDDINGS_PATH, 'utf8')) as EmbeddingIndex;
  const q = await embedText(query);
  const top = index.records
    .map((r) => ({ r, score: cosine(q, r.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  console.log(`\nTop 10 real prospects similar to: "${query}"\n`);
  for (const { r, score } of top) {
    console.log(
      `  ${score.toFixed(3)}  ${r.year} ${r.playerName} (${r.position ?? '?'})\n` +
        `         ${r.text.slice(0, 150)}…\n`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
