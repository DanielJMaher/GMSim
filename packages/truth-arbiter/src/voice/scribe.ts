import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DATA_DIR } from '../lib/config.js';
import type { BeastProspect } from '../corpus/beast.js';
import type { PffReport } from '../corpus/pff.js';
import {
  countTerms,
  logOdds,
  typeTokenRatio,
  tokenize,
  mean,
  median,
  type LogOddsTerm,
} from './lexicon.js';

/**
 * The Scribe — scouting/media VOICE authority (2026-06-04, Daniel-directed).
 *
 * The first of the Phase-C voice agents. Where the draft-model agents police
 * the NUMBERS (grades, measurables) and the Ombudsman polices media SPREAD,
 * the Scribe polices how scouts/outlets actually WORD a report — the vocabulary
 * and phrasing GMSim's media should echo. It reads the multi-source voice
 * corpus (Beast + PFF) and emits an empirical voice profile:
 *
 *   1. Voice fingerprints — Beast vs PFF (length, bullets, vocab richness,
 *      hedging, intensifiers, comp usage). Two real outlets sound different;
 *      this quantifies how, so GMSim outlets can too.
 *   2. Polarity lexicon — the words that signal a STRENGTH vs a WEAKNESS
 *      (Beast's polarity-labeled bullets, ranked by weighted log-odds).
 *   3. Position voice — vocabulary each position group over-uses (QBs get
 *      "processing/pocket", EDGE gets "bend/first step").
 *   4. Comp inventory — the NFL players scouts reach for as references.
 *
 * Multi-source by design so the model never over-fits to one author (Brugler).
 * Copyrighted source text stays local (gitignored); the Scribe emits only
 * aggregate statistics, never verbatim passages.
 *
 *   pnpm --filter @gmsim/truth-arbiter run scribe
 */

/** Uncertainty / qualification markers (run on RAW text — many are stopwords). */
const HEDGE =
  /\b(may|might|could|would|tends?|sometimes|occasionally|at times|projects?|projected|likely|appears?|seems?|somewhat|fairly|generally|mostly|inconsistent|streaky|raw|questions?|concerns?)\b/g;
/** Superlatives / intensifiers — the hype register. */
const INTENSIFIER =
  /\b(elite|rare|exceptional|explosive|special|dominant|premier|prototypical|freak(?:y|ish)?|outstanding|tremendous|ultra|extremely|incredibly|natural|effortless|easy|smooth|violent|nasty|twitchy?|sudden)\b/g;
/** In-prose NFL-comparison phrasings. */
const COMP_PHRASE = /\b(reminds? (?:me|you|us) of|in the mold of|comparable to|shades of|similar to|evokes|recalls)\b/i;

function rate(texts: string[], re: RegExp): number {
  if (texts.length === 0) return 0;
  let hits = 0;
  for (const t of texts) {
    re.lastIndex = 0;
    if (re.test(t.toLowerCase())) hits++;
  }
  return hits / texts.length;
}

function wordCount(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

function fmtPct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}

function row(label: string, beast: string, pff: string): string {
  return `  ${label.padEnd(26)}${beast.padStart(10)}${pff.padStart(10)}`;
}

/** Top N distinctive-of-A and distinctive-of-B terms from a log-odds ranking,
 *  preferring at least one multi-word phrase for texture. */
function headTail(ranked: LogOddsTerm[], n: number): { head: LogOddsTerm[]; tail: LogOddsTerm[] } {
  return { head: ranked.slice(0, n), tail: ranked.slice(-n).reverse() };
}

function termList(terms: LogOddsTerm[]): string {
  return terms.map((t) => `${t.term} (${t.z >= 0 ? '+' : ''}${t.z.toFixed(1)})`).join(', ');
}

async function load<T>(rel: string): Promise<T> {
  return JSON.parse(await readFile(resolve(DATA_DIR, rel), 'utf8')) as T;
}

