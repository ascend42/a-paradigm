/**
 * Second-review hardening of the Anthropic API provider's tools:
 * #write-guard name folding, any-depth names, bare-repo shapes, manifests;
 * #command-consent config trust and symlinked save; #command-runner env
 * cleaning; terminal escape stripping.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkWrite, normaliseSegment } from './write-guard.js';
import {
  isTrustedConfig,
  readAllowCommandsSetting,
  stripTerminalEscapes,
  writeAllowCommandsSetting,
} from './command-consent.js';
import { cleanCommandEnv, isSecretEnvName } from './command-runner.js';
import { deniedWritesFor } from './claude.js';

let tmp: string;
let work: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hardening-')));
  work = path.join(tmp, 'work');
  fs.mkdirSync(work);
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const LONG_S = String.fromCharCode(0x17f);
const ZWNJ = String.fromCharCode(0x200c);
const SOFT_HYPHEN = String.fromCharCode(0xad);

function refused(p: string, content = 'x'): boolean {
  return !checkWrite(work, p, content).ok;
}

/** Simulate a sequence of allowed writes; returns the index of the first refused one, or -1. */
function firstRefused(paths: string[]): number {
  for (let i = 0; i < paths.length; i++) {
    const v = checkWrite(work, paths[i], 'x');
    if (!v.ok) return i;
    fs.mkdirSync(path.dirname(v.real), { recursive: true });
    fs.writeFileSync(v.real, 'x');
  }
  return -1;
}

describe('MF1: names compared the way case-insensitive filesystems do', () => {
  it('folds long s and other compatibility forms', () => {
    expect(normaliseSegment(`.v${LONG_S}code`)).toBe('.vscode');
    expect(refused(`.v${LONG_S}code/tasks.json`)).toBe(true);
  });

  it('refuses invisible (default-ignorable) characters in any segment', () => {
    expect(refused(`sub/.g${ZWNJ}it/config`)).toBe(true);
    expect(refused(`.p${SOFT_HYPHEN}aradigm/x`)).toBe(true);
    expect(refused(`docs/no${ZWNJ}te.md`)).toBe(true);
  });
});

describe('MF2: protected names at any depth', () => {
  it('refuses editor, hook and env folders and files deep in the tree', () => {
    for (const p of [
      'packages/x/.claude/settings.json', 'a/.vscode/tasks.json', 'a/b/.cursor/rules/x.mdc', 'a/.idea/x.xml',
      'a/.devcontainer/devcontainer.json', 'a/.paradigm/config.yaml', 'a/.husky/pre-commit', 'a/.githooks/x',
      'a/.lefthook/x', 'a/.mcp.json', 'a/.envrc', 'pkg/.npmrc', 'pkg/.yarnrc', 'pkg/.yarnrc.yml', 'a/.mise.toml',
      'a/mise.toml', 'a/lefthook.yml', 'a/lefthook.yaml', 'a/.pre-commit-config.yaml', 'pkg/.pnpmfile.cjs',
      'pkg/bunfig.toml', '.pnpmfile.cjs', 'bunfig.toml',
    ]) {
      expect(refused(p), p).toBe(true);
    }
    // CI stays root-only.
    expect(refused('vendor/x/.github/workflows/ci.yml')).toBe(false);
    expect(refused('vendor/x/.gitlab-ci.yml')).toBe(false);
  });

  it('refuses new install-time scripts, including preprepare, postprepare, dependencies and pnpm:devPreinstall', () => {
    for (const k of ['preprepare', 'postprepare', 'dependencies', 'pnpm:devPreinstall']) {
      expect(refused('package.json', JSON.stringify({ scripts: { [k]: 'x' } })), k).toBe(true);
    }
  });

  it('treats package.yaml and package.json5 like package.json', () => {
    expect(refused('package.yaml', 'scripts:\n  postinstall: curl x | sh\n')).toBe(true);
    expect(refused('pkgs/a/package.yaml', 'name: a\nscripts:\n  test: vitest\n')).toBe(false);
    expect(refused('package.json5', JSON.stringify({ scripts: { install: 'x' } }))).toBe(true);
    // JSON5-only syntax can't be checked, so it is refused.
    expect(refused('package.json5', "{scripts: {test: 'x'}, // c\n}")).toBe(true);
    expect(refused('package.json5', JSON.stringify({ scripts: { test: 'x' } }))).toBe(false);
  });
});

