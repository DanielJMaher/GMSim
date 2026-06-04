import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DATA_DIR } from '../lib/config.js';

/**
 * PFF NFL Draft Guide — parsed (2026-06-04, Daniel-directed).
 *
 * A SECOND scouting voice alongside The Beast. PFF's guide reads nothing like
 * Brugler: terse data-forward "pros and cons," one-word biggest-strength/weakness
 * tags, an NFL player comparison, an analysis blurb, and a round PROJECTION. We
 * ingest it so The Scribe (voice) + The Narrator (bios) learn from MULTIPLE
 * sources and don't over-fit to a single author — and so the media can model
 * differing opinions (the gap between two real outlets).
 *
 * Source: Daniel's PFF 2021 (pre-draft) + 2022 (preseason) guides, decrypted-
 * free, `pdftotext -layout` extracted to `data/pff/raw/<year>.txt` (gitignored —
 * PFF's copyrighted work; local calibration reference only, never redistributed
 * or surfaced verbatim in-game).
 *
 * Format note: PFF is a dense 2-column infographic (grade bars, stat charts), so
 * extraction is necessarily looser than the Beast's clean text. Each prospect's
 * "PROS AND CONS" PAGE carries the name (left col), the evaluation bullets (left
 * col), the analysis prose (right col) and the PROJECTION — enough for a voice
 * corpus. The separate player-CARD page (ht/wt/comp) is left for later.
 *
 *   pnpm --filter @gmsim/truth-arbiter run pff [year ...]
 */

const RAW_DIR = resolve(DATA_DIR, 'pff', 'raw');
const OUT_DIR = resolve(DATA_DIR, 'pff');

export interface PffReport {
  source: 'PFF';
  year: number;
  name: string | null;
  /** Round/draft projection raw (e.g. "7-UDFA", "Round 2"). */
  projectionRaw: string | null;
  /** Best (lowest) projected round; UDFA/FA → 8. */
  round: number | null;
  /** PFF's terse evaluation points (the "pros and cons" voice — for The Scribe). */
  evalPoints: string[];
  /** The analysis / background prose (PFF voice + bio — for The Narrator). */
  analysis: string | null;
}

const POS_HEADER = /^(?:QB|RB|WR|TE|IOL|OL|OT|G|C|EDGE|DI|DL|DT|LB|CB|S|K|P|LS|FB|ATH|\s)+$/;
const CHART_NOISE = /^[\d.\s%|]+$|^(STAT COMPARABLES|BAR HEIGHT|PASSING GRADE|GRADE|AVG\.|INTERMEDIATE|DEEP|PRESSURE|NO PRESSURE|Table of Contents|PROS AND CONS|2020 SEASON|2019 SEASON|2018 SEASON|THREE-YEAR STATS|OVR|2020 GAME)/i;

/** Pull a PFF round projection from the ": X-Y NFL DRAFT" / "Round N" markers. */
function parseProjection(text: string): { projectionRaw: string | null; round: number | null } {
  // "7-UDFA NFL DRAFT", "2-3 NFL DRAFT", "1 NFL DRAFT"
  const m = text.match(/:?\s*(\d(?:[-–]\d|[-–]UDFA)?|UDFA)\s+NFL DRAFT/i);
  let projectionRaw: string | null = m ? m[1]!.toUpperCase() : null;
  if (!projectionRaw) {
    const rd = text.match(/\bRound\s+(\d)\b/i);
    if (rd) projectionRaw = `Round ${rd[1]}`;
  }
  let round: number | null = null;
  if (projectionRaw) {
    if (/UDFA/i.test(projectionRaw)) round = 8;
    else {
      const n = projectionRaw.match(/\d/);
      if (n) round = Number(n[0]);
    }
  }
  return { projectionRaw, round };
}

/** Split a pros/cons page into {left, right} columns. Splits at the whitespace
 *  GAP between columns (≥4 spaces after col ~25) so words aren't cut; a line
 *  with no gap is assigned by its leading indentation. */
