/**
 * dirty-write-back-guard.test — C-5 (soundness audit 2026-07-31, Shield F-1).
 *
 * "CLEAN admit silently destroys uncommitted work, unrecoverably."
 *
 * `native.ts` called `restoreTree` RAW on the merged tree, so a CLEAN admission
 * overwrote the agent's working directory with three amplifiers, each verified
 * by the audit:
 *   - the blast radius is the WHOLE MERGED TREE, not the merged paths — a file
 *     touched by neither side is overwritten too;
 *   - the default target is the human's own repo root;
 *   - there was no `--no-restore` on the CLI, so a CLI caller could not decline.
 * And the clobbered bytes are in NO object: `propose` snapshotted BEFORE the
 * edit and the write-back snapshots nothing. No stash, no reflog, no undo.
 *
 * The guard already existed (restore.ts) and was bypassed — and it asked the
 * wrong question ("is the dest directory empty?"), which an in-place restore can
 * never satisfy, so `--force` was mandatory for the normal case and the guard
 * trained its own bypass.
 *
 * This pins the fixed policy: PER-PATH, refusing exactly when a colliding path's
 * current bytes are in no object, on all three write-backs (admit, fork --into,
 * restore) — while a CLEAN worktree still writes back normally, because a guard
 * that blocks real work is its own defect.
 *
 * NEVER against the live fabric — every fixture is an os.tmpdir() directory that
 * was never a git repo.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { forkNative, proposeNative, admitNative } from '../src/fabric/native.js';
import { restore, collectDirtyCollisions } from '../src/fabric/restore.js';
import { ObjectStore } from '../src/warp/object-store.js';
import { warplineDirOf } from '../src/fabric/fabric.js';
import { readRef } from '../src/fabric/refs.js';
import { readScratch } from '../src/fabric/scratch.js';

const execFileAsync = promisify(execFile);
const distCli = path.resolve(fileURLToPath(new URL('../dist/cli.js', import.meta.url)));
const haveDist = existsSync(distCli);

const MOD = 'src/mod.ts';
const BASE = 'export function foo() { return 1; }\nexport function bar() { return 2; }\n';
const A_EDIT = 'export function foo() { return 10; }\nexport function bar() { return 2; }\n';
const B_EDIT = 'export function foo() { return 1; }\nexport function bar() { return 20; }\n';
const MERGED = 'export function foo() { return 10; }\nexport function bar() { return 20; }\n';
const README = 'untouched by either side\n';

function write(dir: string, rel: string, body: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, 'utf8');
}

function read(dir: string, rel: string): string {
  return fs.readFileSync(path.join(dir, rel), 'utf8');
}

interface World {
  root: string;
  dirA: string;
  dirB: string;
  /** B's proposal is sealed and A has advanced the selvage — admit(B) is a CLEAN weave. */
  bClaimId?: string;
}

/**
 * Seed the exact concurrency the audit's finding lives on: A and B fork the same
 * selvage, A admits (fast-forward), B proposes — so admit(B) must weave, and the
 * weave's write-back is the thing that used to clobber B's worktree.
 */
async function seedConcurrentClean(): Promise<World> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-c5-root-'));
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-c5-A-'));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-c5-B-'));
  write(root, MOD, BASE);
  write(root, 'readme.md', README);

  await proposeNative(root, { worktree: root, agentId: 'genesis', intent: 'genesis' });
  await admitNative(root, { worktree: root, agentId: 'genesis' });

  forkNative(root, 'A', { into: dirA });
  forkNative(root, 'B', { into: dirB });

  write(dirA, MOD, A_EDIT);
  await proposeNative(root, { worktree: dirA, agentId: 'A', intent: 'A: foo → 10' });
  const aa = await admitNative(root, { worktree: dirA, agentId: 'A' });
  expect(aa.sealed).toBe(true);
  expect(aa.decision.status).toBe('FAST_ADMIT');

  write(dirB, MOD, B_EDIT);
  const pb = await proposeNative(root, { worktree: dirB, agentId: 'B', intent: 'B: bar → 20' });
  expect(pb.noop).toBe(false);

  return { root, dirA, dirB };
}

