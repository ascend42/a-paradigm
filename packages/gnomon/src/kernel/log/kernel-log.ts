/**
 * @symbol #kernel-log
 *
 * #kernel-log (spec §3.2, M1.2; research 29 §4 PR-4) — the one hash-chained,
 * append-only, segmented index of everything the kernel does.
 *
 * STORAGE (§3.2 data model). SQLite via `node:sqlite`. The ACTIVE segment is
 * `<home>/kernel.db`; sealed segments live at `<home>/log/segments/NNNNNN.db`.
 * Each segment file holds the spec's `chain` table plus a write-once `meta`
 * table (log id, segment number, base seq, base prev). BEFORE UPDATE/DELETE
 * triggers RAISE(ABORT) on both (L1, G-LOG-02). `seq` is computed inside the
 * write transaction and checked against the in-memory tip (never
 * AUTOINCREMENT). `chain.envelope` stores the exact canonical text that is
 * hashed, so verify recomputes from bytes on disk.
 *
 * SEGMENTS (L5, §9.4; epoch-anchor pattern). A segment closes at `segmentRows`
 * rows (default 10⁶): its LAST row is a `daemon.segment{segment, next,
 * firstSeq, lastSeq}` event, the WAL is checkpointed, the file is fsynced and
 * renamed into `log/segments/`, and a fresh `kernel.db` is created whose base
 * prev is the closing row's hash — the chain runs on unbroken across files.
 * A crash anywhere in rotation is completed on the next open (closing row
 * present ⇒ finish the rename; sealed segment present and no kernel.db ⇒
 * create the next segment iff the file anchor agrees with the closing row,
 * or (S34-25) lags it relaxably across a boot change — P8-D85 below).
 * ROTATION FAILURE (T-2026-10-17-013(a)): once sealing has closed the active
 * db, any failure (fsync / fsyncDir EIO, the seal rename, creating the next
 * kernel.db) HALTS the instance: it is closed, append and acknowledgeGap
 * refuse ENGINE{rotation-failed} (reads refuse `closed`), and close() writes
 * no anchor and reports `keystore: 'failed'` with that error. The disk holds
 * a rotation window (the durable file anchor at the closing row is written
 * before sealing starts, or the open path's checks re-run): reopening is the
 * recovery and completes the rotation.
 *
 * CRASH SAFETY / FSYNC POLICY (stated, measured in test/kernel-log-posix):
 *   - durability 'process-crash' (default): WAL + `synchronous=FULL`, i.e.
 *     every commit fsync(2)s the WAL before append returns. A commit survives
 *     a kill -9 of the daemon because its write() completed (the page cache
 *     outlives the process); `synchronous=FULL` is what makes it survive an
 *     OS crash on hardware that honours fsync (research 33 S33-10 correction
 *     to S33-01). On macOS fsync(2) does not flush the drive cache, so a POWER
 *     LOSS or panic can drop the last commits — and the cache may write back
 *     out of order, so an anchor can end up AHEAD of the db; open reports
 *     that as INTEGRITY_BROKEN{truncated} with a classified cause (below).
 *   - durability 'power-loss': additionally `fullfsync=1` (F_FULLFSYNC per
 *     commit). Measured ~10 ms p50 on an Apple SSD — above the M1.2 5 ms p99
 *     falsifier, so it is opt-in and named, not the default.
 *   - checkpoints: SQLite's inline WAL auto-checkpoint is OFF on the writer
 *     (measured: with it on, ~1 append in 43 paid a ~7.5 ms checkpoint and
 *     p99 over 10⁶ rows was 7.6 ms, tripping the M1.2 falsifier). The log
 *     runs a PASSIVE checkpoint when appends go idle (`checkpointIdleMs`,
 *     unref'd timer) and inline every `checkpointEvery` appends as a hard
 *     WAL bound; close and rotation TRUNCATE-checkpoint. Trade-off stated:
 *     under sustained load the bound costs one longer append per
 *     `checkpointEvery` (visible in `max`, not in p99).
 *   - torn tail: SQLite discards a torn WAL frame on open, so a torn tail
 *     loses only the uncommitted (or, after a lying fsync, the last)
 *     transaction; the anchor check then either accepts a lagging anchor or
 *     reports `INTEGRITY_BROKEN{truncated}` — it never silently forks.
 *
 * READ SIDE (§9.3, M1.4 slice 2): readPage (cursor paging, every row
 * re-hashed before projection, mismatches withheld), getById (ev: refs) and
 * onCommit (tail observers for #socket subscriptions, called after COMMIT).
 * releasedHead() bounds every read (D83 ordering). RESIDUAL UNTIL M1.3
 * (round 3, documented not built): with the STUB keystore anchor, a critical
 * row committed in a previous run whose anchoring never completed (crash
 * between COMMIT and the file-anchor rename) and that open's marker pass does
 * not classify is NOT held out of the released head on restart — this run
 * sees it as released. Fail-closed handling (critical rows above the FILE
 * anchor held until re-anchored or acknowledged when no keystore anchor
 * exists) lands with the real keystore anchor in M1.3.
 *
 * ANCHORS (§3.2, G-LOG-06/07/10) — see anchor.ts; WHEN they are written is
 * anchor-policy.ts (research 33 S33-05..07, P8-D82):
 *   - bulk rows: the file anchor (tmp+rename) is coalesced — written when 63
 *     rows are un-anchored or 50 ms after the first un-anchored row (inline
 *     check + unref'd timer), and on checkpoint; the keystore anchor every
 *     1023 rows / 1 s, queued off the append path (serialised promise chain).
 *     Both durable at genesis, rotation and close; close marks the file
 *     anchor `closed: true` (the clean-close marker).
 *   - critical kinds (CRITICAL_ANCHOR_KINDS; research 33 S33-10, P8-D83):
 *     the commit uses the bulk durability (`synchronous=FULL`, NO `PRAGMA
 *     fullfsync` — F_FULLFSYNC per commit failed the 25 ms critical budget,
 *     probes/results/p-log-fsync-human-cadence.darwin.json), then the file
 *     anchor is renamed in, then the keystore write is AWAITED, and only then
 *     does `append` resolve `{anchored: true}`. This is an ORDERING guarantee
 *     against a same-user process (no effect is released before the keystore
 *     anchor exists, so an attacker who stops the kernel before the promise
 *     resolves erased an event with no effect yet) — NOT a power-loss
 *     guarantee: neither bulk nor critical anchors are prevented from being
 *     durable ahead of a lost WAL tail. F_FULLFSYNC remains only under
 *     durability 'power-loss' and at genesis, rotation and close.
 *   - every anchor records `boot` (boot.ts); only the keystore copy (and its
 *     `closed` marker) is authoritative.
 * On open: no db but a head anchor, a keystore anchor (present or malformed;
 * read BEFORE anything is created, S34-31, so the refusal writes no file), a
 * sealed segment or keys present ⇒ INTEGRITY_BROKEN (missing-db), except the
 * rotation window above. KNOWN DOUBLE FAULT (S34-29): genesis renames
 * kernel.db in and fsyncs the home BEFORE the first head file; if that
 * fsyncDir(home) fails (EIO) the open throws with kernel.db present and no
 * head file, and every later open refuses INTEGRITY_BROKEN{anchor-missing}.
 * That is fail-closed and is never auto-recreated (a missing anchor over an
 * existing db is exactly what a same-user deletion leaves); recovery is a
 * manual wipe of the never-used home (it holds no row) or the quarantine
 * command. STATED RESIDUAL (round 2): acknowledgeGap rotates first when the
 * db tip is a daemon.segment closing row (S34-13); a rotation HALT there
 * after the seal rename leaves no kernel.db while the keystore anchor still
 * names the lost head (the evidence is never rewritten before the gap row),
 * so the next open refuses missing-db instead of reopening the
 * acknowledgeable truncation (unless the file anchor sits exactly at the
 * closing row: then it reopens as the same truncation). Fail-closed; the quarantine command recovers. An anchor ahead of the db ⇒ truncated, with

 * `data.cause` (S33-10) `tamper` when the keystore anchor's boot equals this
 * boot, or it was a clean close, or the boot cannot be compared, and
 * `unclean-reboot` when the boot changed and the anchor was not a clean
 * close. The cause names "power loss OR tampering", never proves either: a
 * truncation made after a reboot but BEFORE the first open in the new boot
 * is indistinguishable from a lost WAL tail (it reads `unclean-reboot`);
 * every non-recovery open therefore re-stamps the keystore anchor with the
 * current boot (S34-01) and gates the first append on that write, so a
 * truncation after the daemon opened in this boot reads `tamper`. The cause
 * never downgrades the verdict: `open` refuses both, and
 * `openForRecovery` returns a log that refuses appends until
 * `acknowledgeGap({presenceToken})` (presence-gated, unclean-reboot only)
 * appends a kernel-signed daemon.log.gap{lostFrom, lostTo, lostHash,
 * bootPrev, bootNow, fileLag} and re-anchors. Both are INTERNAL SEAMS until
 * presence lands (T-2026-10-17-009(c)): registered with internal-seams.ts and
 * reachable only through the internal test entry, like the keystoreAnchor
 * and bootSession overrides; `presenceToken` is a branded PresenceToken
 * (identity/presence.ts). test/seams-fence.test.ts is the tripwire. Hash ≠ row hash ⇒ anchor-mismatch;
 * missing on an existing log ⇒ anchor-missing; file-anchor lag > 63 (unless
 * relaxed across a boot change, P8-D85 below, or classified truncated when
 * the keystore anchor is ahead, S34-24), or any lag behind a
 * clean-close anchor ⇒ anchor-lag; keystore lag > 1023 ⇒ a kernel-signed
 * daemon.anchor.lag{rows, which} row. A clean-close KEYSTORE
 * anchor (authoritative) with any lag is anchor-lag too (S34-05).
 *
 * ANCHOR FAULTS (S34-02): any failure after a critical row's COMMIT (file
 * anchor, keystore reject or timeout — `keystoreTimeoutMs`, default 5 s,
 * S34-11; NOT rotation: a critical append rotates only after its anchors
 * settled, round 2 of T-2026-10-17-013(a), see append) rejects that append ENGINE{anchor-failed} and puts the log in
 * an anchor-faulted state: bulk appends continue, CRITICAL appends first
 * re-anchor the current head (file + awaited keystore) and are refused
 * ENGINE{anchor-faulted} if that fails. Once both anchors succeed, one
 * kernel-signed `daemon.anchor.failed{seq, kind}` marker is COMMITTED
 * IMMEDIATELY in the failure path (S34-17 — committing needs no keystore), so
 * the fault survives a close or a crash. PROJECTIONS MUST TREAT THAT SEQ AS
 * NOT HAVING TAKEN EFFECT: the row is in the chain, but its effect was never
 * released. The fault clears only when every failed row has its marker AND a
 * head at or past every marker is anchored in both anchors (S34-19); close()
 * records any pending markers before its closing anchors and reports the
 * outcome. On OPEN, every critical row above the keystore anchor's seq with no
 * marker (a crash between COMMIT and the keystore write) gets one before the
 * log is usable. A failed open re-stamp (S34-01) enters the fault state with
 * nothing to record. An interrupted acknowledgeGap (gap row committed, the
 * keystore still at the lost head named by its payload) is re-anchored on
 * open, not re-classified.
 *
 * KEYLESS LOGS (signer null) are NON-ROTATING and DIAGNOSTIC-ONLY: every
 * kernel row the log writes itself (daemon.segment, daemon.anchor.lag,
 * daemon.anchor.failed, daemon.log.gap) is signature-mandatory, so an append
 * that would reach the segment boundary, or an open that would have to record
 * one, is refused BEFORE any commit with FORBIDDEN{kernel-key-required}.
 *
 * CHECKS BEFORE WRITES (S34-30): on open, every integrity check (file anchor
 * + lag bounds, keystore anchor + clean-close lag, keyless refusals for the
 * open-time rows) completes before the first anchor write, rotation
 * completion or row append. Completing a crashed rotation on open writes no
 * anchor (the file rewrite and the closing re-stamp anchor the head), so no
 * queued keystore write can land after a refusal and overwrite the evidence.
 *
 * KNOWN GAPS — DECIDED:
 *   (a) DECIDED P8-D84: accepted dev-only until T-2026-10-17-009. With the
 *       stub keystore (until M1.3) there is no authoritative boot, so every
 *       truncation classifies `tamper` and cannot be acknowledged: a known
 *       no-recovery window; the recovery path is the quarantine command,
 *       task T-2026-10-17-009.
 *   (b) DECIDED P8-D85: the S33-07 file-anchor bound (lag > 63 ⇒ anchor-lag)
 *       is not power-loss-safe (un-fsynced file-anchor renames can roll back
 *       after a power cut), so it is relaxed ACROSS A BOOT CHANGE only. At
 *       open, after the truncation check, a file-anchor lag > 63 opens ONLY
 *       if ALL hold: the keystore anchor is present with no `closed`; it
 *       passes the full anchor check (hash matches at its seq, not ahead) and
 *       is within its own lag bound or produces the existing keystore lag
 *       row; bootPrev (the KEYSTORE anchor's recorded boot, normalised) and
 *       bootNow are both known and differ; and the file anchor's hash still
 *       matches the row at its seq (only the lag is relaxed; a mismatch still
 *       refuses anchor-mismatch). When relaxed, a kernel-signed
 *       `daemon.anchor.lag{rows, which: 'file', bootPrev, bootNow}` is
 *       appended; a keyless log refuses FORBIDDEN{kernel-key-required}.
 *       Everything else refuses INTEGRITY_BROKEN{anchor-lag} (with
 *       `data.relax` naming why): same boot; either boot unknown; keystore
 *       stub/unavailable (relax: keystore-unavailable), absent or
 *       malformed; a pre-D83 anchor without boot (relax: boot-unknown);
 *       keystore closed; a file anchor marked closed with any lag. The file
 *       anchor's own `boot` is never consulted. A relaxed lag defers every
 *       open-time anchor write (file rewrite, marker/keystore-lag re-anchor)
 *       until the signed row is committed; rotation completion runs before
 *       the row but writes no anchor. S34-25: a crash inside that rotation
 *       completion, between the seal rename and the new kernel.db, leaves the
 *       lagging file anchor and no active db. That state is accepted as a
 *       rotation window iff the same relaxation holds against the sealed
 *       closing row (file-anchor hash matches its sealed row and lags it by
 *       > 63; keystore anchor present, not closed, hash-checked against the
 *       sealed rows, not ahead; both boots known and different; a kernel key —
 *       keyless refuses FORBIDDEN{kernel-key-required} before any write): the
 *       segment is created, the full checks re-run, the relaxed row is
 *       appended in the new segment FIRST and the file anchor rewritten
 *       SECOND. Anything else there refuses missing-db. S34-24: when the
 *       KEYSTORE anchor is ahead, the open classifies `truncated` (cause from
 *       the keystore boot) whatever the file lag: the file anchor still gets
 *       the hash and clean-close checks, only the > 63 bound is skipped, and
 *       its lag is reported as `fileLag` (also in daemon.log.gap).
 *
 * SIGNATURES (§3.2, §3.1) — see signer.ts and chain.ts. Unsigned rows are
 * accepted only for the diagnostic namespaces; the mandatory list refuses
 * unsigned with reason `unsigned-mandatory` (G-LOG-08).
 *
 * The kernel cannot use the Paradigm logger (zero deps, G-SEC-01); this module
 * reports through return values, refusals and the optional `onDiagnostic`
 * callback, never stdout.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import {
  canonicalJson,
  EVENT_V1,
  defaultLabelsFor,
  INJECT_ORIGINS,
  validateSessionCompactedPayload,
  validateKindPayload,
  isPlainObject,
  mintId,
  monotonicUlidFactory,
  SENSITIVITIES,
  validateEventV1,
  type Audience,
  type EventScopeV1,
  type EventV1,
  type KindOwner,
  type Sensitivity,
} from '@a-company/gnomon-contracts';
import { FileAnchorStore, fsyncDir, fsyncFile, HEAD_SCHEMA, KeystoreAnchorStore, type AnchorReadResult, type AnchorStore, type HeadAnchor } from './anchor.js';
import { BOOT_UNKNOWN, normalizeBootId, readBootSession } from './boot.js';
import {
  FILE_ANCHOR_MAX_LAG,
  FILE_ANCHOR_MAX_MS,
  FORCED_ANCHOR_ENVELOPE,
  FORCED_ANCHOR_WINDOW,
  isCriticalKind,
  KEYSTORE_ANCHOR_MAX_LAG,
  KEYSTORE_ANCHOR_MAX_MS,
} from './anchor-policy.js';
import {
  assertOwner,
  genesisPrev,
  isSigMandatory,
  logRefusal,
  mayBeUnsigned,
  resolveLabels,
  sha256TaggedFast,
} from './chain.js';
import { projectForReader, type LogView, type ReaderClass } from './redaction.js';
import { KeyRing, SoftwareEd25519Signer, type Signer } from './signer.js';
import { consumePresence, type PresenceToken } from '../identity/presence.js';
import { registerSeams, type KernelLogSeamOptions } from '../internal-seams.js';

/**
 * T-2026-10-17-009(c): option keys that are TEST SEAMS. They are not on
 * KernelLogOptions (nor on verifyLog's options), and both refuse them at
 * runtime, so a JavaScript caller (or a spread of a wider object) cannot slip
 * a substituted keystore anchor or boot id past the type. The constructor's
 * seam and recovery parameters are reachable only with CONSTRUCT_KEY, held by
 * `KernelLog.open` and the registered seam closures: a cast call of the
 * private constructor throws. Tests pass the seams through the internal test
 * entry (src/kernel/testing.ts).
 */
