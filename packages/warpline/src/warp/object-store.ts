/**
 * #warp-store (M1a) — the native content-addressed OBJECT STORE: loose, zlib-
 * deflated blob + tree objects Warpline OWNS, so a working tree can be
 * reconstructed with git ABSENT (native-object-store-design.md §2.1).
 *
 *   .warpline/objects/blobs/<aa>/<rest>   # deflate("blob " <len> "\0" <raw bytes>)
 *   .warpline/objects/trees/<aa>/<rest>   # deflate("tree " <len> "\0" <canonical bytes>)
 *   .warpline/objects/pack/               # RESERVED — packed objects (post-M1)
 *
 * Fan-out by the first 2 hex chars (git convention). Writes follow WarpStore's
 * disk discipline: write-tmp + atomic rename, `.warpline/`-only, IDEMPOTENT
 * (content-addressed ⇒ same id ⇒ same bytes ⇒ an existing object is never
 * rewritten — this is the M1a slice of review amendment A3; seal-time read-skip
 * lands with M1b where a parent strand/index exists).
 *
 * Library code: no console output.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { blobId, objectFrame, stripFrame } from './blob.js';
import { treeId, nativeTreeBytes, parseTree, type TreeEntry } from './tree.js';

let tmpSeq = 0;

export interface VerifyReport {
  checked: number;
  /** ids whose recomputed content-address does not match their on-disk location. */
  corrupt: string[];
}

export class ObjectStore {
  private readonly dir: string;
  constructor(root: string) {
    this.dir = path.join(root, '.warpline', 'objects');
  }

  private kindOf(id: string): 'blobs' | 'trees' {
    return id.startsWith('tree:') ? 'trees' : 'blobs';
  }

  private loosePath(id: string): string {
    const hex = id.slice(id.lastIndexOf(':') + 1);
    return path.join(this.dir, this.kindOf(id), hex.slice(0, 2), hex.slice(2));
  }

  /** Is this object already stored? (content-addressed ⇒ presence = identity). */
  has(id: string): boolean {
    return fs.existsSync(this.loosePath(id));
  }

  private writeLoose(id: string, framed: Buffer): void {
    const p = this.loosePath(id);
    if (fs.existsSync(p)) return; // idempotent — same id ⇒ same bytes, never rewrite
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = `${p}.tmp.${process.pid}.${tmpSeq++}`;
    fs.writeFileSync(tmp, zlib.deflateSync(framed));
    fs.renameSync(tmp, p); // atomic publish — no half-written object
  }

  /** Store raw file bytes as a blob; returns its id. */
  putBlob(bytes: Buffer): string {
    const id = blobId(bytes);
    this.writeLoose(id, objectFrame('blob', bytes));
    return id;
  }

  /** Read a blob's raw bytes back (byte-faithful — no re-encoding). */
  getBlob(id: string): Buffer {
    return stripFrame(zlib.inflateSync(fs.readFileSync(this.loosePath(id))));
  }

  /** Store a directory manifest as a tree; returns its id. */
  putTree(entries: TreeEntry[]): string {
    const id = treeId(entries);
    this.writeLoose(id, objectFrame('tree', nativeTreeBytes(entries)));
    return id;
  }

  /** Read a tree's entries back. */
  getTree(id: string): TreeEntry[] {
    return parseTree(stripFrame(zlib.inflateSync(fs.readFileSync(this.loosePath(id)))));
  }

  /**
   * Recompute every loose object's content-address and confirm it matches its
   * on-disk location — the M1a integrity check (`warpline objects verify`). A
   * corrupt/tampered object is REPORTED, never silently trusted.
   */
  verify(): VerifyReport {
    const corrupt: string[] = [];
    let checked = 0;
    for (const kind of ['blobs', 'trees'] as const) {
      const base = path.join(this.dir, kind);
      if (!fs.existsSync(base)) continue;
      for (const aa of fs.readdirSync(base)) {
        const sub = path.join(base, aa);
        if (!fs.statSync(sub).isDirectory()) continue;
        for (const rest of fs.readdirSync(sub)) {
          if (rest.includes('.tmp.')) continue; // in-flight write
          checked++;
          const prefix = kind === 'trees' ? 'tree:v1:' : 'blob:v1:';
          const storedId = `${prefix}${aa}${rest}`;
          try {
            const body = stripFrame(zlib.inflateSync(fs.readFileSync(path.join(sub, rest))));
            const actual = kind === 'trees' ? treeId(parseTree(body)) : blobId(body);
            if (actual !== storedId) corrupt.push(storedId);
          } catch {
            corrupt.push(storedId);
          }
        }
      }
    }
    return { checked, corrupt };
  }
}
