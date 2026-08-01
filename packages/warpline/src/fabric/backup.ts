/**
 * #warpline-backup — `warpline backup <dest>`: the custodianship tax's first
 * payment (roadmap-native-first.md PHASE 1 close-out). An ATOMIC snapshot of
 * the whole fabric — ledger (fabric.jsonl) + refs + sidecars (grades, claims,
 * shadow, stakes audit, daemon audit) + the object store — into a directory
 * that IS a home-fabric root: `<dest>/.warpline/**`. The restore path is
 * therefore not a verb at all — point the engine at the backup (`cd <dest>` /
 * `--cwd <dest>` / open it) and every read AND write verb works; `restore`
 * re-materializes worktrees from it exactly as from the original.
 *
 * COPY MECHANISM (chosen for correctness on APFS): `fs.copyFileSync` with
 * COPYFILE_FICLONE — a copy-on-write CLONE on APFS (instant, space-cheap),
 * silently a full byte copy on filesystems without reflink. NEVER hardlinks:
 * a hardlink shares the inode, so a later in-place APPEND to the live
 * fabric.jsonl (the ledger's normal write mode) or an in-place tamper of a
 * source object would silently mutate the "backup". Clones give snapshot
 * isolation from the first byte.
 *
 * ATOMICITY, two layers:
 *   1. Source consistency — the mutable core (everything except objects/) is
 *      copied while HOLDING the fabric lock (lock.ts — the same lock every
 *      writer takes), so no admit/seal can interleave a half-appended ledger
 *      into the snapshot. The object store is copied AFTER release: objects
 *      are content-addressed and immutable-once-written (no gc), and any
 *      object referenced by the ledger-as-copied already existed before the
 *      copy — late arrivals belong to strands the snapshot does not contain.
 *   2. Destination atomicity — everything is staged into a sibling temp dir
 *      on dest's own volume, the manifest is written LAST, then one
 *      `rename(staging → dest)` publishes the whole backup. A crash never
 *      leaves a half-backup at dest.
 *
 * EXCLUDED from the snapshot (each a named choice), matched on the FULL
 * RELATIVE PATH inside `.warpline/` — never on a root basename alone:
 *   - BEARER SECRETS, at ANY depth (see EXCLUDED_SECRET_BASENAMES):
 *     `daemon-tokens.jsonl` (root) AND `daemon/mcp.token` (two levels down).
 *     Both are on the frozen never-leaves-the-box deny-list (stake-guard D5);
 *     a backup may travel, tokens must not.
 *   - `daemon.sock` / `daemon.pid` — live process residue, meaningless (and
 *     uncopyable, for the socket) off the box.
 *   - `refs/.lock*` — the fabric lock is process state, not history.
 *   The daemon AUDIT (`daemon/audit.jsonl`) IS included: accountability data
 *   should survive a dead disk (structural targets only — never prose).
 *
 * C-14 (soundness audit 2026-07-31, Jinx J-11) — WHY the path rule is full-path.
 * The v1 rule fired only at `parts.length === 1`, so it saw `daemon-tokens.jsonl`
 * and missed `.warpline/daemon/mcp.token`, the MCP skin's bearer token
 * (tokens.ts mcpTokenPathOf): it was clone-copied into EVERY backup and hashed
 * into the PUBLISHED manifest, while this header and the CLI help both promised
 * "secrets never travel". Daemon tokens have no expiry and no revocation
 * (tokens.ts — a recorded stage-1 deferral) and the backup destination is
 * caller-chosen, so a leaked backup was a permanent credential leak. The defect
 * CLASS is "the rule can only see depth 1", so secrets are now denied by name at
 * any depth (mirroring the frozen STAKE_DENY_NAMES rule) plus by the `*.token`
 * suffix class, and the residue rules are anchored to their exact paths.
 *
 * POSTURE PRESERVED — this stays a DENY-LIST, deliberately. A sidecar added next
 * month is backed up by DEFAULT; custodianship fails toward preservation. C-14
 * tightens the deny-list; it does not convert it to an allow-list, because an
 * allow-list would silently drop the next sidecar someone forgets to register.
 *
 * MANIFEST: `<dest>/backup.manifest.json` (`warplineBackup:v1`) — one entry
 * per copied file with byte count + sha256 (digested from the STAGED bytes,
 * i.e. what the backup actually contains), plus fabric-level counts. It lives
 * BESIDE `.warpline/`, not inside it, so the backup's fabric dir holds only
 * fabric.
 *
 * VERIFY: `warpline backup verify <dest>` — recomputes every digest, flags
 * missing/extra/mismatched files, then runs the full verifyFabric
 * authentication against the backup copy. `ok` ⇔ zero problems AND zero
 * fabric failures.
 *
 * Library code: no console output.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { warplineDirOf } from './fabric.js';
import { withFabricLock } from './lock.js';
import { listRefs } from './refs.js';
import { verifyFabric, type FabricVerifyReport } from './verify.js';

export const BACKUP_MANIFEST_SCHEMA = 'warplineBackup:v1' as const;
export const BACKUP_MANIFEST_BASENAME = 'backup.manifest.json';

/** One copied file, addressed relative to `<dest>` (posix separators). */
export interface BackupFileEntry {
  path: string;
  bytes: number;
  sha256: string;
}

