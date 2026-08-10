/**
 * #warp-store — content-addressed store for WARP objects + states.
 *
 * TWO DISK ARTIFACTS WITH VERY DIFFERENT STATUS, and conflating them was the bug:
 *
 *   `.warpline/states/<stateId>.json.gz`  — NOT a cache. It is the ONLY copy of a
 *      sealed strand's semantic snapshot. Nothing re-derives it: `loadState`
 *      returning undefined is a PERMANENT fail-closed for that base (native.ts
 *      propose, pick.ts, admit.ts, anchor.ts and stake.ts all refuse on it, by
 *      design). So its write is DURABLE (durable.ts: unique staging name, fsync,
 *      rename, parent-dir fsync) and its failure THROWS. See writeStateFile.
 *
 *   `.warpline/warp/objects/<contentId>.json` — a genuine debug mirror with ZERO
 *      readers anywhere in the package (grep: `warp/objects` is written here and
 *      read nowhere). Best-effort, unhardened, and its failures are COUNTED rather
 *      than thrown. See writeObjectMirror.
 *
 * The ONLY thing Warpline ever writes to disk is under `.warpline/` — never the
 * user's tracked files, HEAD, index, or worktree.
 *
 * ═══ WHY THE STATE WRITE THROWS (soundness audit, "silent full disk") ═══
 *
 * `writeJson` used to be `try { writeFileSync } catch { /* best-effort *\/ }`. On a
 * full disk the write failed SILENTLY, the strand sealed anyway, and every later
 * read of that stateId came back undefined — indistinguishable from "never
 * written", and permanently fatal for that base. Silence made a WRITE FAILURE
 * wear the costume of a CACHE MISS.
 *
 * Throwing is safe here precisely because of an ordering property that holds at
 * every call site: `putState` always runs BEFORE `appendStrand`. seal.ts:105 puts,
 * then appends; native.ts propose (411), admit (702) and resolve (875) do the same;
 * oracle.ts only puts. So a throw refuses the seal with the ledger UNTOUCHED — no
 * orphan strand, no half-history, and the operator sees ENOSPC at the moment it
 * happened instead of a fail-closed refusal three commands later. The seal is
 * simply not claimed. That is the whole point of the batch this change belongs to.
 *
 * ═══ WHY THE OBJECT MIRROR DOES NOT (the same reasoning, run honestly) ═══
 *
 * Consistency would say harden both. Cost says otherwise, decisively: `putState`
 * mirrors EVERY object in the state, which on this repo is ~13,800 files per seal.
 * durable.ts measured a file fsync at 3.66 ms and a directory fsync at 3.79 ms on
 * this APFS volume, so routing the mirror through `atomicWriteSync` would add on
 * the order of ~100 SECONDS to every seal — to harden files nothing reads. So the
 * mirror keeps a plain write, and "loud" for it means COUNTED and interrogable
 * (`cacheHealth()`) rather than swallowed. It is also not really a separate risk:
 * the disk-full case that motivated all of this is caught microseconds later by the
 * state write in the same `putState` call, which does throw.
 *
 * ═══ GZIP (7.9× measured on live data) ═══
 *
 * `states/` was 1,020 MB for 72 snapshots — a full symbol-graph re-serialization per
 * seal regardless of what changed. Measured on the largest live state
 * (18,984,508 bytes): gzip level 6 (node's default) → 2,409,897 bytes, 7.88×, at
 * 145 ms to compress and 12 ms to read back. That trades ~145 ms of CPU against
 * writing AND fsyncing 16.6 MB fewer bytes, so it substantially pays for the
 * hardening added above. A projected 16.8 GB/year becomes ~2.1 GB/year.
 *
 * The FILENAME STAYS THE CONTENT ADDRESS — only the extension changes
 * (`<stateId>.json` → `<stateId>.json.gz`).
 *
 * MIGRATION: pre-existing uncompressed `<stateId>.json` snapshots are LEFT ALONE —
 * neither converted eagerly nor rewritten lazily. `loadState` reads both, preferring
 * `.json.gz` when both exist (the compressed file can only have been written later,
 * and a stateId's snapshot is legitimately re-writable — see seal.ts's byte-custody
 * note). Rationale: an eager pass would have to rewrite ~1 GB on a volume that is
 * 99% full, and a lazy delete-on-rewrite would silently invalidate fixtures that
 * copy specific `states/*.json` files out of the live fabric. Reclaiming that space
 * is a separate, explicit chore, not a side effect of the next seal.
 *
 * Library code: no console output.
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import * as zlib from 'node:zlib';
import { atomicWriteSync } from './durable.js';
import type { WarpObject } from './warp-object.js';
import type { WarpState } from './warp-state.js';

/** The compressed form written from now on. */
const STATE_EXT = '.json.gz';
/** The pre-compression form: still READ, never written again. */
const LEGACY_STATE_EXT = '.json';

