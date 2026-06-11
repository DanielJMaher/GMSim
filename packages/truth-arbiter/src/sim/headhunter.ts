import {
  simulateFrontOfficeHistory,
  type FrontOfficeHistory,
} from '../lib/engine-bridge.js';

/**
 * THE HEADHUNTER — the front-office firing/hiring-ecology authority
 * (agent #8, 2026-06-11, Daniel-directed; GM hire/fire design doc §4).
 *
 * Sibling to the Liquidator (cap), Magistrate (drives), Skill Adjudicator
 * (talent tiers), Ombudsman (media spread), Barterer (trades) and Actuary
 * (careers). The Headhunter polices REGIMES: how often coaches and GMs
 * get fired, who survives whom, how long tenures run, and whether the
 * firing ladder reproduces the real-world ecology:
 *
 *   - ~6.5 HC changes/season (20.3% of teams), ~3.5-4.5 GM changes
 *   - a GM survives a given HC firing 75-90% of the time
 *   - ZERO real GMs in years 4-7 of tenure survived their 2nd own-hire's
 *     firing (the hardened §3.3 rule)
 *   - tenures right-skewed: new-HC mean ~3.2yrs, GM median ~3 active
 *     with a lifer tail
 *   - HC firing-season win% ~.330-.420; 9+ win firings exist but <5%
 *
 * Usage:
 *   pnpm --filter @gmsim/truth-arbiter run headhunter            # 1 seed × 12 seasons
 *   pnpm --filter @gmsim/truth-arbiter run headhunter sim 20     # 1 seed × 20
 *   pnpm --filter @gmsim/truth-arbiter run headhunter sim 25 hh-1,hh-2
 *
 * Joins `run gates` (quick: 1×10; full: 2×20). Flags print `<-- DRIFT`
 * markers the gates scoreboard counts.
 */

interface Check {
  label: string;
  value: string;
  ok: boolean;
  target: string;
}

function pct(n: number, d: number): number {
  return d > 0 ? n / d : 0;
}

