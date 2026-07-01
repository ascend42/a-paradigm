/**
 * restore-git-absent.test — M1c (T-2026-07-01-012): the layer→VCS threshold.
 *
 * THE MONEY SHOT: seal a strand, `rm -rf .git`, then reconstruct a byte-identical
 * working tree from the NATIVE object store alone — file contents, exec bit,
 * symlink target, subdir structure — with git ABSENT. Plus:
 *   - selector resolution (HEAD / @seq / seq / pick: / state: / tree:)
 *   - A4 refusal on a strand with no byte binding
 *   - the dirty-dest guard (refuse without --force, overlay with --force)
 *   - the MALICIOUS-TREE rejection (a `../escape` / `.git` entry name fails closed,
 *     nothing written outside dest)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { recordPick } from '../src/fabric/pick.js';
import { restore } from '../src/fabric/restore.js';
import { resolveSelector } from '../src/fabric/select.js';
import { appendStrand, writeSelvage, warplineDirOf } from '../src/fabric/fabric.js';
import type { Strand } from '../src/fabric/strand.js';
import { ObjectStore } from '../src/warp/object-store.js';
import { snapshotDir, restoreTree } from '../src/warp/snapshot.js';

const execFileAsync = promisify(execFile);

class Repo {
  constructor(public readonly dir: string) {}
  static async create(prefix: string): Promise<Repo> {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
    const r = new Repo(dir);
    await r.git('init', '-q', '-b', 'base');
    await r.git('config', 'user.email', 'r@warpline.test');
    await r.git('config', 'user.name', 'Warpline R');
    await r.git('config', 'commit.gpgsign', 'false');
    return r;
  }
  git = async (...a: string[]): Promise<string> =>
    (await execFileAsync('git', a, { cwd: this.dir, encoding: 'utf8' })).stdout.trim();
  async write(rel: string, body: string): Promise<void> {
    const full = path.join(this.dir, rel);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, body, 'utf8');
  }
  async commitAll(msg: string): Promise<void> {
    await this.git('add', '-A');
    await this.git('commit', '-q', '-m', msg);
  }
  destroy = (): Promise<void> => fsp.rm(this.dir, { recursive: true, force: true });
}

describe('restore — the git-absent reconstruction (M1c money shot)', () => {
  let repo: Repo;
  let genesis: Strand;
  let tip: Strand;

  beforeAll(async () => {
    repo = await Repo.create('warpline-restore-');
    // Ignore .warpline/ (as a real repo does) so it never enters a committed HEAD tree
    // — a tree must never carry .warpline (the restore guard fails closed on it).
    await repo.write('.gitignore', '.warpline/\n');
    await repo.write('readme.md', 'hello world\n');
    await repo.write('src/mod.ts', 'export function f() { return 1; }\n');
    await repo.write('run.sh', '#!/bin/sh\necho hi\n');
    fs.chmodSync(path.join(repo.dir, 'run.sh'), 0o755); // executable
    fs.symlinkSync('readme.md', path.join(repo.dir, 'link')); // symlink → readme.md
    // a binary blob (NUL-bearing) to prove byte-faithfulness, not text-only
    fs.writeFileSync(path.join(repo.dir, 'asset.bin'), Buffer.from([0x00, 0x10, 0x00, 0xab, 0x00]));
    await repo.commitAll('base');
    genesis = (await recordPick(repo.dir, { cwd: repo.dir, ref: 'HEAD', intent: 'genesis' })).strand!;

    // A second sealed strand so seq 0 and seq 1 both exist for selector coverage.
    // A function BODY change moves the code-unit essence (a plain literal const would
    // not be lifted, so it would no-op) — this genuinely advances the fabric.
    await repo.write('src/mod.ts', 'export function f() { return 2; }\n');
    await repo.commitAll('edit f');
    tip = (await recordPick(repo.dir, { cwd: repo.dir, ref: 'HEAD', intent: 'edit f' })).strand!;
  }, 120_000);

  afterAll(async () => {
    await repo?.destroy();
  });

  it('resolveSelector maps HEAD / @seq / seq / pick: / state: / tree: to the right treeId', () => {
    const wdir = warplineDirOf(repo.dir);
    expect(genesis.binding?.treeId).toBeTruthy();
    expect(tip.binding?.treeId).toBeTruthy();
    // HEAD / selvage / omitted → the tip.
    expect(resolveSelector(wdir, 'HEAD').treeId).toBe(tip.binding!.treeId);
    expect(resolveSelector(wdir, 'selvage').treeId).toBe(tip.binding!.treeId);
    expect(resolveSelector(wdir, undefined).treeId).toBe(tip.binding!.treeId);
    // seq forms.
    expect(resolveSelector(wdir, '@0').treeId).toBe(genesis.binding!.treeId);
    expect(resolveSelector(wdir, '0').treeId).toBe(genesis.binding!.treeId);
    expect(resolveSelector(wdir, '@1').treeId).toBe(tip.binding!.treeId);
    // pick: (event identity) and state: (meaning identity, highest seq).
    expect(resolveSelector(wdir, genesis.pickId).treeId).toBe(genesis.binding!.treeId);
    expect(resolveSelector(wdir, tip.stateId).treeId).toBe(tip.binding!.treeId);
    // tree: restores that treeId directly (no strand).
    const direct = resolveSelector(wdir, tip.binding!.treeId);
    expect(direct.treeId).toBe(tip.binding!.treeId);
    expect(direct.strand).toBeUndefined();
    // an unrecognized selector lists the accepted forms.
    expect(() => resolveSelector(wdir, 'garbage')).toThrow(/accepted: HEAD/);
  });

  it('dirty-dest guard: refuses a non-empty dest without --force, overlays with it', async () => {
    const out = await fsp.mkdtemp(path.join(os.tmpdir(), 'warpline-restore-dirty-'));
    try {
      fs.writeFileSync(path.join(out, 'preexisting.txt'), 'keep me\n');
      expect(() => restore(repo.dir, { selector: 'HEAD', to: out })).toThrow(/not empty/);
      const r = restore(repo.dir, { selector: 'HEAD', to: out, force: true });
      expect(r.treeId).toBe(tip.binding!.treeId);
      expect(fs.readFileSync(path.join(out, 'readme.md'), 'utf8')).toBe('hello world\n'); // tree overlaid
      expect(fs.existsSync(path.join(out, 'preexisting.txt'))).toBe(true); // unrelated file left in place
    } finally {
      await fsp.rm(out, { recursive: true, force: true });
    }
  });

  it('rm -rf .git → restore HEAD reproduces the tree BYTE-IDENTICALLY, git absent', async () => {
    // git is present up to here (the strand was sealed via `git cat-file`). Now kill it.
    fs.rmSync(path.join(repo.dir, '.git'), { recursive: true, force: true });
    expect(fs.existsSync(path.join(repo.dir, '.git'))).toBe(false); // git is GONE

    const out = await fsp.mkdtemp(path.join(os.tmpdir(), 'warpline-restore-out-'));
    try {
      const result = restore(repo.dir, { selector: 'HEAD', to: out });
      expect(result.treeId).toBe(tip.binding!.treeId);
      expect(result.seq).toBe(tip.seq);

      // regular file bytes + the edited subdir file
      expect(fs.readFileSync(path.join(out, 'readme.md'), 'utf8')).toBe('hello world\n');
      expect(fs.readFileSync(path.join(out, 'src', 'mod.ts'), 'utf8')).toBe('export function f() { return 2; }\n');
      // binary byte-identical
      expect(fs.readFileSync(path.join(out, 'asset.bin')).equals(Buffer.from([0x00, 0x10, 0x00, 0xab, 0x00]))).toBe(true);
      // exec bit preserved
      expect(fs.statSync(path.join(out, 'run.sh')).mode & 0o111).toBeTruthy();
      // symlink restored as a link with the exact target, not its contents
      const st = fs.lstatSync(path.join(out, 'link'));
      expect(st.isSymbolicLink()).toBe(true);
      expect(fs.readlinkSync(path.join(out, 'link'))).toBe('readme.md');

      // the capstone: snapshot(restore(x)) == x — round-trip byte identity, git absent.
      const restoreStore = new ObjectStore(out);
      expect(snapshotDir(restoreStore, out).treeId).toBe(tip.binding!.treeId);
    } finally {
      await fsp.rm(out, { recursive: true, force: true });
    }
  });
});

describe('restore — A4 refuses a strand with no byte binding', () => {
  it('a strand sealed before bind-on-seal (no binding.treeId) cannot be restored', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'warpline-restore-a4-'));
    try {
      const wdir = warplineDirOf(root);
      const unbound: Strand = {
        schemaVersion: 1,
        seq: 0,
        pickId: 'pick:v0:unbound-fixture',
        stateId: 'state:v0:unbound',
        parentStateId: null,
        actor: 'tester',
        intent: 'pre-M1b strand',
        recordedAt: '2026-07-01T00:00:00.000Z',
        objectCount: 1,
        delta: { born: [], retired: [], contractChanged: [], renamedNoop: 0 },
        calibratedConfidence: null,
        provenance: { ref: 'HEAD', treeSha: null, gitCommit: null },
        // NOTE: no `binding` — this is the pre-bind-on-seal case A4 must catch.
      };
      appendStrand(wdir, unbound);
      writeSelvage(wdir, unbound.stateId);
      expect(() => resolveSelector(wdir, 'HEAD')).toThrow(/no byte binding/);
      expect(() => restore(root, { selector: 'HEAD', to: path.join(root, 'out') })).toThrow(/no byte binding/);
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it('an empty fabric refuses HEAD with a clear "no selvage" error', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'warpline-restore-empty-'));
    try {
      expect(() => resolveSelector(warplineDirOf(root), 'HEAD')).toThrow(/no selvage: empty fabric/);
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });
});

describe('restore — adjacent hardening (Aegis M1c review, live-repro-confirmed)', () => {
  it('hardlink write-through: --force overlay writes a FRESH inode, never clobbers a file hardlinked outside dest', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-restore-hl-'));
    try {
      const store = new ObjectStore(root);
      const tree = store.putTree([{ mode: '100644', name: 'readme.md', id: store.putBlob(Buffer.from('FRESH\n')) }]);
      // A victim OUTSIDE dest, and a dest pre-seeded with a hardlink to it (reachable
      // only with --force, since a clean restore requires an empty dest).
      const victim = path.join(root, 'victim.txt');
      fs.writeFileSync(victim, 'ORIGINAL\n');
      const dest = path.join(root, 'dest');
      fs.mkdirSync(dest);
      fs.linkSync(victim, path.join(dest, 'readme.md')); // hardlink: same inode as victim
      restoreTree(store, tree, dest);
      // the outside victim is untouched; dest got a brand-new inode with the tree bytes
      expect(fs.readFileSync(victim, 'utf8')).toBe('ORIGINAL\n');
      expect(fs.readFileSync(path.join(dest, 'readme.md'), 'utf8')).toBe('FRESH\n');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('malformed tree: selector is rejected up front (no unvalidated id reaches the object-store path)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-restore-treeid-'));
    try {
      const wdir = warplineDirOf(root);
      expect(() => resolveSelector(wdir, 'tree:v1:../../../../etc/passwd')).toThrow(/malformed tree selector/);
      expect(() => resolveSelector(wdir, 'tree:v1:NOTHEX')).toThrow(/malformed tree selector/);
      expect(() => resolveSelector(wdir, 'tree:garbage')).toThrow(/malformed tree selector/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('an unknown/forged tree entry mode fails closed (never coerced to a file)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-restore-mode-'));
    try {
      const store = new ObjectStore(root);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tree = store.putTree([{ mode: '100777' as any, name: 'x', id: store.putBlob(Buffer.from('x')) }]);
      const dest = path.join(root, 'dest');
      fs.mkdirSync(dest);
      expect(() => restoreTree(store, tree, dest)).toThrow(/unknown tree entry mode/);
      expect(fs.existsSync(path.join(dest, 'x'))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('restore — MALICIOUS-TREE rejection (Aegis C3, path hardening)', () => {
  it('a crafted `../escape` entry fails closed and writes NOTHING outside dest', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'warpline-restore-evil-'));
    try {
      const store = new ObjectStore(root);
      const blob = store.putBlob(Buffer.from('pwned\n'));
      const escapeTree = store.putTree([{ mode: '100644', name: '../escape', id: blob }]);
      const dest = path.join(root, 'dest');
      fs.mkdirSync(dest);
      expect(() => restoreTree(store, escapeTree, dest)).toThrow(/safe (single )?path component/);
      // nothing escaped the destination (sibling `escape` never created)
      expect(fs.existsSync(path.join(root, 'escape'))).toBe(false);
      expect(fs.existsSync(path.join(dest, 'escape'))).toBe(false);

      // a `.git` entry would overwrite a real VCS dir → refused.
      const gitTree = store.putTree([{ mode: '40000', name: '.git', id: store.putTree([]) }]);
      expect(() => restoreTree(store, gitTree, dest)).toThrow(/repo\/VCS/);
      expect(fs.existsSync(path.join(dest, '.git'))).toBe(false);
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });
});
