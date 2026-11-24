// #project-files + #portal-compliance listGateFiles: the gate-source list comes from git inside a
// git work tree and from a pruned walk outside one. This is enforcement code: a faster list that
// silently sees fewer gate files would let an undeclared gate through, so each way git could hide
// a gate file is pinned here (broad ignore patterns, a global excludes file, an enclosing repo,
// git failing), along with the rule that the code scan and the gate-file list cover the same tree.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
  listProjectFiles,
  hasDirSegment,
  toPosixPath,
  describeFileListSource,
  GIT_TIMEOUT_MS,
  PRUNE_DIRS,
} from './project-files.js';
import { listGateFiles, checkPortalCompliance, findGateReferences } from './portal-compliance.js';

let base = '';
let root = '';
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_SYSTEM', 'PATH'];

/** Environment for fixture git commands: no inherited GIT_* state, no developer or system config. */
function fixtureEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('GIT_')) env[k] = v;
  }
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = path.join(base, 'empty-gitconfig');
  return env;
}

function git(cwd: string, args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=', '-c', 'protocol.file.allow=always', ...args],
    { cwd, env: fixtureEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

function write(dir: string, rel: string, content = 'x\n'): void {
  const full = path.join(dir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

/** Is there a scanner for the code scan on this machine? (Windows CI may have neither.) */
function hasCodeScanner(): boolean {
  for (const tool of ['rg', 'grep']) {
    try {
      execFileSync(tool, ['--version'], { stdio: 'ignore' });
      return true;
    } catch {
      // try the next one
    }
  }
  return false;
}

/**
 * The fixture every mode shares. ^root-gate is declared and used; ^api-gate is declared in a
 * .purpose; ^ghost-gate is used and declared NOWHERE, so every mode must report it.
 */
function seed(dir: string): void {
  write(dir, 'portal.yaml', 'version: 1.0.0\ngates:\n  root-gate:\n    description: r\n');
  write(dir, '.purpose', 'components:\n  a:\n    gates: [^root-gate]\n');
  write(dir, 'packages/api/.purpose', 'gates:\n  ^api-gate:\n    description: a\ncomponents:\n  h:\n    gates: [^ghost-gate]\n');
  write(dir, 'packages/api/portal.yaml', 'gates:\n  nested-gate:\n    description: n\n');
  write(dir, 'packages/api/src/index.ts', 'export const a = 1;\n');
  write(dir, 'untracked/.purpose', 'components: {}\n');
  write(dir, 'untracked/portal.yaml', 'gates:\n  untracked-gate:\n    description: u\n');
  // Left out by name in every mode
  write(dir, 'node_modules/dep/.purpose');
  write(dir, 'packages/api/dist/.purpose');
  write(dir, '.paradigm/.purpose');
  write(dir, '.claude/worktrees/agent-1/.purpose');
  write(dir, '.claude/worktrees/agent-1/packages/api/portal.yaml');
  write(dir, '.warpline/states/abc/.purpose');
  write(dir, 'ios/.build/checkouts/dep/.purpose');
  write(dir, '.loom/run/portal.yaml');
}

const EXPECTED = [
  '.purpose',
  'packages/api/.purpose',
  'packages/api/portal.yaml',
  'portal.yaml',
  'untracked/.purpose',
  'untracked/portal.yaml',
];

function relGateFiles(dir: string): string[] {
  return listGateFiles(dir).map((f) => toPosixPath(path.relative(dir, f))).sort();
}

/** Commit everything except untracked/, which stays untracked-but-not-ignored. */
function initRepo(dir: string, ignore: string | null = 'node_modules/\ndist/\n'): void {
  if (ignore !== null) write(dir, '.gitignore', ignore);
  git(dir, ['init', '-q']);
  for (const entry of fs.readdirSync(dir)) {
    if (entry === 'untracked' || entry === '.git') continue;
    git(dir, ['add', '-f', '--', entry]);
  }
  git(dir, ['commit', '-q', '-m', 'seed']);
}

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'project-files-')));
  root = path.join(base, 'project');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(base, 'empty-gitconfig'), '');
  // The code under test runs git with the process environment: keep the developer's global
  // and system git config (a global excludes file, for one) out of every result.
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.GIT_CONFIG_GLOBAL = path.join(base, 'empty-gitconfig');
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  delete process.env.GIT_CONFIG_SYSTEM;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('listProjectFiles / listGateFiles: the two modes', () => {
  it('outside git: a pruned walk finds the gate sources, and says why it walked', () => {
    seed(root);
    const list = listProjectFiles(root);
    expect(list.source).toBe('walk');
    expect(list.fallbackReason).toBe('not-a-git-repo');
    expect(list.files).toContain('packages/api/src/index.ts');
    for (const dir of PRUNE_DIRS) expect(list.files.some((f) => hasDirSegment(f, new Set([dir])))).toBe(false);
    expect(list.files.some((f) => f.startsWith('.claude/worktrees/'))).toBe(false);
    expect(relGateFiles(root)).toEqual(EXPECTED);
  });

  it('inside git: the list comes from git and is the same set as the walk', () => {
    seed(root);
    initRepo(root);
    const list = listProjectFiles(root);
    expect(list.source).toBe('git');
    expect(list.fallbackReason).toBeUndefined();
    // tracked and untracked-but-not-ignored are both listed, with forward slashes
    expect(list.files).toContain('packages/api/src/index.ts');
    expect(list.files).toContain('untracked/.purpose');
    expect(list.files).toContain('untracked/portal.yaml');
    expect(list.files.some((f) => f.includes('\\'))).toBe(false);
    expect(relGateFiles(root)).toEqual(EXPECTED);
  });

  it('inside git: the pruned trees are left out even when they are TRACKED, as in the walk', () => {
    seed(root);
    // .warpline, .build, .loom and .claude/worktrees are committed here (force-added, no ignore line)
    initRepo(root, null);
    expect(git(root, ['ls-files', '.warpline', '.loom', 'ios/.build']).trim()).not.toBe('');
    const list = listProjectFiles(root);
    expect(list.source).toBe('git');
    for (const dir of PRUNE_DIRS) expect(list.files.some((f) => hasDirSegment(f, new Set([dir])))).toBe(false);
    expect(list.files.some((f) => f.startsWith('.claude/worktrees/'))).toBe(false);
    expect(list.files).toContain('packages/api/src/index.ts');
  });

  it('git and walk give the same compliance report, and both block the undeclared gate', async () => {
    seed(root);
    write(root, '.gitignore', 'node_modules/\ndist/\n');
    const before = await checkPortalCompliance(root);
    expect(listProjectFiles(root).source).toBe('walk');
    expect(before.status).toBe('violations');
    expect(before.usedButUndeclared).toEqual(['ghost-gate']);
    initRepo(root);
    expect(listProjectFiles(root).source).toBe('git');
    const after = await checkPortalCompliance(root);
    expect(after).toEqual(before);
  });

  it('inside git: a .purpose or portal.yaml in a gitignored DIRECTORY is not a gate source', () => {
    seed(root);
    write(root, 'local/.purpose', 'gates:\n  ^ignored-gate:\n    description: i\n');
    write(root, 'local/portal.yaml', 'gates:\n  ignored-nested:\n    description: i\n');
    // Before git: the walk counts them
    expect(relGateFiles(root)).toEqual([...EXPECTED, 'local/.purpose', 'local/portal.yaml'].sort());
    initRepo(root, 'node_modules/\ndist/\nlocal/\n');
    // local/ was force-added by initRepo's helper; take it out of the index so it is only ignored
    git(root, ['rm', '-r', '-q', '--cached', 'local']);
    expect(listProjectFiles(root).source).toBe('git');
    expect(relGateFiles(root)).toEqual(EXPECTED);
  });
});