/** What the debug mirror has failed to write, for callers that care to ask. */
export interface CacheHealth {
  /** Failed writes of the ZERO-READER `warp/objects/` debug mirror this process. */
  objectMirrorFailures: number;
  /** The first such failure, `code: message`. Null when there have been none. */
  firstObjectMirrorError: string | null;
}

export class WarpStore {
  private objects = new Map<string, WarpObject>();
  private states = new Map<string, WarpState>();
  private readonly warplineDir: string;
  private readonly diskCache: boolean;
  private objectMirrorFailures = 0;
  private firstObjectMirrorError: string | null = null;

  constructor(rootDir: string, opts: { diskCache?: boolean } = {}) {
    this.warplineDir = path.join(rootDir, '.warpline');
    this.diskCache = opts.diskCache ?? true;
  }

  /** Put an object by its contentId (idempotent — same contentId ⇒ same bytes). */
  putObject(obj: WarpObject): void {
    if (!obj.contentId) return;
    this.objects.set(obj.contentId, obj);
    if (this.diskCache) {
      this.writeObjectMirror(path.join('warp', 'objects', `${this.safe(obj.contentId)}.json`), obj);
    }
  }

  getObject(contentId: string): WarpObject | undefined {
    return this.objects.get(contentId);
  }

  /**
   * Put a whole state (and all its objects). THROWS if the snapshot cannot be
   * written — see the module header: every caller runs this before `appendStrand`,
   * so a throw refuses the seal with the ledger untouched.
   */
  putState(state: WarpState): void {
    for (const obj of state.objects.values()) this.putObject(obj);
    this.states.set(state.stateId, state);
    if (this.diskCache) this.writeStateFile(state);
  }

  getState(stateId: string): WarpState | undefined {
    return this.states.get(stateId);
  }

  /**
   * Read a state back from the durable `.warpline/states/` snapshot (the Phase-2
   * write path needs the PARENT state across CLI runs, when the in-mem map is
   * empty). Rehydrates the serialized WarpObject[] into the objects Map keyed by
   * symbol — faithful because `diff` reads only stableKey/contentId/contract off
   * each object, all of which serializeState preserves. Returns undefined if the
   * state was never persisted (or the bytes are unreadable) — callers fail closed
   * on that, which is now an honest signal: after the change above, a snapshot is
   * missing only if it was never written or was deleted, never because a write
   * silently failed.
   */
  loadState(stateId: string): WarpState | undefined {
    const inMem = this.states.get(stateId);
    if (inMem) return inMem;
    const raw = this.readStateBytes(stateId);
    if (raw === null) return undefined;
    try {
      const data = JSON.parse(raw) as {
        ref: string;
        treeSha: string | null;
        stateId: string;
        absorbedAt: string;
        objects: WarpObject[];
      };
      const objects = new Map<string, WarpObject>();
      for (const obj of data.objects) objects.set(obj.symbol, obj);
      const state: WarpState = {
        ref: data.ref,
        treeSha: data.treeSha,
        stateId: data.stateId,
        absorbedAt: data.absorbedAt,
        objects,
      };
      this.states.set(state.stateId, state);
      for (const obj of objects.values()) this.objects.set(obj.contentId, obj);
      return state;
    } catch {
      return undefined;
    }
  }

