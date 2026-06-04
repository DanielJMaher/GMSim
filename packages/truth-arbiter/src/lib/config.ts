import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Package root (…/packages/truth-arbiter). */
export const PACKAGE_ROOT = resolve(__dirname, '..', '..');

/** All scraped + derived artifacts live here (git-ignored). */
export const DATA_DIR = resolve(PACKAGE_ROOT, 'data');
/** Raw HTML cache — fetch once, parse freely, never re-hit the site. */
export const RAW_HTML_DIR = resolve(DATA_DIR, 'raw');
/** Structured corpus output. */
export const CORPUS_PATH = resolve(DATA_DIR, 'corpus.json');
/** Embedded write-up index output. */
export const EMBEDDINGS_PATH = resolve(DATA_DIR, 'embeddings.json');

/** Draft years to cover (inclusive). 2014 is the earliest with NGS scores. */
export const YEARS: readonly number[] = Array.from(
  { length: 2026 - 2014 + 1 },
  (_, i) => 2014 + i,
);
export const ROUNDS: readonly number[] = [1, 2, 3, 4, 5, 6, 7];

export function roundUrl(year: number, round: number): string {
  return `https://www.nfl.com/draft/tracker/${year}/rounds/${round}`;
}

/** Polite crawl delay between live fetches (ms). */
export const FETCH_DELAY_MS = 1100;

/** Browser-ish UA — nfl.com 403s obvious bots. */
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** Local Ollama embedding model + endpoint. */
export const OLLAMA_URL = 'http://localhost:11434';
export const EMBED_MODEL = 'nomic-embed-text';