function splitColumns(page: string): { left: string[]; right: string[] } {
  const left: string[] = [];
  const right: string[] = [];
  for (const raw of page.split('\n')) {
    if (!raw.trim()) continue;
    // Find the whitespace gap (≥3) whose END sits nearest the column boundary
    // (x≈48). Works for short left lines (the 18-char position header) too.
    let best: { start: number; end: number } | null = null;
    for (const m of raw.matchAll(/\s{3,}/g)) {
      const end = m.index! + m[0].length;
      if (end < 38 || end > 60) continue;
      if (!best || Math.abs(end - 48) < Math.abs(best.end - 48)) best = { start: m.index!, end };
    }
    if (best) {
      const l = raw.slice(0, best.start).trim();
      const r = raw.slice(best.end).trim();
      if (l) left.push(l);
      if (r) right.push(r);
    } else if (/^\s{42,}\S/.test(raw)) {
      right.push(raw.trim()); // deeply indented → right column only
    } else {
      left.push(raw.trim());
    }
  }
  return { left, right };
}

/** Strip chart labels/percentile numbers that bleed into an eval bullet from
 *  the infographic's middle column. */
const CHART_PHRASES = /\b(STAT COMPARABLES|BAR HEIGHT DENOTES PERCENTILE|PASSING GRADE|INTERMEDIATE|DEEP GRADE|NO PRESSURE|PRESSURE GRADE|GRADE|AVG\.|OVERALL|RECEIVING|RUSHING|COVERAGE|PASS RUSH|RUN DEFENSE|TACKLING)\b/g;
function cleanChartBleed(s: string): string {
  return s
    .replace(CHART_PHRASES, ' ')
    .replace(/\b\d{1,3}\.\d\b/g, ' ') // percentile grades like 74.6
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,])/g, '$1')
    .trim();
}

/** Re-flow wrapped lines into sentences/points: a line that doesn't end with
 *  terminal punctuation folds into the next. */
