import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { embedText, assertOllamaReady } from './ollama.js';
import { DATA_DIR } from '../lib/config.js';

/**
 * Maddeninator M1: draft the Madden-attribute → PlayerSkills map with Ollama
 * embeddings, for human review (the map itself is checked in as a reviewed TS
 * table only AFTER Daniel/Fable sign off — this just proposes candidates).
 *
 * Each Madden code is expanded to its canonical phrase (glossary below), each
 * of our PlayerSkills keys to a readable phrase; both are embedded with
 * nomic-embed-text and cosine-ranked. Output: data/madden/attribute-map-review.json.
 *
 *   pnpm --filter @gmsim/truth-arbiter run madden-attr-draft
 */

// Madden codes actually observed in the scraped year/pos pages → canonical phrase.
const MADDEN_GLOSSARY: Record<string, string> = {
  SPD: 'speed', ACC: 'acceleration', AGI: 'agility', COD: 'change of direction',
  STR: 'strength', JMP: 'jumping', AWR: 'awareness football intelligence',
  CAR: 'carrying ball security', CTH: 'catching hands', TKL: 'tackling',
  MCV: 'man coverage defensive back', PBK: 'pass blocking offensive line',
  RBK: 'run blocking offensive line', THP: 'throw power arm strength',
  THA: 'throw accuracy overall', TAS: 'throw accuracy short',
  TAM: 'throw accuracy medium', TAD: 'throw accuracy deep',
  TOR: 'throw on the run', TUP: 'throw under pressure',
  KPW: 'kick power leg strength', KAC: 'kick accuracy', KRT: 'kick return returner',
};

// Our PlayerSkills keys → readable phrase for embedding.
const SKILL_PHRASES: Record<string, string> = {
  speed: 'speed', acceleration: 'acceleration', agility: 'agility',
  changeOfDirection: 'change of direction', strength: 'strength', jumping: 'jumping',
  footballIq: 'football intelligence awareness', playRecognition: 'play recognition awareness',
  carrying: 'carrying ball security', ballCarrierVision: 'ball carrier vision',
  catching: 'catching hands', catchInTraffic: 'catch in traffic', contestedCatch: 'contested catch',
  tackle: 'tackling', hitPower: 'hit power', pursuit: 'pursuit', blockShedding: 'block shedding',
  manCoverage: 'man coverage', zoneCoverage: 'zone coverage', pressCoverage: 'press coverage',
  ballSkills: 'ball skills defensive back',
  runBlockPower: 'run block power', runBlockFinesse: 'run block finesse',
  passBlockPower: 'pass block power', passBlockFinesse: 'pass block finesse',
  throwPower: 'throw power arm strength', accuracyShort: 'throw accuracy short',
  accuracyMedium: 'throw accuracy medium', accuracyDeep: 'throw accuracy deep',
  throwOnRun: 'throw on the run', throwUnderPressure: 'throw under pressure',
  kickPower: 'kick power leg strength', kickAccuracy: 'kick accuracy',
  puntPower: 'punt power', puntAccuracy: 'punt accuracy',
};

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i]!, y = b[i]!; dot += x * y; na += x * x; nb += y * y; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

async function main(): Promise<void> {
  await assertOllamaReady();
  const skillKeys = Object.keys(SKILL_PHRASES);
  const skillVecs = new Map<string, number[]>();
  for (const k of skillKeys) skillVecs.set(k, await embedText(SKILL_PHRASES[k]!));

  const review: Record<string, { top3: { skill: string; score: number }[] }> = {};
  for (const [code, phrase] of Object.entries(MADDEN_GLOSSARY)) {
    const v = await embedText(phrase);
    const ranked = skillKeys
      .map((k) => ({ skill: k, score: Number(cosine(v, skillVecs.get(k)!).toFixed(3)) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    review[code] = { top3: ranked };
    console.log(`  ${code.padEnd(4)} (${phrase.padEnd(30)}) → ${ranked.map((r) => `${r.skill}:${r.score}`).join('  ')}`);
  }

  await mkdir(resolve(DATA_DIR, 'madden'), { recursive: true });
  await writeFile(
    resolve(DATA_DIR, 'madden', 'attribute-map-review.json'),
    JSON.stringify(review, null, 2),
    'utf8',
  );
  console.log('\nWrote data/madden/attribute-map-review.json — REVIEW before use (M1 checkpoint).');
}

main().catch((err) => { console.error(err); process.exit(1); });