const SEAM_OPTION_KEYS = ['keystoreAnchor', 'bootSession'] as const;

/** Module-private: the KernelLog constructor refuses any caller without it (TS `private` is type-only). */
const CONSTRUCT_KEY: unique symbol = Symbol('gnomon.kernel-log.construct');

function refuseSeamKeys(opts: object, where: string): void {
  for (const k of SEAM_OPTION_KEYS) {
    if (Object.prototype.hasOwnProperty.call(opts, k)) throw new TypeError(`#kernel-log: ${where}: ${k} is a test seam, reachable only through the internal test entry (T-2026-10-17-009)`);
  }
}

export const DEFAULT_SEGMENT_ROWS = 1_000_000;
export const SEGMENT_SCHEMA = 'gnomonLogSegment:v1' as const;
export const ACTIVE_DB = 'kernel.db';
export const SEGMENTS_DIR = path.join('log', 'segments');

export type Durability = 'process-crash' | 'power-loss';

export interface KernelLogOptions {
  /** The Gnomon home (`~/.gnomon`), already created 0700 by $daemon-lifecycle. */
  home: string;
  /** The kernel principal `p:<ns>/kernel` — appender of daemon.segment rows. */
  kernelPrincipal: string;
  /** The kernel key. `null` = no key loaded: only diagnostics can be appended. */
  signer: Signer | null;
  /** Public keys for verify; the signer's own key is added automatically. */
  keyRing?: KeyRing;
  segmentRows?: number;
  durability?: Durability;
  /** Keys exist on this machine (M1.3 supplies it): a missing db is then INTEGRITY_BROKEN, never a fresh genesis. */
  keysPresent?: boolean;
  /** S34-23 test seam: file-anchor coalescing window in ms (default FILE_ANCHOR_MAX_MS). */
  fileAnchorMaxMs?: number;
  /** S34-11: per-write keystore anchor timeout, measured from DEQUEUE (default KEYSTORE_WRITE_TIMEOUT_MS). */
  keystoreTimeoutMs?: number;
  /** Earlier kernel key ids (rotated keys) accepted on kernel-principal rows at verify; the signer's own key is added. */
  kernelKeyIds?: readonly string[];
  /**
   * Aegis S2 H-2 (#kernel-custody): a sealed LEGACY kernel key is kernel-authored only up to the seal: rows of log
   * `logId` with seq <= `maxSeq`. Past it, or in another log, its rows are not kernel-authored (verify flags
   * kernel-key; isKernelKey is false). Keys not listed are unbounded.
   */
  kernelKeyBounds?: Readonly<Record<string, { maxSeq: number; logId: string }>>;
  /** Aegis S2 H-2: the custody label per kernel key id (rowCustody); history before the seal is `legacy` (partial). */
  kernelKeyLabels?: Readonly<Record<string, 'certified' | 'legacy' | 'partial'>>;
  clock?: () => number;
  /** PASSIVE WAL checkpoint after this many ms without an append (default 250). */
  checkpointIdleMs?: number;
  /** Hard WAL bound: inline PASSIVE checkpoint every N appends (default 20 000). */
  checkpointEvery?: number;
  onDiagnostic?: (d: { what: string; detail: Record<string, unknown> }) => void;
}

export interface AppendInput {
  kind: string;
  principal: string;
  payload?: unknown;
  session?: string;
  connId?: string;
  deviceId?: string;
  idem?: string;
  scope?: EventScopeV1;
  causes?: string[];
  ref?: string;
  refHash?: string;
  /** Tighten only (L6). Omitted = the §9.1 default for the kind. */
  audience?: Audience;
  sensitivity?: Sensitivity;
  /** Which side appends (L7). Default 'kernel'. */
  as?: KindOwner;
  /** Override the signer for this row (e.g. a hardware key later); `null` = unsigned (diagnostics only). */
  signer?: Signer | null;
}

export type AnchorState = 'ok' | 'lagging-repaired' | 'created' | 'unavailable' | 'ahead';

/** S34-03: how a critical row was anchored — `file-only` while the keystore anchor is the unavailable stub (until M1.3). */
export type Anchoring = 'both' | 'file-only';

/** Default per-write keystore anchor timeout (S34-11). */
export const KEYSTORE_WRITE_TIMEOUT_MS = 5_000;

/** S33-10: why an anchor is ahead of the db. Classifies, never downgrades: both are INTEGRITY_BROKEN{truncated}. */
export type TruncationCause = 'tamper' | 'unclean-reboot';

/** An anchor ahead of the db (S33-10), as found on open. */
export interface TruncationReport {
  cause: TruncationCause;
  /** Which anchor was ahead (the keystore anchor wins when both are). */
  anchor: 'file' | 'keystore';
  /** First and last lost seq; `lostHash` is the anchor's hash for row `lostTo`. */
  lostFrom: number;
  lostTo: number;
  lostHash: string;
  /** The authoritative (keystore) anchor's boot session, `unknown` if none/unreadable. */
  bootPrev: string;
  bootNow: string;
  /** The authoritative anchor was written by a clean close. */
  cleanClose: boolean;
  /** Which anchors are ahead of the db (S34-04 / report nit). */
  ahead: { file: boolean; keystore: boolean };
  /**
   * S34-24: rows the FILE anchor lags the db by while the keystore anchor is
   * ahead (0 when the file anchor is ahead or exact). Not bounded by the > 63
   * file-anchor bound here: the keystore anchor classifies the truncation.
   */
  fileLag: number;
  /**
   * S34-04: only the FILE anchor leads while a keystore anchor is present and
   * not ahead — the lead is unauthenticated (a same-user process can write the
   * file anchor), so acknowledgeGap refuses FORBIDDEN{unauthenticated-lead}.
   */
  unauthenticatedLead: boolean;
}

/** Live integrity state (S34-14): `report.integrity` is the open-time snapshot, `log.integrity` is now. */
export type LogIntegrity =
  | { state: 'ok' }
  | ({ state: 'truncated' } & TruncationReport)
  | { state: 'anchor-faulted'; failed: FaultEntry[] };

/** A critical row whose anchoring failed after COMMIT; `markerSeq` = its committed daemon.anchor.failed row. */
export interface FaultEntry {
  seq: number;
  kind: string;
  recorded: boolean;
  markerSeq?: number;
}

/** What `close()` resolves to (S34-12): a failed clean-close keystore write is surfaced, never swallowed. */
export interface CloseReport {
  keystore: 'ok' | 'failed' | 'skipped-truncated';
  error?: string;
  /** S34-17: anchor-fault outcome — `recovered` = markers recorded and anchored by the closing anchors. */
  fault: 'none' | 'recovered' | 'pending';
}

export interface OpenReport {
  logId: string;
  created: boolean;
  recoveredRotation: boolean;
  /** Rows the file anchor lagged the db by at open (crash between commit and anchor write; ≤ 63, or > 63 relaxed across a boot change with a daemon.anchor.lag{which: 'file'} row (P8-D85), or refused). */
  anchorLag: number;
  /** Rows the keystore anchor lagged by at open (> 1023 ⇒ a daemon.anchor.lag row was appended). */
  keystoreLag: number;
  anchors: { file: AnchorState; keystore: AnchorState };
  /** The boot session this open recorded into every anchor (S33-10). */
  boot: string;
  /** `ok`, or (only via `openForRecovery`) the truncation the log refuses appends for. */
  integrity: { state: 'ok' } | ({ state: 'truncated' } & TruncationReport);
}

/**
 * What `append` resolves to. `anchored` (S34-03): `false` for bulk rows; for
 * critical kinds (S33-06) `'both'` = file + keystore anchors written before
 * resolving, `'file-only'` = the keystore anchor is the unavailable stub.
 */
export interface AppendResult {
  seq: number;
  hash: string;
  anchored: false | Anchoring;
  event: EventV1;
}

/** `status.log` anchor telemetry (S33-06). */
export interface AnchorStatus {
  /** Forced (critical) anchors per row over the last ≤ 10⁴ rows. */
  forcedAnchorRate: number;
  /** false ⇒ forcedAnchorRate > 1/64: bulk p99 is outside the measured envelope; re-probe. */
  withinEnvelope: boolean;
  /** Rows committed since the last file anchor write / the last CONFIRMED (resolved) keystore anchor write (S34-15). */
  fileLag: number;
  keystoreLag: number;
  /** S34-03: `file-only` while the keystore anchor is unavailable (stub). */
  anchoring: Anchoring;
  /** S34-02: true while critical appends must re-anchor first (see `integrity`). */
  faulted: boolean;
  fileAnchors: number;
  keystoreAnchors: number;
  forcedAnchors: number;
  checkpoints: number;
}

export interface SegmentInfo {
  segment: number;
  file: string;
  baseSeq: number;
  basePrev: string;
  /** baseSeq - 1 when empty. */
  lastSeq: number;
  lastHash: string;
  lastKind: string | null;
  sealed: boolean;
}

export type VerifyFailureCode =
  | 'seq-gap'
  | 'envelope'
  | 'hash'
  | 'prev'
  | 'log'
  | 'column-mismatch'
  | 'sig'
  | 'unknown-key'
  | 'unsigned'
  | 'unregistered-kind'
  | 'label-relaxed'
  | 'meta'
  | 'segment-link'
  | 'segment-unsealed'
  | 'anchor'
  | 'kernel-key'
  | 'reserved-binding';

export interface VerifyFailure {
  code: VerifyFailureCode;
  segment: number;
  seq?: number;
  detail: string;
}

export interface VerifyReport {
  ok: boolean;
  rows: number;
  segments: Array<{ segment: number; firstSeq: number; lastSeq: number; rows: number; ok: boolean }>;
  failures: VerifyFailure[];
  /**
   * S34-18: were kernel rows (reserved kinds, kernel principal) bound to the
   * kernel identity? `not-checked` when verify ran without it (standalone
   * verifyLog without kernelPrincipal/kernelKeyIds) — `ok` alone then says
   * nothing about who wrote the log's own rows.
   */
  kernelBinding: 'ok' | 'failed' | 'not-checked';
  anchors: { file: 'ok' | 'lagging' | 'mismatch' | 'missing' | 'not-checked'; keystore: 'ok' | 'lagging' | 'unavailable' | 'mismatch' | 'not-checked' };
}

const SCHEMA_SQL = `
CREATE TABLE chain (seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, at TEXT NOT NULL, principal TEXT NOT NULL,
                    audience TEXT NOT NULL, sensitivity TEXT NOT NULL, envelope TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL, sig TEXT);
CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TRIGGER chain_no_update BEFORE UPDATE ON chain BEGIN SELECT RAISE(ABORT, 'kernel log is append-only'); END;
CREATE TRIGGER chain_no_delete BEFORE DELETE ON chain BEGIN SELECT RAISE(ABORT, 'kernel log is append-only'); END;
CREATE TRIGGER meta_no_update BEFORE UPDATE ON meta BEGIN SELECT RAISE(ABORT, 'kernel log is append-only'); END;
CREATE TRIGGER meta_no_delete BEFORE DELETE ON meta BEGIN SELECT RAISE(ABORT, 'kernel log is append-only'); END;
`;

interface Meta {
  log: string;
  segment: number;
  baseSeq: number;
  basePrev: string;
}

interface Tip {
  seq: number;
  hash: string;
  kind: string | null;
  at: string;
}

const segName = (n: number): string => `${String(n).padStart(6, '0')}.db`;

function readMeta(db: DatabaseSync): Meta {
  const rows = db.prepare('SELECT k, v FROM meta').all() as Array<{ k: string; v: string }>;
  const m = Object.fromEntries(rows.map((r) => [r.k, r.v]));
  if (m.schema !== SEGMENT_SCHEMA || !m.log || !m.segment || !m.base_seq || !m.base_prev) {
    throw logRefusal('INTEGRITY_BROKEN', 'segment-broken', 'segment meta missing or malformed');
  }
  return { log: m.log, segment: Number(m.segment), baseSeq: Number(m.base_seq), basePrev: m.base_prev };
}

function readTip(db: DatabaseSync, meta: Meta): Tip {
  const row = db.prepare('SELECT seq, hash, kind, at FROM chain ORDER BY seq DESC LIMIT 1').get() as
    | { seq: number; hash: string; kind: string; at: string }
    | undefined;
  return row ? { seq: row.seq, hash: row.hash, kind: row.kind, at: row.at } : { seq: meta.baseSeq - 1, hash: meta.basePrev, kind: null, at: '' };
}

function rowToEvent(r: { envelope: string; hash: string; sig: string | null }): EventV1 {
  const e = JSON.parse(r.envelope) as EventV1;
  e.hash = r.hash;
  if (r.sig !== null) e.sig = r.sig;
  return e;
}

function stripUndefined<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

/** List sealed segment files, ascending. */
export function listSealedSegments(home: string): Array<{ segment: number; file: string }> {
  const dir = path.join(home, SEGMENTS_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{6}\.db$/.test(f))
    .map((f) => ({ segment: Number(f.slice(0, 6)), file: path.join(dir, f) }))
    .sort((a, b) => a.segment - b.segment);
}

function segmentInfo(file: string, sealed: boolean): SegmentInfo {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const meta = readMeta(db);
    const tip = readTip(db, meta);
    return { segment: meta.segment, file, baseSeq: meta.baseSeq, basePrev: meta.basePrev, lastSeq: tip.seq, lastHash: tip.hash, lastKind: tip.kind, sealed };
  } finally {
    db.close();
  }
}