describe('#restore — the C-5 dirty write-back guard on a CLEAN admit', () => {
  let w: World;

  beforeEach(async () => {
    w = await seedConcurrentClean();
  }, 60_000);

  afterEach(() => {
    for (const d of [w.root, w.dirA, w.dirB]) fs.rmSync(d, { recursive: true, force: true });
  });

  it('a CLEAN worktree still writes back normally (the guard must not block real work)', async () => {
    const ab = await admitNative(w.root, { worktree: w.dirB, agentId: 'B' });
    expect(ab.decision.status).toBe('CLEAN');
    expect(ab.sealed).toBe(true);
    expect(ab.restoredEntries).toBeGreaterThan(0);
    expect(read(w.dirB, MOD)).toBe(MERGED); // the merge legitimately changed a file B never touched since propose
    expect(read(w.dirB, 'readme.md')).toBe(README);
  });

  it('a dirty path INSIDE the merged set refuses, and the bytes survive', async () => {
    const uncommitted = 'export function foo() { return 1; }\nexport function bar() { return 20; }\n// WORK NOBODY HAS A COPY OF\n';
    write(w.dirB, MOD, uncommitted);

    await expect(admitNative(w.root, { worktree: w.dirB, agentId: 'B' })).rejects.toThrow(
      /refusing to overwrite 1 path .* in NO object/s,
    );
    expect(read(w.dirB, MOD)).toBe(uncommitted); // NOT clobbered
  });

  it('a dirty path OUTSIDE the merged set refuses too — the blast radius is the WHOLE merged tree', async () => {
    // readme.md was touched by neither side, so it is not in the merge plan at
    // all; the raw restoreTree overwrote it anyway. That is the amplifier.
    const uncommitted = 'notes nobody has a copy of\n';
    write(w.dirB, 'readme.md', uncommitted);

    await expect(admitNative(w.root, { worktree: w.dirB, agentId: 'B' })).rejects.toThrow(/readme\.md \(modified\)/);
    expect(read(w.dirB, 'readme.md')).toBe(uncommitted);
  });

  it('an UNTRACKED file is never a collision and is never touched (overlay semantics)', async () => {
    write(w.dirB, 'scratch-notes.txt', 'mine\n');
    write(w.dirB, 'deep/nested/new.txt', 'also mine\n');

    const ab = await admitNative(w.root, { worktree: w.dirB, agentId: 'B' });
    expect(ab.sealed).toBe(true);
    expect(read(w.dirB, 'scratch-notes.txt')).toBe('mine\n');
    expect(read(w.dirB, 'deep/nested/new.txt')).toBe('also mine\n');
    expect(read(w.dirB, MOD)).toBe(MERGED);
  });

  it('the refusal happens BEFORE the seal — nothing is half-committed', async () => {
    const wdir = warplineDirOf(w.root);
    const selvageBefore = readRef(wdir, 'selvage');
    const scratchBefore = readScratch(w.root, 'B');
    write(w.dirB, MOD, 'dirty\n');

    await expect(admitNative(w.root, { worktree: w.dirB, agentId: 'B' })).rejects.toThrow(/refusing to overwrite/);

    expect(readRef(wdir, 'selvage')).toBe(selvageBefore); // the selvage did not move
    expect(readScratch(w.root, 'B')).toBe(scratchBefore); // B still owns its sealed proposal
  });

  it('--no-restore is the escape: the merge SEALS and the dirty bytes are left exactly as they are', async () => {
    const uncommitted = 'export function foo() { return 1; }\nexport function bar() { return 20; }\n// keep me\n';
    write(w.dirB, MOD, uncommitted);
    write(w.dirB, 'readme.md', 'also mine\n');

    const ab = await admitNative(w.root, { worktree: w.dirB, agentId: 'B', noRestore: true });
    expect(ab.decision.status).toBe('CLEAN');
    expect(ab.sealed).toBe(true);
    expect(ab.restoredEntries).toBeUndefined();
    expect(read(w.dirB, MOD)).toBe(uncommitted);
    expect(read(w.dirB, 'readme.md')).toBe('also mine\n');
    // and the merged bytes are recoverable on demand — nothing was lost either way
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-c5-out-'));
    try {
      restore(w.root, { selector: 'HEAD', to: out });
      expect(read(out, MOD)).toBe(MERGED);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  it('names EVERY unrecoverable path, not just the first', async () => {
    write(w.dirB, MOD, 'dirty one\n');
    write(w.dirB, 'readme.md', 'dirty two\n');
    await expect(admitNative(w.root, { worktree: w.dirB, agentId: 'B' })).rejects.toThrow(
      /refusing to overwrite 2 paths/,
    );
  });
});

describe('#restore — the guard on fork --into (C-5: it called restoreTree raw)', () => {
  let root: string;
  let into: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-c5f-root-'));
    into = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-c5f-into-'));
    write(root, MOD, BASE);
    write(root, 'readme.md', README);
    await proposeNative(root, { worktree: root, agentId: 'genesis', intent: 'genesis' });
    await admitNative(root, { worktree: root, agentId: 'genesis' });
  }, 60_000);

  afterEach(() => {
    for (const d of [root, into]) fs.rmSync(d, { recursive: true, force: true });
  });

  it('refuses to overwrite a colliding path whose bytes are in no object', () => {
    write(into, MOD, 'work in progress nobody has a copy of\n');
    expect(() => forkNative(root, 'X', { into })).toThrow(/refusing to overwrite 1 path/);
    expect(read(into, MOD)).toBe('work in progress nobody has a copy of\n');
  });

  it('--force still overrides', () => {
    write(into, MOD, 'work in progress\n');
    const r = forkNative(root, 'X', { into, force: true });
    expect(r.restoredEntries).toBeGreaterThan(0);
    expect(read(into, MOD)).toBe(BASE);
  });

  it('an unrelated file in the dest is NOT a collision — a fork into a populated dir still works', () => {
    write(into, 'my-notes.txt', 'mine\n');
    const r = forkNative(root, 'X', { into });
    expect(r.restoredEntries).toBeGreaterThan(0);
    expect(read(into, MOD)).toBe(BASE);
    expect(read(into, 'my-notes.txt')).toBe('mine\n');
  });

  it('an IDENTICAL colliding path is not a collision — the write is a no-op', () => {
    write(into, MOD, BASE);
    const r = forkNative(root, 'X', { into });
    expect(r.restoredEntries).toBeGreaterThan(0);
    expect(read(into, MOD)).toBe(BASE);
  });
});

describe('#restore — the restore verb: per-path, not dir-emptiness', () => {
  let root: string;
  let out: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-c5r-root-'));
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-c5r-out-'));
    write(root, MOD, BASE);
    write(root, 'readme.md', README);
    await proposeNative(root, { worktree: root, agentId: 'genesis', intent: 'genesis' });
    await admitNative(root, { worktree: root, agentId: 'genesis' });
  }, 60_000);

  afterEach(() => {
    for (const d of [root, out]) fs.rmSync(d, { recursive: true, force: true });
  });

  it('a NON-EMPTY dest with no colliding path restores WITHOUT --force (the old guard trained its own bypass)', () => {
    write(out, 'preexisting.txt', 'keep me\n');
    const r = restore(root, { selector: 'HEAD', to: out });
    expect(r.entriesRestored).toBeGreaterThan(0);
    expect(read(out, MOD)).toBe(BASE);
    expect(read(out, 'preexisting.txt')).toBe('keep me\n');
  });

  it('an IN-PLACE restore over its own bytes needs no --force at all', () => {
    // the case the emptiness guard could never satisfy: restoring HEAD into the
    // very worktree HEAD was sealed from.
    const r = restore(root, { selector: 'HEAD', to: root });
    expect(r.entriesRestored).toBeGreaterThan(0);
    expect(read(root, MOD)).toBe(BASE);
  });

  it('a colliding path with different bytes refuses, and --force overrides', () => {
    write(out, MOD, 'local edit\n');
    expect(() => restore(root, { selector: 'HEAD', to: out })).toThrow(/refusing to overwrite/);
    expect(read(out, MOD)).toBe('local edit\n');
    const r = restore(root, { selector: 'HEAD', to: out, force: true });
    expect(r.entriesRestored).toBeGreaterThan(0);
    expect(read(out, MOD)).toBe(BASE);
  });

  it('an empty dest is still the trivial case', () => {
    const r = restore(root, { selector: 'HEAD', to: out });
    expect(r.entriesRestored).toBeGreaterThan(0);
    expect(read(out, MOD)).toBe(BASE);
  });
});

