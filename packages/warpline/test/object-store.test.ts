/**
 * object-store.test — M1a native byte store (T-2026-07-01-010).
 *
 * The proof that Warpline can OWN and reproduce bytes with git absent:
 *   - determinism: same dir ⇒ same treeId across runs
 *   - round-trip: snapshot → restore → byte-identical (binary / exec / symlink)
 *   - TREE-ORDER: git's exact directory-slash sort
 *   - store: put/get/has idempotent + `verify` detects a corrupted object
 *   - shadow OID: our git-sha1 tree == `git rev-parse HEAD^{tree}` (byte-faithful
 *     proof against git during coexistence)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { ObjectStore } from '../src/warp/object-store.js';
import { snapshotDir, restoreTree } from '../src/warp/snapshot.js';
import { blobId, gitBlobOid } from '../src/warp/blob.js';
import { treeId, treeOrder, parseTree, nativeTreeBytes, type TreeEntry } from '../src/warp/tree.js';

const execFileAsync = promisify(execFile);

async function mkRepo(): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'warpline-objstore-'));
  const git = (...a: string[]) => execFileAsync('git', a, { cwd: dir });
  await git('init', '-q', '-b', 'base');
  await git('config', 'user.email', 'o@warpline.test');
  await git('config', 'user.name', 'Warpline O');
  await git('config', 'commit.gpgsign', 'false');
  return dir;
}

describe('blob + tree primitives', () => {
  it('blobId is deterministic and domain-separated from tree', () => {
    const b = Buffer.from('hello\n');
    expect(blobId(b)).toBe(blobId(Buffer.from('hello\n')));
    expect(blobId(b).startsWith('blob:v1:')).toBe(true);
    // same bytes, tree vs blob framing never collide
    expect(treeId([]).startsWith('tree:v1:')).toBe(true);
    expect(treeId([]).slice(8)).not.toBe(blobId(Buffer.alloc(0)).slice(8));
  });

  it('gitBlobOid matches `git hash-object`', async () => {
    const dir = await mkRepo();
    try {
      const body = 'the exact bytes\n';
      fs.writeFileSync(path.join(dir, 'f.txt'), body);
      const { stdout } = await execFileAsync('git', ['hash-object', 'f.txt'], { cwd: dir });
      expect(gitBlobOid(Buffer.from(body))).toBe(stdout.trim());
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('TREE-ORDER: a directory sorts as if its name had a trailing slash', () => {
    const file: TreeEntry = { mode: '100644', name: 'src.ts', id: blobId(Buffer.from('x')) };
    const dir: TreeEntry = { mode: '40000', name: 'src', id: treeId([]) };
    // "src.ts" vs "src/": '.'(0x2e) < '/'(0x2f) ⇒ the file sorts BEFORE the dir.
    expect(treeOrder(file, dir)).toBeLessThan(0);
    // canonical bytes are order-stable regardless of input order
    expect(nativeTreeBytes([dir, file]).equals(nativeTreeBytes([file, dir]))).toBe(true);
  });

  it('parseTree round-trips canonical tree bytes (mixed modes incl. gitlink)', () => {
    const entries: TreeEntry[] = [
      { mode: '100644', name: 'a.ts', id: blobId(Buffer.from('a')) },
      { mode: '100755', name: 'run.sh', id: blobId(Buffer.from('#!/bin/sh\n')) },
      { mode: '120000', name: 'link', id: blobId(Buffer.from('a.ts')) },
      { mode: '160000', name: 'sub', id: 'a'.repeat(40) }, // gitlink: 20-byte commit sha hex
      { mode: '40000', name: 'dir', id: treeId([]) },
    ];
    const parsed = parseTree(nativeTreeBytes(entries));
    // parseTree returns entries in TREE-ORDER; compare as sets by name.
    const byName = Object.fromEntries(parsed.map((e) => [e.name, e]));
    for (const e of entries) expect(byName[e.name]).toEqual(e);
    expect(parsed.length).toBe(entries.length);
  });
});

describe('ObjectStore — put/get/has idempotent + verify', () => {
  let root: string;
  beforeAll(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'warpline-store-'));
  });
  afterAll(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('putBlob/getBlob is byte-faithful, including binary (NUL) content', () => {
    const store = new ObjectStore(root);
    const bin = Buffer.from([0x00, 0x01, 0x00, 0xff, 0x00]);
    const id = store.putBlob(bin);
    expect(store.has(id)).toBe(true);
    expect(store.getBlob(id).equals(bin)).toBe(true);
    expect(store.putBlob(bin)).toBe(id); // idempotent — same id
  });

  it('verify detects a corrupted loose object', () => {
    const store = new ObjectStore(root);
    const id = store.putBlob(Buffer.from('integrity\n'));
    expect(store.verify().corrupt).toEqual([]);
    // Corrupt the object on disk (bypass the store).
    const hex = id.slice(id.lastIndexOf(':') + 1);
    const p = path.join(root, '.warpline', 'objects', 'blobs', hex.slice(0, 2), hex.slice(2));
    fs.writeFileSync(p, Buffer.from([0x78, 0x9c, 0x00, 0x00])); // garbage (not the real deflate)
    const report = store.verify();
    expect(report.corrupt).toContain(id);
  });
});

describe('snapshot ⇄ restore — byte-authoritative, git-absent', () => {
  let repo: string;
  let store: ObjectStore;

  beforeAll(async () => {
    repo = await mkRepo();
    fs.writeFileSync(path.join(repo, 'readme.md'), 'hello world\n');
    fs.mkdirSync(path.join(repo, 'src'));
    fs.writeFileSync(path.join(repo, 'src', 'mod.ts'), 'export const x = 1;\n');
    fs.writeFileSync(path.join(repo, 'asset.bin'), Buffer.from([0x00, 0x10, 0x00, 0xab, 0x00]));
    fs.writeFileSync(path.join(repo, 'run.sh'), '#!/bin/sh\necho hi\n');
    fs.chmodSync(path.join(repo, 'run.sh'), 0o755);
    fs.symlinkSync('readme.md', path.join(repo, 'link'));
    const git = (...a: string[]) => execFileAsync('git', a, { cwd: repo });
    await git('add', '-A');
    await git('commit', '-q', '-m', 'base');
    store = new ObjectStore(repo);
  }, 120_000);

  afterAll(async () => {
    await fsp.rm(repo, { recursive: true, force: true });
  });

  it('is deterministic — same tree, same treeId + gitOid across runs', () => {
    const a = snapshotDir(store, repo);
    const b = snapshotDir(store, repo);
    expect(a.treeId).toBe(b.treeId);
    expect(a.gitOid).toBe(b.gitOid);
  });

  it('shadow gitOid equals `git rev-parse HEAD^{tree}` (byte-faithful vs git)', async () => {
    const snap = snapshotDir(store, repo);
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repo });
    expect(snap.gitOid).toBe(stdout.trim());
  });

  it('restore reproduces a byte-identical tree with git ABSENT', async () => {
    const snap = snapshotDir(store, repo);
    // Simulate git-absent: restore purely from the native store into a fresh dir.
    const out = await fsp.mkdtemp(path.join(os.tmpdir(), 'warpline-restore-'));
    try {
      restoreTree(store, snap.treeId, out);
      // regular file bytes
      expect(fs.readFileSync(path.join(out, 'readme.md'), 'utf8')).toBe('hello world\n');
      // subtree
      expect(fs.readFileSync(path.join(out, 'src', 'mod.ts'), 'utf8')).toBe('export const x = 1;\n');
      // binary byte-identical
      expect(fs.readFileSync(path.join(out, 'asset.bin')).equals(Buffer.from([0x00, 0x10, 0x00, 0xab, 0x00]))).toBe(true);
      // exec bit preserved
      expect(fs.statSync(path.join(out, 'run.sh')).mode & 0o111).toBeTruthy();
      // symlink restored as a link, not its contents
      const st = fs.lstatSync(path.join(out, 'link'));
      expect(st.isSymbolicLink()).toBe(true);
      expect(fs.readlinkSync(path.join(out, 'link'))).toBe('readme.md');
      // the capstone invariant: snapshot(restore(x)) == x
      const restoreStore = new ObjectStore(out); // a fresh store over the restored tree
      expect(snapshotDir(restoreStore, out).treeId).toBe(snap.treeId);
    } finally {
      await fsp.rm(out, { recursive: true, force: true });
    }
  });
});