export class KernelLog {
  readonly home: string;
  readonly logId: string;
  readonly report: OpenReport;
  readonly #opts: Required<Pick<KernelLogOptions, 'segmentRows' | 'durability' | 'clock'>> & KernelLogOptions;
  readonly #fileAnchor: FileAnchorStore;
  readonly #keystoreAnchor: AnchorStore;
  readonly #keyRing: KeyRing;
  readonly #mono: () => string;
  readonly #boot: string;
  readonly #recovery: boolean;
  /** S33-10: set while an anchor is ahead of the db (recovery mode); appends refuse until acknowledgeGap. */
  #broken: TruncationReport | undefined;
  /** acknowledgeGap: the gap row once appended, until both anchors succeed (S34-12). */
  #gapRow: EventV1 | undefined;
  /** S34-01: the open re-stamp of the keystore anchor; the first append waits for it. */
  #ready: Promise<void> = Promise.resolve();
  #readyDone = false;
  #ksAvailable = false;
  /** S34-15: seq of the last keystore write that RESOLVED (status keystoreLag is measured from it). */
  #ksConfirmedSeq = 0;
  /** S34-02: anchor fault state (critical appends re-anchor first). */
  #fault: { failed: FaultEntry[] } | undefined;
  /** S34-11 / round 3: a keystore write timed out and has not settled; new writes are refused (order preserved, no hang). */
  #ksHung = false;
  #closing: Promise<CloseReport> | undefined;
  /** T-2026-10-17-013(a): a rotation failed after the active db was closed — the instance is halted (closed); this is the refusal. */
  #halted: Error | undefined;
  #db!: DatabaseSync;
  #meta!: Meta;
  #tip!: Tip;
  #insert!: StatementSync;
  #tipStmt!: StatementSync;
  #closed = false;
  /** Read-side tail observers (M1.4 slice 2 subscriptions); called after COMMIT, never inside the transaction. */
  readonly #commitListeners = new Set<(e: EventV1) => void>();
  readonly #releaseListeners = new Set<(head: number) => void>();
  /** Critical rows committed whose anchors have not resolved (released-head bound). */
  readonly #pendingCritical = new Set<number>();
  readonly #failedSeqs = new Set<number>();
  #failedLoaded = false;
  /** Sealed segments are immutable: their SegmentInfo is cached by file path. */
  readonly #sealedInfo = new Map<string, SegmentInfo>();
  #sinceCheckpoint = 0;
  #idleTimer: ReturnType<typeof setTimeout> | undefined;
  /* anchor policy state (anchor-policy.ts) */
  #fileLag = 0;
  #fileSince = 0;
  #fileTimer: ReturnType<typeof setTimeout> | undefined;
  #ksLag = 0;
  #ksSince = 0;
  #ksTimer: ReturnType<typeof setTimeout> | undefined;
  #ksChain: Promise<void> = Promise.resolve();
  readonly #forcedRing = new Uint8Array(FORCED_ANCHOR_WINDOW);
  #ringIdx = 0;
  #ringFill = 0;
  #ringForced = 0;
  readonly #counts = { fileAnchors: 0, keystoreAnchors: 0, forcedAnchors: 0, checkpoints: 0 };