function mean(xs: readonly number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function fmt(v: number, digits = 2): string {
  return v.toFixed(digits);
}

function merge(histories: FrontOfficeHistory[]): FrontOfficeHistory {
  const out: FrontOfficeHistory = {
    seasons: histories.reduce((n, h) => n + h.seasons, 0),
    hcFired: histories.flatMap((h) => h.hcFired),
    gmFired: histories.flatMap((h) => h.gmFired),
    hcHiredTotal: histories.reduce((n, h) => n + h.hcHiredTotal, 0),
    hcHiredRetreads: histories.reduce((n, h) => n + h.hcHiredRetreads, 0),
    hcHiredFromCoordinators: histories.reduce((n, h) => n + h.hcHiredFromCoordinators, 0),
    hcHiredPromotedInterims: histories.reduce((n, h) => n + h.hcHiredPromotedInterims, 0),
    gmHiredTotal: histories.reduce((n, h) => n + h.gmHiredTotal, 0),
    gmHiredRetreads: histories.reduce((n, h) => n + h.gmHiredRetreads, 0),
    completedHcStints: histories.flatMap((h) => h.completedHcStints),
    activeGmTenures: histories.flatMap((h) => h.activeGmTenures),
    maxGmTenure: Math.max(...histories.map((h) => h.maxGmTenure)),
  };
  return out;
}

/**
 * The §3.3 dead-zone check: of HC firings where the coach was the GM's
 * 2nd+ own hire AND the GM was in years 4-7, how many GMs (a) survived
 * the cycle and (b) actually kept the job into a third coach (no
 * gm-fired for that team within the following season)?
 */
function deadZone(h: FrontOfficeHistory): {
  n: number;
  joint: number;
  survivedCycle: number;
  keptJob: number;
} {
  const events = h.hcFired.filter(
    (e) => e.ownHireIndex >= 2 && e.gmTenureSeasons >= 4 && e.gmTenureSeasons <= 7,
  );
  let joint = 0;
  let survived = 0;
  let kept = 0;
  for (const e of events) {
    if (e.jointWithGm) {
      joint++;
      continue;
    }
    survived++;
    const firedLater = h.gmFired.some(
      (g) => g.teamId === e.teamId && g.seasonNumber > e.seasonNumber && g.seasonNumber <= e.seasonNumber + 1,
    );
    if (!firedLater) kept++;
  }
  return { n: events.length, joint, survivedCycle: survived, keptJob: kept };
}

function report(h: FrontOfficeHistory): void {
  const S = h.seasons;
  const checks: Check[] = [];
  const add = (label: string, value: string, ok: boolean, target: string): void => {
    checks.push({ label, value, ok, target });
  };

  const hcPerSeason = h.hcFired.length / S;
  add('HC changes / season', fmt(hcPerSeason), hcPerSeason >= 5.5 && hcPerSeason <= 7.5, '5.5-7.5');

  // Real ~3.5-4.5 includes resignations/poaching, which still don't
  // exist (S2 added in-season firings; the floor tightened 2.2 → 2.7).
  const gmPerSeason = h.gmFired.length / S;
  add(
    'GM changes / season',
    fmt(gmPerSeason),
    gmPerSeason >= 2.7 && gmPerSeason <= 5.0,
    '3.0-5.0 (S2 floor 2.7 — resignations still unmodeled)',
  );

  const hcInSeason = h.hcFired.filter((e) => e.inSeason).length / S;
  add('HC in-season firings / season', fmt(hcInSeason), hcInSeason >= 0.7 && hcInSeason <= 3.0, '1-3 (real: Saleh/Rhule/Reich/Daboll-style collapses)');

  const gmInSeason = h.gmFired.filter((e) => e.inSeason).length / S;
  add('GM in-season firings / season', fmt(gmInSeason), gmInSeason <= 1.5, '~0-1 (Grier/Douglas/Robinson pattern)');

  const jointPerSeason = h.hcFired.filter((e) => e.jointWithGm).length / S;
  add('Joint clean-houses / season', fmt(jointPerSeason), jointPerSeason >= 0.5 && jointPerSeason <= 2.0, '0.5-2.0');

  const gmSurvival = 1 - pct(h.hcFired.filter((e) => e.jointWithGm).length, h.hcFired.length);
  add('GM survives a given HC firing', `${fmt(gmSurvival * 100, 1)}%`, gmSurvival >= 0.7 && gmSurvival <= 0.92, '75-90%');

  const oneAndDone = h.hcFired.filter((e) => e.seasonsServed === 1).length / S;
  add('One-and-done HCs / season', fmt(oneAndDone), oneAndDone <= 1.5, '<=1.5');

  // NOTE: this is mean tenure AT FIRING, not the "new hire lasts ~3.2
  // years" stat (that one is biased toward short stints — long-tenured
  // coaches generate fewer hires). At real ~20% annual turnover the
  // equilibrium mean completed tenure is 1/0.203 ≈ 4.9 years.
  const meanStint = mean(h.completedHcStints);
  add('Mean completed HC stint (yrs)', fmt(meanStint, 1), meanStint >= 3.5 && meanStint <= 6.0, '~4.9 equilibrium (3.5-6.0)');

  // Cold-start note: every league starts with 32 founding regimes at
  // tenure 0, so short runs inflate the active-tenure median relative
  // to the real churn-equilibrium ~3. Tight bound only at 20+ seasons.
  const medGm = median(h.activeGmTenures);
  const medGmCap = S >= 20 ? 6.5 : 9;
  add(
    `Median active-GM tenure (yrs)${S < 20 ? ' [cold-start]' : ''}`,
    fmt(medGm, 1),
    medGm >= 2.5 && medGm <= medGmCap,
    `3-5 (loose 2.5-${medGmCap})`,
  );

  const liferOk = h.maxGmTenure >= Math.min(10, Math.max(6, Math.floor(S * 0.66)));
  add('Lifer tail: longest GM tenure', `${h.maxGmTenure} yrs`, liferOk, `>=${Math.min(10, Math.max(6, Math.floor(S * 0.66)))} over ${S} seasons`);

  const winPcts = h.hcFired
    .map((e) => e.winPctFiringSeason)
    .filter((v): v is number => v !== null);
  const meanWinPct = mean(winPcts);
  add('Mean win% in HC firing season', `.${String(Math.round(meanWinPct * 1000)).padStart(3, '0')}`, meanWinPct >= 0.3 && meanWinPct <= 0.43, '.330-.420');

  const nineWin = winPcts.filter((v) => v >= 9 / 17).length;
  const nineWinRate = pct(nineWin, winPcts.length);
  add('Firings of 9+ win coaches', `${fmt(nineWinRate * 100, 1)}% (${nineWin})`, nineWinRate < 0.08, '<5% (loose <8%)');

  // S4: the HC pipeline source mix. Real new-HC hires skew heavily
  // toward coordinators off good units (~50-65%), with former HCs
  // (retreads) ~25-35% and true outsiders rare.
  const coordShare = pct(h.hcHiredFromCoordinators, h.hcHiredTotal);
  add(
    'HC hires from the coordinator pipeline',
    `${fmt(coordShare * 100, 1)}%`,
    coordShare >= 0.35 && coordShare <= 0.7,
    '~50-65% (loose 35-70%)',
  );
  const retreadShare = pct(h.hcHiredRetreads, h.hcHiredTotal);
  add(
    'HC hires who are retread former HCs',
    `${fmt(retreadShare * 100, 1)}%`,
    retreadShare >= 0.12 && retreadShare <= 0.45,
    '~25-35% (loose 12-45%)',
  );

  const dz = deadZone(h);
  const dzKeptRate = pct(dz.keptJob, dz.n);
  add(
    '2nd-own-hire firing, GM yrs 4-7: GM keeps job',
    `${dz.keptJob}/${dz.n} (${fmt(dzKeptRate * 100, 1)}%) [joint ${dz.joint}, lame-duck survivors ${dz.survivedCycle - dz.keptJob}]`,
    dz.n < 8 || dzKeptRate <= 0.1,
    '~0 (<=10%, real-world: zero)',
  );

  // ── print ──
  console.log('\nTHE HEADHUNTER — front-office firing ecology vs the real carousel');
  console.log(`pooled: ${S} seasons | ${h.hcFired.length} HC firings | ${h.gmFired.length} GM firings\n`);

  const w = Math.max(...checks.map((c) => c.label.length));
  for (const c of checks) {
    const flag = c.ok ? '' : '   <-- DRIFT';
    console.log(`  ${c.label.padEnd(w)}  ${c.value.padEnd(28)} target ${c.target}${flag}`);
  }

  console.log('\n  context:');
  console.log(
    `    HC hires: ${h.hcHiredTotal} (${h.hcHiredFromCoordinators} coordinator, ${h.hcHiredRetreads} retread, ${h.hcHiredPromotedInterims} promoted interim)   GM hires: ${h.gmHiredTotal} (${fmt(pct(h.gmHiredRetreads, h.gmHiredTotal) * 100, 0)}% retreads | real ~12%)`,
  );
  const tenureBuckets = [0, 0, 0, 0];
  for (const e of h.hcFired) {
    if (e.seasonsServed <= 1) tenureBuckets[0]!++;
    else if (e.seasonsServed <= 3) tenureBuckets[1]!++;
    else if (e.seasonsServed <= 6) tenureBuckets[2]!++;
    else tenureBuckets[3]!++;
  }
  console.log(
    `    fired-HC tenure mix: yr1 ${tenureBuckets[0]} | yr2-3 ${tenureBuckets[1]} | yr4-6 ${tenureBuckets[2]} | yr7+ ${tenureBuckets[3]}`,
  );
  const inherited = h.hcFired.filter((e) => e.ownHireIndex === 0).length;
  const first = h.hcFired.filter((e) => e.ownHireIndex === 1).length;
  const second = h.hcFired.filter((e) => e.ownHireIndex >= 2).length;
  console.log(`    fired-HC own-hire mix: inherited ${inherited} | own #1 ${first} | own #2+ ${second}`);

  const flagged = checks.filter((c) => !c.ok).length;
  console.log(
    `\n  ${flagged === 0 ? 'ALL CHECKS IN ENVELOPE' : `${flagged} check(s) outside envelope`}\n`,
  );
}

async function main(): Promise<void> {
  // args: [sim] [years] [seeds]  — `sim` keyword optional for gates symmetry.
  const args = process.argv.slice(2).filter((a) => a !== 'sim');
  const years = args[0] ? Number(args[0]) : 12;
  const seeds = (args[1] ?? 'headhunter-1').split(',');

  console.log(`THE HEADHUNTER — simulating ${seeds.length} league(s) × ${years} seasons…`);
  const histories: FrontOfficeHistory[] = [];
  for (const seed of seeds) {
    const t = Date.now();
    histories.push(await simulateFrontOfficeHistory(seed, years));
    console.log(`  ${seed}: ${years} seasons in ${((Date.now() - t) / 1000).toFixed(0)}s`);
  }
  report(merge(histories));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