export interface BackupCounts {
  /** files copied (== manifest entries). */
  files: number;
  /** object-store files (under objects/). */
  objects: number;
  /** non-empty fabric.jsonl lines (ledger rows: strands + anchors). */
  ledgerRows: number;
  /** refs/heads entries in the snapshot. */
  refs: number;
}

export interface BackupManifest {
  schemaVersion: typeof BACKUP_MANIFEST_SCHEMA;
  createdAt: string;
  sourceRoot: string;
  counts: BackupCounts;
  totalBytes: number;
  files: BackupFileEntry[];
}

export interface BackupResult {
  dest: string;
  manifestPath: string;
  counts: BackupCounts;
  totalBytes: number;
  /** selvage pickId at snapshot time (refs/heads/selvage), or null. */
  selvage: string | null;
}

export type BackupProblemKind = 'digest-mismatch' | 'size-mismatch' | 'missing' | 'extra' | 'manifest-invalid';

export interface BackupVerifyProblem {
  path: string;
  kind: BackupProblemKind;
  detail: string;
}

export interface BackupVerifyReport {
  ok: boolean;
  dest: string;
  /** null when the manifest itself was missing/unreadable (manifest-invalid). */
  manifest: BackupManifest | null;
  problems: BackupVerifyProblem[];
  /** the full history authentication run against the BACKUP copy (null when
   * the manifest failed — no point authenticating an unidentified tree). */
  fabric: FabricVerifyReport | null;
}

/**
 * BEARER SECRETS by name, denied at ANY DEPTH inside `.warpline/` — the same
 * name-anywhere rule the frozen stake deny-list uses (stake-guard.ts
 * STAKE_DENY_NAMES). Depth-agnostic ON PURPOSE: C-14's defect class was a rule
 * that could only see depth 1, and a secret is a secret wherever it sits.
 * The complete enumeration of secret-bearing artifacts under `.warpline/`:
 *   - `daemon-tokens.jsonl` — every minted bearer token (tokens.ts tokensPathOf).
 *   - `mcp.token`           — the MCP skin's bearer token, at `daemon/mcp.token`
 *                             (tokens.ts mcpTokenPathOf). THE C-14 miss.
 *   - `session-keys.jsonl`  — no writer exists today; the frozen D5 list already
 *                             names it a bearer secret, so it is denied BEFORE
 *                             it can be written rather than after.
 */
const EXCLUDED_SECRET_BASENAMES: ReadonlySet<string> = new Set([
  'daemon-tokens.jsonl',
  'mcp.token',
  'session-keys.jsonl',
]);

/**
 * Secret-bearing SUFFIX class, at any depth. The generalization C-14 asks for:
 * a future credential sidecar following the established `mcp.token` naming is
 * withheld the day it is WRITTEN, not the day someone remembers to extend the
 * set above. Narrow by design — `.token` is not used by any non-secret fabric
 * artifact, so this cannot swallow a legitimate sidecar.
 */
const EXCLUDED_SECRET_SUFFIXES: readonly string[] = ['.token'];

/**
 * LIVE-PROCESS RESIDUE at its exact relative path (anchored, not by basename):
 * these are meaningless off the box, and the socket is uncopyable. Anchored
 * because a file that merely SHARES the name deeper in the tree is not the
 * daemon's socket or pidfile and has no reason to be withheld.
 */
const EXCLUDED_EXACT_PATHS: ReadonlySet<string> = new Set(['daemon.sock', 'daemon.pid']);

