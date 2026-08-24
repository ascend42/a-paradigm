/**
 * #warp-store (M1a) — the native BLOB object: the raw, untransformed bytes of one
 * file. Byte-authoritative means THE bytes — no eol conversion, no clean/smudge
 * filter, no export-subst. See native-object-store-design.md §1.1/§1.5.
 *
 *   blobId = "blob:v1:" + sha256( "blob " <byteLen> "\0" <raw bytes> )
 *
 * The `"<type> <len>\0"` framing is git's object-header idea, kept for DOMAIN
 * SEPARATION (a blob and a tree of the same bytes never collide) and so we can
 * compute a cheap SHADOW git-sha1 OID for coexistence cross-checks (§2.4). We
 * MIMIC git's model but hash with sha256 — one hash across meaning + bytes (§1.4).
 *
 * Library code: no console output.
 */

import { createHash } from 'node:crypto';

/** git-style object framing: `<type> <len>\0<body>` (len = body BYTE length). */
export function objectFrame(type: 'blob' | 'tree', body: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`${type} ${body.length}\0`, 'utf8'), body]);
}

/** Strip the `<type> <len>\0` header off a framed object, returning the body bytes. */
export function stripFrame(framed: Buffer): Buffer {
  const nul = framed.indexOf(0);
  if (nul < 0) throw new Error('warpline: malformed object — no header NUL');
  return framed.subarray(nul + 1);
}

/** The NATIVE content-address of a blob (sha256 over the framed bytes). */
export function blobId(bytes: Buffer): string {
  return 'blob:v1:' + createHash('sha256').update(objectFrame('blob', bytes)).digest('hex');
}

/**
 * The SHADOW git-sha1 OID of the same bytes — identical to `git hash-object`.
 * Used ONLY during coexistence to prove treeId ⇄ provenance.treeSha byte-for-byte
 * (§2.4); dropped at cutover. Not the native identity.
 */
export function gitBlobOid(bytes: Buffer): string {
  return createHash('sha1').update(objectFrame('blob', bytes)).digest('hex');
}
