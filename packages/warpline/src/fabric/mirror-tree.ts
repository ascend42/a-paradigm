/**
 * #fabric-mirror (tree format) — `warpline-mirror/1`, the bytes a mirror commit
 * holds, and the object plumbing that writes and reads them.
 *
 *   format                 "warpline-mirror/1\n"
 *   writer                 "<writer id>\n"         (#fabric-writer — who sealed it)
 *   fabric-legacy.json     the grandfathered-legacy manifest, when present
 *   ledger/000000.jsonl    strands 0..31, raw ledger bytes, newline-terminated
 *   ledger/000001.jsonl    strands 32..63 …
 *
 * Identical ledgers ⇒ identical trees (raw bytes, fixed segmentation). Tip
 * pointers are NOT stored; they are derived from the ledger tip on restore.
 *
 * COST (I9). Object ids are computed in Node and the objects are written as
 * loose objects directly into `<common-dir>/objects` (zlib, tmp + rename, the
 * same layout git writes), so a seal spawns no hash-object / mktree /
 * commit-tree. An append changes only the LAST segment, so at most one segment
 * blob is written per seal (plus the two trees and the commit) and the .git
 * growth is linear, not quadratic. Reads go through `git cat-file --batch`
 * (packed objects are only readable through git).
 *
 * Library code: no console output.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { createHash, randomBytes } from 'node:crypto';
import { git, GitRunError } from './git-run.js';

export const MIRROR_FORMAT = 'warpline-mirror/1';
export const SEGMENT_STRANDS = 32;
export const LEDGER_DIR = 'ledger';
export const FORMAT_ENTRY = 'format';
export const WRITER_ENTRY = 'writer';
export const LEGACY_ENTRY = 'fabric-legacy.json';
/** the PUBLIC key registry (.warpline/keys/registry.jsonl) — the trust anchor a fresh clone checks signatures against (W2 review 9). */
export const REGISTRY_ENTRY = 'keys-registry.jsonl';

export type ObjectFormat = 'sha1' | 'sha256';
export type ObjectType = 'blob' | 'tree' | 'commit';

let objectWrites = { blob: 0, tree: 0, commit: 0, ledgerSegments: 0 };
/** Test seam (I9): loose objects written since the last reset. */
export function mirrorObjectWrites(): { blob: number; tree: number; commit: number; ledgerSegments: number } {
  return { ...objectWrites };
}
export function resetMirrorObjectWrites(): void {
  objectWrites = { blob: 0, tree: 0, commit: 0, ledgerSegments: 0 };
}

export function oidLength(fmt: ObjectFormat): number {
  return fmt === 'sha256' ? 64 : 40;
}
export function zeroOid(fmt: ObjectFormat): string {
  return '0'.repeat(oidLength(fmt));
}

function objectBytes(type: ObjectType, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`${type} ${body.length}\0`, 'utf8'), body]);
}

export function hashObject(fmt: ObjectFormat, type: ObjectType, body: Buffer): string {
  return createHash(fmt).update(objectBytes(type, body)).digest('hex');
}

export interface TreeEntry {
  mode: string;
  name: string;
  oid: string;
}

/** git's tree order: byte order of the name, with a directory compared as `name/`. */
function treeSortKey(e: TreeEntry): Buffer {
  return Buffer.from(e.mode === '40000' ? `${e.name}/` : e.name, 'utf8');
}

export function encodeTree(entries: TreeEntry[]): Buffer {
  const sorted = [...entries].sort((a, b) => Buffer.compare(treeSortKey(a), treeSortKey(b)));
  const parts: Buffer[] = [];
  for (const e of sorted) parts.push(Buffer.from(`${e.mode} ${e.name}\0`, 'utf8'), Buffer.from(e.oid, 'hex'));
  return Buffer.concat(parts);
}

export function parseTree(fmt: ObjectFormat, body: Buffer): TreeEntry[] {
  const len = oidLength(fmt) / 2;
  const out: TreeEntry[] = [];
  let i = 0;
  while (i < body.length) {
    const sp = body.indexOf(0x20, i);
    const nul = body.indexOf(0x00, sp + 1);
    if (sp === -1 || nul === -1 || nul + 1 + len > body.length) throw new Error('warpline: malformed tree object');
    out.push({
      mode: body.subarray(i, sp).toString('utf8'),
      name: body.subarray(sp + 1, nul).toString('utf8'),
      oid: body.subarray(nul + 1, nul + 1 + len).toString('hex'),
    });
    i = nul + 1 + len;
  }
  return out;
}

const IDENT = 'warpline <warpline@localhost>';

export function encodeCommit(tree: string, parents: string[], message: string, when: Date = new Date()): Buffer {
  const ts = `${Math.floor(when.getTime() / 1000)} +0000`;
  const lines = [`tree ${tree}`, ...parents.map((p) => `parent ${p}`), `author ${IDENT} ${ts}`, `committer ${IDENT} ${ts}`, '', message];
  return Buffer.from(lines.join('\n') + '\n', 'utf8');
}

