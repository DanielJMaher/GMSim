/**
 * Vitest progress reporter — live test-suite monitor.
 *
 * Renders an updating progress bar with elapsed time, an expected
 * total (from the last run's baseline), and a work-weighted ETA. Two
 * output channels:
 *
 *   1. The terminal (TTY): an in-place bar that updates ~4x/sec.
 *   2. A status file (`.vitest-progress.txt`): the same line, rewritten
 *      synchronously on every tick. This is readable *mid-run* even
 *      when stdout is block-buffered (e.g. when the suite is launched
 *      by a tool/CI rather than an interactive shell) — `cat` or read
 *      it anytime to see where the run is.
 *
 * After each run it writes `.vitest-timings.json` (wall-clock total +
 * per-file durations). The next run reads that baseline to show
 * "expected ~Xm" up front and to weight the ETA by how slow each file
 * historically is (the college-season suites dominate), instead of a
 * naive files-completed/total guess. Both artifacts are gitignored.
 *
 * Usage: `pnpm test:monitor` (engine) or `pnpm test:monitor` (root,
 * which filters to the engine package).
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(HERE, '..');
const BASELINE_PATH = join(PKG_ROOT, '.vitest-timings.json');
const STATUS_PATH = join(PKG_ROOT, '.vitest-progress.txt');

const BAR_WIDTH = 30;
const TICK_MS = 250;

// CR + "clear entire line" (ESC [ 2 K), built without string escapes so
// the source stays unambiguous to edit.
const CR = String.fromCharCode(13);
const CLEAR_LINE = CR + String.fromCharCode(27) + '[2K';
const NL = '\n';

function fmtClock(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function relKey(filepathOrName) {
  if (!filepathOrName) return '?';
  let key = filepathOrName;
  try {
    key = relative(PKG_ROOT, filepathOrName);
  } catch {
    /* keep raw */
  }
  return key.split('\\').join('/');
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function writeStatus(text) {
  try {
    writeFileSync(STATUS_PATH, text);
  } catch {
    /* status file is best-effort */
  }
}

