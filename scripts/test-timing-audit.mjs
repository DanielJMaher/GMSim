#!/usr/bin/env node
/**
 * Test-timing audit (gate-optimization pass, 2026-07-04).
 *
 * The full gate was silently hostage to single files for weeks (mood.test.ts
 * grew to 42 CI minutes and BOUNDED the whole pipeline). This audit makes
 * test-time growth visible the way ci-green made timeouts visible:
 *
 *   1. Run vitest with a JSON report:
 *        pnpm --filter @gmsim/engine exec vitest run --reporter=default \
 *          --reporter=json --outputFile=vitest-report.json
 *   2. Audit against the checked-in baseline:
 *        node scripts/test-timing-audit.mjs vitest-report*.json
 *   3. Refresh the baseline DELIBERATELY (after an accepted slowdown or an
 *      optimization pass):
 *        node scripts/test-timing-audit.mjs --write-baseline vitest-report*.json
 *
 * Warns (exit 0, `::warning::` annotations on CI, nonzero only with
 * --strict) when a FILE, a MODULE (top-level dir under src/), or the SUITE
 * TOTAL grows beyond WARN_RATIO × baseline. Files under the absolute floor
 * are ignored — a 6 ms file jittering to 9 ms is not a regression signal.
 *
 * Baselines are stored per environment (`ci` vs `local` — detected via
 * env.CI) in scripts/test-timings.baseline.json; the two aren't comparable
 * hardware. Timings on shared runners are noisy: the 25% threshold is
 * Daniel's spec (2026-07-04); the floor keeps it honest.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WARN_RATIO = 1.25; // +25% over baseline
const FILE_FLOOR_MS = 5_000; // ignore sub-5s files (pure jitter)

const here = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = resolve(here, 'test-timings.baseline.json');

const args = process.argv.slice(2);
const writeBaseline = args.includes('--write-baseline');
const strict = args.includes('--strict');
const inputs = args.filter((a) => !a.startsWith('--'));
if (inputs.length === 0) {
  console.error('usage: test-timing-audit.mjs [--write-baseline] [--strict] <vitest-report.json ...>');
  process.exit(2);
}

const env = process.env.CI ? 'ci' : 'local';

// ── Collect per-file durations from vitest JSON report(s) ─────────────────
const fileMs = new Map();
for (const input of inputs) {
  const report = JSON.parse(readFileSync(input, 'utf8'));
  for (const tr of report.testResults ?? []) {
    // Normalize to a repo-relative posix path so baselines are portable.
    const name = String(tr.name).replace(/\\/g, '/');
    const rel = name.includes('/src/') ? `src/${name.split('/src/').pop()}` : name;
    const ms = Math.max(0, (tr.endTime ?? 0) - (tr.startTime ?? 0));
    fileMs.set(rel, (fileMs.get(rel) ?? 0) + ms);
  }
}
if (fileMs.size === 0) {
  console.error('no testResults found in the given report(s)');
  process.exit(2);
}

const moduleOf = (file) => {
  const m = file.match(/^src\/([^/]+)\//);
  return m ? m[1] : '(root)';
};
const moduleMs = new Map();
let totalMs = 0;
for (const [file, ms] of fileMs) {
  moduleMs.set(moduleOf(file), (moduleMs.get(moduleOf(file)) ?? 0) + ms);
  totalMs += ms;
}

const fmt = (ms) => (ms >= 60_000 ? `${(ms / 60_000).toFixed(1)}m` : `${(ms / 1000).toFixed(1)}s`);

// ── Report ─────────────────────────────────────────────────────────────────
console.log(`\n=== Test-timing audit (${env}) — ${fileMs.size} files, total ${fmt(totalMs)} ===`);
console.log('\nslowest files:');
for (const [file, ms] of [...fileMs].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`  ${fmt(ms).padStart(7)}  ${file}`);
}
console.log('\nby module:');
for (const [mod, ms] of [...moduleMs].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${fmt(ms).padStart(7)}  ${mod}`);
}

// ── Baseline write / compare ───────────────────────────────────────────────
const baselines = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : {};

if (writeBaseline) {
  baselines[env] = {
    capturedAt: new Date().toISOString().slice(0, 10),
    totalMs: Math.round(totalMs),
    files: Object.fromEntries([...fileMs].sort().map(([f, ms]) => [f, Math.round(ms)])),
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(baselines, null, 2) + '\n', 'utf8');
  console.log(`\nbaseline (${env}) written: ${BASELINE_PATH}`);
  process.exit(0);
}

const baseline = baselines[env];
if (!baseline) {
  console.log(`\nno ${env} baseline yet — run with --write-baseline to capture one. Not warning.`);
  process.exit(0);
}

const warnings = [];
for (const [file, ms] of fileMs) {
  const base = baseline.files[file];
  if (base === undefined) {
    if (ms > FILE_FLOOR_MS) warnings.push(`NEW heavy file (no baseline): ${file} at ${fmt(ms)}`);
    continue;
  }
  if (ms > FILE_FLOOR_MS && ms > base * WARN_RATIO) {
    warnings.push(`${file}: ${fmt(ms)} vs baseline ${fmt(base)} (+${Math.round((ms / base - 1) * 100)}%)`);
  }
}
// Module + total growth (catches many-small-regressions that no single file trips).
const baseModuleMs = new Map();
for (const [f, ms] of Object.entries(baseline.files)) {
  baseModuleMs.set(moduleOf(f), (baseModuleMs.get(moduleOf(f)) ?? 0) + ms);
}
for (const [mod, ms] of moduleMs) {
  const base = baseModuleMs.get(mod);
  if (base && ms > FILE_FLOOR_MS && ms > base * WARN_RATIO) {
    warnings.push(`module ${mod}: ${fmt(ms)} vs baseline ${fmt(base)} (+${Math.round((ms / base - 1) * 100)}%)`);
  }
}
if (totalMs > baseline.totalMs * WARN_RATIO) {
  warnings.push(`SUITE TOTAL: ${fmt(totalMs)} vs baseline ${fmt(baseline.totalMs)} (+${Math.round((totalMs / baseline.totalMs - 1) * 100)}%)`);
}

if (warnings.length > 0) {
  console.log(`\n⚠ ${warnings.length} timing warning(s) — grew >25% over the ${env} baseline (${baseline.capturedAt}):`);
  for (const w of warnings) {
    console.log(`  ⚠ ${w}`);
    // GitHub Actions annotation — shows on the run summary without going red.
    if (process.env.CI) console.log(`::warning title=test-timing regression::${w}`);
  }
  console.log('\nIf the growth is intentional (new gates), refresh with --write-baseline.');
  if (strict) process.exit(1);
} else {
  console.log(`\n✓ all files, modules, and the suite total within +25% of the ${env} baseline (${baseline.capturedAt}).`);
}