/** The tree and parents named by a commit object body. */
export function parseCommit(body: Buffer): { tree: string; parents: string[] } {
  const header = body.toString('utf8').split('\n\n')[0].split('\n');
  const tree = header.find((l) => l.startsWith('tree '))?.slice(5) ?? '';
  return { tree, parents: header.filter((l) => l.startsWith('parent ')).map((l) => l.slice(7)) };
}

/**
 * Write one loose object (skipped when the loose file already exists). Returns
 * the oid. tmp + rename inside the fan-out dir, read-only like git's own.
 */
export function writeLooseObject(objectsDir: string, fmt: ObjectFormat, type: ObjectType, body: Buffer): { oid: string; written: boolean } {
  const oid = hashObject(fmt, type, body);
  const dir = path.join(objectsDir, oid.slice(0, 2));
  const target = path.join(dir, oid.slice(2));
  if (fs.existsSync(target)) return { oid, written: false };
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `tmp_obj_warpline_${process.pid}_${randomBytes(6).toString('hex')}`);
  const fd = fs.openSync(tmp, 'wx', 0o444);
  try {
    fs.writeSync(fd, zlib.deflateSync(objectBytes(type, body)));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, target);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    if (!fs.existsSync(target)) throw err;
  }
  objectWrites[type]++;
  return { oid, written: true };
}

export function segmentName(i: number): string {
  return `${String(i).padStart(6, '0')}.jsonl`;
}

/** Split ledger lines (raw bytes, no newline) into newline-terminated segment blobs of 32 strands. */
export function segmentLines(lines: Buffer[]): Buffer[] {
  const out: Buffer[] = [];
  for (let i = 0; i < lines.length; i += SEGMENT_STRANDS) {
    const parts: Buffer[] = [];
    for (const l of lines.slice(i, i + SEGMENT_STRANDS)) parts.push(l, Buffer.from('\n'));
    out.push(Buffer.concat(parts));
  }
  return out;
}

export interface MirrorTreeInput {
  writer: string;
  legacy: Buffer | null;
  registry?: Buffer | null;
  segments: Buffer[];
}

export interface BuiltMirrorTree {
  tree: string;
  segmentOids: string[];
  objects: { type: ObjectType; body: Buffer; oid: string; segment?: number }[];
}

/** Compute every object of a mirror tree in memory (nothing written). */
export function buildMirrorTree(fmt: ObjectFormat, input: MirrorTreeInput): BuiltMirrorTree {
  const objects: BuiltMirrorTree['objects'] = [];
  const blob = (body: Buffer, segment?: number): string => {
    const oid = hashObject(fmt, 'blob', body);
    objects.push({ type: 'blob', body, oid, segment });
    return oid;
  };
  const segmentOids = input.segments.map((s, i) => blob(s, i));
  const ledgerEntries = segmentOids.map((oid, i) => ({ mode: '100644', name: segmentName(i), oid }));
  const root: TreeEntry[] = [
    { mode: '100644', name: FORMAT_ENTRY, oid: blob(Buffer.from(`${MIRROR_FORMAT}\n`)) },
    { mode: '100644', name: WRITER_ENTRY, oid: blob(Buffer.from(`${input.writer}\n`)) },
  ];
  if (input.legacy !== null) root.push({ mode: '100644', name: LEGACY_ENTRY, oid: blob(input.legacy) });
  if (input.registry) root.push({ mode: '100644', name: REGISTRY_ENTRY, oid: blob(input.registry) });
  if (ledgerEntries.length > 0) {
    const body = encodeTree(ledgerEntries);
    const oid = hashObject(fmt, 'tree', body);
    objects.push({ type: 'tree', body, oid });
    root.push({ mode: '40000', name: LEDGER_DIR, oid });
  }
  const body = encodeTree(root);
  const tree = hashObject(fmt, 'tree', body);
  objects.push({ type: 'tree', body, oid: tree });
  return { tree, segmentOids, objects };
}

/* ───────────────────────────── batch reads ───────────────────────────── */

export interface BatchObject {
  oid: string;
  type: string;
  size: number;
  body: Buffer | null;
}

/**
 * `git cat-file --batch` (or --batch-check) over many requests in ONE spawn.
 * A missing / ambiguous request yields null at its index.
 */
