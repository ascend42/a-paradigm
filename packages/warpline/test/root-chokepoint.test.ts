/**
 * root-chokepoint.test — the D-7 explicit root (soundness audit 2026-07-31).
 *
 * Before this, every skin resolved its target as
 * `await repoRoot().catch(() => process.cwd())` at ~31 inline call sites, so
 * EVERY command targeted the live fabric by default and there was no way to say
 * otherwise. This proves the three things the audit asked for:
 *
 *   1. `--root` redirects a REAL WRITE VERB to a scratch dir (and the cwd repo
 *      is left with no .warpline/ at all);
 *   2. `WARPLINE_ROOT` does the same;
 *   3. the precedence holds (flag > env > git rev-parse > cwd), and with
 *      neither set the behaviour is byte-identical to before.
 *
 * NEVER against the live fabric — every write here lands in os.tmpdir().
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  resolveRoot,
  setExplicitRoot,
  explicitRootOf,
  extractRootFlag,
  ROOT_ENV,
} from '../src/root.js';
import { repoRoot } from '../src/git/git-exec.js';

const execFileAsync = promisify(execFile);
const distCli = path.resolve(fileURLToPath(new URL('../dist/cli.js', import.meta.url)));
const haveDist = existsSync(distCli);

/* ── 1. argv extraction — the flag is legal in ANY position ─────────────────── */

describe('#warpline-root — extractRootFlag', () => {
  it('lifts --root before the subcommand and leaves the rest untouched', () => {
    expect(extractRootFlag(['--root', '/tmp/x', 'fork', 'a'])).toEqual({
      argv: ['fork', 'a'],
      root: '/tmp/x',
    });
  });

  it('lifts --root AFTER the subcommand too (commander alone would reject it)', () => {
    expect(extractRootFlag(['fork', 'a', '--root', '/tmp/x', '--json'])).toEqual({
      argv: ['fork', 'a', '--json'],
      root: '/tmp/x',
    });
  });

  it('accepts --root=<dir>', () => {
    expect(extractRootFlag(['admit', 'a', '--root=/tmp/x'])).toEqual({
      argv: ['admit', 'a'],
      root: '/tmp/x',
    });
  });

  it('returns root:null and an IDENTICAL argv when the flag is absent', () => {
    const argv = ['restore', 'HEAD', '--to', '/tmp/x', '--force'];
    expect(extractRootFlag(argv)).toEqual({ argv, root: null });
  });

  it('stops at a bare -- (everything after it is data, never a flag)', () => {
    expect(extractRootFlag(['diff', '--', '--root', 'weird-file'])).toEqual({
      argv: ['diff', '--', '--root', 'weird-file'],
      root: null,
    });
  });

  it('refuses --root with no value (a swallowed next flag is how a typo lands a write elsewhere)', () => {
    expect(() => extractRootFlag(['--root'])).toThrow(/needs a directory argument/);
    expect(() => extractRootFlag(['--root', '--json', 'fork'])).toThrow(/needs a directory argument/);
    expect(() => extractRootFlag(['--root='])).toThrow(/needs a directory argument/);
  });
});

/* ── 2. resolveRoot precedence ──────────────────────────────────────────────── */

describe('#warpline-root — resolveRoot precedence: --root > WARPLINE_ROOT > git > cwd', () => {
  let scratchA: string;
  let scratchB: string;
  const savedEnv = process.env[ROOT_ENV];

  beforeAll(() => {
    scratchA = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wl-root-a-')));
    scratchB = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wl-root-b-')));
  });

  afterEach(() => {
    setExplicitRoot(null);
    if (savedEnv === undefined) delete process.env[ROOT_ENV];
    else process.env[ROOT_ENV] = savedEnv;
  });

  afterAll(() => {
    fs.rmSync(scratchA, { recursive: true, force: true });
    fs.rmSync(scratchB, { recursive: true, force: true });
  });

  it('with NEITHER set, resolves exactly what the old inline expression resolved', async () => {
    delete process.env[ROOT_ENV];
    setExplicitRoot(null);
    expect(explicitRootOf()).toBeNull();
    const legacy = await repoRoot().catch(() => process.cwd());
    expect(await resolveRoot()).toBe(legacy);
  });

  it('WARPLINE_ROOT overrides git rev-parse', async () => {
    process.env[ROOT_ENV] = scratchA;
    expect(await resolveRoot()).toBe(scratchA);
  });

  it('an explicit --root beats WARPLINE_ROOT', async () => {
    process.env[ROOT_ENV] = scratchA;
    setExplicitRoot(scratchB);
    expect(await resolveRoot()).toBe(scratchB);
  });

  it('absolutizes a relative explicit root', async () => {
    setExplicitRoot('.');
    expect(await resolveRoot()).toBe(path.resolve('.'));
  });

  it('an empty WARPLINE_ROOT is ignored (falls through to git), never treated as "/"', async () => {
    process.env[ROOT_ENV] = '   ';
    const legacy = await repoRoot().catch(() => process.cwd());
    expect(await resolveRoot()).toBe(legacy);
  });

  it('a nonexistent explicit root REFUSES — a typo never auto-mints a second fabric', async () => {
    const ghost = path.join(scratchA, 'no-such-dir');
    expect(() => setExplicitRoot(ghost)).toThrow(/does not exist/);
    process.env[ROOT_ENV] = ghost;
    await expect(resolveRoot()).rejects.toThrow(/does not exist/);
  });

  it('an explicit root that is a FILE refuses', async () => {
    const f = path.join(scratchA, 'a-file');
    fs.writeFileSync(f, 'x');
    expect(() => setExplicitRoot(f)).toThrow(/not a real directory/);
  });
});