describe('#warpline-cli — the CLI can finally decline the write-back (C-5: --no-restore)', () => {
  let w: World;

  interface Run {
    code: number;
    stdout: string;
    stderr: string;
  }

  /** Drive the real CLI against the SCRATCH fabric via --root (D-7 in anger). */
  const cli = async (...args: string[]): Promise<Run> => {
    try {
      const { stdout, stderr } = await execFileAsync('node', [distCli, '--root', w.root, ...args], {
        cwd: w.root,
        encoding: 'utf8',
      });
      return { code: 0, stdout, stderr };
    } catch (err) {
      const e = err as { code?: number; stdout?: string; stderr?: string };
      return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
    }
  };

  beforeEach(async () => {
    w = await seedConcurrentClean();
  }, 60_000);

  afterEach(() => {
    for (const d of [w.root, w.dirA, w.dirB]) fs.rmSync(d, { recursive: true, force: true });
  });

  it.skipIf(!haveDist)('a dirty worktree REFUSES on the CLI, and names --no-restore', async () => {
    const uncommitted = '// WORK NOBODY HAS A COPY OF\n';
    write(w.dirB, MOD, uncommitted);
    const r = await cli('admit', 'B', '--native', '--worktree', w.dirB);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/refusing to overwrite/);
    expect(r.stderr).toMatch(/--no-restore/);
    expect(read(w.dirB, MOD)).toBe(uncommitted); // NOT clobbered
  });

  it.skipIf(!haveDist)('--no-restore seals the merge and leaves the worktree exactly as it is', async () => {
    const uncommitted = '// WORK NOBODY HAS A COPY OF\n';
    write(w.dirB, MOD, uncommitted);
    const r = await cli('admit', 'B', '--native', '--worktree', w.dirB, '--no-restore', '--json');
    expect(r.code).toBe(0);
    const result = JSON.parse(r.stdout) as { sealed: boolean; decision: { status: string }; restoredEntries?: number };
    expect(result.sealed).toBe(true);
    expect(result.decision.status).toBe('CLEAN');
    expect(result.restoredEntries).toBeUndefined();
    expect(read(w.dirB, MOD)).toBe(uncommitted);
  });

  it.skipIf(!haveDist)('a CLEAN worktree still writes back on the CLI (no flag, no friction)', async () => {
    const r = await cli('admit', 'B', '--native', '--worktree', w.dirB, '--json');
    expect(r.code).toBe(0);
    const result = JSON.parse(r.stdout) as { sealed: boolean; restoredEntries?: number };
    expect(result.sealed).toBe(true);
    expect(result.restoredEntries).toBeGreaterThan(0);
    expect(read(w.dirB, MOD)).toBe(MERGED);
  });

  it.skipIf(!haveDist)('`fork --into` exposes --force for the dirty case', async () => {
    const into = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-c5-cliinto-'));
    try {
      write(into, MOD, 'work in progress\n');
      const refused = await cli('fork', 'Z', '--into', into);
      expect(refused.code).not.toBe(0);
      expect(refused.stderr).toMatch(/refusing to overwrite/);
      expect(read(into, MOD)).toBe('work in progress\n');

      const forced = await cli('fork', 'Z', '--into', into, '--force');
      expect(forced.code).toBe(0);
      expect(read(into, MOD)).toBe(A_EDIT); // the selvage tip A advanced to
    } finally {
      fs.rmSync(into, { recursive: true, force: true });
    }
  });
});

