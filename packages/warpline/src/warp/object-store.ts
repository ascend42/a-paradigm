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

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { blobId, objectFrame, stripFrame } from './blob.js';
import { atomicWriteSync } from './durable.js';
import { treeId, nativeTreeBytes, parseTree, type TreeEntry } from './tree.js';

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

  /**
   * DURABILITY (audit C-7): loose objects are hardened, git-parity — git has
   * fsynced loose objects by default since 2.36 (`core.fsync=committed`). Both
   * halves matter and for different reasons: without the file fsync the rename
   * can outrun the bytes and readVerified would reject a published object as
   * corrupt; without the parent-directory fsync the object silently is not
   * there and `restore` fails closed on a dangling treeId.
   *
   * Note git does NOT fsync the fanout directory here and we DO — the extra
   * ~3.8 ms per NEW object is bought deliberately, because Warpline's ledger
   * commits to `binding.treeId` and a lost directory entry turns a sealed,
   * verified strand into an unrestorable one. `WARPLINE_FSYNC=none` is the
   * escape for bulk backfills where that trade is wrong.
   */
  private writeLoose(id: string, framed: Buffer): void {
    const p = this.loosePath(id);
    if (fs.existsSync(p)) return; // idempotent — same id ⇒ same bytes, never rewrite
    atomicWriteSync(p, zlib.deflateSync(framed));
  }

  /** Store raw file bytes as a blob; returns its id. */
  putBlob(bytes: Buffer): string {
    const id = blobId(bytes);
    this.writeLoose(id, objectFrame('blob', bytes));
    return id;
  }

  /**
   * VERIFIED READ (trust floor, MEDIUM-1): recompute the content-address of the
   * body bytes just inflated and FAIL CLOSED on a mismatch. Content-addressed ⇒
   * the id IS the contract; a loose object whose bytes no longer hash to their
   * on-disk location is tamper/corruption and must never be silently trusted by
   * restore/materialize/verify. Always-on — hashing on read is cheap at current
   * scale, and one uniform rule beats a trusted/untrusted read fork.
   */
  private readVerified(id: string, kind: 'blob' | 'tree'): Buffer {
    const body = stripFrame(zlib.inflateSync(fs.readFileSync(this.loosePath(id))));
    // Hash the RAW framed bytes (stricter than parse→reserialize: a non-canonical
    // byte tamper that round-trips the parser is still caught).
    const actual =
      `${kind}:v1:` + createHash('sha256').update(objectFrame(kind, body)).digest('hex');
    if (actual !== id) {
      throw new Error(
        `warpline: object store corruption — ${kind} at ${id} recomputes to ${actual}; ` +
          `refusing to return tampered bytes (fail closed)`,
      );
    }
    return body;
  }

  /** Read a blob's raw bytes back (byte-faithful — no re-encoding; verified read). */
  getBlob(id: string): Buffer {
    return this.readVerified(id, 'blob');
  }

  /** Store a directory manifest as a tree; returns its id. */
  putTree(entries: TreeEntry[]): string {
    const id = treeId(entries);
    this.writeLoose(id, objectFrame('tree', nativeTreeBytes(entries)));
    return id;
  }

  /** Read a tree's entries back (verified read — fails closed on tampered bytes). */
  getTree(id: string): TreeEntry[] {
    return parseTree(this.readVerified(id, 'tree'));
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
