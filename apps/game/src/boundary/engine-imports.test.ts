/**
 * The knowledge-boundary gate for `apps/game`.
 *
 * CLAUDE.md invariant #3 and `docs/NORTH_STAR.md` say a *game* UI never reads
 * engine ground truth. `GAME_UI_FOUNDATION.md` D1 (APPROVED) makes that
 * mechanically checkable rather than a matter of discipline: game code may
 * import `@gmsim/engine/knowledge` and — type-only — `@gmsim/engine/types`,
 * and nothing else from the engine.
 *
 * This is the "lint or grep-based test that fails on any other engine
 * subpath" the W4 work order requires from commit one. It exists BEFORE the
 * screens do on purpose: the boundary is one of the three things
 * GAME_UI_FOUNDATION.md §1 names as expensive to rework later, so it gets
 * enforced while the app is still empty and compliance is free.
 *
 * Why a source-scanning test and not an ESLint rule: ESLint is not wired up
 * in this repo at all (`pnpm lint` is a placeholder). A vitest file runs under
 * the existing `pnpm test` with zero new tooling.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Import specifiers the game is allowed to reach the engine through. */
const VALUE_ALLOWED = '@gmsim/engine/knowledge';
const TYPE_ONLY_ALLOWED = '@gmsim/engine/types';

interface EngineImport {
  readonly file: string;
  readonly specifier: string;
  readonly typeOnly: boolean;
  readonly line: number;
}

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Every `import`/`export ... from '<spec>'`, bare side-effect `import
 * '<spec>'`, and dynamic `import('<spec>')` that names an `@gmsim/engine`
 * path, with whether the statement was `import type` / `export type`.
 */
function collectEngineImports(file: string): EngineImport[] {
  const text = readFileSync(file, 'utf-8');
  const rel = relative(SRC_ROOT, file).split(sep).join('/');
  const found: EngineImport[] = [];

  const lineOf = (index: number): number => text.slice(0, index).split('\n').length;
  const record = (specifier: string, typeOnly: boolean, index: number): void => {
    if (!specifier.startsWith('@gmsim/engine')) return;
    found.push({ file: rel, specifier, typeOnly, line: lineOf(index) });
  };

  // `import ... from 'x'` / `export ... from 'x'`, capturing a leading `type`.
  const fromRe = /\b(import|export)\s+(type\s+)?[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g;
  for (let m = fromRe.exec(text); m !== null; m = fromRe.exec(text)) {
    record(m[3] ?? '', Boolean(m[2]), m.index);
  }

  // Bare side-effect import: `import 'x';` (no `from`).
  const bareRe = /\bimport\s*['"]([^'"]+)['"]/g;
  for (let m = bareRe.exec(text); m !== null; m = bareRe.exec(text)) {
    record(m[1] ?? '', false, m.index);
  }

  // Dynamic `import('x')` — a runtime load, never type-only.
  const dynamicRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (let m = dynamicRe.exec(text); m !== null; m = dynamicRe.exec(text)) {
    record(m[1] ?? '', false, m.index);
  }

  return found;
}

describe('apps/game engine-import boundary', () => {
  const files = collectSourceFiles(SRC_ROOT).filter((f) => !f.endsWith('engine-imports.test.ts'));
  const imports = files.flatMap(collectEngineImports);

  it('finds source files to scan (the gate cannot silently pass on an empty tree)', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('imports the engine only through @gmsim/engine/knowledge or /types', () => {
    const illegal = imports.filter(
      (i) => i.specifier !== VALUE_ALLOWED && i.specifier !== TYPE_ONLY_ALLOWED,
    );
    expect(
      illegal.map((i) => `${i.file}:${i.line} imports '${i.specifier}'`),
      'Game code may reach the engine ONLY through @gmsim/engine/knowledge ' +
        '(values) and @gmsim/engine/types (type-only). A surface that needs ' +
        'more EXTENDS the knowledge module — it never imports around it ' +
        '(CLAUDE.md invariant #3, GAME_UI_FOUNDATION.md D1).',
    ).toEqual([]);
  });

  it('imports @gmsim/engine/types as `import type` only', () => {
    const runtimeTypeImports = imports.filter(
      (i) => i.specifier === TYPE_ONLY_ALLOWED && !i.typeOnly,
    );
    expect(
      runtimeTypeImports.map((i) => `${i.file}:${i.line}`),
      '@gmsim/engine/types is a type-only surface for the game: it exists so ' +
        'views can be typed, not so ground-truth shapes can be constructed. ' +
        'Use `import type { ... }` (also the repo-wide rule under ' +
        'verbatimModuleSyntax).',
    ).toEqual([]);
  });
});
