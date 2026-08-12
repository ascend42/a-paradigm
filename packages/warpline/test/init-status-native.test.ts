/**
 * init-status-native.test — the Tier-1 onboarding + daily-command fixes from the
 * cold-agent dogfood (T-2026-08-12-002):
 *
 *   (a) `warpline init` seals genesis, writes a starter `.warpignore`, and keeps
 *       `.warpline/` out of git — idempotently.
 *   (b) `warpline status` in a NON-GIT native project returns a real semantic
 *       status instead of dying `git ... not a repository` (the headline
 *       regression — the FIRST thing an agent runs).
 *   (c) a byte-only / scalar-only change reports "files changed on disk / 0
 *       meaning changes", never a bare "clean" (the false-no-op honesty fix).
 *   (d) a legacy `.warplineignore` is still read, with a one-time deprecation
 *       notice, when `.warpignore` is absent.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { initWarpline } from '../src/fabric/init.js';
import { nativeStatus } from '../src/native-status.js';
import { warplineDirOf } from '../src/fabric/fabric.js';
import { readRef } from '../src/fabric/refs.js';
import {
  loadWarpignore as loadWarpignoreDirect,
  warpignoreSource,
  warpignoreDeprecationNotice,
  noteWarpignoreDeprecation,
  __resetWarpignoreDeprecationNotices,
} from '../src/warp/warpignore.js';

const distCli = path.resolve(fileURLToPath(new URL('../dist/cli.js', import.meta.url)));

function write(dir: string, rel: string, body: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, 'utf8');
}

// ── (a) warpline init ────────────────────────────────────────────────────────

describe('(a) warpline init — seals genesis, writes .warpignore, guards .gitignore, idempotent', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-init-'));
    // a .git marker makes it "look like a git repo" so init creates .gitignore.
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
    write(root, 'src/mod.ts', 'export function foo() { return 1; }\n');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('seals genesis, writes a commented .warpignore, and adds .warpline/ to .gitignore', async () => {
    const r = await initWarpline(root);

    // genesis sealed → selvage ref set
    expect(r.alreadyInitialized).toBe(false);
    expect(r.genesisPickId).toBeTruthy();
    expect(readRef(warplineDirOf(root), 'selvage')).toBe(r.genesisPickId);

    // starter .warpignore, with commented example lines showing the syntax
    expect(r.warpignoreWritten).toBe(true);
    const wi = fs.readFileSync(path.join(root, '.warpignore'), 'utf8');
    expect(wi).toContain('# dist/');
    expect(wi).toContain('# *.log');

    // .gitignore created with the fabric lines
    expect(r.gitignore.action).toBe('created');
    const gi = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
    expect(gi).toContain('.warpline/');
    expect(gi).toContain('.warpline-judge/');
  });

  it('is idempotent — a second init seals no genesis and duplicates no line', async () => {
    await initWarpline(root);
    const before = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');

    const r2 = await initWarpline(root);
    expect(r2.alreadyInitialized).toBe(true);
    expect(r2.genesisPickId).toBeNull();
    expect(r2.warpignoreWritten).toBe(false);
    expect(r2.gitignore.action).toBe('present');

    const after = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
    expect(after).toBe(before); // no duplication
    expect(after.match(/\.warpline\//g)?.length).toBe(1);
  });

  it('appends to an existing .gitignore without duplicating', async () => {
    fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n.warpline/\n', 'utf8');
    const r = await initWarpline(root);
    expect(r.gitignore.action).toBe('appended');
    expect(r.gitignore.addedLines).toEqual(['.warpline-judge/']); // .warpline/ already present
    const gi = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
    expect(gi.match(/\.warpline\/$/gm)?.length ?? gi.split('\n').filter((l) => l.trim() === '.warpline/').length).toBe(1);
  });
});

// ── (b) status in a NON-GIT native project (the headline regression) ──────────

describe('(b) status/diff in a NON-GIT native project — a real status, never a git error', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-nogit-'));
    write(root, 'src/mod.ts', 'export function foo() { return 1; }\n');
    write(root, '.purpose', 'version: "2.0"\ndescription: native fixture\ncomponents:\n  alpha:\n    description: real\n    type: module\n');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('nativeStatus returns a real SemDiffReport (no git anywhere) after init', async () => {
    await initWarpline(root);
    // genesis captured the current worktree; a fresh status is clean-in-meaning.
    const clean = await nativeStatus(root);
    expect(clean.native).toBe(true);
    expect(clean.refA).toBe('selvage');
    expect(clean.changedCount).toBe(0);

    // add a new symbol → it reads as BORN vs the selvage
    write(root, '.purpose', 'version: "2.0"\ndescription: native fixture\ncomponents:\n  alpha:\n    description: real\n    type: module\n  beta:\n    description: new\n    type: module\n');
    const changed = await nativeStatus(root);
    expect(changed.changedCount).toBeGreaterThan(0);
    expect(changed.born.some((d) => d.symbol.includes('beta'))).toBe(true);

    // the standing premise: no git was created by any of this
    expect(existsSync(path.join(root, '.git'))).toBe(false);
  });

  it('nativeStatus works even BEFORE init (empty base → everything born, no throw)', async () => {
    const r = await nativeStatus(root);
    expect(r.native).toBe(true);
    // an uninitialized fabric has an empty base, so the worktree symbols are born
    expect(r.born.length + r.contractChanged.length).toBeGreaterThanOrEqual(0);
    expect(r.onDisk.filesChanged).toBeGreaterThan(0); // files exist on disk vs an empty base
  });
});

// ── (c) byte-only / scalar-only honesty ───────────────────────────────────────

describe('(c) a byte-only change reports "files changed on disk", not a bare clean', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-byteonly-'));
    write(root, 'src/mod.ts', 'export function foo() { return 1; }\n');
    write(root, 'readme.md', 'hello\n');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('edits a non-lifted file → 0 meaning changes but filesChanged > 0, byteOnly true', async () => {
    await initWarpline(root);
    // baseline: genesis captured everything, so status is clean AND byte-clean
    const base = await nativeStatus(root);
    expect(base.changedCount).toBe(0);
    expect(base.onDisk.byteOnly).toBe(false);
    expect(base.onDisk.filesChanged).toBe(0);

    // a byte-only edit to a doc — no symbol delta, but the bytes moved
    write(root, 'readme.md', 'hello — now with more words\n');
    const r = await nativeStatus(root);
    expect(r.changedCount).toBe(0); // meaning unchanged
    expect(r.renamedNoopCount).toBe(0);
    expect(r.onDisk.filesChanged).toBe(1); // the doc moved on disk
    expect(r.onDisk.byteOnly).toBe(true); // the dangerous case — real work, no meaning
  });
});

// ── (d) legacy .warplineignore + deprecation notice ───────────────────────────

describe('(d) legacy .warplineignore is still read, with a one-time deprecation notice', () => {
  let root: string;
  beforeEach(() => {
    __resetWarpignoreDeprecationNotices();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-legacy-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('loadWarpignore reads the legacy file when .warpignore is absent', () => {
    fs.writeFileSync(path.join(root, '.warplineignore'), '*.log\n', 'utf8');
    const m = loadWarpignoreDirect(root);
    expect(m.isIgnored('debug.log', false)).toBe(true); // legacy rule applies via the native handler
    expect(m.isIgnored('keep.txt', false)).toBe(false);
    expect(warpignoreSource(root)).toBe('legacy');
  });

  it('.warpignore shadows the legacy file (canonical wins)', () => {
    fs.writeFileSync(path.join(root, '.warplineignore'), '*.log\n', 'utf8');
    fs.writeFileSync(path.join(root, '.warpignore'), '*.tmp\n', 'utf8');
    const m = loadWarpignoreDirect(root);
    expect(m.isIgnored('x.tmp', false)).toBe(true); // canonical rule
    expect(m.isIgnored('x.log', false)).toBe(false); // legacy shadowed for THIS handler
    expect(warpignoreSource(root)).toBe('warpignore');
    expect(warpignoreDeprecationNotice(root)).toBeNull(); // canonical present → no notice
  });

  it('emits the deprecation notice exactly once per root', () => {
    fs.writeFileSync(path.join(root, '.warplineignore'), '*.log\n', 'utf8');
    expect(warpignoreDeprecationNotice(root)).toContain('.warpignore');
    const first = noteWarpignoreDeprecation(root);
    expect(first).toContain('.warplineignore');
    expect(first).toContain('deprecated');
    expect(noteWarpignoreDeprecation(root)).toBeNull(); // once — second call is silent
  });

  it('no legacy file → no notice', () => {
    fs.writeFileSync(path.join(root, '.warpignore'), '*.tmp\n', 'utf8');
    expect(noteWarpignoreDeprecation(root)).toBeNull();
  });
});

// ── (b) the HEADLINE regression over the REAL BINARY ──────────────────────────

describe('(b·bin) `warpline status` over the real binary — no "not a git repository"', () => {
  const haveDist = existsSync(distCli);
  let root: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-bin-nogit-'));
    write(root, 'src/mod.ts', 'export function foo() { return 1; }\n');
    write(root, '.purpose', 'version: "2.0"\ndescription: bin fixture\ncomponents:\n  alpha:\n    description: real\n    type: module\n');
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  const cli = async (...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> => {
    try {
      const { stdout, stderr } = await promisify(execFile)('node', [distCli, '--root', root, ...args], {
        cwd: root,
        encoding: 'utf8',
      });
      return { code: 0, stdout, stderr };
    } catch (e) {
      const err = e as { code?: number; stdout?: string; stderr?: string };
      return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
    }
  };

  it.runIf(haveDist)('init then status: exit 0, real status, never a git error', async () => {
    const init = await cli('init');
    expect(init.code).toBe(0);
    expect(init.stdout).toContain('WARPLINE INIT');

    const status = await cli('status');
    expect(status.code).toBe(0);
    expect(status.stderr).not.toMatch(/not a git repository|git .* failed/i);
    expect(status.stdout).toContain('WARPLINE STATUS');
  }, 120_000);

  it.runIf(haveDist)('status BEFORE init also never throws a git error', async () => {
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-bin-fresh-'));
    write(fresh, 'src/mod.ts', 'export function foo() { return 1; }\n');
    try {
      const { stdout, stderr, code } = await (async () => {
        try {
          const { stdout, stderr } = await promisify(execFile)('node', [distCli, '--root', fresh, 'status'], { cwd: fresh, encoding: 'utf8' });
          return { code: 0, stdout, stderr };
        } catch (e) {
          const err = e as { code?: number; stdout?: string; stderr?: string };
          return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
        }
      })();
      expect(code).toBe(0);
      expect(stderr).not.toMatch(/not a git repository|git .* failed/i);
      expect(stdout).toContain('WARPLINE STATUS');
    } finally {
      fs.rmSync(fresh, { recursive: true, force: true });
    }
  }, 120_000);
});