describe('#restore — collectDirtyCollisions is pure and classifies correctly', () => {
  let root: string;
  let dest: string;
  let treeId: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-c5c-root-'));
    dest = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-c5c-dest-'));
    write(root, MOD, BASE);
    write(root, 'readme.md', README);
    const g = await proposeNative(root, { worktree: root, agentId: 'genesis', intent: 'genesis' });
    await admitNative(root, { worktree: root, agentId: 'genesis' });
    treeId = g.treeId;
  }, 60_000);

  afterEach(() => {
    for (const d of [root, dest] as const) fs.rmSync(d, { recursive: true, force: true });
  });

  it('reports nothing for an absent, empty or identical dest — and writes nothing itself', () => {
    const store = new ObjectStore(root);
    expect(collectDirtyCollisions(store, treeId, path.join(dest, 'nope'))).toEqual([]);
    expect(fs.existsSync(path.join(dest, 'nope'))).toBe(false); // PURE — no mkdir
    expect(collectDirtyCollisions(store, treeId, dest)).toEqual([]);
    write(dest, MOD, BASE);
    expect(collectDirtyCollisions(store, treeId, dest)).toEqual([]);
  });

  it('classifies a differing file as `modified` and a directory-in-a-file-slot as `type-change`', () => {
    const store = new ObjectStore(root);
    write(dest, MOD, 'different\n');
    expect(collectDirtyCollisions(store, treeId, dest)).toEqual([{ path: MOD, reason: 'modified' }]);

    fs.rmSync(path.join(dest, MOD));
    fs.mkdirSync(path.join(dest, MOD), { recursive: true });
    expect(collectDirtyCollisions(store, treeId, dest)).toEqual([{ path: MOD, reason: 'type-change' }]);
  });

  it('an expected baseline makes captured bytes safe — that is what unblocks a real merge', () => {
    const store = new ObjectStore(root);
    write(dest, MOD, 'different\n');
    // with no baseline: unrecoverable.
    expect(collectDirtyCollisions(store, treeId, dest)).toHaveLength(1);
    // seal those exact bytes into an object, then name that tree as the baseline.
    const baselineDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-c5c-base-'));
    try {
      const blob = store.putBlob(Buffer.from('different\n'));
      const inner = store.putTree([{ mode: '100644', name: 'mod.ts', id: blob }]);
      const baseline = store.putTree([{ mode: '40000', name: 'src', id: inner }]);
      expect(collectDirtyCollisions(store, treeId, dest, baseline)).toEqual([]);
    } finally {
      fs.rmSync(baselineDir, { recursive: true, force: true });
    }
  });
});
