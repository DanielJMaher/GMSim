import { describe, it } from 'vitest';
import { createLeague } from '../league/generate.js';
import { tickPhase } from './lifecycle.js';
import { computeOutletQualityByGroup } from '../media/media-quality.js';
import type { LeagueState } from '../types/league.js';
import type { CollegePlayer, CollegePlayerObservation } from '../types/college.js';

/**
 * Instrument (not a guard) for the media recalibration. Measures the media
 * stream against the intended model (Daniel, 2026-05-27):
 *   - the media is a USEFUL data point that mostly tracks reality;
 *   - good (high-accuracy) outlets read close to truth — listening pays off;
 *   - it hypes ALREADY-ESTABLISHED prospects, not random scrubs;
 *   - over-hyping a mid prospect to a high grade is RARE (1-2 outlets), not
 *     the pervasive texture;
 *   - reliability is differentiated + patterned so a consumer can learn
 *     WHICH outlet to trust, WHERE, and WHY.
 *
 * Run skipped; un-skip to read the numbers.
 *
 * Baseline finding (v0.87, seed 'media-realism'): pre-draft consensus
 * top-32 had 27/32 outside the real top-50; every outlet positively biased
 * (+5 to +16); the max-hype outlet over-hyped 43 mid prospects (real ~55)
 * by +15. i.e. ranking was dominated by flashiness, not skill — off the
 * rails. The good (acc-9, hype-3) outlet was the best at +5 bias / ~0 noise.
 */
