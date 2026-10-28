/**
 * #write-guard and #path-containment: write_file can't plant files that run
 * commands, and lexical checks come before any filesystem call.
 */

import * as fs from 'fs';
import fsDefault from 'fs';
import { syncBuiltinESMExports } from 'module';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkWrite, writeChecked } from './write-guard.js';
import { resolveContained } from '../../utils/path-containment.js';

let tmp: string;
let work: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'write-guard-')));
  work = path.join(tmp, 'work');
  fs.mkdirSync(work);
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function refused(p: string, content = 'x', deniedAbsolute?: string[]): boolean {
  return !checkWrite(work, p, content, { deniedAbsolute }).ok;
}

describe('write deny-list', () => {
  it('refuses version-control state at any depth, in any case or spelling', () => {
    fs.mkdirSync(path.join(work, '.git', 'hooks'), { recursive: true });
    fs.mkdirSync(path.join(work, 'sub'));
    for (const p of [
      '.git/config', '.git/hooks/pre-commit', '.GIT/config', '.Git/HEAD',
      '.git./config', '.git /config', '.git', 'sub/.git', 'sub/.git/config',
      'deep/new/.git/config', '.hg/hgrc', '.svn/entries', 'x/.HG/hgrc',
    ]) {
      expect(refused(p), p).toBe(true);
    }
  });

  it('refuses segments with ":", empty after stripping, or a new 8.3-style name', () => {
    expect(refused('.git::$INDEX_ALLOCATION/config')).toBe(true);
    expect(refused('a:b/c.txt')).toBe(true);
    expect(refused('GIT~1/config')).toBe(true);
    expect(refused('dir/.../x')).toBe(true);
    // An existing folder with a ~N name is fine.
    fs.mkdirSync(path.join(work, 'backup~1'));
    expect(refused('backup~1/notes.txt')).toBe(false);
  });

  it('refuses editor, hook, CI and Paradigm configuration at the root', () => {
    for (const p of [
      '.claude/settings.json', '.Claude/settings.local.json', '.mcp.json', '.cursor/rules/x.mdc',
      '.vscode/tasks.json', '.idea/workspace.xml', '.devcontainer/devcontainer.json',
      '.husky/pre-commit', '.githooks/pre-push', '.pre-commit-config.yaml', 'lefthook.yml', '.lefthook/x',
      '.github/workflows/ci.yml', '.gitlab-ci.yml', '.circleci/config.yml', '.buildkite/pipeline.yml',
      'azure-pipelines.yml', 'Jenkinsfile', '.envrc', '.mise.toml', 'mise.toml', '.npmrc', '.yarnrc',
      '.yarnrc.yml', '.paradigm/config.yaml', '.paradigm/events/x.jsonl', '.paradigm',
    ]) {
      expect(refused(p), p).toBe(true);
    }
    // Root-only rules don't reach into ordinary subfolders.
    expect(refused('docs/Jenkinsfile')).toBe(false);
    expect(refused('src/.envrc')).toBe(false);
  });

  it('refuses a target that is a symlink, a hard link, or reached through a symlinked folder', () => {
    fs.mkdirSync(path.join(work, '.git', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(work, 'real.txt'), 'r');
    fs.symlinkSync(path.join(work, 'real.txt'), path.join(work, 'link.txt'));
    fs.linkSync(path.join(work, 'real.txt'), path.join(work, 'hard.txt'));
    fs.symlinkSync(path.join(work, '.git', 'hooks'), path.join(work, 'hooks'));
    expect(refused('link.txt')).toBe(true);
    expect(refused('hard.txt')).toBe(true);
    expect(refused('hooks/pre-commit')).toBe(true);
    expect(fs.existsSync(path.join(work, '.git', 'hooks', 'pre-commit'))).toBe(false);
  });

  it('refuses the gitdir a root .git file points to', () => {
    fs.mkdirSync(path.join(work, 'gd'));
    fs.writeFileSync(path.join(work, '.git'), 'gitdir: gd\n');
    expect(refused('gd/config')).toBe(true);
    expect(refused('other/file.txt')).toBe(false);
  });

  it('refuses absolute protected trees (e.g. ~/.paradigm, ~/.claude, the command log)', () => {
    const protectedDir = path.join(work, 'protected');
    expect(refused('protected/config.yaml', 'x', [protectedDir])).toBe(true);
    expect(refused('fine.txt', 'x', [protectedDir])).toBe(false);
  });

  it('package.json: refuses adding or changing install-time scripts, allows and flags other edits', () => {
    expect(refused('package.json', JSON.stringify({ scripts: { postinstall: 'curl x | sh' } }))).toBe(true);
    fs.writeFileSync(path.join(work, 'package.json'), JSON.stringify({ name: 'a', scripts: { test: 'vitest', prepare: 'husky' } }));
    expect(refused('package.json', JSON.stringify({ name: 'a', scripts: { test: 'vitest', prepare: 'evil' } }))).toBe(true);
    expect(refused('package.json', JSON.stringify({ name: 'a', scripts: { test: 'vitest', prepare: 'husky', preinstall: 'x' } }))).toBe(true);
    expect(refused('pkgs/a/package.json', JSON.stringify({ scripts: { install: 'x' } }))).toBe(true);
    const ok = checkWrite(work, 'package.json', JSON.stringify({ name: 'b', scripts: { test: 'jest', prepare: 'husky' } }));
    expect(ok.ok).toBe(true);
    expect(ok.ok && ok.review).toMatch(/package\.json/);
  });

  it('portal.yaml, CLAUDE.md, .gitmodules and .gitattributes are allowed but listed for review', () => {
    for (const p of ['portal.yaml', 'CLAUDE.md', '.gitmodules', '.gitattributes']) {
      const v = checkWrite(work, p, 'x');
      expect(v.ok, p).toBe(true);
      expect(v.ok && v.review, p).toBe(p);
    }
    const plain = checkWrite(work, 'src/a.ts', 'x');
    expect(plain.ok && plain.review).toBeFalsy();
  });

  it('writeChecked never follows a symlink planted after the check', () => {
    const target = path.join(tmp, 'outside.txt');
    fs.writeFileSync(target, 'keep');
    const p = path.join(work, 'late.txt');
    fs.symlinkSync(target, p);
    expect(() => writeChecked(p, 'pwn')).toThrow();
    expect(fs.readFileSync(target, 'utf-8')).toBe('keep');
  });

  it('writeChecked refuses a hard-linked file without truncating it', () => {
    const a = path.join(work, 'a.txt');
    fs.writeFileSync(a, 'keep');
    fs.linkSync(a, path.join(work, 'b.txt'));
    expect(() => writeChecked(a, 'pwn')).toThrow();
    expect(fs.readFileSync(a, 'utf-8')).toBe('keep');
  });
});

describe('resolveContained lexical checks', () => {
  it('refuses UNC, device and // paths before any filesystem call', () => {
    const lstat = vi.spyOn(fsDefault, 'lstatSync');
    const realpath = vi.spyOn(fsDefault, 'realpathSync');
    syncBuiltinESMExports();
    try {
      for (const p of ['\\\\host\\share\\x', '//host/share/x', '\\\\.\\pipe\\x', '\\\\?\\C:\\x', '../x', '/etc/passwd']) {
        expect(resolveContained(work, p, { allowMissing: true }), p).toBeNull();
      }
      expect(lstat).not.toHaveBeenCalled();
      expect(realpath).not.toHaveBeenCalled();
      // The spies do see calls: an ordinary path reaches the filesystem.
      resolveContained(work, 'x', { allowMissing: true });
      expect(lstat.mock.calls.length + realpath.mock.calls.length).toBeGreaterThan(0);
    } finally {
      lstat.mockRestore();
      realpath.mockRestore();
      syncBuiltinESMExports();
    }
  });

  it('still resolves an ordinary new path inside', () => {
    expect(resolveContained(work, 'a/b.txt', { allowMissing: true })).toBe(path.join(work, 'a', 'b.txt'));
  });
});