function reflow(lines: string[]): string[] {
  const out: string[] = [];
  let buf = '';
  for (const line of lines) {
    buf = buf ? `${buf} ${line}` : line;
    if (/[.!?]"?$/.test(line)) { out.push(buf.trim()); buf = ''; }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** PFF 2022 preseason format: a single-column writeup with `Shades Of:` (comp),
 *  terse strength TRAIT-TAGS, and an analysis blob. Cleaner than 2021. */
function parsePff2022Page(year: number, page: string): PffReport | null {
  if (!/Shades Of/i.test(page)) return null;
  const lines = page.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l);
  // Name: first ALL-CAPS multiword token before "POS RK"/quote/measurables.
  const nameLine = lines.find((l) => /^[A-Z][A-Z'’.\- ]{3,}/.test(l) && !POS_HEADER.test(l) && !/SHADES|TRENGTHS|GAME GRADES|TABLE OF/i.test(l));
  const name = nameLine ? (nameLine.match(/^([A-Z][A-Z'’.\- ]+?)(?:\s+["“]|\s+POS RK|$)/)?.[1]?.trim() ?? null) : null;
  // Comp from "Shades Of: - REX GROSSMAN" (the "- NAME" line after the marker).
  const compM = page.match(/Shades Of:?[^\n]*\n[^\n]*?-\s*([A-Z][A-Za-z.'’ -]+)/i);
  const comp = compM ? compM[1]!.replace(/\s+/g, ' ').trim() : null;
  // Strength trait-tags: the ALL-CAPS fragments in the window between the
  // STRENGTHS header and the GAME GRADES chart. Wild multi-column layout, so
  // best-effort: collect short ALL-CAPS tokens, fold wrapped pairs, dedupe.
  const tags = extractPff2022Strengths(page);
  // Analysis: the prose paragraph (sentence-like lines before "Shades Of").
  const beforeShades = page.split(/Shades Of/i)[0] ?? page;
  const analysis =
    reflow(beforeShades.split('\n').map((l) => l.trim()).filter((l) => l && /[a-z]/.test(l) && !POS_HEADER.test(l) && !CHART_NOISE.test(l)))
      .filter((p) => p.length > 30 && /[.!?]/.test(p))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim() || null;
  const evalPoints = [...(comp ? [`Shades of ${comp}`] : []), ...tags];
  return { source: 'PFF', year, name, projectionRaw: comp ? `Shades Of ${comp}` : null, round: null, evalPoints, analysis };
}

/** Best-effort scrape of the chaotic multi-column STRENGTHS region of a PFF 2022
 *  page: ALL-CAPS trait fragments between the (S)TRENGTHS header and the GAME
 *  GRADES chart, with wrapped pairs (DEEP / BALL → "DEEP BALL") folded back. */
function extractPff2022Strengths(page: string): string[] {
  const all = page.split('\n');
  const start = all.findIndex((l) => /\bT?RENGTHS\b/.test(l));
  const end = all.findIndex((l) => /GAME GRADES|TABLE OF CONTENTS/i.test(l));
  if (start < 0) return [];
  const window = all.slice(start, end > start ? end : start + 8);
  const frags: string[] = [];
  for (const raw of window) {
    // each whitespace-separated ALL-CAPS run that isn't header/comp/noise
    for (const tok of raw.split(/\s{2,}/)) {
      const t = tok.trim();
      if (!t) continue;
      if (/^-/.test(t)) continue; // comp line
      if (/T?RENGTHS|SHADES|POS RK|OVR RK|RECRUITING|CLASS/i.test(t)) continue;
      if (!/^[A-Z][A-Z ]{1,24}$/.test(t)) continue; // ALL-CAPS short phrase only
      frags.push(t.replace(/\s+/g, ' '));
    }
  }
  // Emit each fragment as its own trait tag (no cross-fragment folding — the
  // wide-gap column layout makes "two tags" vs "one wrapped tag" ambiguous, and
  // false merges are worse than a split). Dedupe, preserve order.
  return [...new Set(frags.map((t) => t.trim()))].filter((t) => t.length >= 3).slice(0, 10);
}

export function parsePffYear(year: number, text: string): PffReport[] {
  const pages = text.replace(/\r/g, '').split('\f');
  // 2022-preseason format detection: uses "Shades Of", not "PROS AND CONS".
  if (/Shades Of/i.test(text) && !/PROS AND CONS/.test(text)) {
    return pages.map((p) => parsePff2022Page(year, p)).filter((r): r is PffReport => r !== null);
  }
  const out: PffReport[] = [];
  for (const page of pages) {
    if (!/PROS AND CONS/.test(page)) continue;
    const { left, right } = splitColumns(page);
    // Name: the first ALL-CAPS name-like left line that isn't the position
    // header row or a section label.
    const name =
      left.find(
        (l) =>
          /^[A-Z][A-Z'’.\- ]{3,}$/.test(l) &&
          !POS_HEADER.test(l) &&
          !/PROS AND CONS|NFL DRAFT|STAT|GRADE/i.test(l),
      ) ?? null;
    // Eval points: left-column lines after the name, minus chart/label noise.
    const evalRaw = left.filter(
      (l) => l !== name && !POS_HEADER.test(l) && !CHART_NOISE.test(l) && !/NFL DRAFT|PROJECTION/i.test(l),
    );
    const evalPoints = reflow(evalRaw)
      .map(cleanChartBleed)
      .filter((p) => p.length > 8 && /[a-z]/.test(p));
    // Analysis: right-column prose, reflowed.
    const analysisRaw = right.filter((l) => !CHART_NOISE.test(l) && !/NFL DRAFT|PROJECTION/i.test(l));
    const analysis = reflow(analysisRaw).filter((p) => p.length > 20).join(' ').replace(/\s+/g, ' ').trim() || null;
    const { projectionRaw, round } = parseProjection(page);
    out.push({ source: 'PFF', year, name, projectionRaw, round, evalPoints, analysis });
  }
  return out;
}

async function main(): Promise<void> {
  const argYears = process.argv.slice(2).map(Number).filter((n) => !Number.isNaN(n));
  const years = argYears.length ? argYears : [2021, 2022];
  await mkdir(OUT_DIR, { recursive: true });
  /* eslint-disable no-console */
  const all: PffReport[] = [];
  for (const year of years) {
    let text: string;
    try {
      text = await readFile(resolve(RAW_DIR, `${year}.txt`), 'utf8');
    } catch {
      console.warn(`  ! no raw text for ${year}`);
      continue;
    }
    const recs = parsePffYear(year, text);
    const named = recs.filter((r) => r.name);
    const graded = recs.filter((r) => r.round !== null);
    await writeFile(resolve(OUT_DIR, `pff-${year}.json`), JSON.stringify(recs, null, 0));
    console.log(
      `${year}: ${recs.length} reports · ${named.length} named · ${graded.length} projected · ` +
        `med eval-points ${median(recs.map((r) => r.evalPoints.length))} · ${recs.filter((r) => r.analysis).length} with analysis`,
    );
    all.push(...recs);
  }
  await writeFile(resolve(OUT_DIR, 'pff-all.json'), JSON.stringify(all, null, 0));
  console.log(`\nTOTAL: ${all.length} PFF reports → data/pff/pff-all.json`);
  /* eslint-enable no-console */
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

if (process.argv[1]?.endsWith('pff.js')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
