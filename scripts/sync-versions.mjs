#!/usr/bin/env node
/**
 * Sync the version field across the root package.json and all workspace
 * packages. Run via `pnpm version:sync <new-version>`.
 *
 * Usage:
 *   pnpm version:sync 0.2.0
 *   pnpm version:sync         # show current version, no changes
 *
 * Validates against the SemVer 2.0 grammar (subset: MAJOR.MINOR.PATCH with
 * optional pre-release and build metadata).
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function findPackageJsons() {
  const found = [join(repoRoot, 'package.json')];
  for (const dir of ['packages', 'apps']) {
    const root = join(repoRoot, dir);
    let entries;
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const candidate = join(root, entry, 'package.json');
      try {
        if (statSync(candidate).isFile()) found.push(candidate);
      } catch {
        // not a package dir; skip
      }
    }
  }
  return found;
}

function main() {
  const arg = process.argv[2];
  const packageJsons = findPackageJsons();

  if (!arg) {
    console.log('Current versions:');
    for (const path of packageJsons) {
      const pkg = readJson(path);
      const rel = path.replace(repoRoot, '').replace(/^[\\/]/, '');
      console.log(`  ${pkg.version}  ${rel}`);
    }
    return;
  }

  const next = arg.replace(/^v/, '');
  if (!SEMVER.test(next)) {
    console.error(`Not a valid SemVer 2.0 version: ${arg}`);
    process.exit(1);
  }

  for (const path of packageJsons) {
    const pkg = readJson(path);
    const rel = path.replace(repoRoot, '').replace(/^[\\/]/, '');
    if (pkg.version === next) {
      console.log(`= ${rel} already at ${next}`);
      continue;
    }
    const prev = pkg.version;
    pkg.version = next;
    writeJson(path, pkg);
    console.log(`✓ ${rel}: ${prev} → ${next}`);
  }

  console.log(`\nDon't forget to:`);
  console.log(`  1. Move CHANGELOG.md [Unreleased] entries into a new [${next}] section`);
  console.log(`  2. git commit -m "chore(release): v${next}"`);
  console.log(`  3. git tag v${next}`);
}

main();