function realGrade(cp: CollegePlayer): number {
  const vals = Object.values(cp.current) as number[];
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function obsOverall(o: CollegePlayerObservation): { overall: number; conf: number } {
  const sv = Object.values(o.skills).filter((v): v is number => typeof v === 'number');
  const cv = Object.values(o.confidence).filter((v): v is number => typeof v === 'number');
  return {
    overall: sv.length ? sv.reduce((a, b) => a + b, 0) / sv.length : 0,
    conf: cv.length ? cv.reduce((a, b) => a + b, 0) / cv.length : 0,
  };
}

function outletIdOf(scoutId: string): string {
  return scoutId.split('::')[0] ?? scoutId;
}

function analyze(label: string, league: LeagueState): void {
  const obs = league.mediaCollegeObservations;
  const cpById = new Map(league.collegePool.map((cp) => [cp.id as string, cp] as const));

  const byOutlet = new Map<string, Map<string, { wsum: number; csum: number }>>();
  for (const o of obs) {
    const outlet = outletIdOf(o.scoutId);
    const { overall, conf } = obsOverall(o);
    if (conf <= 0) continue;
    let perProspect = byOutlet.get(outlet);
    if (!perProspect) {
      perProspect = new Map();
      byOutlet.set(outlet, perProspect);
    }
    const cur = perProspect.get(o.collegePlayerId) ?? { wsum: 0, csum: 0 };
    cur.wsum += overall * conf;
    cur.csum += conf;
    perProspect.set(o.collegePlayerId, cur);
  }

  /* eslint-disable no-console */
  console.log(`\n=== MEDIA REALISM (${label}, phase ${league.lifecyclePhase}) ===`);
  console.log(`outlets covering: ${byOutlet.size}, obs: ${obs.length}`);
  console.log('acc hype  bias  MAE  | overhyped(+15) realOf(overhyped)');
  const rows: Array<{ acc: number; hype: number; bias: number; mae: number; over: number; overReal: number }> = [];
  for (const [outletId, perProspect] of byOutlet) {
    const outlet = league.mediaOutlets[outletId as keyof typeof league.mediaOutlets];
    if (!outlet) continue;
    let biasSum = 0;
    let aeSum = 0;
    let n = 0;
    let over = 0;
    let overRealSum = 0;
    for (const [pid, { wsum, csum }] of perProspect) {
      const cp = cpById.get(pid);
      if (!cp || csum <= 0) continue;
      const perceived = wsum / csum;
      const real = realGrade(cp);
      const bias = perceived - real;
      biasSum += bias;
      aeSum += Math.abs(bias);
      n += 1;
      if (bias >= 15) {
        over += 1;
        overRealSum += real;
      }
    }
    if (n === 0) continue;
    rows.push({
      acc: outlet.accuracySpectrum,
      hype: outlet.hypeSpectrum,
      bias: biasSum / n,
      mae: aeSum / n,
      over,
      overReal: over > 0 ? overRealSum / over : 0,
    });
  }
  rows.sort((a, b) => b.acc - a.acc);
  for (const r of rows) {
    console.log(
      `${String(r.acc).padStart(2)}  ${String(r.hype).padStart(2)}  ` +
        `${r.bias >= 0 ? '+' : ''}${r.bias.toFixed(1).padStart(5)}  ${r.mae.toFixed(1).padStart(4)}  | ` +
        `${String(r.over).padStart(3)}  ${r.overReal ? r.overReal.toFixed(0) : '-'}`,
    );
  }

  const consensusPerceived = new Map<string, { wsum: number; csum: number }>();
  for (const o of obs) {
    const { overall, conf } = obsOverall(o);
    if (conf <= 0) continue;
    const cur = consensusPerceived.get(o.collegePlayerId) ?? { wsum: 0, csum: 0 };
    cur.wsum += overall * conf;
    cur.csum += conf;
    consensusPerceived.set(o.collegePlayerId, cur);
  }
  const consensus = [...consensusPerceived.entries()]
    .map(([pid, { wsum, csum }]) => ({ pid, grade: csum > 0 ? wsum / csum : 0 }))
    .sort((a, b) => b.grade - a.grade);
  const realRank = new Map<string, number>();
  [...cpById.values()]
    .filter((cp) => cp.isDraftEligible)
    .sort((a, b) => realGrade(b) - realGrade(a))
    .forEach((cp, i) => realRank.set(cp.id, i + 1));
  let vaulters = 0;
  for (const e of consensus.slice(0, 32)) {
    const rr = realRank.get(e.pid);
    if (rr === undefined || rr > 50) vaulters += 1;
  }
  console.log(`consensus top-32: ${vaulters} outside the real top-50 (mid guys vaulting)`);

  // v0.89: the real quality measure — per-outlet × per-group rank
  // correlation of the read vs the real board (robust to the near-flat
  // realGrade distribution that made the top-32 count an artifact). High =
  // trust this outlet's order here; the spread ACROSS groups in a row is
  // the "sharp here / hypes there" pattern a consumer learns.
  const GROUPS = ['QB', 'SKILL', 'OL', 'DL', 'LB', 'DB', 'ST'] as const;
  console.log('\nrank-correlation (read vs real) by outlet × group:');
  console.log(`acc hype  ${GROUPS.map((g) => g.padStart(5)).join(' ')}`);
  const outletList = [...byOutlet.keys()]
    .map((id) => league.mediaOutlets[id as keyof typeof league.mediaOutlets])
    .filter((o): o is NonNullable<typeof o> => Boolean(o))
    .sort((a, b) => b.accuracySpectrum - a.accuracySpectrum);
  for (const outlet of outletList) {
    const rows = computeOutletQualityByGroup(obs, league.collegePool, outlet.id);
    const byGroup = new Map(rows.map((r) => [r.group, r] as const));
    const cells = GROUPS.map((g) => {
      const c = byGroup.get(g)?.rankCorrelation;
      return (c === null || c === undefined ? '   - ' : c.toFixed(2).padStart(5));
    }).join(' ');
    console.log(
      `${String(outlet.accuracySpectrum).padStart(2)}  ${String(outlet.hypeSpectrum).padStart(2)}  ${cells}`,
    );
  }
  /* eslint-enable no-console */
}

describe.skip('media realism diagnostic', () => {
  it('per-outlet bias/accuracy + consensus anchoring, in-season and pre-draft', () => {
    let league = createLeague({ seed: 'media-realism' });
    let lastCollegeWeek: LeagueState | null = null;
    let top30: LeagueState | null = null;
    for (let i = 0; i < 60; i++) {
      const next = tickPhase(league);
      if (next === league) break;
      league = next;
      if (league.mediaCollegeObservations.length === 0) continue;
      if (league.lifecyclePhase === 'COLLEGE_WEEK') lastCollegeWeek = league;
      if (league.lifecyclePhase === 'TOP_30_VISITS') top30 = league;
    }
    if (lastCollegeWeek) analyze('late in-season', lastCollegeWeek);
    if (top30) analyze('pre-draft (top-30)', top30);
  });
});
