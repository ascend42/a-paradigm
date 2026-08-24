/**
 * #warp-store (M1a) — the native TREE object: a sorted manifest of one directory
 * (native-object-store-design.md §1.2). A tree is byte identity for a whole
 * directory; the Merkle DAG of trees+blobs is the byte identity of a working tree.
 *
 * Canonical serialization (deterministic — the whole point):
 *   tree bytes = concat, per entry in TREE-ORDER:  <mode> " " <name> "\0" <id-bin>
 *   treeId     = "tree:v1:" + sha256( "tree " <len> "\0" <tree bytes> )
 *
 * `<id-bin>` is FIXED-LENGTH by mode (so the stream is parseable without a
 * separator): a native sha256 (32 bytes) for blob/subtree, or a git commit sha1
 * (20 bytes) for a gitlink. This mirrors git's fixed-20-byte trick — we keep the
 * structure, widen the id to sha256 (§1.4). Names are the RAW on-disk bytes (NOT
 * NFC-normalized) so the shadow git OID matches git exactly and NFC/NFD-distinct
 * names never collide into one entry (review amendment A5).
 *
 * TREE-ORDER is git's exact tree-entry sort: compare `name` bytes, but a 40000
 * (directory) entry sorts as if its name had a trailing `/`.
 *
 * Library code: no console output.
 */

import { createHash } from 'node:crypto';
import { objectFrame } from './blob.js';

export type TreeMode = '100644' | '100755' | '120000' | '160000' | '40000';

export interface TreeEntry {
  /** git tree-entry mode: regular / exec / symlink / gitlink / subtree. */
  mode: TreeMode;
  /** single path component (raw bytes as a string), never a `/`-joined path. */
  name: string;
  /** native id: blobId | child treeId | (for 160000) the raw commit sha hex. */
  id: string;
}

/** The binary id width for a mode: gitlink = 20-byte sha1, else 32-byte sha256. */
const idBinLen = (mode: TreeMode): number => (mode === '160000' ? 20 : 32);

/** `100644 foo.ts` sorts against `100644 foo` with the directory-slash rule. */
function orderKey(mode: TreeMode, name: string): Buffer {
  return Buffer.from(mode === '40000' ? `${name}/` : name, 'utf8');
}

export function treeOrder(a: TreeEntry, b: TreeEntry): number {
  return Buffer.compare(orderKey(a.mode, a.name), orderKey(b.mode, b.name));
}

function idToBin(mode: TreeMode, id: string): Buffer {
  // gitlink → raw commit sha hex; native → strip the "blob:v1:" / "tree:v1:" prefix.
  const hex = mode === '160000' ? id : id.slice(id.lastIndexOf(':') + 1);
  const b = Buffer.from(hex, 'hex');
  if (b.length !== idBinLen(mode)) throw new Error(`warpline: bad id length for mode ${mode}: ${id}`);
  return b;
}

function binToId(mode: TreeMode, bin: Buffer): string {
  const hex = bin.toString('hex');
  if (mode === '40000') return `tree:v1:${hex}`;
  if (mode === '160000') return hex;
  return `blob:v1:${hex}`;
}

/** Canonical tree body bytes (entries in TREE-ORDER, fixed-width binary ids). */
export function nativeTreeBytes(entries: TreeEntry[]): Buffer {
  const sorted = [...entries].sort(treeOrder);
  return Buffer.concat(
    sorted.map((e) => Buffer.concat([Buffer.from(`${e.mode} ${e.name}\0`, 'utf8'), idToBin(e.mode, e.id)])),
  );
}

/** The NATIVE content-address of a tree (sha256 over the framed canonical body). */
export function treeId(entries: TreeEntry[]): string {
  return 'tree:v1:' + createHash('sha256').update(objectFrame('tree', nativeTreeBytes(entries))).digest('hex');
}

/** Parse canonical tree body bytes back into entries (mode ⇒ fixed id width). */
export function parseTree(body: Buffer): TreeEntry[] {
  const entries: TreeEntry[] = [];
  let i = 0;
  while (i < body.length) {
    const sp = body.indexOf(0x20, i); // ' '
    if (sp < 0) throw new Error('warpline: malformed tree — no mode separator');
    const mode = body.subarray(i, sp).toString('utf8') as TreeMode;
    const nul = body.indexOf(0, sp + 1);
    if (nul < 0) throw new Error('warpline: malformed tree — no name terminator');
    const name = body.subarray(sp + 1, nul).toString('utf8');
    const n = idBinLen(mode);
    const bin = body.subarray(nul + 1, nul + 1 + n);
    if (bin.length !== n) throw new Error('warpline: malformed tree — truncated id');
    entries.push({ mode, name, id: binToId(mode, bin) });
    i = nul + 1 + n;
  }
  return entries;
}

/* ── Shadow git-sha1 tree OID (coexistence verification only, §2.4) ─────────── */

export interface GitTreeEntry {
  mode: TreeMode;
  name: string;
  /** git-sha1 hex (20 bytes) of the child blob/tree, or the gitlink commit sha. */
  sha1: string;
}

/** git's exact tree serialization: `<mode> <name>\0<20-byte-sha1>` in TREE-ORDER. */
export function gitTreeBytes(entries: GitTreeEntry[]): Buffer {
  const sorted = [...entries].sort((a, b) => Buffer.compare(orderKey(a.mode, a.name), orderKey(b.mode, b.name)));
  return Buffer.concat(
    sorted.map((e) => Buffer.concat([Buffer.from(`${e.mode} ${e.name}\0`, 'utf8'), Buffer.from(e.sha1, 'hex')])),
  );
}

/** git tree OID — MUST equal `git rev-parse <ref>^{tree}` for a clean tree. */
export function gitTreeOid(entries: GitTreeEntry[]): string {
  return createHash('sha1').update(objectFrame('tree', gitTreeBytes(entries))).digest('hex');
}
