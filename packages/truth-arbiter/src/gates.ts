import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * `run gates` — the pre-push drift sweep.
 *
 * Runs every data-agent guardrail in one pass (quick modes by default) and
 * prints a single scoreboard: agent, runtime, and how many `<-- DRIFT`-style
 * markers its report raised. The point is to make "did anything drift?" a
 * routine one-command check before pushing a batch, instead of a remembered
 * per-agent ritual.
 *
 *   pnpm --filter @gmsim/truth-arbiter run gates          # quick modes
 *   pnpm --filter @gmsim/truth-arbiter run gates full     # heavier sims
 *
 * Flags are WARNINGS, not failures — several reports carry known residuals
 * (e.g. the Liquidator's compressed QB top pending cap-aware generation).
 * The exit code is non-zero only when an agent itself errors, so this can
 * sit in a script chain without false-failing on a known residual.
 */

const here = dirname(fileURLToPath(import.meta.url));

interface Gate {
  name: string;
  /** Entry point under dist/, relative to this file's compiled location. */
  entry: string;
  quickArgs: string[];
  fullArgs: string[];
  /** What the gate verifies — printed in the scoreboard. */
  checks: string;
}

const GATES: readonly Gate[] = [
  {
    name: 'class-talent',
    entry: 'draft-model/class-talent.js',
    quickArgs: ['gates-a'],
    fullArgs: ['gates-a,gates-b,gates-c'],
    checks: 'prospect-class talent pyramid + position mix vs NMDD',
  },
  {
    name: 'adjudicate',
    entry: 'sim/skill-adjudicator.js',
    quickArgs: ['sim', '2'],
    fullArgs: ['sim', '4'],
    checks: '8-tier distribution + accolade rates + 99-scarcity + RAS',
  },
  {
    name: 'magistrate',
    entry: 'sim/magistrate.js',
    quickArgs: ['sim', '200'],
    fullArgs: ['sim', '400'],
    checks: 'drive-level realism vs the 2015-2024 nflverse bar',
  },
  {
    name: 'liquidator',
    entry: 'cap/liquidator.js',
    quickArgs: [],
    fullArgs: [],
    checks: 'seed contract cap structure vs real OTC market',
  },
  {
    name: 'ombudsman',
    entry: 'media/ombudsman.js',
    quickArgs: [],
    fullArgs: [],
    checks: 'media rank-spread gradient vs real NFLDraftBuzz spread',
  },
  {
    name: 'actuary',
    entry: 'sim/actuary.js',
    quickArgs: ['sim', '8'],
    fullArgs: ['sim', '12', 'actuary-sim-1,actuary-sim-2'],
    checks: 'per-position aging curves + entry ages vs the 2003-2024 real bar',
  },
  {
    name: 'headhunter',
    entry: 'sim/headhunter.js',
    quickArgs: ['sim', '10'],
    fullArgs: ['sim', '20', 'hh-1,hh-2'],
    checks: 'front-office firing ecology vs the real coach/GM carousel',
  },
];

/** Markers the agents print next to a metric that missed its target. */
const FLAG_PATTERN = /<-- (DRIFT|OFF|TOO MANY|TOO LOOSE|NOT NEGATIVE ENOUGH|SPURIOUSLY LINKED)/g;

interface GateResult {
  gate: Gate;
  status: 'ok' | 'error';
  flags: number;
  seconds: number;
}

function runGate(gate: Gate, full: boolean): GateResult {
  const args = full ? gate.fullArgs : gate.quickArgs;
  const entry = resolve(here, gate.entry);
  console.log(`\n${'='.repeat(72)}`);
  console.log(`GATE: ${gate.name} ${args.join(' ')}  — ${gate.checks}`);
  console.log('='.repeat(72));

  const start = Date.now();
  const res = spawnSync(process.execPath, [entry, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const seconds = (Date.now() - start) / 1000;

  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  // Re-print the agent's own report verbatim — gates adds the scoreboard,
  // it never hides the underlying detail.
  process.stdout.write(out);

  const flags = out.match(FLAG_PATTERN)?.length ?? 0;
  const status: GateResult['status'] = res.status === 0 ? 'ok' : 'error';
  return { gate, status, flags, seconds };
}

function main(): void {
  const full = process.argv[2] === 'full';
  console.log(`run gates — ${full ? 'FULL' : 'quick'} sweep of every data-agent guardrail`);

  const results = GATES.map((g) => runGate(g, full));

  console.log(`\n${'='.repeat(72)}`);
  console.log('GATES SCOREBOARD');
  console.log('='.repeat(72));
  console.log(`  ${'gate'.padEnd(14)} ${'status'.padEnd(8)} ${'flags'.padStart(5)} ${'time'.padStart(8)}  checks`);
  for (const r of results) {
    const time = `${r.seconds.toFixed(0)}s`;
    console.log(
      `  ${r.gate.name.padEnd(14)} ${r.status.padEnd(8)} ${String(r.flags).padStart(5)} ${time.padStart(8)}  ${r.gate.checks}`,
    );
  }
  const errored = results.filter((r) => r.status === 'error');
  const flagged = results.filter((r) => r.flags > 0);
  console.log(
    `\n  ${results.length} gates: ${results.length - errored.length} ran clean of errors, ` +
      `${flagged.length} raised flags (flags are warnings — read the report above).`,
  );
  if (errored.length > 0) {
    console.error(`  ERRORED: ${errored.map((r) => r.gate.name).join(', ')}`);
    process.exit(1);
  }
}

main();
