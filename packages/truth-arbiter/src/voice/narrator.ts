import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DATA_DIR } from '../lib/config.js';
import { generatedBackstoryClass, type BackstoryProspect } from '../lib/engine-bridge.js';
import type { BeastProspect } from '../corpus/beast.js';
import { mean } from './lexicon.js';

/**
 * The Narrator — player-backstory authority (2026-06-04, Daniel-directed).
 *
 * The Scribe's sibling. Where the Scribe models how a report is WORDED, the
 * Narrator models who the player IS before the league sees him — the origin
 * story. It mines the Beast's `background` bios into an empirical taxonomy so
 * GMSim can attach realistic backstories to generated players (and so a few
 * lowly-recruited grinders make it, the Danny Woodhead types Daniel wants).
 *
 *   1. Recruiting pedigree — the star-rating distribution (five-star blue-chip
 *      down to walk-on), the real shape generated classes should match.
 *   2. Pedigree x draft round — the key realism correlation: do blue-chips
 *      actually cluster in round 1 and the under-recruited slide to Day 3 /
 *      UDFA? (Ties to the talent-spread thread — recruiting IS prior talent.)
 *   3. Backstory motifs — transfer / JUCO / redshirt / walk-on / football
 *      bloodline / multi-sport / hardship rates, the texture of an origin.
 *   4. Geography — which states produce prospects (structured hometown).
 *
 * Reads the gitignored local corpus; emits only aggregate statistics, never a
 * verbatim bio.
 *
 *   pnpm --filter @gmsim/truth-arbiter run narrator
 */

/** AP-style state abbreviations (as the Beast writes hometowns) → USPS. The
 *  eight states AP spells out in full map straight through. */
const STATE: Record<string, string> = {
  ala: 'AL', ariz: 'AZ', ark: 'AR', calif: 'CA', colo: 'CO', conn: 'CT', del: 'DE',
  fla: 'FL', ga: 'GA', ill: 'IL', ind: 'IN', kan: 'KS', kans: 'KS', ky: 'KY', la: 'LA',
  md: 'MD', mass: 'MA', mich: 'MI', minn: 'MN', miss: 'MS', mo: 'MO', mont: 'MT',
  neb: 'NE', nev: 'NV', okla: 'OK', ore: 'OR', pa: 'PA', tenn: 'TN', tex: 'TX',
  va: 'VA', vt: 'VT', wash: 'WA', wis: 'WI', wyo: 'WY',
  texas: 'TX', ohio: 'OH', iowa: 'IA', utah: 'UT', idaho: 'ID', maine: 'ME',
  alaska: 'AK', hawaii: 'HI',
};

/** Normalize the trailing state token of a "City, St." hometown to USPS. */
function homeState(hometown: string | undefined | null): string | null {
  if (!hometown) return null;
  const parts = hometown.split(',');
  if (parts.length < 2) return null;
  const raw = parts[parts.length - 1]!.trim().replace(/\./g, '').toLowerCase();
  if (!raw) return null;
  if (STATE[raw]) return STATE[raw]!;
  // already USPS (2-letter) or a foreign/unknown token
  if (/^[a-z]{2}$/.test(raw)) return raw.toUpperCase();
  return raw.toUpperCase();
}

/** Star rating from the bio: 5..1, 0 = walk-on/unranked, null = not stated.
 *  Takes the first star mention (the prospect's own rating in nearly all bios). */
function starRating(bio: string): number | null {
  const m = bio.match(/\b(five|four|three|two|one)-star\b/i);
  if (m) return { five: 5, four: 4, three: 3, two: 2, one: 1 }[m[1]!.toLowerCase()] ?? null;
  if (/\b(walk-?on|zero-star|unranked|two-star|no-star)\b/i.test(bio)) return 0;
  return null;
}

const MOTIF: Record<string, RegExp> = {
  transfer: /\btransferr?ed\b|\btransfer (?:from|to|portal)\b|graduate transfer/i,
  juco: /\bjunior college\b|\bjuco\b/i,
  redshirt: /\bred-?shirt/i,
  walkOn: /\bwalk-?on\b/i,
  // football bloodline: a relative explicitly tied to playing/coaching at a
  // notable level (avoids matching any mention of a father).
  bloodline:
    /\b(?:son|brother|nephew|grandson|cousin) of\b|\b(?:father|brother|uncle|cousin|grandfather)\b[^.]{0,60}\b(?:nfl|pro bowl|all-pro|all-american|played (?:college|professional|in the)|coached|head coach|coordinator)\b/i,
  multiSport: /\b(?:basketball|baseball|track|wrestling|hockey|soccer|lacrosse|rugby)\b/i,
  hardship:
    /\b(?:passed away|died|homeless|overcame|adversity|single mother|raised by his (?:mother|grandmother|aunt|grandparents)|lost his (?:father|mother|brother))\b/i,
  captain: /\bteam captain\b/i,
};