/* ── 3. the real CLI, redirecting a real WRITE verb ─────────────────────────── */

describe('#warpline-root — the CLI redirects a real write verb (D-7)', () => {
  let cwdRepo: string;
  let target: string;
  let other: string;

  interface Run {
    code: number;
    stdout: string;
    stderr: string;
  }

  /** Drive the real CLI. `cwd` is ALWAYS a scratch git repo, never this one. */
  const cli = async (args: string[], env: NodeJS.ProcessEnv = {}): Promise<Run> => {
    const clean = { ...process.env };
    delete clean[ROOT_ENV];
    try {
      const { stdout, stderr } = await execFileAsync('node', [distCli, ...args], {
        cwd: cwdRepo,
        encoding: 'utf8',
        env: { ...clean, ...env },
      });
      return { code: 0, stdout, stderr };
    } catch (err) {
      const e = err as { code?: number; stdout?: string; stderr?: string };
      return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
    }
  };

  const wroteInto = (dir: string): boolean => existsSync(path.join(dir, '.warpline'));

  beforeAll(async () => {
    cwdRepo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wl-root-cwd-')));
    target = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wl-root-tgt-')));
    other = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wl-root-oth-')));
    // cwdRepo is a REAL git repo, so repoRoot() succeeds there — this is the
    // case D-7 is about: git works, and it points at the wrong fabric.
    await execFileAsync('git', ['init', '-q'], { cwd: cwdRepo });
  }, 60_000);

  afterAll(() => {
    for (const d of [cwdRepo, target, other]) fs.rmSync(d, { recursive: true, force: true });
  });

  afterEach(() => {
    for (const d of [cwdRepo, target, other]) {
      fs.rmSync(path.join(d, '.warpline'), { recursive: true, force: true });
    }
  });

  it.skipIf(!haveDist)('--root redirects the write; the cwd repo gets NOTHING', async () => {
    const r = await cli(['--root', target, 'fork', 'agent-a', '--json']);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
    expect(wroteInto(target)).toBe(true);
    expect(wroteInto(cwdRepo)).toBe(false);
  });

  it.skipIf(!haveDist)('--root is accepted AFTER the subcommand too', async () => {
    const r = await cli(['fork', 'agent-a', '--root', target, '--json']);
    expect(r.code).toBe(0);
    expect(wroteInto(target)).toBe(true);
    expect(wroteInto(cwdRepo)).toBe(false);
  });

  it.skipIf(!haveDist)('WARPLINE_ROOT redirects the write; the cwd repo gets NOTHING', async () => {
    const r = await cli(['fork', 'agent-a', '--json'], { [ROOT_ENV]: target });
    expect(r.code).toBe(0);
    expect(wroteInto(target)).toBe(true);
    expect(wroteInto(cwdRepo)).toBe(false);
  });

  it.skipIf(!haveDist)('--root beats WARPLINE_ROOT beats git rev-parse', async () => {
    const r = await cli(['--root', target, 'fork', 'agent-a', '--json'], { [ROOT_ENV]: other });
    expect(r.code).toBe(0);
    expect(wroteInto(target)).toBe(true);
    expect(wroteInto(other)).toBe(false);
    expect(wroteInto(cwdRepo)).toBe(false);
  });

  it.skipIf(!haveDist)('with NEITHER set the write still lands in the git root (unchanged behaviour)', async () => {
    const r = await cli(['fork', 'agent-a', '--json']);
    expect(r.code).toBe(0);
    expect(wroteInto(cwdRepo)).toBe(true);
    expect(wroteInto(target)).toBe(false);
  });

  it.skipIf(!haveDist)('a nonexistent --root refuses BEFORE any write happens', async () => {
    const ghost = path.join(other, 'nope');
    const r = await cli(['--root', ghost, 'fork', 'agent-a', '--json']);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/does not exist/);
    expect(existsSync(ghost)).toBe(false);
    expect(wroteInto(cwdRepo)).toBe(false);
  });
});