/** `rel` is the POSIX path relative to `.warpline/` — always matched whole. */
function isExcluded(rel: string, entry: fs.Dirent): boolean {
  if (entry.isSocket() || entry.isFIFO()) return true; // never snapshot live endpoints
  const parts = rel.split('/');
  const base = parts[parts.length - 1]!;
  if (EXCLUDED_SECRET_BASENAMES.has(base)) return true;
  if (EXCLUDED_SECRET_SUFFIXES.some((suffix) => base.endsWith(suffix))) return true;
  if (EXCLUDED_EXACT_PATHS.has(rel)) return true;
  if (parts[0] === 'refs' && parts.length === 2 && parts[1]!.startsWith('.lock')) return true;
  return false;
}

/** Walk `.warpline/` collecting relative (posix) file paths, exclusions applied. */
function walkFabricFiles(wdir: string, sub = ''): string[] {
  const out: string[] = [];
  const abs = path.join(wdir, sub);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return out;
    throw err;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = sub ? `${sub}/${entry.name}` : entry.name;
    if (isExcluded(rel, entry)) continue;
    if (entry.isDirectory()) out.push(...walkFabricFiles(wdir, rel));
    else if (entry.isFile()) out.push(rel);
    // symlinks/devices inside .warpline are not fabric — skipped
  }
  return out;
}

