#!/usr/bin/env node
// Copies the root README.md (the single source, TD-2026-10-22-220) into
// packages/paradigm/README.md so npm shows the same page as GitHub.
// Relative links are rewritten to absolute github.com URLs because npmjs.com
// cannot resolve paths inside the repository.
//
//   node scripts/sync-readme.mjs          write the copy (runs at prepack)
//   node scripts/sync-readme.mjs --check  exit 1 if the committed copy drifted
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_BLOB = 'https://github.com/ascend42/a-paradigm/blob/main/';
const here = dirname(fileURLToPath(import.meta.url));
export const ROOT_README = join(here, '..', '..', '..', 'README.md');
export const PACKAGE_README = join(here, '..', 'README.md');

/** Rewrites relative markdown link and image targets to absolute repo URLs. */
export function toNpmReadme(source) {
  return source.replace(/(!?\[[^\]]*\]\()([^)\s]+)(\))/g, (match, open, target, close) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('//')) {
      return match;
    }
    const clean = target.replace(/^\.\//, '').replace(/^\//, '');
    return `${open}${REPO_BLOB}${clean}${close}`;
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const expected = toNpmReadme(readFileSync(ROOT_README, 'utf8'));
  if (process.argv.includes('--check')) {
    const actual = readFileSync(PACKAGE_README, 'utf8');
    if (actual !== expected) {
      process.stderr.write('packages/paradigm/README.md differs from the root README.md. Run: node scripts/sync-readme.mjs\n');
      process.exit(1);
    }
  } else {
    writeFileSync(PACKAGE_README, expected);
  }
}
