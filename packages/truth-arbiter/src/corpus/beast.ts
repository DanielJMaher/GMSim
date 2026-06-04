import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DATA_DIR } from '../lib/config.js';

/**
 * The Beast — Dane Brugler's NFL Draft Guide, parsed (2026-06-03).
 *
 * Brugler's "The Beast" (The Athletic) is the gold-standard public draft guide:
 * ~400 prospects/year, each with a round/overall GRADE, full combine
 * measurables, bulleted STRENGTHS + WEAKNESSES, a SUMMARY with a pro comp, and
 * a BACKGROUND bio. Daniel supplied 7 years of the PDF (2019-2026); they're
 * decrypted + `pdftotext -layout` extracted into `data/beast/raw/<year>.txt`
 * (gitignored — Brugler/The Athletic's copyrighted work, kept LOCAL as a
 * calibration reference, never redistributed or surfaced verbatim in-game).
 *
 * This parser turns the raw text into structured `BeastProspect` records that
 * feed two agents:
 *   - The Scribe (voice): the STRENGTHS/WEAKNESSES/SUMMARY prose — the real
 *     scouting language GMSim's generated reports are measured against.
 *   - The draft-class-realism agents (class-talent, ras, skill-adjudicator):
 *     the GRADE distribution, measurables, position mix, and pro-comp shape —
 *     one expert, internally-consistent multi-year reference.
 *
 * Format note: 2019-2025 share a `BACKGROUND:/STRENGTHS:/WEAKNESSES:/SUMMARY:/
 * GRADE:` section layout; 2026 switched to columnar header tables (handled
 * separately, TODO). This first cut targets 2019-2025.
 *
 *   pnpm --filter @gmsim/truth-arbiter run beast [year ...]
 */

const RAW_DIR = resolve(DATA_DIR, 'beast', 'raw');
const OUT_DIR = resolve(DATA_DIR, 'beast');

/** Position prefixes that open a prospect block (e.g. "QB1", "EDGE12"). */
const POSITIONS = [
  'QB', 'RB', 'FB', 'WR', 'TE', 'OT', 'OG', 'IOL', 'OL', 'G', 'C',
  'EDGE', 'DL', 'DT', 'NT', 'DE', 'LB', 'ILB', 'OLB', 'CB', 'S', 'DB',
  'K', 'P', 'LS', 'ATH', 'FS', 'SS',
] as const;
// Longest-first so "EDGE" matches before "DE", "ILB" before "LB", etc.
const POS_ALT = [...POSITIONS].sort((a, b) => b.length - a.length).join('|');
/** A block header: `<POS><rank> <Name>` at line start, e.g. "QB1 Cam Ward". */
const HEADER_RE = new RegExp(`^(${POS_ALT})(\\d{1,3})\\s+(\\S.*?)\\s*$`);

export interface BeastProspect {
  year: number;
  position: string;
  /** Rank within position (the N in "QB1"). */
  positionRank: number;
  name: string;
  school: string | null;
  /** Class string as printed (e.g. "5SR", "4JR", "rSO"). */
  classYear: string | null;
  // ── Bio (feeds The Narrator) ──────────────────────────────────────────────
  hometown: string | null;
  highSchool: string | null;
  /** Birthday as printed (e.g. "May 25, 2002"). */
  birthday: string | null;
  /** Age on draft day (e.g. 22.92). */
  age: number | null;
  /** Beast height code (e.g. "6015" = 6'1⅝") and the inches it decodes to. */
  heightCode: string | null;
  heightInches: number | null;
  weight: number | null;
  jersey: number | null;
  // ── Grade (feeds draft-class realism) ─────────────────────────────────────
  /** Round/overall grade, raw (e.g. "1st round (No. 13 overall)", "5th-6th round", "FA"). */
  gradeRaw: string | null;
  /** Best (lowest) projected round; FA/PFA → 8 (undrafted tier). */
  round: number | null;
  /** Worse round of a range ("5th-6th" → 6); equals `round` for a single grade. */
  roundHigh: number | null;
  /** Overall-pick projection from "(No. X overall)", or null. */
  overallPick: number | null;
  // ── Scouting (feeds The Scribe) ───────────────────────────────────────────
  strengths: string[];
  weaknesses: string[];
  summary: string | null;
  /** Pro comparison pulled from the summary ("in the mold of X"), if any. */
  proComp: string | null;
  background: string | null;
  // ── Measurables (feeds RAS / realism) ─────────────────────────────────────
  /** Best-effort 40-yard time, or null/DNP. */
  forty: number | null;
  /** Raw COMBINE / PRO DAY measurable rows (columnar, fraction-laden — kept raw
   *  for later deeper parsing). */
  combineRaw: string | null;
  proDayRaw: string | null;
  /** Raw college-stats block (position-specific table — kept raw). */
  collegeStatsRaw: string | null;
  /** Full raw block text — lossless, so nothing the structured fields miss is gone. */
  rawBody: string;
  /** Has bulleted strengths/weaknesses (a full report) vs a thin capsule. */
  full: boolean;
}

