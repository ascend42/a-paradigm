// #doctor-shared-file-list: doctor's checks read one #project-files list per run instead of walking
// the tree five times. Agent worktree copies (.claude/worktrees/), Warpline state and Swift build
// trees are never counted, in a git project or outside one.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { runContextAudit, type ContextAuditResult } from './context-audit.js';
import { repoTraits } from './hook-health.js';
import { doctorCommand } from './index.js';
import { listProjectFiles } from '../../core/project-files.js';
import { createTempProject } from '../../test-utils.js';

/**
 * git with every inherited GIT_* variable cleared, so a run from a git hook stays in its fixture,
 * and with no developer or system git config.
 */
function git(cwd: string, args: string[]): void {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('GIT_')) env[k] = v;
  }
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = path.join(fakeHome, 'empty-gitconfig');
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=', ...args], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function write(root: string, rel: string, content = 'x\n'): void {
  const full = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

const BIG_PURPOSE = `version: 2.0.0\ndescription: big\n${'# filler line\n'.repeat(600)}`;
const WORKTREE = '.claude/worktrees/agent-abc';

const realHome = {
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
  GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
};
let fakeHome = '';
let rootDir = '';

beforeEach(() => {
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-list-home-'));
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
  // The code under test runs git with the process environment: no developer or system git config
  fs.writeFileSync(path.join(fakeHome, 'empty-gitconfig'), '');
  process.env.GIT_CONFIG_GLOBAL = path.join(fakeHome, 'empty-gitconfig');
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  // Removed in afterEach with retries (Windows), not with the helper's own cleanup
  const project = createTempProject({ withPurpose: true });
  rootDir = project.rootDir;
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(rootDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  for (const [k, v] of Object.entries(realHome)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(fakeHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function suppressOutput(): void {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
}

function findCheck(results: ContextAuditResult[], check: string): ContextAuditResult {
  const found = results.find((r) => r.check === check);
  if (!found) throw new Error(`no ${check} result`);
  return found;
}

/** Text of a result with OS separators normalised, for path assertions. */
function textOf(r: ContextAuditResult): string {
  return [r.message, ...(r.details ?? [])].join('\n').split('\\').join('/');
}

/** Copies and generated state that no doctor check may count. */
function seedNoise(root: string): void {
  write(root, `${WORKTREE}/packages/warpline/.purpose`, BIG_PURPOSE);
  write(root, `${WORKTREE}/packages/warpline/src/copy.ts`, 'export const c = 1;\n');
  write(root, `${WORKTREE}/src/widgets/handler.ts`, 'export const w = 1;\n');
  write(root, '.warpline/states/s1/.purpose', BIG_PURPOSE);
  write(root, '.warpline/states/s1/src/state.ts', 'export const s = 1;\n');
  write(root, 'ios/.build/checkouts/dep/.purpose', BIG_PURPOSE);
  write(root, 'ios/.build/checkouts/dep/dep.ts', 'export const d = 1;\n');
}

function initRepo(root: string, ignore: string): void {
  write(root, '.gitignore', ignore);
  git(root, ['init', '-q']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'seed']);
}

// 'git-unignored': the worktree copies, Warpline state and build trees are COMMITTED (no ignore
// line), so only the shared prune list keeps them out of doctor's checks.
for (const mode of ['walk', 'git', 'git-unignored'] as const) {
  describe(`doctor file list (${mode})`, () => {
    function prepare(): void {
      if (mode === 'git') initRepo(rootDir, '.claude/worktrees/\n.warpline/\n.build/\nnode_modules/\n');
      if (mode === 'git-unignored') initRepo(rootDir, 'node_modules/\n');
      expect(listProjectFiles(rootDir).source).toBe(mode === 'walk' ? 'walk' : 'git');
    }

    it('purpose-file-health does not count a .purpose under .claude/worktrees/', async () => {
      suppressOutput();
      seedNoise(rootDir);
      prepare();
      const check = findCheck(await runContextAudit(rootDir, { quiet: true, homeDir: fakeHome }), 'purpose-file-health');
      expect(check.status).toBe('ok');
      expect(textOf(check)).not.toContain('worktrees');
    });

    it('purpose-file-health still reports a real oversized .purpose, and only that one', async () => {
      suppressOutput();
      seedNoise(rootDir);
      write(rootDir, 'src/big/.purpose', BIG_PURPOSE);
      prepare();
      const check = findCheck(await runContextAudit(rootDir, { quiet: true, homeDir: fakeHome }), 'purpose-file-health');
      expect(check.status).not.toBe('ok');
      expect(check.message).toContain('1 oversized');
      expect(textOf(check)).toContain('src/big/.purpose');
      expect(textOf(check)).not.toContain('worktrees');
      expect(textOf(check)).not.toContain('.warpline');
      expect(textOf(check)).not.toContain('.build');
    });

    it('purpose-coverage does not count source directories of a worktree copy', async () => {
      suppressOutput();
      seedNoise(rootDir);
      write(rootDir, 'src/real/a.ts', 'export const a = 1;\n');
      prepare();
      const check = findCheck(await runContextAudit(rootDir, { quiet: true, homeDir: fakeHome }), 'purpose-coverage');
      const text = textOf(check);
      expect(text).not.toContain('worktrees');
      expect(text).not.toContain('.warpline');
      expect(text).not.toContain('.build');
    });

    it('stale-portal does not match a route against a file that exists only in a worktree copy', async () => {
      suppressOutput();
      seedNoise(rootDir);
      write(rootDir, 'src/orders/handler.ts', 'export const o = 1;\n');
      write(rootDir, 'portal.yaml', 'version: 1.0.0\ngates:\n  g:\n    description: g\nroutes:\n  "GET /api/widgets": [g]\n  "GET /api/orders": [g]\n');
      prepare();
      const check = findCheck(await runContextAudit(rootDir, { quiet: true, homeDir: fakeHome }), 'stale-portal');
      const text = textOf(check);
      // widgets lives only under .claude/worktrees/: stale. orders has a real file: not stale.
      expect(text).toContain('/api/widgets');
      expect(text).not.toContain('/api/orders');
    });

    it('the clarification-marker count ignores a worktree copy', async () => {
      seedNoise(rootDir);
      write(rootDir, `${WORKTREE}/docs/.purpose`, 'description: "[NEEDS CLARIFICATION: copy]"\n');
      write(rootDir, 'src/real/.purpose', 'description: "[NEEDS CLARIFICATION: real]"\n');
      prepare();
      const lines: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { lines.push(args.join(' ')); });
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await doctorCommand({ rootDir, homeDir: fakeHome });
      const output = lines.join('\n');
      expect(output).toContain('1 [NEEDS CLARIFICATION] marker found');
    });
  });
}

describe('doctor file list (git only)', () => {
  it('a gitignored oversized .purpose is not counted', async () => {
    suppressOutput();
    write(rootDir, 'local-notes/.purpose', BIG_PURPOSE);
    // Outside git it counts, as before
    const before = findCheck(await runContextAudit(rootDir, { quiet: true, homeDir: fakeHome }), 'purpose-file-health');
    expect(before.message).toContain('1 oversized');
    initRepo(rootDir, 'local-notes/\n');
    const after = findCheck(await runContextAudit(rootDir, { quiet: true, homeDir: fakeHome }), 'purpose-file-health');
    expect(after.status).toBe('ok');
  });

  it('runContextAudit uses the list it is given instead of taking its own', async () => {
    suppressOutput();
    write(rootDir, 'src/big/.purpose', BIG_PURPOSE);
    const given = { root: rootDir, source: 'walk' as const, files: ['.purpose'] };
    const check = findCheck(await runContextAudit(rootDir, { quiet: true, homeDir: fakeHome, projectFiles: given }), 'purpose-file-health');
    expect(check.status).toBe('ok');
  });
});

describe('doctor says where its file list came from', () => {
  async function doctorOutput(): Promise<string> {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { lines.push(args.join(' ')); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await doctorCommand({ rootDir, homeDir: fakeHome });
    return lines.join('\n');
  }

  it('outside git: a walk, with the reason, and not a warning', async () => {
    const output = await doctorOutput();
    expect(output).toMatch(/Project file list\s+directory walk \(\d+ files\): not a git repository/);
    expect(output).not.toContain('git would hide new gate files');
  });

  it('inside git: from git', async () => {
    initRepo(rootDir, 'node_modules/\n');
    expect(await doctorOutput()).toMatch(/Project file list\s+git \(\d+ files\)/);
  });

  it('an ignore rule that hides gate files: the fallback is reported with its fix', async () => {
    write(rootDir, 'src/a.ts', 'export const a = 1;\n');
    initRepo(rootDir, '.*\n');
    expect(listProjectFiles(rootDir).fallbackReason).toBe('gate-files-ignored');
    const output = await doctorOutput();
    expect(output).toContain('git would hide new gate files');
    expect(output).toContain('git check-ignore -v --no-index .purpose portal.yaml');
  });
});

describe('repoTraits (hook health)', () => {
  it('still reports an agent worktree as a nested repo, and skips generated state trees', () => {
    write(rootDir, `${WORKTREE}/.git`, 'gitdir: elsewhere\n');
    write(rootDir, '.warpline/states/.git', 'gitdir: elsewhere\n');
    write(rootDir, 'ios/.build/.git', 'gitdir: elsewhere\n');
    const nested = repoTraits(rootDir).nestedRepos.map((p) => p.split(path.sep).join('/'));
    expect(nested).toEqual([WORKTREE]);
  });

  it('counts .purpose files from the shared list when it came from git, and none outside git', () => {
    write(rootDir, 'src/a/.purpose', 'anchors:\n  - src/a/x.ts\n');
    expect(repoTraits(rootDir, 4, listProjectFiles(rootDir)).purposeCount).toBe(0);
    initRepo(rootDir, 'node_modules/\n');
    const list = listProjectFiles(rootDir);
    expect(list.source).toBe('git');
    const withList = repoTraits(rootDir, 4, list);
    const without = repoTraits(rootDir);
    expect(withList.purposeCount).toBe(without.purposeCount);
    expect(withList.anchorLines).toBe(without.anchorLines);
    expect(withList.purposeCount).toBeGreaterThanOrEqual(2);
  });

  it('the untracked count comes from the shared list and counts every untracked, not-ignored file', () => {
    initRepo(rootDir, 'node_modules/\nignored/\n');
    expect(repoTraits(rootDir).untrackedCount).toBe(0);
    write(rootDir, 'new one.txt');
    write(rootDir, 'src/new/.purpose', 'components: {}\n');
    write(rootDir, 'ignored/x.txt');
    // generated state that is not ignored is still an untracked file the hooks list
    write(rootDir, '.warpline/states/s1/blob');
    expect(repoTraits(rootDir).untrackedCount).toBe(3);
    expect(repoTraits(rootDir, 4, listProjectFiles(rootDir)).untrackedCount).toBe(3);
  });
});
