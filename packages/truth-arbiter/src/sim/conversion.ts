import { simulateConversionByGrade, type GradeConversion } from '../lib/engine-bridge.js';

/**
 * Stage-2 payoff check: ELITE→Pro Bowl conversion, top-down vs bottom-up.
 *
 * The bottom-up stat engine lets elite players' production EMERGE from winning
 * their matchups, so an ELITE-graded player should now post elite stats and
 * convert to a Pro Bowl far more often than under the top-down ÷-shares engine
 * (which capped star separation → ELITE→Pro Bowl ~56%). This sims both engines
 * over the same seeds and prints conversion by talent grade side by side.
 *
 *   pnpm --filter @gmsim/truth-arbiter run conversion [years] [seed,seed,...]
 */

function pct(num: number, den: number): string {
  return den > 0 ? `${((num / den) * 100).toFixed(0)}%`.padStart(5) : '   - ';
}

function table(label: string, rows: GradeConversion[]): void {
  console.log(`\n${label}:`);
  console.log(`  ${'grade'.padEnd(14)} ${'n'.padStart(4)} ${'ProBowl'.padStart(9)} ${'All-Pro1'.padStart(9)}`);
  for (const r of rows) {
    console.log(`  ${r.grade.padEnd(14)} ${String(r.n).padStart(4)} ${pct(r.proBowl, r.n).padStart(9)} ${pct(r.allPro1, r.n).padStart(9)}`);
  }
}

async function main(): Promise<void> {
  const years = Number(process.argv[2]) || 3;
  const seeds = (process.argv[3] ?? 'conv-a,conv-b').split(',');
  console.log(`\nForward-simming ${seeds.length} league(s) × ${years} seasons per engine…`);
  console.log(`(seeds: ${seeds.join(', ')})`);

  console.log('\n— top-down (legacy ÷-shares) —');
  const topdown = await simulateConversionByGrade(seeds, years, 'topdown');
  console.log('— bottom-up (matchup-driven drive sim) —');
  const bottomup = await simulateConversionByGrade(seeds, years, 'bottomup');

  table('TOP-DOWN', topdown);
  table('BOTTOM-UP', bottomup);

  const td = topdown.find((r) => r.grade === 'ELITE');
  const bu = bottomup.find((r) => r.grade === 'ELITE');
  const star_td = topdown.find((r) => r.grade === 'STAR');
  const star_bu = bottomup.find((r) => r.grade === 'STAR');
  console.log('\n=== ELITE→Pro Bowl conversion (the Stage-2 lever) ===');
  if (td) console.log(`  top-down : ${pct(td.proBowl, td.n)}  (${td.proBowl}/${td.n})`);
  if (bu) console.log(`  bottom-up: ${pct(bu.proBowl, bu.n)}  (${bu.proBowl}/${bu.n})`);
  console.log('=== STAR→Pro Bowl conversion ===');
  if (star_td) console.log(`  top-down : ${pct(star_td.proBowl, star_td.n)}  (${star_td.proBowl}/${star_td.n})`);
  if (star_bu) console.log(`  bottom-up: ${pct(star_bu.proBowl, star_bu.n)}  (${star_bu.proBowl}/${star_bu.n})`);
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