/** Canonicalize position codes that vary across years (G→OG, DE→EDGE, FS/SS→S…). */
const POS_CANON: Record<string, string> = {
  G: 'OG', IOL: 'OG', OL: 'OG', DE: 'EDGE', DL: 'EDGE', FS: 'S', SS: 'S', DB: 'CB', NT: 'DT',
};
function normalizePosition(p: string): string {
  return POS_CANON[p] ?? p;
}

function cleanLines(s: string): string[] {
  return s
    .split('\n')
    .map((l) => l.replace(/\s+$/g, ''))
    .filter((l) => l.trim().length > 0 && !/^THE BEAST \| BACK TO TABLE/i.test(l));
}

/** Split a STRENGTHS:/WEAKNESSES: section into individual points. Two formats:
 *  - Era A (2019-2024): one flowing paragraph with " ... " between points.
 *  - Era B (2025): one bullet per source line (continuations indented). */
function parseBullets(block: string): string[] {
  const joined = cleanLines(block).join(' ').replace(/\s+/g, ' ').trim();
  // Era A: ellipsis-delimited. Require ≥2 to avoid a stray "..." in prose.
  if ((joined.match(/\.\.\./g) || []).length >= 2) {
    return joined
      .split(/\s*\.\.\.\s*/)
      .map((s) => s.replace(/^[-–\s]+|[-–\s]+$/g, '').trim())
      .filter((s) => s.length > 2);
  }
  // Era B: line-based; folded continuations are heavily indented.
  const out: string[] = [];
  for (const raw of cleanLines(block)) {
    const line = raw.trim();
    const indented = /^\s{6,}/.test(raw);
    if (indented && out.length > 0) out[out.length - 1] += ' ' + line;
    else out.push(line);
  }
  return out.map((b) => b.replace(/\s+/g, ' ').trim()).filter((b) => b.length > 2);
}

/** Strip a wrapped next-prospect header that sometimes bleeds onto the GRADE
 *  line (e.g. "FA        Georgia Tech, 5SR" → "FA"). */
function cleanGradeRaw(raw: string): string {
  return raw.replace(/\s{4,}\S.*$/, '').replace(/\s+/g, ' ').trim();
}

function parseGrade(raw: string | null): { round: number | null; roundHigh: number | null; overallPick: number | null } {
  if (!raw) return { round: null, roundHigh: null, overallPick: null };
  let round: number | null = null;
  let roundHigh: number | null = null;
  // Range first: "5th-6th round" / "1st-2nd round".
  const range = raw.match(/(\d+)(?:st|nd|rd|th)\s*[-–]\s*(\d+)(?:st|nd|rd|th)\s+round/i);
  if (range) {
    round = Number(range[1]);
    roundHigh = Number(range[2]);
  } else {
    const ord = raw.match(/(\d+)(?:st|nd|rd|th)\s+round/i);
    if (ord) {
      round = Number(ord[1]);
      roundHigh = round;
    } else if (/\b(FA|PFA|UDFA|free\s+agent|priority\s+free\s+agent)\b/i.test(raw)) {
      round = 8; // undrafted tier (post-7th)
      roundHigh = 8;
    }
  }
  const ovr = raw.match(/No\.\s*(\d+)\s*overall/i);
  return { round, roundHigh, overallPick: ovr ? Number(ovr[1]) : null };
}