describe('listProjectFiles: ignore rules that would hide gate files (fail closed)', () => {
  /** A project whose own gates are all declared; the only violation is the one each test adds. */
  function cleanProject(ignore: string | null): void {
    write(root, 'portal.yaml', 'version: 1.0.0\ngates:\n  root-gate:\n    description: r\n');
    write(root, 'src/.purpose', 'components:\n  a:\n    gates: [^root-gate]\n');
    write(root, 'src/app.ts', 'export const a = 1;\n');
    initRepo(root, ignore);
  }

  it('".*" in .gitignore: an untracked .purpose with an undeclared gate is still a violation', async () => {
    cleanProject('.*\n');
    expect((await checkPortalCompliance(root)).usedButUndeclared).toEqual([]);
    write(root, 'feature/.purpose', 'components:\n  f:\n    gates: [^sneaky-gate]\n');
    // git itself does not list the new file
    expect(git(root, ['ls-files', '-co', '--exclude-standard'])).not.toContain('feature/.purpose');
    const list = listProjectFiles(root);
    expect(list.source).toBe('walk');
    expect(list.fallbackReason).toBe('gate-files-ignored');
    const report = await checkPortalCompliance(root);
    expect(report.status).toBe('violations');
    expect(report.usedButUndeclared).toEqual(['sneaky-gate']);
  });

  it('"*.yaml" in .gitignore: an untracked portal.yaml with an undeclared gate is still a violation', async () => {
    cleanProject('*.yaml\n');
    write(root, 'services/pay/portal.yaml', 'routes:\n  "POST /pay": [^pay-gate]\n');
    expect(git(root, ['ls-files', '-co', '--exclude-standard'])).not.toContain('services/pay/portal.yaml');
    const list = listProjectFiles(root);
    expect(list.source).toBe('walk');
    expect(list.fallbackReason).toBe('gate-files-ignored');
    const report = await checkPortalCompliance(root);
    expect(report.usedButUndeclared).toEqual(['pay-gate']);
  });

  it('a global excludes file that names .purpose: same', async () => {
    cleanProject('node_modules/\n');
    const excludes = path.join(base, 'global-excludes');
    fs.writeFileSync(excludes, '.purpose\n');
    const config = path.join(base, 'gitconfig-with-excludes');
    fs.writeFileSync(config, `[core]\n\texcludesFile = ${excludes.split('\\').join('/')}\n`);
    process.env.GIT_CONFIG_GLOBAL = config;
    write(root, 'feature/.purpose', 'components:\n  f:\n    gates: [^sneaky-gate]\n');
    const list = listProjectFiles(root);
    expect(list.source).toBe('walk');
    expect(list.fallbackReason).toBe('gate-files-ignored');
    expect((await checkPortalCompliance(root)).usedButUndeclared).toEqual(['sneaky-gate']);
  });

  it('an enclosing repo that ignores the project, with one file force-tracked: same', async () => {
    // root is base/project; base becomes the enclosing repository
    write(root, 'portal.yaml', 'version: 1.0.0\ngates:\n  root-gate:\n    description: r\n');
    write(root, 'kept.txt');
    write(base, '.gitignore', 'project/\n');
    git(base, ['init', '-q']);
    git(base, ['add', '-f', '--', '.gitignore', 'project/kept.txt']);
    git(base, ['commit', '-q', '-m', 'outer']);
    write(root, 'feature/.purpose', 'components:\n  f:\n    gates: [^sneaky-gate]\n');
    // git answers with a non-empty list (the forced file), so "empty list" alone would not catch this
    expect(git(root, ['ls-files', '-co', '--exclude-standard']).trim()).toBe('kept.txt');
    const list = listProjectFiles(root);
    expect(list.source).toBe('walk');
    expect(list.fallbackReason).toBe('gate-files-ignored');
    expect((await checkPortalCompliance(root)).usedButUndeclared).toEqual(['sneaky-gate']);
  });

  it('a project wholly ignored by an enclosing repo (git lists nothing) walks', () => {
    write(root, 'src/.purpose', 'components: {}\n');
    write(base, '.gitignore', 'project/\n');
    git(base, ['init', '-q']);
    const list = listProjectFiles(root);
    expect(list.source).toBe('walk');
    expect(['gate-files-ignored', 'no-files-listed']).toContain(list.fallbackReason);
    expect(list.files).toContain('src/.purpose');
  });
});