export function catFileBatch(cwd: string, requests: string[], check = false): (BatchObject | null)[] {
  if (requests.length === 0) return [];
  for (const r of requests) {
    if (/[\r\n]/.test(r)) throw new Error('warpline: object request contains a newline');
  }
  const out = git(cwd, ['cat-file', check ? '--batch-check' : '--batch'], { input: requests.join('\n') + '\n' });
  const res: (BatchObject | null)[] = [];
  let i = 0;
  for (let k = 0; k < requests.length; k++) {
    const nl = out.indexOf(0x0a, i);
    if (nl === -1) throw new GitRunError('warpline: truncated cat-file output', 'error', ['cat-file'], 0, '');
    const header = out.subarray(i, nl).toString('utf8');
    i = nl + 1;
    const m = /^([0-9a-f]{40,64}) (\S+) (\d+)$/.exec(header);
    if (!m) {
      res.push(null); // "<req> missing" / "ambiguous"
      continue;
    }
    const size = Number(m[3]);
    if (check) {
      res.push({ oid: m[1], type: m[2], size, body: null });
      continue;
    }
    res.push({ oid: m[1], type: m[2], size, body: Buffer.from(out.subarray(i, i + size)) });
    i += size + 1;
  }
  return res;
}

/** One mirror commit's tree, resolved to oids (no blob contents). */
export interface MirrorCommitShape {
  commit: string;
  parents: string[];
  /** root entry oids by name (format, writer, fabric-legacy.json). */
  entries: Map<string, string>;
  /** ledger segment oids in order. */
  segments: string[];
}

/** Resolve the shapes of many mirror commits in two batched spawns. */
export function readCommitShapes(cwd: string, fmt: ObjectFormat, commits: string[]): Map<string, MirrorCommitShape> {
  const uniq = [...new Set(commits)];
  const commitObjs = catFileBatch(cwd, uniq);
  const shapes = new Map<string, MirrorCommitShape>();
  const treeReq: string[] = [];
  const parsed: { commit: string; tree: string; parents: string[] }[] = [];
  uniq.forEach((c, idx) => {
    const o = commitObjs[idx];
    if (!o || o.type !== 'commit' || !o.body) throw new Error(`warpline: mirror commit ${c} is not a readable commit`);
    const { tree, parents } = parseCommit(o.body);
    parsed.push({ commit: o.oid, tree, parents });
    treeReq.push(tree);
  });
  const roots = catFileBatch(cwd, treeReq);
  const ledgerReq: (string | null)[] = [];
  const rootEntries: Map<string, string>[] = [];
  roots.forEach((t, idx) => {
    if (!t || t.type !== 'tree' || !t.body) throw new Error(`warpline: mirror commit ${parsed[idx].commit} has no tree`);
    const m = new Map<string, string>();
    for (const e of parseTree(fmt, t.body)) m.set(e.name, e.oid);
    rootEntries.push(m);
    ledgerReq.push(m.get(LEDGER_DIR) ?? null);
  });
  const wanted = ledgerReq.filter((x): x is string => x !== null);
  const ledgerTrees = catFileBatch(cwd, wanted);
  let j = 0;
  parsed.forEach((p, idx) => {
    let segments: string[] = [];
    if (ledgerReq[idx] !== null) {
      const t = ledgerTrees[j++];
      if (!t || !t.body) throw new Error(`warpline: mirror commit ${p.commit} has an unreadable ledger tree`);
      const ents = parseTree(fmt, t.body).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      ents.forEach((e, k) => {
        if (e.name !== segmentName(k)) throw new Error(`warpline: mirror commit ${p.commit} has a gap in its ledger segments`);
      });
      segments = ents.map((e) => e.oid);
    }
    shapes.set(p.commit, { commit: p.commit, parents: p.parents, entries: rootEntries[idx], segments });
  });
  // callers may have passed abbreviated or symbolic names; index by the request too
  uniq.forEach((c, idx) => {
    const s = shapes.get(parsed[idx].commit);
    if (s) shapes.set(c, s);
  });
  return shapes;
}

/**
 * Read blobs by oid with a SIZE CAP checked before any content is read (L3).
 * Throws when the total exceeds `cap` bytes.
 */
export function readBlobsCapped(cwd: string, oids: string[], cap: number, perBlobCap: number = cap): Map<string, Buffer> {
  const uniq = [...new Set(oids)];
  const sizes = catFileBatch(cwd, uniq, true);
  let total = 0;
  sizes.forEach((s, i) => {
    if (!s) throw new Error(`warpline: mirror object ${uniq[i]} is missing`);
    if (s.size > perBlobCap) {
      throw new Error(`warpline: mirror blob ${uniq[i]} is ${s.size} bytes, over the ${perBlobCap}-byte per-blob cap — refusing to read it (L3).`);
    }
    total += s.size;
  });
  if (total > cap) {
    throw new Error(
      `warpline: mirror ledger is ${total} bytes, over the ${cap}-byte cap — refusing to read it (L3: a hostile ` +
        `or runaway ledger blob is never loaded).`,
    );
  }
  const out = new Map<string, Buffer>();
  const bodies = catFileBatch(cwd, uniq);
  bodies.forEach((b, i) => {
    if (!b || !b.body || b.type !== 'blob') throw new Error(`warpline: mirror object ${uniq[i]} is not a readable blob`);
    out.set(uniq[i], b.body);
  });
  return out;
}
