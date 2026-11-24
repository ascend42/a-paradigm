// #project-counts: the numbers `paradigm status` and `paradigm doctor` both print. Each has one
// definition here, so this file pins the definitions: .purpose files come from the shared file
// list (dot-directories included, ignored build output excluded), gates are distinct declared
// gates across portal.yaml files and .purpose, isolated symbols are the live index's, and lore
// entries are the .lore files under entries/.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { findPurposeFiles } from '@a-company/purpose-core';
import { listProjectFiles, toPosixPath } from './project-files.js';
import {
  collectProjectCounts,
  countLoreEntries,
  describeGateCounts,
  listPurposeFiles,
  listPortalFiles,
} from './project-counts.js';
import { runContextAudit } from '../commands/doctor/context-audit.js';
import { repoTraits } from '../commands/doctor/hook-health.js';

let base = '';
let root = '';
const saved: Record<string, string | undefined> = {};

function clearGitEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('GIT_')) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  }
  for (const key of ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM']) {
    if (!(key in saved)) saved[key] = undefined;
  }
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  process.env.GIT_CONFIG_GLOBAL = path.join(base, 'empty-gitconfig');
}

function git(args: string[]): void {
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=', ...args],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

function write(rel: string, content: string | string[]): void {
  const full = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, Array.isArray(content) ? content.join('\n') + '\n' : content);
}

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'project-counts-'));
  root = path.join(base, 'repo');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(base, 'empty-gitconfig'), '');
  clearGitEnv();
  git(['init', '-q']);
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    delete saved[key];
  }
  fs.rmSync(base, { recursive: true, force: true });
});

function fixture(): void {
  write('.gitignore', ['release/', '']);
  write('portal.yaml', [
    'version: "2.0.0"',
    'gates:',
    '  authenticated:',
    '    description: Logged in',
    '    check: session.user != null',
    '    prizes: []',
    '  admin:',
    '    description: Admin',
    '    check: session.user.admin',
    '    prizes: []',
  ]);
  // A package portal.yaml: one new gate, one that repeats the root's
  write('packages/api/portal.yaml', [
    'version: "2.0.0"',
    'gates:',
    '  rate-limited:',
    '    description: Under the limit',
    '    check: limiter.ok',
    '    prizes: []',
    '  authenticated:',
    '    description: Logged in',
    '    check: session.user != null',
    '    prizes: []',
  ]);
  write('src/app/.purpose', [
    'version: "2.0"',
    'components:',
    '  app-shell:',
    '    description: Shell, guarded by ^authenticated and by ^ghost-gate',
    '    gates: [^authenticated, ^file-trust]',
    '  lonely:',
    '    description: Nothing mentions this',
    '  step-only:',
    '    description: Reached through a flow step and nothing else',
    'gates:',
    '  file-trust:',
    '    description: Declared in .purpose only',
    'flows:',
    '  boot:',
    '    description: Boot',
    '    steps:',
    '      - component: "#step-only"',
    '        action: start',
  ]);
  // Tracked, under dot-directories: invisible to a glob without `dot: true`
  write('.github/workflows/.purpose', ['version: "2.0"', 'components:', '  ci-workflow:', '    description: CI']);
  write('.paradigm/agents/.purpose', ['version: "2.0"', 'components:', '  agent-roster:', '    description: Roster']);
  // Ignored build output: a copy that must not be counted or indexed
  write('release/App/.purpose', ['version: "2.0"', 'components:', '  copied:', '    description: copy']);
  // Lore: entries are .lore files in one directory per date; index files are not entries
  write('.paradigm/lore/entries/2026-11-23/L-2026-11-23-001.lore', 'id: L-2026-11-23-001\n');
  write('.paradigm/lore/entries/2026-11-24/L-2026-11-24-001.lore', 'id: L-2026-11-24-001\n');
  write('.paradigm/lore/entries/2026-11-24/L-2026-11-24-002.lore', 'id: L-2026-11-24-002\n');
  // an entry from before the .lore extension
  write('.paradigm/lore/entries/2026-03-01/L-2026-03-01-001.yaml', 'id: L-2026-03-01-001\n');
  write('.paradigm/lore/timeline.yaml', 'entries: []\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'fixture']);
}

describe('collectProjectCounts', () => {
  it('counts .purpose files from the shared list: dot-directories in, ignored output out', async () => {
    fixture();
    const list = listProjectFiles(root);
    expect(list.source).toBe('git');

    expect(listPurposeFiles(list)).toEqual(['.github/workflows/.purpose', '.paradigm/agents/.purpose', 'src/app/.purpose']);
    expect(listPortalFiles(list)).toEqual(['packages/api/portal.yaml', 'portal.yaml']);

    const counts = await collectProjectCounts(root, list);
    expect(counts.purposeFiles).toHaveLength(3);
    // the symbol index read the same three files
    expect(counts.purposeFilesNotIndexed).toEqual([]);
  });

  it('the library finder agrees with the shared list (purpose-core cannot import it)', async () => {
    fixture();
    const fromLibrary = (await findPurposeFiles(root, { respectGitignore: true }))
      .map((abs) => toPosixPath(path.relative(root, abs)))
      .sort();
    expect(fromLibrary).toEqual(listPurposeFiles(listProjectFiles(root)));
  });

  it('counts each declared gate once, across portal.yaml files and .purpose, and no stub', async () => {
    fixture();
    const counts = await collectProjectCounts(root);

    // authenticated (root + package), admin, rate-limited, file-trust. ^ghost-gate is a stub.
    expect(counts.symbols.gate).toBe(4);
    expect(counts.gates).toEqual({ total: 4, inPortal: 3, purposeOnly: 1, portalFiles: 2 });
    expect(describeGateCounts(counts.gates)).toBe('4 declared (3 in 2 portal.yaml files, 1 in .purpose only)');
    expect(counts.undeclaredReferences).toBe(1);
    expect(counts.totalSymbols).toBe(Object.values(counts.symbols).reduce((a, b) => a + b, 0));
  });

  it('isolated symbols: a flow step is a connection; doctor reports the same list', async () => {
    fixture();
    const counts = await collectProjectCounts(root);
    const isolated = counts.isolated.map((s) => s.symbol).sort();

    expect(isolated).toContain('#lonely');
    // reached only through a step of $boot: connected, and so is the flow
    expect(isolated).not.toContain('#step-only');
    expect(isolated).not.toContain('$boot');
    // a stub is an undeclared reference, never an isolate
    expect(isolated).not.toContain('^ghost-gate');

    // doctor's check, run with no scan-index.json on disk, reports the same number
    const results = await runContextAudit(root, { quiet: true });
    const check = results.find((r) => r.check === 'orphaned-symbols')!;
    expect(check.status).toBe('advisory');
    expect(check.message).toContain(`${isolated.length} isolated symbol`);
    expect([...check.details!].sort()).toEqual(isolated);
  });

  it("doctor's hook trait counts the same .purpose files", async () => {
    fixture();
    const list = listProjectFiles(root);
    const traits = repoTraits(root, 4, list);
    expect(traits.purposeCount).toBe(listPurposeFiles(list).length);
  });
});

describe('countLoreEntries', () => {
  it('counts entry files under entries/ (.lore and legacy .yaml), not yaml files beside it', () => {
    fixture();
    expect(countLoreEntries(root)).toBe(4);
  });

  it('is 0 for an empty lore directory and null without one', () => {
    expect(countLoreEntries(root)).toBeNull();
    fs.mkdirSync(path.join(root, '.paradigm', 'lore'), { recursive: true });
    expect(countLoreEntries(root)).toBe(0);
  });
});
