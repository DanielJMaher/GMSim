import { OLLAMA_URL, EMBED_MODEL } from '../lib/config.js';

interface EmbeddingResponse {
  embedding: number[];
}

/** Embed a single text via the local Ollama nomic-embed-text model. */
export async function embedText(text: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  });
  if (!res.ok) {
    throw new Error(`ollama embeddings → HTTP ${res.status} (is Ollama running, model pulled?)`);
  }
  const json = (await res.json()) as EmbeddingResponse;
  if (!Array.isArray(json.embedding)) {
    throw new Error('ollama embeddings: missing embedding in response');
  }
  return json.embedding;
}

/** Quick liveness check so the embed step fails fast with a clear message. */
export async function assertOllamaReady(): Promise<void> {
  let tags: { models?: { name?: string }[] };
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`);
    tags = (await res.json()) as typeof tags;
  } catch {
    throw new Error(`Ollama not reachable at ${OLLAMA_URL}. Start it and retry.`);
  }
  const names = (tags.models ?? []).map((m) => m.name ?? '');
  if (!names.some((n) => n.startsWith(EMBED_MODEL))) {
    throw new Error(`Model "${EMBED_MODEL}" not pulled. Run: ollama pull ${EMBED_MODEL}`);
  }
}