function pct(n: number, d: number): string {
  return d === 0 ? '  -' : `${((100 * n) / d).toFixed(0)}%`;
}

const ROUND_BUCKETS: { label: string; has: (r: number | null) => boolean }[] = [
  { label: 'R1', has: (r) => r === 1 },
  { label: 'R2', has: (r) => r === 2 },
  { label: 'R3', has: (r) => r === 3 },
  { label: 'R4-5', has: (r) => r === 4 || r === 5 },
  { label: 'R6-7', has: (r) => r === 6 || r === 7 },
  { label: 'UDFA', has: (r) => r === 8 },
];

async function main(): Promise<void> {
  /* eslint-disable no-console */
  const beast = JSON.parse(
    await readFile(resolve(DATA_DIR, 'beast/beast-all.json'), 'utf8'),
  ) as BeastProspect[];
  const withBio = beast.filter((p) => (p.background?.length ?? 0) > 120);

  console.log('THE NARRATOR — player-backstory taxonomy');
  console.log(`source: Beast ${withBio.length} bios (of ${beast.length} prospects)\n`);

  // ---- 1. recruiting pedigree ----
  const stars = withBio.map((p) => starRating(p.background ?? ''));
  const rated = stars.filter((s): s is number => s !== null);
  const tally = (pred: (s: number) => boolean) => rated.filter(pred).length;
  console.log('1. RECRUITING PEDIGREE  (star rating mined from the bio)');
  console.log(
    `   5★ ${pct(tally((s) => s === 5), rated.length)}` +
      `  ·  4★ ${pct(tally((s) => s === 4), rated.length)}` +
      `  ·  3★ ${pct(tally((s) => s === 3), rated.length)}` +
      `  ·  ≤2★ ${pct(tally((s) => s >= 1 && s <= 2), rated.length)}` +
      `  ·  walk-on/unranked ${pct(tally((s) => s === 0), rated.length)}`,
  );
  console.log(
    `   rated ${rated.length}/${withBio.length} (${pct(rated.length, withBio.length)})  ·  avg ★ ${mean(rated.filter((s) => s > 0)).toFixed(2)} (rated stars only)`,
  );

  // ---- 2. pedigree x round ----
  console.log('\n2. PEDIGREE × DRAFT ROUND  (do blue-chips cluster early?)');
  console.log('   bucket    n    rated   avg★   blue-chip(4-5★)   3★    ≤2★/walk-on');
  for (const b of ROUND_BUCKETS) {
    const grp = withBio.filter((p) => b.has(p.round ?? null));
    const gr = grp.map((p) => starRating(p.background ?? '')).filter((s): s is number => s !== null);
    if (gr.length === 0) continue;
    const blue = gr.filter((s) => s >= 4).length;
    const three = gr.filter((s) => s === 3).length;
    const low = gr.filter((s) => s <= 2).length;
    const avg = mean(gr.filter((s) => s > 0));
    console.log(
      `   ${b.label.padEnd(6)}${String(grp.length).padStart(5)}${String(gr.length).padStart(7)}` +
        `${avg.toFixed(2).padStart(8)}${pct(blue, gr.length).padStart(15)}${pct(three, gr.length).padStart(8)}${pct(low, gr.length).padStart(13)}`,
    );
  }

  // ---- 3. backstory motifs ----
  console.log('\n3. BACKSTORY MOTIFS  (% of bios)');
  const motifKeys = Object.keys(MOTIF);
  const counts = Object.fromEntries(motifKeys.map((k) => [k, 0])) as Record<string, number>;
  for (const p of withBio) {
    const bio = p.background ?? '';
    for (const k of motifKeys) if (MOTIF[k]!.test(bio)) counts[k]!++;
  }
  console.log(
    '   ' +
      motifKeys.map((k) => `${k} ${pct(counts[k]!, withBio.length)}`).join('  ·  '),
  );
  // transfer rate by round bucket — does the under-recruited path show late?
  const transferByBucket = ROUND_BUCKETS.map((b) => {
    const grp = withBio.filter((p) => b.has(p.round ?? null));
    const t = grp.filter((p) => MOTIF.transfer!.test(p.background ?? '')).length;
    return `${b.label} ${pct(t, grp.length)}`;
  });
  console.log('   transfer by round:  ' + transferByBucket.join('  ·  '));

  // ---- 4. geography ----
  console.log('\n4. GEOGRAPHY  (home state from structured hometown)');
  const stateCounts = new Map<string, number>();
  let located = 0;
  for (const p of beast) {
    const st = homeState(p.hometown);
    if (!st) continue;
    located++;
    stateCounts.set(st, (stateCounts.get(st) ?? 0) + 1);
  }
  const topStates = [...stateCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log(`   located ${located}/${beast.length}  ·  distinct states ${stateCounts.size}`);
  console.log(
    '   top producers:  ' +
      topStates.map(([s, c]) => `${s} ${pct(c, located)}`).join('  ·  '),
  );
  /* eslint-enable no-console */
}

// ── audit mode: GMSim generated backstories vs the real targets ──────────────

/** Project an engine consensus-board rank to a real round bucket label. */
function genBucket(rank: number): string | null {
  const r = Math.ceil(rank / 32);
  if (r === 1) return 'R1';
  if (r === 2) return 'R2';
  if (r === 3) return 'R3';
  if (r === 4 || r === 5) return 'R4-5';
  if (r === 6 || r === 7) return 'R6-7';
  if (r === 8) return 'UDFA';
  return null; // deep pool — no real-corpus analog
}

async function runAudit(beast: BeastProspect[]): Promise<void> {
  /* eslint-disable no-console */
  const withBio = beast.filter((p) => (p.background?.length ?? 0) > 120);
  const seeds = Array.from({ length: 8 }, (_, i) => `narrator-audit-${i + 1}`);
  console.log('THE NARRATOR — engine audit  (GMSim generated backstory vs real)');
  console.log(`real: Beast ${withBio.length} bios  ·  generated: ${seeds.length} seeds\n`);
  const classes = await Promise.all(seeds.map((s) => generatedBackstoryClass(s)));
  const gen = classes.flat();
  const genDrafted = gen.filter((p) => genBucket(p.rank) !== null);

  // ---- pedigree × round: real vs generated ----
  console.log('PEDIGREE × ROUND   blue-chip(4-5★) share  ·  avg★');
  console.log('   bucket     real blue   gen blue    Δ        real ★   gen ★');
  for (const b of ROUND_BUCKETS) {
    const rg = withBio
      .filter((p) => b.has(p.round ?? null))
      .map((p) => starRating(p.background ?? ''))
      .filter((s): s is number => s !== null);
    const gg = genDrafted.filter((p) => genBucket(p.rank) === b.label).map((p) => p.star);
    if (rg.length === 0 || gg.length === 0) continue;
    const rBlue = rg.filter((s) => s >= 4).length / rg.length;
    const gBlue = gg.filter((s) => s >= 4).length / gg.length;
    const rAvg = mean(rg.filter((s) => s > 0));
    const gAvg = mean(gg);
    const d = (gBlue - rBlue) * 100;
    console.log(
      `   ${b.label.padEnd(7)}${(rBlue * 100).toFixed(0).padStart(8)}%${(gBlue * 100).toFixed(0).padStart(10)}%` +
        `${`${d >= 0 ? '+' : ''}${d.toFixed(0)}`.padStart(8)}${rAvg.toFixed(2).padStart(11)}${gAvg.toFixed(2).padStart(8)}`,
    );
  }

  // ---- motif rates: real vs generated (overall, over the drafted set) ----
  console.log('\nMOTIF RATES   (real bios  vs  generated drafted set)');
  const realRate = (re: RegExp) =>
    withBio.filter((p) => re.test(p.background ?? '')).length / withBio.length;
  const genRate = (pred: (p: BackstoryProspect) => boolean) =>
    genDrafted.filter(pred).length / genDrafted.length;
  const rows: [string, number, number][] = [
    ['transfer', realRate(MOTIF.transfer!), genRate((p) => p.isTransfer)],
    ['redshirt', realRate(MOTIF.redshirt!), genRate((p) => p.isRedshirt)],
    ['walk-on', realRate(MOTIF.walkOn!), genRate((p) => p.isWalkOn)],
    ['bloodline', realRate(MOTIF.bloodline!), genRate((p) => p.hasBloodline)],
    ['captain', realRate(MOTIF.captain!), genRate((p) => p.isCaptain)],
    ['multi-sport', realRate(MOTIF.multiSport!), genRate((p) => p.isMultiSport)],
  ];
  console.log('   motif         real    gen     Δ');
  for (const [name, r, g] of rows) {
    const d = (g - r) * 100;
    console.log(
      `   ${name.padEnd(12)}${(r * 100).toFixed(0).padStart(5)}%${(g * 100).toFixed(0).padStart(7)}%` +
        `${`${d >= 0 ? '+' : ''}${d.toFixed(0)}`.padStart(7)}`,
    );
  }
  console.log('\nSAMPLE NARRATIVES   (the Narrator rendering generated prospects as prose)');
  for (const p of genDrafted.slice(0, 6)) {
    console.log(`   #${String(p.rank).padStart(3)} ${p.positionGroup.padEnd(4)}  ${p.narrative}`);
  }

  console.log(
    `\n   generated pool: ${gen.length} prospects · drafted set (top ~256): ${genDrafted.length}`,
  );
  /* eslint-enable no-console */
}

async function entry(): Promise<void> {
  const mode = process.argv[2];
  if (mode === 'audit') {
    const beast = JSON.parse(
      await readFile(resolve(DATA_DIR, 'beast/beast-all.json'), 'utf8'),
    ) as BeastProspect[];
    await runAudit(beast);
  } else {
    await main();
  }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('narrator.js')) {
  entry().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
