/**
 * reserved-name-normalization.test — C-3 regression: `restore` wrote into `.git`
 * and EXECUTED code.
 *
 * `RESTORE_FORBIDDEN` was an exact-match, case-SENSITIVE Set. macOS is
 * case-insensitive by default, so `.GIT/hooks/post-commit` sailed through the
 * guard, landed in the real `.git`, and fired on the next commit; `.WARPLINE`
 * overwrote a real ledger. Also accepted: `.git ` (trailing space), `.git.`,
 * `GIT~1`, and HFS-ignorable codepoints.
 *
 * This is git's CVE-2014-9390, which git fixed in 2014 via `is_hfs_dotgit()` /
 * `is_ntfs_dotgit()` / `core.protectNTFS` / `core.protectHFS`.
 *
 * The normalization must apply at EVERY site, so such a name can never enter a
 * tree in the first place — and it must not OVER-block (`.gitignore` is a
 * perfectly ordinary file).
 */

import { describe, it, expect } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { ObjectStore } from '../src/warp/object-store.js';
import { writeMergedTree, restoreTree, snapshotDir, type PathChange } from '../src/warp/snapshot.js';

/** Every spelling that must be REFUSED — each resolves to `.git`/`.warpline`. */
const FORBIDDEN = [
  '.GIT',
  '.Git',
  '.WARPLINE',
  '.Warpline',
  '.git ', // NTFS/Win32 strips trailing spaces
  '.git.', // ...and trailing dots
  '.git...  ',
  'GIT~1', // the 8.3 shortname of `.git`
  'git~1',
  'WARPLI~1', // the 8.3 shortname of `.warpline`
  '.gi‌t', // HFS+ ignores U+200C — this IS `.git` on HFS+
  '.git‍',
  '.﻿git',
];

/** Legitimate names that must keep working — over-blocking is its own defect. */
const ALLOWED = [
  '.gitignore',
  '.gitattributes',
  'git-notes.md',
  '.warplineignore',
  'gitlab.yml',
  '.git-blame-ignore-revs',
  'digit.txt',
  'g~1',
];

const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));

function storeIn(root: string): ObjectStore {
  return new ObjectStore(path.join(root, '.warpline'));
}

/** Build a tree carrying a single file at `<name>/hooks/post-commit` (or `<name>`). */
function treeWith(store: ObjectStore, rel: string): string {
  const changes = new Map<string, PathChange>([
    [rel, { content: Buffer.from('#!/bin/sh\necho pwned\n', 'utf8'), mode: '100644' }],
  ]);
  return writeMergedTree(store, null, changes);
}

describe('C-3 — reserved-name normalization at the restore boundary', () => {
  it.each(FORBIDDEN)('REFUSES to restore a tree carrying %j as a directory', (name) => {
    const root = tmp('warpline-c3-');
    const store = storeIn(root);
    const treeId = treeWith(store, `${name}/hooks/post-commit`);
    const dest = path.join(root, 'out');
    expect(() => restoreTree(store, treeId, dest)).toThrow();
    // and nothing was written under that name
    expect(fs.existsSync(path.join(dest, name, 'hooks', 'post-commit'))).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.each(FORBIDDEN)('REFUSES to restore a tree carrying %j as a file', (name) => {
    const root = tmp('warpline-c3f-');
    const store = storeIn(root);
    const treeId = treeWith(store, name);
    expect(() => restoreTree(store, treeId, path.join(root, 'out'))).toThrow();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.each(ALLOWED)('still ALLOWS the legitimate name %j', (name) => {
    const root = tmp('warpline-c3ok-');
    const store = storeIn(root);
    const treeId = treeWith(store, name);
    const dest = path.join(root, 'out');
    expect(() => restoreTree(store, treeId, dest)).not.toThrow();
    expect(fs.existsSync(path.join(dest, name))).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('C-3 — the name can never ENTER a tree either (snapshot filter parity)', () => {
  it.each(FORBIDDEN)('snapshotDir never ingests %j', (name) => {
    const root = tmp('warpline-c3s-');
    const work = path.join(root, 'work');
    // Some spellings collide on a case-insensitive FS; each gets its own root.
    fs.mkdirSync(path.join(work, name), { recursive: true });
    fs.writeFileSync(path.join(work, name, 'payload'), 'x');
    fs.writeFileSync(path.join(work, 'real.txt'), 'keep me\n');

    const store = storeIn(root);
    const { treeId } = snapshotDir(store, work);
    const names = store.getTree(treeId).map((e) => e.name);
    expect(names).toContain('real.txt');
    expect(names).not.toContain(name);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('snapshotDir still ingests legitimate git-adjacent names', () => {
    const root = tmp('warpline-c3s-ok-');
    const work = path.join(root, 'work');
    fs.mkdirSync(work, { recursive: true });
    for (const n of ['.gitattributes', 'git-notes.md']) fs.writeFileSync(path.join(work, n), 'x');
    const store = storeIn(root);
    const { treeId } = snapshotDir(store, work);
    const names = store.getTree(treeId).map((e) => e.name);
    expect(names).toContain('.gitattributes');
    expect(names).toContain('git-notes.md');
    fs.rmSync(root, { recursive: true, force: true });
  });
});
