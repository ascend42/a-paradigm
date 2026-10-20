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
import { anchorCommand, parseShell, shellFlavour, shQuote } from '../src/kernel/supervisor/shell-readonly.js';
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
    expect(anchorCommand('ls', "/r/it's", 'zsh')).toBe(`builtin cd -q -- '/r/it'\\''s' && builtin unset CDPATH && {\nls\n}`);
    expect(anchorCommand('ls', '/r', 'bash')).toBe(`builtin cd -- '/r' && builtin unset CDPATH && {\nls\n}`);
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
