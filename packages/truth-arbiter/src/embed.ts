import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { embedText, assertOllamaReady } from './ollama.js';
import { CORPUS_PATH, EMBEDDINGS_PATH, DATA_DIR, EMBED_MODEL } from './config.js';
import type { Corpus, EmbeddingIndex, EmbeddedRecord } from './types.js';

/**
 * Embed every prospect write-up with nomic-embed-text into a vector index
 * for semantic retrieval ("which real prospects resemble this generated
 * player?"). Reads the corpus produced by `scrape`.
 *
 * Usage: pnpm --filter @gmsim/truth-arbiter embed
 */
async function main(): Promise<void> {
  await assertOllamaReady();

  const corpus = JSON.parse(await readFile(CORPUS_PATH, 'utf8')) as Corpus;
  const withText = corpus.picks.filter((p) => p.analysis && p.analysis.length > 0);
  console.log(`Embedding ${withText.length}/${corpus.picks.length} write-ups via ${EMBED_MODEL}…`);

  const records: EmbeddedRecord[] = [];
  let dim = 0;
  let done = 0;
  for (const p of withText) {
    const text = p.analysis!;
    const vector = await embedText(text);
    dim = vector.length;
    records.push({
      key: `${p.year}-${p.round}-${p.pickInRound}`,
      year: p.year,
      round: p.round,
      playerName: p.playerName,
      position: p.position,
      text,
      vector,
    });
    if (++done % 100 === 0) console.log(`  …${done}/${withText.length}`);
  }

  const index: EmbeddingIndex = {
    generatedAt: new Date().toISOString(),
    model: EMBED_MODEL,
    dim,
    records,
  };
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(EMBEDDINGS_PATH, JSON.stringify(index), 'utf8');
  console.log(`\nWrote ${records.length} embeddings (dim ${dim}) → ${EMBEDDINGS_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