/** Decode a Beast height code "6015" → inches (6'1⅝" = 73.625). */
function decodeHeight(code: string): number | null {
  if (!/^\d{4}$/.test(code)) return null;
  const feet = Number(code[0]);
  const inches = Number(code.slice(1, 3));
  const eighths = Number(code[3]);
  if (inches > 11 || eighths > 7) return null;
  return Math.round((feet * 12 + inches + eighths / 8) * 100) / 100;
}

/** Bio fields from the header table region (before BACKGROUND). */
function parseBio(body: string): Pick<
  BeastProspect,
  'hometown' | 'highSchool' | 'birthday' | 'age' | 'heightCode' | 'heightInches' | 'weight' | 'jersey'
> {
  const head = body.split(/\nBACKGROUND:/i)[0] ?? body.slice(0, 600);
  // The age/height/weight triple sits on its own line: "22.92 6015 219".
  const ahw = head.match(/(\d{2}\.\d{2})\s+(\d{4})\s+(\d{2,3})\b/);
  const age = ahw ? Number(ahw[1]) : null;
  const heightCode = ahw ? ahw[2]! : null;
  const weight = ahw ? Number(ahw[3]) : null;
  const birthday = head.match(/\b([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})\b/)?.[1] ?? null;
  const jersey = head.match(/#(\d{1,2})\b/) ? Number(head.match(/#(\d{1,2})\b/)![1]) : null;
  // Hometown = "City, ST" on the first value line (after the labels row).
  const hometown = head.match(/\n\s*([A-Z][A-Za-z.'\- ]+,\s*[A-Z]{2})\b/)?.[1]?.trim() ?? null;
  return {
    hometown,
    highSchool: null, // HS column placement varies too much for a clean grab; left for later
    birthday,
    age,
    heightCode,
    heightInches: heightCode ? decodeHeight(heightCode) : null,
    weight,
    jersey,
  };
}

/** A measurable row ("COMBINE …" / "PRO DAY …") + best-effort 40 time. */
function parseMeasurables(body: string): { forty: number | null; combineRaw: string | null; proDayRaw: string | null } {
  const combineRaw = body.match(/\nCOMBINE\s+([^\n]+)/i)?.[1]?.replace(/\s+/g, ' ').trim() ?? null;
  const proDayRaw = body.match(/\nPRO DAY\s+([^\n]+)/i)?.[1]?.replace(/\s+/g, ' ').trim() ?? null;
  // 40 time: first plausible 4.xx / 5.xx in the combine row (after HT/WT/HAND/ARM/WING).
  let forty: number | null = null;
  for (const row of [combineRaw, proDayRaw]) {
    if (!row) continue;
    const m = row.match(/\b([45]\.\d{2})\b/);
    if (m) { forty = Number(m[1]); break; }
  }
  return { forty, combineRaw, proDayRaw };
}

const PRO_COMP_RE = new RegExp(
  '(?:' +
    'in the (?:[a-z]+ )?mold of|' +
    'compares (?:favorably )?to|' +
    'reminiscent of|' +
    'resembles(?: a)?|' +
    'shades of|' +
    'in the same vein as|' +
    'cut from the same cloth as|' +
    'draws? comparisons? to|' +
    '(?:calls|brings) to mind|' +
    'evokes|' +
    "a (?:poor|rich|cleaner|taller|shorter|bigger|smaller|faster|slower|younger|stronger|leaner|budget|junior|discount)(?:[^.]{0,30}?)?(?:man's |version of )|" +
    'similar (?:player |prospect )?to' +
  ')\\s+([A-Z][a-zA-Z.\'-]+(?:\\s+[A-Z][a-zA-Z.\'-]+){1,2})',
);
/** Capitalized phrases that are NOT player names (avoid false comps). */
const NON_NAMES = /^(NFL|Pro Bowl|All[- ]Pro|Day \d|Round|First|Second|Third|Pro Day|Senior Bowl|East|West|North|South|Hall|The|His|He|A|An)\b/;

function extractProComp(summary: string | null): string | null {
  if (!summary) return null;
  const m = summary.match(PRO_COMP_RE);
  if (!m) return null;
  const cand = m[1]!.replace(/[.,;:]$/, '').trim();
  if (NON_NAMES.test(cand)) return null;
  // Need at least a First + Last (two capitalized tokens).
  return cand.split(/\s+/).length >= 2 ? cand : null;
}

// ── Era A (2019-2024): rank-dot, ALL-CAPS, pipe-delimited header with inline bio ──
// e.g. "1. CALEB WILLIAMS | USC  6011 | 214 lbs. | 3JR Washington, D.C. (Gonzaga) 11/18/2001 (age 22.44) #13"
// Position is NOT in the header — it's tracked from the position-group divider.

const GROUP_TO_POS: Array<[RegExp, string]> = [
  [/^QUARTERBACKS?$/i, 'QB'], [/^RUNNING ?BACKS?$/i, 'RB'], [/^FULLBACKS?$/i, 'FB'],
  [/^WIDE ?RECEIVERS?$/i, 'WR'], [/^TIGHT ?ENDS?$/i, 'TE'],
  [/^OFFENSIVE ?TACKLES?$/i, 'OT'], [/^GUARDS?$/i, 'OG'], [/^CENTERS?$/i, 'C'],
  [/^EDGE ?RUSHERS?$/i, 'EDGE'], [/^DEFENSIVE ?TACKLES?$/i, 'DT'], [/^NOSE ?TACKLES?$/i, 'NT'],
  [/^(OFF[- ]?BALL )?LINEBACKERS?$/i, 'LB'], [/^CORNERBACKS?$/i, 'CB'], [/^SAFET(IES|Y)$/i, 'S'],
  [/^KICKERS?$/i, 'K'], [/^PUNTERS?$/i, 'P'], [/^LONG ?SNAPPERS?$/i, 'LS'], [/^ATHLETES?$/i, 'ATH'],
];

const ERA_A_HEADER = /^(\d{1,3})\.\s+([A-Z][A-Z .'’A-Za-z-]+?)\s*\|\s*(.+?)\s+(\d{4})\s*\|\s*(\d+)\s*lbs\.\s*\|\s*([0-9r]*[A-Z]{2,3})\.?\s*(.*)$/;

function titleCase(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => {
      if (/^(I{1,3}|IV|V|JR|SR)\.?$/i.test(w)) return w.toUpperCase().replace('.', '') + (w.endsWith('.') ? '.' : '');
      if (w.length <= 2 && w.includes('.')) return w.toUpperCase(); // initials A.J.
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

interface NormBlock {
  position: string;
  positionRank: number;
  name: string;
  school: string | null;
  classYear: string | null;
  headerBio: Partial<BeastProspect>;
  body: string;
}

function parseEraAHeader(line: string, position: string): NormBlock | null {
  const m = line.match(ERA_A_HEADER);
  if (!m) return null;
  const rest = m[7] ?? '';
  const hsMatch = rest.match(/\(([^)]+)\)/); // first parens = HS (before "(age …)")
  const highSchool = hsMatch && !/^age\b/i.test(hsMatch[1] ?? '') ? hsMatch[1]!.trim() : null;
  const birthday = rest.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/)?.[1] ?? null;
  const age = rest.match(/age\s+([\d.]+)/i) ? Number(rest.match(/age\s+([\d.]+)/i)![1]) : null;
  const jersey = rest.match(/#(\d{1,2})\b/) ? Number(rest.match(/#(\d{1,2})\b/)![1]) : null;
  const hometown = hsMatch ? rest.slice(0, hsMatch.index).trim().replace(/[,;]\s*$/, '') || null : null;
  const heightCode = m[4]!;
  return {
    position,
    positionRank: Number(m[1]),
    name: titleCase(m[2]!),
    school: (m[3] ?? '').trim() || null,
    classYear: m[6] ?? null,
    headerBio: {
      hometown, highSchool, birthday, age,
      heightCode, heightInches: decodeHeight(heightCode), weight: Number(m[5]),
      jersey,
    },
    body: '',
  };
}

function splitBlocksEraA(text: string): NormBlock[] {
  const lines = text.split('\n');
  const blocks: NormBlock[] = [];
  let pos = 'ATH';
  let cur: NormBlock | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    for (const [re, p] of GROUP_TO_POS) {
      if (re.test(trimmed)) { pos = p; break; }
    }
    const hdr = parseEraAHeader(line, pos);
    // A real entry header is followed by a BACKGROUND/bio body — ranking-table
    // rows ("18. NAME  School  PFA …") lack the pipe layout so won't match ERA_A_HEADER.
    if (hdr) {
      if (cur) blocks.push(cur);
      cur = hdr;
    } else if (cur) {
      cur.body += line + '\n';
    }
  }
  if (cur) blocks.push(cur);
  return blocks;
}

/** Split a year's text into prospect blocks keyed by the header line. */
function splitBlocks(text: string): { header: RegExpMatchArray; body: string }[] {
  const lines = text.split('\n');
  const blocks: { header: RegExpMatchArray; body: string }[] = [];
  let cur: { header: RegExpMatchArray; bodyLines: string[] } | null = null;
  for (const line of lines) {
    const h = line.match(HEADER_RE);
    // A header must be followed (within the block) by report content; guard
    // against table rows by requiring the name look like a name (letters/space).
    if (h && /^[A-Z][A-Za-z.'‘’-]+(?:\s+[A-Z][A-Za-z.'‘’-]+)+/.test(h[3] ?? '')) {
      if (cur) blocks.push({ header: cur.header, body: cur.bodyLines.join('\n') });
      cur = { header: h, bodyLines: [] };
    } else if (cur) {
      cur.bodyLines.push(line);
    }
  }
  if (cur) blocks.push({ header: cur.header, body: cur.bodyLines.join('\n') });
  return blocks;
}

/** Grab the text of a labelled section (LABEL: … up to the next known label). */
function section(body: string, label: string, stops: string[]): string | null {
  const re = new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n\\s*(?:${stops.join('|')}):|$)`, 'i');
  const m = body.match(re);
  return m ? m[1]!.trim() : null;
}

const SECTION_LABELS = ['BACKGROUND', 'STRENGTHS', 'WEAKNESSES', 'SUMMARY', 'GRADE'];

function parseHeaderMeta(headerName: string): { name: string; school: string | null; classYear: string | null } {
  // "Cam Ward                      Miami, 5SR"  → name / school / class
  const m = headerName.match(/^(.*?)\s{2,}(.*?),\s*([A-Za-z0-9]+)\s*$/);
  if (m) return { name: m[1]!.trim(), school: m[2]!.trim(), classYear: m[3]!.trim() };
  // Fallback: name only (school/class on a wrapped line we didn't capture).
  return { name: headerName.replace(/\s{2,}.*$/, '').trim(), school: null, classYear: null };
}

// ── Era C (2026): "QB1 Name School" header + an "OVR. RANK" grade/bio table +
//    no-colon section labels (BACKGROUND / STRENGTHS / WEAKNESSES / SUMMARY). ──
const ERA_C_LABELS = ['BACKGROUND', 'STATISTICS AND MEASUREMENTS', 'STRENGTHS', 'WEAKNESSES', 'SUMMARY'];

/** A no-colon labelled section: LABEL on its own line up to the next label. */
function sectionNoColon(body: string, label: string, stops: string[]): string | null {
  const re = new RegExp(`(?:^|\\n)${label}\\s*\\n([\\s\\S]*?)(?=\\n(?:${stops.join('|')})\\s*\\n|$)`, 'i');
  const m = body.match(re);
  return m ? m[1]!.trim() : null;
}

/** Pull the grade + bio out of the "GRADE  OVR. RANK …" table region. */
function parseEraCTable(body: string): { gradeRaw: string | null; headerBio: Partial<BeastProspect>; classYear: string | null } {
  // Anchor on the OVR.RANK header; the grade/bio values follow it (above BACKGROUND).
  const ovrIdx = body.search(/OVR\.\s*RANK/i);
  const afterOvr = ovrIdx >= 0 ? body.slice(ovrIdx) : body;
  const region = (afterOvr.split(/\nBACKGROUND\s*\n/i)[0] ?? afterOvr).slice(0, 600);
  // Grade: "1st round", "2nd-3rd round", "PFA"/"FA" — ranges included.
  const grow = region.match(/(\d(?:st|nd|rd|th)(?:\s*[-–]\s*\d(?:st|nd|rd|th))?\s+round|PFA|priority free agent|free agent|\bFA\b)/i);
  const gradeRaw = grow ? grow[1]!.replace(/\s+/g, ' ').trim() : null;
  const classYear = region.match(/\b(\d?[A-Za-z]?(?:FR|SO|JR|SR))\b/)?.[1] ?? null;
  const birthday = region.match(/\b([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})\b/)?.[1] ?? null;
  const age = region.match(/\b(\d{2}\.\d{2})\b/) ? Number(region.match(/\b(\d{2}\.\d{2})\b/)![1]) : null;
  // HT "6'5"" and WT "236 lbs." and jersey "No. 15" sit on the following line.
  const htM = region.match(/(\d)'(\d{1,2})"/);
  const heightInches = htM ? Number(htM[1]) * 12 + Number(htM[2]) : null;
  const weight = region.match(/(\d{2,3})\s*lbs\./) ? Number(region.match(/(\d{2,3})\s*lbs\./)![1]) : null;
  const jersey = region.match(/No\.\s*(\d{1,2})\b/) ? Number(region.match(/No\.\s*(\d{1,2})\b/)![1]) : null;
  return {
    gradeRaw,
    classYear,
    headerBio: { birthday, age, heightInches, heightCode: null, weight, jersey, hometown: null, highSchool: null },
  };
}

/** Heuristic name/school split for "Fernando Mendoza Indiana" (school = trailing
 *  capitalized tokens; assume a 2-word name unless tokens suggest otherwise). */
function splitNameSchool(s: string): { name: string; school: string | null } {
  const toks = s.trim().split(/\s+/);
  if (toks.length <= 2) return { name: s.trim(), school: null };
  // First two tokens are the name (covers the vast majority); rest = school.
  // Suffixes (Jr./II/III/IV) extend the name.
  let nameLen = 2;
  if (toks[2] && /^(Jr\.?|Sr\.?|II|III|IV|V)$/i.test(toks[2])) nameLen = 3;
  return { name: toks.slice(0, nameLen).join(' '), school: toks.slice(nameLen).join(' ') || null };
}

function splitBlocksEraC(text: string): NormBlock[] {
  const lines = text.split('\n');
  const blocks: NormBlock[] = [];
  let cur: { header: RegExpMatchArray; bodyLines: string[] } | null = null;
  for (const line of lines) {
    const h = line.match(HEADER_RE);
    if (h && /^[A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’&-]+)+/.test(h[3] ?? '')) {
      if (cur) blocks.push(toEraCBlock(cur));
      cur = { header: h, bodyLines: [] };
    } else if (cur) {
      cur.bodyLines.push(line);
    }
  }
  if (cur) blocks.push(toEraCBlock(cur));
  return blocks;
}

function toEraCBlock(cur: { header: RegExpMatchArray; bodyLines: string[] }): NormBlock {
  const body = cur.bodyLines.join('\n');
  const { name, school } = splitNameSchool(cur.header[3] ?? '');
  const tbl = parseEraCTable(body);
  return {
    position: cur.header[1]!,
    positionRank: Number(cur.header[2]),
    name,
    school,
    classYear: tbl.classYear,
    headerBio: { ...tbl.headerBio, gradeRaw: tbl.gradeRaw } as Partial<BeastProspect>,
    body,
  };
}

/** Normalize all three eras to NormBlock so section parsing is mostly shared. */
function blocksForYear(text: string): { blocks: NormBlock[]; era: 'A' | 'B' | 'C' } {
  // Era C signature: the "OVR. RANK" grade tables.
  if (/OVR\.\s*RANK/i.test(text)) {
    return { blocks: splitBlocksEraC(text), era: 'C' };
  }
  const eraA = splitBlocksEraA(text);
  const eraB = splitBlocks(text).map(({ header, body }) => {
    const meta = parseHeaderMeta(header[3] ?? '');
    return {
      position: header[1]!,
      positionRank: Number(header[2]),
      name: meta.name,
      school: meta.school,
      classYear: meta.classYear,
      headerBio: parseBio(body),
      body,
    } as NormBlock;
  });
  return eraB.length > eraA.length ? { blocks: eraB, era: 'B' } : { blocks: eraA, era: 'A' };
}

export function parseBeastYear(year: number, text: string): BeastProspect[] {
  const out: BeastProspect[] = [];
  const { blocks, era } = blocksForYear(text.replace(/\r/g, ''));
  for (const blk of blocks) {
    const body = blk.body;
    const sec = (label: string) =>
      era === 'C' ? sectionNoColon(body, label, ERA_C_LABELS) : section(body, label, SECTION_LABELS);
    const strengthsTxt = sec('STRENGTHS');
    const weaknessesTxt = sec('WEAKNESSES');
    const summary = sec('SUMMARY')?.replace(/\s+/g, ' ').trim() ?? null;
    const background = sec('BACKGROUND')?.replace(/\s+/g, ' ').trim() ?? null;
    // Era C carries the grade in the OVR.RANK table (already parsed into headerBio);
    // A/B carry a "GRADE:" section.
    const gradeRaw =
      era === 'C'
        ? ((blk.headerBio as { gradeRaw?: string | null }).gradeRaw ?? null)
        : (section(body, 'GRADE', SECTION_LABELS) ? cleanGradeRaw(section(body, 'GRADE', SECTION_LABELS)!) : null);
    const { round, roundHigh, overallPick } = parseGrade(gradeRaw);
    const meas = parseMeasurables(body);
    // College stats: between BACKGROUND and the first of COMBINE/PRO DAY/STRENGTHS.
    const statsM = body.match(/\nBACKGROUND:[\s\S]*?\n([\s\S]*?)(?=\nCOMBINE|\nPRO DAY|\nSTRENGTHS|$)/i);
    const collegeStatsRaw = statsM
      ? statsM[1]!.replace(/THE BEAST \| BACK TO TABLE[^\n]*/gi, '').replace(/\n{2,}/g, '\n').trim() || null
      : null;
    const strengths = strengthsTxt ? parseBullets(strengthsTxt) : [];
    const weaknesses = weaknessesTxt ? parseBullets(weaknessesTxt) : [];
    out.push({
      year,
      position: normalizePosition(blk.position),
      positionRank: blk.positionRank,
      name: blk.name,
      school: blk.school,
      classYear: blk.classYear,
      hometown: null, highSchool: null, birthday: null, age: null,
      heightCode: null, heightInches: null, weight: null, jersey: null,
      ...blk.headerBio,
      gradeRaw,
      round,
      roundHigh,
      overallPick,
      strengths,
      weaknesses,
      summary,
      proComp: extractProComp(summary),
      background,
      ...meas,
      collegeStatsRaw,
      rawBody: body.replace(/THE BEAST \| BACK TO TABLE[^\n]*/gi, '').trim(),
      full: strengths.length > 0 || weaknesses.length > 0,
    });
  }
  return out;
}

async function main(): Promise<void> {
  const argYears = process.argv.slice(2).map(Number).filter((n) => !Number.isNaN(n));
  const files = (await readdir(RAW_DIR)).filter((f) => /^\d{4}\.txt$/.test(f));
  const years = argYears.length ? argYears : files.map((f) => Number(f.slice(0, 4))).sort();

  /* eslint-disable no-console */
  const all: BeastProspect[] = [];
  for (const year of years) {
    let text: string;
    try {
      text = await readFile(resolve(RAW_DIR, `${year}.txt`), 'utf8');
    } catch {
      console.warn(`  ! no raw text for ${year} (run the pdftotext extract first)`);
      continue;
    }
    const recs = parseBeastYear(year, text);
    const full = recs.filter((r) => r.full);
    const graded = recs.filter((r) => r.round !== null);
    const fa = recs.filter((r) => r.round === 8);
    const withComp = recs.filter((r) => r.proComp);
    const withAge = recs.filter((r) => r.age !== null);
    const withForty = recs.filter((r) => r.forty !== null);
    await writeFile(resolve(OUT_DIR, `beast-${year}.json`), JSON.stringify(recs, null, 0));
    console.log(
      `${year}: ${recs.length} prospects · ${graded.length} graded (${fa.length} FA) · ${full.length} full reports · ` +
        `${withAge.length} age/ht/wt · ${withForty.length} 40-times · ${withComp.length} pro-comps · ` +
        `med S/W ${median(full.map((r) => r.strengths.length))}/${median(full.map((r) => r.weaknesses.length))}`,
    );
    all.push(...recs);
  }
  await writeFile(resolve(OUT_DIR, 'beast-all.json'), JSON.stringify(all, null, 0));
  console.log(`\nTOTAL: ${all.length} prospects across ${years.length} years → data/beast/beast-all.json`);
  /* eslint-enable no-console */
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()!);
if (isMain || process.argv[1]?.endsWith('beast.js')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
