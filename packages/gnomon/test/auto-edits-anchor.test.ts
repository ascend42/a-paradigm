// @gnomon-platform: darwin, linux
/**
 * K1 (TD-2026-10-20-086): a read-only pass under auto-edits is ANCHORED — the kernel answers allow with
 * updatedInput.command = anchorCommand(command, realpath(root), shell), so it runs in the directory the classifier
 * assumed. The wrap keeps a heredoc and a trailing `# comment` intact, unsets CDPATH, and runs in the root under real
 * zsh and bash from any starting directory; autoBashReadOnly returns the anchored command and root.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { anchorCommand, anchorGitEnv, classifyReadOnly, parseShell, repoGitExecKey, shellFlavour, shQuote } from '../src/kernel/supervisor/shell-readonly.js';
import { autoBashReadOnly } from '../src/kernel/supervisor/auto-edits.js';
import { inputHash } from '../src/kernel/supervisor/permission.js';

let base = '';
let root = '';
let real = '';
let elsewhere = '';
let home = '';
const have = (sh: string) => spawnSync(sh, ['-c', 'true']).status === 0;

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "gnomon-anchor-it's-"));
  root = path.join(base, 'repo dir');
  elsewhere = path.join(base, 'elsewhere');
  home = path.join(base, 'home');
  for (const d of [root, elsewhere, home, path.join(root, 'sub')]) fs.mkdirSync(d, { recursive: true });
  real = fs.realpathSync(root);
  fs.writeFileSync(path.join(root, 'a.txt'), 'in-root\n');
  fs.writeFileSync(path.join(elsewhere, 'a.txt'), 'elsewhere\n');
  fs.mkdirSync(path.join(elsewhere, 'sub'));
});
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

const HEREDOC = "cat <<'EOF'\nline one\nEOF\ncat a.txt # trailing comment";

describe('K1 anchorCommand', () => {
  it('quotes the root safely and wraps the command on its own lines', () => {
    expect(shQuote("a'b")).toBe(`'a'\\''b'`);
    expect(anchorCommand('ls', "/r/it's", 'zsh')).toBe(`builtin cd -q -- '/r/it'\\''s' && { builtin unfunction chpwd cd 2>/dev/null; chpwd_functions=(); builtin setopt no_ignore_braces; } && builtin set -- x{a,b} && builtin test "$#" -eq 2 && builtin unset CDPATH RIPGREP_CONFIG_PATH && ${anchorGitEnv()} && {\nls\n}`);
    expect(anchorCommand('ls', '/r', 'bash')).toBe(`builtin cd -- '/r' && { builtin unset -f cd; builtin set -B; } && builtin set -- x{a,b} && builtin test "$#" -eq 2 && builtin unset CDPATH RIPGREP_CONFIG_PATH && ${anchorGitEnv()} && {\nls\n}`);
    expect(anchorCommand('ls', '/r', 'unknown')).toContain('ZSH_VERSION');
    expect(shellFlavour('/bin/zsh')).toBe('zsh');
    expect(shellFlavour('/usr/local/bin/bash')).toBe('bash');
    expect(shellFlavour('/opt/homebrew/bin/fish')).toBe('unknown');
    expect(shellFlavour(undefined)).toBe('unknown');
  });
  it('a heredoc and a trailing comment survive the wrap (the newline before } matters)', () => {
    const w = anchorCommand(HEREDOC, '/r', 'zsh');
    expect(w.endsWith('# trailing comment\n}')).toBe(true);
    expect(() => parseShell(HEREDOC)).not.toThrow();
  });
  for (const [sh, flavour] of [['/bin/zsh', 'zsh'], ['/bin/bash', 'bash'], ['/bin/zsh', 'unknown'], ['/bin/bash', 'unknown']] as const) {
    it.skipIf(!have(sh))(`runs in the root under ${sh} (${flavour} form), from another cwd, with CDPATH unset`, () => {
      const cmd = `${HEREDOC}\npwd -P\necho "cdpath=[\${CDPATH-unset}]"\ncd sub && pwd -P`;
      const r = spawnSync(sh, ['-c', anchorCommand(cmd, real, flavour)], { cwd: elsewhere, env: { ...process.env, CDPATH: elsewhere }, encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout.split('\n')).toEqual(['line one', 'in-root', real, 'cdpath=[unset]', path.join(real, 'sub'), '']);
    });
  }
  it.skipIf(!have('/bin/bash'))('a failing cd runs nothing (bash given the zsh-only -q)', () => {
    const r = spawnSync('/bin/bash', ['-c', anchorCommand('echo RAN', real, 'zsh')], { cwd: elsewhere, encoding: 'utf8' });
    expect(r.stdout).not.toContain('RAN');
  });
});

describe('K1 autoBashReadOnly with an anchor', () => {
  const gh = () => path.join(home, '.gnomon');
  it('passes a relative read and returns the anchored command and the root realpath; the hashes differ', () => {
    const input = { command: 'cat a.txt', description: 'read it' };
    const p = autoBashReadOnly('Bash', input, [root], ['x'], gh(), process.platform, home, { root, shell: '/bin/zsh' });
    expect(p).toEqual({ ok: true, command: anchorCommand('cat a.txt', real, 'zsh'), root: real });
    const updated = { ...input, command: (p as { command: string }).command };
    expect(inputHash(updated)).not.toBe(inputHash(input));
  });
  it('a root that is not a session root, or does not exist, never passes', () => {
    expect(autoBashReadOnly('Bash', { command: 'pwd' }, [root], ['x'], gh(), process.platform, home, { root: elsewhere })).toMatchObject({ ok: false, why: 'no-root' });
    expect(autoBashReadOnly('Bash', { command: 'pwd' }, [path.join(base, 'gone')], ['x'], gh(), process.platform, home, { root: path.join(base, 'gone') })).toMatchObject({ ok: false, why: 'no-root' });
  });
  it('win32 is never anchored (the unanchored rules apply)', () => {
    expect(autoBashReadOnly('Bash', { command: 'pwd' }, ['C:\\w\\repo'], ['x'], 'C:\\g', 'win32', 'C:\\Users\\me', { root: 'C:\\w\\repo' })).toEqual({ ok: true, command: 'pwd', root: null });
  });
});

describe('Aegis C1: an unquoted heredoc line ending in a backslash (bash/zsh join it before the delimiter match)', () => {
  const ctx = () => ({ roots: [root], home, gnomonHome: path.join(home, '.gnomon'), platform: process.platform, readRoots: [], cwd: real });
  const attack = (op: string) => `cat ${op}EOF\nEO\\\nF\ntouch PWNED\nEOF`;
  it.each(['<<', '<<-'])('refuses the split delimiter (%s)', (op) => {
    expect(classifyReadOnly(attack(op), ctx())).toMatchObject({ ok: false, why: 'unparsed: heredoc: a line ending in a backslash' });
    expect(classifyReadOnly(`cat ${op}EOF\nbody \\\nEOF\\\nEOF`, ctx()).ok).toBe(false);
  });
  it('a quoted heredoc keeps backslashes literal (no join): still passes; an even run passes unquoted', () => {
    expect(classifyReadOnly("cat <<'EOF'\nEO\\\nF\nEOF", ctx())).toEqual({ ok: true });
    expect(classifyReadOnly('cat <<EOF\nx \\\\\nEOF', ctx())).toEqual({ ok: true });
  });
  for (const [sh, flavour] of [['/bin/zsh', 'zsh'], ['/bin/bash', 'bash']] as const) {
    it.skipIf(!have(sh))(`under ${sh}: the attack WOULD run touch (why it is refused), the passing forms run with no side effect`, () => {
      const dir = fs.mkdtempSync(path.join(base, 'c1-'));
      const raw = spawnSync(sh, ['-c', attack('<<')], { cwd: dir, encoding: 'utf8' });
      expect(raw.status).toBe(127); // the trailing `EOF` line then runs as a command
      expect(fs.existsSync(path.join(dir, 'PWNED'))).toBe(true); // the shell joined EO\⏎F into EOF
      const realDir = fs.realpathSync(dir);
      for (const ok of ["cat <<'EOF'\nEO\\\nF\nEOF", 'cat <<EOF\nx \\\\\nEOF']) {
        expect(classifyReadOnly(ok, { ...ctx(), roots: [dir], cwd: realDir })).toEqual({ ok: true });
        const r = spawnSync(sh, ['-c', anchorCommand(ok, realDir, flavour)], { cwd: elsewhere, encoding: 'utf8' });
        expect(r.status).toBe(0);
        expect(fs.readdirSync(dir).filter((n) => n !== 'PWNED')).toEqual([]);
      }
    });
  }
});

describe('Aegis H1: a repo git config that names a program', () => {
  const git = (cwd: string, ...a: string[]) => spawnSync('git', a, { cwd, encoding: 'utf8' });
  const mk = (name: string, config = ''): string => {
    const d = path.join(base, name);
    fs.mkdirSync(d);
    git(d, 'init', '-q');
    fs.writeFileSync(path.join(d, 'f.txt'), 'f\n');
    git(d, 'add', 'f.txt');
    git(d, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'i');
    if (config) fs.appendFileSync(path.join(d, '.git', 'config'), config);
    return d;
  };
  const ro = (c: string, d: string) => classifyReadOnly(c, { roots: [d], home, gnomonHome: path.join(home, '.gnomon'), platform: process.platform, readRoots: [], cwd: fs.realpathSync(d) });
  it('(b) refuses git when the repo config (or an include) names an exec-class key; other commands still pass', () => {
    const cases: Array<[string, string]> = [
      ['[core]\n\tfsmonitor = ./hook.sh\n', 'core.fsmonitor'],
      ['[core]\n\tpager = sh -c x\n', 'core.pager'],
      ['[diff]\n\texternal = ./x\n', 'diff.external'],
      ['[diff "pdf"]\n\ttextconv = ./x\n', 'diff.pdf.textconv'],
      ['[diff "pdf"]\n\tcommand = ./x\n', 'diff.pdf.command'],
      ['[filter "lfs"]\n\tsmudge = ./x\n', 'filter.lfs.smudge'],
      ['[core] hooksPath = ./h\n', 'core.hookspath'],
      ['[core]\n\tsshCommand = ./x\n', 'core.sshcommand'],
      ['[remote "o"]\n\tuploadpack = ./x\n', 'remote.o.uploadpack'],
      ['[gpg]\n\tprogram = ./x\n', 'gpg.program'],
      ['[gpg "ssh"]\n\tprogram = ./x\n', 'gpg.ssh.program'],
      ['[uploadpack]\n\tpackObjectsHook = ./x\n', 'uploadpack.packobjectshook'],
      ['[pager]\n\tlog = ./x\n', 'pager.log'],
    ];
    for (const [i, [cfg, key]] of cases.entries()) {
      const d = mk(`h1-${i}`, cfg);
      expect(repoGitExecKey(fs.realpathSync(d), home)).toBe(key);
      expect(ro('git status', d)).toMatchObject({ ok: false, why: `git: the repo config names a program (${key})` });
      expect(ro('cat f.txt', d)).toEqual({ ok: true });
    }
    const inc = mk('h1-inc', '[include]\n\tpath = ../extra.cfg\n[includeIf "gitdir:/nowhere/"]\n\tpath = ~/cond.cfg\n');
    fs.writeFileSync(path.join(inc, '.git', '..', '.git', '..', '..', 'extra.cfg'), '[user]\n\tname = x\n');
    fs.writeFileSync(path.join(home, 'cond.cfg'), '[filter "x"]\n\tclean = ./x\n');
    expect(ro('git log', inc)).toMatchObject({ ok: false, why: 'git: the repo config names a program (filter.x.clean)' });
    expect(ro('git log', mk('h1-clean', '[core]\n\tfsmonitor = false\n'))).toEqual({ ok: true });
  });
  it('(b) a linked worktree: its .git file, the common dir config', () => {
    const main = mk('h1-main', '[diff "x"]\n\ttextconv = ./x\n');
    const wt = path.join(base, 'h1-wt');
    expect(git(main, 'worktree', 'add', '-q', wt).status).toBe(0);
    expect(repoGitExecKey(fs.realpathSync(wt), home)).toBe('diff.x.textconv');
  });
  for (const [sh, flavour] of [['/bin/zsh', 'zsh'], ['/bin/bash', 'bash']] as const) {
    it.skipIf(!have(sh))(`(a) under ${sh}: the prelude's command-scope config wins over a repo fsmonitor hook and pager`, () => {
      const d = mk(`h1-run-${flavour}`);
      const mark = path.join(d, 'HOOK-RAN');
      fs.writeFileSync(path.join(d, 'hook.sh'), `#!/bin/sh\ntouch '${mark}'\n`, { mode: 0o755 });
      git(d, 'config', 'core.fsmonitor', path.join(d, 'hook.sh'));
      git(d, 'config', 'core.pager', `touch '${mark}'`);
      // the effective values git reads under the prelude are the command-scope ones (they outrank the repo config)
      const r = spawnSync(sh, ['-c', anchorCommand('git status --porcelain >/dev/null; git config core.pager; git config core.fsmonitor; echo "lazy=$GIT_NO_LAZY_FETCH"', fs.realpathSync(d), flavour)], { cwd: elsewhere, encoding: 'utf8' });
      expect(r.stdout.split('\n').slice(0, 3)).toEqual(['cat', 'false', 'lazy=1']);
      expect(fs.existsSync(mark)).toBe(false);
    });
  }
});

describe('Aegis M2/L1: the prelude removes cd hooks and functions and turns brace expansion on', () => {
  for (const [sh, flavour] of [['/bin/zsh', 'zsh'], ['/bin/bash', 'bash'], ['/bin/zsh', 'unknown'], ['/bin/bash', 'unknown']] as const) {
    it.skipIf(!have(sh))(`under ${sh} (${flavour} form)`, () => {
      const marks = fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-m2-'));
      const mark = path.join(marks, 'HOOK');
      try {
        const setup = sh === '/bin/zsh'
          ? `chpwd() { touch '${mark}'; }; h() { touch '${mark}'; }; chpwd_functions=(h); cd() { touch '${mark}'; builtin cd "$@"; }\n`
          : `cd() { touch '${mark}'; builtin cd "$@"; }; set +B\n`;
        const r = spawnSync(sh, ['-c', setup + anchorCommand('cd sub && pwd -P && echo {a,b}', real, flavour)], { cwd: elsewhere, encoding: 'utf8' });
        expect(r.stdout).toBe(`${path.join(real, 'sub')}\na b\n`);
        expect(fs.existsSync(mark)).toBe(false);
      } finally {
        fs.rmSync(marks, { recursive: true, force: true });
      }
    });
  }
  for (const [sh, off] of [['/bin/zsh', 'setopt ignore_braces'], ['/bin/bash', 'set +B']] as const) {
    it.skipIf(!have(sh))(`${sh} with brace expansion off beforehand (${off}): the command sees it expanded, or nothing runs`, () => {
      const r = spawnSync(sh, ['-c', `${off}\neval ${shQuote(anchorCommand('echo {a,b}', real, sh === '/bin/zsh' ? 'zsh' : 'bash'))}`], { cwd: elsewhere, encoding: 'utf8' });
      expect(['', 'a b\n']).toContain(r.stdout);
    });
  }
});