  /** Append a JSONL row to `.warpline/<file>` (the oracle ledger). */
  appendJsonl(file: string, row: unknown): void {
    const full = path.join(this.warplineDir, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.appendFileSync(full, JSON.stringify(row) + '\n', 'utf8');
  }

  /**
   * Failures of the best-effort debug mirror, for a caller that wants to surface
   * them. Deliberately a RETURN VALUE and not a stderr write: this module is
   * library code and the CLI/daemon own every byte a human reads.
   */
  cacheHealth(): CacheHealth {
    return {
      objectMirrorFailures: this.objectMirrorFailures,
      firstObjectMirrorError: this.firstObjectMirrorError,
    };
  }

  /** `.warpline/states/<safe(stateId)>.json.gz` — the compressed snapshot. */
  private statePath(stateId: string): string {
    return path.join(this.warplineDir, 'states', `${this.safe(stateId)}${STATE_EXT}`);
  }

  /** `.warpline/states/<safe(stateId)>.json` — the pre-compression snapshot. */
  private legacyStatePath(stateId: string): string {
    return path.join(this.warplineDir, 'states', `${this.safe(stateId)}${LEGACY_STATE_EXT}`);
  }

  /**
   * The snapshot write. Compressed, atomic, fsynced, and LOUD.
   *
   * The thrown message names the distinction the old `catch {}` erased, because the
   * operator who sees it is about to go looking in the wrong place otherwise: this
   * is not a cache that can be repopulated, and nothing was appended.
   */
  private writeStateFile(state: WarpState): void {
    const target = this.statePath(state.stateId);
    try {
      atomicWriteSync(target, zlib.gzipSync(JSON.stringify(serializeState(state))));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? 'unknown';
      throw new Error(
        `warpline: the state snapshot for ${state.stateId} could not be written to ${target} (${code}: ${(err as Error).message}). ` +
          `This is a FAILED WRITE, not a cache miss — .warpline/states/ holds the only copy of a strand's semantic snapshot, ` +
          `and a strand whose snapshot cannot be loaded fails closed permanently (pick, propose, admit, attest and stake recover all refuse on it). ` +
          `Nothing has been appended to the ledger; free space (or fix permissions on .warpline/states/) and re-run.`,
        { cause: err },
      );
    }
  }

  /**
   * Read the snapshot bytes, compressed form first. A corrupt/truncated `.gz` falls
   * through to the legacy path and then to null, which callers already treat as
   * "missing or corrupt" and refuse on — the fail-closed answer either way.
   */
  private readStateBytes(stateId: string): string | null {
    try {
      return zlib.gunzipSync(fs.readFileSync(this.statePath(stateId))).toString('utf8');
    } catch {
      /* not present (or not readable) in compressed form — try the legacy form */
    }
    try {
      return fs.readFileSync(this.legacyStatePath(stateId), 'utf8');
    } catch {
      return null;
    }
  }

  /**
   * The zero-reader debug mirror: plain, unhardened, never fatal — but COUNTED, so
   * "we never tried" and "we tried and it failed" stop looking identical.
   */
  private writeObjectMirror(rel: string, value: unknown): void {
    try {
      const full = path.join(this.warplineDir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, JSON.stringify(value), 'utf8');
    } catch (err) {
      this.objectMirrorFailures++;
      this.firstObjectMirrorError ??= `${(err as NodeJS.ErrnoException).code ?? 'unknown'}: ${(err as Error).message}`;
    }
  }

  private safe(id: string): string {
    // contentIds contain ':' which is fine on POSIX but replace for safety.
    return id.replace(/[^a-zA-Z0-9._-]/g, '_');
  }
}

/** A state with its object Map flattened to an array for JSON. */
export function serializeState(state: WarpState): unknown {
  return {
    ref: state.ref,
    treeSha: state.treeSha,
    stateId: state.stateId,
    absorbedAt: state.absorbedAt,
    objects: Array.from(state.objects.values()),
  };
}