  private constructor(key: typeof CONSTRUCT_KEY, opts: KernelLogOptions, seams: KernelLogSeamOptions = {}, recovery = false) {
    if (key !== CONSTRUCT_KEY) throw new TypeError('#kernel-log: KernelLog is constructed only by KernelLog.open (or the internal test entry)');
    refuseSeamKeys(opts, 'KernelLog.open');
    this.#opts = { segmentRows: DEFAULT_SEGMENT_ROWS, durability: 'process-crash', clock: Date.now, ...opts };
    if (!Number.isSafeInteger(this.#opts.segmentRows) || this.#opts.segmentRows < 3) throw new RangeError('segmentRows must be an integer >= 3');
    this.home = opts.home;
    this.#fileAnchor = new FileAnchorStore(opts.home);
    this.#keystoreAnchor = seams.keystoreAnchor ?? new KeystoreAnchorStore();
    this.#keyRing = opts.keyRing ?? new KeyRing();
    if (opts.signer instanceof SoftwareEd25519Signer) this.#keyRing.addEd25519(opts.signer.publicKeyPem);
    this.#mono = monotonicUlidFactory({ clock: this.#opts.clock });
    this.#boot = seams.bootSession !== undefined ? normalizeBootId(seams.bootSession) : readBootSession();
    if (this.#boot === BOOT_UNKNOWN) this.#diag('boot.unknown', { platform: process.platform, injected: seams.bootSession !== undefined });
    this.#recovery = recovery;
    let r: Omit<OpenReport, 'logId'>;
    try {
      r = this.#openOrCreate();
    } catch (err) {
      // A refused open must not leak the active database handle: Windows
      // keeps an open file locked (EPERM on delete/rename), and a daemon
      // retrying the open would accumulate handles on every OS.
      if (this.#db?.isOpen) {
        try { this.#db.close(); } catch { /* the refusal is the error that matters */ }
      }
      throw err;
    }
    this.logId = this.#meta.log;
    this.report = { logId: this.logId, ...r };
  }

  /**
   * Open (or, on a machine with no log, no anchor and no keys, create) the
   * kernel log. Production only: the keystore anchor is the store the kernel
   * builds itself and the boot session is read from the OS.
   */
  static open(opts: KernelLogOptions): KernelLog {
    return new KernelLog(CONSTRUCT_KEY, opts);
  }

  /**
   * T-2026-10-17-009(a) — the successor log of a quarantined home. `opts.home`
   * must hold NO log (no db, no anchor, no segment): the log is created and
   * its genesis row (seq 1) is the kernel-signed reserved
   * `daemon.log.quarantined{quarantinedLog, quarantinedHead, evidencePath,
   * authorizedBy}`, then both anchors are written durably. This is the ONLY
   * way that kind is appended (append() refuses it as reserved, and verify
   * flags it anywhere but seq 1), so it can never be appended to, or
   * downgrade, an existing log. Refused: an existing log
   * (BAD_REQUEST{not-genesis}); no kernel key (FORBIDDEN{kernel-key-required}).
   * The caller (quarantine.ts) closes the returned log.
   */
  static async createQuarantineSuccessor(opts: KernelLogOptions, payload: QuarantinedPayload): Promise<KernelLog> {
    if (!opts.signer) throw keyRequired(QUARANTINE_GENESIS_KIND, 'the quarantine successor genesis must be signed');
    const log = new KernelLog(CONSTRUCT_KEY, opts);
    if (!log.report.created || log.#tip.seq !== 0) {
      await log.close();
      throw logRefusal('BAD_REQUEST', 'not-genesis', 'a quarantine successor is created only in an empty home: daemon.log.quarantined is a genesis row', { home: opts.home });
    }
    if (!log.#readyDone) await log.#ready.catch(() => undefined);
    log.#appendRow({ kind: QUARANTINE_GENESIS_KIND, principal: opts.kernelPrincipal, payload: { ...payload, quarantinedHead: { ...payload.quarantinedHead } } });
    log.#noteForced(true);
    log.#counts.forcedAnchors++;
    await log.#writeAnchorsDurable();
    return log;
  }

  /*
   * INTERNAL SEAMS (T-2026-10-17-009(c), Aegis S34-10): the keystore-anchor
   * and boot-session overrides, the S33-10 recovery open and the gap
   * acknowledgement are registered here and reachable only through the
   * internal test entry (src/kernel/testing.ts) until presence lands (M1.3).
   *
   * Recovery open: like `open`, except that an anchor AHEAD of the db
   * (INTEGRITY_BROKEN{truncated}) does not throw — the log opens with
   * `report.integrity.state === 'truncated'`, refuses every append with the
   * same refusal, writes no anchor (the keystore anchor is the evidence), and
   * accepts only the gap acknowledgement. Every other integrity failure
   * still throws.
   */
  static {
    registerSeams('log', {
      open: (opts, seams) => new KernelLog(CONSTRUCT_KEY, opts, seams),
      openForRecovery: (opts, seams) => new KernelLog(CONSTRUCT_KEY, opts, seams, true),
      acknowledgeGap: (log, input) => log.#acknowledgeGap(input),
    });
  }

  get activePath(): string {
    return path.join(this.home, ACTIVE_DB);
  }

  get keyRing(): KeyRing {
    return this.#keyRing;
  }

  /** The `at` of the chain's last event (S-L2: the fuse's day windows), `''` on an empty chain. */
  lastEventAt(): string {
    return this.#tip.at;
  }

  /** Is this one of the kernel's signing keys (current or recorded)? */
  isKernelKey(keyId: string, seq?: number): boolean {
    if (!this.#kernelKeyIds().includes(keyId)) return false;
    // Aegis S2 H-2: a legacy key is kernel-authored only within its seal bound (fail closed without a seq)
    const b = this.#opts.kernelKeyBounds?.[keyId];
    return !b || (b.logId === this.#meta.log && seq !== undefined && seq <= b.maxSeq);
  }

  /** Aegis S2 H-2: the custody label of a row signed by `keyId` at `seq`: certified, legacy (partial), partial, or null (not kernel-authored). */
  rowCustody(keyId: string, seq: number): 'certified' | 'legacy' | 'partial' | null {
    if (!this.isKernelKey(keyId, seq)) return null;
    if (this.#opts.signer && keyId === this.#opts.signer.keyId) return this.#opts.kernelKeyLabels?.[keyId] ?? 'partial';
    return this.#opts.kernelKeyLabels?.[keyId] ?? 'partial';
  }

  /**
   * #log-anchor (TD-2026-10-29-746, S2): does THIS log's hash chain run, unbroken, from its genesis to `target`?
   * Every segment (sealed, then the active one) is read in order: the log id, the segment links, contiguous seqs, each
   * envelope hashing to its stored hash and naming the previous hash as its prev, up to `target.seq`, whose hash must be
   * `target.hash`. A matching hash there then commits to every earlier row's bytes (the chain), which is what "the log
   * extends the anchored head and verifies up to it" means. Signatures are not re-checked here (they were at append;
   * `verify()` checks them); linear in the rows up to `target.seq`, run once per start.
   */
  chainVerifiesTo(target: { logId: string; seq: number; hash: string }): { ok: true } | { ok: false; why: 'other-log' | 'behind' | 'fork' | 'broken'; detail: string } {
    if (target.logId !== this.#meta.log) return { ok: false, why: 'other-log', detail: `the anchor names ${target.logId}, this log is ${this.#meta.log}` };
    if (target.seq > this.#tip.seq) return { ok: false, why: 'behind', detail: `the log ends at seq ${this.#tip.seq}, the anchor is at ${target.seq}` };
    if (target.seq === 0) return target.hash === genesisPrev(this.#meta.log) ? { ok: true } : { ok: false, why: 'fork', detail: 'seq 0 names another genesis' };
    let expect: { seq: number; prev: string; segment: number } | undefined;
    for (const seg of this.segments()) {
      if (expect && seg.baseSeq > target.seq) break;
      const db = seg.sealed ? new DatabaseSync(seg.file, { readOnly: true }) : this.#db;
      try {
        const meta = readMeta(db);
        if (meta.log !== target.logId) return { ok: false, why: 'broken', detail: `segment ${meta.segment} belongs to another log` };
        const first = !expect;
        if (first ? meta.segment !== 1 || meta.baseSeq !== 1 || meta.basePrev !== genesisPrev(meta.log) : meta.segment !== expect!.segment || meta.baseSeq !== expect!.seq || meta.basePrev !== expect!.prev) {
          return { ok: false, why: 'broken', detail: `segment ${meta.segment} does not continue the chain` };
        }
        let seq = meta.baseSeq;
        let prev = meta.basePrev;
        const it = db.prepare('SELECT seq, envelope, hash FROM chain WHERE seq <= ? ORDER BY seq').iterate(target.seq) as Iterable<{ seq: number; envelope: string; hash: string }>;
        for (const r of it) {
          if (r.seq !== seq) return { ok: false, why: 'broken', detail: `expected seq ${seq}, found ${r.seq}` };
          if (sha256TaggedFast(r.envelope) !== r.hash) return { ok: false, why: 'broken', detail: `row ${r.seq} does not hash to its stored hash` };
          let e: { prev?: unknown };
          try {
            e = JSON.parse(r.envelope) as { prev?: unknown };
          } catch {
            return { ok: false, why: 'broken', detail: `row ${r.seq} is not JSON` };
          }
          if (e.prev !== prev) return { ok: false, why: 'broken', detail: `row ${r.seq} does not chain to the previous row` };
          if (r.seq === target.seq) return r.hash === target.hash ? { ok: true } : { ok: false, why: 'fork', detail: `seq ${r.seq} has another hash than the anchor` };
          prev = r.hash;
          seq = r.seq + 1;
        }
        expect = { seq, prev, segment: meta.segment + 1 };
      } finally {
        if (seg.sealed) db.close();
      }
    }
    return { ok: false, why: 'behind', detail: `seq ${target.seq} is not in the log` };
  }

  /**
   * Aegis S2 M-6 (#log-anchor): every row AFTER `afterSeq` up to the tip verifies under this log's key ring, a
   * kernel-principal row only under a kernel key within its seal bound (isKernelKey with the row's seq), and an
   * unsigned row only where the kind may be unsigned. Checked before the helper anchor advances past an older head.
   */
  signaturesVerifyAfter(afterSeq: number): { ok: true } | { ok: false; detail: string } {
    for (const seg of this.segments()) {
      if (seg.lastSeq <= afterSeq) continue;
      const db = seg.sealed ? new DatabaseSync(seg.file, { readOnly: true }) : this.#db;
      try {
        const it = db.prepare('SELECT seq, kind, principal, envelope, hash, sig FROM chain WHERE seq > ? ORDER BY seq').iterate(afterSeq) as Iterable<{ seq: number; kind: string; principal: string; envelope: string; hash: string; sig: string | null }>;
        for (const r of it) {
          if (r.sig === null) {
            if (!mayBeUnsigned(r.kind)) return { ok: false, detail: `row ${r.seq} (${r.kind}) is unsigned` };
            continue;
          }
          let keyId = '';
          try {
            const e = JSON.parse(r.envelope) as { keyId?: unknown };
            keyId = typeof e.keyId === 'string' ? e.keyId : '';
          } catch {
            return { ok: false, detail: `row ${r.seq} is not JSON` };
          }
          if (this.#keyRing.verify(keyId, 'event', r.hash, Buffer.from(r.sig, 'base64')) !== 'ok') return { ok: false, detail: `row ${r.seq} does not verify under a known key` };
          if (r.principal === this.#opts.kernelPrincipal && !this.isKernelKey(keyId, r.seq)) return { ok: false, detail: `kernel row ${r.seq} is not signed by a kernel key within its seal` };
        }
      } finally {
        if (seg.sealed) db.close();
      }
    }
    return { ok: true };
  }

  /** `{log, segment, seq, hash}` of the chain head. */
  head(): { log: string; segment: number; seq: number; hash: string } {
    return { log: this.logId, segment: this.#meta.segment, seq: this.#tip.seq, hash: this.#tip.hash };
  }

  /* ── open / create / recover ────────────────────────────────────────────── */

  #diag(what: string, detail: Record<string, unknown>): void {
    this.#opts.onDiagnostic?.({ what, detail });
  }

  #openOrCreate(): Omit<OpenReport, 'logId'> {
    fs.mkdirSync(path.join(this.home, SEGMENTS_DIR), { recursive: true, mode: 0o700 });
    fs.rmSync(`${this.activePath}.new`, { force: true }); // an interrupted creation never became the log
    const sealed = listSealedSegments(this.home);
    let anchorRead = this.#fileAnchor.read();
    // S34-31: the keystore anchor is read BEFORE the create branch, so a
    // surviving keystore anchor in a home with no db refuses before any file
    // (a kernel.db with a new log id) is written.
    let ks = this.#keystoreAnchor.read();
    this.#ksAvailable = ks.state !== 'unavailable';
    let created = false;
    let recoveredRotation = false;

    if (!fs.existsSync(this.activePath)) {
      const last = sealed.length ? segmentInfo(sealed[sealed.length - 1]!.file, true) : undefined;
      const closing = last && last.lastKind === 'daemon.segment' ? last : undefined;
      if (closing && (this.#anchorAgrees(anchorRead, closing.lastSeq, closing.lastHash) || this.#relaxedRotationWindow(anchorRead, ks, closing))) {
        this.#createSegment({ log: this.#metaOf(closing.file).log, segment: closing.segment + 1, baseSeq: closing.lastSeq + 1, basePrev: closing.lastHash });
        recoveredRotation = true;
        this.#diag('rotation.recovered', { segment: closing.segment + 1 });
      } else if (anchorRead.state !== 'absent' || sealed.length > 0 || this.#opts.keysPresent || ks.state === 'present' || ks.state === 'malformed') {
        throw logRefusal('INTEGRITY_BROKEN', 'missing-db', 'kernel.db is missing but the log existed (anchor, keystore anchor, sealed segment or keys present)', {
          anchor: anchorRead.state,
          keystoreAnchor: ks.state,
          sealedSegments: sealed.length,
          keysPresent: Boolean(this.#opts.keysPresent),
        });
      } else {
        const ulid = this.#mono();
        const log = mintId('log', ulid);
        this.#createSegment({ log, segment: 1, baseSeq: 1, basePrev: genesisPrev(log) });
        created = true;
      }
    }

    this.#attach();
    const anchors = { file: 'ok' as AnchorState, keystore: 'unavailable' as AnchorState };
    let anchorLag = 0;
    let keystoreLag = 0;
    let fileLagRelaxed: { bootPrev: string; bootNow: string } | undefined;
    const boot = this.#boot;
    if (!created && ks.state === 'present') {
      // Round 3 (reviewer A): an interrupted acknowledgeGap — re-anchor, never re-classify.
      const acked = this.#interruptedAck(ks.head);
      if (acked) {
        this.#diag('log.gap.reanchored', { seq: acked.seq, lostTo: ks.head.seq });
        if (anchorRead.state === 'present' && anchorRead.head.seq === ks.head.seq && anchorRead.head.hash === ks.head.hash) anchorRead = { state: 'present', head: acked };
        ks = { state: 'present', head: acked };
      }
    }
    if (!created) {
      // S33-10: an anchor ahead of the db is checked first, so the authoritative (keystore) anchor classifies it.
      const t = this.#truncation(anchorRead, ks);
      if (t) {
        if (!this.#recovery) throw truncatedRefusal(t, this.#tip.seq);
        this.#broken = t;
        this.#readyDone = true; // no re-stamp: the ahead anchor is the evidence
        this.#diag('log.truncated', { ...t });
        const recoveryAnchors = {
          file: (t.ahead.file ? 'ahead' : 'ok') as AnchorState,
          keystore: (ks.state === 'unavailable' ? 'unavailable' : t.ahead.keystore ? 'ahead' : 'ok') as AnchorState,
        };
        return { created, recoveredRotation, anchorLag, keystoreLag, anchors: recoveryAnchors, boot, integrity: { state: 'truncated', ...t } };
      }
    }
    // S34-30: EVERY open-time integrity check runs BEFORE the first anchor
    // write, rotation completion or row append, so a refusal leaves both
    // anchors (the evidence) exactly as found — no write is queued that could
    // land after the throw. Checks, in refusal-precedence order: the file
    // anchor against the db as found (and its lag bounds / P8-D85 relax), the
    // keystore anchor (hash at its seq, not ahead, clean-close lag), then the
    // keyless refusals for the open-time rows (markers, keystore-lag row).
    if (!created) {
      anchorLag = this.#checkAnchor(anchorRead, 'file');
      fileLagRelaxed = this.#checkFileLag(anchorRead, anchorLag, ks);
    }
    const ksChecked = ks.state !== 'unavailable' && !(ks.state === 'absent' && created);
    if (ksChecked) {
      keystoreLag = this.#checkAnchor(ks, 'keystore'); // ahead ⇒ truncated
      this.#checkKeystoreCloseLag(ks, keystoreLag);
    }
    // S34-17: critical rows above the keystore anchor whose anchoring never completed (scan only; marked below).
    const unmarked = ks.state === 'present' && keystoreLag > 0 ? this.#unanchoredCriticals(ks.head.seq) : [];
    if (unmarked.length && !this.#opts.signer) {
      throw keyRequired('daemon.anchor.failed', `${unmarked.length} critical row(s) above the keystore anchor need a daemon.anchor.failed marker`);
    }
    if (keystoreLag > KEYSTORE_ANCHOR_MAX_LAG && !this.#opts.signer) {
      throw keyRequired('daemon.anchor.lag', `the keystore anchor lags by ${keystoreLag} rows (> ${KEYSTORE_ANCHOR_MAX_LAG})`);
    }

    /* ── every check passed: writes from here on ── */
    if (created) {
      this.#fileAnchor.write(this.#headAnchor(), true);
      anchors.file = 'created';
    } else {
      if (anchorLag > 0) {
        anchors.file = 'lagging-repaired';
        this.#diag('anchor.lag.repaired', { lag: anchorLag });
      }
      // durable rewrite on every open: repairs a lag AND clears the clean-close
      // marker, so a crash later in this run is never read as a post-close lag.
      // T-2026-10-17-015(2): it runs BEFORE a crashed rotation is completed
      // (every check has passed), so a crash between the seal rename and the
      // new kernel.db leaves the file anchor AT the closing row — a rotation
      // window the next open completes, never missing-db.
      // P8-D85: NOT when the lag is relaxed — the lagging file anchor is the
      // evidence until the signed daemon.anchor.lag{which: 'file'} row is
      // committed (a crash before it must reopen into the same relaxation,
      // never into a clean open with no row; a crash inside the rotation
      // below reopens through the S34-25 window). The write after the row covers it.
      if (!fileLagRelaxed) this.#fileAnchor.write(this.#headAnchor(), true);
    }
    if (this.#tip.kind === 'daemon.segment') {
      // crashed after the closing row, before the rename: finish the rotation
      // WITHOUT anchor writes (S34-30; P8-D85) — the file write above (or,
      // when relaxed, the one after the row) and the re-stamp at the end
      // anchor the head.
      this.#finishRotation(false);
      recoveredRotation = true;
    }
    if (ks.state === 'unavailable') anchors.keystore = 'unavailable';
    else if (ks.state === 'absent' && created) anchors.keystore = 'created';
    else {
      anchors.keystore = keystoreLag > 0 ? 'lagging-repaired' : 'ok';
      const marked = this.#markUnanchoredCriticals(unmarked);
      if (keystoreLag > KEYSTORE_ANCHOR_MAX_LAG) {
        // S33-07: beyond the keystore cadence — record it (shown in status); kernel-signed (sig-mandatory, S34-06; keyless refused above).
        this.#appendRow({ kind: 'daemon.anchor.lag', principal: this.#opts.kernelPrincipal, payload: { rows: keystoreLag, which: 'keystore' } });
        this.#diag('anchor.keystore.lag', { rows: keystoreLag });
      }
      // P8-D85: deferred to after the file-lag row when the lag is relaxed (evidence first).
      if (!fileLagRelaxed && (marked > 0 || keystoreLag > KEYSTORE_ANCHOR_MAX_LAG)) this.#fileAnchor.write(this.#headAnchor(), true);
    }
    if (fileLagRelaxed) {
      // P8-D85: a file-anchor lag > 63 across a boot change (a rolled-back rename after a power cut) — record it; kernel-signed.
      this.#appendRow({ kind: 'daemon.anchor.lag', principal: this.#opts.kernelPrincipal, payload: { rows: anchorLag, which: 'file', ...fileLagRelaxed } });
      this.#diag('anchor.file.lag.cross-boot', { rows: anchorLag, ...fileLagRelaxed });
      this.#fileAnchor.write(this.#headAnchor(), true);
    }
    this.#ksConfirmedSeq = ks.state === 'present' ? Math.min(ks.head.seq, this.#tip.seq) : this.#tip.seq;
    // S34-01: re-stamp the keystore anchor with THIS boot on every open (also
    // repairs a lag and clears a clean-close marker). The first append waits
    // for it; if it fails, the log is anchor-faulted (critical appends refuse
    // until the head is re-anchored).
    this.#ready = this.#queueKeystore(true);
    this.#ready.then(
      () => {
        this.#readyDone = true;
      },
      (err: unknown) => {
        this.#readyDone = true;
        this.#fault ??= { failed: [] };
        this.#diag('anchor.restamp.failed', { error: (err as Error)?.message ?? String(err) });
      },
    );
    return { created, recoveredRotation, anchorLag, keystoreLag, anchors, boot, integrity: { state: 'ok' } };
  }

  /** Any lag behind a clean-close FILE anchor ⇒ anchor-lag (never relaxed). Inside #truncation it runs after the keystore check; on the main open path it runs before the keystore checks. */
  #checkFileCloseLag(a: AnchorReadResult, lag: number): void {
    if (lag > 0 && a.state === 'present' && a.head.closed) {
      throw logRefusal('INTEGRITY_BROKEN', 'anchor-lag', `the file anchor lags the log by ${lag} rows after a clean close`, { anchor: 'file', lag, cleanClose: true });
    }
  }

  /**
   * File-anchor lag bounds (S33-07) on the main open path (after the
   * truncation check): any lag behind a clean-close FILE anchor, or > 63 rows.
   * P8-D85: a lag > 63 is relaxed across a boot change — returns the boot
   * pair to record in a daemon.anchor.lag{which: 'file'} row.
   */
  #checkFileLag(a: AnchorReadResult, lag: number, ks: AnchorReadResult): { bootPrev: string; bootNow: string } | undefined {
    this.#checkFileCloseLag(a, lag);
    if (lag <= FILE_ANCHOR_MAX_LAG) return undefined;
    const relax = this.#crossBootRelax(ks);
    if (typeof relax !== 'string') {
      if (!this.#opts.signer) throw keyRequired('daemon.anchor.lag', `the file anchor lags by ${lag} rows (> ${FILE_ANCHOR_MAX_LAG}) across a boot change`);
      return relax;
    }
    throw logRefusal('INTEGRITY_BROKEN', 'anchor-lag', `the file anchor lags the log by ${lag} rows (bound ${FILE_ANCHOR_MAX_LAG}; not relaxed: ${relax})`, {
      anchor: 'file',
      lag,
      bound: FILE_ANCHOR_MAX_LAG,
      relax,
    });
  }

  /**
   * P8-D85: may a file-anchor lag > 63 be relaxed? Only the KEYSTORE anchor
   * is consulted (the file anchor's own `boot` never is): it must be present,
   * not a clean close, pass the full anchor check (a mismatch / other log
   * throws its own refusal; ahead cannot reach here — the truncation check
   * ran first, S34-24), and record a known boot that differs from this known boot.
   * Returns the boot pair, or the reason the bound stays strict.
   */
  #crossBootRelax(ks: AnchorReadResult): { bootPrev: string; bootNow: string } | string {
    if (ks.state === 'unavailable') return 'keystore-unavailable';
    if (ks.state !== 'present') return `keystore-${ks.state}`;
    if (ks.head.closed) return 'keystore-closed';
    if (ks.head.seq > this.#tip.seq) return 'keystore-ahead'; // defensive, unreachable: an ahead keystore anchor is classified by #truncation first
    this.#checkAnchor(ks, 'keystore');
    const bootPrev = normalizeBootId(ks.head.boot ?? '');
    const bootNow = this.#boot;
    if (bootPrev === BOOT_UNKNOWN || bootNow === BOOT_UNKNOWN) return 'boot-unknown';
    if (bootPrev === bootNow) return 'same-boot';
    return { bootPrev, bootNow };
  }

  /** S34-05: any lag behind a clean-close KEYSTORE anchor (the authoritative clean-close marker) ⇒ anchor-lag. */
  #checkKeystoreCloseLag(a: AnchorReadResult, lag: number): void {
    if (lag > 0 && a.state === 'present' && a.head.closed) {
      throw logRefusal('INTEGRITY_BROKEN', 'anchor-lag', `the keystore anchor lags the log by ${lag} rows after a clean close`, { anchor: 'keystore', lag, cleanClose: true });
    }
  }

  /**
   * Round 3 (reviewer A): is the tip a kernel-signed `daemon.log.gap` whose
   * payload names exactly the keystore anchor's head as the lost head
   * (lostTo/lostHash)? Then acknowledgeGap committed the row but its anchor
   * writes were interrupted: return the head to re-anchor at (the gap row).
   */
  #interruptedAck(k: HeadAnchor): HeadAnchor | undefined {
    if (this.#tip.kind !== 'daemon.log.gap' || k.log !== this.#meta.log) return undefined;
    const r = this.#db.prepare('SELECT envelope, hash, sig, principal FROM chain WHERE seq = ?').get(this.#tip.seq) as
      | { envelope: string; hash: string; sig: string | null; principal: string }
      | undefined;
    if (!r?.sig || r.principal !== this.#opts.kernelPrincipal) return undefined;
    const e = JSON.parse(r.envelope) as { keyId?: string; payload?: { lostTo?: unknown; lostHash?: unknown } };
    if (!e.keyId || !this.#kernelKeyIds().includes(e.keyId)) return undefined;
    if (this.#keyRing.verify(e.keyId, 'event', r.hash, Buffer.from(r.sig, 'base64')) !== 'ok') return undefined;
    if (e.payload?.lostTo !== k.seq || e.payload?.lostHash !== k.hash) return undefined;
    const { closed: _c, ...rest } = k;
    // Re-stamped with the CURRENT boot: a following file-anchor lag > 63 then reads same-boot and refuses (P8-D85, fail-closed).
    return { ...rest, segment: this.#meta.segment, seq: this.#tip.seq, hash: this.#tip.hash, at: this.#tip.at, boot: this.#boot };
  }

  /** Kernel key ids for verify / binding checks: the configured rotated keys plus the signer's own. */
  #kernelKeyIds(): string[] {
    return [...(this.#opts.kernelKeyIds ?? []), ...(this.#opts.signer ? [this.#opts.signer.keyId] : [])];
  }

  /**
   * S34-17 (open): every CRITICAL row above `ksSeq` (the keystore anchor) that
   * has no `daemon.anchor.failed` marker never had its keystore write complete
   * (crash between COMMIT and the write): its append never resolved, so its
   * effect was never released. Returns those rows (a pure scan — S34-30: it
   * runs with the open-time checks, before any write; #markUnanchoredCriticals
   * records one kernel-signed marker per row afterwards).
   */
  #unanchoredCriticals(ksSeq: number): Array<{ seq: number; kind: string }> {
    const criticals: Array<{ seq: number; kind: string }> = [];
    const marked = new Set<number>();
    for (const seg of this.segments()) {
      if (seg.lastSeq <= ksSeq) continue;
      const db = seg.sealed ? new DatabaseSync(seg.file, { readOnly: true }) : this.#db;
      try {
        const it = db.prepare('SELECT seq, kind, envelope FROM chain WHERE seq > ? ORDER BY seq').iterate(ksSeq) as Iterable<{ seq: number; kind: string; envelope: string }>;
        for (const r of it) {
          if (r.kind === 'daemon.anchor.failed') {
            const p = (JSON.parse(r.envelope) as { payload?: { seq?: unknown } }).payload;
            if (Number.isSafeInteger(p?.seq)) marked.add(p!.seq as number);
          } else if (isCriticalKind(r.kind, r.kind === 'session.inject' ? (JSON.parse(r.envelope) as { payload?: unknown }).payload : undefined)) {
            criticals.push({ seq: r.seq, kind: r.kind });
          }
        }
      } finally {
        if (seg.sealed) db.close();
      }
    }
    return criticals.filter((c) => !marked.has(c.seq));
  }

  /** S34-17 (open, after every check passed): append one kernel-signed marker per row from #unanchoredCriticals. Returns the count. */
  #markUnanchoredCriticals(missing: Array<{ seq: number; kind: string }>): number {
    if (!missing.length) return 0;
    if (!this.#opts.signer) throw keyRequired('daemon.anchor.failed', `${missing.length} critical row(s) above the keystore anchor need a daemon.anchor.failed marker`);
    for (const c of missing) {
      this.#appendRow({ kind: 'daemon.anchor.failed', principal: this.#opts.kernelPrincipal, payload: { seq: c.seq, kind: c.kind } });
      this.#noteForced(false);
    }
    this.#diag('anchor.failed.marked-on-open', { seqs: missing.map((c) => c.seq) });
    return missing.length;
  }

  /**
   * S33-10: is an anchor ahead of the db? Returns the classified truncation or
   * undefined. The cause is read ONLY from the keystore anchor: its `boot`
   * and `closed`. A file anchor's `boot`/`closed` are never consulted (a
   * same-user process can rewrite them). Without a comparable keystore boot
   * (stub keystore, pre-D83 anchor, `unknown` boot) the cause falls closed to
   * `tamper`.
   *
   * S34-04: every anchor that is NOT ahead gets the full #checkAnchor (and the
   * lag bounds) first, so anchor-missing / anchor-mismatch (malformed, other
   * log, forked hash) / anchor-lag still throw — in recovery mode too.
   */
  #truncation(file: AnchorReadResult, ks: AnchorReadResult): TruncationReport | undefined {
    const ahead = (a: AnchorReadResult): HeadAnchor | undefined =>
      a.state === 'present' && a.head.log === this.#meta.log && a.head.seq > this.#tip.seq ? a.head : undefined;
    const ksAhead = ahead(ks);
    const fileAhead = ahead(file);
    if (!ksAhead && !fileAhead) return undefined;
    if (!ksAhead) this.#checkKeystoreCloseLag(ks, this.#checkAnchor(ks, 'keystore'));
    // S34-24: here !fileAhead ⇒ the KEYSTORE anchor is ahead and classifies
    // this as truncated. The file anchor still gets the full hash check and
    // the clean-close check; only the > 63 bound is skipped (a rolled-back
    // file rename is part of the same power cut) — its lag is reported as
    // `fileLag` and recorded in daemon.log.gap.
    let fileLag = 0;
    if (!fileAhead) {
      fileLag = this.#checkAnchor(file, 'file');
      this.#checkFileCloseLag(file, fileLag);
    }
    const lost = (ksAhead ?? fileAhead)!;
    const auth = ks.state === 'present' && ks.head.log === this.#meta.log ? ks.head : undefined;
    const bootPrev = normalizeBootId(auth?.boot ?? '');
    const bootNow = this.#boot;
    const cleanClose = auth?.closed === true;
    const rebooted = bootPrev !== BOOT_UNKNOWN && bootNow !== BOOT_UNKNOWN && bootPrev !== bootNow;
    return {
      cause: rebooted && !cleanClose ? 'unclean-reboot' : 'tamper',
      anchor: ksAhead ? 'keystore' : 'file',
      lostFrom: this.#tip.seq + 1,
      lostTo: lost.seq,
      lostHash: lost.hash,
      bootPrev,
      bootNow,
      cleanClose,
      ahead: { file: Boolean(fileAhead), keystore: Boolean(ksAhead) },
      fileLag,
      unauthenticatedLead: !ksAhead && ks.state === 'present',
    };
  }

  #metaOf(file: string): Meta {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      return readMeta(db);
    } finally {
      db.close();
    }
  }

  #anchorAgrees(a: AnchorReadResult, seq: number, hash: string): boolean {
    return a.state === 'present' && a.head.seq === seq && a.head.hash === hash;
  }

  /**
   * S34-25 (T-2026-10-17-012): no kernel.db, the last sealed segment ends with
   * its daemon.segment closing row, and the file anchor LAGS that row by more
   * than 63 — the residue of a relaxed (P8-D85) open whose rotation
   * completion crashed between the seal rename and the new kernel.db. A pure
   * check run before any write: the relaxation #crossBootRelax grants,
   * evaluated against the sealed rows (no db is attached yet). True ⇒ the
   * caller creates the next segment and the main path re-runs every check,
   * appends the relaxed row in the new segment and only then rewrites the
   * file anchor. False ⇒ the caller refuses missing-db. A keyless log that
   * would qualify refuses FORBIDDEN{kernel-key-required} here, before the
   * segment is created.
   */
  #relaxedRotationWindow(a: AnchorReadResult, ks: AnchorReadResult, closing: SegmentInfo): boolean {
    if (a.state !== 'present' || ks.state !== 'present') return false;
    const log = this.#metaOf(closing.file).log;
    const f = a.head;
    const k = ks.head;
    if (f.log !== log || k.log !== log || f.closed || k.closed) return false;
    if (f.seq >= closing.lastSeq || closing.lastSeq - f.seq <= FILE_ANCHOR_MAX_LAG) return false;
    if (k.seq > closing.lastSeq) return false; // an anchor ahead of every row is not this window
    const hashAt = (seq: number): string | undefined => (seq === closing.lastSeq ? closing.lastHash : this.#sealedHashAt(seq));
    if (hashAt(f.seq) !== f.hash || hashAt(k.seq) !== k.hash) return false;
    const bootPrev = normalizeBootId(k.boot ?? '');
    if (bootPrev === BOOT_UNKNOWN || this.#boot === BOOT_UNKNOWN || bootPrev === this.#boot) return false;
    if (!this.#opts.signer) {
      throw keyRequired('daemon.anchor.lag', `the file anchor lags the sealed closing row by ${closing.lastSeq - f.seq} rows (> ${FILE_ANCHOR_MAX_LAG}) across a boot change`);
    }
    return true;
  }

  /** Returns the anchor lag (0 = equal); throws INTEGRITY_BROKEN on any disagreement. */
  #checkAnchor(a: AnchorReadResult, which: 'file' | 'keystore'): number {
    if (a.state === 'unavailable') return 0;
    if (a.state === 'absent') throw logRefusal('INTEGRITY_BROKEN', 'anchor-missing', `the ${which} head anchor is missing for an existing log`, { anchor: which });
    if (a.state === 'malformed') throw logRefusal('INTEGRITY_BROKEN', 'anchor-mismatch', `the ${which} head anchor is malformed (${a.why})`, { anchor: which });
    const h = a.head;
    if (h.log !== this.#meta.log) throw logRefusal('INTEGRITY_BROKEN', 'anchor-mismatch', `the ${which} anchor names another log`, { anchor: which });
    if (h.seq > this.#tip.seq) {
      throw logRefusal('INTEGRITY_BROKEN', 'truncated', `the ${which} anchor is at seq ${h.seq} but the log ends at ${this.#tip.seq}`, { anchor: which, anchorSeq: h.seq, tipSeq: this.#tip.seq });
    }
    const hashAt = this.#hashAt(h.seq);
    if (hashAt !== h.hash) throw logRefusal('INTEGRITY_BROKEN', 'anchor-mismatch', `the ${which} anchor hash differs from row ${h.seq}`, { anchor: which, seq: h.seq });
    return this.#tip.seq - h.seq;
  }

  /** Hash of row `seq` (or the genesis/base prev for seq = base-1), searching sealed segments. */
  #hashAt(seq: number): string | undefined {
    if (seq === this.#tip.seq) return this.#tip.hash;
    if (seq === this.#meta.baseSeq - 1) return this.#meta.basePrev;
    if (seq >= this.#meta.baseSeq) return (this.#db.prepare('SELECT hash FROM chain WHERE seq = ?').get(seq) as { hash: string } | undefined)?.hash;
    return this.#sealedHashAt(seq);
  }

  /** Hash of row `seq` (or a segment's base prev) in the SEALED segments only — usable before a db is attached (S34-25). */
  #sealedHashAt(seq: number): string | undefined {
    for (const s of listSealedSegments(this.home)) {
      const info = this.#sealedInfoOf(s.file);
      if (seq === info.baseSeq - 1) return info.basePrev;
      if (seq >= info.baseSeq && seq <= info.lastSeq) {
        const db = new DatabaseSync(s.file, { readOnly: true });
        try {
          return (db.prepare('SELECT hash FROM chain WHERE seq = ?').get(seq) as { hash: string } | undefined)?.hash;
        } finally {
          db.close();
        }
      }
    }
    return undefined;
  }

  /** Create a segment file atomically: build at kernel.db.new, fsync, rename. */
  #createSegment(meta: Meta): void {
    const tmp = `${this.activePath}.new`;
    fs.rmSync(tmp, { force: true });
    const db = new DatabaseSync(tmp);
    try {
      db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;');
      db.exec('BEGIN');
      db.exec(SCHEMA_SQL);
      const put = db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)');
      put.run('schema', SEGMENT_SCHEMA);
      put.run('log', meta.log);
      put.run('segment', String(meta.segment));
      put.run('base_seq', String(meta.baseSeq));
      put.run('base_prev', meta.basePrev);
      db.exec('COMMIT');
    } finally {
      db.close();
    }
    fs.chmodSync(tmp, 0o600);
    fsyncFile(tmp);
    fs.renameSync(tmp, this.activePath);
    fsyncDir(this.home);
  }

  #attach(): void {
    this.#db = new DatabaseSync(this.activePath);
    this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA wal_autocheckpoint=0;');
    if (this.#opts.durability === 'power-loss') this.#db.exec('PRAGMA fullfsync=1; PRAGMA checkpoint_fullfsync=1;');
    this.#meta = readMeta(this.#db);
    this.#tip = readTip(this.#db, this.#meta);
    this.#insert = this.#db.prepare(
      'INSERT INTO chain (seq, id, kind, at, principal, audience, sensitivity, envelope, prev_hash, hash, sig) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    this.#tipStmt = this.#db.prepare('SELECT seq, hash FROM chain ORDER BY seq DESC LIMIT 1');
  }

  #headAnchor(): HeadAnchor {
    return { schemaVersion: HEAD_SCHEMA, log: this.#meta.log, segment: this.#meta.segment, seq: this.#tip.seq, hash: this.#tip.hash, at: this.#tip.at, boot: this.#boot };
  }

  /** Rename the file anchor in now (resets the coalescing window). */
  #writeFileAnchor(durable: boolean, closed = false): void {
    const h = this.#headAnchor();
    this.#fileAnchor.write(closed ? { ...h, closed: true } : h, durable);
    this.#fileLag = 0;
    this.#counts.fileAnchors++;
    if (this.#fileTimer) clearTimeout(this.#fileTimer);
    this.#fileTimer = undefined;
  }

  /**
   * Queue a keystore anchor write of the current head. Writes are serialised
   * so an older head never lands after a newer one: the next write starts
   * only when this one has actually SETTLED, even if its caller already gave
   * up on it. The returned promise rejects if THIS write fails or does not
   * settle within `keystoreTimeoutMs` of STARTING (S34-11; critical path);
   * while a timed-out write is unsettled, new writes are refused at once
   * (no hang, no reordering). The chain
   * itself swallows the failure into a diagnostic so bulk writes never surface
   * unhandled. The confirmed keystore seq (status keystoreLag) advances only
   * when a write resolves (S34-15).
   */
  #queueKeystore(durable: boolean, closed = false): Promise<void> {
    const h = closed ? { ...this.#headAnchor(), closed: true as const } : this.#headAnchor();
    this.#ksLag = 0; // cadence counter only (rows since the last ENQUEUED write)
    if (this.#ksTimer) clearTimeout(this.#ksTimer);
    this.#ksTimer = undefined;
    if (this.#ksHung) {
      // a timed-out write is still in flight: queueing behind it would hang, racing it would break the order
      const p = Promise.reject(new Error(`keystore anchor write for seq ${h.seq} refused: a previous keystore write timed out and is still unsettled`));
      p.catch(() => undefined);
      return p;
    }
    this.#counts.keystoreAnchors++;
    const prev = this.#ksChain;
    const write = prev.then(() => this.#keystoreAnchor.write(h, durable));
    this.#ksChain = write.then(
      () => {
        this.#ksConfirmedSeq = h.seq;
        this.#ksHung = false;
      },
      (err: unknown) => {
        this.#ksHung = false;
        this.#diag('anchor.keystore.failed', { seq: h.seq, error: (err as Error)?.message ?? String(err) });
      },
    );
    const ms = this.#opts.keystoreTimeoutMs ?? KEYSTORE_WRITE_TIMEOUT_MS;
    const p = new Promise<void>((resolve, reject) => {
      void prev.then(() => {
        // the timeout runs from DEQUEUE (this write has started), not from enqueue
        const timer = setTimeout(() => {
          this.#ksHung = true;
          reject(new Error(`keystore anchor write for seq ${h.seq} did not settle within ${ms} ms`));
        }, ms);
        timer.unref();
        void write.then(resolve, reject).finally(() => clearTimeout(timer));
      });
    });
    p.catch(() => undefined); // handled here; callers that await p still see the rejection
    return p;
  }

  /** Both anchors durably (genesis, rotation, close). */
  #writeAnchorsDurable(closed = false): Promise<void> {
    this.#writeFileAnchor(true, closed);
    return this.#queueKeystore(true, closed);
  }

  /** S33-05: after a bulk row — coalesced file anchor (63 rows / 50 ms) and keystore anchor (1023 rows / 1 s). */
  #afterBulkRow(): void {
    const now = performance.now();
    if (this.#fileLag++ === 0) this.#fileSince = now;
    const windowMs = this.#opts.fileAnchorMaxMs ?? FILE_ANCHOR_MAX_MS;
    if (this.#fileLag >= FILE_ANCHOR_MAX_LAG || now - this.#fileSince >= windowMs) this.#writeFileAnchor(false);
    else if (!this.#fileTimer) {
      this.#fileTimer = setTimeout(() => {
        this.#fileTimer = undefined;
        if (!this.#closed && this.#fileLag > 0) this.#writeFileAnchor(false);
      }, windowMs);
      this.#fileTimer.unref();
    }
    if (this.#ksLag++ === 0) this.#ksSince = now;
    if (this.#ksLag >= KEYSTORE_ANCHOR_MAX_LAG || now - this.#ksSince >= KEYSTORE_ANCHOR_MAX_MS) void this.#queueKeystore(false);
    else if (!this.#ksTimer) {
      this.#ksTimer = setTimeout(() => {
        this.#ksTimer = undefined;
        if (!this.#closed && this.#ksLag > 0) void this.#queueKeystore(false);
      }, KEYSTORE_ANCHOR_MAX_MS);
      this.#ksTimer.unref();
    }
  }

  #noteForced(forced: boolean): void {
    const i = this.#ringIdx;
    if (this.#ringFill === FORCED_ANCHOR_WINDOW) this.#ringForced -= this.#forcedRing[i]!;
    else this.#ringFill++;
    this.#forcedRing[i] = forced ? 1 : 0;
    this.#ringForced += this.#forcedRing[i]!;
    this.#ringIdx = (i + 1) % FORCED_ANCHOR_WINDOW;
  }

  /** S33-06 telemetry (`status.log.forcedAnchorRate`): forced anchors per row over the last ≤ 10⁴ rows. */
  get forcedAnchorRate(): number {
    return this.#ringFill === 0 ? 0 : this.#ringForced / this.#ringFill;
  }

  /** The `status.log` anchor block (S33-06/07). */
  get anchorStatus(): AnchorStatus {
    const rate = this.forcedAnchorRate;
    return {
      forcedAnchorRate: rate,
      withinEnvelope: rate <= FORCED_ANCHOR_ENVELOPE,
      fileLag: this.#fileLag,
      keystoreLag: Math.max(0, this.#tip.seq - this.#ksConfirmedSeq),
      anchoring: this.#anchoring,
      faulted: this.#fault !== undefined,
      ...this.#counts,
    };
  }

  /* ── append ─────────────────────────────────────────────────────────────── */

  /** S34-03: `both` when a keystore anchor store is present, `file-only` while it is the unavailable stub. */
  get #anchoring(): Anchoring {
    return this.#ksAvailable ? 'both' : 'file-only';
  }

  /**
   * Append one event. The commit is durable per the durability policy before
   * the promise resolves — so a caller that must log BEFORE acting (L2,
   * `session.inject` before the child reads, G-LOG-03) sequences on it.
   *
   * Critical kinds (CRITICAL_ANCHOR_KINDS, S33-06/S33-10) resolve only after
   * the commit, the file-anchor rename and the keystore anchor write have
   * completed, in that order: `{anchored: 'both' | 'file-only'}`. The commit
   * uses the bulk durability (no F_FULLFSYNC, P8-D83): this orders the anchor
   * before any effect against a same-user process; it is not a power-loss
   * guarantee. NO EFFECT of a critical event (tool release, card result,
   * grant) may be released before this resolves. Any failure after COMMIT
   * rejects ENGINE{anchor-failed} (the row is committed but must be treated
   * as not having happened) and faults the log (S34-02, header).
   *
   * The first append after open waits for the keystore re-stamp (S34-01).
   */
  async append(input: AppendInput): Promise<AppendResult> {
    if (this.#closed) throw this.#halted ?? logRefusal('ENGINE', 'closed', 'the kernel log is closed');
    if (this.#broken) throw truncatedRefusal(this.#broken, this.#tip.seq);
    if (RESERVED_KINDS.includes(input.kind)) {
      throw logRefusal('FORBIDDEN', 'reserved-kind', `${input.kind} is written only by the log itself`, { kind: input.kind });
    }
    if (!this.#readyDone) await this.#ready.catch(() => undefined);
    if (this.#closed) throw this.#halted ?? logRefusal('ENGINE', 'closed', 'the kernel log is closed');
    if (!this.#opts.signer && this.#tip.seq + 1 - this.#meta.baseSeq + 2 >= this.#opts.segmentRows) {
      // S34-22: the row would reach the segment boundary and the daemon.segment row needs the kernel key — refuse BEFORE commit
      throw keyRequired('daemon.segment', 'a keyless log is non-rotating: this append would reach the segment boundary');
    }
    const critical = isCriticalKind(input.kind, input.payload);
    if (critical && this.#fault) {
      try {
        await this.#recoverAnchors();
      } catch (err) {
        if (this.#halted) throw this.#halted; // the re-anchor's marker reached the boundary and the rotation halted
        throw logRefusal('ENGINE', 'anchor-faulted',
 `critical appends are refused until both anchors succeed for the head: ${(err as Error)?.message ?? String(err)}`, {
          kind: input.kind,
          failed: this.#fault?.failed.map((f) => f.seq) ?? [],
        });
      }
    }
    const e = this.#appendRow(input, critical); // COMMIT has returned when this returns
    this.#noteForced(critical);
    if (!critical) {
      this.#afterBulkRow();
      this.#scheduleCheckpoint();
      // a halt here rejects ENGINE{rotation-failed} although this bulk row IS
      // committed — harmless for bulk kinds (no effect is gated on them).
      this.#maybeRotate();
      return { seq: e.seq, hash: e.hash, anchored: false, event: e };
    }
    this.#counts.forcedAnchors++;
    try {
      this.#writeFileAnchor(false); // then the file-anchor rename
      const ks = this.#queueKeystore(false); // then the keystore write (awaited below)
      this.#scheduleCheckpoint();
      await ks;
    } catch (err) {
      (this.#fault ??= { failed: [] }).failed.push({ seq: e.seq, kind: e.kind, recorded: false });
      try {
        this.#recordPendingMarkers(); // S34-17: durable now — committing needs no keystore
      } catch (mErr) {
        this.#diag('anchor.failed.marker.deferred', { seq: e.seq, error: (mErr as Error)?.message ?? String(mErr) });
      }
      this.#diag('anchor.critical.failed', { seq: e.seq, kind: e.kind, error: (err as Error)?.message ?? String(err) });
      this.#resolveCritical(e.seq, false);
      throw logRefusal('ENGINE', 'anchor-failed', `anchoring failed after commit for critical row ${e.seq}: ${(err as Error)?.message ?? String(err)}`, { kind: e.kind, seq: e.seq });
    }
    this.#resolveCritical(e.seq, true);
    // Round 2 (T-2026-10-17-013(a)): rotate only AFTER the anchor outcome has
    // settled. A rotation failure inside the anchoring try used to reject
    // anchor-failed while the marker commit failed on the closed db and the
    // queued keystore write still landed (a committed, anchored row with no
    // marker on reopen). The row here IS committed and anchored, so the result
    // stands: a halt is surfaced by the next append / close (ENGINE{rotation-failed}),
    // and a closing-row failure before its commit leaves the boundary for the next append.
    // That deferral (rotation.deferred) can leave a segment with segmentRows + 1
    // or more rows; verify does not bound segment size (only seq / prev / seal links).
    try {
      this.#maybeRotate();
    } catch (err) {
      this.#diag(this.#halted ? 'rotation.halted.after-critical' : 'rotation.deferred', { seq: e.seq, error: (err as Error)?.message ?? String(err) });
    }
    return { seq: e.seq, hash: e.hash, anchored: this.#anchoring, event: e };
  }

  #maybeRotate(): void {
    if (this.#tip.seq - this.#meta.baseSeq + 2 >= this.#opts.segmentRows) this.#rotate();
  }

  /** S34-17: commit a kernel-signed daemon.anchor.failed marker for every failed entry that has none yet. */
  #recordPendingMarkers(): void {
    const f = this.#fault;
    if (!f) return;
    const pending = f.failed.filter((x) => !x.recorded);
    if (!pending.length) return;
    if (!this.#opts.signer) throw keyRequired('daemon.anchor.failed', 'daemon.anchor.failed must be signed by the kernel key');
    for (const x of pending) {
      const m = this.#appendRow({ kind: 'daemon.anchor.failed', principal: this.#opts.kernelPrincipal, payload: { seq: x.seq, kind: x.kind } });
      this.#noteForced(false);
      x.recorded = true;
      x.markerSeq = m.seq;
    }
    this.#scheduleCheckpoint();
    this.#maybeRotate();
  }

  /** S34-19: the fault clears only when EVERY entry has a marker and both anchors cover a head at or past it. */
  #clearFaultIfAnchored(anchoredSeq: number): void {
    const f = this.#fault;
    if (f && f.failed.every((x) => x.recorded && x.markerSeq !== undefined && x.markerSeq <= anchoredSeq)) this.#fault = undefined;
  }

  /**
   * S34-02/S34-17: leave the anchor-faulted state — record any pending
   * markers, then anchor the head in both anchors. Throws (state kept) if the
   * anchors fail or a newer failure is still unanchored.
   */
  async #recoverAnchors(): Promise<void> {
    if (!this.#fault) return;
    this.#recordPendingMarkers();
    this.#writeFileAnchor(false);
    const anchoredSeq = this.#tip.seq;
    await this.#queueKeystore(false);
    this.#clearFaultIfAnchored(anchoredSeq);
    if (this.#fault) throw new Error('anchor fault persists: a failed critical row is not yet recorded and anchored');
    this.#diag('anchor.recovered', { anchoredSeq });
  }

  #appendRow(input: AppendInput, critical = false): EventV1 {
    const kind = input.kind;
    const labels = resolveLabels(kind, input); // refuses unregistered kinds and relaxed labels
    assertOwner(kind, input.as ?? 'kernel');
    const signer = input.signer === undefined ? this.#opts.signer : input.signer;
    if (!signer) {
      if (isSigMandatory(kind)) throw logRefusal('FORBIDDEN', 'unsigned-mandatory', `${kind} must be signed (§3.2)`, { kind });
      if (!mayBeUnsigned(kind)) throw logRefusal('FORBIDDEN', 'unsigned-kind', `${kind} is not a diagnostic and must be signed by its appender's key`, { kind });
    }
    checkPayload(kind, input.payload);

    const seq = this.#tip.seq + 1;
    const ms = this.#opts.clock();
    const env = stripUndefined({
      schemaVersion: EVENT_V1,
      id: mintId('ev', this.#mono()),
      log: this.#meta.log,
      seq,
      at: new Date(ms).toISOString(),
      principal: input.principal,
      keyId: signer?.keyId,
      deviceId: input.deviceId,
      connId: input.connId,
      idem: input.idem,
      session: input.session,
      scope: input.scope,
      audience: labels.audience,
      sensitivity: labels.sensitivity,
      kind,
      causes: input.causes,
      payload: input.payload,
      ref: input.ref,
      refHash: input.refHash,
      prev: this.#tip.hash,
    } as Record<string, unknown>);
    let preimage: string;
    try {
      preimage = canonicalJson(env);
    } catch (err) {
      throw logRefusal('BAD_REQUEST', 'bad-payload', `payload is not canonical-JSON serializable: ${(err as Error).message}`, { kind });
    }
    const hash = sha256TaggedFast(preimage);
    const sig = signer ? Buffer.from(signer.sign('event', hash)).toString('base64') : undefined;
    const event = { ...env, hash, ...(sig !== undefined ? { sig } : {}) } as unknown as EventV1;
    const errors = validateEventV1(event, { checkDefaultLabels: true });
    if (errors.length) throw logRefusal('BAD_REQUEST', 'bad-envelope', errors.join('; '), { kind });

    // P8-D83: every commit (bulk and critical) uses the connection's durability;
    // F_FULLFSYNC only under durability 'power-loss' (set once in #attach).
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const cur = this.#tipStmt.get() as { seq: number; hash: string } | undefined;
      const curSeq = cur?.seq ?? this.#meta.baseSeq - 1;
      const curHash = cur?.hash ?? this.#meta.basePrev;
      if (curSeq !== this.#tip.seq || curHash !== this.#tip.hash) {
        throw logRefusal('INTEGRITY_BROKEN', 'tip-moved', `chain tip moved under the writer (db ${curSeq}, memory ${this.#tip.seq})`);
      }
      this.#insert.run(seq, event.id, kind, event.at, event.principal, labels.audience, labels.sensitivity, preimage, this.#tip.hash, hash, sig ?? null);
      this.#db.exec('COMMIT');
    } catch (err) {
      if (this.#db.isTransaction) this.#db.exec('ROLLBACK');
      throw err;
    }
    this.#tip = { seq, hash, kind, at: event.at };
    if (critical) this.#pendingCritical.add(seq); // unreadable until its anchors resolve (released head)
    if (kind === 'daemon.anchor.failed' && isPlainObject(input.payload) && typeof input.payload.seq === 'number') this.#failedSeqs.add(input.payload.seq);
    this.#notifyCommit(event);
    return event;
  }

  /** Tail observers never break an append: a throwing listener is reported as a diagnostic. */
  #notifyCommit(event: EventV1): void {
    for (const l of this.#commitListeners) {
      try {
        l(event);
      } catch (err) {
        this.#diag('commit.listener.failed', { seq: event.seq, error: (err as Error)?.message ?? String(err) });
      }
    }
  }

  #scheduleCheckpoint(): void {
    if (++this.#sinceCheckpoint >= (this.#opts.checkpointEvery ?? 20_000)) {
      this.checkpoint();
      return;
    }
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = setTimeout(() => {
      this.#idleTimer = undefined;
      if (!this.#closed) this.checkpoint();
    }, this.#opts.checkpointIdleMs ?? 250);
    this.#idleTimer.unref();
  }

  /** PASSIVE WAL checkpoint (never blocks on readers); also renames in a pending file anchor (S33-05 "on idle checkpoint"). */
  checkpoint(): void {
    if (this.#closed) return;
    this.#db.exec('PRAGMA wal_checkpoint(PASSIVE)');
    this.#sinceCheckpoint = 0;
    this.#counts.checkpoints++;
    if (this.#fileLag > 0) this.#writeFileAnchor(false);
  }

  /** Write both anchors for the current head now and wait for the keystore write (daemon shutdown paths, tests). */
  async flushAnchors(): Promise<void> {
    if (this.#closed) return this.#ksChain;
    if (this.#broken) return; // the ahead anchor is the evidence: never overwritten before acknowledgeGap
    if (!this.#readyDone) await this.#ready.catch(() => undefined);
    if (this.#fault) return this.#recoverAnchors(); // S34-02: re-anchor and record failed critical rows
    this.#writeFileAnchor(false);
    await this.#queueKeystore(false);
  }

  /* ── segments ───────────────────────────────────────────────────────────── */

  #rotate(): void {
    this.#appendRow(
      {
        kind: 'daemon.segment',
        principal: this.#opts.kernelPrincipal,
        payload: { segment: this.#meta.segment, next: this.#meta.segment + 1, firstSeq: this.#meta.baseSeq, lastSeq: this.#tip.seq + 1 },
      },
    );
    this.#noteForced(false);
    // Round 2: from the closing-row COMMIT on, every failure halts — the
    // instance is never left open with its tip on daemon.segment (a later
    // bulk append would add rows after the closing row).
    // durable anchor AT the closing row before the rename, so a crash between
    // rename and the new kernel.db is recognised as a rotation window on open.
    try {
      this.#writeFileAnchor(true);
    } catch (err) {
      throw this.#halt(this.#meta.segment, this.#tip.seq, err);
    }
    this.#finishRotation();
  }

  /**
   * Seal the active segment (its last row is daemon.segment) and start the
   * next. T-2026-10-17-013(a): any failure from its first step on (the
   * TRUNCATE checkpoint, the journal-mode switch, close, fsync, the seal
   * rename, the next kernel.db) halts the instance (#halt) and throws
   * ENGINE{rotation-failed}.
   */
  #finishRotation(writeAnchors = true): void {
    const sealedMeta = this.#meta;
    const tip = this.#tip;
    try {
      this.#db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      this.#db.exec('PRAGMA journal_mode=DELETE');
      this.#db.close();
      fsyncFile(this.activePath);
      const dest = path.join(this.home, SEGMENTS_DIR, segName(sealedMeta.segment));
      fs.renameSync(this.activePath, dest);
      fs.rmSync(`${this.activePath}-wal`, { force: true });
      fs.rmSync(`${this.activePath}-shm`, { force: true });
      fsyncDir(path.dirname(dest));
      fsyncDir(this.home);
      this.#createSegment({ log: sealedMeta.log, segment: sealedMeta.segment + 1, baseSeq: tip.seq + 1, basePrev: tip.hash });
      this.#attach();
    } catch (err) {
      throw this.#halt(sealedMeta.segment, tip.seq, err);
    }
    this.#tip = { ...this.#tip, at: tip.at };
    if (writeAnchors) void this.#writeAnchorsDurable();
    this.#diag('segment.sealed', { segment: sealedMeta.segment, lastSeq: tip.seq });
  }

  /**
   * T-2026-10-17-013(a): a rotation failed after the closing row was
   * committed (the db may still be open, or already closed, or a half-built
   * kernel.db may be open — any open handle is closed here). The instance
   * must not append after daemon.segment nor read a half-sealed state, so it
   * is CLOSED: timers are stopped (no
   * checkpoint fires on a closed handle), append / acknowledgeGap refuse
   * with the returned ENGINE{rotation-failed}, reads refuse `closed`, close()
   * reports it. The on-disk state is a rotation window; reopen completes it.
   */
  #halt(segment: number, closingSeq: number, err: unknown): Error {
    const error = (err as Error)?.message ?? String(err);
    if (this.#db?.isOpen) {
      try { this.#db.close(); } catch { /* the rotation failure is the error that matters */ }
    }
    for (const t of [this.#idleTimer, this.#fileTimer, this.#ksTimer]) if (t) clearTimeout(t);
    this.#halted = logRefusal('ENGINE', 'rotation-failed', `rotation of segment ${segment} failed after the closing row was committed (instance halted; reopen completes the rotation): ${error}`, {
      segment,
      closingSeq,
    });
    this.#closed = true;
    this.#diag('rotation.failed', { segment, closingSeq, error });
    return this.#halted;
  }

  /** Every segment, sealed first, then the active one. */
  segments(): SegmentInfo[] {
    const out = listSealedSegments(this.home).map((s) => segmentInfo(s.file, true));
    out.push({
      segment: this.#meta.segment,
      file: this.activePath,
      baseSeq: this.#meta.baseSeq,
      basePrev: this.#meta.basePrev,
      lastSeq: this.#tip.seq,
      lastHash: this.#tip.hash,
      lastKind: this.#tip.kind,
      sealed: false,
    });
    return out;
  }

  /* ── read (§9.3) ────────────────────────────────────────────────────────── */

  /**
   * Rows in seq order, projected for `reader` (audience/sensitivity, §9.3).
   * Rows the reader may not see are skipped; sensitive-column rows reach
   * redacting readers as `{kind, hsid, at, hash}` stubs.
   */
  *read(opts: { reader: ReaderClass; fromSeq?: number; toSeq?: number; kinds?: readonly string[]; limit?: number }): Generator<LogView> {
    const kinds = opts.kinds ? new Set(opts.kinds) : undefined;
    const out: LogView[] = [];
    let after = (opts.fromSeq ?? 1) - 1;
    const to = opts.toSeq ?? Number.MAX_SAFE_INTEGER;
    let n = 0;
    for (;;) {
      out.length = 0;
      const page = this.readPage({ reader: opts.reader, afterSeq: after, untilSeq: to, maxScan: 4096, kinds, visit: (v) => (out.push(v), true) });
      for (const v of out) {
        yield v;
        if (opts.limit !== undefined && ++n >= opts.limit) return;
      }
      if (page.lastScanned <= after || page.caughtUp) return;
      after = page.lastScanned;
    }
  }

  /**
   * RELEASED HEAD (D83 ordering, M1.4 slice 2 round 2): the highest seq with
   * no unresolved critical row at or below it. A critical row is committed
   * before its anchors resolve; until they do, neither it nor any later row
   * is readable or streamed. It advances when the critical append's anchors
   * resolve (success) or fail — a failed row is then FAILED: withheld from
   * every read (its daemon.anchor.failed marker row is the visible record).
   */
  releasedHead(): number {
    let min = Infinity;
    for (const seq of this.#pendingCritical) if (seq < min) min = seq;
    return min === Infinity ? this.#tip.seq : min - 1;
  }

  /** Seqs whose anchoring failed (markers in the log + failures this run). */
  #failed(): ReadonlySet<number> {
    if (!this.#failedLoaded) {
      this.#failedLoaded = true;
      for (const seg of this.#readSegments()) {
        const db = seg.sealed ? new DatabaseSync(seg.file, { readOnly: true }) : this.#db;
        try {
          for (const r of db.prepare("SELECT envelope FROM chain WHERE kind = 'daemon.anchor.failed'").all() as Array<{ envelope: string }>) {
            const seq = (JSON.parse(r.envelope) as { payload?: { seq?: unknown } }).payload?.seq;
            if (typeof seq === 'number') this.#failedSeqs.add(seq);
          }
        } finally {
          if (seg.sealed) db.close();
        }
      }
    }
    return this.#failedSeqs;
  }

  #resolveCritical(seq: number, ok: boolean): void {
    if (!this.#pendingCritical.delete(seq)) return;
    if (!ok) this.#failedSeqs.add(seq);
    this.#notifyRelease();
  }

  #notifyRelease(): void {
    const head = this.releasedHead();
    for (const l of this.#releaseListeners) {
      try {
        l(head);
      } catch (err) {
        this.#diag('release.listener.failed', { head, error: (err as Error)?.message ?? String(err) });
      }
    }
  }

  /**
   * M1.4 slice 2 read primitive (cursor paging + subscriptions). Scans rows
   * with `afterSeq < seq <= min(untilSeq, releasedHead())` in seq order, at
   * most `maxScan` of them. Per row: FAILED seqs (anchoring failed) are
   * skipped; for a non-human reader the projection runs FIRST (a row the
   * reader cannot see costs no hash and leaves no integrity signal); then the
   * envelope is RE-HASHED against its stored hash, its seq/kind/id checked
   * against the columns, and its `prev` checked against the previous row's
   * hash (linkage across contiguous rows; the page start is checked against
   * the stored hash of row afterSeq). A failing row is withheld from every
   * reader and counted. RESIDUAL: a same-user writer who rewrites a row AND
   * every later row's prev/hash consistently passes these checks — only
   * signature verification (kernel key) would catch it; that writer can read
   * kernel.db directly anyway, so it widens nothing for socket principals.
   * `visit` returns false to stop AFTER consuming that row; `lastScanned` is
   * the seq to resume after (stable: seqs are immutable).
   */
  readPage(opts: {
    reader: ReaderClass;
    afterSeq: number;
    untilSeq?: number;
    maxScan: number;
    kinds?: ReadonlySet<string> | ((kind: string) => boolean);
    match?: (v: LogView) => boolean;
    visit: (v: LogView) => boolean;
  }): { lastScanned: number; scanned: number; withheld: number; head: number; caughtUp: boolean } {
    if (this.#closed) throw logRefusal('ENGINE', 'closed', 'the kernel log is closed');
    const head = this.releasedHead();
    const until = Math.min(opts.untilSeq ?? head, head);
    const kindOk = typeof opts.kinds === 'function' ? opts.kinds : opts.kinds ? (k: string) => (opts.kinds as ReadonlySet<string>).has(k) : () => true;
    const failed = this.#failed();
    const human = opts.reader.class === 'human';
    let last = opts.afterSeq;
    let prevHash: string | undefined = last >= 0 ? this.#hashAt(last) : undefined;
    let scanned = 0;
    let withheld = 0;
    let stopped = false;
    const withhold = (seq: number, why: string): void => {
      withheld++;
      this.#diag('read.withheld', { seq, why });
    };
    for (const seg of this.#readSegments()) {
      if (stopped || scanned >= opts.maxScan || last >= until) break;
      if (seg.lastSeq <= last || seg.baseSeq > until) continue;
      const db = seg.sealed ? new DatabaseSync(seg.file, { readOnly: true }) : this.#db;
      try {
        const it = db
          .prepare('SELECT seq, id, envelope, hash, sig, kind, sensitivity FROM chain WHERE seq > ? AND seq <= ? ORDER BY seq LIMIT ?')
          .iterate(last, until, opts.maxScan - scanned) as Iterable<{ seq: number; id: string; envelope: string; hash: string; sig: string | null; kind: string; sensitivity: string }>;
        for (const r of it) {
          scanned++;
          const contiguous = r.seq === last + 1;
          const expectPrev = contiguous ? prevHash : undefined;
          last = r.seq;
          prevHash = r.hash;
          if (failed.has(r.seq)) continue; // anchoring failed: never effective
          if (!kindOk(r.kind)) continue;
          let e: EventV1;
          try {
            e = rowToEvent(r);
          } catch {
            withhold(r.seq, 'unparseable');
            continue;
          }
          let v: LogView | undefined;
          if (!human) {
            v = projectForReader(e, opts.reader, r.sensitivity);
            if (!v || (opts.match && !opts.match(v))) continue;
          }
          if (sha256TaggedFast(r.envelope) !== r.hash) {
            withhold(r.seq, 'hash-mismatch');
            continue;
          }
          if (e.seq !== r.seq || e.kind !== r.kind || e.id !== r.id) {
            withhold(r.seq, 'column-mismatch');
            continue;
          }
          if (expectPrev !== undefined && e.prev !== expectPrev) {
            withhold(r.seq, 'prev-mismatch');
            continue;
          }
          if (human) {
            v = projectForReader(e, opts.reader, r.sensitivity);
            if (!v || (opts.match && !opts.match(v))) continue;
          }
          if (!opts.visit(v!)) {
            stopped = true;
            break;
          }
        }
      } finally {
        if (seg.sealed) db.close();
      }
    }
    return { lastScanned: last, scanned, withheld, head, caughtUp: last >= until };
  }

  /**
   * `ev:<ULID>` lookup (#ref-resolver, §3.7). `undefined` = no such row, the
   * reader may not see it, it is above the released head, or its anchoring
   * failed — one answer, no existence oracle. Visibility is decided BEFORE
   * the hash check, so `'withheld'` (hash/column mismatch) is only ever
   * returned for a row the reader could otherwise see.
   */
  getById(id: string, reader: ReaderClass): LogView | 'withheld' | undefined {
    if (this.#closed) throw logRefusal('ENGINE', 'closed', 'the kernel log is closed');
    const released = this.releasedHead();
    const failed = this.#failed();
    for (const seg of this.#readSegments().reverse()) {
      const db = seg.sealed ? new DatabaseSync(seg.file, { readOnly: true }) : this.#db;
      try {
        const r = db.prepare('SELECT seq, id, envelope, hash, sig, kind, sensitivity FROM chain WHERE id = ?').get(id) as
          | { seq: number; id: string; envelope: string; hash: string; sig: string | null; kind: string; sensitivity: string }
          | undefined;
        if (!r) continue;
        if (r.seq > released || failed.has(r.seq)) return undefined;
        let e: EventV1;
        try {
          e = rowToEvent(r);
        } catch {
          return reader.class === 'human' ? 'withheld' : undefined;
        }
        const v = projectForReader(e, reader, r.sensitivity);
        if (!v) return undefined;
        if (sha256TaggedFast(r.envelope) !== r.hash || e.id !== id || e.seq !== r.seq || e.kind !== r.kind) return 'withheld';
        return v;
      } finally {
        if (seg.sealed) db.close();
      }
    }
    return undefined;
  }

  /**
   * Observe every committed row (read-side tail for #socket subscriptions).
   * Called synchronously after COMMIT, in seq order, BEFORE the row is
   * released (a committed critical row may still be unreadable); a listener
   * must not append re-entrantly (defer) and its exceptions never reach the
   * appender. Pair with onRelease to learn when rows become readable.
   */
  onCommit(listener: (e: EventV1) => void): () => void {
    this.#commitListeners.add(listener);
    return () => void this.#commitListeners.delete(listener);
  }

  /** Called with the new releasedHead() whenever a critical row's anchoring resolves (or fails). */
  onRelease(listener: (head: number) => void): () => void {
    this.#releaseListeners.add(listener);
    return () => void this.#releaseListeners.delete(listener);
  }

  /** Sealed segments are immutable: their SegmentInfo is read once. */
  #sealedInfoOf(file: string): SegmentInfo {
    let info = this.#sealedInfo.get(file);
    if (!info) this.#sealedInfo.set(file, (info = segmentInfo(file, true)));
    return info;
  }

  /** segments() with the immutable sealed infos cached. */
  #readSegments(): SegmentInfo[] {
    const out = listSealedSegments(this.home).map((s) => this.#sealedInfoOf(s.file));
    out.push({
      segment: this.#meta.segment,
      file: this.activePath,
      baseSeq: this.#meta.baseSeq,
      basePrev: this.#meta.basePrev,
      lastSeq: this.#tip.seq,
      lastHash: this.#tip.hash,
      lastKind: this.#tip.kind,
      sealed: false,
    });
    return out;
  }

  /* ── recovery (S33-10, P8-D83) ──────────────────────────────────────────── */

  /** The truncation this (recovery-mode) log refuses appends for, if any. */
  get truncation(): TruncationReport | undefined {
    return this.#broken ? { ...this.#broken } : undefined;
  }

  /** S34-14: the LIVE integrity state (`report.integrity` is the open-time snapshot). */
  get integrity(): LogIntegrity {
    if (this.#broken) return { state: 'truncated', ...this.#broken };
    if (this.#fault) return { state: 'anchor-faulted', failed: this.#fault.failed.map((x) => ({ ...x })) };
    return { state: 'ok' };
  }

  /**
   * Acknowledge rows lost to an UNCLEAN REBOOT (S33-10): appends one
   * kernel-signed `daemon.log.gap{lostFrom, lostTo, lostHash, bootPrev,
   * bootNow}` at the db tip, then writes both anchors durably and awaits the
   * keystore write. Only when that write succeeds does the log leave recovery
   * (S34-12); on failure it stays truncated, and a retry re-anchors the SAME
   * gap row (no second row). A tip that is a daemon.segment closing row is
   * rotated first (S34-13), so the gap row opens the next segment.
   *
   * PRESENCE: `presenceToken` must be a PresenceToken minted by the presence
   * module (identity/presence.ts) for `log.gap.acknowledge`, unused and
   * fresh; it is burned here — at the presence check, so a refusal later in
   * this method (tamper, unauthenticated lead, anchor failure) still consumes
   * it and a retry needs fresh presence (M1.3 UX: re-prompt per attempt). Until real presence lands (the signed helper's
   * prompt, M1.3) no production path can mint one, and this method is
   * reachable only through the internal test entry (registered seam above).
   *
   * Refused: no truncation (BAD_REQUEST{no-gap}); not usable presence
   * (FORBIDDEN{presence-required}, `data.presence` = the verdict: not-a-token,
   * wrong-purpose, stale, used); only the file anchor leads while a
   * keystore anchor is present (FORBIDDEN{unauthenticated-lead}, S34-04);
   * cause `tamper` (FORBIDDEN{tamper} — same boot or after a clean close, no
   * power loss can explain it); no kernel key (FORBIDDEN{unsigned-mandatory}).
   */
  async #acknowledgeGap(input: { presenceToken: PresenceToken }): Promise<AppendResult> {
    if (this.#closed) throw this.#halted ?? logRefusal('ENGINE', 'closed', 'the kernel log is closed');
    const t = this.#broken;
    if (!t) throw logRefusal('BAD_REQUEST', 'no-gap', 'the log has no unacknowledged truncation');
    const presence = consumePresence(input?.presenceToken, 'log.gap.acknowledge', this.#opts.clock());
    if (presence !== 'ok') {
      throw logRefusal('FORBIDDEN', 'presence-required', `acknowledging a log gap requires fresh presence for it (${presence})`, { presence });
    }
    if (t.unauthenticatedLead) {
      throw logRefusal('FORBIDDEN', 'unauthenticated-lead', 'only the file anchor leads the db while the keystore anchor does not: the lead is unauthenticated and cannot be acknowledged', { ...t });
    }
    if (t.cause !== 'unclean-reboot') {
      throw logRefusal('FORBIDDEN', 'tamper', 'an anchor ahead of the db in the same boot session (or after a clean close) is tamper, not an unclean reboot; it cannot be acknowledged', { ...t });
    }
    if (!this.#opts.signer) throw logRefusal('FORBIDDEN', 'unsigned-mandatory', 'daemon.log.gap must be signed by the kernel key', { kind: 'daemon.log.gap' });
    if (!this.#gapRow) {
      // S34-13; T-2026-10-17-015(3): no anchor write here — the durable write
      // below anchors the gap row, and an anchor of the closing row queued now
      // would overwrite the ahead keystore anchor (the evidence) before the
      // gap row is committed.
      if (this.#tip.kind === 'daemon.segment') this.#finishRotation(false);
      this.#gapRow = this.#appendRow({
        kind: 'daemon.log.gap',
        principal: this.#opts.kernelPrincipal,
        signer: this.#opts.signer,
        payload: { lostFrom: t.lostFrom, lostTo: t.lostTo, lostHash: t.lostHash, bootPrev: t.bootPrev, bootNow: t.bootNow, fileLag: t.fileLag },
      });
      this.#noteForced(true);
      this.#counts.forcedAnchors++;
      this.#scheduleCheckpoint();
    }
    const e = this.#gapRow;
    try {
      await this.#writeAnchorsDurable();
    } catch (err) {
      this.#diag('log.gap.anchor.failed', { seq: e.seq, error: (err as Error)?.message ?? String(err) });
      throw logRefusal('ENGINE', 'anchor-failed', `anchoring failed for daemon.log.gap row ${e.seq} (still in recovery): ${(err as Error)?.message ?? String(err)}`, { kind: e.kind, seq: e.seq });
    }
    this.#broken = undefined; // S34-12: only after both anchors succeeded
    this.#gapRow = undefined;
    this.#diag('log.gap.acknowledged', { lostFrom: t.lostFrom, lostTo: t.lostTo, seq: e.seq });
    return { seq: e.seq, hash: e.hash, anchored: this.#anchoring, event: e };
  }

  /* ── verify ─────────────────────────────────────────────────────────────── */

  /** `gnomon log verify`: the full chain (every segment + both anchors), or one segment. */
  verify(opts: { segment?: number } = {}): VerifyReport {
    const kernelKeyIds = this.#kernelKeyIds();
    return verifyLogWith(this.home, { keyRing: this.#keyRing, segment: opts.segment, kernelPrincipal: this.#opts.kernelPrincipal, kernelKeyIds, ...(this.#opts.kernelKeyBounds ? { kernelKeyBounds: this.#opts.kernelKeyBounds } : {}) }, this.#keystoreAnchor);
  }

  /**
   * Clean close: both anchors durably, carrying the clean-close marker
   * (S33-07; the keystore copy is the authoritative one, S34-05), then a
   * TRUNCATE checkpoint. The db work is synchronous; the returned promise
   * resolves when the keystore write settles and REPORTS a failed write
   * (S34-12) — `{keystore: 'failed', error}` — instead of swallowing it. A
   * truncated (recovery-mode) log writes no anchor: `skipped-truncated`. An
   * anchor-faulted log first commits any pending daemon.anchor.failed markers;
   * `fault` reports whether the closing anchors cleared the fault (S34-17).
   */
  close(): Promise<CloseReport> {
    if (this.#closing) return this.#closing;
    if (this.#halted) {
      // T-2026-10-17-013(a): no db, no anchor write — the rotation window on disk is the state the next open completes
      const fault: CloseReport['fault'] = this.#fault ? 'pending' : 'none';
      return (this.#closing = Promise.resolve({ keystore: 'failed', error: this.#halted.message, fault }));
    }

    for (const t of [this.#idleTimer, this.#fileTimer, this.#ksTimer]) if (t) clearTimeout(t);
    let ks: Promise<void> | undefined;
    let syncErr: unknown;
    const hadFault = this.#fault !== undefined;
    const anchoredSeq = () => this.#tip.seq;
    let headSeq = 0;
    if (!this.#broken) {
      try {
        if (hadFault) this.#recordPendingMarkers(); // S34-17: the closing anchors then cover the markers
        headSeq = anchoredSeq();
        ks = this.#writeAnchorsDurable(true);
      } catch (err) {
        syncErr = err;
      }
    }
    const halted = this.#halted as Error | undefined; // may be set by the marker commit above (TS narrowed it at the top)
    if (halted) {
      // round 3: the pending markers reached the segment boundary and that rotation halted (db already closed) — report, never throw
      return (this.#closing = Promise.resolve({ keystore: 'failed', error: halted.message, fault: this.#fault ? 'pending' : 'none' }));
    }
    this.#closed = true;
    this.#db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    this.#db.close();
    const faultOutcome = (): CloseReport['fault'] => (!hadFault && !this.#fault ? 'none' : this.#fault ? 'pending' : 'recovered');
    const fail = (err: unknown): CloseReport => {
      const error = (err as Error)?.message ?? String(err);
      this.#diag('anchor.close.failed', { error });
      return { keystore: 'failed', error, fault: faultOutcome() };
    };
    this.#closing =
      syncErr !== undefined
        ? Promise.resolve(fail(syncErr))
        : ks
          ? ks.then((): CloseReport => {
              this.#clearFaultIfAnchored(headSeq);
              return { keystore: 'ok', fault: faultOutcome() };
            }, fail)
          : Promise.resolve({ keystore: 'skipped-truncated', fault: faultOutcome() });
    return this.#closing;
  }
}

/** Kinds only the log itself appends (rotation, open, recovery, anchor faults); verify binds them to the kernel identity (S34-18). */
export const RESERVED_KINDS: readonly string[] = Object.freeze(['daemon.segment', 'daemon.log.gap', 'daemon.anchor.lag', 'daemon.anchor.failed', 'daemon.log.quarantined']);

/** T-2026-10-17-009(a): the reserved kind that may only be a log's GENESIS row (seq 1): the successor of a quarantined home. */
export const QUARANTINE_GENESIS_KIND = 'daemon.log.quarantined' as const;

/** daemon.log.quarantined payload (contracts RESERVED_KIND_PAYLOADS, P8-D89). `evidencePath` is a sensitive field label. */
export interface QuarantinedPayload {
  quarantinedLog: string;
  quarantinedHead: { seq: number; hash: string; segment: number };
  evidencePath: string;
  /** How the human was proved: `interactive-confirm` (a TTY confirmation) until presence lands (M1.3). */
  authorizedBy: 'interactive-confirm';
}

/** S34-22: a kernel row is needed but the log has no kernel key (keyless logs are non-rotating, diagnostic-only). */
function keyRequired(kind: string, why: string) {
  return logRefusal('FORBIDDEN', 'kernel-key-required', `${why}; ${kind} must be signed by the kernel key and this log has none`, { kind });
}

/** INTEGRITY_BROKEN{truncated} with the S33-10 cause (both causes refuse). */
function truncatedRefusal(t: TruncationReport, tipSeq: number) {
  return logRefusal('INTEGRITY_BROKEN', 'truncated', `the ${t.anchor} anchor is at seq ${t.lostTo} but the log ends at ${tipSeq} (cause: ${t.cause})`, {
    ...t,
    anchorSeq: t.lostTo,
    tipSeq,
  });
}

/* ── payload checks (G-LOG-03: an inject row must say what was injected) ─── */

function checkPayload(kind: string, payload: unknown): void {
  if (kind === 'session.inject') {
    if (!isPlainObject(payload)) throw logRefusal('BAD_REQUEST', 'bad-payload', 'session.inject needs {origin, hash, bytes}', { kind });
    if (!(INJECT_ORIGINS as readonly unknown[]).includes(payload.origin)) throw logRefusal('BAD_REQUEST', 'bad-payload', 'session.inject origin must be kernel|client|peer', { kind });
    if (typeof payload.hash !== 'string' || !SHA256_TAGGED.test(payload.hash)) throw logRefusal('BAD_REQUEST', 'bad-payload', 'session.inject hash must be sha256:<hex>', { kind });
    if (!Number.isSafeInteger(payload.bytes) || (payload.bytes as number) < 0) throw logRefusal('BAD_REQUEST', 'bad-payload', 'session.inject bytes must be a non-negative integer', { kind });
  }
  // P8-D98 / T-2026-10-19-014 B1: session.drained{uuid, reason} is closed and checked at append (§2.4 rule 11)
  if (kind === 'session.drained') {
    const errors = validateKindPayload(kind, payload);
    if (errors.length) throw logRefusal('BAD_REQUEST', 'bad-payload', `session.drained payload: ${errors.slice(0, 4).join('; ')}`, { kind });
  }
  // T-2026-10-21-006: offer.suppressed is closed (names only, never message text) and checked at append;
  // T-2026-10-21-008: offer.retired and session.anomaly likewise (ids and closed reasons only)
  // 8.0:session-rename: request.session.rename and session.renamed carry a normalised display name (isSessionName)
  // 8.0:rules-view: approval.rule.disabled / approval.rule.enabled are closed (ids, an ISO time, a closed cause)
  if (kind === 'offer.suppressed' || kind === 'offer.retired' || kind === 'session.anomaly' || kind === 'request.session.rename' || kind === 'session.renamed' || kind === 'approval.rule.disabled' || kind === 'approval.rule.enabled') {
    const errors = validateKindPayload(kind, payload);
    if (errors.length) throw logRefusal('BAD_REQUEST', 'bad-payload', `${kind} payload: ${errors.slice(0, 4).join('; ')}`, { kind });
  }
  // T-2026-10-18-016 (P8-D93): the typed compaction row is closed and checked at append
  if (kind === 'session.compacted') {
    const errors = validateSessionCompactedPayload(payload);
    if (errors.length) throw logRefusal('BAD_REQUEST', 'bad-payload', `session.compacted payload: ${errors.slice(0, 4).join('; ')}`, { kind });
  }
}

/* ── verify (standalone: the CLI can run it against a home with no daemon) ── */

const SENS = SENSITIVITIES as readonly string[];
const SHA256_TAGGED = /^sha256:[0-9a-f]{64}$/;

export interface VerifyLogOptions {
  keyRing: KeyRing;
  segment?: number;
  kernelPrincipal?: string;
  kernelKeyIds?: readonly string[];
  /** Aegis S2 H-2: legacy kernel keys bounded to their seal (see KernelLogOptions.kernelKeyBounds). */
  kernelKeyBounds?: Readonly<Record<string, { maxSeq: number; logId: string }>>;
  /**
   * Called once per row, in seq order, with the exact bytes this pass checked
   * (M1.12 replay folds inside verify's single pass, Aegis C2). A consumer
   * must discard what it saw unless the report is `ok`.
   */
  onRow?: (row: VerifiedRow) => void;
}

/** A row as verify read it (the bytes its checks ran on). */
export interface VerifiedRow {
  seq: number;
  kind: string;
  envelope: string;
  hash: string;
}

export function verifyLog(
  home: string,
  opts: VerifyLogOptions,
): VerifyReport {
  refuseSeamKeys(opts, 'verifyLog');
  return verifyLogWith(home, opts, new KeystoreAnchorStore());
}

/**
 * The verify body. The keystore anchor store is a parameter, not an option:
 * the public verifyLog always reads the kernel's own store; KernelLog#verify
 * passes the store the log was opened with (a test seam only via the
 * internal test entry).
 */
function verifyLogWith(home: string, opts: VerifyLogOptions, keystoreAnchor: AnchorStore): VerifyReport {
  // S34-06: rows by the kernel principal must be signed by a kernel key (checked when the kernel key ids are known)
  const kernel = opts.kernelPrincipal && opts.kernelKeyIds?.length ? { principal: opts.kernelPrincipal, keyIds: new Set(opts.kernelKeyIds), bounds: opts.kernelKeyBounds } : undefined;
  const failures: VerifyFailure[] = [];
  const fail = (f: VerifyFailure): void => {
    if (failures.length < 1000) failures.push(f);
  };
  const files = listSealedSegments(home).map((s) => ({ ...s, sealed: true }));
  const active = path.join(home, ACTIVE_DB);
  if (fs.existsSync(active)) files.push({ segment: Number.NaN, file: active, sealed: false });
  const report: VerifyReport = { ok: false, rows: 0, segments: [], failures, kernelBinding: kernel ? 'ok' : 'not-checked', anchors: { file: 'not-checked', keystore: 'not-checked' } };

  let logId: string | undefined;
  let expect: { seq: number; prev: string; segment: number } | undefined;
  let lastSegment: { seq: number; hash: string } | undefined;
  for (const f of files) {
    const db = new DatabaseSync(f.file, { readOnly: true });
    try {
      let meta: Meta;
      try {
        meta = readMeta(db);
      } catch {
        fail({ code: 'meta', segment: f.segment, detail: `${path.basename(f.file)}: segment meta missing or malformed` });
        continue;
      }
      if (f.sealed && meta.segment !== f.segment) fail({ code: 'meta', segment: f.segment, detail: `file name says segment ${f.segment}, meta says ${meta.segment}` });
      logId ??= meta.log;
      if (meta.log !== logId) fail({ code: 'log', segment: meta.segment, detail: 'segment belongs to another log' });
      const whole = opts.segment === undefined;
      if (whole) {
        if (!expect) {
          if (meta.segment !== 1 || meta.baseSeq !== 1 || meta.basePrev !== genesisPrev(meta.log)) {
            fail({ code: 'segment-link', segment: meta.segment, detail: 'first segment does not start at the genesis prev (segment missing?)' });
          }
        } else if (meta.segment !== expect.segment || meta.baseSeq !== expect.seq || meta.basePrev !== expect.prev) {
          fail({ code: 'segment-link', segment: meta.segment, detail: `segment ${meta.segment} does not continue segment ${expect.segment - 1}` });
        }
      } else if (meta.segment !== opts.segment) continue;

      const r = verifyRows(db, meta, opts.keyRing, fail, kernel, opts.onRow);
      report.rows += r.rows;
      report.segments.push({ segment: meta.segment, firstSeq: meta.baseSeq, lastSeq: r.lastSeq, rows: r.rows, ok: r.ok });
      if (f.sealed && r.lastKind !== 'daemon.segment') fail({ code: 'segment-unsealed', segment: meta.segment, detail: 'sealed segment does not end with daemon.segment (truncated?)' });
      expect = { seq: r.lastSeq + 1, prev: r.lastHash, segment: meta.segment + 1 };
      lastSegment = { seq: r.lastSeq, hash: r.lastHash };
    } finally {
      db.close();
    }
  }

  if (opts.segment === undefined) {
    if (!fs.existsSync(active)) fail({ code: 'segment-link', segment: Number.NaN, detail: 'kernel.db (active segment) is missing' });
    const fa = new FileAnchorStore(home).read();
    if (fa.state !== 'present') {
      report.anchors.file = 'missing';
      fail({ code: 'anchor', segment: Number.NaN, detail: `file anchor ${fa.state}` });
    } else if (lastSegment) {
      const h = fa.head;
      if (h.log !== logId || h.seq > lastSegment.seq || (h.seq === lastSegment.seq && h.hash !== lastSegment.hash)) {
        report.anchors.file = 'mismatch';
        fail({ code: 'anchor', segment: h.segment, detail: `file anchor seq ${h.seq} does not match the chain tip ${lastSegment.seq}` });
      } else report.anchors.file = h.seq === lastSegment.seq ? 'ok' : 'lagging';
    }
    const ks = keystoreAnchor.read();
    if (ks.state === 'unavailable') report.anchors.keystore = 'unavailable';
    else if (ks.state === 'present' && lastSegment && ks.head.seq === lastSegment.seq && ks.head.hash === lastSegment.hash) report.anchors.keystore = 'ok';
    else if (ks.state === 'present' && lastSegment && ks.head.log === logId && ks.head.seq < lastSegment.seq) report.anchors.keystore = 'lagging'; // coalesced cadence (S33-05)
    else {
      report.anchors.keystore = 'mismatch';
      fail({ code: 'anchor', segment: Number.NaN, detail: `keystore anchor ${ks.state}` });
    }
  }
  if (kernel && failures.some((f) => f.code === 'kernel-key' || f.code === 'reserved-binding')) report.kernelBinding = 'failed';
  report.ok = failures.length === 0;
  return report;
}

function verifyRows(
  db: DatabaseSync,
  meta: Meta,
  keyRing: KeyRing,
  fail: (f: VerifyFailure) => void,
  kernel?: { principal: string; keyIds: ReadonlySet<string>; bounds?: Readonly<Record<string, { maxSeq: number; logId: string }>> },
  onRow?: (row: VerifiedRow) => void,
): { rows: number; lastSeq: number; lastHash: string; lastKind: string | null; ok: boolean } {
  let expectSeq = meta.baseSeq;
  let prev = meta.basePrev;
  let rows = 0;
  let lastKind: string | null = null;
  let ok = true;
  const seg = meta.segment;
  const bad = (code: VerifyFailureCode, seq: number, detail: string): void => {
    ok = false;
    fail({ code, segment: seg, seq, detail });
  };
  const it = db.prepare('SELECT * FROM chain ORDER BY seq').iterate() as Iterable<{
    seq: number;
    id: string;
    kind: string;
    at: string;
    principal: string;
    audience: string;
    sensitivity: string;
    envelope: string;
    prev_hash: string;
    hash: string;
    sig: string | null;
  }>;
  for (const r of it) {
    rows++;
    if (r.seq !== expectSeq) bad('seq-gap', r.seq, `expected seq ${expectSeq}, found ${r.seq}`);
    expectSeq = r.seq + 1;
    lastKind = r.kind;
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(r.envelope) as Record<string, unknown>;
      if (canonicalJson(e) !== r.envelope) bad('envelope', r.seq, 'stored envelope is not canonical');
    } catch {
      bad('envelope', r.seq, 'stored envelope is not JSON');
      prev = r.hash;
      continue;
    }
    if (sha256TaggedFast(r.envelope) !== r.hash) bad('hash', r.seq, 'hash does not match the envelope bytes');
    if (e.prev !== prev || r.prev_hash !== prev) bad('prev', r.seq, 'prev does not chain to the previous row');
    if (e.seq !== r.seq) bad('column-mismatch', r.seq, `envelope seq ${String(e.seq)} != row seq`);
    if (e.log !== meta.log) bad('log', r.seq, 'envelope names another log');
    for (const [col, key] of [
      ['id', 'id'],
      ['kind', 'kind'],
      ['at', 'at'],
      ['principal', 'principal'],
      ['audience', 'audience'],
      ['sensitivity', 'sensitivity'],
    ] as const) {
      if (r[col] !== e[key]) bad('column-mismatch', r.seq, `column ${col} differs from the envelope`);
    }
    const d = defaultLabelsFor(r.kind);
    if (!d) bad('unregistered-kind', r.seq, `kind ${r.kind} is not registered`);
    else if (SENS.indexOf(String(e.sensitivity)) < SENS.indexOf(d.sensitivity)) bad('label-relaxed', r.seq, `sensitivity looser than the ${r.kind} default`);
    if (r.sig !== null) {
      const keyId = typeof e.keyId === 'string' ? e.keyId : '';
      const v = keyRing.verify(keyId, 'event', r.hash, Buffer.from(r.sig, 'base64'));
      if (v === 'unknown-key') bad('unknown-key', r.seq, `signature by unknown key ${keyId || '(none)'}`);
      else if (v === 'bad') bad('sig', r.seq, 'signature does not verify');
      const bound = kernel?.bounds?.[keyId];
      if (kernel && bound && (r.seq > bound.maxSeq || meta.log !== bound.logId)) bad('kernel-key', r.seq, `row signed by legacy kernel key ${keyId} past its seal (seq ${bound.maxSeq} of ${bound.logId})`);
      else if (kernel && r.principal === kernel.principal && !kernel.keyIds.has(keyId)) bad('kernel-key', r.seq, `kernel-principal row signed by ${keyId || '(none)'}, not a kernel key`);
      else if (kernel && RESERVED_KINDS.includes(r.kind) && (r.principal !== kernel.principal || !kernel.keyIds.has(keyId))) {
        bad('reserved-binding', r.seq, `${r.kind} must be appended by the kernel principal with a kernel key`);
      }
      if (r.kind === QUARANTINE_GENESIS_KIND && (r.seq !== 1 || meta.segment !== 1)) bad('reserved-binding', r.seq, `${r.kind} is only ever a log's genesis row (seq 1)`);
    } else if (!mayBeUnsigned(r.kind)) bad('unsigned', r.seq, `${r.kind} row is unsigned`); // mayBeUnsigned excludes the sig-mandatory kinds
    prev = r.hash;
    onRow?.({ seq: r.seq, kind: r.kind, envelope: r.envelope, hash: r.hash });
  }
  return { rows, lastSeq: expectSeq - 1, lastHash: prev, lastKind, ok };
}
