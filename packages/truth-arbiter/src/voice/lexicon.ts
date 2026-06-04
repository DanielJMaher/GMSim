/**
 * Lexicon utilities for The Scribe (2026-06-04, Daniel-directed).
 *
 * Small, dependency-free text tooling to characterize the VOICE of real
 * scouting reports: tokenization, n-grams, and the Monroe et al. (2008)
 * "weighted log-odds with an informative Dirichlet prior" — the principled way
 * to ask "which words distinguish corpus A from corpus B?" (strengths vs
 * weaknesses, one position vs the rest). Frequent-everywhere words wash out;
 * what survives is the distinctive vocabulary. Pure functions, no I/O.
 */

/** Standard English stoplist + scouting-generic filler that carries no voice
 *  signal ("player", "guy", "really"). Football TERMS are deliberately kept —
 *  they ARE the signal. */
const STOPWORDS = new Set<string>(
  (
    'a an the and or but if then else when while of to in on at by for with from into ' +
    'over under up down out off as is are was were be been being am do does did doing ' +
    'have has had having will would shall should can could may might must this that these ' +
    'those it its he she his her him they them their there here who whom which what whose ' +
    'you your yours we us our i me my mine not no nor so than too very just also more most ' +
    'much many some any all each every both few other another such own same one two three ' +
    'who whats hes shes theyre got get gets getting go goes going dont doesnt isnt arent ' +
    'player players guy guys prospect prospects hes well good lot really able comes come ' +
    'team teams year years season seasons time times way ways back number area level ' +
    'plays play played make makes made making see seen show shows shown need needs needed'
  ).split(/\s+/),
);

/** Lowercase, collapse contractions (don't → dont), split on non-letters, drop
 *  stopwords and very short tokens. Collapsing apostrophes first keeps "doesn't"
 *  from splitting into the junk token "doesn". */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().replace(/['’]/g, '').split(/[^a-z]+/)) {
    if (raw.length < 3) continue;
    if (STOPWORDS.has(raw)) continue;
    out.push(raw);
  }
  return out;
}

/** Contiguous n-grams over an already-tokenized array. */
export function ngrams(tokens: string[], n: number): string[] {
  if (n <= 1) return tokens;
  const out: string[] = [];
  for (let i = 0; i + n <= tokens.length; i++) out.push(tokens.slice(i, i + n).join(' '));
  return out;
}

/** Count terms (uni- + optionally bi-grams) across many texts. */
export function countTerms(texts: string[], maxN = 2): Map<string, number> {
  const counts = new Map<string, number>();
  for (const text of texts) {
    const toks = tokenize(text);
    for (let n = 1; n <= maxN; n++) {
      for (const g of ngrams(toks, n)) counts.set(g, (counts.get(g) ?? 0) + 1);
    }
  }
  return counts;
}

export interface LogOddsTerm {
  term: string;
  /** z-score: large positive → distinctive of A, large negative → of B. */
  z: number;
  countA: number;
  countB: number;
}

/**
 * Monroe-et-al. weighted log-odds with an uninformative Dirichlet prior.
 * Returns terms sorted by z (descending): the head distinguishes A, the tail
 * distinguishes B. `minCount` drops hapax noise (a term seen once total).
 */
export function logOdds(
  countsA: Map<string, number>,
  countsB: Map<string, number>,
  { alpha = 0.25, minCount = 5 }: { alpha?: number; minCount?: number } = {},
): LogOddsTerm[] {
  const vocab = new Set<string>([...countsA.keys(), ...countsB.keys()]);
  let nA = 0;
  let nB = 0;
  for (const c of countsA.values()) nA += c;
  for (const c of countsB.values()) nB += c;
  const a0 = alpha * vocab.size; // total prior mass
  const out: LogOddsTerm[] = [];
  for (const term of vocab) {
    const yA = countsA.get(term) ?? 0;
    const yB = countsB.get(term) ?? 0;
    if (yA + yB < minCount) continue;
    // log-odds of term-vs-rest in A minus the same in B
    const lA = Math.log((yA + alpha) / (nA + a0 - yA - alpha));
    const lB = Math.log((yB + alpha) / (nB + a0 - yB - alpha));
    const delta = lA - lB;
    const variance = 1 / (yA + alpha) + 1 / (yB + alpha);
    out.push({ term, z: delta / Math.sqrt(variance), countA: yA, countB: yB });
  }
  out.sort((a, b) => b.z - a.z);
  return out;
}

/** Fraction of texts whose tokenization matches any term in `set`. */
export function hitRate(texts: string[], set: Set<string>): number {
  if (texts.length === 0) return 0;
  let hits = 0;
  for (const text of texts) {
    if (tokenize(text).some((t) => set.has(t))) hits++;
  }
  return hits / texts.length;
}

/** Unique-token / total-token ratio — a coarse vocabulary-richness measure.
 *  TTR falls as a corpus grows (more chance to repeat), so to compare corpora
 *  of different sizes fairly we cap at the first `cap` tokens (standardized
 *  TTR). Pass cap=0 to use every token. */
export function typeTokenRatio(texts: string[], cap = 20000): number {
  const seen = new Set<string>();
  let total = 0;
  for (const text of texts) {
    for (const t of tokenize(text)) {
      seen.add(t);
      if (++total === cap) return seen.size / total;
    }
  }
  return total === 0 ? 0 : seen.size / total;
}

export function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}
