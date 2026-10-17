/**
 * Principals (spec §3.1 data model + "Foreign principals", S32-02, P8-D75).
 *
 *   principalId  = "p:<ns>/<name>"               (local display + storage form)
 *   foreign form = "p:<ns>/<name>@<rootKeyId8>"  (another trust set, display only)
 *   ns           = base32(sha256(rootPublicKey))[0..8]  — 40 bits, can be ground
 *
 * Because ns can be ground, it identifies nothing across kernels: identity is
 * the FULL rootKeyId of the principal's trust set plus its name. `samePrincipal`
 * never consults ns, and a foreign display id never parses as local (G-ID-08).
 */

import { crockford, sha256 } from './internal.js';
import { ROOT_KEY_ID_PATTERN, keyId8 } from './ids.js';

export const PRINCIPAL_KINDS = ['human', 'agent', 'session', 'kernel', 'mod', 'voice', 'peer'] as const;
export type PrincipalKind = (typeof PRINCIPAL_KINDS)[number];

/** ns alphabet: lowercase Crockford base32 (matches the spec example `a1b2c3d4`). */
export const NS_PATTERN = /^[0-9a-hjkmnp-tv-z]{8}$/;
export const PRINCIPAL_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const PRINCIPAL_ID_PATTERN = /^p:([0-9a-hjkmnp-tv-z]{8})\/([a-z0-9][a-z0-9._-]{0,63})$/;
export const FOREIGN_PRINCIPAL_PATTERN =
  /^p:([0-9a-hjkmnp-tv-z]{8})\/([a-z0-9][a-z0-9._-]{0,63})@([0-9a-f]{8})$/;
/** Either form — what an event's `principal` field may carry. */
export const ANY_PRINCIPAL_PATTERN =
  /^p:[0-9a-hjkmnp-tv-z]{8}\/[a-z0-9][a-z0-9._-]{0,63}(@[0-9a-f]{8})?$/;
export const DEVICE_ID_PATTERN = /^dev:[0-9a-hjkmnp-tv-z]{8}\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** ns from the root public key bytes (§3.1). */
export function nsFromRootPublicKey(rootPublicKey: Uint8Array): string {
  return crockford(sha256(rootPublicKey)).slice(0, 8).toLowerCase();
}

export interface ParsedPrincipalId {
  ns: string;
  name: string;
  /** true for the `@<rootKeyId8>` display form: never a local principal. */
  foreign: boolean;
  rootKeyId8?: string;
}

export function parsePrincipalId(id: string): ParsedPrincipalId | undefined {
  let m = PRINCIPAL_ID_PATTERN.exec(id);
  if (m) return { ns: m[1]!, name: m[2]!, foreign: false };
  m = FOREIGN_PRINCIPAL_PATTERN.exec(id);
  if (m) return { ns: m[1]!, name: m[2]!, foreign: true, rootKeyId8: m[3]! };
  return undefined;
}

export function principalId(ns: string, name: string): string {
  if (!NS_PATTERN.test(ns)) throw new TypeError(`bad ns: ${ns}`);
  if (!PRINCIPAL_NAME_PATTERN.test(name)) throw new TypeError(`bad principal name: ${name}`);
  return `p:${ns}/${name}`;
}

/** A principal together with the trust set it belongs to. */
export interface PrincipalRef {
  principalId: string;
  /** full root keyId of the principal's trust set (gkey-p256:v1:<64 hex>). */
  rootKeyId: string;
}

/**
 * THE comparison: same name AND same full rootKeyId. ns is never consulted —
 * two ids with equal ns under different roots are different principals, and a
 * ground ns collision changes nothing (S32-02).
 */
export function samePrincipal(a: PrincipalRef, b: PrincipalRef): boolean {
  if (!ROOT_KEY_ID_PATTERN.test(a.rootKeyId) || !ROOT_KEY_ID_PATTERN.test(b.rootKeyId)) return false;
  const pa = parsePrincipalId(a.principalId);
  const pb = parsePrincipalId(b.principalId);
  if (!pa || !pb) return false;
  return a.rootKeyId === b.rootKeyId && pa.name === pb.name;
}

/** Is this principal in the LOCAL trust set? Decided by rootKeyId only (I5). */
export function isLocalPrincipal(p: PrincipalRef, localRootKeyId: string): boolean {
  const parsed = parsePrincipalId(p.principalId);
  return !!parsed && !parsed.foreign && p.rootKeyId === localRootKeyId;
}

/** Display form for a principal of another trust set: `p:<ns>/<name>@<rootKeyId8>`. */
export function foreignDisplayId(p: PrincipalRef): string {
  const parsed = parsePrincipalId(p.principalId);
  if (!parsed) throw new TypeError(`bad principalId: ${p.principalId}`);
  return `p:${parsed.ns}/${parsed.name}@${keyId8(p.rootKeyId)}`;
}

/** Remote kernel principal `p:<peerNs>/kernel`, kind peer (§3.1). */
export function peerKernelPrincipal(peerNs: string): string {
  return principalId(peerNs, 'kernel');
}
