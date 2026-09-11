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
  return collectEngineImportsFromText(readFileSync(file, 'utf-8'), relative(SRC_ROOT, file).split(sep).join('/'));
}

/** The parser proper, over text, so it can be unit-tested on synthetic cases. */
function collectEngineImportsFromText(text: string, rel: string): EngineImport[] {
  const found: EngineImport[] = [];

  const lineOf = (index: number): number => text.slice(0, index).split('\n').length;
  const record = (specifier: string, typeOnly: boolean, index: number): void => {
    if (!specifier.startsWith('@gmsim/engine')) return;
    found.push({ file: rel, specifier, typeOnly, line: lineOf(index) });
  };

  // Statement-anchored scan. An earlier version used one lazy regex spanning
  // from an `import`/`export` keyword to the next `from '...'`, which let the
  // captured `type` modifier belong to a DIFFERENT statement than the captured
  // specifier — wrong in both directions, and both were reproduced:
  //   - `export type Mode = 'a' | 'b';` above a runtime
  //     `import { Player } from '@gmsim/engine/types';` read as type-only, so a
  //     real ground-truth import passed the gate.
  //   - a bare `import './index.css';` above a legal `import type { ... } from
  //     '@gmsim/engine/types';` read as runtime, failing compliant code.
  // Statements are therefore isolated FIRST (keyword → terminating semicolon),
  // and the modifier is read from the statement that owns it.
  const statementStart = /^[ \t]*(?:import|export)\b/gm;
  for (let m = statementStart.exec(text); m !== null; m = statementStart.exec(text)) {
    const start = m.index;
    const semi = text.indexOf(';', start);
    const newline = text.indexOf('\n', start);
    // Prefer the semicolon (multi-line imports are normal); fall back to the
    // line end when a statement is unterminated.
    const end = semi === -1 ? (newline === -1 ? text.length : newline) : semi;
    const stmt = text.slice(start, end);

    const typeOnly = /^[ \t]*(?:import|export)\s+type\b/.test(stmt);

    const fromMatch = /\bfrom\s*['"]([^'"]+)['"]/.exec(stmt);
    if (fromMatch) {
      record(fromMatch[1] ?? '', typeOnly, start);
      continue;
    }
    // Bare side-effect import: `import 'x';` (no `from`). Never type-only.
    const bareMatch = /^[ \t]*import\s*['"]([^'"]+)['"]/.exec(stmt);
    if (bareMatch) record(bareMatch[1] ?? '', false, start);
  }

  // Dynamic `import('x')` — a runtime load, never type-only. Scanned separately
  // because it can appear anywhere in an expression, not at a statement head.
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

/**
 * The parser's own gates. A boundary check is only as good as its ability to
 * tell a type-only import from a runtime one, and the first implementation
 * could not: a single lazy regex spanning statements attached the `type`
 * modifier to whichever statement happened to precede the specifier. Both
 * directions of that failure are pinned here, because both are silent — one
 * waves a real leak through, the other fails compliant code.
 */
describe('engine-import parser (the gate must actually be able to bite)', () => {
  const scan = (text: string) => collectEngineImportsFromText(text, 'synthetic.ts');

  it('does not let a preceding `export type` alias disguise a runtime import', () => {
    const src = ["export type Mode = 'a' | 'b';", "import { Player } from '@gmsim/engine/types';", ''].join('\n');
    const [found] = scan(src);
    expect(found?.specifier).toBe('@gmsim/engine/types');
    expect(found?.typeOnly, 'a runtime import of /types must NOT read as type-only').toBe(false);
  });

  it('does not let a preceding bare import make a real `import type` look runtime', () => {
    const src = ["import './index.css';", "import type { LeagueState } from '@gmsim/engine/types';", ''].join('\n');
    const engineImports = scan(src);
    expect(engineImports).toHaveLength(1);
    expect(engineImports[0]?.typeOnly, 'a genuine `import type` must read as type-only').toBe(true);
  });

  it('handles multi-line import statements', () => {
    const src = ['import type {', '  LeagueView,', '  RosterView,', "} from '@gmsim/engine/knowledge';", ''].join('\n');
    const [found] = scan(src);
    expect(found?.specifier).toBe('@gmsim/engine/knowledge');
    expect(found?.typeOnly).toBe(true);
  });

  it('catches dynamic imports and re-exports', () => {
    const src = [
      "const m = await import('@gmsim/engine/season');",
      "export { leagueView } from '@gmsim/engine/knowledge';",
      '',
    ].join('\n');
    const specs = scan(src).map((i) => i.specifier);
    expect(specs).toContain('@gmsim/engine/season');
    expect(specs).toContain('@gmsim/engine/knowledge');
  });
});