function sha256File(p: string): { sha256: string; bytes: number } {
  const buf = fs.readFileSync(p);
  return { sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
}

/** Clone-copy one fabric file into the staging tree (COPYFILE_FICLONE — CoW on
 * APFS, full copy elsewhere; never a hardlink), then digest the STAGED bytes. */
function stageFile(wdir: string, stagingWdir: string, rel: string): BackupFileEntry {
  const src = path.join(wdir, rel);
  const dst = path.join(stagingWdir, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst, fs.constants.COPYFILE_FICLONE);
  const { sha256, bytes } = sha256File(dst);
  return { path: `.warpline/${rel}`, bytes, sha256 };
}

function countLedgerRows(stagingWdir: string): number {
  try {
    return fs
      .readFileSync(path.join(stagingWdir, 'fabric.jsonl'), 'utf8')
      .split('\n')
      .filter((l) => l.trim()).length;
  } catch {
    return 0;
  }
}

/**
 * Snapshot the fabric at `root` into the (not-yet-existing) directory `dest`.
 * See the module header for the mechanism. Throws on: no fabric at root, dest
 * already existing, or dest nested inside the source `.warpline/`.
 */
export async function backupFabric(
  root: string,
  dest: string,
  opts: { now?: string } = {},
): Promise<BackupResult> {
  const wdir = warplineDirOf(root);
  if (!fs.existsSync(wdir)) {
    throw new Error(`warpline: backup — no fabric at ${wdir} (nothing to snapshot)`);
  }
  const destAbs = path.resolve(dest);
  if (fs.existsSync(destAbs)) {
    throw new Error(`warpline: backup — dest already exists: ${destAbs} (refusing to overlay; pick a fresh directory)`);
  }
  const wdirAbs = path.resolve(wdir);
  if (destAbs === wdirAbs || destAbs.startsWith(wdirAbs + path.sep)) {
    throw new Error(`warpline: backup — dest must not live inside the source fabric (${wdirAbs})`);
  }

  const parent = path.dirname(destAbs);
  fs.mkdirSync(parent, { recursive: true });
  // Sibling staging dir = same volume as dest ⇒ the final rename is atomic.
  const staging = fs.mkdtempSync(path.join(parent, '.warpline-backup-stage-'));
  const stagingWdir = path.join(staging, '.warpline');

  try {
    // Phase 1 — the MUTABLE CORE under the fabric lock: ledger, refs, sidecars,
    // audits. Held briefly (objects are the bulk and copy lock-free below).
    const coreFiles = await withFabricLock(root, () =>
      walkFabricFiles(wdir).filter((rel) => !rel.startsWith('objects/')).map((rel) => stageFile(wdir, stagingWdir, rel)),
    );
    // Phase 2 — the OBJECT STORE, lock-free (content-addressed, immutable once
    // written, no gc): everything the staged ledger references already exists.
    const objectFiles = walkFabricFiles(wdir)
      .filter((rel) => rel.startsWith('objects/'))
      .map((rel) => stageFile(wdir, stagingWdir, rel));

    const files = [...coreFiles, ...objectFiles];
    const refsInSnapshot = listRefs(stagingWdir);
    const counts: BackupCounts = {
      files: files.length,
      objects: objectFiles.length,
      ledgerRows: countLedgerRows(stagingWdir),
      refs: refsInSnapshot.size,
    };
    const manifest: BackupManifest = {
      schemaVersion: BACKUP_MANIFEST_SCHEMA,
      createdAt: opts.now ?? new Date().toISOString(),
      sourceRoot: path.resolve(root),
      counts,
      totalBytes: files.reduce((sum, f) => sum + f.bytes, 0),
      files,
    };
    // Manifest LAST, then the one atomic publish.
    fs.writeFileSync(path.join(staging, BACKUP_MANIFEST_BASENAME), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    fs.renameSync(staging, destAbs);

    return {
      dest: destAbs,
      manifestPath: path.join(destAbs, BACKUP_MANIFEST_BASENAME),
      counts,
      totalBytes: manifest.totalBytes,
      selvage: refsInSnapshot.get('selvage') ?? null,
    };
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw err;
  }
}

/**
 * Verify a backup at `dest`: recompute every manifest digest against the bytes
 * on disk, flag missing/extra/size-mismatched files, then authenticate the
 * backup's fabric with verifyFabric (the full history walk — pickId recompute,
 * chain/DAG, binding recompute, anchor). Read-only over dest.
 */
export function verifyBackup(dest: string): BackupVerifyReport {
  const destAbs = path.resolve(dest);
  const manifestPath = path.join(destAbs, BACKUP_MANIFEST_BASENAME);
  const problems: BackupVerifyProblem[] = [];

  let manifest: BackupManifest | null = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BackupManifest;
    if (parsed?.schemaVersion !== BACKUP_MANIFEST_SCHEMA || !Array.isArray(parsed.files)) {
      problems.push({
        path: BACKUP_MANIFEST_BASENAME,
        kind: 'manifest-invalid',
        detail: `unrecognized manifest (want schemaVersion ${BACKUP_MANIFEST_SCHEMA})`,
      });
    } else {
      manifest = parsed;
    }
  } catch (err) {
    problems.push({
      path: BACKUP_MANIFEST_BASENAME,
      kind: 'manifest-invalid',
      detail: `manifest unreadable at ${manifestPath}: ${(err as Error).message}`,
    });
  }

  if (!manifest) return { ok: false, dest: destAbs, manifest: null, problems, fabric: null };

  // 1 — every manifest entry present, size-true, and digest-true.
  const listed = new Set<string>();
  for (const entry of manifest.files) {
    listed.add(entry.path);
    const abs = path.join(destAbs, entry.path);
    let actual: { sha256: string; bytes: number };
    try {
      actual = sha256File(abs);
    } catch {
      problems.push({ path: entry.path, kind: 'missing', detail: 'listed in the manifest but absent from the backup' });
      continue;
    }
    if (actual.bytes !== entry.bytes) {
      problems.push({ path: entry.path, kind: 'size-mismatch', detail: `manifest ${entry.bytes}B, on disk ${actual.bytes}B` });
    } else if (actual.sha256 !== entry.sha256) {
      problems.push({ path: entry.path, kind: 'digest-mismatch', detail: `manifest ${entry.sha256.slice(0, 12)}…, recomputed ${actual.sha256.slice(0, 12)}…` });
    }
  }

  // 2 — no unmanifested files inside the backup's fabric (an ADDITION is
  // tamper evidence too).
  for (const rel of walkFabricFiles(path.join(destAbs, '.warpline'))) {
    const asManifestPath = `.warpline/${rel}`;
    if (!listed.has(asManifestPath)) {
      problems.push({ path: asManifestPath, kind: 'extra', detail: 'present in the backup but not in the manifest' });
    }
  }

  // 3 — the backup IS a fabric: authenticate its whole history in place.
  let fabric: FabricVerifyReport | null = null;
  try {
    fabric = verifyFabric(destAbs);
  } catch (err) {
    problems.push({ path: '.warpline', kind: 'manifest-invalid', detail: `verifyFabric threw: ${(err as Error).message}` });
  }

  const ok = problems.length === 0 && fabric !== null && fabric.failures.length === 0;
  return { ok, dest: destAbs, manifest, problems, fabric };
}
