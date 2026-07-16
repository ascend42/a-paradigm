/**
 * #fabric-refs — pickId refs (V3.2, docs/specs/warpline-v3-identity.md §2).
 *
 * Refs move to EVENT identity: `.warpline/refs/heads/<name>` each hold a pickId —
 * not a stateId. stateIds are many-to-one and cannot name a history position (the
 * legacy selvage's stateId ambiguity is the highest-seq disambiguation hack in
 * select.ts). `selvage` becomes `refs/heads/selvage` holding the tip pickId.
 *
 * Concurrency model (git loose refs + jj prior art, honestly borrowed):
 *   - append is contention-free (strands are content-addressed + parent-linked);
 *   - ADVANCE is per-ref CAS: writeRef(wdir, name, next, expectedOld) — atomic
 *     tmp+rename, refuse if the on-disk ref moved (verbatim the writeSelvage CAS
 *     mechanics, re-scoped per ref). A losing writer's strand is still a valid
 *     DAG node: reseal re-parented (retry) or publish under another ref and weave
 *     later — "conflict" degrades to "merge later", never corruption.
 *   - the O_EXCL fabric lock (lock.ts) survives as the short critical-section
 *     guard for append+ref-write; this CAS is the defense-in-depth beneath it.
 *
 * MIGRATION (one-time, founder-visible — never automatic): migrateSelvageToRefs
 * converts the legacy stateId selvage to refs/heads/selvage via the highest-seq
 * resolution hack EXACTLY ONCE, then the hack is never needed again. Repos that
 * have not migrated stay on the legacy selvage path untouched (the live dogfood
 * fabric migrates as a separate founder-visible step, not as a side effect).
 *
 * Library code: no console output.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { readFabric, readSelvage } from './fabric.js';
import type { Strand } from './strand.js';

/**
 * Legal ref names: single path segment, no traversal (the name is spliced into a
 * filesystem path — an unvalidated `../…` would escape .warpline/ as a WRITE).
 */
const REF_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function assertRefName(name: string): void {
  if (!REF_NAME.test(name) || name.includes('..')) {
    throw new Error(
      `warpline: illegal ref name "${name}" — a ref is a single path segment ([A-Za-z0-9][A-Za-z0-9._-]*); ` +
        `it is spliced into .warpline/refs/heads/, so traversal is refused fail-closed`,
    );
  }
}

function headsDir(wdir: string): string {
  return path.join(wdir, 'refs', 'heads');
}

function refPath(wdir: string, name: string): string {
  assertRefName(name);
  return path.join(headsDir(wdir), name);
}

/** The pickId a ref holds, or null when the ref does not exist. Fails closed on I/O. */
export function readRef(wdir: string, name: string): string | null {
  const p = refPath(wdir, name);
  try {
    return fs.readFileSync(p, 'utf8').trim() || null;
  } catch (err) {
    // ENOENT = the ref genuinely does not exist. Any other error must NOT
    // masquerade as "no ref" — same fail-closed posture as readSelvage.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(
      `warpline: ref unreadable at ${p} — refusing to treat a corrupt ref as absent: ${(err as Error).message}`,
    );
  }
}

/**
 * Advance `name` to `pickId` atomically (write-tmp + rename). When `expectedOld`
 * is supplied this is a per-ref COMPARE-AND-SWAP: it throws if the on-disk ref no
 * longer equals what the caller's decision was based on (a concurrent writer moved
 * it) — `null` means "I expect the ref to not exist yet". Callers seal inside
 * #fabric-lock; the CAS is defense-in-depth against a stolen/stale lock.
 */
export function writeRef(wdir: string, name: string, pickId: string, expectedOld?: string | null): void {
  const p = refPath(wdir, name);
  if (!pickId.startsWith('pick:')) {
    throw new Error(
      `warpline: refs hold pickIds, not "${pickId}" — a stateId cannot name a history position (spec §2; state: selectors remain, but a ref's native type is the pickId)`,
    );
  }
  if (expectedOld !== undefined) {
    const cur = readRef(wdir, name);
    if (cur !== expectedOld) {
      throw new Error(
        `warpline: ref CAS failed on refs/heads/${name} — expected ${expectedOld ?? '(none)'}, found ${cur ?? '(none)'} (a concurrent writer advanced the ref; reseal re-parented on the new tip, or publish under your own ref and weave later)`,
      );
    }
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, pickId + '\n', 'utf8');
  fs.renameSync(tmp, p); // atomic publish — no half-written ref
}

/** Every ref under refs/heads/ as name → pickId (sorted by name; {} when none). */
export function listRefs(wdir: string): Map<string, string> {
  const out = new Map<string, string>();
  let names: string[];
  try {
    names = fs.readdirSync(headsDir(wdir));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return out;
    throw new Error(`warpline: refs/heads unreadable: ${(err as Error).message}`);
  }
  for (const name of names.sort()) {
    if (!REF_NAME.test(name)) continue; // tmp files / strays are not refs
    const v = readRef(wdir, name);
    if (v !== null) out.set(name, v);
  }
  return out;
}

/**
 * The current head pickIds — the API new code writes against instead of assuming
 * a unique tip (spec §6.3). Refs mode: every refs/heads/* value (deduped, sorted
 * by ref name). Legacy (unmigrated) mode: the single physical ledger tip's pickId.
 * [] on an empty fabric.
 */
export function heads(wdir: string): string[] {
  const refs = listRefs(wdir);
  if (refs.size > 0) return [...new Set(refs.values())];
  const fabric = readFabric(wdir);
  return fabric.length ? [fabric[fabric.length - 1].pickId] : [];
}

export interface RefsMigrationResult {
  migrated: boolean;
  /** the pickId refs/heads/selvage now holds (null only when there was nothing to migrate). */
  pickId: string | null;
  /** why nothing was migrated (already migrated / empty fabric). */
  reason?: string;
}

/**
 * ONE-TIME selvage migration (spec §2): resolve the legacy stateId selvage to its
 * strand via highest-seq — exactly the select.ts disambiguation hack, used here
 * for the LAST time — and write refs/heads/selvage with that strand's pickId.
 * Idempotent (an already-migrated repo is a no-op); fails closed when the legacy
 * selvage points at a state no strand carries (corruption is not a fresh start).
 */
export function migrateSelvageToRefs(wdir: string): RefsMigrationResult {
  const existing = readRef(wdir, 'selvage');
  if (existing !== null) return { migrated: false, pickId: existing, reason: 'already migrated' };
  const selvage = readSelvage(wdir);
  if (selvage === null) return { migrated: false, pickId: null, reason: 'no legacy selvage (empty fabric — nothing to migrate)' };
  const fabric = readFabric(wdir);
  let tip: Strand | undefined;
  for (const s of fabric) {
    if (s.stateId === selvage && (!tip || (s.seq ?? -1) > (tip.seq ?? -1))) tip = s;
  }
  if (!tip) {
    throw new Error(
      `warpline: refs migration refused — legacy selvage points at ${selvage} but no strand in the fabric carries that state (corrupt tip; repair .warpline/ first)`,
    );
  }
  writeRef(wdir, 'selvage', tip.pickId, null); // CAS: must still be unmigrated
  return { migrated: true, pickId: tip.pickId };
}