describe('listProjectFiles: git failing (fail closed to the walk)', () => {
  it('a corrupt index: git fails, the walk runs and the undeclared gate is still reported', async () => {
    seed(root);
    initRepo(root);
    fs.writeFileSync(path.join(root, '.git', 'index'), 'not an index');
    const list = listProjectFiles(root);
    expect(list.source).toBe('walk');
    expect(list.fallbackReason).toBe('git-failed');
    expect(relGateFiles(root)).toEqual(EXPECTED);
    expect((await checkPortalCompliance(root)).usedButUndeclared).toEqual(['ghost-gate']);
  });

  it('git not on PATH: the walk runs and says git is missing', () => {
    seed(root);
    initRepo(root);
    const emptyBin = path.join(base, 'empty-bin');
    fs.mkdirSync(emptyBin);
    process.env.PATH = emptyBin;
    const list = listProjectFiles(root);
    expect(list.source).toBe('walk');
    expect(list.fallbackReason).toBe('git-missing');
    expect(list.files).toContain('packages/api/.purpose');
  });

  it('git gives up long before the 30 s Stop hook timeout, so the walk still has time', () => {
    expect(GIT_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
  });

  it('describeFileListSource names the source and the reason', () => {
    seed(root);
    expect(describeFileListSource(listProjectFiles(root))).toMatch(/^directory walk \(\d+ files\): not a git repository$/);
    initRepo(root);
    expect(describeFileListSource(listProjectFiles(root))).toMatch(/^git \(\d+ files\)$/);
  });
});

describe('listProjectFiles: what git lists', () => {
  it('a project that is a subdirectory of a larger repo lists its own files, relative to itself', () => {
    write(root, '.purpose', 'components: {}\n');
    write(root, 'src/a.ts', 'export const a = 1;\n');
    write(base, 'other/.purpose', 'components: {}\n');
    write(base, '.gitignore', 'empty-gitconfig\n');
    git(base, ['init', '-q']);
    git(base, ['add', '-A']);
    git(base, ['commit', '-q', '-m', 'outer']);
    write(root, 'new/.purpose', 'components: {}\n');
    const list = listProjectFiles(root);
    expect(list.source).toBe('git');
    expect(list.files).toEqual(['.purpose', 'new/.purpose', 'src/a.ts']);
    expect(list.untrackedCount).toBe(1);
    expect(relGateFiles(root)).toEqual(['.purpose', 'new/.purpose']);
  });

  it('paths with a space and non-ASCII names come through unquoted', () => {
    write(root, 'tracked.txt');
    initRepo(root, 'node_modules/\n');
    write(root, 'with space/.purpose', 'components: {}\n');
    write(root, 'ünï cödé/.purpose', 'components: {}\n');
    write(root, 'tracked dir/naïve file.ts', 'export const n = 1;\n');
    git(root, ['add', '--', 'tracked dir']);
    const list = listProjectFiles(root);
    expect(list.source).toBe('git');
    const files = list.files.map((f) => f.normalize('NFC'));
    expect(files).toContain('with space/.purpose');
    expect(files).toContain('ünï cödé/.purpose'.normalize('NFC'));
    expect(files).toContain('tracked dir/naïve file.ts'.normalize('NFC'));
    expect(relGateFiles(root).map((f) => f.normalize('NFC'))).toEqual(['with space/.purpose', 'ünï cödé/.purpose'.normalize('NFC')].sort());
    // every listed gate file can be read back from disk
    for (const f of listGateFiles(root)) expect(fs.existsSync(f)).toBe(true);
  });

  it('a tracked file deleted from disk is not listed and does not break the compliance check', async () => {
    seed(root);
    initRepo(root);
    fs.rmSync(path.join(root, 'packages', 'api', 'portal.yaml'));
    const list = listProjectFiles(root);
    expect(list.files).not.toContain('packages/api/portal.yaml');
    expect(list.files).toContain('packages/api/.purpose');
    const report = await checkPortalCompliance(root);
    expect(report.properlyDeclared).toContain('root-gate');
    expect(report.usedButUndeclared).toEqual(['ghost-gate']);
  });

  it('sparse-checkout entries (skip-worktree) are listed only when the file is on disk', () => {
    write(root, 'sparse/gone/.purpose', 'components: {}\n');
    write(root, 'sparse/kept/.purpose', 'components: {}\n');
    initRepo(root, 'node_modules/\n');
    git(root, ['update-index', '--skip-worktree', 'sparse/gone/.purpose', 'sparse/kept/.purpose']);
    fs.rmSync(path.join(root, 'sparse', 'gone'), { recursive: true });
    const list = listProjectFiles(root);
    expect(list.source).toBe('git');
    expect(list.files).toContain('sparse/kept/.purpose');
    expect(list.files).not.toContain('sparse/gone/.purpose');
  });

  it('a submodule link is not listed as a file', () => {
    const lib = path.join(base, 'lib');
    write(lib, 'portal.yaml', 'gates:\n  lib-gate:\n    description: l\n');
    git(lib, ['init', '-q']);
    git(lib, ['add', '-A']);
    git(lib, ['commit', '-q', '-m', 'lib']);
    write(root, 'tracked.txt');
    initRepo(root, 'node_modules/\n');
    git(root, ['submodule', 'add', '-q', lib, 'vendor-lib']);
    git(root, ['commit', '-q', '-m', 'sub']);
    expect(fs.existsSync(path.join(root, 'vendor-lib', 'portal.yaml'))).toBe(true);
    const list = listProjectFiles(root);
    expect(list.source).toBe('git');
    expect(list.files).not.toContain('vendor-lib');
    expect(list.files.some((f) => f.startsWith('vendor-lib/'))).toBe(false);
    expect(list.files).toContain('.gitmodules');
  });

  it('hasDirSegment matches directory segments only, never the file name', () => {
    const names = new Set(['dist', '.claude']);
    expect(hasDirSegment('packages/a/dist/x.js', names)).toBe(true);
    expect(hasDirSegment('.claude/worktrees/a/.purpose', names)).toBe(true);
    expect(hasDirSegment('packages/a/dist', names)).toBe(false);
    expect(hasDirSegment('distribution/x.js', names)).toBe(false);
  });
});

describe('the code scan and the gate-file list cover the same tree', () => {
  /**
   * A gate used AND declared inside a tree git does not list (a submodule, a nested repository,
   * a gitignored directory). Its declaration is not read, so its use must not be counted either:
   * otherwise it is "used but undeclared" and blocks every session.
   */
  function projectWithForeignTrees(): void {
    write(root, 'portal.yaml', 'version: 1.0.0\ngates:\n  root-gate:\n    description: r\n');
    write(root, 'src/app.ts', "requireGate('root-gate');\n");
    initRepo(root, 'node_modules/\ngenerated/\n');
    // a real submodule
    const lib = path.join(base, 'lib');
    write(lib, 'portal.yaml', 'gates:\n  lib-gate:\n    description: l\n');
    write(lib, 'src/use.ts', "requireGate('lib-gate');\n");
    git(lib, ['init', '-q']);
    git(lib, ['add', '-A']);
    git(lib, ['commit', '-q', '-m', 'lib']);
    git(root, ['submodule', 'add', '-q', lib, 'vendor-lib']);
    git(root, ['commit', '-q', '-m', 'sub']);
    // an untracked nested repository
    write(root, 'tools/nested/portal.yaml', 'gates:\n  nested-repo-gate:\n    description: n\n');
    write(root, 'tools/nested/check.ts', "checkGate('nested-repo-gate');\n");
    git(path.join(root, 'tools', 'nested'), ['init', '-q']);
    // a gitignored directory
    write(root, 'generated/portal.yaml', 'gates:\n  generated-gate:\n    description: g\n');
    write(root, 'generated/client.ts', "requireGate('generated-gate');\n");
  }

  it('inside git: gates used and declared only in a submodule, nested repo or ignored directory do not block', async () => {
    projectWithForeignTrees();
    expect(listProjectFiles(root).source).toBe('git');
    const report = await checkPortalCompliance(root);
    expect(report.usedButUndeclared).toEqual([]);
    const files = findGateReferences(root).map((r) => toPosixPath(r.file));
    expect(files.some((f) => f.startsWith('vendor-lib/') || f.startsWith('tools/nested/') || f.startsWith('generated/'))).toBe(false);
    if (hasCodeScanner()) {
      // the project's own code is still scanned
      expect(files).toContain('src/app.ts');
      expect(report.properlyDeclared).toEqual(['root-gate']);
    }
  });

  it('inside git: an undeclared gate in the project\'s own tracked code still blocks', async () => {
    projectWithForeignTrees();
    write(root, 'src/admin.ts', "requireGate('admin-gate');\n");
    if (!hasCodeScanner()) return;
    const report = await checkPortalCompliance(root);
    expect(report.status).toBe('violations');
    expect(report.usedButUndeclared).toEqual(['admin-gate']);
  });

  it('outside git: the walk reads those trees on both sides, so they are used and declared', async () => {
    write(root, 'portal.yaml', 'version: 1.0.0\ngates:\n  root-gate:\n    description: r\n');
    write(root, 'src/app.ts', "requireGate('root-gate');\n");
    write(root, 'generated/portal.yaml', 'gates:\n  generated-gate:\n    description: g\n');
    write(root, 'generated/client.ts', "requireGate('generated-gate');\n");
    // code under a pruned tree is on neither side
    write(root, '.loom/run/job.ts', "requireGate('loom-gate');\n");
    expect(listProjectFiles(root).source).toBe('walk');
    const report = await checkPortalCompliance(root);
    expect(report.usedButUndeclared).toEqual([]);
    if (hasCodeScanner()) {
      const gates = findGateReferences(root).map((r) => r.gate);
      expect(gates).toContain('generated-gate');
      expect(gates).not.toContain('loom-gate');
    }
  });
});
