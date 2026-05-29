import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { RAW_HTML_DIR, USER_AGENT, FETCH_DELAY_MS } from './config.js';

/** Turn a URL into a safe cache filename. */
function cacheKey(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9._-]/g, '_') + '.html';
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

let lastFetch = 0;
async function politeDelay(): Promise<void> {
  const wait = FETCH_DELAY_MS - (Date.now() - lastFetch);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetch = Date.now();
}

/**
 * Fetch a URL, caching the raw HTML to disk. Subsequent calls read the
 * cache — we never re-hit the site for a page we already have. Set
 * `force` to bypass the cache for a single fetch.
 */
export async function cachedFetch(url: string, force = false): Promise<string> {
  await mkdir(RAW_HTML_DIR, { recursive: true });
  const path = resolve(RAW_HTML_DIR, cacheKey(url));
  if (!force && (await exists(path))) {
    return readFile(path, 'utf8');
  }
  await politeDelay();
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
  });
  if (!res.ok) {
    throw new Error(`fetch ${url} → HTTP ${res.status}`);
  }
  const html = await res.text();
  await writeFile(path, html, 'utf8');
  return html;
}