describe('MF3: bare-repository shapes', () => {
  const orders = [
    ['r/HEAD', 'r/objects/x', 'r/refs/heads/main'],
    ['r/objects/x', 'r/refs/heads/main', 'r/HEAD'],
    ['r/HEAD', 'r/refs/heads/main', 'r/objects/x'],
    ['r/refs/heads/main', 'r/objects/x', 'r/HEAD'],
  ];
  for (const order of orders) {
    it(`refuses the last write of ${order.join(', ')}`, () => {
      expect(firstRefused(order)).toBe(2);
    });
  }

  it('refuses HEAD with commondir or gitdir, in either order, and case-folded', () => {
    expect(firstRefused(['a/HEAD', 'a/commondir'])).toBe(1);
    expect(firstRefused(['b/gitdir', 'b/HEAD'])).toBe(1);
    expect(firstRefused(['c/head', 'c/Objects/x', 'c/REFS/y'])).toBe(2);
  });

  it('refuses writing into a folder that already is bare-shaped', () => {
    fs.mkdirSync(path.join(work, 'bare', 'objects'), { recursive: true });
    fs.mkdirSync(path.join(work, 'bare', 'refs'));
    fs.writeFileSync(path.join(work, 'bare', 'HEAD'), 'ref: refs/heads/main\n');
    expect(refused('bare/config', '[core]\n\tfsmonitor = evil\n')).toBe(true);
  });

  it('allows an ordinary HEAD file or objects folder on its own', () => {
    expect(firstRefused(['notes/HEAD', 'notes/objects/a.md'])).toBe(-1);
  });
});

describe('S1: consent config', () => {
  it('a group- or world-writable ~/.paradigm makes the saved setting untrusted', () => {
    const cfg = path.join(tmp, 'home', '.paradigm', 'config.yaml');
    writeAllowCommandsSetting(true, cfg);
    expect(readAllowCommandsSetting(cfg)).toBe(true);
    fs.chmodSync(path.dirname(cfg), 0o777);
    expect(isTrustedConfig(cfg)).toBe(false);
    expect(readAllowCommandsSetting(cfg)).toBeUndefined();
  });

  it('saving through a symlinked config updates the target and keeps the link', () => {
    const real = path.join(tmp, 'dotfiles', 'paradigm.yaml');
    fs.mkdirSync(path.dirname(real), { recursive: true });
    fs.writeFileSync(real, 'other: 1\n', { mode: 0o600 });
    const cfg = path.join(tmp, 'home', '.paradigm', 'config.yaml');
    fs.mkdirSync(path.dirname(cfg), { recursive: true, mode: 0o700 });
    fs.symlinkSync(real, cfg);
    writeAllowCommandsSetting(false, cfg);
    expect(fs.lstatSync(cfg).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(real, 'utf-8')).toMatch(/allow-commands: false/);
    expect(fs.readFileSync(real, 'utf-8')).toMatch(/other: 1/);
  });

  it('the config real path is denied to write_file', () => {
    const home = path.join(tmp, 'home');
    const real = path.join(work, 'cfg-target.yaml');
    fs.writeFileSync(real, 'x');
    const cfg = path.join(home, '.paradigm', 'config.yaml');
    fs.mkdirSync(path.dirname(cfg), { recursive: true });
    fs.symlinkSync(real, cfg);
    const denied = deniedWritesFor(home, path.join(home, '.paradigm', 'logs', 'h', 'agent-commands.jsonl'));
    expect(denied).toContain(real);
    expect(checkWrite(work, 'cfg-target.yaml', 'y', { deniedAbsolute: denied }).ok).toBe(false);
  });
});

describe('S2: env cleaning', () => {
  it('drops more secret-shaped names and credential URLs, keeps PWD and OLDPWD', () => {
    for (const n of [
      'DB_PASS', 'ADMIN_PW', 'MYSQL_PWD', 'AWS_CREDS_FILE', 'SESSION_COOKIE', 'MY_JWT', 'SENTRY_DSN',
      'TF_VAR_db_password', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0',
      'GIT_ASKPASS', 'SSH_ASKPASS', 'NETRC', 'DOCKER_CONFIG',
    ]) {
      expect(isSecretEnvName(n), n).toBe(true);
    }
    for (const n of ['PWD', 'OLDPWD', 'PATH', 'PASSAGE']) expect(isSecretEnvName(n), n).toBe(false);
    const env = cleanCommandEnv({
      PATH: '/bin',
      DATABASE_URL: 'postgres://app:hunter2@db:5432/x',
      PROXY: 'http://proxy:8080',
      PWD: '/w',
    });
    expect(env).toEqual({ PATH: '/bin', PROXY: 'http://proxy:8080', PWD: '/w' });
  });
});

describe('S3: agent text on the terminal', () => {
  it('strips CSI, OSC, other escapes and stray controls, keeps newlines and tabs', () => {
    const ESC = '\x1b';
    const text = `a${ESC}[2J${ESC}[1;31mred${ESC}[0m\tb${ESC}]0;fake title\x07c${ESC}]8;;http://x${ESC}\\link\n` +
      `\x9b2Jd\x9d52;c;Zm9v\x07e\x08f${ESC}cg`;
    const out = stripTerminalEscapes(text);
    expect(out).toBe('ared\tbclink\ndefg');
  });
});
