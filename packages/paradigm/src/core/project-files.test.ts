// #project-files + #portal-compliance listGateFiles: the gate-source list comes from git inside a
// git work tree and from a pruned walk outside one. Both must give the same set for files that are
// tracked or untracked-but-not-ignored; a gitignored file is a gate source only outside git.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { listProjectFiles, hasDirSegment, toPosixPath } from './project-files.js';
import { listGateFiles, checkPortalCompliance } from './portal-compliance.js';

/** git with every inherited GIT_* variable cleared, so a test run from a git hook stays in its fixture. */
function git(cwd: string, args: string[]): void {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('GIT_')) env[k] = v;
  }
  env.GIT_CONFIG_NOSYSTEM = '1';
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=', ...args], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function write(root: string, rel: string, content = 'x\n'): void {
  const full = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

/** The fixture every mode shares: gate sources that count, and ones in pruned trees that never do. */
function seed(root: string): void {
  write(root, 'portal.yaml', 'version: 1.0.0\ngates:\n  root-gate:\n    description: r\n');
  write(root, '.purpose', 'components:\n  a:\n    gates: [^root-gate]\n');
  write(root, 'packages/api/.purpose', 'gates:\n  ^api-gate:\n    description: a\n');
  write(root, 'packages/api/portal.yaml', 'gates:\n  nested-gate:\n    description: n\n');
  write(root, 'packages/api/src/index.ts', 'export const a = 1;\n');
  write(root, 'untracked/.purpose', 'components: {}\n');
  // Pruned by name in every mode
  write(root, 'node_modules/dep/.purpose');
  write(root, 'packages/api/dist/.purpose');
  write(root, '.paradigm/.purpose');
  write(root, '.claude/worktrees/agent-1/.purpose');
  write(root, '.claude/worktrees/agent-1/packages/api/portal.yaml');
  write(root, '.warpline/states/abc/.purpose');
  write(root, 'ios/.build/checkouts/dep/.purpose');
  write(root, '.loom/run/portal.yaml');
}

const EXPECTED = ['.purpose', 'packages/api/.purpose', 'packages/api/portal.yaml', 'portal.yaml', 'untracked/.purpose'];

function relGateFiles(root: string): string[] {
  return listGateFiles(root).map((f) => toPosixPath(path.relative(root, f))).sort();
}

describe('listProjectFiles / listGateFiles', () => {
  let root: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'project-files-')));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  function initRepo(): void {
    git(root, ['init', '-q']);
    // Everything except untracked/ is committed; untracked/ stays untracked-but-not-ignored
    git(root, ['add', '--', 'portal.yaml', '.purpose', 'packages']);
    git(root, ['commit', '-q', '-m', 'seed']);
  }

  it('outside git: a pruned walk finds the gate sources and skips the pruned trees', () => {
    seed(root);
    const list = listProjectFiles(root);
    expect(list.source).toBe('walk');
    expect(list.files).toContain('packages/api/src/index.ts');
    expect(list.files.some((f) => f.startsWith('.warpline/'))).toBe(false);
    expect(list.files.some((f) => f.includes('/.build/'))).toBe(false);
    expect(list.files.some((f) => f.startsWith('.loom/'))).toBe(false);
    expect(list.files.some((f) => f.startsWith('.claude/worktrees/'))).toBe(false);
    expect(list.files.some((f) => f.startsWith('node_modules/'))).toBe(false);
    expect(relGateFiles(root)).toEqual(EXPECTED);
  });

  it('inside git: the list comes from git and is the same set as the walk', () => {
    seed(root);
    write(root, '.gitignore', 'node_modules/\ndist/\n');
    initRepo();
    const list = listProjectFiles(root);
    expect(list.source).toBe('git');
    // tracked and untracked-but-not-ignored are both listed, with forward slashes
    expect(list.files).toContain('packages/api/src/index.ts');
    expect(list.files).toContain('untracked/.purpose');
    expect(list.files.some((f) => f.includes('\\'))).toBe(false);
    expect(list.files.some((f) => f.startsWith('.claude/worktrees/'))).toBe(false);
    // .warpline/.build/.loom/.paradigm are not ignored here, so git lists them: the gate filter drops them
    expect(relGateFiles(root)).toEqual(EXPECTED);
  });

  it('inside git: a gitignored .purpose or nested portal.yaml is not a gate source', () => {
    seed(root);
    write(root, 'local/.purpose', 'gates:\n  ^ignored-gate:\n    description: i\n');
    write(root, 'local/portal.yaml', 'gates:\n  ignored-nested:\n    description: i\n');
    // Before git: the walk counts them
    expect(relGateFiles(root)).toEqual([...EXPECTED, 'local/.purpose', 'local/portal.yaml'].sort());
    write(root, '.gitignore', 'node_modules/\ndist/\nlocal/\n');
    initRepo();
    expect(listProjectFiles(root).source).toBe('git');
    expect(relGateFiles(root)).toEqual(EXPECTED);
  });

  it('inside git: a tracked file deleted from disk is not listed and does not break the compliance check', async () => {
    seed(root);
    write(root, '.gitignore', 'node_modules/\ndist/\n');
    initRepo();
    fs.rmSync(path.join(root, 'packages', 'api', 'portal.yaml'));
    expect(listProjectFiles(root).files).not.toContain('packages/api/portal.yaml');
    expect(listProjectFiles(root).files).toContain('packages/api/.purpose');
    const report = await checkPortalCompliance(root);
    // ^root-gate is declared at the root and referenced from .purpose; ^api-gate is declared in a .purpose
    expect(report.properlyDeclared).toContain('root-gate');
    expect(report.usedButUndeclared).toEqual([]);
  });

  it('git and walk give the same compliance report for the same tree', async () => {
    seed(root);
    write(root, '.gitignore', 'node_modules/\ndist/\n');
    const before = await checkPortalCompliance(root);
    initRepo();
    const after = await checkPortalCompliance(root);
    expect(listProjectFiles(root).source).toBe('git');
    expect(after).toEqual(before);
  });

  it('hasDirSegment matches directory segments only, never the file name', () => {
    const names = new Set(['dist', '.claude']);
    expect(hasDirSegment('packages/a/dist/x.js', names)).toBe(true);
    expect(hasDirSegment('.claude/worktrees/a/.purpose', names)).toBe(true);
    expect(hasDirSegment('packages/a/dist', names)).toBe(false);
    expect(hasDirSegment('distribution/x.js', names)).toBe(false);
  });
});
