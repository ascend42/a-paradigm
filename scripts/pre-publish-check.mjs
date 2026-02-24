#!/usr/bin/env node

/**
 * Pre-publish validation script for Paradigm monorepo.
 *
 * Checks:
 * 1. All packages build successfully
 * 2. Version consistency across related packages
 * 3. CHANGELOG has entries for current versions
 * 4. Plugin hooks.json is valid
 * 5. paradigm doctor passes (if .paradigm/ exists)
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

let failures = 0;
let warnings = 0;

function check(name, fn) {
  process.stdout.write(`  Checking ${name}... `);
  try {
    const result = fn();
    if (result === 'warn') {
      warnings++;
      console.log('\x1b[33m⚠ warning\x1b[0m');
    } else {
      console.log('\x1b[32m✓\x1b[0m');
    }
  } catch (e) {
    failures++;
    console.log(`\x1b[31m✗ ${e.message}\x1b[0m`);
  }
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function exec(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', ...opts });
}

console.log('\n\x1b[34m🔍 Paradigm Pre-Publish Checks\x1b[0m\n');

// ── 1. Build check ──────────────────────────────────────────
console.log('\x1b[36m[Build]\x1b[0m');

check('monorepo builds', () => {
  exec('npm run build', { timeout: 120_000 });
});

// ── 2. Version consistency ──────────────────────────────────
console.log('\n\x1b[36m[Versions]\x1b[0m');

const paradigmPkg = readJson(join(ROOT, 'packages/paradigm/package.json'));
const mcpPkg = readJson(join(ROOT, 'packages/paradigm-mcp/package.json'));

check('paradigm version exists', () => {
  if (!paradigmPkg.version) throw new Error('No version in paradigm package.json');
});

check('paradigm-mcp version exists', () => {
  if (!mcpPkg.version) throw new Error('No version in paradigm-mcp package.json');
});

check('paradigm & paradigm-mcp major.minor match', () => {
  const [pMajor, pMinor] = paradigmPkg.version.split('.');
  const [mMajor, mMinor] = mcpPkg.version.split('.');
  if (pMajor !== mMajor || pMinor !== mMinor) {
    throw new Error(
      `paradigm@${paradigmPkg.version} and paradigm-mcp@${mcpPkg.version} major.minor mismatch`,
    );
  }
});

// ── 3. CHANGELOG entries ────────────────────────────────────
console.log('\n\x1b[36m[Changelog]\x1b[0m');

const changelogPath = join(ROOT, 'CHANGELOG.md');
check('CHANGELOG.md exists', () => {
  if (!existsSync(changelogPath)) throw new Error('CHANGELOG.md not found');
});

if (existsSync(changelogPath)) {
  const changelog = readFileSync(changelogPath, 'utf8');

  check(`CHANGELOG has entry for paradigm@${paradigmPkg.version}`, () => {
    if (!changelog.includes(paradigmPkg.version)) {
      return 'warn';
    }
  });
}

// ── 4. Plugin hooks.json ────────────────────────────────────
console.log('\n\x1b[36m[Plugin]\x1b[0m');

const pluginHooksPath = join(ROOT, 'plugins/paradigm/hooks.json');
check('plugin hooks.json exists', () => {
  if (!existsSync(pluginHooksPath)) throw new Error('plugins/paradigm/hooks.json not found');
});

if (existsSync(pluginHooksPath)) {
  check('plugin hooks.json is valid JSON', () => {
    const hooks = readJson(pluginHooksPath);
    if (!hooks.hooks || typeof hooks.hooks !== 'object') {
      throw new Error('hooks.json missing "hooks" object');
    }
  });
}

// ── 5. paradigm doctor ──────────────────────────────────────
console.log('\n\x1b[36m[Doctor]\x1b[0m');

const paradigmDir = join(ROOT, '.paradigm');
if (existsSync(paradigmDir)) {
  check('paradigm doctor passes', () => {
    try {
      exec('npx paradigm doctor --quiet', { timeout: 30_000 });
    } catch {
      return 'warn';
    }
  });
} else {
  check('paradigm doctor (skipped — no .paradigm/)', () => {
    return 'warn';
  });
}

// ── Summary ─────────────────────────────────────────────────
console.log('');
if (failures > 0) {
  console.log(`\x1b[31m✗ ${failures} check${failures > 1 ? 's' : ''} failed\x1b[0m`);
  if (warnings > 0) {
    console.log(`\x1b[33m⚠ ${warnings} warning${warnings > 1 ? 's' : ''}\x1b[0m`);
  }
  console.log('');
  process.exit(1);
} else if (warnings > 0) {
  console.log(`\x1b[33m⚠ All checks passed with ${warnings} warning${warnings > 1 ? 's' : ''}\x1b[0m\n`);
} else {
  console.log('\x1b[32m✨ All pre-publish checks passed!\x1b[0m\n');
}
