import { parse, type HTMLElement } from 'node-html-parser';
import type { DraftPickRecord, Measurables, NgsScores } from './types.js';

/**
 * Parse one NFL draft tracker round page into structured pick records.
 *
 * The page is server-rendered. Each pick is a card whose source order is:
 *   <p class="display-5 …">PLAYER NAME</p>
 *   <span …>POS</span> … <span …>COLLEGE</span>
 *   <dl> Height/Weight/Arm/Hand/Wing as <dt>/<dd> pairs </dl>
 *   Production / Athleticism / Overall Score as <p>label</p><p>value</p>
 *   <h3>PROSPECT ANALYSIS</h3><div>…write-up…</div>  BY <analyst>
 *   <a href="/prospects/{slug}/{guid}">
 *
 * We split the document at each pick-ROW marker so every card's fields —
 * including the pick number + team that precede the name — are self-
 * contained, then parse each chunk. Anchoring on label TEXT (not the
 * volatile Tailwind class names) keeps this resilient across years.
 */

const ROW_MARKER = '<div class="py-2 flex items-center row-border';

export function parseRoundPage(html: string, year: number, round: number): DraftPickRecord[] {
  const chunks = splitIntoCards(html);
  const picks: DraftPickRecord[] = [];
  chunks.forEach((chunk, i) => {
    const rec = parseCard(chunk, year, round, i + 1);
    if (rec) picks.push(rec);
  });
  return picks;
}

/** Slice the page into one HTML string per pick row, by the row marker. */
function splitIntoCards(html: string): string[] {
  const idxs: number[] = [];
  let from = 0;
  for (;;) {
    const at = html.indexOf(ROW_MARKER, from);
    if (at === -1) break;
    idxs.push(at);
    from = at + ROW_MARKER.length;
  }
  return idxs.map((start, i) => html.slice(start, idxs[i + 1] ?? html.length));
}

function parseCard(
  chunkHtml: string,
  year: number,
  round: number,
  pickInRound: number,
): DraftPickRecord | null {
  const root = parse(chunkHtml);

  // Two display-5 nodes per row: the (round-relative) pick number
  // (text-center) and the player name (text-black). Take the name.
  const display5 = root.querySelectorAll('p.display-5');
  const nameNode = display5.find((p) => p.classNames.includes('text-black'));
  const playerName = text(nameNode);
  if (!playerName) return null;

  // Position + college: the two info spans right under the name.
  const infoSpans = root
    .querySelectorAll('span')
    .filter((s) => s.classNames.includes('misc-1-stats') && s.text.trim().length > 0);
  const position = infoSpans[0] ? clean(infoSpans[0].text) : null;
  const college = infoSpans[1] ? clean(infoSpans[1].text) : null;

  const measurables = parseMeasurables(root);
  const scores = parseScores(root);
  const { analysis, analyst } = parseAnalysis(root);
  const link = root.querySelector('a[href^="/prospects/"]')?.getAttribute('href') ?? null;
  const { slug, id } = parseProspectLink(link);

  return {
    year,
    round,
    pickInRound,
    overallPick: null, // filled cumulatively by the scraper across rounds
    team: parseTeam(root),
    playerName: clean(playerName),
    position,
    college,
    measurables,
    scores,
    analysis,
    analyst,
    prospectSlug: slug,
    prospectId: id,
    prospectUrl: link ? `https://www.nfl.com${link}` : null,
  };
}

function parseMeasurables(root: HTMLElement): Measurables {
  const map = new Map<string, string>();
  for (const dt of root.querySelectorAll('dt')) {
    const label = clean(dt.text);
    const dd = dt.nextElementSibling;
    if (dd && dd.tagName === 'DD') map.set(label, clean(dd.text));
  }
  return {
    heightInches: parseHeight(map.get('Height')),
    weightLbs: parseWeight(map.get('Weight')),
    armInches: parseInches(map.get('Arm')),
    handInches: parseInches(map.get('Hand')),
    wingInches: parseInches(map.get('Wing')),
  };
}

function parseScores(root: HTMLElement): NgsScores {
  const byLabel = (label: string): number | null => {
    for (const p of root.querySelectorAll('p')) {
      if (clean(p.text) === label) {
        const v = p.nextElementSibling;
        if (v && v.tagName === 'P') return num(v.text);
      }
    }
    return null;
  };
  return {
    production: byLabel('Production'),
    athleticism: byLabel('Athleticism'),
    overall: byLabel('Overall Score'),
  };
}

function parseAnalysis(root: HTMLElement): { analysis: string | null; analyst: string | null } {
  let analysis: string | null = null;
  for (const h of root.querySelectorAll('h3')) {
    if (clean(h.text).toUpperCase() === 'PROSPECT ANALYSIS') {
      const body = h.nextElementSibling;
      if (body) analysis = clean(body.text);
      break;
    }
  }
  let analyst: string | null = null;
  for (const p of root.querySelectorAll('p')) {
    const t = clean(p.text);
    if (t.startsWith('BY ')) {
      analyst = t.slice(3).trim();
      break;
    }
  }
  return { analysis: analysis || null, analyst };
}

/** The drafting team — its abbreviation is in the club logo URL
 * (…/clubs/logos/HOU). The first such logo in the row is the picker. */
function parseTeam(root: HTMLElement): string | null {
  for (const img of root.querySelectorAll('img')) {
    const src = img.getAttribute('src') ?? '';
    const m = src.match(/\/clubs\/logos\/([A-Z]{2,3})\b/);
    if (m) return m[1] ?? null;
  }
  return null;
}

function parseProspectLink(href: string | null): { slug: string | null; id: string | null } {
  if (!href) return { slug: null, id: null };
  const m = href.match(/^\/prospects\/([^/]+)\/([^/?#]+)/);
  return m ? { slug: m[1] ?? null, id: m[2] ?? null } : { slug: null, id: null };
}

// ── value parsers ──────────────────────────────────────────────────────

function text(el: HTMLElement | null | undefined): string | null {
  return el ? el.text : null;
}

function clean(s: string): string {
  return s
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function num(s: string | undefined): number | null {
  if (!s) return null;
  const m = clean(s).match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** "6'5 1/4\"" → 77.25 inches. */
function parseHeight(s: string | undefined): number | null {
  if (!s) return null;
  const t = clean(s);
  const m = t.match(/(\d+)\s*'\s*(\d+)?(?:\s+(\d+)\/(\d+))?/);
  if (!m) return null;
  const feet = Number(m[1]);
  const inches = m[2] ? Number(m[2]) : 0;
  const frac = m[3] && m[4] ? Number(m[3]) / Number(m[4]) : 0;
  return feet * 12 + inches + frac;
}

/** "266 lbs" → 266. */
function parseWeight(s: string | undefined): number | null {
  return num(s);
}

/** "34 1/2\"" → 34.5, "10\"" → 10. */
function parseInches(s: string | undefined): number | null {
  if (!s) return null;
  const t = clean(s);
  const m = t.match(/(\d+)(?:\s+(\d+)\/(\d+))?/);
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = m[2] && m[3] ? Number(m[2]) / Number(m[3]) : 0;
  return whole + frac;
}