async function main(): Promise<void> {
  /* eslint-disable no-console */
  const beast = await load<BeastProspect[]>('beast/beast-all.json');
  const pff = await load<PffReport[]>('pff/pff-all.json');

  // ---- text pools ----
  const beastBullets = beast.flatMap((p) => [...(p.strengths ?? []), ...(p.weaknesses ?? [])]);
  const beastNarr = beast.map((p) => p.summary ?? '').filter(Boolean);
  const pffBullets = pff.flatMap((p) => p.evalPoints ?? []);
  const pffNarr = pff.map((p) => p.analysis ?? '').filter(Boolean);

  console.log('THE SCRIBE — scouting-voice profile');
  console.log(`source corpus: Beast ${beast.length} prospects · PFF ${pff.length} reports\n`);

  // ---- 1. voice fingerprints ----
  console.log('1. VOICE FINGERPRINTS  (a Brugler report and a PFF report do not sound alike)');
  console.log(row('', 'BEAST', 'PFF'));
  console.log(
    row(
      'reports w/ narrative',
      String(beastNarr.length),
      String(pffNarr.length),
    ),
  );
  console.log(
    row(
      'avg words / narrative',
      mean(beastNarr.map(wordCount)).toFixed(0),
      mean(pffNarr.map(wordCount)).toFixed(0),
    ),
  );
  const beastBulletCounts = beast
    .filter((p) => (p.strengths?.length ?? 0) + (p.weaknesses?.length ?? 0) > 0)
    .map((p) => (p.strengths?.length ?? 0) + (p.weaknesses?.length ?? 0));
  const pffBulletCounts = pff.filter((p) => p.evalPoints.length).map((p) => p.evalPoints.length);
  console.log(
    row('median bullets / report', median(beastBulletCounts).toFixed(0), median(pffBulletCounts).toFixed(0)),
  );
  console.log(
    row(
      'median bullet words',
      median(beastBullets.map(wordCount)).toFixed(0),
      median(pffBullets.map(wordCount)).toFixed(0),
    ),
  );
  console.log(
    row('vocab richness (TTR)', typeTokenRatio(beastBullets).toFixed(3), typeTokenRatio(pffBullets).toFixed(3)),
  );
  console.log(row('hedge rate (bullets)', fmtPct(rate(beastBullets, HEDGE)), fmtPct(rate(pffBullets, HEDGE))));
  console.log(
    row('intensifier rate (bullets)', fmtPct(rate(beastBullets, INTENSIFIER)), fmtPct(rate(pffBullets, INTENSIFIER))),
  );
  const beastCompRate = beast.filter((p) => p.proComp || COMP_PHRASE.test(p.summary ?? '')).length / beast.length;
  const pffCompRate =
    pff.filter((p) => /shades of/i.test(p.projectionRaw ?? '') || COMP_PHRASE.test(p.analysis ?? '')).length /
    pff.length;
  console.log(row('NFL-comp rate', fmtPct(beastCompRate), fmtPct(pffCompRate)));

  // ---- 2. polarity lexicon ----
  console.log('\n2. POLARITY LEXICON  (Beast strength vs weakness bullets, weighted log-odds z)');
  const strengthsTexts = beast.flatMap((p) => p.strengths ?? []);
  const weaknessTexts = beast.flatMap((p) => p.weaknesses ?? []);
  const polar = logOdds(countTerms(strengthsTexts), countTerms(weaknessTexts), { minCount: 8 });
  const { head, tail } = headTail(polar, 16);
  console.log('  STRENGTH-signal:', termList(head));
  console.log('  WEAKNESS-signal:', termList(tail));

  // ---- 3. position voice ----
  console.log('\n3. POSITION VOICE  (terms a group over-uses vs the rest of the board)');
  const byPos = new Map<string, string[]>();
  for (const p of beast) {
    const txt = [...(p.strengths ?? []), ...(p.weaknesses ?? []), p.summary ?? ''].join(' ');
    if (!txt.trim()) continue;
    const arr = byPos.get(p.position) ?? [];
    arr.push(txt);
    byPos.set(p.position, arr);
  }
  const ORDER = ['QB', 'RB', 'WR', 'TE', 'OT', 'OG', 'C', 'EDGE', 'DT', 'LB', 'CB', 'S'];
  const positions = [...byPos.keys()].sort(
    (a, b) => (ORDER.indexOf(a) + 100 * (ORDER.indexOf(a) < 0 ? 1 : 0)) - (ORDER.indexOf(b) + 100 * (ORDER.indexOf(b) < 0 ? 1 : 0)),
  );
  const positionVocab: Record<string, string[]> = {};
  for (const pos of positions) {
    const texts = byPos.get(pos)!;
    if (texts.length < 40) continue; // too few to characterize
    const rest = beast
      .filter((p) => p.position !== pos)
      .map((p) => [...(p.strengths ?? []), ...(p.weaknesses ?? []), p.summary ?? ''].join(' '));
    const ranked = logOdds(countTerms(texts), countTerms(rest), { minCount: 10 });
    const top = ranked.slice(0, 12).map((t) => t.term);
    positionVocab[pos] = top;
    console.log(`  ${pos.padEnd(4)} (${String(texts.length).padStart(4)}): ${top.slice(0, 8).join(', ')}`);
  }

  // ---- 3b. per-position polarity ----
  // The global polarity lexicon (section 2) says which words mark a strength vs
  // a weakness across the whole board; this splits it BY POSITION, so the
  // weakness pole of a QB ("happy feet / stares down") differs from a tackle's
  // ("lunges / heavy feet"). This is what lets a generated scout-report concern
  // name a position-specific failure mode instead of a negated compliment.
  console.log('\n3b. PER-POSITION POLARITY  (strength vs weakness signal, within each group)');
  const positionPolarity: Record<string, { strengthSignal: string[]; weaknessSignal: string[] }> = {};
  for (const pos of positions) {
    const group = beast.filter((p) => p.position === pos);
    const sTexts = group.flatMap((p) => p.strengths ?? []);
    const wTexts = group.flatMap((p) => p.weaknesses ?? []);
    if (sTexts.length < 30 || wTexts.length < 30) continue; // too few to characterize
    const ranked = logOdds(countTerms(sTexts), countTerms(wTexts), { minCount: 5 });
    const { head, tail } = headTail(ranked, 10);
    positionPolarity[pos] = {
      strengthSignal: head.map((t) => t.term),
      weaknessSignal: tail.map((t) => t.term),
    };
    console.log(`  ${pos.padEnd(4)} S: ${head.slice(0, 6).map((t) => t.term).join(', ')}`);
    console.log(`       W: ${tail.slice(0, 6).map((t) => t.term).join(', ')}`);
  }

  // ---- 4. comp inventory ----
  console.log('\n4. COMP INVENTORY  (NFL players scouts reach for as a reference)');
  const comps = new Map<string, number>();
  for (const p of beast) {
    if (p.proComp) comps.set(p.proComp, (comps.get(p.proComp) ?? 0) + 1);
  }
  for (const r of pff) {
    const m = (r.projectionRaw ?? '').match(/shades of\s+(.+)/i);
    if (m) {
      const name = m[1]!.trim();
      comps.set(name, (comps.get(name) ?? 0) + 1);
    }
  }
  const ranked = [...comps.entries()].sort((a, b) => b[1] - a[1]);
  const repeated = ranked.filter(([, c]) => c > 1);
  console.log(`  distinct comps: ${comps.size}  ·  invoked >1x: ${repeated.length}`);
  console.log(
    '  most-invoked:',
    ranked.slice(0, 14).map(([n, c]) => `${n}${c > 1 ? `×${c}` : ''}`).join(', '),
  );

  // ---- corpus scale footnote ----
  const totalTokens = [...beastBullets, ...beastNarr, ...pffBullets, ...pffNarr].reduce(
    (s, t) => s + tokenize(t).length,
    0,
  );
  console.log(`\ncorpus: ${beastBullets.length + pffBullets.length} bullets · ${totalTokens.toLocaleString()} content tokens`);

  // ---- machine-readable profile (the spec downstream consumers calibrate to) ----
  const profile = {
    generatedAt: new Date().toISOString().slice(0, 10),
    source: { beastProspects: beast.length, pffReports: pff.length },
    fingerprints: {
      beast: {
        avgNarrativeWords: Math.round(mean(beastNarr.map(wordCount))),
        medianBullets: median(beastBulletCounts),
        ttr: Number(typeTokenRatio(beastBullets).toFixed(3)),
        hedgeRate: Number(rate(beastBullets, HEDGE).toFixed(3)),
        intensifierRate: Number(rate(beastBullets, INTENSIFIER).toFixed(3)),
        compRate: Number(beastCompRate.toFixed(3)),
      },
      pff: {
        avgNarrativeWords: Math.round(mean(pffNarr.map(wordCount))),
        medianBullets: median(pffBulletCounts),
        ttr: Number(typeTokenRatio(pffBullets).toFixed(3)),
        hedgeRate: Number(rate(pffBullets, HEDGE).toFixed(3)),
        intensifierRate: Number(rate(pffBullets, INTENSIFIER).toFixed(3)),
        compRate: Number(pffCompRate.toFixed(3)),
      },
    },
    polarityLexicon: {
      strengthSignal: head.map((t) => t.term),
      weaknessSignal: tail.map((t) => t.term),
    },
    positionVocab,
    positionPolarity,
    topComps: ranked.slice(0, 30).map(([n, c]) => ({ name: n, count: c })),
  };
  const outDir = resolve(DATA_DIR, 'voice');
  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, 'scribe-profile.json'), JSON.stringify(profile, null, 2));
  console.log('→ wrote data/voice/scribe-profile.json (the voice spec)');
  /* eslint-enable no-console */
}