export default class ProgressReporter {
  onInit(ctx) {
    this.ctx = ctx;
    this.start = Date.now();
    this.totalFiles = 0;
    this.lastDone = -1;
    this.baseline = loadBaseline();
    this.expectedMs = this.baseline?.totalDurationMs ?? null;
    this.isTTY = Boolean(process.stdout.isTTY);

    const expected =
      this.expectedMs != null ? `expected ~${fmtClock(this.expectedMs)}` : 'no baseline yet';
    const header = `> Test suite starting — ${expected}`;
    process.stdout.write(header + NL);
    writeStatus(header + NL);

    this.timer = setInterval(() => this.render(false), TICK_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  onPathsCollected(paths = []) {
    this.totalFiles = paths.length;
  }

  currentFiles() {
    if (this.ctx?.state?.getFiles) return this.ctx.state.getFiles();
    return [];
  }

  render(final) {
    const files = this.currentFiles();
    const total = this.totalFiles || files.length || 0;

    let done = 0;
    let doneBaseline = 0;
    const base = this.baseline?.files ?? null;
    for (const f of files) {
      const st = f.result?.state;
      if (st === 'pass' || st === 'fail') {
        done++;
        if (base) doneBaseline += base[relKey(f.filepath ?? f.name)] ?? 0;
      }
    }

    const elapsed = Date.now() - this.start;
    const barFrac = total > 0 ? done / total : 0;
    const filled = Math.max(0, Math.min(BAR_WIDTH, Math.round(barFrac * BAR_WIDTH)));
    const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
    const pct = String(Math.round(barFrac * 100)).padStart(3, ' ');

    const eta = final ? 0 : this.estimateEtaMs(base, doneBaseline, done, total, elapsed);
    const expectedStr = this.expectedMs != null ? ` / ~${fmtClock(this.expectedMs)}` : '';
    const etaStr = !final && eta != null ? ` · ETA ${fmtClock(eta)}` : '';

    const line = `[${bar}] ${pct}% · ${done}/${total} files · ${fmtClock(elapsed)}${expectedStr}${etaStr}`;

    writeStatus(line + (final ? ' · done' + NL : NL));

    if (this.isTTY) {
      process.stdout.write(CLEAR_LINE + line);
      if (final) process.stdout.write(NL);
    } else if (final || done !== this.lastDone) {
      // Non-TTY: one line per file completion (avoids carriage-return
      // spam in piped logs).
      process.stdout.write(line + NL);
    }
    this.lastDone = done;
  }

  estimateEtaMs(base, doneBaseline, done, total, elapsed) {
    if (total > 0 && done >= total) return 0;
    if (base && this.expectedMs != null) {
      const totalBaseline = Object.values(base).reduce((a, b) => a + (b || 0), 0);
      if (totalBaseline > 0) {
        // Work-weighted progress: fraction of historical file-time done.
        const fracWork = Math.min(0.999, doneBaseline / totalBaseline);
        // Anchor the remaining time to the baseline wall-clock total —
        // stable from the very start (no wild early over-extrapolation).
        const baselineRemaining = this.expectedMs * (1 - fracWork);
        // Once there's real signal (>10% of work done), pace-correct by
        // how this run's elapsed compares to the baseline-expected
        // elapsed for the same fraction of work.
        if (fracWork > 0.1) {
          const expectedElapsedSoFar = this.expectedMs * fracWork;
          const pace = expectedElapsedSoFar > 0 ? elapsed / expectedElapsedSoFar : 1;
          return Math.max(0, baselineRemaining * pace);
        }
        return Math.max(0, baselineRemaining);
      }
    }
    // Linear fallback by file count (no baseline yet).
    if (done > 0) return (elapsed / done) * (total - done);
    return this.expectedMs;
  }

  onFinished(files = []) {
    if (this.timer) clearInterval(this.timer);
    this.render(true);

    // Persist this run's timings as the next run's baseline.
    const fileTimings = {};
    for (const f of files) {
      fileTimings[relKey(f.filepath ?? f.name)] = Math.round(f.result?.duration ?? 0);
    }
    const wall = Date.now() - this.start;
    try {
      writeFileSync(
        BASELINE_PATH,
        JSON.stringify(
          { totalDurationMs: wall, files: fileTimings, savedAt: new Date().toISOString() },
          null,
          2,
        ) + NL,
      );
    } catch {
      /* best-effort */
    }

    // Tally leaf tests for a standalone summary (this reporter may run
    // without the default reporter).
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    const failedNames = [];
    const walk = (task, filePath) => {
      if (task.type === 'test' || task.type === 'custom') {
        const st = task.result?.state;
        if (st === 'pass') passed++;
        else if (st === 'fail') {
          failed++;
          failedNames.push(`${relKey(filePath)} > ${task.name}`);
        } else skipped++;
      }
      if (task.tasks) for (const child of task.tasks) walk(child, filePath);
    };
    for (const f of files) {
      const fp = f.filepath ?? f.name;
      if (f.tasks) for (const t of f.tasks) walk(t, fp);
    }

    const mark = failed > 0 ? '✗' : '✓';
    process.stdout.write(
      `${NL}${mark} ${passed} passed · ${failed} failed · ${skipped} skipped · ` +
        `${files.length} files · ${fmtClock(wall)} (baseline saved)${NL}`,
    );
    if (failedNames.length > 0) {
      process.stdout.write(NL + 'Failed:' + NL);
      for (const name of failedNames.slice(0, 25)) process.stdout.write(`  ✗ ${name}${NL}`);
      if (failedNames.length > 25) {
        process.stdout.write(`  …and ${failedNames.length - 25} more${NL}`);
      }
    }
  }
}