// ── audit mode: GMSim generated take phrasing vs the real position vocab ─────

async function runAudit(): Promise<void> {
  /* eslint-disable no-console */
  const { gmsimProspectTakes } = await import('../lib/engine-bridge.js');
  const seeds = Array.from({ length: 4 }, (_, i) => `scribe-audit-${i + 1}`);
  const takes = (await Promise.all(seeds.map((s) => gmsimProspectTakes(s)))).flat();

  console.log('THE SCRIBE — engine audit  (GMSim generated take phrasing)');
  console.log(`generated ${takes.length} player-takes across ${seeds.length} seeds`);
  console.log(
    'Before this slice a take said only "{pos}" — a QB take and an EDGE take read\n' +
      'identically. The Scribe\'s per-position vocabulary now feeds a {trait} slot, so\n' +
      'each take should sound like a scout who watched THAT position. Eyeball:\n',
  );

  // One sample per distinct position, so the position-awareness is visible.
  const seen = new Set<string>();
  for (const t of takes) {
    if (seen.has(t.position)) continue;
    seen.add(t.position);
    console.log(`  [${t.position.padEnd(6)}] ${t.headline}`);
  }
  console.log(`\n  (${seen.size} positions represented across ${takes.length} takes)`);

  // ── richer scout-report prose (v0.118) ─────────────────────────────────────
  const withReport = takes.filter((t) => t.scoutReport);
  console.log(`\n  FULLER WRITEUPS — ${withReport.length}/${takes.length} takes carry a scout report.`);
  console.log(
    '  A report is the prose BENEATH the headline: a lead read, position-aware\n' +
      '  strengths, an honest concern, a bottom line. Loud outlets reach for the\n' +
      '  hype register and bolder projections; measured outlets stay grounded.\n',
  );
  const loud = withReport.find((t) => t.outletHype >= 6);
  const measured = withReport.find((t) => t.outletHype < 6);
  for (const [label, t] of [
    ['LOUD    ', loud],
    ['MEASURED', measured],
  ] as const) {
    if (!t?.scoutReport) continue;
    const r = t.scoutReport;
    console.log(`  ── ${label} · ${t.position} (outlet hype ${t.outletHype}) ──`);
    console.log(`     ${r.summary}`);
    for (const s of r.strengths) console.log(`       + ${s}`);
    console.log(`       – ${r.concern}`);
    if (r.comp) console.log(`       ~ ${r.comp}`);
    console.log(`     → ${r.bottomLine}\n`);
  }
  /* eslint-enable no-console */
}

async function entry(): Promise<void> {
  if (process.argv[2] === 'audit') await runAudit();
  else await main();
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scribe.js')) {
  entry().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
